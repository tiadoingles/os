-- Teste da Fase 2 da Gestão de Tarefas (20261104c_tarefas_fase2.sql). Transação desfeita no fim.
-- Personas: ADM, A (membro X, gestor), B (membro Y), C (sem setor).
begin;
create temp table _r (n serial, teste text, ok boolean) on commit drop;
grant all on _r to authenticated; grant usage, select on sequence _r_n_seq to authenticated;
create temp table _ids (k text primary key, v uuid) on commit drop;
grant all on _ids to authenticated;
insert into _ids select 'adm', id from profiles where role = 'admin' order by email limit 1;
insert into _ids select 'a', id from (select id from profiles where role = 'equipe' order by email) s limit 1;
insert into _ids select 'b', id from (select id from profiles where role = 'equipe' order by email offset 1) s limit 1;
insert into _ids select 'c', id from (select id from profiles where role = 'equipe' order by email offset 2) s limit 1;
insert into _ids select 'sx', gen_random_uuid(); insert into _ids select 'sy', gen_random_uuid();
insert into tarefas_setores (id, slug, nome) select v, 'teste-x', 'Teste X' from _ids where k = 'sx';
insert into tarefas_setores (id, slug, nome) select v, 'teste-y', 'Teste Y' from _ids where k = 'sy';
insert into tarefas_setor_membros (setor_id, user_id, papel) select (select v from _ids where k='sx'), (select v from _ids where k='a'), 'gestor';
insert into tarefas_setor_membros (setor_id, user_id) select (select v from _ids where k='sy'), (select v from _ids where k='b');
insert into _ids select 'px', gen_random_uuid();
insert into tarefas_projetos (id, setor_id, nome) select (select v from _ids where k='px'), (select v from _ids where k='sx'), 'Proj X';
insert into _ids select 'solx', id from tarefas_projetos where setor_id = (select v from _ids where k='sx') and aceita_solicitacoes;

create or replace function pg_temp.como(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from _ids where k = p), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.sai() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;

insert into _r (teste, ok) select 'Setor novo ganha projeto Solicitações', (select v from _ids where k='solx') is not null;

-- A cria tarefa para B (outro setor): B recebe aviso "atribuida"
select pg_temp.como('a');
insert into _ids select 'tx', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo, responsavel_id, prazo, recorrencia)
  select (select v from _ids where k='tx'), (select v from _ids where k='px'), 'Relatório semanal', (select v from _ids where k='b'),
         date '2026-11-02', '{"freq":"semanal","intervalo":1}';
insert into tarefas_checklist (tarefa_id, texto, feito) select v, 'passo 1', true from _ids where k='tx';
select pg_temp.como('b');
insert into _r (teste, ok) select 'B recebe aviso de atribuição', exists (select 1 from tarefas_notificacoes where tipo='atribuida' and tarefa_id=(select v from _ids where k='tx'));
insert into _r (teste, ok) select 'B não vê avisos dos outros', not exists (select 1 from tarefas_notificacoes where user_id <> (select v from _ids where k='b'));
with u as (update tarefas_notificacoes set lida_em = now() where tarefa_id=(select v from _ids where k='tx') returning 1)
insert into _r (teste, ok) select 'B marca aviso como lido', (select count(*) from u) >= 1;
do $$ begin
  insert into _r (teste, ok) values ('B não muda o texto do aviso', false);
  begin update tarefas_notificacoes set texto = 'x';
  exception when others then update _r set ok = true where teste = 'B não muda o texto do aviso'; end;
end $$;
-- B conclui (é responsável): A recebe "concluida" e nasce a próxima ocorrência (prazo +7, checklist desmarcado)
update tarefas set status_id = (select id from tarefas_status where projeto_id=(select v from _ids where k='px') and tipo='concluido' limit 1)
 where id = (select v from _ids where k='tx');
select pg_temp.sai();
insert into _r (teste, ok) select 'A recebe aviso de concluída', exists (select 1 from tarefas_notificacoes where tipo='concluida' and user_id=(select v from _ids where k='a'));
insert into _r (teste, ok) select 'Recorrência cria a próxima com prazo +7', exists (select 1 from tarefas where origem_recorrencia_id=(select v from _ids where k='tx') and prazo = date '2026-11-09' and concluida_em is null);
insert into _r (teste, ok) select 'Próxima ocorrência mantém o criador (A)', (select criado_por from tarefas where origem_recorrencia_id=(select v from _ids where k='tx')) = (select v from _ids where k='a');
insert into _r (teste, ok) select 'Checklist copiado e desmarcado', (select count(*) from tarefas_checklist c join tarefas t on t.id=c.tarefa_id where t.origem_recorrencia_id=(select v from _ids where k='tx') and not c.feito) = 1;
-- reabrir e concluir de novo não duplica
update tarefas set status_id = (select id from tarefas_status where projeto_id=(select v from _ids where k='px') order by ordem limit 1) where id=(select v from _ids where k='tx');
update tarefas set status_id = (select id from tarefas_status where projeto_id=(select v from _ids where k='px') and tipo='concluido' limit 1) where id=(select v from _ids where k='tx');
-- reabrir apaga a ocorrência intocada; concluir de novo recria uma só
update tarefas set status_id = (select id from tarefas_status where projeto_id=(select v from _ids where k='px') order by ordem limit 1) where id=(select v from _ids where k='tx');
insert into _r (teste, ok) select 'Reabrir (ou DESFAZER) apaga a próxima ocorrência intocada', (select count(*) from tarefas where origem_recorrencia_id=(select v from _ids where k='tx')) = 0;
update tarefas set status_id = (select id from tarefas_status where projeto_id=(select v from _ids where k='px') and tipo='concluido' limit 1) where id=(select v from _ids where k='tx');
insert into _r (teste, ok) select 'Reabrir e concluir de novo não duplica', (select count(*) from tarefas where origem_recorrencia_id=(select v from _ids where k='tx')) = 1;

-- C (sem setor) faz uma solicitação ao setor X: pode, vê a própria, gestor A é avisado; não vê as outras
select pg_temp.como('a');
insert into _ids select 'tsol_a', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo) select (select v from _ids where k='tsol_a'), (select v from _ids where k='solx'), 'Pedido interno do setor';
select pg_temp.como('c');
insert into _r (teste, ok) select 'C vê o projeto Solicitações de X', exists (select 1 from tarefas_projetos where id=(select v from _ids where k='solx'));
insert into _r (teste, ok) select 'C não vê o Proj X comum', not exists (select 1 from tarefas_projetos where id=(select v from _ids where k='px'));
insert into _ids select 'tsol', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo) select (select v from _ids where k='tsol'), (select v from _ids where k='solx'), 'Preciso de um relatório';
insert into _r (teste, ok) select 'C cria e vê a própria solicitação', exists (select 1 from tarefas where id=(select v from _ids where k='tsol'));
insert into _r (teste, ok) select 'C não vê outras tarefas de Solicitações', not exists (select 1 from tarefas where id=(select v from _ids where k='tsol_a'));
do $$ begin
  insert into _r (teste, ok) values ('C não cria tarefa no Proj X comum', false);
  begin insert into tarefas (projeto_id, titulo) select v, 'x' from _ids where k='px';
  exception when others then update _r set ok = true where teste = 'C não cria tarefa no Proj X comum'; end;
end $$;
select pg_temp.sai();
insert into _r (teste, ok) select 'Gestor A recebe aviso de solicitação', exists (select 1 from tarefas_notificacoes where tipo='solicitacao' and user_id=(select v from _ids where k='a') and tarefa_id=(select v from _ids where k='tsol'));

-- Seguir só avisa: B entra como membro de X, segue a tarefa do pedido interno, não consegue editar
insert into tarefas_setor_membros (setor_id, user_id) select (select v from _ids where k='sx'), (select v from _ids where k='b');
select pg_temp.como('b');
insert into tarefas_participantes (tarefa_id, user_id, papel) select (select v from _ids where k='tsol_a'), (select v from _ids where k='b'), 'seguidor';
with u as (update tarefas set titulo = 'mudou' where id=(select v from _ids where k='tsol_a') returning 1)
insert into _r (teste, ok) select 'Seguidor não edita', (select count(*) from u) = 0;
do $$ begin
  insert into _r (teste, ok) values ('Não se inclui como colaborador sozinho', false);
  begin insert into tarefas_participantes (tarefa_id, user_id, papel) select (select v from _ids where k='tsol_a'), (select v from _ids where k='b'), 'colaborador';
  exception when others then update _r set ok = true where teste = 'Não se inclui como colaborador sozinho'; end;
end $$;
-- Comentário com menção: A é mencionado (vê) e recebe "mencao"; C mencionado e não vê não recebe
insert into tarefas_comentarios (tarefa_id, texto_md, mencoes)
  select v, '@A olha isso', array[(select v from _ids where k='a'), (select v from _ids where k='c')] from _ids where k='tsol_a';
select pg_temp.sai();
insert into _r (teste, ok) select 'Mencionado que vê recebe aviso', exists (select 1 from tarefas_notificacoes where tipo='mencao' and user_id=(select v from _ids where k='a'));
insert into _r (teste, ok) select 'Mencionado sem acesso não recebe', not exists (select 1 from tarefas_notificacoes where tipo='mencao' and user_id=(select v from _ids where k='c'));

-- Dependências: A (envolvido) liga; ciclo é recusado; C não lê
select pg_temp.como('a');
insert into tarefas_dependencias (tarefa_id, depende_de_id) select (select v from _ids where k='tsol_a'), (select v from _ids where k='tx');
insert into _r (teste, ok) select 'Envolvido cria dependência', exists (select 1 from tarefas_dependencias where tarefa_id=(select v from _ids where k='tsol_a'));
do $$ begin
  insert into _r (teste, ok) values ('Ciclo de dependência recusado', false);
  begin insert into tarefas_dependencias (tarefa_id, depende_de_id) select (select v from _ids where k='tx'), (select v from _ids where k='tsol_a');
  exception when others then update _r set ok = true where teste = 'Ciclo de dependência recusado'; end;
end $$;
-- Gestor A edita etiquetas do setor X, mas não o nome; não edita Y
update tarefas_setores set etiquetas = '{financeiro,urgente-cliente}', nome = 'Hack' where id=(select v from _ids where k='sx');
insert into _r (teste, ok) select 'Gestor muda etiquetas mas não o nome', (select nome = 'Teste X' and etiquetas = '{financeiro,urgente-cliente}' from tarefas_setores where id=(select v from _ids where k='sx'));
with u as (update tarefas_setores set etiquetas = '{x}' where id=(select v from _ids where k='sy') returning 1)
insert into _r (teste, ok) select 'Gestor não mexe em outro setor', (select count(*) from u) = 0;
-- Modelo: A aplica o "Fluxo semanal da aula" no Proj X
insert into _ids select 'ids_modelo', null;
insert into _r (teste, ok) select 'Aplicar modelo cria as tarefas', coalesce(array_length(tarefas_aplicar_modelo((select id from tarefas_modelos where nome='Fluxo semanal da aula'), (select v from _ids where k='px'), date '2026-11-09', (select v from _ids where k='a')), 1), 0) = 7;
insert into _r (teste, ok) select 'Prazos do modelo relativos ao início', exists (select 1 from tarefas where projeto_id=(select v from _ids where k='px') and titulo='Publicar materiais e avisar as alunas' and prazo = date '2026-11-12');
-- Prioridade antiga "urgente" não entra mais
do $$ begin
  insert into _r (teste, ok) values ('Prioridade urgente recusada', false);
  begin update tarefas set prioridade = 'urgente' where id=(select v from _ids where k='tsol_a');
  exception when others then update _r set ok = true where teste = 'Prioridade urgente recusada'; end;
end $$;
-- B sai do setor X: como seguidor, deixa de receber comentários da tarefa
select pg_temp.sai();
delete from tarefas_setor_membros where setor_id = (select v from _ids where k='sx') and user_id = (select v from _ids where k='b');
select pg_temp.como('a');
insert into tarefas_comentarios (tarefa_id, texto_md) select v, 'segredo do setor' from _ids where k='tsol_a';
select pg_temp.sai();
insert into _r (teste, ok) select 'Seguidor que saiu do setor não recebe o comentário', not exists (select 1 from tarefas_notificacoes where user_id=(select v from _ids where k='b') and texto like '%segredo do setor%');
-- gestor não liga "aceita solicitações"
select pg_temp.como('a');
update tarefas_projetos set aceita_solicitacoes = true where id=(select v from _ids where k='px');
insert into _r (teste, ok) select 'Gestor não liga aceita_solicitacoes', not (select aceita_solicitacoes from tarefas_projetos where id=(select v from _ids where k='px'));
-- C não aplica modelo no Solicitações de X
select pg_temp.como('c');
do $$ begin
  insert into _r (teste, ok) values ('Quem não é do setor não aplica modelo', false);
  begin perform tarefas_aplicar_modelo((select id from tarefas_modelos where nome='Lançamento'), (select v from _ids where k='solx'), current_date, null);
  exception when others then update _r set ok = true where teste = 'Quem não é do setor não aplica modelo'; end;
end $$;
select pg_temp.como('a');
-- Mentorado normalizado
update tarefas set mentorado_email = '  Fulana@Email.COM ' where id=(select v from _ids where k='tsol_a');
insert into _r (teste, ok) select 'E-mail do mentorado normalizado', (select mentorado_email from tarefas where id=(select v from _ids where k='tsol_a')) = 'fulana@email.com';

select pg_temp.sai();
select n, teste, ok from _r order by n;
rollback;
