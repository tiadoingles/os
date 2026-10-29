-- Financeiro: abas Hotmart, Cobrança e Co-Produção (29/10/2026).
-- Hotmart: API oficial sob demanda pela Edge Function `hotmart` (supabase/functions/hotmart), que
-- carrega as cobranças via public.fin_hotmart_carregar/finalizar e grava o histórico em
-- fin_hotmart_pedidos (a fila desenhada aqui foi desativada em 20261029b). Tudo restrito a
-- app.tem_area('financeiro').

-- 1. Cobranças (Hotmart + manuais) -------------------------------------------------------
create table if not exists public.fin_cobrancas (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'manual' check (origem in ('hotmart','manual')),
  chave_externa text unique,               -- hotmart: venda:<transação> | parcela:<subscriber_code>:<n>
  tipo text not null default 'manual' check (tipo in ('parcela','boleto_pix','assinatura','manual')),
  cliente_nome text,
  cliente_email text,
  cliente_telefone text,
  produto text,
  descricao text,
  valor numeric(14,2) not null check (valor >= 0),
  vencimento date not null,
  parcela_num int,
  parcelas_total int,
  forma_pagamento text,
  status text not null default 'aberto' check (status in ('aberto','pago','cancelado')),
  previsto boolean not null default false,  -- parcela futura projetada (ainda não gerada na Hotmart)
  status_hotmart text,
  transacao text,
  subscriber_code text,
  observacoes text,
  pago_em date,
  sync_execucao uuid,
  sincronizado_em timestamptz,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_cobrancas_venc on public.fin_cobrancas (status, vencimento);
alter table public.fin_cobrancas enable row level security;
drop policy if exists fin_cobrancas_financeiro on public.fin_cobrancas;
create policy fin_cobrancas_financeiro on public.fin_cobrancas for all to authenticated
  using (app.tem_area('financeiro')) with check (app.tem_area('financeiro'));
revoke all on public.fin_cobrancas from anon;
grant select, insert, update, delete on public.fin_cobrancas to authenticated;
drop trigger if exists fin_cobrancas_updated_at on public.fin_cobrancas;
create trigger fin_cobrancas_updated_at before update on public.fin_cobrancas for each row execute function app.set_updated_at();

-- Pelo OS só se cria/edita/apaga cobrança MANUAL; as da Hotmart só mudam pela sincronização
-- (exceto observações, que a equipe pode anotar).
create or replace function app.fin_cobrancas_guarda() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;   -- tarefa/SQL do servidor
  if tg_op = 'INSERT' then
    if new.origem <> 'manual' then raise exception 'Cobranças da Hotmart vêm só da sincronização'; end if;
    new.tipo := 'manual'; new.chave_externa := null; new.previsto := false;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.origem <> 'manual' then raise exception 'Cobrança da Hotmart não pode ser apagada pelo OS'; end if;
    return old;
  end if;
  if old.origem <> 'manual' then
    if (to_jsonb(new) - 'observacoes' - 'updated_at') <> (to_jsonb(old) - 'observacoes' - 'updated_at') then
      raise exception 'Cobrança da Hotmart: só dá para editar as observações';
    end if;
  elsif new.origem <> 'manual' then
    raise exception 'Não dá para mudar a origem da cobrança';
  end if;
  return new;
end $$;
drop trigger if exists fin_cobrancas_guarda on public.fin_cobrancas;
create trigger fin_cobrancas_guarda before insert or update or delete on public.fin_cobrancas
  for each row execute function app.fin_cobrancas_guarda();

-- Carga da Hotmart (chamada só pela tarefa agendada, via execute_sql como postgres).
-- p_tipo 'vendas' — TSV: transacao, status, order_date_ms, nome, email, produto, valor,
--   parcelas_total, parcela_num, forma (payment.type), metodo (payment.method)
-- p_tipo 'parcelas' — TSV: subscriber_code, status_assinatura, billing_type, produto, nome, email,
--   telefone, valor_parcela, ultima_parcela, max_parcelas, ultima_inicio_ms, status_ultima, transacao_ultima
create or replace function public.fin_hotmart_carregar(p_execucao uuid, p_tipo text, p_tsv text)
returns int language plpgsql security definer set search_path = public as $$
declare
  l text; c text[]; n int := 0; k int; venc date; tot int; ult int; ini timestamptz;
  fuso constant text := 'America/Sao_Paulo';
begin
  if p_tipo not in ('vendas','parcelas') then raise exception 'tipo inválido: %', p_tipo; end if;
  for l in select unnest(string_to_array(coalesce(p_tsv,''), E'\n')) loop
    if btrim(l) = '' then continue; end if;
    c := string_to_array(l, E'\t');
    if p_tipo = 'vendas' then
      -- WAITING_PAYMENT / PRINTED_BILLET = em aberto; OVERDUE = vencido. Outros status: ignora.
      if c[2] not in ('WAITING_PAYMENT','PRINTED_BILLET','OVERDUE') or nullif(c[1],'') is null then continue; end if;
      venc := (to_timestamp(c[3]::bigint / 1000.0) at time zone fuso)::date;
      insert into fin_cobrancas as f (origem, chave_externa, tipo, cliente_nome, cliente_email, produto, descricao,
        valor, vencimento, parcela_num, parcelas_total, forma_pagamento, status, previsto, status_hotmart, transacao,
        sync_execucao, sincronizado_em)
      values ('hotmart', 'venda:' || c[1], case when nullif(c[9],'')::int > 0 then 'parcela' else 'boleto_pix' end,
        nullif(c[4],''), lower(nullif(c[5],'')), nullif(c[6],''),
        case when c[2] = 'OVERDUE' then 'Pagamento vencido na Hotmart' else 'Aguardando pagamento na Hotmart' end,
        coalesce(nullif(c[7],'')::numeric, 0), venc, nullif(c[9],'')::int, nullif(c[8],'')::int,
        nullif(concat_ws(' · ', nullif(c[10],''), nullif(c[11],'')), ''), 'aberto', false, c[2], c[1], p_execucao, now())
      on conflict (chave_externa) do update set tipo = excluded.tipo, cliente_nome = excluded.cliente_nome,
        cliente_email = excluded.cliente_email, produto = excluded.produto, descricao = excluded.descricao,
        valor = excluded.valor, vencimento = excluded.vencimento, parcela_num = excluded.parcela_num,
        parcelas_total = excluded.parcelas_total, forma_pagamento = excluded.forma_pagamento, status = 'aberto',
        previsto = false, status_hotmart = excluded.status_hotmart, sync_execucao = p_execucao, sincronizado_em = now();
      n := n + 1;
    else
      -- Parcelamento inteligente / assinatura ativa: projeta as próximas parcelas (mensais) a partir
      -- da última gerada. A parcela atual não paga entra pela carga de 'vendas' (status OVERDUE).
      if c[2] not in ('ACTIVE','DELAYED','OVERDUE') or nullif(c[1],'') is null then continue; end if;
      ult := coalesce(nullif(c[9],'')::int, 0);
      tot := nullif(c[10],'')::int;
      ini := to_timestamp(nullif(c[11],'')::bigint / 1000.0);
      if ini is null then continue; end if;
      for k in (ult + 1) .. coalesce(tot, ult + 1) loop    -- assinatura sem fim: só a próxima
        venc := ((ini at time zone fuso) + make_interval(months => k - ult))::date;
        insert into fin_cobrancas as f (origem, chave_externa, tipo, cliente_nome, cliente_email, cliente_telefone,
          produto, descricao, valor, vencimento, parcela_num, parcelas_total, forma_pagamento, status, previsto,
          status_hotmart, subscriber_code, sync_execucao, sincronizado_em)
        values ('hotmart', 'parcela:' || c[1] || ':' || k, case when c[3] = 'SUBSCRIPTION' then 'assinatura' else 'parcela' end,
          nullif(c[5],''), lower(nullif(c[6],'')), nullif(c[7],''), nullif(c[4],''),
          case when c[3] = 'SUBSCRIPTION' then 'Próxima cobrança da assinatura' else 'Parcela prevista (parcelamento inteligente)' end,
          coalesce(nullif(c[8],'')::numeric, 0), venc, k, tot, 'Hotmart', 'aberto', true, c[2], c[1], p_execucao, now())
        on conflict (chave_externa) do update set cliente_nome = excluded.cliente_nome, cliente_email = excluded.cliente_email,
          cliente_telefone = excluded.cliente_telefone, produto = excluded.produto, valor = excluded.valor,
          vencimento = excluded.vencimento, parcelas_total = excluded.parcelas_total, status = 'aberto', previsto = true,
          status_hotmart = excluded.status_hotmart, sync_execucao = p_execucao, sincronizado_em = now();
        n := n + 1;
      end loop;
    end if;
  end loop;
  return n;
end $$;

-- Fecha a carga: o que a Hotmart não devolveu mais nesta execução saiu da lista (foi pago,
-- cancelado ou reembolsado) e é apagado. Só roda se a carga trouxe alguma linha.
create or replace function public.fin_hotmart_finalizar(p_execucao uuid, p_detalhe text)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; total int;
begin
  select count(*) into total from fin_cobrancas where sync_execucao = p_execucao;
  if total > 0 then
    delete from fin_cobrancas where origem = 'hotmart' and sync_execucao is distinct from p_execucao;
    get diagnostics n = row_count;
  end if;
  update sync_status set ultima_execucao_em = now(), ultimo_status = case when total > 0 then 'ok' else 'erro' end,
    ultimo_detalhe = coalesce(p_detalhe, '') || case when total > 0 then format(' · %s em aberto, %s saíram da lista', total, n)
                                                    else ' · nada carregado; lista anterior mantida' end
  where chave = 'hotmart-cobrancas';
  return total;
end $$;
revoke all on function public.fin_hotmart_carregar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fin_hotmart_finalizar(uuid, text) from public, anon, authenticated;

-- 2. Fila de pedidos à Hotmart (perguntas, consultas e ações) ----------------------------
create table if not exists public.fin_hotmart_pedidos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('pergunta','consulta','acao','sync')),
  acao text,                                  -- slug do botão (ver financeiro/hotmart.js)
  rotulo text,                                -- texto do botão, para o histórico
  parametros jsonb not null default '{}'::jsonb,
  pergunta text,
  status text not null default 'pendente' check (status in ('pendente','processando','concluido','erro','cancelado')),
  resposta text,                              -- markdown curto
  resposta_dados jsonb,                       -- tabela opcional: {colunas:[...], linhas:[[...]]}
  erro text,
  confirmado_em timestamptz,                  -- obrigatório para tipo 'acao'
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  created_at timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  constraint fin_hotmart_pedidos_acao_confirmada check (tipo <> 'acao' or confirmado_em is not null),
  constraint fin_hotmart_pedidos_acao_valida check (tipo <> 'acao' or acao in
    ('cancelar_assinatura','reativar_assinatura','mudar_dia_cobranca','criar_cupom','apagar_cupom','gerar_negociacao'))
);
create index if not exists fin_hotmart_pedidos_fila on public.fin_hotmart_pedidos (status, created_at);
alter table public.fin_hotmart_pedidos enable row level security;
drop policy if exists fin_hotmart_pedidos_sel on public.fin_hotmart_pedidos;
create policy fin_hotmart_pedidos_sel on public.fin_hotmart_pedidos for select to authenticated using (app.tem_area('financeiro'));
drop policy if exists fin_hotmart_pedidos_ins on public.fin_hotmart_pedidos;
create policy fin_hotmart_pedidos_ins on public.fin_hotmart_pedidos for insert to authenticated
  with check (app.tem_area('financeiro') and criado_por = auth.uid() and status = 'pendente');
drop policy if exists fin_hotmart_pedidos_upd on public.fin_hotmart_pedidos;
create policy fin_hotmart_pedidos_upd on public.fin_hotmart_pedidos for update to authenticated
  using (app.tem_area('financeiro')) with check (app.tem_area('financeiro'));
revoke all on public.fin_hotmart_pedidos from anon;
grant select, insert, update on public.fin_hotmart_pedidos to authenticated;

-- Pelo OS um pedido só pode ser CANCELADO enquanto está pendente; o resto é da tarefa.
create or replace function app.fin_hotmart_pedidos_guarda() returns trigger language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.resposta := null; new.resposta_dados := null; new.erro := null; new.iniciado_em := null; new.concluido_em := null;
    return new;
  end if;
  if old.status = 'pendente' and new.status = 'cancelado'
     and (to_jsonb(new) - 'status' - 'concluido_em') = (to_jsonb(old) - 'status' - 'concluido_em') then
    new.concluido_em := now();
    return new;
  end if;
  raise exception 'Só dá para cancelar um pedido que ainda está na fila';
end $$;
drop trigger if exists fin_hotmart_pedidos_guarda on public.fin_hotmart_pedidos;
create trigger fin_hotmart_pedidos_guarda before insert or update on public.fin_hotmart_pedidos
  for each row execute function app.fin_hotmart_pedidos_guarda();

-- 3. Co-Produção: espelho da planilha "Calculo Investimento - Tia do Inglês" (aba Base) ---
create table if not exists public.fin_coproducao (
  id int primary key default 1 check (id = 1),
  ciclos jsonb not null default '[]'::jsonb,
  total jsonb,
  funis jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.fin_coproducao enable row level security;
drop policy if exists fin_coproducao_sel on public.fin_coproducao;
create policy fin_coproducao_sel on public.fin_coproducao for select to authenticated using (app.tem_area('financeiro'));
revoke all on public.fin_coproducao from anon;
grant select on public.fin_coproducao to authenticated;

-- 4. Status das sincronizações (lidos pelo Financeiro) -----------------------------------
insert into public.sync_status (chave, nome, tipo, cadencia_horas, ordem) values
  ('hotmart-cobrancas', 'Hotmart — cobranças em aberto (Financeiro)', 'server', 6, 30),
  ('coproducao-planilha', 'Co-Produção — planilha Calculo Investimento', 'server', 24, 31)
on conflict (chave) do nothing;
drop policy if exists sync_status_sel_financeiro on public.sync_status;
create policy sync_status_sel_financeiro on public.sync_status for select to authenticated
  using (app.tem_area('financeiro') and chave in ('hotmart-cobrancas','coproducao-planilha'));

-- Pedido de "Atualizar da Hotmart" feito pelo OS: marca solicitado_em (a tarefa olha esse campo).
create or replace function public.fin_hotmart_pedir_sync() returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.tem_area('financeiro') then raise exception 'sem permissão'; end if;
  update sync_status set solicitado_em = now() where chave = 'hotmart-cobrancas';
end $$;
revoke all on function public.fin_hotmart_pedir_sync() from public, anon;
grant execute on function public.fin_hotmart_pedir_sync() to authenticated;
