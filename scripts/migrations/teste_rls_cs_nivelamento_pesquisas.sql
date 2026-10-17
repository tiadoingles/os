-- Teste de RLS de cs_nivelamento, cs_pesquisa_respostas, RPCs cs_*_substituir / cs_pesquisa_painel e das
-- chaves novas do sync_status (migrations 20261017_cs_nivelamento e 20261017_cs_pesquisa_respostas).
-- Mesmo esquema do teste_rls_areas.sql: tudo numa transação implícita que termina em RAISE EXCEPTION
-- (rollback; a mensagem de erro traz os resultados). NÃO colocar BEGIN/COMMIT. Usuários fictícios sem senha.
-- Esperado (17/10/2026): ADM e {cs} leem tudo das duas tabelas e as 2 chaves novas; {conteudo}, sem aba e
-- anon não leem nada; ninguém (nem ADM) grava pela API nem chama as RPCs *_substituir (só service_role).
-- Depois conferir: select count(*) from auth.users where email like 'zz-%'; => 0
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', e, now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,'zz-admin@invalid.test'),('aaaaaaaa-0000-0000-0000-0000000000c5'::uuid,'zz-cs@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,'zz-conteudo@invalid.test'),('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid,'zz-semaba@invalid.test')) v(id,e);
update public.profiles set role='admin', areas='{}' where id='aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set role='equipe', areas='{cs}' where id='aaaaaaaa-0000-0000-0000-0000000000c5';
update public.profiles set role='equipe', areas='{conteudo}' where id='aaaaaaaa-0000-0000-0000-0000000000d1';
update public.profiles set role='equipe', areas='{}' where id='aaaaaaaa-0000-0000-0000-0000000000b1';
create table public.t_res(n serial, caso text, resultado text);
grant all on public.t_res to authenticated, anon; grant usage on sequence public.t_res_n_seq to authenticated, anon;
create function public.t_run(p_user uuid, p_caso text, p_sql text, p_mode text default 'dml') returns void language plpgsql as $f$
declare n bigint; r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{"role":"anon"}' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if p_mode = 'val' then execute p_sql into n; r := 'val=' || coalesce(n::text,'null');
    else execute p_sql; get diagnostics n = row_count; r := 'rows=' || n; end if;
  exception when others then r := 'ERRO[' || sqlstate || '] ' || left(sqlerrm, 60);
  end;
  reset role;
  insert into public.t_res(caso, resultado) values (p_caso, r);
end $f$;
do $t$ declare u record; begin
  insert into t_res(caso,resultado) select 'TOTAL cs_nivelamento', count(*)::text from cs_nivelamento;
  insert into t_res(caso,resultado) select 'TOTAL cs_pesquisa_respostas', count(*)::text from cs_pesquisa_respostas;
  for u in select * from (values ('admin','aaaaaaaa-0000-0000-0000-0000000000a1'::uuid),('cs','aaaaaaaa-0000-0000-0000-0000000000c5'::uuid),('conteudo','aaaaaaaa-0000-0000-0000-0000000000d1'::uuid),('sem aba','aaaaaaaa-0000-0000-0000-0000000000b1'::uuid),('anon',null::uuid)) x(nm,id) loop
    perform t_run(u.id, u.nm||' select cs_nivelamento', 'select count(*) from public.cs_nivelamento', 'val');
    perform t_run(u.id, u.nm||' select cs_pesquisa_respostas', 'select count(*) from public.cs_pesquisa_respostas', 'val');
    perform t_run(u.id, u.nm||' rpc cs_pesquisa_painel (pesquisas vistas)', 'select jsonb_array_length(public.cs_pesquisa_painel())', 'val');
    perform t_run(u.id, u.nm||' sync_status chaves novas', $q$select count(*) from public.sync_status where chave in ('nivelamento-planilha','pesquisas-respostas')$q$, 'val');
    perform t_run(u.id, u.nm||' sync_status outras chaves (fora do cs)', $q$select count(*) from public.sync_status where chave not in ('metas-planilha','mentorados-planilha','teste-vac-planilha','nivelamento-planilha','pesquisas-respostas')$q$, 'val');
    perform t_run(u.id, u.nm||' update cs_nivelamento (NEGADO)', $q$update public.cs_nivelamento set nome=nome$q$);
    perform t_run(u.id, u.nm||' delete cs_pesquisa_respostas (NEGADO)', $q$delete from public.cs_pesquisa_respostas$q$);
    perform t_run(u.id, u.nm||' rpc cs_nivelamento_substituir (NEGADO)', $q$select public.cs_nivelamento_substituir('[]'::jsonb)$q$, 'val');
    perform t_run(u.id, u.nm||' rpc cs_pesquisa_substituir (NEGADO)', $q$select 1 from (select public.cs_pesquisa_substituir('[]'::jsonb)) x$q$, 'val');
  end loop;
end $t$;
do $r$ begin raise exception E'RESULTADOS\n%', (select string_agg(caso||' => '||resultado, E'\n' order by n) from public.t_res); end $r$;
