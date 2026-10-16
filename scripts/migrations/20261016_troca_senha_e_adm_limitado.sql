-- Migration 20261016_troca_senha_e_adm_limitado (APLICADA em 16/10/2026 via MCP apply_migration).
-- Teste: scripts/migrations/teste_rls_adm_limitado.sql (transação que termina em erro => rollback).
--
-- 1) Troca de senha obrigatória no primeiro acesso
--    profiles.precisa_trocar_senha: ligada SÓ pela Edge Function admin-users (service_role) ao criar
--    a conta ou gerar "Nova senha"; desligada SÓ pelo trigger em auth.users quando a senha muda de
--    verdade (supabase.auth.updateUser). O próprio usuário não consegue ligar/desligar a flag (nem a de
--    outros): trigger app.protect_profile_role. Contas existentes ficam false.
--
-- 2) ADM limitado ("usa tudo, sem mexer na estrutura")
--    Guardado como role = 'editor' + profiles.acesso_limitado = true (check constraint garante que só
--    um editor pode ser limitado). Motivo: as Edge Functions (planilha, diagnostico-drive,
--    metas-sheet-sync, mentorados-sheet, teste-vac-sheet, ai, linkedin) comparam profiles.role com
--    'editor'/'admin'; assim o ADM limitado passa nelas como editor sem redeploy, e o que é estrutura
--    fica bloqueado explicitamente aqui. app.is_admin() continua só role = 'admin' (nunca limitado).
--    Bloqueado no banco para o limitado: tudo que já era só admin (Administração/admin-users, app_config,
--    excluir documentos/versões/seções, criar seções) + editar seções (kb_sections update), registro
--    global de Ferramentas (os_ferramentas insert/update) e squad (os_squad_agentes escrita).

-- ---------- colunas ----------
alter table public.profiles add column if not exists precisa_trocar_senha boolean not null default false;
alter table public.profiles add column if not exists acesso_limitado boolean not null default false;
alter table public.profiles drop constraint if exists profiles_acesso_limitado_so_editor;
alter table public.profiles add constraint profiles_acesso_limitado_so_editor
  check (not acesso_limitado or role = 'editor');

comment on column public.profiles.precisa_trocar_senha is
  'true = no próximo login o OS pede uma senha nova (ligada pela admin-users; desligada pelo trigger app.handle_password_change).';
comment on column public.profiles.acesso_limitado is
  'true = papel ADM limitado (role editor sem acesso à estrutura). Só admin/service_role altera.';

-- ---------- helpers ----------
create or replace function app.is_adm_limitado()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.acesso_limitado from public.profiles p where p.id = auth.uid()), false);
$$;

-- Editor/admin que pode mexer na estrutura do sistema (exclui o ADM limitado).
create or replace function app.is_editor_estrutura()
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_editor() and not app.is_adm_limitado();
$$;

revoke all on function app.is_adm_limitado() from public, anon;
revoke all on function app.is_editor_estrutura() from public, anon;
grant execute on function app.is_adm_limitado() to authenticated;
grant execute on function app.is_editor_estrutura() to authenticated;

-- ---------- proteção das colunas sensíveis do próprio perfil ----------
-- profiles_update_self deixa o usuário atualizar a própria linha (nome). Este trigger impede que um
-- usuário logado não-admin mude papel, acesso_limitado ou precisa_trocar_senha (a flag só desliga
-- pelo trigger de troca de senha, que marca app.senha_trocada = '1' na transação).
create or replace function app.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Contexto de servidor / service_role (auth.uid() nulo) pode ajustar livremente.
  if auth.uid() is not null and not app.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Somente admin pode alterar o papel de um usuário';
    end if;
    if new.acesso_limitado is distinct from old.acesso_limitado then
      raise exception 'Somente admin pode alterar o tipo de acesso de um usuário';
    end if;
    if new.precisa_trocar_senha is distinct from old.precisa_trocar_senha
       and coalesce(current_setting('app.senha_trocada', true), '') <> '1' then
      raise exception 'A troca de senha obrigatória só é concluída trocando a senha';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- desliga a flag quando a senha muda de verdade ----------
create or replace function app.handle_password_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    perform set_config('app.senha_trocada', '1', true);
    update public.profiles set precisa_trocar_senha = false where id = new.id and precisa_trocar_senha;
    perform set_config('app.senha_trocada', '', true);
  end if;
  return new;
end;
$$;
revoke all on function app.handle_password_change() from public, anon, authenticated;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row execute function app.handle_password_change();

-- ---------- RLS: estrutura fora do alcance do ADM limitado ----------
-- Seções da Base (nome/descrição). Criar/excluir seção já era só admin.
drop policy if exists sections_update_editor on public.kb_sections;
create policy sections_update_editor on public.kb_sections for update to authenticated
  using (app.is_editor_estrutura()) with check (app.is_editor_estrutura());

-- Registro global de Ferramentas. Excluir já era só admin.
drop policy if exists ferramentas_insert_editor on public.os_ferramentas;
drop policy if exists ferramentas_update_editor on public.os_ferramentas;
create policy ferramentas_insert_editor on public.os_ferramentas for insert to authenticated
  with check (app.is_editor_estrutura());
create policy ferramentas_update_editor on public.os_ferramentas for update to authenticated
  using (app.is_editor_estrutura()) with check (app.is_editor_estrutura());

-- Squad de agentes (os_squad_agentes): escrita só editor/admin plenos.
drop policy if exists squad_write_editor on public.os_squad_agentes;
create policy squad_write_editor on public.os_squad_agentes for all to authenticated
  using (app.is_editor_estrutura()) with check (app.is_editor_estrutura());
