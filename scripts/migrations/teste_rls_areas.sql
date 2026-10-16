-- Teste de RLS do acesso por aba (migration 20261016_areas_por_aba). Mesmo esquema do teste_rls_cs.sql:
-- tudo acontece numa única transação implícita que termina em RAISE EXCEPTION (o Postgres desfaz tudo e a
-- mensagem traz os resultados). NÃO colocar BEGIN/COMMIT. Perfis fictícios sem senha (zz-*@invalid.test);
-- nenhuma conta real é usada. Rodar em dois pedidos (execute_sql): PRELÚDIO + PARTE 1 e PRELÚDIO + PARTE 2.
-- Cada linha sai como "OK" ou "FALHOU"; no fim, "falhas=N". Depois conferir:
--   select count(*) from auth.users where email like 'zz-%';  => 0
-- Personas: adm (ADM), cs ({cs}), cspd ({cs,pedagogico}), cont ({conteudo}), sem ({}), anon.

-- ===================== PRELÚDIO (fixtures e helpers; somem no rollback) =====================
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', e, now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values
 ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,'zz-adm@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000c5'::uuid,'zz-cs@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000c6'::uuid,'zz-cspd@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,'zz-cont@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000e0'::uuid,'zz-sem@invalid.test')) v(id,e);
update public.profiles set role='admin' where id='aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set areas='{cs}' where id='aaaaaaaa-0000-0000-0000-0000000000c5';
update public.profiles set areas='{cs,pedagogico}' where id='aaaaaaaa-0000-0000-0000-0000000000c6';
update public.profiles set areas='{conteudo}' where id='aaaaaaaa-0000-0000-0000-0000000000d1';
-- tabelas vazias ganham uma linha para o teste de escrita
insert into public.conteudo_objetivo_resumo(objetivo) values ('ZZ teste');
insert into public.farol_indicadores(setor,mes,bloco,nome) values ('geral','2026-10','ZZ','ZZ teste');
insert into public.kb_activity_log(action) values ('zz-teste');
insert into public.materiais_pedidos(tema) values ('ZZ teste');

create table public.t_res(n serial, caso text, obtido text, esperado text);
grant all on public.t_res to authenticated, anon;
grant usage on sequence public.t_res_n_seq to authenticated, anon;
create table public.t_pessoa(nome text primary key, id uuid, areas text[], adm boolean);
insert into public.t_pessoa values
 ('adm','aaaaaaaa-0000-0000-0000-0000000000a1','{}',true),
 ('cs','aaaaaaaa-0000-0000-0000-0000000000c5','{cs}',false),
 ('cspd','aaaaaaaa-0000-0000-0000-0000000000c6','{cs,pedagogico}',false),
 ('cont','aaaaaaaa-0000-0000-0000-0000000000d1','{conteudo}',false),
 ('sem','aaaaaaaa-0000-0000-0000-0000000000e0','{}',false),
 ('anon',null,'{}',false);
grant select on public.t_pessoa to authenticated, anon;

-- roda p_sql como a persona; devolve 'n' (count/row_count), 'NEGADO' (RLS/permissão, 42501) ou 'ERRO' (trigger/check)
create function public.t_exec(p_user uuid, p_sql text, p_mode text default 'val')
returns text language plpgsql as $f$
declare n bigint; r text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{"role":"anon"}' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if p_mode = 'val' then execute p_sql into n; r := coalesce(n::text,'null');
    else execute p_sql; get diagnostics n = row_count; r := n::text; end if;
  exception when others then
    r := case when sqlstate = '42501' then 'NEGADO' else 'ERRO' end;
    perform set_config('t.erro', left(sqlerrm, 90), true);
  end;
  reset role;
  return r;
end $f$;
create function public.t_conf(p_caso text, p_obtido text, p_esperado text) returns void language sql as $f$
  insert into public.t_res(caso, obtido, esperado)
  values (p_caso, p_obtido || case when p_obtido in ('ERRO','NEGADO') and p_obtido is distinct from p_esperado
                                   then ' [' || coalesce(current_setting('t.erro', true), '') || ']' else '' end, p_esperado);
$f$;

-- ===================== PARTE 1: leitura (contagem visível) e escrita (update sem mudança) =====================
do $t$
declare
  t record; p record; tot bigint; ve text; we text; col text; sub bigint;
begin
  -- tabela, área de leitura, área de escrita ('adm' = só ADM, 'todos' = qualquer logado, '-' = ninguém pelo front)
  for t in select * from (values
    ('kb_sections','bc','bc'),('kb_documents','bc','bc'),('kb_document_versions','bc','bc'),('kb_activity_log','bc','-'),
    ('agenda_eventos','agenda','agenda'),
    ('aulas_agenda','pedagogico','pedagogico'),('materiais_pedidos','pedagogico','pedagogico'),('slides_pedidos','pedagogico','pedagogico'),
    ('arena_regras','pedagogico','aprendida'),
    ('livros_envios','cs','cs'),('faq_interacoes','cs','cs'),('cs_diagnosticos','cs','cs'),('cs_metas','cs','cs'),
    ('cs_mentorados','cs','-'),('cs_teste_vac','cs','-'),('chat_widget_logs','cs','-'),('pesquisa_avatar','cs','adm'),
    ('nivelamento_respostas','cs','-'),
    ('conteudo_calendario','conteudo','conteudo'),('conteudo_objetivo_resumo','conteudo','conteudo'),('conteudo_insights','conteudo','conteudo'),
    ('ig_dia','conteudo','conteudo'),('ig_perfil','conteudo','conteudo'),('ig_post','conteudo','conteudo'),('linkedin_posts','conteudo','conteudo'),
    ('app_config','adm','adm'),('ai_usage_log','adm','adm'),('farol_config','adm','adm'),('farol_indicadores','adm','adm'),
    ('os_ferramentas','adm','adm'),('os_squad_agentes','adm','adm'),('automacao_estado','todos','adm'),
    ('sync_status','adm','adm'),('profiles','adm','adm'),('os_desfazer_snapshots','-','-')
  ) x(tab, ler, escrever) loop
    execute format('select count(*) from public.%I', t.tab) into tot;
    select a.attname into col from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t.tab and a.attnum=1;
    for p in select * from public.t_pessoa loop
      -- leitura esperada
      ve := case
        when p.id is null then '0'
        when t.ler = 'todos' then tot::text
        when t.ler = '-' then '0'
        when p.adm then tot::text
        when t.ler = 'adm' then '0'
        when t.ler = any(p.areas) then tot::text
        else '0' end;
      -- exceções de leitura
      if t.tab = 'profiles' and p.id is not null and not p.adm then ve := '1'; end if; -- só a própria linha (sem bc)
      if t.tab = 'sync_status' and p.id is not null and not p.adm and 'cs' = any(p.areas) then
        select count(*) into sub from public.sync_status where chave in ('metas-planilha','mentorados-planilha','teste-vac-planilha'); ve := sub::text; end if;
      if t.tab = 'faq_interacoes' and p.id is not null and not p.adm and 'cs' = any(p.areas) then
        select count(*) into sub from public.faq_interacoes where secao_slug='cs-suporte'; ve := sub::text; end if;
      if t.tab in ('kb_sections','kb_documents','kb_document_versions') and p.id is not null and not p.adm and 'cs' = any(p.areas) then
        if t.tab = 'kb_sections' then sub := 1;
        elsif t.tab = 'kb_documents' then select count(*) into sub from public.kb_documents d where d.section_id = app.cs_section_id() and d.status <> 'arquivado';
        else select count(*) into sub from public.kb_document_versions v join public.kb_documents d on d.id=v.document_id where d.section_id = app.cs_section_id() and d.status <> 'arquivado'; end if;
        ve := sub::text;
      end if;
      if t.tab = 'os_desfazer_snapshots' then ve := 'NEGADO'; end if; -- sem grant para authenticated/anon
      perform public.t_conf('ler '||t.tab||' | '||p.nome, public.t_exec(p.id, format('select count(*) from public.%I', t.tab)), ve);

      -- escrita esperada (update sem mudar nada; conta as linhas que a RLS deixa alterar)
      we := case
        when p.id is null then '0'
        when t.escrever = '-' then '0'
        when p.adm and t.escrever <> 'aprendida' then tot::text
        when t.escrever = 'adm' then '0'
        when t.escrever = 'aprendida' and (p.adm or 'pedagogico' = any(p.areas)) then (select count(*)::text from public.arena_regras where origem='aprendida')
        when t.escrever = 'aprendida' then '0'
        when t.escrever = any(p.areas) then tot::text
        else '0' end;
      if t.tab = 'profiles' and p.id is not null and not p.adm then we := '1'; end if;             -- a própria linha
      if t.tab = 'faq_interacoes' and p.id is not null and not p.adm and 'cs' = any(p.areas) then
        select count(*) into sub from public.faq_interacoes where secao_slug='cs-suporte'; we := sub::text; end if;
      if t.tab in ('kb_activity_log','cs_mentorados','cs_teste_vac','chat_widget_logs','nivelamento_respostas','os_desfazer_snapshots') then we := '0'; end if;
      if t.tab = 'os_desfazer_snapshots' then we := 'NEGADO'; end if;
      perform public.t_conf('escrever '||t.tab||' | '||p.nome,
        public.t_exec(p.id, format('update public.%I set %I = %I', t.tab, col, col), 'dml'), we);
    end loop;
  end loop;
end $t$;

-- "NEGADO" (sem GRANT na tabela) também vale quando o esperado é 0: é uma negação mais forte que a RLS.
do $r$ begin raise exception E'RESULTADOS ok=% falhas=%\n%',
  (select count(*) from public.t_res where obtido is not distinct from esperado or (esperado = '0' and obtido like 'NEGADO%')),
  (select count(*) from public.t_res where not (obtido is not distinct from esperado or (esperado = '0' and obtido like 'NEGADO%'))),
  coalesce((select string_agg('FALHOU ' || caso||' => '||obtido||' (esperado '||esperado||')', E'\n' order by n) from public.t_res
            where not (obtido is not distinct from esperado or (esperado = '0' and obtido like 'NEGADO%'))), 'nenhuma falha'); end $r$;

-- ===================== PARTE 2: inserts, exclusões, storage, RPCs e papel/abas =====================
-- (para rodar a parte 2, apague a PARTE 1 acima e deixe esta)
do $t$
declare
  adm uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; cs uuid := 'aaaaaaaa-0000-0000-0000-0000000000c5';
  cspd uuid := 'aaaaaaaa-0000-0000-0000-0000000000c6'; cont uuid := 'aaaaaaaa-0000-0000-0000-0000000000d1';
  sem uuid := 'aaaaaaaa-0000-0000-0000-0000000000e0';
  sec uuid; outra uuid;
begin
  select id into sec from public.kb_sections where slug = 'cs-suporte';
  select id into outra from public.kb_sections where slug <> 'cs-suporte' order by ordem limit 1;
  -- Base de Conhecimento: só bc (ou ADM) cria documento, em qualquer seção
  perform public.t_conf('kb_documents insert cs-suporte | cs', public.t_exec(cs, format($q$insert into public.kb_documents(section_id,titulo,kind,status) values (%L,'ZZ','documento','rascunho')$q$, sec), 'dml'), 'NEGADO');
  perform public.t_conf('kb_documents insert | cont', public.t_exec(cont, format($q$insert into public.kb_documents(section_id,titulo,kind,status) values (%L,'ZZ','documento','rascunho')$q$, outra), 'dml'), 'NEGADO');
  perform public.t_conf('kb_documents insert | adm', public.t_exec(adm, format($q$insert into public.kb_documents(section_id,titulo,kind,status) values (%L,'ZZ','documento','rascunho')$q$, outra), 'dml'), '1');
  perform public.t_conf('kb_documents delete | cspd', public.t_exec(cspd, $q$delete from public.kb_documents where titulo='ZZ'$q$, 'dml'), '0');
  perform public.t_conf('kb_sections insert | cs', public.t_exec(cs, $q$insert into public.kb_sections(slug,nome,ordem) values ('zz','ZZ',999)$q$, 'dml'), 'NEGADO');
  perform public.t_conf('kb_activity_log insert | cs', public.t_exec(cs, format($q$insert into public.kb_activity_log(actor_id,action) values (%L,'zz')$q$, cs), 'dml'), 'NEGADO');
  perform public.t_conf('kb_documents fora cs-suporte | cs', public.t_exec(cs, format($q$select count(*) from public.kb_documents where section_id <> %L$q$, sec)), '0');
  -- CS
  perform public.t_conf('livros_envios insert | cs', public.t_exec(cs, $q$insert into public.livros_envios(nome) values ('ZZ teste')$q$, 'dml'), '1');
  perform public.t_conf('livros_envios insert | cont', public.t_exec(cont, $q$insert into public.livros_envios(nome) values ('ZZ teste')$q$, 'dml'), 'NEGADO');
  perform public.t_conf('livros_envios delete | cspd', public.t_exec(cspd, $q$delete from public.livros_envios where nome='ZZ teste'$q$, 'dml'), '1');
  perform public.t_conf('cs_metas insert manual | cs', public.t_exec(cs, $q$insert into public.cs_metas(origem,mentorado_nome,descricao) values ('manual','ZZ','ZZ meta')$q$, 'dml'), '1');
  perform public.t_conf('cs_metas insert manual | cont', public.t_exec(cont, $q$insert into public.cs_metas(origem,mentorado_nome,descricao) values ('manual','ZZ','ZZ meta2')$q$, 'dml'), 'NEGADO');
  perform public.t_conf('cs_metas delete manual | cs', public.t_exec(cs, $q$delete from public.cs_metas where descricao='ZZ meta'$q$, 'dml'), '1');
  perform public.t_conf('cs_metas delete diagnostico | cs', public.t_exec(cs, $q$delete from public.cs_metas where origem='diagnostico'$q$, 'dml'), '0');
  perform public.t_conf('faq_interacoes insert outra secao | cs', public.t_exec(cs, $q$insert into public.faq_interacoes(secao_slug,pergunta,resposta_ia) values ('metodologia','ZZ','ZZ')$q$, 'dml'), 'NEGADO');
  perform public.t_conf('faq_interacoes insert cs-suporte | cs', public.t_exec(cs, $q$insert into public.faq_interacoes(secao_slug,pergunta,resposta_ia) values ('cs-suporte','ZZ','ZZ')$q$, 'dml'), '1');
  perform public.t_conf('rpc os_restaurar_cs_metas | cont', public.t_exec(cont, $q$select public.os_restaurar_cs_metas('[]'::jsonb)$q$), 'ERRO');
  perform public.t_conf('rpc os_restaurar_cs_metas | cs', public.t_exec(cs, $q$select public.os_restaurar_cs_metas('[]'::jsonb)$q$), '0');
  perform public.t_conf('rpc os_restaurar_diagnostico | cont', public.t_exec(cont, $q$select public.os_restaurar_diagnostico(gen_random_uuid())$q$), 'ERRO');
  -- Pedagógico
  perform public.t_conf('materiais_pedidos insert | cspd', public.t_exec(cspd, $q$insert into public.materiais_pedidos(tema) values ('ZZ p')$q$, 'dml'), '1');
  perform public.t_conf('materiais_pedidos insert | cs', public.t_exec(cs, $q$insert into public.materiais_pedidos(tema) values ('ZZ p')$q$, 'dml'), 'NEGADO');
  perform public.t_conf('arena_regras insert aprendida | cspd', public.t_exec(cspd, $q$insert into public.arena_regras(texto,origem) values ('ZZ regra','aprendida')$q$, 'dml'), '1');
  perform public.t_conf('arena_regras insert base | cspd', public.t_exec(cspd, $q$insert into public.arena_regras(texto,origem) values ('ZZ regra','base')$q$, 'dml'), 'NEGADO');
  perform public.t_conf('arena_regras update base | cspd', public.t_exec(cspd, $q$update public.arena_regras set texto=texto where origem='base'$q$, 'dml'), '0');
  perform public.t_conf('storage gerados insert | cspd', public.t_exec(cspd, $q$insert into storage.objects(bucket_id,name,owner) values ('gerados','zz/teste.txt',auth.uid())$q$, 'dml'), '1');
  perform public.t_conf('storage gerados insert | cs', public.t_exec(cs, $q$insert into storage.objects(bucket_id,name,owner) values ('gerados','zz/teste2.txt',auth.uid())$q$, 'dml'), 'NEGADO');
  perform public.t_conf('storage kb-documents leitura | cspd', public.t_exec(cspd, $q$select count(*) from storage.objects where bucket_id='kb-documents'$q$), '0');
  perform public.t_conf('storage kb-documents insert | cs', public.t_exec(cs, $q$insert into storage.objects(bucket_id,name,owner) values ('kb-documents','zz/x.txt',auth.uid())$q$, 'dml'), 'NEGADO');
  perform public.t_conf('storage kb-documents insert | adm', public.t_exec(adm, $q$insert into storage.objects(bucket_id,name,owner) values ('kb-documents','zz/x.txt',auth.uid())$q$, 'dml'), '1');
  -- Conteúdo
  perform public.t_conf('linkedin_posts insert | cont', public.t_exec(cont, $q$insert into public.linkedin_posts(pilar,texto,status) values (1,'ZZ','rascunho')$q$, 'dml'), '1');
  perform public.t_conf('linkedin_posts insert | cspd', public.t_exec(cspd, $q$insert into public.linkedin_posts(pilar,texto,status) values (1,'ZZ','rascunho')$q$, 'dml'), 'NEGADO');
  perform public.t_conf('rpc linkedin_conexao_status | cont', public.t_exec(cont, $q$select count(*) from public.linkedin_conexao_status()$q$), '1');
  perform public.t_conf('rpc linkedin_conexao_status | cs', public.t_exec(cs, $q$select count(*) from public.linkedin_conexao_status()$q$), 'NEGADO');
  -- Agenda
  perform public.t_conf('agenda_eventos insert | cont', public.t_exec(cont, $q$insert into public.agenda_eventos(titulo,data) values ('ZZ',current_date)$q$, 'dml'), 'NEGADO');
  perform public.t_conf('agenda_eventos insert | adm', public.t_exec(adm, $q$insert into public.agenda_eventos(titulo,data) values ('ZZ',current_date)$q$, 'dml'), '1');
  -- Transversais: só ADM
  perform public.t_conf('automacao_estado pausar | cspd', public.t_exec(cspd, $q$update public.automacao_estado set pausado = pausado$q$, 'dml'), '0');
  perform public.t_conf('sync_status solicitar | cs', public.t_exec(cs, $q$update public.sync_status set solicitado_em = now()$q$, 'dml'), '0');
  perform public.t_conf('os_squad_agentes update | cspd', public.t_exec(cspd, $q$update public.os_squad_agentes set ativo = ativo$q$, 'dml'), '0');
  -- Papel e abas: só o ADM muda (trigger), ninguém troca o próprio
  perform public.t_conf('profiles dar-se ADM | cs', public.t_exec(cs, format($q$update public.profiles set role='admin' where id=%L$q$, cs), 'dml'), 'ERRO');
  perform public.t_conf('profiles dar-se abas | cs', public.t_exec(cs, format($q$update public.profiles set areas='{cs,bc}' where id=%L$q$, cs), 'dml'), 'ERRO');
  perform public.t_conf('profiles mudar nome | cs', public.t_exec(cs, format($q$update public.profiles set nome='ZZ' where id=%L$q$, cs), 'dml'), '1');
  perform public.t_conf('profiles abas de outro | cs', public.t_exec(cs, format($q$update public.profiles set areas='{bc}' where id=%L$q$, cont), 'dml'), '0');
  perform public.t_conf('profiles abas de outro | adm', public.t_exec(adm, format($q$update public.profiles set areas='{bc}' where id=%L$q$, cont), 'dml'), '1');
  perform public.t_conf('profiles area invalida | adm', public.t_exec(adm, format($q$update public.profiles set areas='{farol}' where id=%L$q$, cont), 'dml'), 'ERRO');
  perform public.t_conf('profiles papel legado editor | adm', public.t_exec(adm, format($q$update public.profiles set role='editor' where id=%L$q$, cont), 'dml'), 'ERRO');
  perform public.t_conf('profiles ADM limitado | adm', public.t_exec(adm, format($q$update public.profiles set acesso_limitado=true where id=%L$q$, cont), 'dml'), 'ERRO');
  perform public.t_conf('tem_area | anon', public.t_exec(null, $q$select count(*) from public.kb_sections$q$), '0');
  perform public.t_conf('nivelamento insert publico | anon', public.t_exec(null, $q$insert into public.nivelamento_respostas(nome,email,whatsapp,nivel_autoavaliado,respostas) values ('ZZ','zz@invalid.test','0',1,'[]')$q$, 'dml'), '1');
end $t$;

-- "NEGADO" (sem GRANT na tabela) também vale quando o esperado é 0: é uma negação mais forte que a RLS.
do $r$ begin raise exception E'RESULTADOS ok=% falhas=%\n%',
  (select count(*) from public.t_res where obtido is not distinct from esperado or (esperado = '0' and obtido like 'NEGADO%')),
  (select count(*) from public.t_res where not (obtido is not distinct from esperado or (esperado = '0' and obtido like 'NEGADO%'))),
  coalesce((select string_agg('FALHOU ' || caso||' => '||obtido||' (esperado '||esperado||')', E'\n' order by n) from public.t_res
            where not (obtido is not distinct from esperado or (esperado = '0' and obtido like 'NEGADO%'))), 'nenhuma falha'); end $r$;
