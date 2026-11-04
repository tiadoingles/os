-- Teste de 20261104e_tarefas_repeticao_dias_uteis.sql (só funções puras; transação desfeita).
begin;
create temp table _r (n serial, teste text, ok boolean) on commit drop;
insert into _r (teste, ok) values
 ('Diário só úteis: sex 06/11 -> seg 09/11', app.tarefas_proxima_data('2026-11-06', '{"freq":"diaria","intervalo":1,"uteis":true}') = '2026-11-09'),
 ('Formato antigo dias_uteis igual', app.tarefas_proxima_data('2026-11-06', '{"freq":"dias_uteis","intervalo":1}') = '2026-11-09'),
 ('Diário sem úteis: sex -> sáb', app.tarefas_proxima_data('2026-11-06', '{"freq":"diaria","intervalo":1}') = '2026-11-07'),
 ('Mensal só úteis: 07/10 -> sáb 07/11 vira seg 09/11', app.tarefas_proxima_data('2026-10-07', '{"freq":"mensal","intervalo":1,"uteis":true}') = '2026-11-09'),
 ('Semanal só úteis: sáb 07/11 -> sáb 14/11 vira seg 16/11', app.tarefas_proxima_data('2026-11-07', '{"freq":"semanal","intervalo":1,"uteis":true}') = '2026-11-16'),
 ('Semanal só sáb/dom + úteis vai para segunda', app.tarefas_proxima_data('2026-11-04', '{"freq":"semanal","intervalo":1,"dias_semana":[6,7],"uteis":true}') = '2026-11-09'),
 ('Semanal seg/qua/sex sem mudança', app.tarefas_proxima_data('2026-11-04', '{"freq":"semanal","intervalo":1,"dias_semana":[1,3,5],"uteis":true}') = '2026-11-06'),
 ('Diário a cada 2 úteis: qui 05/11 -> seg 09/11', app.tarefas_proxima_data('2026-11-05', '{"freq":"diaria","intervalo":2,"uteis":true}') = '2026-11-09'),
 ('Mensal úteis com dia 7: 07/02 -> 09/03 (dom 08? não: sáb 07/03 -> seg 09/03)', app.tarefas_proxima_data('2026-02-07', '{"freq":"mensal","intervalo":1,"uteis":true,"dia":7}') = '2026-03-09'),
 ('Mensal úteis não escorrega: 09/03 com dia 7 -> 07/04', app.tarefas_proxima_data('2026-03-09', '{"freq":"mensal","intervalo":1,"uteis":true,"dia":7}') = '2026-04-07'),
 ('Mensal dia 31 volta a 31: 28/02 -> 31/03', app.tarefas_proxima_data('2026-02-28', '{"freq":"mensal","intervalo":1,"dia":31}') = '2026-03-31'),
 ('Mensal sem dia continua: 04/11 -> 04/12', app.tarefas_proxima_data('2026-11-04', '{"freq":"mensal","intervalo":1}') = '2026-12-04'),
 ('Valida uteis booleano', app.tarefas_recorrencia_valida('{"freq":"diaria","uteis":true}') and not app.tarefas_recorrencia_valida('{"freq":"diaria","uteis":"sim"}'));
select n, teste, ok from _r order by n;
rollback;
