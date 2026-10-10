-- 당우안 실제 DB 검증 스크립트 (누구나 다시 실행해 볼 수 있음)
-- 사용법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run.
-- 가상 사용자 A/B를 만들어 시험한 뒤, 마지막에 일부러 오류를 내서 모든 변경을 되돌린다 (데이터가 남지 않음).
-- 결과는 오류 메시지 "RESULTS(rolled back): ..." 안에 PASS/FAIL 목록으로 나온다. FAIL이 하나도 없어야 한다.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  rid uuid := gen_random_uuid();
  rid2 uuid := gen_random_uuid();
  r jsonb; n int; out text := '';
begin
  insert into auth.users (id, email, aud, role) values
    (a, 'virtual-a@test.invalid', 'authenticated', 'authenticated'),
    (b, 'virtual-b@test.invalid', 'authenticated', 'authenticated');

  -- ===== A =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.create_checkin(rid, now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', '{}', null);
    out := out || 'FAIL no-consent; ';
  exception when others then out := out || 'PASS no-consent-blocked(' || sqlstate || '); ';
  end;
  insert into public.consents (consent_key, policy_version) values ('sensitive_record_storage', '2026-10-07');

  r := public.create_checkin(rid, now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', array['sleep'], '원래 메모');
  out := out || case when (r->>'created')::boolean then 'PASS A-create; ' else 'FAIL A-create; ' end;

  -- 응답 유실 후 재확인: 원래 내용 그대로 다시 보내면 기존 기록(version 1)
  r := public.create_checkin(rid, now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'heavy', array['sleep'], '원래 메모');
  select count(*) into n from public.checkins;
  out := out || case when not (r->>'created')::boolean and (r->'record'->>'version')::int = 1 and n = 1 then 'PASS resend-no-duplicate; ' else 'FAIL resend; ' end;
  -- 바뀐 입력은 version 검사로 수정
  r := public.update_checkin(rid, 1, 'okay', '{}', '바뀐 메모');
  out := out || case when r->>'status'='ok' and r->'record'->>'note'='바뀐 메모' and (r->'record'->>'version')::int = 2 then 'PASS changed-input-updated-v2; ' else 'FAIL changed-input ' || r::text || '; ' end;
  -- 옛 version 수정·삭제는 충돌
  r := public.update_checkin(rid, 1, 'heavy', '{}', '옛 기기');
  out := out || case when r->>'status'='conflict' and r->'record'->>'note'='바뀐 메모' then 'PASS stale-update-conflict; ' else 'FAIL stale-update; ' end;
  r := public.delete_checkin(rid, 1);
  out := out || case when r->>'status'='conflict' then 'PASS stale-delete-conflict; ' else 'FAIL stale-delete; ' end;

  -- 같은 사용자의 직접 쓰기도 막힘 (버전 확인 우회 불가)
  begin
    update public.checkins set note = '직접 수정' where id = rid;
    out := out || 'FAIL A-direct-update-allowed; ';
  exception when others then out := out || 'PASS A-direct-update-denied(' || sqlstate || '); ';
  end;
  begin
    delete from public.checkins where id = rid;
    out := out || 'FAIL A-direct-delete-allowed; ';
  exception when others then out := out || 'PASS A-direct-delete-denied(' || sqlstate || '); ';
  end;
  begin
    insert into public.checkins (id, occurred_at, occurred_tz, recorded_at, recorded_tz, source, burden)
      values (rid2, now(), 'UTC', now(), 'UTC', 'direct', 'okay');
    out := out || 'FAIL A-direct-insert-allowed; ';
  exception when others then out := out || 'PASS A-direct-insert-denied(' || sqlstate || '); ';
  end;
  select count(*) into n from public.checkins where id = rid and version = 2 and note = '바뀐 메모';
  out := out || case when n = 1 then 'PASS record-unchanged-after-direct-attempts; ' else 'FAIL record-changed; ' end;

  -- ===== B =====
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.consents (consent_key, policy_version) values ('sensitive_record_storage', '2026-10-07');
  select count(*) into n from public.checkins;
  out := out || case when n = 0 then 'PASS B-cannot-read-A; ' else 'FAIL B-read; ' end;
  r := public.update_checkin(rid, 2, 'okay', '{}', 'B');
  out := out || case when r->>'status'='not_found' then 'PASS B-cannot-update-A; ' else 'FAIL B-update; ' end;
  r := public.delete_checkin(rid, 2);
  out := out || case when r->>'status'='not_found' then 'PASS B-cannot-delete-A; ' else 'FAIL B-delete; ' end;
  begin
    perform public.create_checkin(rid, now(), 'Asia/Seoul', now(), 'Asia/Seoul', 'direct', 'okay', '{}', null);
    out := out || 'FAIL B-took-A-id; ';
  exception when others then out := out || 'PASS B-cannot-take-A-id(' || sqlstate || '); ';
  end;
  begin
    insert into public.checkins (id, owner_id, occurred_at, occurred_tz, recorded_at, recorded_tz, source, burden)
      values (rid2, a, now(), 'UTC', now(), 'UTC', 'direct', 'okay');
    out := out || 'FAIL B-insert-as-A; ';
  exception when others then out := out || 'PASS B-cannot-insert-as-A(' || sqlstate || '); ';
  end;

  -- ===== A: 최신 version 삭제 =====
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.delete_checkin(rid, 2);
  select count(*) into n from public.checkins;
  out := out || case when r->>'status'='ok' and n = 0 then 'PASS A-delete-latest; ' else 'FAIL A-delete; ' end;

  -- ===== 비로그인 =====
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    select count(*) into n from public.checkins;
    out := out || 'FAIL anon-read-allowed; ';
  exception when others then out := out || 'PASS anon-read-denied(' || sqlstate || '); ';
  end;
  begin
    perform public.create_checkin(gen_random_uuid(), now(), 'UTC', now(), 'UTC', 'direct', 'okay', '{}', null);
    out := out || 'FAIL anon-create; ';
  exception when others then out := out || 'PASS anon-create-denied(' || sqlstate || '); ';
  end;
  reset role;

  -- ===== 권한 구조 =====
  out := out || case when not has_table_privilege('authenticated', 'public.checkins', 'UPDATE')
                      and not has_table_privilege('authenticated', 'public.checkins', 'DELETE')
                      and not has_table_privilege('authenticated', 'public.checkins', 'INSERT')
                 then 'PASS authenticated-select-only; ' else 'FAIL authenticated-can-write; ' end;

  raise exception 'RESULTS(rolled back): %', out;
end $$;
