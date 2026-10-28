-- Aplicado via MCP do Supabase em 28/10/2026 como `financeiro_fundacao_craft` + `financeiro_saldos_ate`.
-- Base anterior: migration `financeiro_fluxo_caixa` (fin_contas, fin_dre_grupos, fin_dre_categorias com 129 seeds,
-- fin_importacoes, fin_lancamentos; RLS app.tem_area('financeiro')). Spec: docs/financeiro-spec.md.

-- 1) Relatório de Vendas
create table public.fin_vendas (
  id uuid primary key default gen_random_uuid(),
  plataforma text not null check (length(trim(plataforma)) between 2 and 80),
  produto text,
  transacao text,
  status text,
  data_competencia date not null,
  data_pagamento date,
  bruto numeric(14,2) not null default 0,
  reembolso numeric(14,2) not null default 0 check (reembolso >= 0),
  coproducao numeric(14,2) not null default 0 check (coproducao >= 0),
  taxa_processamento numeric(14,2) not null default 0 check (taxa_processamento >= 0),
  taxa_streaming numeric(14,2) not null default 0 check (taxa_streaming >= 0),
  liquido numeric(14,2) generated always as (bruto - reembolso - coproducao - taxa_processamento - taxa_streaming) stored,
  importacao_id uuid references public.fin_importacoes(id) on delete set null,
  hash text not null,
  dados jsonb,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index fin_vendas_plataforma_hash_uq on public.fin_vendas (plataforma, hash);
create index fin_vendas_competencia_idx on public.fin_vendas (data_competencia);
create index fin_vendas_pagamento_idx on public.fin_vendas (plataforma, data_pagamento);
alter table public.fin_vendas enable row level security;
revoke all on public.fin_vendas from anon;
grant select, insert, update, delete on public.fin_vendas to authenticated;
create policy fin_vendas_financeiro on public.fin_vendas for all to authenticated
  using (app.tem_area('financeiro')) with check (app.tem_area('financeiro'));

-- 2) Categorias fora da DRE (Craft: tag FORA_DRE:)
alter table public.fin_dre_categorias alter column grupo_id drop not null;
alter table public.fin_dre_categorias add column fora_dre boolean not null default false;
alter table public.fin_dre_categorias add constraint fin_dre_categorias_fora_dre_grupo
  check ((fora_dre and grupo_id is null) or (not fora_dre and grupo_id is not null));
insert into public.fin_dre_categorias (grupo_id, default_key, nome, nome_padrao, ordem, ativa, fora_dre) values
  (null, 'FORA_DRE:TRANSFERENCIA', 'Transferência entre contas', 'Transferência entre contas', 1, true, true),
  (null, 'FORA_DRE:REPASSE_PLATAFORMA', 'Repasse de plataforma (Hotmart, Eduzz...)', 'Repasse de plataforma (Hotmart, Eduzz...)', 2, true, true),
  (null, 'FORA_DRE:FATURA_CARTAO', 'Pagamento de fatura do cartão', 'Pagamento de fatura do cartão', 3, true, true),
  (null, 'FORA_DRE:APORTE_SOCIOS', 'Aporte de sócios', 'Aporte de sócios', 4, true, true),
  (null, 'FORA_DRE:EMPRESTIMO_PRINCIPAL', 'Empréstimos (entrada ou amortização do principal)', 'Empréstimos (entrada ou amortização do principal)', 5, true, true),
  (null, 'FORA_DRE:APLICACAO_RESGATE', 'Aplicação e resgate financeiro', 'Aplicação e resgate financeiro', 6, true, true),
  (null, 'FORA_DRE:OUTROS', 'Outros (fora da DRE)', 'Outros (fora da DRE)', 7, true, true);

-- 3) Lançamentos
alter table public.fin_lancamentos
  add column cancelado_em timestamptz,
  add column saldo_extrato numeric(14,2),
  add column evidencia jsonb;
create index fin_lancamentos_pendentes_idx on public.fin_lancamentos (conciliado, data) where cancelado_em is null;

-- 4) Importações
alter table public.fin_importacoes
  add column plataforma text,
  add column periodo_inicio date,
  add column periodo_fim date,
  add column total_linhas integer not null default 0,
  add column processadas integer not null default 0,
  add column avisos jsonb,
  add column updated_at timestamptz not null default now();
alter table public.fin_importacoes add constraint fin_importacoes_status_check
  check (status in ('previa', 'processando', 'concluida', 'falhou'));

-- 5) updated_at
create trigger fin_contas_updated_at before update on public.fin_contas for each row execute function app.set_updated_at();
create trigger fin_dre_categorias_updated_at before update on public.fin_dre_categorias for each row execute function app.set_updated_at();
create trigger fin_dre_grupos_updated_at before update on public.fin_dre_grupos for each row execute function app.set_updated_at();
create trigger fin_importacoes_updated_at before update on public.fin_importacoes for each row execute function app.set_updated_at();
create trigger fin_lancamentos_updated_at before update on public.fin_lancamentos for each row execute function app.set_updated_at();
create trigger fin_vendas_updated_at before update on public.fin_vendas for each row execute function app.set_updated_at();

-- 6) Estrutura protegida
create or replace function app.fin_dre_grupos_guarda() returns trigger language plpgsql set search_path = public as $$
begin
  if new.code is distinct from old.code or new.ordem is distinct from old.ordem or new.tipo is distinct from old.tipo
     or new.nome_padrao is distinct from old.nome_padrao or new.id is distinct from old.id then
    raise exception 'A ordem e as fórmulas da DRE são protegidas: só o nome da linha pode mudar.';
  end if;
  if length(trim(coalesce(new.nome, ''))) = 0 then new.nome := old.nome_padrao; end if;
  return new;
end $$;
create trigger fin_dre_grupos_guarda before update on public.fin_dre_grupos for each row execute function app.fin_dre_grupos_guarda();

create or replace function app.fin_dre_categorias_guarda() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.default_key is distinct from old.default_key or new.nome_padrao is distinct from old.nome_padrao
       or new.fora_dre is distinct from old.fora_dre or (old.default_key is not null and new.grupo_id is distinct from old.grupo_id) then
      raise exception 'Categoria padrão: só o nome, a ordem e o status (ativa/arquivada) podem mudar.';
    end if;
    if new.grupo_id is not null and exists (select 1 from public.fin_dre_grupos g where g.id = new.grupo_id and g.tipo = 'formula') then
      raise exception 'Linhas de cálculo fixo não recebem categorias.';
    end if;
  else
    if new.default_key is not null or new.nome_padrao is not null then
      raise exception 'Categorias novas são personalizadas (sem chave padrão).';
    end if;
    if new.grupo_id is not null and exists (select 1 from public.fin_dre_grupos g where g.id = new.grupo_id and g.tipo = 'formula') then
      raise exception 'Linhas de cálculo fixo não recebem categorias.';
    end if;
  end if;
  if length(trim(coalesce(new.nome, ''))) = 0 then raise exception 'Informe o nome da categoria.'; end if;
  return new;
end $$;
create trigger fin_dre_categorias_guarda before insert or update on public.fin_dre_categorias for each row execute function app.fin_dre_categorias_guarda();

-- 7) Restaurar modelo padrão
create or replace function public.fin_restaurar_estrutura_padrao() returns void language plpgsql security invoker set search_path = public as $$
begin
  if not app.tem_area('financeiro') then raise exception 'Sem acesso ao Financeiro.'; end if;
  update public.fin_dre_grupos set nome = nome_padrao where nome is distinct from nome_padrao;
  update public.fin_dre_categorias set nome = nome_padrao, ativa = true where default_key is not null and (nome is distinct from nome_padrao or not ativa);
  update public.fin_dre_categorias set ativa = false where default_key is null and ativa;
end $$;
revoke all on function public.fin_restaurar_estrutura_padrao() from public, anon;
grant execute on function public.fin_restaurar_estrutura_padrao() to authenticated;

-- 8) Saldos antes de uma data (migration financeiro_saldos_ate)
create or replace function public.fin_saldos_ate(p_data date)
returns table (conta_id uuid, saldo_base numeric, movimentado numeric, saldo numeric)
language sql stable security invoker set search_path = public as $$
  select c.id, c.saldo_base,
         coalesce(sum(l.valor) filter (where l.id is not null), 0) as movimentado,
         c.saldo_base + coalesce(sum(l.valor) filter (where l.id is not null), 0) as saldo
  from public.fin_contas c
  left join public.fin_lancamentos l
    on l.conta_id = c.id and l.conciliado and l.cancelado_em is null and l.origem <> 'cartao' and l.data < p_data
  group by c.id, c.saldo_base;
$$;
revoke all on function public.fin_saldos_ate(date) from public, anon;
grant execute on function public.fin_saldos_ate(date) to authenticated;

-- 9) Dedup da importação (aplicado em 28/10/2026): o índice deixou de ser parcial para o upsert/insert com
--    onConflict "conta_id,hash" funcionar no PostgREST. hash nulo (lançamento manual) continua livre (NULLs são distintos).
--    Efeito: lançamento cancelado (cancelado_em) segura o hash — a mesma linha do extrato não volta numa reimportação.
drop index if exists public.fin_lancamentos_hash_uq;
create unique index fin_lancamentos_hash_uq on public.fin_lancamentos (conta_id, hash);
