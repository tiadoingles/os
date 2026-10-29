-- Financeiro › NF-e: espelho (somente leitura) das vendas do IULI com a situação da nota fiscal.
-- Preenchido pela Edge Function `iuli` (op sync, service_role); o OS só lê (aba financeiro).
-- A API de Vendas do IULI não traz número, PDF nem XML da nota: a tela abre a venda no IULI para baixar.

create table if not exists public.fin_nfe (
  iuli_id bigint primary key,                 -- sale.id no IULI (link app.iuli.com.br/dashboard/sales-invoices/<id>)
  venda_codigo text,                          -- sale.custom_sale_id
  transacao text,                             -- sale.transaction_external_id (ex.: HP... da Hotmart)
  origem text,                                -- sale.source (HOTMART, MANUAL...)
  status_venda text,                          -- sale.status (APPROVED, COMPLETED, REFUNDED...)
  produto text,
  cliente_nome text,
  cliente_email text,
  valor_total numeric(14,2),
  valor_liquido numeric(14,2),
  competencia date,
  pagamento date,
  nf_emitida boolean not null default false,  -- invoice.issued
  nf_status text,                             -- invoice.status (EMITED, FAILED, SCHEDULED_SALE...)
  nf_agendada_para timestamptz,               -- invoice.scheduled_date
  criado_iuli timestamptz,
  atualizado_iuli timestamptz,
  sincronizado_em timestamptz not null default now()
);
create index if not exists fin_nfe_competencia_idx on public.fin_nfe (competencia desc);
create index if not exists fin_nfe_status_idx on public.fin_nfe (nf_status);

-- Meses do histórico já carregados (a sincronização carrega um por vez, do mais recente para trás).
create table if not exists public.fin_nfe_carga (
  mes date primary key,
  carregado_em timestamptz not null default now(),
  vendas integer not null default 0
);

alter table public.fin_nfe enable row level security;
alter table public.fin_nfe_carga enable row level security;
drop policy if exists fin_nfe_sel on public.fin_nfe;
create policy fin_nfe_sel on public.fin_nfe for select to authenticated using (app.tem_area('financeiro'));
revoke insert, update, delete on public.fin_nfe from anon, authenticated;
revoke all on public.fin_nfe_carga from anon, authenticated;
grant select on public.fin_nfe to authenticated;

insert into public.sync_status (chave, nome, tipo, cadencia_horas, ordem)
values ('iuli-nfe', 'IULI — notas fiscais das vendas (Financeiro)', 'server', 2, 32)
on conflict (chave) do nothing;

alter policy sync_status_sel_financeiro on public.sync_status
  using (app.tem_area('financeiro') and chave = any (array['hotmart-cobrancas', 'coproducao-planilha', 'iuli-nfe']));

-- A cada 2 horas (minuto 35).
select cron.unschedule('os-iuli-nfe-2h') where exists (select 1 from cron.job where jobname = 'os-iuli-nfe-2h');
select cron.schedule('os-iuli-nfe-2h', '35 */2 * * *', $$
  select net.http_post(
    url := 'https://hmvlkltyvyhlxfyaovpe.supabase.co/functions/v1/iuli',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', 'os-sync-tok-9Fx3Qm7Lp2Vw'),
    body := '{"op":"sync"}'::jsonb,
    timeout_milliseconds := 120000)
$$);
