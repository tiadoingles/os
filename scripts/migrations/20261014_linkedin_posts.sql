-- LinkedIn da Tia (aba Conteúdo): fila de posts com aprovação. Fase 2 = só fila; a
-- publicação pela API oficial do LinkedIn (Fase 3) usará linkedin_urn/erro/publicado_em.
-- Aplicada no Supabase como migration "linkedin_posts".

-- Mesmo helper da migration 20261009_papel_cs_helpers_e_rls.sql (create or replace,
-- definição idêntica): aqui só para o select desta tabela já excluir o papel cs.
create or replace function app.is_cs()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_user_role() = 'cs', false);
$$;
revoke all on function app.is_cs() from public, anon;
grant execute on function app.is_cs() to authenticated;

create table public.linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  pilar int not null check (pilar between 1 and 5),
  formato text not null default '',
  texto text not null default '',
  primeiro_comentario text null,
  agendado_para timestamptz null,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'aprovado', 'publicado', 'erro', 'descartado')),
  observacao text null,
  linkedin_urn text null,
  erro text null,
  publicado_em timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.linkedin_posts is
  'Fila de posts do LinkedIn pessoal da Tia (aba Conteúdo > LinkedIn). Pilares 1-5 do guia editorial (kb chave_externa linkedin:guia-editorial).';

create index linkedin_posts_agendado_idx on public.linkedin_posts (agendado_para);
create index linkedin_posts_status_idx on public.linkedin_posts (status);
create index linkedin_posts_created_idx on public.linkedin_posts (created_at desc);

create trigger linkedin_posts_updated_at before update on public.linkedin_posts
  for each row execute function app.set_updated_at();

alter table public.linkedin_posts enable row level security;
revoke all on public.linkedin_posts from anon;

-- Padrão do OS: leitura para logados, exceto o papel cs (não acessa Conteúdo);
-- escrita para editor/admin (app.is_editor(), que não inclui cs).
create policy linkedin_posts_sel on public.linkedin_posts
  for select to authenticated using (not app.is_cs());
create policy linkedin_posts_write on public.linkedin_posts
  for all to authenticated using (app.is_editor()) with check (app.is_editor());
