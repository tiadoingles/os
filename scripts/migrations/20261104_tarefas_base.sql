-- Gestão de Tarefas (#/tarefas/*), Fase 1: setores, membros, projetos, status, tarefas, participantes,
-- checklist, comentários e links. Plano em docs/tarefas-spec.md.
-- Regras da Tia (04/11/2026):
--   * todo usuário logado abre a aba; cada um VÊ só as tarefas do(s) seu(s) setor(es) + as tarefas em que está envolvido;
--   * só quem está ENVOLVIDO (criador, responsável, participante) ALTERA a tarefa; comentar é de quem vê;
--   * ADM vê e altera tudo; setores/membros só o ADM; projetos/status = ADM ou gestor do setor.
-- Exclusão de tarefa pela tela = exclusão lógica (excluida_em), para o DESFAZER não perder checklist/comentários.
-- Teste: scripts/migrations/teste_rls_tarefas.sql. Reverter: scripts/migrations/rollback_tarefas_base.sql.

/* ============================ Tabelas ============================ */
create table public.tarefas_setores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  nome text not null,
  cor text not null default '#10b981',
  ordem int not null default 0,
  ativo boolean not null default true,
  gchat_space text, -- Fase 3: espaço do Google Chat (spaces/AAAA...). Não é segredo; a chave fica no secret da Edge Function.
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tarefas_setor_membros (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid not null references public.tarefas_setores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  papel text not null default 'membro' check (papel in ('membro', 'gestor')),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (setor_id, user_id)
);
create index tarefas_setor_membros_user_idx on public.tarefas_setor_membros (user_id);

create table public.tarefas_projetos (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid not null references public.tarefas_setores(id) on delete restrict,
  nome text not null,
  descricao_md text,
  cor text not null default '#10b981',
  ordem int not null default 0,
  arquivado boolean not null default false,
  clickup_id text unique,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tarefas_projetos_setor_idx on public.tarefas_projetos (setor_id);

create table public.tarefas_status (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.tarefas_projetos(id) on delete cascade,
  nome text not null,
  cor text not null default '#94a3b8',
  ordem int not null default 0,
  tipo text not null default 'aberto' check (tipo in ('aberto', 'andamento', 'concluido')),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tarefas_status_projeto_idx on public.tarefas_status (projeto_id, ordem);

create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid not null references public.tarefas_projetos(id) on delete restrict,
  setor_id uuid not null references public.tarefas_setores(id) on delete restrict, -- copiado do projeto (trigger)
  parent_id uuid references public.tarefas(id) on delete cascade,               -- subtarefa
  titulo text not null check (length(trim(titulo)) > 0),
  descricao_md text,
  status_id uuid references public.tarefas_status(id) on delete set null,
  prioridade text not null default 'normal' check (prioridade in ('urgente', 'alta', 'normal', 'baixa')),
  responsavel_id uuid references public.profiles(id) on delete set null,
  inicio date,
  prazo date,
  concluida_em timestamptz,
  ordem numeric not null default 0,
  etiquetas text[] not null default '{}',
  campos jsonb not null default '{}'::jsonb,
  recorrencia jsonb, -- Fase 2
  excluida_em timestamptz,
  clickup_id text unique,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tarefas_setor_idx on public.tarefas (setor_id) where excluida_em is null;
create index tarefas_projeto_idx on public.tarefas (projeto_id, ordem) where excluida_em is null;
create index tarefas_responsavel_idx on public.tarefas (responsavel_id) where excluida_em is null;
create index tarefas_parent_idx on public.tarefas (parent_id);
create index tarefas_prazo_idx on public.tarefas (prazo) where excluida_em is null and concluida_em is null;

create table public.tarefas_participantes (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tarefa_id, user_id)
);
create index tarefas_participantes_user_idx on public.tarefas_participantes (user_id);

create table public.tarefas_checklist (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  texto text not null check (length(trim(texto)) > 0),
  feito boolean not null default false,
  ordem numeric not null default 0,
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tarefas_checklist_tarefa_idx on public.tarefas_checklist (tarefa_id, ordem);

create table public.tarefas_comentarios (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  autor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  texto_md text not null check (length(trim(texto_md)) > 0),
  mencoes uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tarefas_comentarios_tarefa_idx on public.tarefas_comentarios (tarefa_id, created_at);

create table public.tarefas_links (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  titulo text,
  url text not null check (url ~* '^https?://'),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tarefas_links_tarefa_idx on public.tarefas_links (tarefa_id);

comment on table public.tarefas is 'Gestão de Tarefas (#/tarefas). Ver docs/tarefas-spec.md.';

/* ============================ Funções de permissão ============================ */
-- Membro do setor (ou ADM).
create or replace function app.tarefas_membro(p_setor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (
    select 1 from public.tarefas_setor_membros m where m.setor_id = p_setor and m.user_id = auth.uid());
$$;
-- Gestor do setor (ou ADM).
create or replace function app.tarefas_gestor(p_setor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (
    select 1 from public.tarefas_setor_membros m where m.setor_id = p_setor and m.user_id = auth.uid() and m.papel = 'gestor');
$$;
-- Envolvido: ADM, criador, responsável ou participante da tarefa OU da tarefa-mãe (subtarefa).
create or replace function app.tarefa_envolvido(p_tarefa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (
    select 1 from public.tarefas t
     where t.id in (p_tarefa, (select parent_id from public.tarefas where id = p_tarefa))
       and (t.criado_por = auth.uid() or t.responsavel_id = auth.uid()
            or exists (select 1 from public.tarefas_participantes p where p.tarefa_id = t.id and p.user_id = auth.uid())));
$$;
-- Vê a tarefa: envolvido ou membro do setor dela.
create or replace function app.tarefa_pode_ver(p_tarefa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.tarefa_envolvido(p_tarefa) or exists (
    select 1 from public.tarefas t where t.id = p_tarefa and app.tarefas_membro(t.setor_id));
$$;
-- Conjuntos calculados UMA vez por consulta (policies de listas grandes: tarefas e projetos).
create or replace function app.tarefas_meus_setores() returns setof uuid
language sql stable security definer set search_path = public as $$
  select setor_id from public.tarefas_setor_membros where user_id = auth.uid();
$$;
create or replace function app.tarefas_minhas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.tarefas where criado_por = auth.uid() or responsavel_id = auth.uid()
  union select tarefa_id from public.tarefas_participantes where user_id = auth.uid();
$$;
create or replace function app.tarefas_meus_projetos() returns setof uuid
language sql stable security definer set search_path = public as $$
  select projeto_id from public.tarefas where excluida_em is null
     and (id in (select app.tarefas_minhas()) or parent_id in (select app.tarefas_minhas()));
$$;
revoke all on function app.tarefas_membro(uuid), app.tarefas_gestor(uuid), app.tarefa_envolvido(uuid), app.tarefa_pode_ver(uuid),
  app.tarefas_meus_setores(), app.tarefas_minhas(), app.tarefas_meus_projetos() from public;
grant execute on function app.tarefas_membro(uuid), app.tarefas_gestor(uuid), app.tarefa_envolvido(uuid), app.tarefa_pode_ver(uuid),
  app.tarefas_meus_setores(), app.tarefas_minhas(), app.tarefas_meus_projetos() to authenticated, service_role;

/* ============================ Gatilhos de consistência ============================ */
-- Projeto novo ganha os 4 status padrão.
create or replace function app.tarefas_projeto_status_padrao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tarefas_status (projeto_id, nome, cor, ordem, tipo) values
    (new.id, 'A fazer', '#94a3b8', 1, 'aberto'),
    (new.id, 'Em andamento', '#3b82f6', 2, 'andamento'),
    (new.id, 'Em revisão', '#f59e0b', 3, 'andamento'),
    (new.id, 'Concluída', '#10b981', 4, 'concluido');
  return new;
end $$;

-- Tarefa: subtarefa herda o projeto da mãe; setor sempre = setor do projeto; status precisa ser do projeto
-- (vazio = 1º status); concluida_em acompanha o tipo do status; criador não muda.
create or replace function app.tarefas_preparar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A tarefa não pode ser subtarefa dela mesma'; end if;
    if tg_op = 'UPDATE' and exists (
        with recursive up(id, parent_id) as (
          select id, parent_id from public.tarefas where id = new.parent_id
          union all select t.id, t.parent_id from public.tarefas t join up on t.id = up.parent_id)
        select 1 from up where id = new.id) then
      raise exception 'Ciclo de subtarefas';
    end if;
    select projeto_id into new.projeto_id from public.tarefas where id = new.parent_id;
  end if;
  select setor_id into new.setor_id from public.tarefas_projetos where id = new.projeto_id;
  if new.setor_id is null then raise exception 'Projeto inexistente'; end if;
  if new.status_id is not null and not exists (
       select 1 from public.tarefas_status s where s.id = new.status_id and s.projeto_id = new.projeto_id) then
    new.status_id := null;
  end if;
  if new.status_id is null then
    select id into new.status_id from public.tarefas_status where projeto_id = new.projeto_id order by ordem limit 1;
  end if;
  select tipo into v_tipo from public.tarefas_status where id = new.status_id;
  if v_tipo = 'concluido' then
    if tg_op = 'INSERT' or old.concluida_em is null then new.concluida_em := coalesce(new.concluida_em, now()); end if;
  else
    new.concluida_em := null;
  end if;
  if tg_op = 'UPDATE' then new.criado_por := old.criado_por;
  elsif auth.uid() is not null and not app.is_admin() then new.criado_por := auth.uid(); -- ADM mantém (DESFAZER, importação)
  end if;
  return new;
end $$;

-- Mãe mudou de projeto: as subtarefas vão junto (o preparar acerta setor e status delas).
create or replace function app.tarefas_propagar_filhas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.projeto_id is distinct from old.projeto_id then
    update public.tarefas set projeto_id = new.projeto_id where parent_id = new.id;
  end if;
  return new;
end $$;

-- Projeto mudou de setor (só ADM): as tarefas vão junto.
create or replace function app.tarefas_projeto_mudou_setor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.setor_id is distinct from old.setor_id then
    if auth.uid() is not null and not app.is_admin() then raise exception 'Só o ADM muda o setor de um projeto'; end if;
    update public.tarefas set setor_id = new.setor_id where projeto_id = new.id;
  end if;
  return new;
end $$;

-- Status não muda de projeto.
create or replace function app.tarefas_status_guarda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.projeto_id := old.projeto_id;
  return new;
end $$;

-- Mudar a tarefa de projeto só para um projeto de setor em que a pessoa é membro.
create or replace function app.tarefas_guarda_projeto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.projeto_id is distinct from old.projeto_id and not app.tarefas_membro(new.setor_id) then
    raise exception 'Sem permissão para mover a tarefa para esse setor';
  end if;
  return new;
end $$;

-- Comentário: autor é sempre quem grava, e não muda.
create or replace function app.tarefas_comentario_guarda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- ADM mantém o autor (DESFAZER de comentário apagado reinsere o original).
    if auth.uid() is not null and not app.is_admin() then new.autor_id := auth.uid(); end if;
  else
    new.autor_id := old.autor_id; new.tarefa_id := old.tarefa_id; new.created_at := old.created_at;
  end if;
  return new;
end $$;

create trigger tarefas_projetos_status_padrao after insert on public.tarefas_projetos
  for each row execute function app.tarefas_projeto_status_padrao();
create trigger a_tarefas_preparar before insert or update on public.tarefas
  for each row execute function app.tarefas_preparar();
create trigger b_tarefas_guarda_projeto before update on public.tarefas
  for each row execute function app.tarefas_guarda_projeto();
create trigger tarefas_comentarios_guarda before insert or update on public.tarefas_comentarios
  for each row execute function app.tarefas_comentario_guarda();
create trigger c_tarefas_propagar_filhas after update of projeto_id on public.tarefas
  for each row execute function app.tarefas_propagar_filhas();
create trigger tarefas_projetos_setor after update of setor_id on public.tarefas_projetos
  for each row execute function app.tarefas_projeto_mudou_setor();
create trigger tarefas_status_guarda before update on public.tarefas_status
  for each row execute function app.tarefas_status_guarda();

-- updated_at + histórico de atividade em todas as tabelas.
do $$
declare t text;
begin
  foreach t in array array['tarefas_setores','tarefas_setor_membros','tarefas_projetos','tarefas_status','tarefas',
                           'tarefas_participantes','tarefas_checklist','tarefas_comentarios','tarefas_links'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger zz_os_atividade after insert or update or delete on public.%I for each row execute function app.os_atividade_registrar()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

/* ============================ RLS ============================ */
-- Setores: nome e cor não são sensíveis (todo logado lê, para mostrar o setor de uma tarefa em que foi envolvido);
-- quem é membro de quê vem de tarefas_setor_membros. Só ADM grava.
create policy tarefas_setores_ler on public.tarefas_setores for select to authenticated
  using (true);
create policy tarefas_setores_adm on public.tarefas_setores for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Membros: quem é do setor vê a lista do setor; cada um vê as próprias participações; só ADM grava.
create policy tarefas_membros_ler on public.tarefas_setor_membros for select to authenticated
  using (user_id = auth.uid() or app.tarefas_membro(setor_id));
create policy tarefas_membros_adm on public.tarefas_setor_membros for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Projetos e status: membros do setor (ou quem está envolvido em alguma tarefa do projeto) leem; gestor/ADM grava.
create policy tarefas_projetos_ler on public.tarefas_projetos for select to authenticated
  using ((select app.is_admin()) or setor_id in (select app.tarefas_meus_setores())
         or id in (select app.tarefas_meus_projetos()));
create policy tarefas_projetos_gravar on public.tarefas_projetos for insert to authenticated
  with check (app.tarefas_gestor(setor_id));
create policy tarefas_projetos_editar on public.tarefas_projetos for update to authenticated
  using (app.tarefas_gestor(setor_id)) with check (app.tarefas_gestor(setor_id));
-- Gestor exclui projeto vazio (DESFAZER de "criar projeto"); com tarefas, só o ADM (e a FK impede se houver tarefas).
create policy tarefas_projetos_excluir on public.tarefas_projetos for delete to authenticated
  using (app.is_admin() or (app.tarefas_gestor(setor_id)
         and not exists (select 1 from public.tarefas t where t.projeto_id = tarefas_projetos.id)));

create policy tarefas_status_ler on public.tarefas_status for select to authenticated
  using (exists (select 1 from public.tarefas_projetos p where p.id = projeto_id)); -- herda a leitura do projeto (RLS acima)
create policy tarefas_status_gravar on public.tarefas_status for all to authenticated
  using (exists (select 1 from public.tarefas_projetos p where p.id = projeto_id and app.tarefas_gestor(p.setor_id)))
  with check (exists (select 1 from public.tarefas_projetos p where p.id = projeto_id and app.tarefas_gestor(p.setor_id)));

-- Tarefas. As expressões usam as colunas da própria linha (vale também para a linha recém-inserida).
create policy tarefas_ler on public.tarefas for select to authenticated
  using ((select app.is_admin()) or criado_por = (select auth.uid()) or responsavel_id = (select auth.uid())
         or setor_id in (select app.tarefas_meus_setores())
         or id in (select app.tarefas_minhas()) or parent_id in (select app.tarefas_minhas()));
create policy tarefas_criar on public.tarefas for insert to authenticated
  with check (app.tarefas_membro(setor_id)
              or (parent_id is not null and app.tarefa_envolvido(parent_id)));
create policy tarefas_editar on public.tarefas for update to authenticated
  using ((select app.is_admin()) or criado_por = (select auth.uid()) or responsavel_id = (select auth.uid())
         or id in (select app.tarefas_minhas()) or parent_id in (select app.tarefas_minhas()))
  with check ((select app.is_admin()) or criado_por = (select auth.uid()) or responsavel_id = (select auth.uid())
              or id in (select app.tarefas_minhas()) or parent_id in (select app.tarefas_minhas())
              or setor_id in (select app.tarefas_meus_setores()));
-- Exclusão de verdade: ADM; o criador só nas primeiras 24 h (DESFAZER de "criar tarefa"). Pela tela é exclusão lógica.
create policy tarefas_excluir on public.tarefas for delete to authenticated
  using (app.is_admin() or (criado_por = auth.uid() and created_at > now() - interval '1 day'));

-- Filhas: quem vê a tarefa lê; quem está envolvido grava.
create policy tarefas_participantes_ler on public.tarefas_participantes for select to authenticated
  using (app.tarefa_pode_ver(tarefa_id));
create policy tarefas_participantes_gravar on public.tarefas_participantes for insert to authenticated
  with check (app.tarefa_envolvido(tarefa_id) or (user_id = auth.uid() and app.tarefa_pode_ver(tarefa_id))); -- "Seguir"
create policy tarefas_participantes_tirar on public.tarefas_participantes for delete to authenticated
  using (app.tarefa_envolvido(tarefa_id) or user_id = auth.uid());

create policy tarefas_checklist_ler on public.tarefas_checklist for select to authenticated
  using (app.tarefa_pode_ver(tarefa_id));
create policy tarefas_checklist_gravar on public.tarefas_checklist for all to authenticated
  using (app.tarefa_envolvido(tarefa_id)) with check (app.tarefa_envolvido(tarefa_id));

create policy tarefas_links_ler on public.tarefas_links for select to authenticated
  using (app.tarefa_pode_ver(tarefa_id));
create policy tarefas_links_gravar on public.tarefas_links for all to authenticated
  using (app.tarefa_envolvido(tarefa_id)) with check (app.tarefa_envolvido(tarefa_id));

create policy tarefas_comentarios_ler on public.tarefas_comentarios for select to authenticated
  using (app.tarefa_pode_ver(tarefa_id));
create policy tarefas_comentarios_criar on public.tarefas_comentarios for insert to authenticated
  with check (app.tarefa_pode_ver(tarefa_id));
create policy tarefas_comentarios_editar on public.tarefas_comentarios for update to authenticated
  using (autor_id = auth.uid() or app.is_admin()) with check (autor_id = auth.uid() or app.is_admin());
create policy tarefas_comentarios_excluir on public.tarefas_comentarios for delete to authenticated
  using (autor_id = auth.uid() or app.is_admin());

/* ============================ RPC: pessoas para os seletores ============================ */
-- O RLS de profiles só deixa ADM e a aba bc listarem todos; aqui sai só id/nome/email de quem tem login.
create or replace function public.tarefas_pessoas()
returns table (id uuid, nome text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(trim(p.nome), ''), p.email), p.email
    from public.profiles p
   where auth.uid() is not null and p.role in ('admin', 'equipe')
   order by 2;
$$;
revoke all on function public.tarefas_pessoas() from public, anon;
grant execute on function public.tarefas_pessoas() to authenticated;

/* ============================ Setores iniciais ============================ */
insert into public.tarefas_setores (slug, nome, cor, ordem) values
  ('gestao', 'Gestão', '#07110e', 1),
  ('comercial', 'Comercial', '#3b82f6', 2),
  ('cs', 'CS / Suporte', '#10b981', 3),
  ('pedagogico', 'Pedagógico', '#8b5cf6', 4),
  ('conteudo', 'Conteúdo', '#f59e0b', 5),
  ('financeiro', 'Financeiro', '#0ea5e9', 6);
