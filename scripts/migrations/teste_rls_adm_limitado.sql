-- Teste de RLS do ADM limitado e da troca de senha obrigatória (migration 20261016_troca_senha_e_adm_limitado).
-- Mesmo esquema do teste_rls_cs.sql: tudo numa transação implícita que termina em RAISE EXCEPTION
-- (o Postgres desfaz tudo; a mensagem de erro traz os resultados). NÃO colocar BEGIN/COMMIT.
-- Usuários fictícios zz-*@invalid.test, SEM senha (encrypted_password nulo/fictício), nunca autenticam.
-- Depois conferir: select count(*) from auth.users where email like 'zz-%'; => 0
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', e, now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
 ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,'zz-admin@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000e1'::uuid,'zz-editor@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000f1'::uuid,'zz-limitado@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid,'zz-leitor@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000c5'::uuid,'zz-cs@invalid.test')) v(id,e);
update public.profiles set role='admin' where id='aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set role='editor', precisa_trocar_senha=true where id='aaaaaaaa-0000-0000-0000-0000000000e1';
update public.profiles set role='editor', acesso_limitado=true, precisa_trocar_senha=true where id='aaaaaaaa-0000-0000-0000-0000000000f1';
update public.profiles set role='cs' where id='aaaaaaaa-0000-0000-0000-0000000000c5';

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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.t_res(caso, resultado) values (p_caso, r);
end $f$;

do $t$
declare
  ad uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  ed uuid := 'aaaaaaaa-0000-0000-0000-0000000000e1';
  li uuid := 'aaaaaaaa-0000-0000-0000-0000000000f1';
  le uuid := 'aaaaaaaa-0000-0000-0000-0000000000b1';
  cs uuid := 'aaaaaaaa-0000-0000-0000-0000000000c5';
  sec uuid := (select id from public.kb_sections order by ordem limit 1);
  doc uuid := (select id from public.kb_documents order by created_at limit 1);
  ag text := (select slug from public.os_squad_agentes limit 1);
  fe uuid := (select id from public.os_ferramentas limit 1);
  r text;
begin
  -- helpers
  perform public.t_run(li,'limitado app.is_editor() (sim)',$q$select app.is_editor()::int$q$,'val');
  perform public.t_run(li,'limitado app.is_admin() (nao)',$q$select app.is_admin()::int$q$,'val');
  perform public.t_run(li,'limitado app.is_editor_estrutura() (nao)',$q$select app.is_editor_estrutura()::int$q$,'val');
  perform public.t_run(ed,'editor app.is_editor_estrutura() (sim)',$q$select app.is_editor_estrutura()::int$q$,'val');
  perform public.t_run(ad,'admin app.is_editor_estrutura() (sim)',$q$select app.is_editor_estrutura()::int$q$,'val');
  -- Uso do dia a dia: permitido ao limitado
  perform public.t_run(li,'limitado insert agenda_eventos (permitido)',$q$insert into public.agenda_eventos(data,titulo) values (current_date,'zz')$q$);
  perform public.t_run(li,'limitado insert livros_envios (permitido)',$q$insert into public.livros_envios(nome) values ('ZZ')$q$);
  perform public.t_run(li,'limitado insert kb_documents (permitido)',format($q$insert into public.kb_documents(section_id,titulo) values (%L,'zz')$q$, sec));
  perform public.t_run(li,'limitado update kb_documents (permitido)',format($q$update public.kb_documents set titulo=titulo where id=%L$q$, doc));
  perform public.t_run(li,'limitado update farol_config (permitido)',$q$update public.farol_config set semanas=semanas$q$);
  perform public.t_run(li,'limitado update automacao_estado (permitido)',$q$update public.automacao_estado set pausado=pausado$q$);
  -- Estrutura: negado ao limitado
  perform public.t_run(li,'limitado delete kb_documents (NEGADO: 0)',format($q$delete from public.kb_documents where id=%L$q$, doc));
  perform public.t_run(li,'limitado delete kb_document_versions (NEGADO: 0)',format($q$delete from public.kb_document_versions where document_id=%L$q$, doc));
  perform public.t_run(li,'limitado delete kb_sections (NEGADO: 0)',format($q$delete from public.kb_sections where id=%L$q$, sec));
  perform public.t_run(li,'limitado insert kb_sections (NEGADO)',$q$insert into public.kb_sections(slug,nome) values ('zz','zz')$q$);
  perform public.t_run(li,'limitado update kb_sections (NEGADO: 0)',format($q$update public.kb_sections set nome=nome where id=%L$q$, sec));
  perform public.t_run(li,'limitado insert os_ferramentas (NEGADO)',$q$insert into public.os_ferramentas(slug,nome) values ('zz','zz')$q$);
  perform public.t_run(li,'limitado update os_ferramentas (NEGADO: 0)',format($q$update public.os_ferramentas set nome=nome where id=%L$q$, fe));
  perform public.t_run(li,'limitado delete os_ferramentas (NEGADO: 0)',format($q$delete from public.os_ferramentas where id=%L$q$, fe));
  perform public.t_run(li,'limitado update os_squad_agentes (NEGADO: 0)',format($q$update public.os_squad_agentes set nome=nome where slug=%L$q$, ag));
  perform public.t_run(li,'limitado insert os_squad_agentes (NEGADO)',$q$insert into public.os_squad_agentes(slug,nome) values ('zz','zz')$q$);
  perform public.t_run(li,'limitado select app_config (NEGADO: 0)',$q$select count(*) from public.app_config$q$,'val');
  perform public.t_run(li,'limitado update app_config (NEGADO: 0)',$q$update public.app_config set chave=chave$q$);
  -- Perfis / papéis
  perform public.t_run(li,'limitado vira admin (NEGADO)',format($q$update public.profiles set role='admin' where id=%L$q$, li));
  perform public.t_run(li,'limitado desliga acesso_limitado (NEGADO)',format($q$update public.profiles set acesso_limitado=false where id=%L$q$, li));
  perform public.t_run(li,'limitado desliga precisa_trocar_senha sem trocar (NEGADO)',format($q$update public.profiles set precisa_trocar_senha=false where id=%L$q$, li));
  perform public.t_run(li,'limitado update nome proprio (permitido)',format($q$update public.profiles set nome='ZZ' where id=%L$q$, li));
  perform public.t_run(li,'limitado update perfil de outro (NEGADO: 0)',format($q$update public.profiles set precisa_trocar_senha=true where id=%L$q$, le));
  perform public.t_run(ed,'editor desliga precisa_trocar_senha sem trocar (NEGADO)',format($q$update public.profiles set precisa_trocar_senha=false where id=%L$q$, ed));
  perform public.t_run(le,'leitor liga precisa_trocar_senha de outro (NEGADO: 0)',format($q$update public.profiles set precisa_trocar_senha=true where id=%L$q$, ed));
  perform public.t_run(cs,'cs liga acesso_limitado em si (NEGADO)',format($q$update public.profiles set acesso_limitado=true where id=%L$q$, cs));
  -- Editor / admin / cs continuam como antes
  perform public.t_run(ed,'editor update kb_sections (permitido)',format($q$update public.kb_sections set nome=nome where id=%L$q$, sec));
  perform public.t_run(ed,'editor insert os_ferramentas (permitido)',$q$insert into public.os_ferramentas(slug,nome) values ('zz2','zz')$q$);
  perform public.t_run(ed,'editor update os_squad_agentes (permitido)',format($q$update public.os_squad_agentes set nome=nome where slug=%L$q$, ag));
  perform public.t_run(ed,'editor delete kb_documents (NEGADO: 0, como antes)',format($q$delete from public.kb_documents where id=%L$q$, doc));
  perform public.t_run(cs,'cs update kb_sections (NEGADO: 0, como antes)',format($q$update public.kb_sections set nome=nome where id=%L$q$, sec));
  perform public.t_run(le,'leitor insert agenda_eventos (NEGADO, como antes)',$q$insert into public.agenda_eventos(data,titulo) values (current_date,'zz')$q$);
  perform public.t_run(ad,'admin update kb_sections (permitido)',format($q$update public.kb_sections set nome=nome where id=%L$q$, sec));
  perform public.t_run(ad,'admin update os_squad_agentes (permitido)',format($q$update public.os_squad_agentes set nome=nome where slug=%L$q$, ag));
  perform public.t_run(ad,'admin desliga precisa_trocar_senha de outro (permitido)',format($q$update public.profiles set precisa_trocar_senha=false where id=%L$q$, ed));
  perform public.t_run(ad,'admin liga acesso_limitado num leitor (NEGADO: check)',format($q$update public.profiles set acesso_limitado=true where id=%L$q$, le));
  -- Servidor (service_role/postgres): check constraint e trigger de troca de senha
  begin
    update public.profiles set role='admin' where id=li;
    r := 'rows=1 (FALHA: devia barrar)';
  exception when others then r := 'ERRO[' || sqlstate || '] ' || left(sqlerrm, 70);
  end;
  insert into public.t_res(caso, resultado) values ('servidor: limitado com role admin (NEGADO: check)', r);
  update auth.users set encrypted_password = 'zz-hash-ficticio' where id = li;
  insert into public.t_res(caso, resultado)
    select 'troca de senha (auth.users) desliga a flag do limitado', 'flag=' || precisa_trocar_senha from public.profiles where id = li;
  update auth.users set email_confirmed_at = now() where id = ed;
  insert into public.t_res(caso, resultado)
    select 'update em auth.users sem trocar senha mantém flag do editor (ja desligada pelo admin acima: false)', 'flag=' || precisa_trocar_senha from public.profiles where id = ed;
  update public.profiles set precisa_trocar_senha = true where id = ed; -- como a admin-users faz (service)
  update auth.users set last_sign_in_at = now() where id = ed;
  insert into public.t_res(caso, resultado)
    select 'login (last_sign_in_at) não desliga a flag', 'flag=' || precisa_trocar_senha from public.profiles where id = ed;
end $t$;

do $r$ begin raise exception E'RESULTADOS\n%', (select string_agg(caso||' => '||resultado, E'\n' order by n) from public.t_res); end $r$;
