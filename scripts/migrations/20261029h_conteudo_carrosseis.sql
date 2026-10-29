-- Produtor de carrosséis (Conteúdo > Produtor de carrosséis), Fase 2: histórico dos carrosséis gerados/editados.
-- Os slides ficam em jsonb no formato de MODELOS (conteudo/carrosseis.js); as fotos NÃO entram (só a referência
-- foto.id/ajustes; a imagem é escolhida de novo ao reabrir até a Fase 3 trazer o banco de fotos do Drive).
create table public.conteudo_carrosseis (
  id uuid primary key default gen_random_uuid(),
  tema text not null,
  tipo text not null default 'carrossel' check (tipo in ('carrossel', 'unico')),
  formato text,
  briefing jsonb not null default '{}'::jsonb,
  slides jsonb not null default '[]'::jsonb,
  legenda text,
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado', 'postado')),
  origem text not null default 'manual' check (origem in ('manual', 'ia')),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.conteudo_carrosseis is
  'Carrosséis/posts do Instagram montados no Produtor de carrosséis (aba Conteúdo). Guia: kb chave_externa carrossel:manual.';

create index conteudo_carrosseis_created_idx on public.conteudo_carrosseis (created_at desc);

create trigger conteudo_carrosseis_updated_at before update on public.conteudo_carrosseis
  for each row execute function app.set_updated_at();
create trigger zz_os_atividade after insert or update or delete on public.conteudo_carrosseis
  for each row execute function app.os_atividade_registrar();

alter table public.conteudo_carrosseis enable row level security;
revoke all on public.conteudo_carrosseis from anon;
grant select, insert, update, delete on public.conteudo_carrosseis to authenticated;
create policy conteudo_carrosseis_area on public.conteudo_carrosseis for all to authenticated
  using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
