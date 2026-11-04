-- Gestão de Tarefas: caixinha "Só dias úteis" na repetição (pedido da Tia, 04/11/2026).
-- recorrencia ganha {"uteis": true}: diário conta só dias úteis; semanal/mensal que cair em sábado ou domingo
-- passa para a segunda-feira seguinte. Feriados não entram (só fim de semana).
-- Pendência conhecida (raro, a tela não permite): semanal só sáb/dom + dias úteis + a cada 2+ semanas.
-- O formato antigo {"freq":"dias_uteis"} continua aceito (= diário + uteis). Teste: teste_rls_tarefas_dias_uteis.sql.

create or replace function app.tarefas_recorrencia_valida(r jsonb) returns boolean
language sql immutable set search_path = public as $$
  select r is null or (
    jsonb_typeof(r) = 'object'
    and r ->> 'freq' in ('diaria', 'dias_uteis', 'semanal', 'mensal')
    and coalesce(r ->> 'intervalo', '1') ~ '^[1-9][0-9]{0,2}$'
    and coalesce(r ->> 'ate', '2000-01-01') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (not r ? 'uteis' or jsonb_typeof(r -> 'uteis') = 'boolean')
    and (not r ? 'dia' or (r ->> 'dia') ~ '^([1-9]|[12][0-9]|3[01])$')
    and (not r ? 'dias_semana' or (
          jsonb_typeof(r -> 'dias_semana') = 'array'
          and jsonb_array_length(r -> 'dias_semana') between 1 and 7
          and (select bool_and(x ~ '^[1-7]$') from jsonb_array_elements_text(r -> 'dias_semana') x))));
$$;

create or replace function app.tarefas_proxima_data(p_data date, p_rec jsonb) returns date
language plpgsql immutable set search_path = public as $$
declare
  n int := greatest(coalesce((p_rec ->> 'intervalo')::int, 1), 1);
  uteis boolean := coalesce((p_rec ->> 'uteis')::boolean, false) or p_rec ->> 'freq' = 'dias_uteis';
  d date := p_data; i int := 0; dias int[]; semana0 date := date_trunc('week', p_data::timestamp)::date;
  r date;
begin
  case p_rec ->> 'freq'
    when 'diaria', 'dias_uteis' then
      if not uteis then return p_data + n; end if;
      while i < n loop d := d + 1; if extract(isodow from d) < 6 then i := i + 1; end if; end loop;
      return d;
    when 'mensal' then
      -- Dia de referência ("dia", gravado na 1ª repetição): não escorrega quando um mês empurra para a segunda
      -- ou quando o mês é mais curto (31 -> 28 -> volta a 31).
      r := (date_trunc('month', p_data::timestamp) + make_interval(months => n))::date;
      r := r + (least(coalesce((p_rec ->> 'dia')::int, extract(day from p_data)::int),
                      extract(day from (r + interval '1 month' - interval '1 day'))::int) - 1);
    when 'semanal' then
      if p_rec ? 'dias_semana' then
        select array_agg(x::int) into dias from jsonb_array_elements_text(p_rec -> 'dias_semana') x
         where not uteis or x::int < 6;
        if dias is null then dias := array[1]; end if; -- só fim de semana marcado + dias úteis: vai para segunda
        for i in 1 .. 7 * n + 7 loop
          d := p_data + i;
          if extract(isodow from d)::int = any(dias)
             and ((date_trunc('week', d::timestamp)::date - semana0) / 7) % n = 0 then
            return d;
          end if;
        end loop;
        return null;
      end if;
      r := p_data + 7 * n;
    else return null;
  end case;
  -- Semanal/mensal com "só dias úteis": sábado/domingo passa para a segunda seguinte.
  if uteis and extract(isodow from r) >= 6 then r := r + (8 - extract(isodow from r)::int); end if;
  return r;
end $$;

-- Recorrência: a 1ª repetição mensal grava o dia de referência na recorrência da próxima ocorrência.
create or replace function app.tarefas_recorrencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_base date; v_prox date; v_id uuid; v_ate date; v_rec jsonb;
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
  v_rec := case when new.recorrencia ->> 'freq' = 'mensal' and not new.recorrencia ? 'dia'
                then new.recorrencia || jsonb_build_object('dia', extract(day from v_base)::int)
                else new.recorrencia end;
  v_prox := app.tarefas_proxima_data(v_base, v_rec);
  if v_prox is null then return new; end if;
  v_ate := nullif(new.recorrencia ->> 'ate', '')::date;
  if v_ate is not null and v_prox > v_ate then return new; end if;
  insert into public.tarefas (projeto_id, parent_id, titulo, descricao_md, prioridade, responsavel_id, inicio, prazo, prazo_hora,
                              ordem, etiquetas, campos, recorrencia, mentorado_email, origem_recorrencia_id, criado_por)
  values (new.projeto_id, new.parent_id, new.titulo, new.descricao_md, new.prioridade, new.responsavel_id,
          case when new.inicio is not null then new.inicio + (v_prox - v_base) end, v_prox, new.prazo_hora,
          new.ordem, new.etiquetas, new.campos, v_rec, new.mentorado_email, new.id, new.criado_por)
  returning id into v_id;
  insert into public.tarefas_checklist (tarefa_id, texto, feito, ordem)
    select v_id, texto, false, ordem from public.tarefas_checklist where tarefa_id = new.id;
  insert into public.tarefas_participantes (tarefa_id, user_id, papel)
    select v_id, user_id, papel from public.tarefas_participantes where tarefa_id = new.id;
  return new;
end $$;

revoke all on function app.tarefas_proxima_data(date, jsonb) from public;
revoke all on function app.tarefas_recorrencia_valida(jsonb) from public;
grant execute on function app.tarefas_recorrencia_valida(jsonb) to authenticated, service_role;
