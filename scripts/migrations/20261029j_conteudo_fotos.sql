-- Produtor de carrosséis, Fase 3: catálogo das fotos do Drive ("4. Materiais Visuais / 1. Fotos & Videos").
-- Preenchido pela Edge Function fotos-drive (op sync, service_role), que lê a listagem pública das pastas.
-- A imagem em si não é copiada: a função fotos-drive (op imagem) busca no Drive e devolve com CORS para o PNG.
-- Uso das fotos = referência foto.driveId dentro de conteudo_carrosseis.slides (não há coluna aqui).
create table public.conteudo_fotos (
  drive_id text primary key check (drive_id ~ '^[A-Za-z0-9_-]{10,80}$'),
  nome text not null,
  pasta text not null,
  pasta_id text not null,
  extensao text,
  largura int,
  altura int,
  etiquetas text[] not null default '{}',
  descricao text,
  ativo boolean not null default true,
  visto_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.conteudo_fotos is
  'Fotos do Drive (Fotos & Videos) para o Produtor de carrosséis. Sync pela Edge Function fotos-drive.';
create index conteudo_fotos_pasta_idx on public.conteudo_fotos (pasta);
create trigger conteudo_fotos_updated_at before update on public.conteudo_fotos
  for each row execute function app.set_updated_at();
alter table public.conteudo_fotos enable row level security;
revoke all on public.conteudo_fotos from anon;
grant select, update on public.conteudo_fotos to authenticated;
-- Leitura e edição de etiquetas/descrição/medidas: aba Conteúdo. Inserir/remover: só a sincronização (service_role).
create policy conteudo_fotos_sel on public.conteudo_fotos for select to authenticated using (app.tem_area('conteudo'));
create policy conteudo_fotos_upd on public.conteudo_fotos for update to authenticated
  using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
-- O front só muda etiquetas, descrição e medidas (a sincronização cuida do resto).
create or replace function app.conteudo_fotos_guarda() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.drive_id := old.drive_id; new.nome := old.nome; new.pasta := old.pasta; new.pasta_id := old.pasta_id;
    new.extensao := old.extensao; new.ativo := old.ativo; new.visto_em := old.visto_em; new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger conteudo_fotos_guarda before update on public.conteudo_fotos
  for each row execute function app.conteudo_fotos_guarda();
create trigger zz_os_atividade after insert or update or delete on public.conteudo_fotos
  for each row execute function app.os_atividade_registrar();
