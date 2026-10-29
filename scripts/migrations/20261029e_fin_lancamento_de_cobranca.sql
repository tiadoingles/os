-- Cobrança → Fluxo de Caixa / DRE só por ação manual (decisão da Tia, 29/10/2026).
-- Nada entra sozinho: o botão "Lançar no Fluxo/DRE" da tela Cobrança cria um fin_lancamentos (origem 'manual',
-- conciliado) com cobranca_ref apontando para a cobrança. A referência é texto estável, não FK, porque as linhas da
-- Hotmart são apagadas e recriadas pela sincronização quando saem da lista:
--   'hotmart:<chave_externa>' (cobrança da Hotmart) | 'manual:<id>' (cobrança manual).
-- Índice único entre os lançamentos ativos impede lançar a mesma cobrança duas vezes.
alter table public.fin_lancamentos add column if not exists cobranca_ref text;
create unique index if not exists fin_lancamentos_cobranca_ref_uniq
  on public.fin_lancamentos (cobranca_ref) where cobranca_ref is not null and cancelado_em is null;
