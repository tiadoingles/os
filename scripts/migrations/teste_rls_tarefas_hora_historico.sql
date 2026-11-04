-- Teste de 20261104d_tarefas_hora_historico_repeticao.sql (transação desfeita no fim).
begin;
create temp table _r (n serial, teste text, ok boolean) on commit drop;
grant all on _r to authenticated; grant usage, select on sequence _r_n_seq to authenticated;
create temp table _ids (k text primary key, v uuid) on commit drop;
grant all on _ids to authenticated;
insert into _ids select 'a', id from (select id from profiles where role = 'equipe' order by email) s limit 1;
insert into _ids select 'b', id from (select id from profiles where role = 'equipe' order by email offset 1) s limit 1;
insert into _ids select 'sx', gen_random_uuid();
insert into tarefas_setores (id, slug, nome) select v, 'teste-x', 'Teste X' from _ids where k = 'sx';
insert into tarefas_setor_membros (setor_id, user_id) select (select v from _ids where k='sx'), v from _ids where k in ('a','b');
insert into _ids select 'px', gen_random_uuid();
insert into tarefas_projetos (id, setor_id, nome) select (select v from _ids where k='px'), (select v from _ids where k='sx'), 'Proj X';
create or replace function pg_temp.como(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from _ids where k = p), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.sai() returns void language plpgsql as $$ begin perform set_config('role', 'postgres', true); end $$;
create or replace function pg_temp.st(tipo text) returns uuid language sql as $$
  select id from tarefas_status where projeto_id = (select v from _ids where k='px') and tarefas_status.tipo = st.tipo order by ordem limit 1 $$;

-- datas da repetição
insert into _r (teste, ok) select 'Semanal seg/qua/sex: depois de qua 04/11 vem sex 06/11',
  app.tarefas_proxima_data(date '2026-11-04', '{"freq":"semanal","intervalo":1,"dias_semana":[1,3,5]}') = date '2026-11-06';
insert into _r (teste, ok) select 'A cada 2 semanas na segunda: depois de sex 06/11 vem seg 16/11',
  app.tarefas_proxima_data(date '2026-11-06', '{"freq":"semanal","intervalo":2,"dias_semana":[1]}') = date '2026-11-16';
insert into _r (teste, ok) select 'A cada 3 dias', app.tarefas_proxima_data(date '2026-11-04', '{"freq":"diaria","intervalo":3}') = date '2026-11-07';
insert into _r (teste, ok) select 'A cada 2 semanas no domingo: 08/11 -> 22/11', app.tarefas_proxima_data(date '2026-11-08', '{"freq":"semanal","intervalo":2,"dias_semana":[7]}') = date '2026-11-22';
insert into _r (teste, ok) select 'Todo mês', app.tarefas_proxima_data(date '2026-11-04', '{"freq":"mensal","intervalo":1}') = date '2026-12-04';

-- A cria para B com horário; repetição semanal seg/qua/sex
select pg_temp.como('a');
insert into _ids select 'tx', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo, responsavel_id, prazo, prazo_hora, recorrencia)
  select (select v from _ids where k='tx'), (select v from _ids where k='px'), 'Relatório', (select v from _ids where k='b'),
         date '2026-11-04', time '15:30', '{"freq":"semanal","intervalo":1,"dias_semana":[1,3,5]}';
do $$ begin
  insert into _r (teste, ok) values ('Repetição inválida recusada', false);
  begin update tarefas set recorrencia = '{"freq":"semanal","dias_semana":[8]}' where id = (select v from _ids where k='tx');
  exception when others then update _r set ok = true where teste = 'Repetição inválida recusada'; end;
end $$;
-- B conclui
select pg_temp.como('b');
update tarefas set status_id = pg_temp.st('concluido'), concluida_por = (select v from _ids where k='a') where id = (select v from _ids where k='tx');
select pg_temp.sai();
insert into _r (teste, ok) select 'Quem concluiu = quem gravou (não dá para forjar)', (select concluida_por from tarefas where id=(select v from _ids where k='tx')) = (select v from _ids where k='b');
insert into _r (teste, ok) select 'Próxima ocorrência na sexta com o mesmo horário',
  exists (select 1 from tarefas where origem_recorrencia_id=(select v from _ids where k='tx') and prazo = date '2026-11-06' and prazo_hora = time '15:30' and concluida_por is null);
-- A (criador) tenta trocar quem concluiu
select pg_temp.como('a');
update tarefas set concluida_por = (select v from _ids where k='a'), prioridade = 'alta' where id = (select v from _ids where k='tx');
select pg_temp.sai();
insert into _r (teste, ok) select 'Edição posterior não troca quem concluiu', (select concluida_por = (select v from _ids where k='b') and prioridade = 'alta' from tarefas where id=(select v from _ids where k='tx'));
-- reabrir limpa
select pg_temp.como('b');
update tarefas set status_id = pg_temp.st('aberto') where id = (select v from _ids where k='tx');
select pg_temp.sai();
insert into _r (teste, ok) select 'Reabrir limpa quem concluiu', (select concluida_por is null and concluida_em is null from tarefas where id=(select v from _ids where k='tx'));

-- insert já concluída, com quem/quando forjados, feito por B
select pg_temp.como('b');
insert into _ids select 'tc', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo, status_id, concluida_por, concluida_em)
  select (select v from _ids where k='tc'), (select v from _ids where k='px'), 'Já feita', pg_temp.st('concluido'), (select v from _ids where k='a'), now() - interval '10 days';
select pg_temp.sai();
insert into _r (teste, ok) select 'Insert já concluída: quem e quando são de quem gravou', (select concluida_por = (select v from _ids where k='b') and concluida_em > now() - interval '1 minute' from tarefas where id=(select v from _ids where k='tc'));
-- aviso de atraso pelo horário (prazo hoje às 00:01)
insert into _ids select 'th', gen_random_uuid();
insert into tarefas (id, projeto_id, titulo, responsavel_id, prazo, prazo_hora)
  select (select v from _ids where k='th'), (select v from _ids where k='px'), 'Com hora', (select v from _ids where k='b'),
         (now() at time zone 'America/Sao_Paulo')::date, time '00:01';
select app.tarefas_avisos_prazo();
insert into _r (teste, ok) select 'Horário passado no mesmo dia gera aviso de atraso',
  exists (select 1 from tarefas_notificacoes where tarefa_id=(select v from _ids where k='th') and tipo='atrasada');
insert into _r (teste, ok) select 'Cron de hora em hora', exists (select 1 from cron.job where jobname='tarefas-avisos-prazo' and schedule='5 * * * *');

select n, teste, ok from _r order by n;
rollback;
