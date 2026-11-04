-- Gestão de Tarefas, Fase 2 (pedido da Tia, 04/11/2026): avisos dentro do OS, solicitações entre setores,
-- "Seguir" só avisa, recorrência, modelos de projeto, dependências, anexos, etiquetas por setor, vínculo com
-- mentorado e 3 prioridades. Plano em docs/tarefas-spec.md. Teste: teste_rls_tarefas_fase2.sql.

/* ============================ Prioridade: 3 níveis ============================ */
alter table public.tarefas drop constraint tarefas_prioridade_check;
update public.tarefas set prioridade = 'alta' where prioridade = 'urgente';
alter table public.tarefas add constraint tarefas_prioridade_check check (prioridade in ('alta', 'normal', 'baixa'));

/* ============================ Novas colunas ============================ */
-- Participante: 'colaborador' (envolvido: altera a tarefa) ou 'seguidor' (só recebe avisos).
alter table public.tarefas_participantes
  add column papel text not null default 'colaborador' check (papel in ('colaborador', 'seguidor'));
-- Projeto que recebe pedidos de qualquer pessoa da empresa (um "Solicitações" por setor).
alter table public.tarefas_projetos add column aceita_solicitacoes boolean not null default false;
-- Etiquetas padronizadas do setor (o gestor define).
alter table public.tarefas_setores add column etiquetas text[] not null default '{}';
-- Vínculo com a Ficha do Mentorado (e-mail da Lista de Mentorados) e origem da recorrência.
alter table public.tarefas add column mentorado_email text,
  add column origem_recorrencia_id uuid references public.tarefas(id) on delete set null;
create index tarefas_mentorado_idx on public.tarefas (mentorado_email) where mentorado_email is not null and excluida_em is null;
create index tarefas_origem_rec_idx on public.tarefas (origem_recorrencia_id) where origem_recorrencia_id is not null;
-- Anexos: a mesma tabela guarda link (url) ou arquivo do bucket tarefas-anexos (path).
alter table public.tarefas_links alter column url drop not null,
  add column path text, add column tamanho bigint, add column tipo_mime text;
alter table public.tarefas_links drop constraint tarefas_links_url_check;
alter table public.tarefas_links add constraint tarefas_links_url_ou_arquivo
  check ((url is not null and url ~* '^https?://') or (url is null and path is not null));

/* ============================ Envolvido = colaborador ============================ */
create or replace function app.tarefa_envolvido(p_tarefa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (
    select 1 from public.tarefas t
     where t.id in (p_tarefa, (select parent_id from public.tarefas where id = p_tarefa))
       and (t.criado_por = auth.uid() or t.responsavel_id = auth.uid()
            or exists (select 1 from public.tarefas_participantes p
                        where p.tarefa_id = t.id and p.user_id = auth.uid() and p.papel = 'colaborador')));
$$;
create or replace function app.tarefas_minhas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.tarefas where criado_por = auth.uid() or responsavel_id = auth.uid()
  union select tarefa_id from public.tarefas_participantes where user_id = auth.uid() and papel = 'colaborador';
$$;
-- Projeto aberto a solicitações?
create or replace function app.tarefas_projeto_solicitacoes(p_projeto uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tarefas_projetos where id = p_projeto and aceita_solicitacoes and not arquivado);
$$;
revoke all on function app.tarefas_projeto_solicitacoes(uuid) from public;
grant execute on function app.tarefas_projeto_solicitacoes(uuid) to authenticated, service_role;

-- "Seguir" (a própria pessoa, como seguidor) é de quem vê; colaborador só quem já está envolvido inclui.
drop policy tarefas_participantes_gravar on public.tarefas_participantes;
create policy tarefas_participantes_gravar on public.tarefas_participantes for insert to authenticated
  with check (app.tarefa_envolvido(tarefa_id)
              or (user_id = auth.uid() and papel = 'seguidor' and app.tarefa_pode_ver(tarefa_id)));

-- Solicitação: qualquer logado cria tarefa (não subtarefa) num projeto que aceita solicitações.
drop policy tarefas_criar on public.tarefas;
create policy tarefas_criar on public.tarefas for insert to authenticated
  with check (app.tarefas_membro(setor_id)
              or (parent_id is not null and app.tarefa_envolvido(parent_id))
              or (parent_id is null and app.tarefas_projeto_solicitacoes(projeto_id)));
-- O projeto de solicitações aparece para todos (o nome; as tarefas continuam por setor/envolvimento).
drop policy tarefas_projetos_ler on public.tarefas_projetos;
create policy tarefas_projetos_ler on public.tarefas_projetos for select to authenticated
  using ((select app.is_admin()) or setor_id in (select app.tarefas_meus_setores())
         or id in (select app.tarefas_meus_projetos()) or (aceita_solicitacoes and not arquivado));

-- Gestor do setor edita as etiquetas do próprio setor (o resto do setor continua só do ADM).
create policy tarefas_setores_gestor on public.tarefas_setores for update to authenticated
  using (app.tarefas_gestor(id)) with check (app.tarefas_gestor(id));
-- Quem não é ADM só muda as etiquetas.
create or replace function app.tarefas_setores_guarda() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_etiquetas text[] := new.etiquetas;
begin
  if auth.uid() is not null and not app.is_admin() then
    new := old;
    new.etiquetas := v_etiquetas;
  end if;
  return new;
end $$;
create trigger a_tarefas_setores_guarda before update on public.tarefas_setores
  for each row execute function app.tarefas_setores_guarda();

-- E-mail do mentorado sempre minúsculo e sem espaços.
create or replace function app.tarefas_preparar_extra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.mentorado_email := nullif(lower(trim(new.mentorado_email)), '');
  return new;
end $$;
create trigger a2_tarefas_preparar_extra before insert or update on public.tarefas
  for each row execute function app.tarefas_preparar_extra();

-- Criador preservado nas tarefas geradas pelo próprio banco (recorrência: insert feito por gatilho, pg_trigger_depth > 1).
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
  elsif auth.uid() is not null and not app.is_admin() and pg_trigger_depth() <= 1 then -- gerada por gatilho (recorrência) mantém o criador
    new.criado_por := auth.uid();
  end if;
  return new;
end $$;

/* ============================ Avisos dentro do OS ============================ */
create table public.tarefas_notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('atribuida', 'mencao', 'comentario', 'concluida', 'prazo', 'atrasada', 'solicitacao', 'participante')),
  tarefa_id uuid references public.tarefas(id) on delete cascade,
  ator_id uuid references public.profiles(id) on delete set null,
  texto text,
  chave text unique, -- evita repetir o mesmo aviso (prazo do dia, atraso)
  lida_em timestamptz,
  enviado_chat_em timestamptz, -- Fase 3 (Google Chat)
  created_at timestamptz not null default now()
);
create index tarefas_notificacoes_user_idx on public.tarefas_notificacoes (user_id, created_at desc);
create index tarefas_notificacoes_nao_lidas_idx on public.tarefas_notificacoes (user_id) where lida_em is null;
alter table public.tarefas_notificacoes enable row level security;
revoke all on public.tarefas_notificacoes from anon, authenticated;
grant select, delete on public.tarefas_notificacoes to authenticated;
grant update (lida_em) on public.tarefas_notificacoes to authenticated;
create policy tarefas_notificacoes_minhas on public.tarefas_notificacoes for select to authenticated using (user_id = auth.uid());
create policy tarefas_notificacoes_ler on public.tarefas_notificacoes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tarefas_notificacoes_apagar on public.tarefas_notificacoes for delete to authenticated using (user_id = auth.uid());

-- Grava um aviso (nunca para quem fez a ação).
create or replace function app.tarefas_notificar(p_user uuid, p_tipo text, p_tarefa uuid, p_texto text, p_chave text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.tarefas_notificacoes (user_id, tipo, tarefa_id, ator_id, texto, chave)
  values (p_user, p_tipo, p_tarefa, auth.uid(), left(p_texto, 240), p_chave)
  on conflict (chave) do nothing;
end $$;
revoke all on function app.tarefas_notificar(uuid, text, uuid, text, text) from public;

-- Quem acompanha a tarefa: criador, responsável, colaboradores e seguidores.
create or replace function app.tarefas_interessados(p_tarefa uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select criado_por from public.tarefas where id = p_tarefa and criado_por is not null
  union select responsavel_id from public.tarefas where id = p_tarefa and responsavel_id is not null
  union select user_id from public.tarefas_participantes where tarefa_id = p_tarefa;
$$;
revoke all on function app.tarefas_interessados(uuid) from public;

create or replace function app.tarefas_avisos_tarefa() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid; v_proj record;
begin
  if new.excluida_em is not null then return new; end if;
  if tg_op = 'INSERT' then
    if new.created_at < now() - interval '1 minute' then return new; end if; -- reinserção do DESFAZER
    perform app.tarefas_notificar(new.responsavel_id, 'atribuida', new.id, new.titulo);
    select aceita_solicitacoes, setor_id into v_proj from public.tarefas_projetos where id = new.projeto_id;
    if new.parent_id is null and v_proj.aceita_solicitacoes and auth.uid() is not null
       and not exists (select 1 from public.tarefas_setor_membros where setor_id = v_proj.setor_id and user_id = auth.uid()) then
      for u in select user_id from public.tarefas_setor_membros
                where setor_id = v_proj.setor_id
                  and (papel = 'gestor' or not exists (select 1 from public.tarefas_setor_membros g
                                                        where g.setor_id = v_proj.setor_id and g.papel = 'gestor')) loop
        perform app.tarefas_notificar(u, 'solicitacao', new.id, new.titulo);
      end loop;
    end if;
  else
    if new.responsavel_id is distinct from old.responsavel_id then
      perform app.tarefas_notificar(new.responsavel_id, 'atribuida', new.id, new.titulo);
    end if;
    if new.concluida_em is not null and old.concluida_em is null then
      for u in select x from app.tarefas_interessados(new.id) x where app.tarefas_pode_ver_por(x, new.id) loop
        perform app.tarefas_notificar(u, 'concluida', new.id, new.titulo);
      end loop;
    end if;
  end if;
  return new;
end $$;
create trigger y_tarefas_avisos after insert or update on public.tarefas
  for each row execute function app.tarefas_avisos_tarefa();

create or replace function app.tarefas_avisos_comentario() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid; v_titulo text;
begin
  if new.created_at < now() - interval '1 minute' then return new; end if; -- reinserção do DESFAZER
  select titulo into v_titulo from public.tarefas where id = new.tarefa_id;
  for u in select unnest(new.mencoes) loop
    if app.tarefas_pode_ver_por(u, new.tarefa_id) then
      perform app.tarefas_notificar(u, 'mencao', new.tarefa_id, v_titulo || ': ' || new.texto_md);
    end if;
  end loop;
  for u in select x from app.tarefas_interessados(new.tarefa_id) x where app.tarefas_pode_ver_por(x, new.tarefa_id) loop
    if not (u = any(new.mencoes)) then
      perform app.tarefas_notificar(u, 'comentario', new.tarefa_id, v_titulo || ': ' || new.texto_md);
    end if;
  end loop;
  return new;
end $$;

-- A pessoa X vê a tarefa? (para não avisar de menção quem não pode abrir)
create or replace function app.tarefas_pode_ver_por(p_user uuid, p_tarefa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'admin')
      or exists (select 1 from public.tarefas t
                  where t.id in (p_tarefa, (select parent_id from public.tarefas where id = p_tarefa))
                    and (t.criado_por = p_user or t.responsavel_id = p_user
                         or exists (select 1 from public.tarefas_participantes p where p.tarefa_id = t.id and p.user_id = p_user and p.papel = 'colaborador')
                         or exists (select 1 from public.tarefas_setor_membros m where m.setor_id = t.setor_id and m.user_id = p_user)));
$$;
revoke all on function app.tarefas_pode_ver_por(uuid, uuid) from public;
create trigger y_tarefas_comentarios_avisos after insert on public.tarefas_comentarios
  for each row execute function app.tarefas_avisos_comentario();

create or replace function app.tarefas_avisos_participante() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_at < now() - interval '1 minute' then return new; end if; -- reinserção do DESFAZER
  if new.papel = 'colaborador' and pg_trigger_depth() <= 1 then
    perform app.tarefas_notificar(new.user_id, 'participante', new.tarefa_id, (select titulo from public.tarefas where id = new.tarefa_id));
  end if;
  return new;
end $$;
create trigger y_tarefas_participantes_avisos after insert on public.tarefas_participantes
  for each row execute function app.tarefas_avisos_participante();

-- Avisos de prazo (cron diário 08h de Brasília): vence hoje / ficou atrasada (uma vez por tarefa e prazo).
create or replace function app.tarefas_avisos_prazo() returns int
language plpgsql security definer set search_path = public as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; n int := 0; r record;
begin
  for r in select id, titulo, responsavel_id, prazo from public.tarefas
            where excluida_em is null and concluida_em is null and responsavel_id is not null
              and prazo is not null and prazo <= v_hoje and prazo >= v_hoje - 30 loop
    insert into public.tarefas_notificacoes (user_id, tipo, tarefa_id, texto, chave)
    values (r.responsavel_id, case when r.prazo = v_hoje then 'prazo' else 'atrasada' end, r.id, left(r.titulo, 240),
            case when r.prazo = v_hoje then 'prazo:' else 'atrasada:' end || r.id || ':' || r.prazo)
    on conflict (chave) do nothing;
    n := n + 1;
  end loop;
  delete from public.tarefas_notificacoes where created_at < now() - interval '90 days';
  return n;
end $$;
revoke all on function app.tarefas_avisos_prazo() from public;
select cron.schedule('tarefas-avisos-prazo', '0 11 * * *', $$select app.tarefas_avisos_prazo()$$);

/* ============================ Solicitações por setor ============================ */
-- Setor novo ganha o projeto "Solicitações".
create or replace function app.tarefas_setor_solicitacoes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tarefas_projetos (setor_id, nome, descricao_md, cor, ordem, aceita_solicitacoes)
  values (new.id, 'Solicitações', 'Pedidos de outras pessoas e setores para ' || new.nome || '.', new.cor, 0, true);
  return new;
end $$;
create trigger tarefas_setores_solicitacoes after insert on public.tarefas_setores
  for each row execute function app.tarefas_setor_solicitacoes();
insert into public.tarefas_projetos (setor_id, nome, descricao_md, cor, ordem, aceita_solicitacoes)
select s.id, 'Solicitações', 'Pedidos de outras pessoas e setores para ' || s.nome || '.', s.cor, 0, true
  from public.tarefas_setores s
 where not exists (select 1 from public.tarefas_projetos p where p.setor_id = s.id and p.aceita_solicitacoes);

/* ============================ Recorrência ============================ */
-- recorrencia = {"freq": "diaria"|"dias_uteis"|"semanal"|"mensal", "intervalo": n, "ate": "AAAA-MM-DD"?}
create or replace function app.tarefas_proxima_data(p_data date, p_rec jsonb) returns date
language plpgsql immutable set search_path = public as $$
declare n int := greatest(coalesce((p_rec ->> 'intervalo')::int, 1), 1); d date := p_data; i int := 0;
begin
  case p_rec ->> 'freq'
    when 'diaria' then return p_data + n;
    when 'semanal' then return p_data + 7 * n;
    when 'mensal' then return (p_data + make_interval(months => n))::date;
    when 'dias_uteis' then
      while i < n loop d := d + 1; if extract(isodow from d) < 6 then i := i + 1; end if; end loop;
      return d;
    else return null;
  end case;
end $$;

-- Ao concluir uma tarefa recorrente, cria a próxima (uma vez só), com checklist desmarcado e os mesmos colaboradores.
create or replace function app.tarefas_recorrencia() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_base date; v_prox date; v_id uuid; v_ate date;
begin
  -- Reabriu (inclusive pelo DESFAZER): apaga a próxima ocorrência que ninguém mexeu ainda.
  if old.concluida_em is not null and new.concluida_em is null then
    delete from public.tarefas where origem_recorrencia_id = new.id
       and concluida_em is null and excluida_em is null and updated_at = created_at;
    return new;
  end if;
  if new.recorrencia is null or new.excluida_em is not null or new.concluida_em is null or old.concluida_em is not null then
    return new;
  end if;
  if exists (select 1 from public.tarefas where origem_recorrencia_id = new.id) then return new; end if;
  v_base := coalesce(new.prazo, (now() at time zone 'America/Sao_Paulo')::date);
  v_prox := app.tarefas_proxima_data(v_base, new.recorrencia);
  if v_prox is null then return new; end if;
  v_ate := nullif(new.recorrencia ->> 'ate', '')::date;
  if v_ate is not null and v_prox > v_ate then return new; end if;
  insert into public.tarefas (projeto_id, parent_id, titulo, descricao_md, prioridade, responsavel_id, inicio, prazo,
                              ordem, etiquetas, campos, recorrencia, mentorado_email, origem_recorrencia_id, criado_por)
  values (new.projeto_id, new.parent_id, new.titulo, new.descricao_md, new.prioridade, new.responsavel_id,
          case when new.inicio is not null then new.inicio + (v_prox - v_base) end, v_prox,
          new.ordem, new.etiquetas, new.campos, new.recorrencia, new.mentorado_email, new.id, new.criado_por)
  returning id into v_id;
  insert into public.tarefas_checklist (tarefa_id, texto, feito, ordem)
    select v_id, texto, false, ordem from public.tarefas_checklist where tarefa_id = new.id;
  insert into public.tarefas_participantes (tarefa_id, user_id, papel)
    select v_id, user_id, papel from public.tarefas_participantes where tarefa_id = new.id;
  return new;
end $$;
create trigger z_tarefas_recorrencia after update on public.tarefas
  for each row execute function app.tarefas_recorrencia();

/* ============================ Dependências ============================ */
create table public.tarefas_dependencias (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,      -- esta tarefa…
  depende_de_id uuid not null references public.tarefas(id) on delete cascade,  -- …espera esta terminar
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tarefa_id, depende_de_id),
  check (tarefa_id <> depende_de_id)
);
create index tarefas_dependencias_dep_idx on public.tarefas_dependencias (depende_de_id);
create or replace function app.tarefas_dependencia_guarda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (with recursive cadeia(id) as (
               select depende_de_id from public.tarefas_dependencias where tarefa_id = new.depende_de_id
               union select d.depende_de_id from public.tarefas_dependencias d join cadeia c on d.tarefa_id = c.id)
             select 1 from cadeia where id = new.tarefa_id) then
    raise exception 'Isso criaria um ciclo de dependências';
  end if;
  return new;
end $$;
create trigger tarefas_dependencias_guarda before insert or update on public.tarefas_dependencias
  for each row execute function app.tarefas_dependencia_guarda();

/* ============================ Modelos de projeto ============================ */
-- itens = [{"titulo","dias" (a partir do início),"prioridade","descricao","checklist":[...],"subtarefas":[...]}]
create table public.tarefas_modelos (
  id uuid primary key default gen_random_uuid(),
  setor_id uuid references public.tarefas_setores(id) on delete cascade, -- null = modelo da empresa toda
  nome text not null check (length(trim(nome)) > 0),
  descricao text,
  itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Aplica um modelo num projeto (RLS de quem chama: precisa poder criar tarefas no projeto). Devolve os ids criados.
create or replace function public.tarefas_aplicar_modelo(p_modelo uuid, p_projeto uuid, p_inicio date, p_responsavel uuid)
returns uuid[] language plpgsql security invoker set search_path = public as $$
declare it jsonb; v_id uuid; v_sub text; v_chk text; ids uuid[] := '{}'; v_ordem numeric := extract(epoch from now()) * 1000; v_itens jsonb;
begin
  select itens into v_itens from public.tarefas_modelos where id = p_modelo;
  if v_itens is null then raise exception 'Modelo não encontrado'; end if;
  for it in select * from jsonb_array_elements(v_itens) loop
    v_ordem := v_ordem + 1000;
    insert into public.tarefas (projeto_id, titulo, descricao_md, prioridade, responsavel_id, prazo, ordem)
    values (p_projeto, it ->> 'titulo', nullif(it ->> 'descricao', ''),
            coalesce(nullif(it ->> 'prioridade', ''), 'normal'), p_responsavel,
            case when it ? 'dias' and p_inicio is not null then p_inicio + (it ->> 'dias')::int end, v_ordem)
    returning id into v_id;
    ids := ids || v_id;
    for v_sub in select jsonb_array_elements_text(coalesce(it -> 'subtarefas', '[]')) loop
      v_ordem := v_ordem + 1;
      insert into public.tarefas (projeto_id, parent_id, titulo, responsavel_id, ordem) values (p_projeto, v_id, v_sub, p_responsavel, v_ordem);
    end loop;
    for v_chk in select jsonb_array_elements_text(coalesce(it -> 'checklist', '[]')) loop
      v_ordem := v_ordem + 1;
      insert into public.tarefas_checklist (tarefa_id, texto, ordem) values (v_id, v_chk, v_ordem);
    end loop;
  end loop;
  return ids;
end $$;
revoke all on function public.tarefas_aplicar_modelo(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.tarefas_aplicar_modelo(uuid, uuid, date, uuid) to authenticated;

/* ============================ Gatilhos padrão + RLS das tabelas novas ============================ */
do $$
declare t text;
begin
  foreach t in array array['tarefas_dependencias', 'tarefas_modelos'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger zz_os_atividade after insert or update or delete on public.%I for each row execute function app.os_atividade_registrar()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
create policy tarefas_dependencias_ler on public.tarefas_dependencias for select to authenticated
  using (app.tarefa_pode_ver(tarefa_id));
create policy tarefas_dependencias_gravar on public.tarefas_dependencias for insert to authenticated
  with check (app.tarefa_envolvido(tarefa_id) and app.tarefa_pode_ver(depende_de_id));
create policy tarefas_dependencias_tirar on public.tarefas_dependencias for delete to authenticated
  using (app.tarefa_envolvido(tarefa_id));

create policy tarefas_modelos_ler on public.tarefas_modelos for select to authenticated using (true);
create policy tarefas_modelos_gravar on public.tarefas_modelos for all to authenticated
  using (app.is_admin() or (setor_id is not null and app.tarefas_gestor(setor_id)))
  with check (app.is_admin() or (setor_id is not null and app.tarefas_gestor(setor_id)));

/* ============================ Anexos (Storage) ============================ */
insert into storage.buckets (id, name, public, file_size_limit)
values ('tarefas-anexos', 'tarefas-anexos', false, 52428800)
on conflict (id) do nothing;
-- Caminho: <tarefa_id>/<arquivo>. Ver = quem vê a tarefa; enviar/apagar = envolvido.
create or replace function app.tarefas_anexo_tarefa(p_nome text) returns uuid
language sql immutable set search_path = public as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_nome, '/', 1)::uuid end;
$$;
create policy tarefas_anexos_ler on storage.objects for select to authenticated
  using (bucket_id = 'tarefas-anexos' and app.tarefa_pode_ver(app.tarefas_anexo_tarefa(name)));
create policy tarefas_anexos_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'tarefas-anexos' and app.tarefa_envolvido(app.tarefas_anexo_tarefa(name)));
create policy tarefas_anexos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'tarefas-anexos' and app.tarefa_envolvido(app.tarefas_anexo_tarefa(name)));
grant execute on function app.tarefas_anexo_tarefa(text) to authenticated;

/* ============================ Modelos iniciais (rascunhos para a Tia ajustar) ============================ */
insert into public.tarefas_modelos (setor_id, nome, descricao, itens) values
(null, 'Fluxo semanal da aula', 'Entregáveis da semana da Mentoria (skill fluxo-semanal-mentoria). "Início" = segunda-feira da semana.',
 '[{"titulo":"Definir tema e objetivo da aula","dias":0,"prioridade":"alta"},
   {"titulo":"Sequência de slides da aula","dias":1,"checklist":["Rascunho","Revisão da Tia","Versão final"]},
   {"titulo":"Resumo da aula","dias":2},
   {"titulo":"Quiz de 18 perguntas com gabarito","dias":2},
   {"titulo":"Tarefa em vídeo","dias":2},
   {"titulo":"Perguntas para os Labs","dias":2},
   {"titulo":"Publicar materiais e avisar as alunas","dias":3,"prioridade":"alta"}]'),
(null, 'Onboarding de mentorado', 'Primeiras semanas da aluna na Mentoria. Ajuste os passos ao processo real do CS.',
 '[{"titulo":"Mensagem de boas-vindas","dias":0,"prioridade":"alta"},
   {"titulo":"Cadastrar o envio de livros","dias":1},
   {"titulo":"Diagnóstico do Mentorado","dias":3},
   {"titulo":"Definir metas com a aluna","dias":5},
   {"titulo":"Teste VAC e Teste de Nivelamento","dias":7},
   {"titulo":"Primeiro acompanhamento","dias":14}]'),
(null, 'Lançamento', 'Esqueleto de lançamento. Ajuste datas e etapas ao plano do time Comercial e de Conteúdo.',
 '[{"titulo":"Definir oferta, preço e datas","dias":0,"prioridade":"alta"},
   {"titulo":"Página de vendas e checkout","dias":7},
   {"titulo":"Calendário de conteúdo de aquecimento","dias":7},
   {"titulo":"Campanhas de anúncio","dias":10},
   {"titulo":"Sequência de e-mails e WhatsApp","dias":10},
   {"titulo":"Abertura do carrinho","dias":21,"prioridade":"alta"},
   {"titulo":"Fechamento e relatório do lançamento","dias":28}]');

/* ============================ Ajustes da revisão técnica ============================ */
-- Quem não é do setor (ex.: solicitante) não pendura a tarefa em outra tarefa em que não está envolvido.
create or replace function app.tarefas_guarda_projeto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.projeto_id is distinct from old.projeto_id and not app.tarefas_membro(new.setor_id) then
    raise exception 'Sem permissão para mover a tarefa para esse setor';
  end if;
  if new.parent_id is distinct from old.parent_id and not app.tarefas_membro(old.setor_id)
     and not (new.parent_id is null or app.tarefa_envolvido(new.parent_id)) then
    raise exception 'Sem permissão para mudar a tarefa-mãe';
  end if;
  return new;
end $$;

-- Só o ADM liga/desliga "aceita solicitações" (expõe o nome do projeto a todos).
create or replace function app.tarefas_projetos_guarda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not app.is_admin() then
    if tg_op = 'INSERT' then new.aceita_solicitacoes := false;
    else new.aceita_solicitacoes := old.aceita_solicitacoes; end if;
  end if;
  return new;
end $$;
create trigger a_tarefas_projetos_guarda before insert or update on public.tarefas_projetos
  for each row execute function app.tarefas_projetos_guarda();

-- Recorrência sempre bem formada (senão concluir daria erro no gatilho).
alter table public.tarefas add constraint tarefas_recorrencia_check check (recorrencia is null or (
  recorrencia ->> 'freq' in ('diaria', 'dias_uteis', 'semanal', 'mensal')
  and coalesce(recorrencia ->> 'intervalo', '1') ~ '^[0-9]{1,3}$'
  and coalesce(recorrencia ->> 'ate', '2000-01-01') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'));

-- Arquivo anexado fica na pasta da própria tarefa.
alter table public.tarefas_links add constraint tarefas_links_path_da_tarefa
  check (path is null or split_part(path, '/', 1) = tarefa_id::text);

-- Modelo só se aplica em projeto de setor do qual a pessoa é membro (não em "Solicitações" de outro setor).
create or replace function public.tarefas_aplicar_modelo(p_modelo uuid, p_projeto uuid, p_inicio date, p_responsavel uuid)
returns uuid[] language plpgsql security invoker set search_path = public as $$
declare it jsonb; v_id uuid; v_sub text; v_chk text; ids uuid[] := '{}'; v_ordem numeric := extract(epoch from now()) * 1000; v_itens jsonb;
begin
  if not app.tarefas_membro((select setor_id from public.tarefas_projetos where id = p_projeto)) then
    raise exception 'Sem permissão para aplicar modelo neste projeto';
  end if;
  select itens into v_itens from public.tarefas_modelos where id = p_modelo;
  if v_itens is null then raise exception 'Modelo não encontrado'; end if;
  for it in select * from jsonb_array_elements(v_itens) loop
    v_ordem := v_ordem + 1000;
    insert into public.tarefas (projeto_id, titulo, descricao_md, prioridade, responsavel_id, prazo, ordem)
    values (p_projeto, it ->> 'titulo', nullif(it ->> 'descricao', ''),
            coalesce(nullif(it ->> 'prioridade', ''), 'normal'), p_responsavel,
            case when it ? 'dias' and p_inicio is not null then p_inicio + (it ->> 'dias')::int end, v_ordem)
    returning id into v_id;
    ids := ids || v_id;
    for v_sub in select jsonb_array_elements_text(coalesce(it -> 'subtarefas', '[]')) loop
      v_ordem := v_ordem + 1;
      insert into public.tarefas (projeto_id, parent_id, titulo, responsavel_id, ordem) values (p_projeto, v_id, v_sub, p_responsavel, v_ordem);
    end loop;
    for v_chk in select jsonb_array_elements_text(coalesce(it -> 'checklist', '[]')) loop
      v_ordem := v_ordem + 1;
      insert into public.tarefas_checklist (tarefa_id, texto, ordem) values (v_id, v_chk, v_ordem);
    end loop;
  end loop;
  return ids;
end $$;
