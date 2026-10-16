-- Reverte scripts/migrations/20261016_areas_por_aba.sql (volta aos papéis admin/cs/editor/leitor e
-- às políticas de 16/10/2026 antes do acesso por aba). Rode inteiro, numa transação, como postgres.
-- Quem tinha só {cs} volta a role 'cs'; os demais não-ADM voltam a 'editor'. A coluna areas fica
-- (sem efeito); o valor 'equipe' do enum também fica (não dá para remover valor de enum).
begin;

alter table public.profiles drop constraint if exists profiles_role_admin_ou_equipe;
alter table public.profiles drop constraint if exists profiles_acesso_limitado_dormente;
update public.profiles set role = 'cs' where role = 'equipe' and areas = '{cs}';
update public.profiles set role = 'editor' where role = 'equipe';
alter table public.profiles alter column role set default 'leitor';
alter table public.profiles add constraint profiles_acesso_limitado_so_editor check ((not acesso_limitado) or (role = 'editor'));

create or replace function app.is_editor() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_user_role() in ('editor','admin'), false); $$;
create or replace function app.is_adm_limitado() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.acesso_limitado from public.profiles p where p.id = auth.uid()), false); $$;
create or replace function app.is_editor_estrutura() returns boolean language sql stable security definer set search_path = public as $$
  select app.is_editor() and not app.is_adm_limitado(); $$;
create or replace function app.is_cs() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_user_role() = 'cs', false); $$;
create or replace function app.is_cs_or_editor() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_user_role() in ('cs', 'editor', 'admin'), false); $$;
create or replace function public.linkedin_conexao_status()
returns table(conectado boolean, nome text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_editor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select true, c.nome, c.expires_at from app.linkedin_conexao c where c.id = 1
    union all
    select false, null::text, null::timestamptz where not exists (select 1 from app.linkedin_conexao where id = 1);
end $$;
-- app.protect_profile_role com a checagem de areas pode ficar (inofensiva).

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
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname in ('kb_storage_sel','kb_storage_ins','kb_storage_upd','kb_storage_del_admin','gerados_escrita_pedagogico')
  loop execute format('drop policy %I on storage.objects', r.policyname); end loop;
end $$;

create policy agenda_eventos_sel on public.agenda_eventos as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy agenda_eventos_write on public.agenda_eventos as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy ai_usage_log_sel on public.ai_usage_log as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy ai_usage_log_write on public.ai_usage_log as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy app_config_select_admin on public.app_config as PERMISSIVE for SELECT to public using (app.is_admin());
create policy app_config_write_admin on public.app_config as PERMISSIVE for ALL to authenticated using (app.is_admin()) with check (app.is_admin());
create policy arena_regras_del on public.arena_regras as PERMISSIVE for DELETE to authenticated using ((app.is_editor() AND (origem = 'aprendida'::text)));
create policy arena_regras_ins on public.arena_regras as PERMISSIVE for INSERT to authenticated with check ((app.is_editor() AND (origem = 'aprendida'::text)));
create policy arena_regras_sel on public.arena_regras as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy arena_regras_upd on public.arena_regras as PERMISSIVE for UPDATE to authenticated using ((app.is_editor() AND (origem = 'aprendida'::text))) with check ((app.is_editor() AND (origem = 'aprendida'::text)));
create policy aulas_agenda_sel on public.aulas_agenda as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy aulas_agenda_write on public.aulas_agenda as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy automacao_estado_sel on public.automacao_estado as PERMISSIVE for SELECT to authenticated using (true);
create policy automacao_estado_write on public.automacao_estado as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy "chat_widget_logs: cs e editor leem" on public.chat_widget_logs as PERMISSIVE for SELECT to authenticated using (app.is_cs_or_editor());
create policy conteudo_calendario_sel on public.conteudo_calendario as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy conteudo_calendario_write on public.conteudo_calendario as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy conteudo_insights_sel on public.conteudo_insights as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy conteudo_insights_write on public.conteudo_insights as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy conteudo_objetivo_resumo_sel on public.conteudo_objetivo_resumo as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy conteudo_objetivo_resumo_write on public.conteudo_objetivo_resumo as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy cs_diagnosticos_sel on public.cs_diagnosticos as PERMISSIVE for SELECT to authenticated using (true);
create policy cs_diagnosticos_write on public.cs_diagnosticos as PERMISSIVE for ALL to authenticated using (app.is_cs_or_editor()) with check (app.is_cs_or_editor());
create policy cs_mentorados_sel on public.cs_mentorados as PERMISSIVE for SELECT to authenticated using (true);
create policy cs_metas_del on public.cs_metas as PERMISSIVE for DELETE to authenticated using ((app.is_cs_or_editor() AND (origem = 'manual'::text)));
create policy cs_metas_ins on public.cs_metas as PERMISSIVE for INSERT to authenticated with check (app.is_cs_or_editor());
create policy cs_metas_sel on public.cs_metas as PERMISSIVE for SELECT to authenticated using (true);
create policy cs_metas_upd on public.cs_metas as PERMISSIVE for UPDATE to authenticated using (app.is_cs_or_editor()) with check (app.is_cs_or_editor());
create policy cs_teste_vac_sel on public.cs_teste_vac as PERMISSIVE for SELECT to authenticated using (true);
create policy faq_interacoes_sel on public.faq_interacoes as PERMISSIVE for SELECT to authenticated using (((NOT app.is_cs()) OR (secao_slug = 'cs-suporte'::text)));
create policy faq_interacoes_write on public.faq_interacoes as PERMISSIVE for ALL to authenticated using ((app.is_cs_or_editor() AND ((NOT app.is_cs()) OR (secao_slug = 'cs-suporte'::text)))) with check ((app.is_cs_or_editor() AND ((NOT app.is_cs()) OR (secao_slug = 'cs-suporte'::text))));
create policy farol_config_sel on public.farol_config as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy farol_config_write on public.farol_config as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy farol_ind_sel on public.farol_indicadores as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy farol_ind_write on public.farol_indicadores as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy ig_dia_sel on public.ig_dia as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy ig_dia_write on public.ig_dia as PERMISSIVE for ALL to authenticated using (app.is_editor()) with check (app.is_editor());
create policy ig_perfil_sel on public.ig_perfil as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy ig_perfil_write on public.ig_perfil as PERMISSIVE for ALL to authenticated using (app.is_editor()) with check (app.is_editor());
create policy ig_post_sel on public.ig_post as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy ig_post_write on public.ig_post as PERMISSIVE for ALL to authenticated using (app.is_editor()) with check (app.is_editor());
create policy activity_insert_self on public.kb_activity_log as PERMISSIVE for INSERT to authenticated with check (((actor_id = auth.uid()) AND (NOT app.is_cs())));
create policy activity_select_editor on public.kb_activity_log as PERMISSIVE for SELECT to authenticated using (app.is_editor());
create policy versions_delete_admin on public.kb_document_versions as PERMISSIVE for DELETE to authenticated using (app.is_admin());
create policy versions_insert_editor on public.kb_document_versions as PERMISSIVE for INSERT to authenticated with check (app.is_editor());
create policy versions_select on public.kb_document_versions as PERMISSIVE for SELECT to authenticated using ((EXISTS ( SELECT 1 FROM kb_documents d WHERE ((d.id = kb_document_versions.document_id) AND ((d.status <> 'arquivado'::doc_status) OR app.is_editor())))));
create policy versions_update_editor on public.kb_document_versions as PERMISSIVE for UPDATE to authenticated using (app.is_editor()) with check (app.is_editor());
create policy documents_delete_admin on public.kb_documents as PERMISSIVE for DELETE to authenticated using (app.is_admin());
create policy documents_insert_editor on public.kb_documents as PERMISSIVE for INSERT to authenticated with check (app.is_editor());
create policy documents_select on public.kb_documents as PERMISSIVE for SELECT to authenticated using ((((status <> 'arquivado'::doc_status) OR app.is_editor()) AND ((NOT app.is_cs()) OR (section_id = app.cs_section_id()))));
create policy documents_update_editor on public.kb_documents as PERMISSIVE for UPDATE to authenticated using (app.is_editor()) with check (app.is_editor());
create policy sections_delete_admin on public.kb_sections as PERMISSIVE for DELETE to authenticated using (app.is_admin());
create policy sections_insert_admin on public.kb_sections as PERMISSIVE for INSERT to authenticated with check (app.is_admin());
create policy sections_select_auth on public.kb_sections as PERMISSIVE for SELECT to authenticated using (((NOT app.is_cs()) OR (id = app.cs_section_id())));
create policy sections_update_editor on public.kb_sections as PERMISSIVE for UPDATE to authenticated using (app.is_editor_estrutura()) with check (app.is_editor_estrutura());
create policy linkedin_posts_sel on public.linkedin_posts as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy linkedin_posts_write on public.linkedin_posts as PERMISSIVE for ALL to authenticated using (app.is_editor()) with check (app.is_editor());
create policy livros_envios_sel on public.livros_envios as PERMISSIVE for SELECT to authenticated using (true);
create policy livros_envios_write on public.livros_envios as PERMISSIVE for ALL to authenticated using (app.is_cs_or_editor()) with check (app.is_cs_or_editor());
create policy materiais_pedidos_sel on public.materiais_pedidos as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy materiais_pedidos_write on public.materiais_pedidos as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy nivelamento_respostas_insert_public on public.nivelamento_respostas as PERMISSIVE for INSERT to anon, authenticated with check (true);
create policy nivelamento_respostas_select_editor on public.nivelamento_respostas as PERMISSIVE for SELECT to public using (app.is_editor());
create policy ferramentas_delete_admin on public.os_ferramentas as PERMISSIVE for DELETE to authenticated using (app.is_admin());
create policy ferramentas_insert_editor on public.os_ferramentas as PERMISSIVE for INSERT to authenticated with check (app.is_editor_estrutura());
create policy ferramentas_select_auth on public.os_ferramentas as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy ferramentas_update_editor on public.os_ferramentas as PERMISSIVE for UPDATE to authenticated using (app.is_editor_estrutura()) with check (app.is_editor_estrutura());
create policy squad_select_all on public.os_squad_agentes as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy squad_write_editor on public.os_squad_agentes as PERMISSIVE for ALL to authenticated using (app.is_editor_estrutura()) with check (app.is_editor_estrutura());
create policy pesquisa_avatar_sel on public.pesquisa_avatar as PERMISSIVE for SELECT to authenticated using (true);
create policy pesquisa_avatar_write on public.pesquisa_avatar as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy profiles_admin_all on public.profiles as PERMISSIVE for ALL to authenticated using (app.is_admin()) with check (app.is_admin());
create policy profiles_select_all on public.profiles as PERMISSIVE for SELECT to authenticated using (((id = auth.uid()) OR (NOT app.is_cs())));
create policy profiles_update_self on public.profiles as PERMISSIVE for UPDATE to authenticated using ((id = auth.uid())) with check ((id = auth.uid()));
create policy slides_pedidos_sel on public.slides_pedidos as PERMISSIVE for SELECT to authenticated using ((NOT app.is_cs()));
create policy slides_pedidos_write on public.slides_pedidos as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy sync_status_sel on public.sync_status as PERMISSIVE for SELECT to authenticated using (((NOT app.is_cs()) OR (chave = ANY (ARRAY['metas-planilha'::text, 'mentorados-planilha'::text, 'teste-vac-planilha'::text]))));
create policy sync_status_write on public.sync_status as PERMISSIVE for ALL to public using (app.is_editor()) with check (app.is_editor());
create policy gerados_escrita_editor on storage.objects as PERMISSIVE for ALL to authenticated using (((bucket_id = 'gerados'::text) AND app.is_editor())) with check (((bucket_id = 'gerados'::text) AND app.is_editor()));
create policy kb_storage_delete_admin on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'kb-documents'::text) AND app.is_admin()));
create policy kb_storage_insert_editor on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'kb-documents'::text) AND app.is_editor()));
create policy kb_storage_select_auth on storage.objects as PERMISSIVE for SELECT to authenticated using (((bucket_id = 'kb-documents'::text) AND (NOT app.is_cs())));
create policy kb_storage_update_editor on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'kb-documents'::text) AND app.is_editor())) with check (((bucket_id = 'kb-documents'::text) AND app.is_editor()));

commit;
-- Depois: redeploy das versões anteriores das Edge Functions e git revert do commit do front.
