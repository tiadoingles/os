-- CS / Suporte · Controle de Ativações (#/cs/ativacoes) e engajamento no WhatsApp na Ficha do Mentorado.
-- Pedido da Tia, 19/10/2026: ver há quantos dias foi o último contato no WhatsApp com cada mentorado (cuidado > 15 dias,
-- urgente > 30) e o nível de engajamento; painel com quadrantes verde (< 15), amarelo (15 a 30) e vermelho (> 30).
-- Fonte: tarefa local "sync-clint-ficha-os" (conector MCP do Clint), cubo Message: mensagens por dia, por mentorado e por
-- quem enviou (aluna = Cliente, equipe = Atendente), só origem "Chat" e "Fora da Clint" (campanha/automação NÃO conta como
-- contato). Grava por cs_whatsapp_carregar (texto: email TAB dia AAAA-MM-DD TAB Cliente|Atendente TAB quantidade).
-- Regras (cs_ativacoes):
--   ultimo_contato  = último dia com mensagem da aluna ou da equipe (cs_whatsapp_dia); se não houver no período
--                     carregado, usa a última mensagem das conversas do Clint (cs_clint.conversas) como aproximação.
--   faixa           = verde (< 15 dias), amarelo (15 a 30), vermelho (> 30 ou sem contato registrado)
--   engajamento     = dias com mensagem DA ALUNA nos últimos 30: alto (>= 4), medio (2-3), baixo (1), sem_resposta (0)
-- Dias contados no fuso America/Sao_Paulo.

create table if not exists public.cs_whatsapp_dia (
  mentorado_email text not null,
  dia date not null,
  msgs_aluna integer not null default 0,
  msgs_equipe integer not null default 0,
  sincronizado_em timestamptz not null default now(),
  primary key (mentorado_email, dia)
);
create index if not exists cs_whatsapp_dia_dia_idx on public.cs_whatsapp_dia (dia);

alter table public.cs_whatsapp_dia enable row level security;
drop policy if exists cs_whatsapp_dia_sel on public.cs_whatsapp_dia;
create policy cs_whatsapp_dia_sel on public.cs_whatsapp_dia for select to authenticated using (app.tem_area('cs'));
revoke all on public.cs_whatsapp_dia from anon;
revoke insert, update, delete, truncate, references, trigger on public.cs_whatsapp_dia from authenticated;
grant select on public.cs_whatsapp_dia to authenticated;

-- Carga (só service_role / MCP do Supabase). Substitui a contagem do dia+tipo informado (reprocessar o mesmo dia é seguro).
create or replace function public.cs_whatsapp_carregar(p_tsv text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare linha text; campos text[]; chave text; e text; d date; qtd int := 0; ignorados int := 0; n int;
begin
  for linha in select x from regexp_split_to_table(coalesce(p_tsv, ''), '\r?\n') x loop
    if btrim(linha) = '' then continue; end if;
    campos := string_to_array(linha, E'\t');
    e := lower(btrim(campos[1]));
    chave := null;
    select lower(btrim(m.email)) into chave from public.cs_mentorados m where lower(btrim(m.email)) = e limit 1;
    if chave is null then
      select v.mentorado_email into chave from public.cs_mentorado_vinculos v where v.tipo = 'email' and v.valor = e limit 1;
    end if;
    begin d := left(btrim(campos[2]), 10)::date; exception when others then d := null; end;
    n := case when btrim(coalesce(campos[4], '')) ~ '^\d+$' then btrim(campos[4])::int end;
    if chave is null or d is null or n is null or lower(btrim(coalesce(campos[3], ''))) not in ('cliente', 'atendente') then
      ignorados := ignorados + 1; continue;
    end if;
    insert into public.cs_whatsapp_dia (mentorado_email, dia, msgs_aluna, msgs_equipe)
    values (chave, d, case when lower(btrim(campos[3])) = 'cliente' then n else 0 end, case when lower(btrim(campos[3])) = 'atendente' then n else 0 end)
    on conflict (mentorado_email, dia) do update set
      msgs_aluna = case when lower(btrim(campos[3])) = 'cliente' then excluded.msgs_aluna else cs_whatsapp_dia.msgs_aluna end,
      msgs_equipe = case when lower(btrim(campos[3])) = 'atendente' then excluded.msgs_equipe else cs_whatsapp_dia.msgs_equipe end,
      sincronizado_em = now();
    qtd := qtd + 1;
  end loop;
  return jsonb_build_object('linhas', qtd, 'ignorados', ignorados);
end $$;
revoke all on function public.cs_whatsapp_carregar(text) from public, anon, authenticated;
grant execute on function public.cs_whatsapp_carregar(text) to service_role;

-- Métricas por mentorado (security invoker: RLS da aba CS vale para todas as tabelas lidas). cobertura_desde = primeiro dia
-- com contagem diária: depois dele só mensagem de chat conta como contato; a data da conversa (cs_clint) só é usada se
-- for anterior (senão seria campanha/automação deixando a pessoa "verde" sem ninguém falar com ela).
create or replace function public.cs_ativacoes()
returns table (
  email text, nome text, status text, guardiao text, telefone text, data_final date,
  ultimo_contato date, fonte_ultimo text, dias_sem_contato integer, cobertura_desde date,
  ultima_msg_aluna date, dias_sem_msg_aluna integer,
  msgs_aluna_30d integer, msgs_equipe_30d integer, dias_ativos_aluna_30d integer,
  engajamento text, faixa text
)
language sql
stable
security invoker
set search_path = public
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  cob as (select min(dia) as desde from public.cs_whatsapp_dia),
  m as (
    select distinct on (lower(btrim(x.email))) lower(btrim(x.email)) as e, x.nome, x.status, x.guardiao, x.telefone, x.data_final
    from public.cs_mentorados x where x.email like '%@%' order by lower(btrim(x.email)), x.linha
  ),
  w as (
    select w.mentorado_email as e,
      max(w.dia) filter (where w.msgs_aluna + w.msgs_equipe > 0) as ultimo,
      max(w.dia) filter (where w.msgs_aluna > 0) as ultimo_aluna,
      coalesce(sum(w.msgs_aluna) filter (where w.dia > (select d from hoje) - 30), 0)::int as a30,
      coalesce(sum(w.msgs_equipe) filter (where w.dia > (select d from hoje) - 30), 0)::int as e30,
      count(*) filter (where w.msgs_aluna > 0 and w.dia > (select d from hoje) - 30)::int as dias30
    from public.cs_whatsapp_dia w group by 1
  ),
  conv as (
    select c.mentorado_email as e,
      max(((x->>'last_message_at')::timestamptz at time zone 'America/Sao_Paulo')::date) as ultimo
    from public.cs_clint c, jsonb_array_elements(c.conversas) x
    where x->>'last_message_at' is not null group by 1
  ),
  base as (
    select m.*, w.ultimo as w_ultimo, w.ultimo_aluna, coalesce(w.a30, 0) a30, coalesce(w.e30, 0) e30, coalesce(w.dias30, 0) dias30,
      case when (select desde from cob) is null or conv.ultimo < (select desde from cob) then conv.ultimo end as c_ultimo
    from m left join w on w.e = m.e left join conv on conv.e = m.e
  )
  select b.e, b.nome, b.status, b.guardiao, b.telefone, b.data_final,
    coalesce(b.w_ultimo, b.c_ultimo) as ultimo_contato,
    case when b.w_ultimo is not null then 'mensagens' when b.c_ultimo is not null then 'conversas' end as fonte_ultimo,
    ((select d from hoje) - coalesce(b.w_ultimo, b.c_ultimo))::int as dias_sem_contato,
    (select desde from cob),
    b.ultimo_aluna, ((select d from hoje) - b.ultimo_aluna)::int,
    b.a30, b.e30, b.dias30,
    case when b.dias30 >= 4 then 'alto' when b.dias30 >= 2 then 'medio' when b.dias30 = 1 then 'baixo' else 'sem_resposta' end,
    case when coalesce(b.w_ultimo, b.c_ultimo) is null then 'vermelho'
         when (select d from hoje) - coalesce(b.w_ultimo, b.c_ultimo) > 30 then 'vermelho'
         when (select d from hoje) - coalesce(b.w_ultimo, b.c_ultimo) >= 15 then 'amarelo'
         else 'verde' end
  from base b;
$$;
revoke all on function public.cs_ativacoes() from public, anon;
grant execute on function public.cs_ativacoes() to authenticated;

-- Revisão do QA (19/10/2026): início da cobertura GRAVADO (cs_whatsapp_cobertura), não mais min(dia): a carga passa o
-- msg_desde em cs_whatsapp_carregar(p_tsv, p_desde) e a tabela guarda o menor. cs_ativacoes() lê dali.
create table if not exists public.cs_whatsapp_cobertura (
  id int primary key default 1 check (id = 1),
  desde date not null,
  atualizado_em timestamptz not null default now()
);
alter table public.cs_whatsapp_cobertura enable row level security;
drop policy if exists cs_whatsapp_cobertura_sel on public.cs_whatsapp_cobertura;
create policy cs_whatsapp_cobertura_sel on public.cs_whatsapp_cobertura for select to authenticated using (app.tem_area('cs'));
revoke all on public.cs_whatsapp_cobertura from anon;
revoke insert, update, delete, truncate, references, trigger on public.cs_whatsapp_cobertura from authenticated;
grant select on public.cs_whatsapp_cobertura to authenticated;
-- (cs_whatsapp_carregar(text, date) e cs_ativacoes() com cob = cs_whatsapp_cobertura.desde: ver migration aplicada
--  "cs_ativacoes_cobertura_gravada"; corpo igual ao acima, trocando a origem de cob.desde e o parâmetro p_desde.)
