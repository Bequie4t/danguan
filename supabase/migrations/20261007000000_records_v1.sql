-- 당우안 공통 기록 구조 v1
-- 대상: Supabase(Postgres 15+). 이 파일은 새 테이블만 만들며 기존 테이블·데이터를 지우거나 바꾸지 않는다.
--
-- 만드는 것
--   1) consents  : 민감정보 저장 동의 (항목·버전·시점)
--   2) checkins  : 버거움 기록 (앱·웹이 같은 계정으로 공유)
--   3) create_checkin / update_checkin / delete_checkin : 중복 방지·충돌 확인이 들어간 저장 함수
--
-- 보안 원칙
--   - 모든 테이블에 RLS. 본인 행만 조회·생성·수정·삭제.
--   - 저장(생성·수정)은 유효한 저장 동의가 있을 때만.
--   - 함수는 SECURITY INVOKER: 호출한 사용자의 권한과 RLS가 그대로 적용된다.

-- ---------------------------------------------------------------------------
-- 1. 동의
-- ---------------------------------------------------------------------------
create table if not exists public.consents (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  consent_key    text not null check (consent_key in ('sensitive_record_storage')),
  policy_version text not null check (char_length(policy_version) between 1 and 20),
  agreed_at      timestamptz not null default now(),
  withdrawn_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists consents_owner_key_idx on public.consents (owner_id, consent_key);

alter table public.consents enable row level security;

drop policy if exists consents_select_own on public.consents;
create policy consents_select_own on public.consents
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists consents_insert_own on public.consents;
create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and withdrawn_at is null);

-- 철회(withdrawn_at 기록)만을 위한 수정. 동의 이력은 지우지 않는다.
drop policy if exists consents_update_own on public.consents;
create policy consents_update_own on public.consents
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.consents from anon;
grant select, insert, update on public.consents to authenticated;

create or replace function public.has_record_storage_consent()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.consents c
    where c.owner_id = auth.uid()
      and c.consent_key = 'sensitive_record_storage'
      and c.withdrawn_at is null
  );
$$;

revoke all on function public.has_record_storage_consent() from public, anon;
grant execute on function public.has_record_storage_consent() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 기록
-- ---------------------------------------------------------------------------
-- burden(버거움) 값은 임상 점수가 아니라 사용자가 고른 표현이다. 숫자로 바꾸거나 평균내지 않는다.
--   okay       괜찮은 편이에요
--   bearable   견딜 만해요
--   heavy      버거워요
--   very_heavy 많이 버거워요
--   unsure     모르겠어요
-- source(출처)
--   direct  지금 직접 입력
--   recall  지난 일을 돌아보며 입력 (occurred_at은 실제 그때, recorded_at은 입력한 때)
--   device  기기 측정 (후속 앱·워치 연동 전용. 웹 저장 함수는 받지 않는다)
create table if not exists public.checkins (
  id          uuid primary key,                       -- 클라이언트가 만든 ID (재전송 중복 방지 키)
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null,                   -- 경험한 시점
  occurred_tz text not null,                          -- 경험한 시점의 시간대 (IANA, 예: Asia/Seoul)
  recorded_at timestamptz not null,                   -- 사용자가 입력한 시점 (기기 시계)
  recorded_tz text not null,                          -- 입력한 기기의 시간대
  source      text not null check (source in ('direct', 'recall', 'device')),
  burden      text not null check (burden in ('okay', 'bearable', 'heavy', 'very_heavy', 'unsure')),
  tags        text[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now(),     -- 서버에 처음 저장된 시점
  updated_at  timestamptz not null default now(),     -- 서버에서 마지막으로 바뀐 시점
  version     integer not null default 1 check (version >= 1),  -- 충돌 확인용
  constraint checkins_tags_limit   check (cardinality(tags) <= 12),
  constraint checkins_note_length  check (note is null or char_length(note) <= 1000),
  constraint checkins_tz_length    check (char_length(occurred_tz) between 1 and 64
                                          and char_length(recorded_tz) between 1 and 64)
);

create index if not exists checkins_owner_occurred_idx on public.checkins (owner_id, occurred_at desc);

-- 화면에서 고르는 생활 항목 코드. 앱·웹이 같은 목록을 쓴다 (src/lib/checkins/model.ts 와 맞출 것).
create or replace function public.checkin_tag_allowed(p_tag text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tag in ('sleep', 'meal', 'wash', 'outside', 'work_study', 'contact', 'body', 'medication', 'rest');
$$;

create or replace function public.checkins_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tag text;
begin
  -- 시간대 이름 확인 (잘못된 이름이면 Postgres가 오류를 낸다)
  perform now() at time zone new.occurred_tz;
  perform now() at time zone new.recorded_tz;

  foreach v_tag in array new.tags loop
    if not public.checkin_tag_allowed(v_tag) then
      raise exception 'invalid_tag' using errcode = '22023';
    end if;
  end loop;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.version := 1;
  else
    -- 바뀌면 안 되는 값은 원래대로 유지
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.recorded_at := old.recorded_at;
    new.recorded_tz := old.recorded_tz;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists checkins_guard_trg on public.checkins;
create trigger checkins_guard_trg
  before insert or update on public.checkins
  for each row execute function public.checkins_guard();

alter table public.checkins enable row level security;

drop policy if exists checkins_select_own on public.checkins;
create policy checkins_select_own on public.checkins
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists checkins_insert_own on public.checkins;
create policy checkins_insert_own on public.checkins
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.has_record_storage_consent()));

drop policy if exists checkins_update_own on public.checkins;
create policy checkins_update_own on public.checkins
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select public.has_record_storage_consent()));

-- 삭제는 동의를 철회한 뒤에도 할 수 있어야 하므로 동의를 요구하지 않는다.
drop policy if exists checkins_delete_own on public.checkins;
create policy checkins_delete_own on public.checkins
  for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.checkins from anon;
grant select, insert, update, delete on public.checkins to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 저장 함수
-- ---------------------------------------------------------------------------

-- 생성: 같은 p_id로 다시 보내도 한 번만 만든다. 이미 있으면 기존 기록을 돌려준다.
-- 반환: {"created": true|false, "record": {...}}
create or replace function public.create_checkin(
  p_id          uuid,
  p_occurred_at timestamptz,
  p_occurred_tz text,
  p_recorded_at timestamptz,
  p_recorded_tz text,
  p_source      text,
  p_burden      text,
  p_tags        text[] default '{}',
  p_note        text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.checkins;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_source not in ('direct', 'recall') then
    raise exception 'source_not_allowed' using errcode = '22023';
  end if;
  if p_occurred_at > now() + interval '5 minutes' or p_recorded_at > now() + interval '5 minutes' then
    raise exception 'time_in_future' using errcode = '22023';
  end if;
  if p_occurred_at > p_recorded_at + interval '5 minutes' then
    raise exception 'occurred_after_recorded' using errcode = '22023';
  end if;

  insert into public.checkins (
    id, owner_id, occurred_at, occurred_tz, recorded_at, recorded_tz, source, burden, tags, note
  ) values (
    p_id, auth.uid(), p_occurred_at, p_occurred_tz, p_recorded_at, p_recorded_tz, p_source, p_burden,
    coalesce(p_tags, '{}'), nullif(btrim(p_note), '')
  )
  on conflict (id) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object('created', true, 'record', to_jsonb(v_row));
  end if;

  -- 이미 있는 ID: 내 기록이면 그대로 돌려준다 (재전송). 남의 기록이면 RLS 때문에 보이지 않는다.
  select * into v_row from public.checkins where id = p_id;
  if not found then
    raise exception 'id_unavailable' using errcode = '23505';
  end if;
  return jsonb_build_object('created', false, 'record', to_jsonb(v_row));
end;
$$;

-- 수정: 화면이 알고 있는 version과 서버 version이 같을 때만 바꾼다.
-- 반환: {"status": "ok"|"conflict"|"not_found", "record": {...}|null}
create or replace function public.update_checkin(
  p_id               uuid,
  p_expected_version integer,
  p_burden           text,
  p_tags             text[] default '{}',
  p_note             text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.checkins;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.checkins
     set burden = p_burden,
         tags   = coalesce(p_tags, '{}'),
         note   = nullif(btrim(p_note), '')
   where id = p_id
     and version = p_expected_version
  returning * into v_row;

  if found then
    return jsonb_build_object('status', 'ok', 'record', to_jsonb(v_row));
  end if;

  select * into v_row from public.checkins where id = p_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'record', null);
  end if;
  return jsonb_build_object('status', 'conflict', 'record', to_jsonb(v_row));
end;
$$;

-- 삭제: 화면이 알고 있는 version과 같을 때만 지운다 (다른 기기에서 바뀐 기록을 모르고 지우지 않도록).
-- 반환: {"status": "ok"|"conflict"|"not_found", "record": {...}|null}
create or replace function public.delete_checkin(
  p_id               uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.checkins;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  delete from public.checkins
   where id = p_id
     and version = p_expected_version
  returning * into v_row;

  if found then
    return jsonb_build_object('status', 'ok', 'record', null);
  end if;

  select * into v_row from public.checkins where id = p_id;
  if not found then
    return jsonb_build_object('status', 'not_found', 'record', null);
  end if;
  return jsonb_build_object('status', 'conflict', 'record', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_checkin(uuid, timestamptz, text, timestamptz, text, text, text, text[], text) from public, anon;
revoke all on function public.update_checkin(uuid, integer, text, text[], text) from public, anon;
revoke all on function public.delete_checkin(uuid, integer) from public, anon;
grant execute on function public.create_checkin(uuid, timestamptz, text, timestamptz, text, text, text, text[], text) to authenticated;
grant execute on function public.update_checkin(uuid, integer, text, text[], text) to authenticated;
grant execute on function public.delete_checkin(uuid, integer) to authenticated;
