-- =====================================================================
-- Guard against UPDATE or DELETE without WHERE inside functions.
--
-- PostgREST sessions (role authenticator) preload `pg-safeupdate`, which
-- rejects any UPDATE or DELETE without a WHERE clause, even inside a
-- security definer function. pgTAP runs as postgres without it, and the
-- test role cannot LOAD the library, so such a function passes every
-- other test and only fails from the app ("UPDATE requires a WHERE
-- clause"). This test scans every SQL and PL/pgSQL function in public.
-- Single-row tables still need a WHERE (for example `where id`).
-- Runs with `supabase test db`.
-- =====================================================================

begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select is_empty(
  $q$
    with f as (
      select p.oid::regprocedure::text as fn,
             regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and l.lanname in ('plpgsql', 'sql')
    ), s as (
      select fn, btrim(regexp_replace(stmt, '\s+', ' ', 'g')) as stmt
      from f, regexp_split_to_table(f.src, ';') as stmt
    )
    select fn || ': ' || left(stmt, 120)
    from s
    where stmt ~* '(^|\s)(update\s+\S+\s+(\S+\s+)?set|delete\s+from)\s'
      and stmt !~* '\mwhere\M'
  $q$,
  'No function in public runs UPDATE or DELETE without WHERE (pg-safeupdate rejects it through PostgREST)'
);

select * from finish();
rollback;
