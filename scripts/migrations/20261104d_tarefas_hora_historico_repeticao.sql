-- Gestão de Tarefas, ajustes pedidos pela Tia (04/11/2026):
--  1) horário limite da tarefa (prazo_hora);
--  2) histórico de concluídas: quem marcou como concluída (concluida_por) e quando (concluida_em, já existia);
--  3) repetição personalizada: a cada N dias/semanas/meses, dias da semana escolhidos e data final.
-- Teste: teste_rls_tarefas_hora_historico.sql.

alter table public.tarefas
  add column prazo_hora time,
  add column concluida_por uuid references public.profiles(id) on delete set null;
create index tarefas_concluidas_idx on public.tarefas (setor_id, concluida_em desc) where concluida_em is not null and excluida_em is null;

-- recorrencia = {freq: diaria|dias_uteis|semanal|mensal, intervalo: 1..999, dias_semana?: [1..7] (1=seg), ate?: AAAA-MM-DD}
-- (CHECK não aceita subconsulta: a validação fica numa função imutável.)
create or replace function app.tarefas_recorrencia_valida(r jsonb) returns boolean
language sql immutable set search_path = public as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and r ->> 'freq' in ('diaria', 'dias_uteis', 'semanal', 'mensal')
    and coalesce(r ->> 'intervalo', '1') ~ '^[1-9][0-9]{0,2}$'
    and coalesce(r ->> 'ate', '2000-01-01') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (not r ? 'dias_semana' or (
          jsonb_typeof(r -> 'dias_semana') = 'array'
          and jsonb_array_length(r -> 'dias_semana') between 1 and 7
          and (select bool_and(x ~ '^[1-7]$') from jsonb_array_elements_text(r -> 'dias_semana') x))));
$$;
alter table public.tarefas drop constraint tarefas_recorrencia_check;
alter table public.tarefas add constraint tarefas_recorrencia_check check (app.tarefas_recorrencia_valida(recorrencia));

-- Próxima data. Semanal com dias_semana: próximo dia escolhido, respeitando "a cada N semanas".
create or replace function app.tarefas_proxima_data(p_data date, p_rec jsonb) returns date
language plpgsql immutable set search_path = public as $$
declare
  n int := greatest(coalesce((p_rec ->> 'intervalo')::int, 1), 1);
  d date := p_data; i int := 0; dias int[]; semana0 date := date_trunc('week', p_data::timestamp)::date;
begin
  case p_rec ->> 'freq'
    when 'diaria' then return p_data + n;
    when 'mensal' then return (p_data + make_interval(months => n))::date;
    when 'dias_uteis' then
      while i < n loop d := d + 1; if extract(isodow from d) < 6 then i := i + 1; end if; end loop;
      return d;
    when 'semanal' then
      if p_rec ? 'dias_semana' then
        select array_agg(x::int) into dias from jsonb_array_elements_text(p_rec -> 'dias_semana') x;
        for i in 1 .. 7 * n + 7 loop
          d := p_data + i;
          if extract(isodow from d)::int = any(dias)
             and ((date_trunc('week', d::timestamp)::date - semana0) / 7) % n = 0 then
            return d;
          end if;
        end loop;
        return null;
      end if;
      return p_data + 7 * n;
    else return null;
  end case;
end $$;

-- Quem concluiu: sempre quem gravou (o ADM mantém o valor do snapshot no DESFAZER); some ao reabrir; não muda depois.
create or replace function app.tarefas_preparar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A tarefa não pode ser subtarefa dela mesma'; end if;
    if tg_op = 'UPDATE' and exists (
        with recursive up(id, parent_id) as (
          select id, parent_id from public.tarefas where id = new.parent_id
          union all select t.id, t.parent_id from public.tarefas t join up on t.id = up.parent_id)
        select 1 from up where id = new.id) then
      raise exception 'Ciclo de subtarefas';
    end if;
    select projeto_id into new.projeto_id from public.tarefas where id = new.parent_id;
  end if;
  select setor_id into new.setor_id from public.tarefas_projetos where id = new.projeto_id;
  if new.setor_id is null then raise exception 'Projeto inexistente'; end if;
  if new.status_id is not null and not exists (
       select 1 from public.tarefas_status s where s.id = new.status_id and s.projeto_id = new.projeto_id) then
    new.status_id := null;
  end if;
  if new.status_id is null then
    select id into new.status_id from public.tarefas_status where projeto_id = new.projeto_id order by ordem limit 1;
  end if;
  select tipo into v_tipo from public.tarefas_status where id = new.status_id;
  if v_tipo = 'concluido' then
    if tg_op = 'INSERT' or old.concluida_em is null then
      -- Quando e quem: sempre o momento e a pessoa que gravou (o ADM mantém o snapshot no DESFAZER).
      if auth.uid() is not null and not app.is_admin() then
        new.concluida_em := now(); new.concluida_por := auth.uid();
      else
        new.concluida_em := coalesce(new.concluida_em, now());
        new.concluida_por := coalesce(new.concluida_por, auth.uid());
      end if;
    else
      new.concluida_em := old.concluida_em;
      new.concluida_por := old.concluida_por;
    end if;
  else
    new.concluida_em := null;
    new.concluida_por := null;
  end if;
  if tg_op = 'UPDATE' then new.criado_por := old.criado_por;
  elsif auth.uid() is not null and not app.is_admin() and pg_trigger_depth() <= 1 then
    new.criado_por := auth.uid();
  end if;
  return new;
end $$;

-- Recorrência: a próxima ocorrência leva também o horário limite.
create or replace function app.tarefas_recorrencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_base date; v_prox date; v_id uuid; v_ate date;
begin
  if old.concluida_em is not null and new.concluida_em is null then
    delete from public.tarefas where origem_recorrencia_id = new.id
       and concluida_em is null and excluida_em is null and updated_at = created_at;
    return new;
  end if;
  if new.recorrencia is null or new.excluida_em is not null or new.concluida_em is null or old.concluida_em is not null then
    return new;
  end if;
  if exists (select 1 from public.tarefas where origem_recorrencia_id = new.id) then return new; end if;
  v_base := coalesce(new.prazo, (now() at time zone 'America/Sao_Paulo')::date);
  v_prox := app.tarefas_proxima_data(v_base, new.recorrencia);
  if v_prox is null then return new; end if;
  v_ate := nullif(new.recorrencia ->> 'ate', '')::date;
  if v_ate is not null and v_prox > v_ate then return new; end if;
  insert into public.tarefas (projeto_id, parent_id, titulo, descricao_md, prioridade, responsavel_id, inicio, prazo, prazo_hora,
                              ordem, etiquetas, campos, recorrencia, mentorado_email, origem_recorrencia_id, criado_por)
  values (new.projeto_id, new.parent_id, new.titulo, new.descricao_md, new.prioridade, new.responsavel_id,
          case when new.inicio is not null then new.inicio + (v_prox - v_base) end, v_prox, new.prazo_hora,
          new.ordem, new.etiquetas, new.campos, new.recorrencia, new.mentorado_email, new.id, new.criado_por)
  returning id into v_id;
  insert into public.tarefas_checklist (tarefa_id, texto, feito, ordem)
    select v_id, texto, false, ordem from public.tarefas_checklist where tarefa_id = new.id;
  insert into public.tarefas_participantes (tarefa_id, user_id, papel)
    select v_id, user_id, papel from public.tarefas_participantes where tarefa_id = new.id;
  return new;
end $$;

-- Aviso de prazo considera o horário: "atrasada" no mesmo dia se o horário já passou (cron passa a rodar de hora em hora).
create or replace function app.tarefas_avisos_prazo() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje date := v_agora::date; n int := 0; r record; v_atrasada boolean;
begin
  for r in select id, titulo, responsavel_id, prazo, prazo_hora from public.tarefas
            where excluida_em is null and concluida_em is null and responsavel_id is not null
              and prazo is not null and prazo <= v_hoje and prazo >= v_hoje - 30 loop
    v_atrasada := r.prazo < v_hoje or (r.prazo_hora is not null and v_agora::time > r.prazo_hora);
    if v_atrasada and (r.prazo = v_hoje or extract(hour from v_agora) >= 8) then -- atraso de dias anteriores só a partir das 8h
      insert into public.tarefas_notificacoes (user_id, tipo, tarefa_id, texto, chave)
      values (r.responsavel_id, 'atrasada', r.id, left(r.titulo, 240), 'atrasada:' || r.id || ':' || r.prazo || ':' || coalesce(r.prazo_hora::text, ''))
      on conflict (chave) do nothing;
    elsif not v_atrasada and extract(hour from v_agora) >= 8 then
      insert into public.tarefas_notificacoes (user_id, tipo, tarefa_id, texto, chave)
      values (r.responsavel_id, 'prazo', r.id, left(r.titulo, 240), 'prazo:' || r.id || ':' || r.prazo)
      on conflict (chave) do nothing;
    end if;
    n := n + 1;
  end loop;
  delete from public.tarefas_notificacoes where created_at < now() - interval '90 days';
  return n;
end $$;
revoke all on function app.tarefas_proxima_data(date, jsonb) from public;
revoke all on function app.tarefas_recorrencia_valida(jsonb) from public;
-- O CHECK roda com o papel de quem grava: precisa poder executar a função de validação.
grant execute on function app.tarefas_recorrencia_valida(jsonb) to authenticated, service_role;
select cron.unschedule('tarefas-avisos-prazo');
select cron.schedule('tarefas-avisos-prazo', '5 * * * *', $$select app.tarefas_avisos_prazo()$$);
