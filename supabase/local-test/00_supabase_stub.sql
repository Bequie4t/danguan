-- 로컬 검증 전용: Supabase가 기본으로 제공하는 역할·auth 스키마를 흉내 낸다.
-- 실제 Supabase 프로젝트에는 절대 실행하지 않는다.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);

-- Supabase의 auth.uid()와 같은 방식으로 JWT 클레임의 sub를 읽는다.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase 기본값처럼 public의 새 테이블 권한을 anon/authenticated에도 열어 둔다 (RLS가 막는지 확인하기 위해)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
