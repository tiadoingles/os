-- ============================================================================
-- Acesso por aba (16/10/2026) — decisão da Tia.
-- Cada usuário tem UM OU MAIS papéis = os 7 grupos do NAV (profiles.areas) ou é ADM
-- (profiles.role = 'admin', vê e altera tudo). Quem não é ADM tem role = 'equipe' e
-- só lê/escreve as tabelas das abas que tem. Fonte única no banco: app.tem_area(slug).
--
-- Aplicada em duas migrations no Supabase (o valor novo do enum precisa estar
-- commitado antes de ser usado):
--   1) areas_por_aba_enum      -> PARTE 1 abaixo
--   2) areas_por_aba_rls       -> PARTE 2 abaixo
-- Teste: scripts/migrations/teste_rls_areas.sql (transação com rollback).
-- Reverter: scripts/migrations/rollback_areas_por_aba.sql.
--
-- Mapa aba -> tabelas (o mesmo documentado no CLAUDE.md):
--   bc          kb_sections (update; insert/delete só ADM), kb_documents, kb_document_versions
--               (delete só ADM), kb_activity_log, storage kb-documents (delete só ADM).
--               cs lê a seção cs-suporte (FAQ). bc também lê profiles (nome/e-mail do responsável).
--   agenda      agenda_eventos
--   pedagogico  aulas_agenda, materiais_pedidos, arena_regras (só origem 'aprendida' na escrita),
--               slides_pedidos, storage gerados (escrita; leitura segue pública)
--   cs          livros_envios, faq_interacoes (seção cs-suporte), cs_diagnosticos, cs_metas
--               (delete só manual), cs_mentorados, cs_teste_vac, chat_widget_logs, pesquisa_avatar,
--               nivelamento_respostas (leitura; o insert público do teste continua),
--               sync_status (leitura só das chaves metas-planilha/mentorados-planilha/teste-vac-planilha)
--   comercial   (nenhuma tabela ainda)
--   financeiro  (nenhuma tabela ainda)
--   conteudo    conteudo_calendario, conteudo_objetivo_resumo, conteudo_insights, ig_dia, ig_perfil,
--               ig_post, linkedin_posts (+ RPC linkedin_conexao_status)
--   só ADM      profiles (cada um lê a própria linha), app_config, ai_usage_log, farol_config,
--               farol_indicadores, os_ferramentas, os_squad_agentes, sync_status (escrita e demais chaves),
--               automacao_estado (escrita; a leitura é de qualquer logado porque as Edge Functions
--               conferem a pausa com o JWT de quem chamou)
-- ============================================================================

-- ============================== PARTE 1 =====================================
alter type public.user_role add value if not exists 'equipe';

-- ============================== PARTE 2 =====================================
-- ---------- coluna e migração dos usuários ----------
alter table public.profiles add column if not exists areas text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_areas_validas;
alter table public.profiles add constraint profiles_areas_validas
  check (areas <@ array['bc','agenda','pedagogico','cs','comercial','financeiro','conteudo']::text[]);

-- CS atuais (suporte@, tutores@, tutores1@) -> só a aba CS.
update public.profiles set role = 'equipe', areas = '{cs}', acesso_limitado = false where role = 'cs';
-- Conta de serviço do sync de skills (scripts/sync_skills.py): só lê kb_sections e lê/grava
-- kb_documents e kb_document_versions -> área bc (o mesmo que fazia como editor, sem o resto).
update public.profiles set role = 'equipe', areas = '{bc}', acesso_limitado = false
 where email = 'sync@os.tiadoingles.com.br';
-- Demais editores/leitores legados (hoje: teste@os.tiadoingles.com.br) -> as 7 abas.
update public.profiles set role = 'equipe', acesso_limitado = false,
       areas = array['bc','agenda','pedagogico','cs','comercial','financeiro','conteudo']
 where role in ('editor', 'leitor');
-- ADM: a lista fica vazia (ADM já inclui tudo).
update public.profiles set areas = '{}', acesso_limitado = false where role = 'admin';

-- Papéis legados (editor, leitor, cs) e o ADM limitado ficam dormentes: o enum mantém os
-- valores (remover valor de enum exige recriar o tipo), mas nenhuma linha pode usá-los.
alter table public.profiles alter column role set default 'equipe';
alter table public.profiles drop constraint if exists profiles_acesso_limitado_so_editor;
alter table public.profiles drop constraint if exists profiles_role_admin_ou_equipe;
alter table public.profiles add constraint profiles_role_admin_ou_equipe check (role in ('admin', 'equipe'));
alter table public.profiles drop constraint if exists profiles_acesso_limitado_dormente;
alter table public.profiles add constraint profiles_acesso_limitado_dormente check (not acesso_limitado);
comment on column public.profiles.areas is
  'Abas liberadas (slugs do NAV: bc, agenda, pedagogico, cs, comercial, financeiro, conteudo). ADM (role admin) ignora: tem todas.';
comment on column public.profiles.acesso_limitado is 'Dormente desde 16/10/2026 (ADM limitado saiu); sempre false.';

-- ---------- helpers ----------
create or replace function app.tem_area(p_area text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'admin' or p_area = any(p.areas) from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function app.tem_area(text) from public;
grant execute on function app.tem_area(text) to authenticated, service_role;

-- Helpers antigos: dormentes e seguros (nenhuma política usa mais). Mantidos para não
-- quebrar algo que ainda os chame: editor/estrutura = ADM; cs = aba cs; limitado = nunca.
create or replace function app.is_editor() returns boolean language sql stable security definer set search_path = public as $$ select app.is_admin(); $$;
create or replace function app.is_editor_estrutura() returns boolean language sql stable security definer set search_path = public as $$ select app.is_admin(); $$;
create or replace function app.is_cs_or_editor() returns boolean language sql stable security definer set search_path = public as $$ select app.tem_area('cs'); $$;
create or replace function app.is_cs() returns boolean language sql stable security definer set search_path = public as $$ select false; $$;
create or replace function app.is_adm_limitado() returns boolean language sql stable security definer set search_path = public as $$ select false; $$;

-- Só o ADM muda papel/abas (inclusive via Edge Function admin-users, que usa service_role).
create or replace function app.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not app.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Somente admin pode alterar o papel de um usuário';
    end if;
    if new.areas is distinct from old.areas then
      raise exception 'Somente admin pode alterar as abas de um usuário';
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

-- RPC da aba LinkedIn (Conteúdo).
create or replace function public.linkedin_conexao_status()
returns table(conectado boolean, nome text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.tem_area('conteudo') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select true, c.nome, c.expires_at from app.linkedin_conexao c where c.id = 1
    union all
    select false, null::text, null::timestamptz where not exists (select 1 from app.linkedin_conexao where id = 1);
end $$;
-- os_restaurar_cs_metas / os_restaurar_diagnostico chamam app.is_cs_or_editor() = app.tem_area('cs').

-- ---------- políticas: apaga todas as das tabelas do OS e recria por aba ----------
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and tablename in (
    'profiles','app_config','ai_usage_log','automacao_estado','farol_config','farol_indicadores','os_ferramentas',
    'os_squad_agentes','sync_status','kb_sections','kb_documents','kb_document_versions','kb_activity_log',
    'agenda_eventos','aulas_agenda','materiais_pedidos','arena_regras','slides_pedidos','livros_envios',
    'faq_interacoes','cs_diagnosticos','cs_metas','cs_mentorados','cs_teste_vac','chat_widget_logs',
    'pesquisa_avatar','nivelamento_respostas','conteudo_calendario','conteudo_objetivo_resumo',
    'conteudo_insights','ig_dia','ig_perfil','ig_post','linkedin_posts')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname in ('gerados_escrita_editor','kb_storage_delete_admin','kb_storage_insert_editor',
                              'kb_storage_select_auth','kb_storage_update_editor')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- Transversais (só ADM, com as exceções comentadas)
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_admin() or app.tem_area('bc')); -- bc mostra responsável/autor dos documentos
create policy profiles_upd_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());       -- nome; papel/abas/flag protegidos por trigger
create policy profiles_admin on public.profiles for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy app_config_admin on public.app_config for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy ai_usage_log_admin on public.ai_usage_log for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy automacao_estado_sel on public.automacao_estado for select to authenticated using (true);
create policy automacao_estado_admin on public.automacao_estado for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy farol_config_admin on public.farol_config for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy farol_indicadores_admin on public.farol_indicadores for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy os_ferramentas_admin on public.os_ferramentas for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy os_squad_agentes_admin on public.os_squad_agentes for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy sync_status_sel on public.sync_status for select to authenticated
  using (app.is_admin() or (app.tem_area('cs') and chave = any (array['metas-planilha','mentorados-planilha','teste-vac-planilha'])));
create policy sync_status_admin on public.sync_status for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- bc — Base de Conhecimento
create policy kb_sections_sel on public.kb_sections for select to authenticated
  using (app.tem_area('bc') or (app.tem_area('cs') and id = app.cs_section_id()));
create policy kb_sections_upd on public.kb_sections for update to authenticated using (app.tem_area('bc')) with check (app.tem_area('bc'));
create policy kb_sections_ins_admin on public.kb_sections for insert to authenticated with check (app.is_admin());
create policy kb_sections_del_admin on public.kb_sections for delete to authenticated using (app.is_admin());
create policy kb_documents_sel on public.kb_documents for select to authenticated
  using ((status <> 'arquivado' or app.tem_area('bc'))
         and (app.tem_area('bc') or (app.tem_area('cs') and section_id = app.cs_section_id())));
create policy kb_documents_ins on public.kb_documents for insert to authenticated with check (app.tem_area('bc'));
create policy kb_documents_upd on public.kb_documents for update to authenticated using (app.tem_area('bc')) with check (app.tem_area('bc'));
create policy kb_documents_del_admin on public.kb_documents for delete to authenticated using (app.is_admin());
create policy kb_versions_sel on public.kb_document_versions for select to authenticated
  using (exists (select 1 from public.kb_documents d where d.id = kb_document_versions.document_id)); -- herda a RLS do documento
create policy kb_versions_ins on public.kb_document_versions for insert to authenticated with check (app.tem_area('bc'));
create policy kb_versions_upd on public.kb_document_versions for update to authenticated using (app.tem_area('bc')) with check (app.tem_area('bc'));
create policy kb_versions_del_admin on public.kb_document_versions for delete to authenticated using (app.is_admin());
create policy kb_activity_sel on public.kb_activity_log for select to authenticated using (app.tem_area('bc'));
create policy kb_activity_ins on public.kb_activity_log for insert to authenticated with check (actor_id = auth.uid() and app.tem_area('bc'));
create policy kb_storage_sel on storage.objects for select to authenticated using (bucket_id = 'kb-documents' and app.tem_area('bc'));
create policy kb_storage_ins on storage.objects for insert to authenticated with check (bucket_id = 'kb-documents' and app.tem_area('bc'));
create policy kb_storage_upd on storage.objects for update to authenticated
  using (bucket_id = 'kb-documents' and app.tem_area('bc')) with check (bucket_id = 'kb-documents' and app.tem_area('bc'));
create policy kb_storage_del_admin on storage.objects for delete to authenticated using (bucket_id = 'kb-documents' and app.is_admin());

-- agenda
create policy agenda_eventos_area on public.agenda_eventos for all to authenticated using (app.tem_area('agenda')) with check (app.tem_area('agenda'));

-- pedagogico
create policy aulas_agenda_area on public.aulas_agenda for all to authenticated using (app.tem_area('pedagogico')) with check (app.tem_area('pedagogico'));
create policy materiais_pedidos_area on public.materiais_pedidos for all to authenticated using (app.tem_area('pedagogico')) with check (app.tem_area('pedagogico'));
create policy slides_pedidos_area on public.slides_pedidos for all to authenticated using (app.tem_area('pedagogico')) with check (app.tem_area('pedagogico'));
create policy arena_regras_sel on public.arena_regras for select to authenticated using (app.tem_area('pedagogico'));
create policy arena_regras_ins on public.arena_regras for insert to authenticated with check (app.tem_area('pedagogico') and origem = 'aprendida');
create policy arena_regras_upd on public.arena_regras for update to authenticated
  using (app.tem_area('pedagogico') and origem = 'aprendida') with check (app.tem_area('pedagogico') and origem = 'aprendida');
create policy arena_regras_del on public.arena_regras for delete to authenticated using (app.tem_area('pedagogico') and origem = 'aprendida');
create policy gerados_escrita_pedagogico on storage.objects for all to authenticated
  using (bucket_id = 'gerados' and app.tem_area('pedagogico')) with check (bucket_id = 'gerados' and app.tem_area('pedagogico'));
-- (gerados_leitura_publica continua: o bucket é público)

-- cs
create policy livros_envios_area on public.livros_envios for all to authenticated using (app.tem_area('cs')) with check (app.tem_area('cs'));
create policy faq_interacoes_area on public.faq_interacoes for all to authenticated
  using (app.is_admin() or (app.tem_area('cs') and secao_slug = 'cs-suporte'))
  with check (app.is_admin() or (app.tem_area('cs') and secao_slug = 'cs-suporte'));
create policy cs_diagnosticos_area on public.cs_diagnosticos for all to authenticated using (app.tem_area('cs')) with check (app.tem_area('cs'));
create policy cs_metas_sel on public.cs_metas for select to authenticated using (app.tem_area('cs'));
create policy cs_metas_ins on public.cs_metas for insert to authenticated with check (app.tem_area('cs'));
create policy cs_metas_upd on public.cs_metas for update to authenticated using (app.tem_area('cs')) with check (app.tem_area('cs'));
create policy cs_metas_del on public.cs_metas for delete to authenticated using (app.tem_area('cs') and origem = 'manual');
create policy cs_mentorados_sel on public.cs_mentorados for select to authenticated using (app.tem_area('cs'));
create policy cs_teste_vac_sel on public.cs_teste_vac for select to authenticated using (app.tem_area('cs'));
create policy chat_widget_logs_sel on public.chat_widget_logs for select to authenticated using (app.tem_area('cs'));
create policy pesquisa_avatar_sel on public.pesquisa_avatar for select to authenticated using (app.tem_area('cs'));
create policy pesquisa_avatar_admin on public.pesquisa_avatar for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy nivelamento_respostas_sel on public.nivelamento_respostas for select to authenticated using (app.tem_area('cs'));
create policy nivelamento_respostas_insert_public on public.nivelamento_respostas for insert to anon, authenticated with check (true);

-- conteudo
create policy conteudo_calendario_area on public.conteudo_calendario for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
create policy conteudo_objetivo_resumo_area on public.conteudo_objetivo_resumo for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
create policy conteudo_insights_area on public.conteudo_insights for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
create policy ig_dia_area on public.ig_dia for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
create policy ig_perfil_area on public.ig_perfil for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
create policy ig_post_area on public.ig_post for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
create policy linkedin_posts_area on public.linkedin_posts for all to authenticated using (app.tem_area('conteudo')) with check (app.tem_area('conteudo'));
