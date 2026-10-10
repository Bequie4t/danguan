-- 로컬 검증: 가상 사용자 A/B와 가상 기록만 사용한다. 실제 건강 기록 없음.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- 테스트 도우미 (관리자 권한으로 생성)
create schema if not exists t;
create or replace function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
-- 예상한 오류가 실제로 나는지 확인: sql 실행이 실패해야 PASS
create or replace function t.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'PASS: % (오류: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (오류가 나야 하는데 성공함)', msg;
end $$;
create or replace function t.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

-- 가상 사용자
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'test-a@example.invalid'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'test-b@example.invalid');

-- ======================================================================
-- 사용자 A
-- ======================================================================
set role authenticated;
select t.as_user('aaaaaaaa-0000-4000-8000-000000000001');

-- 1. 동의 전에는 저장할 수 없다
select t.fails($q$
  select public.create_checkin('11111111-0000-4000-8000-000000000001', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy')
$q$, '동의 전 기록 생성 거부');

-- 2. 동의
insert into public.consents (consent_key, policy_version) values ('sensitive_record_storage', '2026-10-07');
select t.ok(public.has_record_storage_consent(), 'A 동의 저장됨');

-- 3. 한 번 선택(버거움만)으로 기록 생성
select t.ok(
  (public.create_checkin('11111111-0000-4000-8000-000000000001', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') ->> 'created')::boolean,
  '버거움 하나만으로 기록 생성 (태그·메모 없음)');

-- 4. 같은 ID 재전송 → 새로 만들지 않고 기존 기록 반환
select t.ok(
  (public.create_checkin('11111111-0000-4000-8000-000000000001', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') ->> 'created')::boolean = false,
  '같은 ID 재전송 시 created=false');
select t.ok((select count(*) from public.checkins where id = '11111111-0000-4000-8000-000000000001') = 1, '재전송 후에도 기록 1개');

-- 5. 회상 입력: 경험 시점과 입력 시점이 구분되어 저장
select public.create_checkin('11111111-0000-4000-8000-000000000002',
  now() - interval '2 days', 'Asia/Seoul', now(), 'Asia/Seoul', 'recall', 'very_heavy',
  array['sleep','meal'], '  가상 메모: 잠을 거의 못 잤음  ');
select t.ok((select source = 'recall' and occurred_at < recorded_at - interval '1 day'
             and note = '가상 메모: 잠을 거의 못 잤음' and tags = array['sleep','meal']
             from public.checkins where id = '11111111-0000-4000-8000-000000000002'),
  '회상 기록: 출처·경험 시점·태그·메모(앞뒤 공백 제거) 저장');

-- 6. 잘못된 입력 거부
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'device', 'heavy') $q$, '웹 저장 함수는 기기 측정 출처 거부');
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', '7') $q$, '정해지지 않은 버거움 값 거부');
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Mars/Base', now(), 'Asia/Seoul', 'direct', 'heavy') $q$, '잘못된 시간대 거부');
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now() + interval '1 day', 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') $q$, '미래 시점 거부');
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', array['unknown_tag']) $q$, '정해지지 않은 태그 거부');
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', '{}', repeat('가', 1001)) $q$, '1000자 넘는 메모 거부');

-- 7. 수정: 같은 version이면 성공, version 증가
select t.ok(
  (select (r ->> 'status') = 'ok' and (r -> 'record' ->> 'version')::int = 2
   from (select public.update_checkin('11111111-0000-4000-8000-000000000001', 1, 'bearable', array['rest'], '기기 1에서 수정') as r) s),
  '최신 version으로 수정 성공, version 1→2');

-- 8. 다른 기기가 옛 version(1)으로 수정 → 충돌, 덮어쓰지 않음
select t.ok(
  (select (r ->> 'status') = 'conflict' and (r -> 'record' ->> 'note') = '기기 1에서 수정'
   from (select public.update_checkin('11111111-0000-4000-8000-000000000001', 1, 'okay', '{}', '기기 2의 오래된 수정') as r) s),
  '옛 version 수정은 conflict 반환, 서버 내용 반환');
select t.ok((select note = '기기 1에서 수정' and burden = 'bearable' and version = 2
             from public.checkins where id = '11111111-0000-4000-8000-000000000001'),
  '충돌 후에도 서버 기록은 그대로');

-- 9. 같은 사용자라도 표에 직접 쓰기는 막힌다 (버전 확인을 건너뛸 수 없음, 20261008 마이그레이션)
select t.fails($q$ update public.checkins set note = 'A 직접 수정', burden = 'okay' where id = '11111111-0000-4000-8000-000000000001' $q$,
  'A의 자기 기록 직접 UPDATE 거부 (버전 확인 우회 불가)');
select t.fails($q$ delete from public.checkins where id = '11111111-0000-4000-8000-000000000001' $q$,
  'A의 자기 기록 직접 DELETE 거부 (버전 확인 우회 불가)');
select t.fails($q$ insert into public.checkins (id, occurred_at, occurred_tz, recorded_at, recorded_tz, source, burden)
  values (gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') $q$,
  'A의 직접 INSERT 거부 (저장 함수로만 생성)');
select t.ok((select note = '기기 1에서 수정' and version = 2 from public.checkins where id = '11111111-0000-4000-8000-000000000001'),
  '직접 쓰기 시도 후에도 기록·버전 그대로');

-- 9-1. 저장 성공 → 응답 유실 → 입력 변경 → 재시도
--   클라이언트는 같은 ID에 원래 내용을 다시 보내 저장 여부를 확인하고, 바뀐 입력은 버전 검사를 거쳐 수정한다.
select public.create_checkin('11111111-0000-4000-8000-000000000009', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', '{}', '원래 메모');
--   (응답 유실) 사용자가 메모를 바꾼 뒤 재시도: 먼저 원래 내용으로 재확인 → 이미 있음
select t.ok((select (r ->> 'created')::boolean = false and (r -> 'record' ->> 'note') = '원래 메모' and (r -> 'record' ->> 'version')::int = 1
             from (select public.create_checkin('11111111-0000-4000-8000-000000000009', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', '{}', '원래 메모') as r) s),
  '재확인: 이미 저장된 원래 기록(version 1)을 돌려줌');
--   바뀐 입력을 같은 ID로 다시 생성하려 해도 서버는 덮어쓰지 않는다 (클라이언트가 이 응답만 믿으면 안 되는 이유)
select t.ok((select (r -> 'record' ->> 'note') = '원래 메모'
             from (select public.create_checkin('11111111-0000-4000-8000-000000000009', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'okay', '{}', '바뀐 메모') as r) s),
  '같은 ID로 다른 내용 생성 요청은 원래 기록을 돌려줌 (내용이 바뀌지 않음)');
--   그래서 바뀐 입력은 확인한 version으로 수정한다
select t.ok((select (r ->> 'status') = 'ok' and (r -> 'record' ->> 'note') = '바뀐 메모' and (r -> 'record' ->> 'burden') = 'okay' and (r -> 'record' ->> 'version')::int = 2
             from (select public.update_checkin('11111111-0000-4000-8000-000000000009', 1, 'okay', '{}', '바뀐 메모') as r) s),
  '바뀐 입력은 version 1 확인 후 수정되어 version 2');
select t.ok((select count(*) from public.checkins where id = '11111111-0000-4000-8000-000000000009') = 1, '재시도 흐름 후에도 기록 1개');
select t.ok((public.delete_checkin('11111111-0000-4000-8000-000000000009', 2) ->> 'status') = 'ok', '재시도 시험 기록 정리');

-- 10. 삭제: 옛 version이면 충돌
select t.ok((public.delete_checkin('11111111-0000-4000-8000-000000000001', 1) ->> 'status') = 'conflict', '옛 version 삭제는 conflict');
select t.ok((select count(*) from public.checkins where id = '11111111-0000-4000-8000-000000000001') = 1, '충돌 삭제 후에도 기록 유지');

-- 11. 사용자 B가 쓸 기록 하나 더 (A 소유)
select public.create_checkin('11111111-0000-4000-8000-000000000003', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'okay');

-- ======================================================================
-- 사용자 B
-- ======================================================================
select t.as_user('bbbbbbbb-0000-4000-8000-000000000002');
insert into public.consents (consent_key, policy_version) values ('sensitive_record_storage', '2026-10-07');

select t.ok((select count(*) from public.checkins) = 0, 'B는 A의 기록을 조회할 수 없음 (목록 0개)');
select t.ok((select count(*) from public.checkins where id = '11111111-0000-4000-8000-000000000003') = 0, 'B는 A 기록 ID로도 조회 불가');
select t.ok((select count(*) from public.consents) = 1, 'B는 자신의 동의만 보임');

select t.fails($q$ select public.create_checkin('11111111-0000-4000-8000-000000000003', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') $q$,
  'B가 A 기록 ID로 생성 시도 → 거부');
select t.fails($q$ insert into public.checkins (id, owner_id, occurred_at, occurred_tz, recorded_at, recorded_tz, source, burden)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') $q$,
  'B가 A 명의로 직접 INSERT → 거부');

select t.ok((public.update_checkin('11111111-0000-4000-8000-000000000003', 1, 'heavy', '{}', 'B의 수정') ->> 'status') = 'not_found', 'B의 A 기록 수정 → not_found');
select t.ok((public.delete_checkin('11111111-0000-4000-8000-000000000003', 1) ->> 'status') = 'not_found', 'B의 A 기록 삭제 → not_found');

select t.fails($q$ update public.checkins set note = 'B 직접 수정' where id = '11111111-0000-4000-8000-000000000003' $q$, 'B의 직접 UPDATE 거부');
select t.fails($q$ delete from public.checkins where id = '11111111-0000-4000-8000-000000000003' $q$, 'B의 직접 DELETE 거부');

-- ======================================================================
-- 로그아웃 상태(anon)
-- ======================================================================
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select t.fails($q$ select count(*) from public.checkins $q$, '로그아웃(anon) 상태 기록 조회 거부');
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') $q$, '로그아웃(anon) 상태 저장 함수 거부');

-- 로그인했지만 토큰에 사용자가 없는 경우
reset role;
set role authenticated;
select t.ok((select count(*) from public.checkins) = 0, '사용자 정보 없는 세션은 아무 기록도 못 봄');

-- ======================================================================
-- A로 돌아와 확인
-- ======================================================================
select t.as_user('aaaaaaaa-0000-4000-8000-000000000001');
select t.ok((select count(*) from public.checkins) = 3, 'A의 기록 3개 그대로 (B 시도에 영향 없음)');
select t.ok((select note is null from public.checkins where id = '11111111-0000-4000-8000-000000000003'), 'A 기록이 B에 의해 바뀌지 않음');
select t.ok((public.delete_checkin('11111111-0000-4000-8000-000000000003', 1) ->> 'status') = 'ok', 'A는 최신 version으로 삭제 성공');

-- 동의 철회 후: 새 저장은 막히고, 조회·삭제는 가능
update public.consents set withdrawn_at = now();
select t.fails($q$ select public.create_checkin(gen_random_uuid(), now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy') $q$, '동의 철회 후 새 기록 거부');
select t.ok((select count(*) from public.checkins) = 2, '동의 철회 후에도 내 기록 조회 가능');
select t.ok((public.delete_checkin('11111111-0000-4000-8000-000000000002', 1) ->> 'status') = 'ok', '동의 철회 후에도 내 기록 삭제 가능');

-- 권한 구조 확인
reset role;
select t.ok(not has_table_privilege('authenticated', 'public.checkins', 'INSERT')
        and not has_table_privilege('authenticated', 'public.checkins', 'UPDATE')
        and not has_table_privilege('authenticated', 'public.checkins', 'DELETE')
        and has_table_privilege('authenticated', 'public.checkins', 'SELECT'), 'authenticated는 checkins 조회만 가능');
select t.ok((select bool_and(p.prosecdef and pg_get_userbyid(p.proowner) = 'danguan_record_writer')
             from pg_proc p where p.proname in ('create_checkin','update_checkin','delete_checkin') and p.pronamespace = 'public'::regnamespace),
  '저장 함수 3개는 전용 역할 권한으로 실행');
select t.ok((select not rolcanlogin from pg_roles where rolname = 'danguan_record_writer'), '전용 역할은 로그인 불가');
select 'ALL DATABASE TESTS PASSED' as result;
