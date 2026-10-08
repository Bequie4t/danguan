-- 당우안: 기록 쓰기는 저장 함수로만 (버전 충돌 검사를 서버 규칙으로 강제)
-- 이 파일은 기존 표·데이터를 지우거나 바꾸지 않는다. 권한과 함수 속성만 바꾼다. 다시 실행해도 안전하다.
--
-- 바꾸기 전: 로그인한 사용자(authenticated)가 checkins 표에 직접 INSERT/UPDATE/DELETE 할 수 있었다.
--   RLS 때문에 남의 기록은 못 건드리지만, 같은 사용자의 다른 클라이언트가 저장 함수를 거치지 않으면
--   버전 확인 없이 덮어쓰거나 지울 수 있었다.
-- 바꾼 뒤:
--   - authenticated는 checkins를 조회(SELECT)만 할 수 있다.
--   - 쓰기 권한은 로그인할 수 없는 전용 역할 danguan_record_writer만 갖는다.
--   - create/update/delete_checkin 함수는 이 역할 권한으로 실행된다(SECURITY DEFINER).
--   - danguan_record_writer는 authenticated 역할에 속하므로, 기존 RLS 정책(소유자·동의 검사)이 함수 안의 쓰기에도
--     그대로 적용된다. 사용자 식별은 계속 auth.uid()(호출한 사람의 로그인 토큰)로 한다.
--   - 함수는 버전이 같을 때만 수정·삭제하므로, 같은 사용자라도 버전 확인을 건너뛸 방법이 없다.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'danguan_record_writer') then
    create role danguan_record_writer nologin inherit;
  end if;
end $$;

-- 전용 역할은 authenticated의 권한·RLS 정책을 물려받는다 (RLS 정책은 "to authenticated"로 적혀 있음).
grant authenticated to danguan_record_writer;
-- 함수 소유자를 바꾸려면 현재 사용자가 이 역할로 전환할 수 있어야 한다.
grant danguan_record_writer to current_user;
-- 함수 소유자는 함수가 있는 스키마에 CREATE 권한이 필요하다 (PostgreSQL 규칙). 역할은 로그인할 수 없다.
grant usage, create on schema public to danguan_record_writer;

-- 쓰기 권한: 전용 역할에만
grant select, insert, update, delete on public.checkins to danguan_record_writer;
revoke insert, update, delete, truncate on public.checkins from authenticated;
revoke all on public.checkins from anon;

-- 저장 함수: 전용 역할 권한으로 실행
alter function public.create_checkin(uuid, timestamptz, text, timestamptz, text, text, text, text[], text) security definer;
alter function public.update_checkin(uuid, integer, text, text[], text) security definer;
alter function public.delete_checkin(uuid, integer) security definer;
alter function public.create_checkin(uuid, timestamptz, text, timestamptz, text, text, text, text[], text) owner to danguan_record_writer;
alter function public.update_checkin(uuid, integer, text, text[], text) owner to danguan_record_writer;
alter function public.delete_checkin(uuid, integer) owner to danguan_record_writer;

-- 호출 권한: 로그인한 사용자만
revoke all on function public.create_checkin(uuid, timestamptz, text, timestamptz, text, text, text, text[], text) from public, anon;
revoke all on function public.update_checkin(uuid, integer, text, text[], text) from public, anon;
revoke all on function public.delete_checkin(uuid, integer) from public, anon;
grant execute on function public.create_checkin(uuid, timestamptz, text, timestamptz, text, text, text, text[], text) to authenticated;
grant execute on function public.update_checkin(uuid, integer, text, text[], text) to authenticated;
grant execute on function public.delete_checkin(uuid, integer) to authenticated;
