-- Teste de RLS de public.arena_regras (e escrita em materiais_pedidos) — migration 20261016_arenas_previa_regras.
-- Mesmo padrão de teste_rls_cs.sql: tudo numa transação implícita que termina em RAISE EXCEPTION
-- (o Postgres desfaz usuários fictícios, linhas e a tabela de resultados). NÃO colocar BEGIN/COMMIT.
-- Depois conferir: select count(*) from auth.users where email like 'zz-%'; => 0
-- e select count(*) from public.arena_regras where texto like 'ZZ%'; => 0.
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', e, now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
 ('aaaaaaaa-0000-0000-0000-0000000000c5'::uuid,'zz-cs@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,'zz-editor@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,'zz-admin@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid,'zz-leitor@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000f1'::uuid,'zz-limitado@invalid.test')) v(id,e);
update public.profiles set role='cs' where id='aaaaaaaa-0000-0000-0000-0000000000c5';
update public.profiles set role='editor' where id='aaaaaaaa-0000-0000-0000-0000000000e1';
update public.profiles set role='admin' where id='aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set role='editor', acesso_limitado=true where id='aaaaaaaa-0000-0000-0000-0000000000f1';

create table public.t_res(n serial, caso text, resultado text);
grant all on public.t_res to authenticated, anon;
grant usage on sequence public.t_res_n_seq to authenticated, anon;

create function public.t_run(p_user uuid, p_caso text, p_sql text, p_mode text default 'dml')
returns void language plpgsql as $f$
declare n bigint; r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{"role":"anon"}' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if p_mode = 'val' then execute p_sql into n; r := 'val=' || coalesce(n::text,'null');
    else execute p_sql; get diagnostics n = row_count; r := 'rows=' || n; end if;
  exception when others then r := 'ERRO[' || sqlstate || '] ' || left(sqlerrm, 70);
  end;
  reset role;
  insert into public.t_res(caso, resultado) values (p_caso, r);
end $f$;

do $t$
declare u record;
begin
  insert into public.t_res(caso,resultado) select 'arena_regras | total', count(*)::text from public.arena_regras;
  for u in select * from (values ('cs','aaaaaaaa-0000-0000-0000-0000000000c5'::uuid),('editor','aaaaaaaa-0000-0000-0000-0000000000e1'::uuid),('admin','aaaaaaaa-0000-0000-0000-0000000000a1'::uuid),('leitor','aaaaaaaa-0000-0000-0000-0000000000b1'::uuid),('limitado','aaaaaaaa-0000-0000-0000-0000000000f1'::uuid),('anon',null::uuid)) x(nm,id) loop
    perform public.t_run(u.id, 'select | '||u.nm, 'select count(*) from public.arena_regras', 'val');
    perform public.t_run(u.id, 'insert aprendida | '||u.nm, $q$insert into public.arena_regras(texto, origem, pendente_skill) values ('ZZ regra teste', 'aprendida', true)$q$);
    perform public.t_run(u.id, 'insert base | '||u.nm, $q$insert into public.arena_regras(texto, origem) values ('ZZ base falsa', 'base')$q$);
    perform public.t_run(u.id, 'desligar base | '||u.nm, $q$update public.arena_regras set ativa=false where origem='base'$q$);
    perform public.t_run(u.id, 'aprendida->base | '||u.nm, $q$update public.arena_regras set origem='base' where texto like 'ZZ%'$q$);
    perform public.t_run(u.id, 'desligar aprendida | '||u.nm, $q$update public.arena_regras set ativa=false where texto like 'ZZ%'$q$);
    perform public.t_run(u.id, 'delete base | '||u.nm, $q$delete from public.arena_regras where origem='base'$q$);
    perform public.t_run(u.id, 'insert pedido status previa | '||u.nm, $q$insert into public.materiais_pedidos(tema, status, conteudo) values ('ZZ tema', 'gerando_previa', '[]')$q$);
    perform public.t_run(u.id, 'delete aprendida | '||u.nm, $q$delete from public.arena_regras where texto like 'ZZ%'$q$);
  end loop;
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000e1', 'status invalido | editor', $q$insert into public.materiais_pedidos(tema, status) values ('ZZ tema', 'qualquer')$q$);
end $t$;

-- RESULTADOS (força o rollback de tudo)
do $r$ declare s text; begin
  select string_agg(caso || ' => ' || resultado, E'\n' order by n) into s from public.t_res;
  raise exception E'RESULTADOS\n%', s;
end $r$;
