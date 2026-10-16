-- 임시 PostgreSQL 전용. 실제 Supabase Auth API/토큰 무효화 시험이 아니다.
\set ON_ERROR_STOP 1
reset role;
do $$
declare
  c uuid := 'cccccccc-0000-4000-8000-000000000003';
  b uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  before_records integer;
  before_consents integer;
begin
  select count(*) into before_records from public.checkins where owner_id = b;
  select count(*) into before_consents from public.consents where owner_id = b;
  insert into auth.users (id, email) values (c, 'disposable-c@example.invalid');
  insert into public.consents (owner_id, consent_key, policy_version) values (c, 'sensitive_record_storage', '2026-10-07');
  perform t.as_user(c::text);
  perform public.create_checkin('33333333-0000-4000-8000-000000000003', now(), 'UTC', now(), 'UTC', 'direct', 'heavy', '{}', '폐기용 가상 C 기록');
  perform t.ok((select count(*) = 1 from public.checkins where owner_id = c), '삭제 시험 전 C 가상 기록 존재');
  -- 다른 외래 키가 삭제를 거부하면 연쇄 삭제도 되돌려져야 한다.
  create table t.deletion_blocker (owner_id uuid references auth.users(id));
  insert into t.deletion_blocker values (c);
  begin
    delete from auth.users where id = c;
    raise exception 'FAIL blocking foreign key should reject deletion';
  exception when foreign_key_violation then
    perform t.ok((select count(*) = 1 from auth.users where id = c), '삭제 실패 후 C 계정 유지');
    perform t.ok((select count(*) = 1 from public.checkins where owner_id = c), '삭제 실패 후 C 기록 유지');
    perform t.ok((select count(*) = 1 from public.consents where owner_id = c), '삭제 실패 후 C 동의 유지');
  end;
  drop table t.deletion_blocker;
  delete from auth.users where id = c;
  perform t.ok(not exists(select 1 from public.checkins where owner_id = c), 'C 계정 삭제가 C 기록에 연쇄 적용');
  perform t.ok(not exists(select 1 from public.consents where owner_id = c), 'C 계정 삭제가 C 동의에 연쇄 적용');
  perform t.ok((select count(*) = before_records from public.checkins where owner_id = b), 'C 삭제 후 B 기록 보존');
  perform t.ok((select count(*) = before_consents from public.consents where owner_id = b), 'C 삭제 후 B 동의 보존');
  perform t.fails($q$ insert into public.consents (owner_id, consent_key, policy_version) values ('cccccccc-0000-4000-8000-000000000003','sensitive_record_storage','2026-10-07') $q$, '삭제된 C의 동의 재생성은 외래 키로 거부');
end $$;
select 'ACCOUNT DELETION DATABASE TESTS PASSED' as result;
