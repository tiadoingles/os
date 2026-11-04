-- Teste de RLS da Gestão de Tarefas (20261104_tarefas_base.sql). Roda tudo numa transação e desfaz no fim.
-- Personas: ADM, A (membro do setor X), B (membro do setor Y), C (sem setor). Usa perfis existentes da equipe.
-- Resultado: uma linha por verificação (ok = true). Rodar inteiro pelo SQL editor / MCP execute_sql.
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
insert into tarefas_setor_membros (setor_id, user_id) select (select v from _ids where k='sx'), (select v from _ids where k='a');
insert into tarefas_setor_membros (setor_id, user_id) select (select v from _ids where k='sy'), (select v from _ids where k='b');
insert into _ids select 'px', gen_random_uuid(); insert into _ids select 'py', gen_random_uuid();
insert into tarefas_projetos (id, setor_id, nome) select (select v from _ids where k='px'), (select v from _ids where k='sx'), 'Proj X';
insert into tarefas_projetos (id, setor_id, nome) select (select v from _ids where k='py'), (select v from _ids where k='sy'), 'Proj Y';
insert into _ids select 'ty', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo, criado_por) select (select v from _ids where k='ty'), (select v from _ids where k='py'), 'Tarefa do Y', (select v from _ids where k='b');

create or replace function pg_temp.como(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from _ids where k = p), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.sai() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;

-- A cria tarefa no setor X
select pg_temp.como('a');
insert into _ids select 'tx', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo) select (select v from _ids where k='tx'), (select v from _ids where k='px'), 'Tarefa do X';
insert into _r (teste, ok) select 'A vê a própria tarefa (status padrão aplicado)', exists (select 1 from tarefas where id = (select v from _ids where k='tx') and status_id is not null);
insert into _r (teste, ok) select 'A não vê tarefa do setor Y', not exists (select 1 from tarefas where id = (select v from _ids where k='ty'));
insert into _r (teste, ok) select 'A lê nomes de setores (não sensível)', (select count(*) from tarefas_setores where slug like 'teste-%') = 2;
insert into _r (teste, ok) select 'A não vê projeto do setor Y', not exists (select 1 from tarefas_projetos where id = (select v from _ids where k='py'));
insert into _r (teste, ok) select 'A não cria projeto (não é gestor)', false;
do $$ begin
  begin insert into tarefas_projetos (setor_id, nome) select v, 'P' from _ids where k='sx';
  exception when others then update _r set ok = true where teste = 'A não cria projeto (não é gestor)'; end;
end $$;
do $$ declare n int; begin
  insert into _r (teste, ok) values ('A não cria tarefa no setor Y', false);
  begin insert into tarefas (projeto_id, titulo) select v, 'x' from _ids where k='py';
  exception when others then update _r set ok = true where teste = 'A não cria tarefa no setor Y'; end;
end $$;
-- A dá a tarefa X para B (de outro setor)
update tarefas set responsavel_id = (select v from _ids where k='b') where id = (select v from _ids where k='tx');

-- B: vê a tarefa X (é responsável), pode editar; não vê outras do setor X
select pg_temp.como('b');
insert into _r (teste, ok) select 'B (outro setor) vê tarefa em que é responsável', exists (select 1 from tarefas where id = (select v from _ids where k='tx'));
insert into _r (teste, ok) select 'B vê o projeto X pela tarefa envolvida', exists (select 1 from tarefas_projetos where id = (select v from _ids where k='px'));
with u as (update tarefas set prioridade = 'alta' where id = (select v from _ids where k='tx') returning 1)
insert into _r (teste, ok) select 'B edita tarefa em que é responsável', (select count(*) from u) = 1;
insert into tarefas_checklist (tarefa_id, texto) select v, 'item' from _ids where k='tx';
insert into _r (teste, ok) select 'B grava checklist da tarefa envolvida', exists (select 1 from tarefas_checklist where tarefa_id = (select v from _ids where k='tx'));

-- C: sem setor e sem envolvimento
select pg_temp.como('c');
insert into _r (teste, ok) select 'C não vê nenhuma tarefa de teste', not exists (select 1 from tarefas where id in (select v from _ids where k in ('tx','ty')));
with u as (update tarefas set titulo = 'hack' where id = (select v from _ids where k='tx') returning 1)
insert into _r (teste, ok) select 'C não edita', (select count(*) from u) = 0;
insert into _r (teste, ok) select 'C não lê comentários/checklist', not exists (select 1 from tarefas_checklist where tarefa_id = (select v from _ids where k='tx'));
insert into _r (teste, ok) select 'C lista pessoas (RPC)', (select count(*) from tarefas_pessoas()) > 0;
do $$ begin
  insert into _r (teste, ok) values ('C sem setor não consegue Seguir', false);
  begin insert into tarefas_participantes (tarefa_id, user_id) select (select v from _ids where k='tx'), (select v from _ids where k='c');
  exception when others then update _r set ok = true where teste = 'C sem setor não consegue Seguir'; end;
end $$;

-- Outro membro do setor X sem envolvimento: vê mas não edita (usa C como membro de X)
select pg_temp.sai();
insert into tarefas_setor_membros (setor_id, user_id) select (select v from _ids where k='sx'), (select v from _ids where k='c');
select pg_temp.como('c');
insert into _r (teste, ok) select 'Membro do setor vê tarefa do setor', exists (select 1 from tarefas where id = (select v from _ids where k='tx'));
with u as (update tarefas set titulo = 'mudou' where id = (select v from _ids where k='tx') returning 1)
insert into _r (teste, ok) select 'Membro não envolvido não edita', (select count(*) from u) = 0;
insert into tarefas_comentarios (tarefa_id, texto_md) select v, 'pergunta' from _ids where k='tx';
insert into _r (teste, ok) select 'Membro não envolvido comenta', exists (select 1 from tarefas_comentarios where tarefa_id = (select v from _ids where k='tx'));
insert into tarefas_participantes (tarefa_id, user_id, papel) select (select v from _ids where k='tx'), (select v from _ids where k='c'), 'seguidor';
with u as (update tarefas set titulo = 'agora pode' where id = (select v from _ids where k='tx') returning 1)
insert into _r (teste, ok) select 'Seguir (fase 2) só avisa: seguidor continua sem editar', (select count(*) from u) = 0;

-- A tenta pendurar a tarefa X numa tarefa do setor Y (parent_id) e falsificar criado_por
select pg_temp.como('a');
insert into _ids select 'tz', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo, criado_por) select (select v from _ids where k='tz'), (select v from _ids where k='px'), 'Z', (select v from _ids where k='b');
select pg_temp.sai();
insert into _r (teste, ok) select 'criado_por falsificado vira quem gravou', (select criado_por from tarefas where id = (select v from _ids where k='tz')) = (select v from _ids where k='a');
select pg_temp.como('a');
do $$ begin
  insert into _r (teste, ok) values ('Não pendura tarefa em mãe de outro setor', false);
  begin update tarefas set parent_id = (select v from _ids where k='ty') where id = (select v from _ids where k='tz');
    if not found or (select setor_id from tarefas where id = (select v from _ids where k='tz')) = (select v from _ids where k='sx') then
      update _r set ok = true where teste = 'Não pendura tarefa em mãe de outro setor'; end if;
  exception when others then update _r set ok = true where teste = 'Não pendura tarefa em mãe de outro setor'; end;
end $$;
-- Subtarefa acompanha a mãe; tarefas acompanham o projeto que muda de setor
insert into _ids select 'ts', gen_random_uuid();
insert into tarefas (id, projeto_id, parent_id, titulo) select (select v from _ids where k='ts'), (select v from _ids where k='px'), (select v from _ids where k='tz'), 'sub';
select pg_temp.como('adm');
update tarefas_projetos set setor_id = (select v from _ids where k='sy') where id = (select v from _ids where k='px');
insert into _r (teste, ok) select 'Projeto muda de setor e leva tarefas e subtarefas', (select count(*) from tarefas where projeto_id = (select v from _ids where k='px') and setor_id <> (select v from _ids where k='sy')) = 0;
update tarefas_projetos set setor_id = (select v from _ids where k='sx') where id = (select v from _ids where k='px');

-- ADM
select pg_temp.como('adm');
insert into _r (teste, ok) select 'ADM vê tudo', (select count(*) from tarefas where id in (select v from _ids where k in ('tx','ty'))) = 2;
insert into tarefas_projetos (setor_id, nome) select v, 'P adm' from _ids where k='sx';
insert into _r (teste, ok) select 'ADM cria projeto com 4 status', (select count(*) from tarefas_status s join tarefas_projetos p on p.id = s.projeto_id where p.nome = 'P adm') = 4;

select pg_temp.sai();
select n, teste, ok from _r order by n;
rollback;
