-- IA: economia de tokens (29/10/2026). Edge Functions "ai" e "hotmart".
-- 1) ai_usage_log ganha os tokens de cache do prompt (escrita/leitura) para o custo ficar exato, e o user_id de quem
--    chamou (vem do JWT; null em rotinas sem usuário, ex.: sync) para o teto diário por usuário
--    (app_config.ia_teto_diario_brl_por_usuario, texto com valor em R$; sem a chave = sem teto; ADM fica de fora).
-- 2) ai_respostas_cache: respostas reaproveitadas de perguntas idênticas (24 h) às ações "pergunta" da função "ai".
--    Só a service_role usa (RLS ligado e sem policy = nenhum acesso por anon/authenticated).

alter table public.ai_usage_log
  add column if not exists cache_write_tokens int not null default 0,
  add column if not exists cache_read_tokens int not null default 0,
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists ai_usage_log_user_dia_idx on public.ai_usage_log (user_id, criado_em) where user_id is not null;

create table if not exists public.ai_respostas_cache (
  hash text primary key,
  acao text not null,
  resposta jsonb not null,
  criado_em timestamptz not null default now()
);
create index if not exists ai_respostas_cache_criado_em_idx on public.ai_respostas_cache (criado_em);
alter table public.ai_respostas_cache enable row level security;
revoke all on public.ai_respostas_cache from anon, authenticated;
