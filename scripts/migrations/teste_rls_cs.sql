-- Teste de RLS do papel cs. RODAR SO DEPOIS da migration 20261009_papel_cs_helpers_e_rls.
-- Tudo (usuarios ficticios, tabela de resultados, linhas inseridas) acontece numa unica transacao
-- implicita que termina em RAISE EXCEPTION: o Postgres desfaz tudo e a mensagem de erro traz a tabela
-- de resultados. NAO colocar BEGIN/COMMIT. Rodar em dois pedidos (execute_sql): o preludio + PARTE 1 e,
-- depois, o preludio + PARTE 2 (cada pedido termina com o bloco "RESULTADOS", que forca o rollback).
-- Depois conferir que nada persistiu: select count(*) from auth.users where email like 'zz-%'; => 0
-- e select count(*) from public.livros_envios where nome like 'ZZ%'; => 0.
-- Papeis simulados: cs, editor, admin, leitor, limitado (editor + acesso_limitado = ADM limitado) e anon.
-- Observacao: o fluxo do sync@ (editor) e simulado com um editor ficticio; a conta real nao e tocada.
-- ===== fixtures e helper de teste (tudo some no rollback) =====
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

-- ===================== PARTE 1: matriz de leitura (contagens por papel) =====================
do $t$
declare t text; u record;
begin
  for t in select unnest(array['agenda_eventos','ai_usage_log','app_config','aulas_agenda','automacao_estado','chat_widget_logs','conteudo_calendario','conteudo_insights','conteudo_objetivo_resumo','cs_diagnosticos','cs_mentorados','cs_metas','cs_teste_vac','faq_interacoes','farol_config','farol_indicadores','ig_dia','ig_perfil','ig_post','kb_activity_log','kb_document_versions','kb_documents','kb_sections','linkedin_posts','livros_envios','materiais_pedidos','nivelamento_respostas','os_desfazer_snapshots','os_ferramentas','os_squad_agentes','pesquisa_avatar','profiles','slides_pedidos','sync_status']) loop
    execute format('insert into public.t_res(caso,resultado) select %L, count(*)::text from public.%I', t||' | total', t);
    for u in select * from (values ('cs','aaaaaaaa-0000-0000-0000-0000000000c5'::uuid),('editor','aaaaaaaa-0000-0000-0000-0000000000e1'::uuid),('admin','aaaaaaaa-0000-0000-0000-0000000000a1'::uuid),('leitor','aaaaaaaa-0000-0000-0000-0000000000b1'::uuid),('limitado','aaaaaaaa-0000-0000-0000-0000000000f1'::uuid),('anon',null::uuid)) x(nm,id) loop
      perform public.t_run(u.id, t||' | '||u.nm, format('select count(*) from public.%I', t), 'val');
    end loop;
  end loop;
  -- storage kb-documents e documentos por secao
  insert into public.t_res(caso,resultado) select 'storage kb-documents | total', count(*)::text from storage.objects where bucket_id='kb-documents';
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','storage kb-documents | cs',$q$select count(*) from storage.objects where bucket_id='kb-documents'$q$,'val');
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000e1','storage kb-documents | editor',$q$select count(*) from storage.objects where bucket_id='kb-documents'$q$,'val');
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','kb_documents fora cs-suporte | cs',$q$select count(*) from public.kb_documents d join public.kb_sections s on s.id=d.section_id where s.slug<>'cs-suporte'$q$,'val');
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','sync_status chaves fora do cs | cs',$q$select count(*) from public.sync_status where chave not in ('metas-planilha','mentorados-planilha','teste-vac-planilha')$q$,'val');
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','sync_status chaves do cs | cs',$q$select count(*) from public.sync_status where chave in ('metas-planilha','mentorados-planilha','teste-vac-planilha')$q$,'val');
  insert into public.t_res(caso,resultado) select 'kb_document_versions da cs-suporte | total', count(*)::text from public.kb_document_versions v join public.kb_documents d on d.id=v.document_id join public.kb_sections s on s.id=d.section_id where s.slug='cs-suporte';
  insert into public.t_res(caso,resultado) select 'kb_documents da cs-suporte nao arquivados | total', count(*)::text from public.kb_documents d join public.kb_sections s on s.id=d.section_id where s.slug='cs-suporte' and d.status<>'arquivado';
  insert into public.t_res(caso,resultado) select 'faq_interacoes cs-suporte | total', count(*)::text from public.faq_interacoes where secao_slug='cs-suporte';
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','kb_document_versions fora cs-suporte | cs',$q$select count(*) from public.kb_document_versions v join public.kb_documents d on d.id=v.document_id join public.kb_sections s on s.id=d.section_id where s.slug<>'cs-suporte'$q$,'val');
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','faq_interacoes fora cs-suporte | cs',$q$select count(*) from public.faq_interacoes where secao_slug<>'cs-suporte'$q$,'val');
  perform public.t_run('aaaaaaaa-0000-0000-0000-0000000000c5','profiles de outros | cs',$q$select count(*) from public.profiles where id<>'aaaaaaaa-0000-0000-0000-0000000000c5'$q$,'val');
end $t$;

do $r$ begin raise exception E'RESULTADOS\n%', (select string_agg(caso||' => '||resultado, E'\n' order by n) from public.t_res); end $r$;

-- ===================== PARTE 2: escrita permitida e negada + RPCs de desfazer =====================
-- (para rodar a parte 2, apague a PARTE 1 acima e deixe esta)
do $t$
declare
  cs uuid := 'aaaaaaaa-0000-0000-0000-0000000000c5'; ed uuid := 'aaaaaaaa-0000-0000-0000-0000000000e1';
  ad uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; le uuid := 'aaaaaaaa-0000-0000-0000-0000000000b1';
  li uuid := 'aaaaaaaa-0000-0000-0000-0000000000f1';
  sec uuid; ts text;
begin
  select id into sec from public.kb_sections where slug = 'cs-suporte';
  -- CS: tabelas de CS (permitido)
  perform public.t_run(cs,'cs insert livros_envios',$q$insert into public.livros_envios(id,nome) values ('b0000000-0000-0000-0000-000000000001','ZZ teste')$q$);
  perform public.t_run(cs,'cs update livros_envios',$q$update public.livros_envios set status='enviado' where id='b0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs delete livros_envios',$q$delete from public.livros_envios where id='b0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs insert faq cs-suporte',$q$insert into public.faq_interacoes(secao_slug,pergunta,resposta_ia) values ('cs-suporte','zz','zz')$q$);
  perform public.t_run(cs,'cs insert faq comercial (NEGADO)',$q$insert into public.faq_interacoes(secao_slug,pergunta,resposta_ia) values ('comercial','zz','zz')$q$);
  perform public.t_run(cs,'cs insert cs_diagnosticos',$q$insert into public.cs_diagnosticos(id,nome,dados) values ('d0000000-0000-0000-0000-000000000001','ZZ ficha','{"metas":[{"id":"m1","descricao":"meta da ficha","data":"2026-12-01"}]}'::jsonb)$q$);
  perform public.t_run(cs,'cs update cs_diagnosticos',$q$update public.cs_diagnosticos set nome='ZZ ficha 2' where id='d0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs update cs_diagnosticos status=concluido (trigger protege: nao muda)',$q$update public.cs_diagnosticos set status='concluido' where id='d0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs ve meta gerada pela ficha',$q$select count(*) from public.cs_metas where diagnostico_id='d0000000-0000-0000-0000-000000000001'$q$,'val');
  perform public.t_run(cs,'cs delete meta de diagnostico (NEGADO: 0 linhas)',$q$delete from public.cs_metas where diagnostico_id='d0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs insert meta manual',$q$insert into public.cs_metas(id,origem,mentorado_nome,descricao) values ('e0000000-0000-0000-0000-000000000001','manual','ZZ','meta manual')$q$);
  perform public.t_run(cs,'cs update meta manual (FEITO)',$q$update public.cs_metas set concluida_em=now() where id='e0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs update meta manual (descricao)',$q$update public.cs_metas set descricao='meta manual 2' where id='e0000000-0000-0000-0000-000000000001'$q$);
  -- RPC de desfazer (cs): volta a versao anterior guardada pelo banco
  select dados->>'updated_at' into ts from public.os_desfazer_snapshots where registro_id='e0000000-0000-0000-0000-000000000001' order by id asc limit 1;
  perform public.t_run(cs,'cs rpc os_restaurar_cs_metas',format($q$select public.os_restaurar_cs_metas(jsonb_build_array(jsonb_build_object('id','e0000000-0000-0000-0000-000000000001','updated_at',%L)))$q$, ts),'val');
  perform public.t_run(le,'leitor rpc os_restaurar_cs_metas (NEGADO)',format($q$select public.os_restaurar_cs_metas(jsonb_build_array(jsonb_build_object('id','e0000000-0000-0000-0000-000000000001','updated_at',%L)))$q$, ts),'val');
  perform public.t_run(cs,'cs delete meta manual',$q$delete from public.cs_metas where id='e0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs delete cs_diagnosticos',$q$delete from public.cs_diagnosticos where id='d0000000-0000-0000-0000-000000000001'$q$);
  perform public.t_run(cs,'cs rpc os_restaurar_diagnostico',$q$select public.os_restaurar_diagnostico('d0000000-0000-0000-0000-000000000001')$q$,'val');
  perform public.t_run(le,'leitor rpc os_restaurar_diagnostico (NEGADO)',$q$select public.os_restaurar_diagnostico('d0000000-0000-0000-0000-000000000009')$q$,'val');
  perform public.t_run(null,'anon rpc os_restaurar_diagnostico (NEGADO)',$q$select public.os_restaurar_diagnostico('d0000000-0000-0000-0000-000000000009')$q$,'val');
  -- CS: fora de CS (negado)
  perform public.t_run(cs,'cs insert agenda_eventos (NEGADO)',$q$insert into public.agenda_eventos(data,titulo) values (current_date,'zz')$q$);
  perform public.t_run(cs,'cs insert farol_indicadores (NEGADO)',$q$insert into public.farol_indicadores(setor,mes,bloco,nome) values ('x','2026-10','x','x')$q$);
  perform public.t_run(cs,'cs update farol_indicadores (NEGADO)',$q$update public.farol_indicadores set nome='x'$q$);
  perform public.t_run(cs,'cs insert kb_documents (NEGADO)',format($q$insert into public.kb_documents(section_id,titulo) values (%L,'zz')$q$, sec));
  perform public.t_run(cs,'cs update kb_sections (NEGADO)',$q$update public.kb_sections set nome=nome$q$);
  perform public.t_run(cs,'cs insert os_ferramentas (NEGADO)',$q$insert into public.os_ferramentas(slug,nome) values ('zz','zz')$q$);
  perform public.t_run(cs,'cs update pesquisa_avatar (NEGADO)',$q$update public.pesquisa_avatar set titulo=titulo$q$);
  perform public.t_run(cs,'cs update sync_status (NEGADO)',$q$update public.sync_status set nome=nome$q$);
  perform public.t_run(cs,'cs insert chat_widget_logs (NEGADO)',$q$insert into public.chat_widget_logs(pergunta) values ('zz')$q$);
  perform public.t_run(cs,'cs update automacao_estado pausar IA (NEGADO)',$q$update public.automacao_estado set pausado=true$q$);
  perform public.t_run(cs,'cs insert ai_usage_log (NEGADO)',$q$insert into public.ai_usage_log(origem,modelo) values ('zz','zz')$q$);
  perform public.t_run(cs,'cs update app_config (NEGADO)',$q$update public.app_config set chave=chave$q$);
  perform public.t_run(cs,'cs update cs_mentorados (NEGADO)',$q$update public.cs_mentorados set nome=nome$q$);
  perform public.t_run(cs,'cs call cs_mentorados_substituir (NEGADO)',$q$select public.cs_mentorados_substituir('[]'::jsonb)$q$,'val');
  perform public.t_run(cs,'cs insert kb_activity_log (NEGADO)',format($q$insert into public.kb_activity_log(actor_id,action) values (%L,'zz')$q$, cs));
  perform public.t_run(cs,'cs insert linkedin_posts (NEGADO)',$q$insert into public.linkedin_posts(pilar,texto) values (1,'zz')$q$);
  perform public.t_run(cs,'cs update cs_teste_vac (NEGADO)',$q$update public.cs_teste_vac set nome=nome$q$);
  perform public.t_run(cs,'cs call cs_teste_vac_substituir (NEGADO)',$q$select public.cs_teste_vac_substituir('[]'::jsonb)$q$,'val');
  perform public.t_run(cs,'cs rpc linkedin_conexao_status (NEGADO)',$q$select count(*) from public.linkedin_conexao_status()$q$,'val');
  perform public.t_run(cs,'cs insert storage kb-documents (NEGADO)',$q$insert into storage.objects(bucket_id,name) values ('kb-documents','zz.txt')$q$);
  -- Papel: ninguem vira admin por brecha
  perform public.t_run(cs,'cs update profiles.role=admin em si (NEGADO)',format($q$update public.profiles set role='admin' where id=%L$q$, cs));
  perform public.t_run(cs,'cs update profiles.nome proprio (permitido)',format($q$update public.profiles set nome='ZZ' where id=%L$q$, cs));
  perform public.t_run(cs,'cs update profiles de outro (NEGADO: 0 linhas)',format($q$update public.profiles set nome='ZZ' where id=%L$q$, ed));
  perform public.t_run(le,'leitor update profiles.role=admin em si (NEGADO)',format($q$update public.profiles set role='admin' where id=%L$q$, le));
  perform public.t_run(ed,'editor update profiles.role=admin em si (NEGADO)',format($q$update public.profiles set role='admin' where id=%L$q$, ed));
  perform public.t_run(cs,'cs insert profiles (NEGADO)',$q$insert into public.profiles(id,email,role) values (gen_random_uuid(),'zz@x','admin')$q$);
  -- Editor / admin / leitor continuam como antes
  perform public.t_run(ed,'editor insert agenda_eventos',$q$insert into public.agenda_eventos(data,titulo) values (current_date,'zz')$q$);
  perform public.t_run(ed,'editor insert livros_envios',$q$insert into public.livros_envios(nome) values ('ZZ')$q$);
  perform public.t_run(ed,'editor insert faq_interacoes comercial (permitido p/ editor)',$q$insert into public.faq_interacoes(secao_slug,pergunta,resposta_ia) values ('comercial','zz','zz')$q$);
  perform public.t_run(ed,'editor insert kb_documents (fluxo do sync@)',format($q$insert into public.kb_documents(section_id,titulo) values (%L,'zz')$q$, sec));
  perform public.t_run(ed,'editor insert os_ferramentas',$q$insert into public.os_ferramentas(slug,nome) values ('zz','zz')$q$);
  perform public.t_run(ed,'editor update automacao_estado',$q$update public.automacao_estado set pausado=pausado$q$);
  perform public.t_run(ed,'editor select app_config (NEGADO: 0)',$q$select count(*) from public.app_config$q$,'val');
  perform public.t_run(ad,'admin select app_config',$q$select count(*) from public.app_config$q$,'val');
  perform public.t_run(ed,'editor insert kb_activity_log (permitido)',format($q$insert into public.kb_activity_log(actor_id,action) values (%L,'zz')$q$, ed));
  perform public.t_run(ed,'editor app.is_cs_or_editor() (sim)',$q$select app.is_cs_or_editor()::int$q$,'val');
  perform public.t_run(li,'limitado app.is_cs_or_editor() (sim)',$q$select app.is_cs_or_editor()::int$q$,'val');
  perform public.t_run(li,'limitado app.is_editor_estrutura() (nao)',$q$select app.is_editor_estrutura()::int$q$,'val');
  perform public.t_run(li,'limitado insert livros_envios (permitido)',$q$insert into public.livros_envios(nome) values ('ZZ')$q$);
  perform public.t_run(li,'limitado insert cs_metas manual (permitido)',$q$insert into public.cs_metas(origem,mentorado_nome,descricao) values ('manual','ZZ','zz')$q$);
  perform public.t_run(li,'limitado insert agenda_eventos (permitido)',$q$insert into public.agenda_eventos(data,titulo) values (current_date,'zz')$q$);
  perform public.t_run(li,'limitado update kb_sections (NEGADO: 0)',$q$update public.kb_sections set nome=nome$q$);
  perform public.t_run(li,'limitado insert os_ferramentas (NEGADO)',$q$insert into public.os_ferramentas(slug,nome) values ('zz2','zz')$q$);
  perform public.t_run(cs,'cs app.is_cs_or_editor() (sim)',$q$select app.is_cs_or_editor()::int$q$,'val');
  perform public.t_run(cs,'cs app.is_editor() (nao)',$q$select app.is_editor()::int$q$,'val');
  perform public.t_run(le,'leitor app.is_cs_or_editor() (nao)',$q$select app.is_cs_or_editor()::int$q$,'val');
  perform public.t_run(le,'leitor insert cs_metas (NEGADO)',$q$insert into public.cs_metas(origem,mentorado_nome,descricao) values ('manual','ZZ','zz')$q$);
  perform public.t_run(le,'leitor insert livros_envios (NEGADO)',$q$insert into public.livros_envios(nome) values ('ZZ')$q$);
  perform public.t_run(le,'leitor insert agenda_eventos (NEGADO)',$q$insert into public.agenda_eventos(data,titulo) values (current_date,'zz')$q$);
  perform public.t_run(null,'anon select livros_envios (NEGADO)',$q$select count(*) from public.livros_envios$q$,'val');
  perform public.t_run(null,'anon insert livros_envios (NEGADO)',$q$insert into public.livros_envios(nome) values ('ZZ')$q$);
  -- por ultimo: muda o papel do leitor ficticio (os casos de leitor acima ja rodaram)
  perform public.t_run(ad,'admin update profiles.role de leitor para cs (permitido)',format($q$update public.profiles set role='cs' where id=%L$q$, le));
end $t$;

do $r$ begin raise exception E'RESULTADOS\n%', (select string_agg(caso||' => '||resultado, E'\n' order by n) from public.t_res); end $r$;
