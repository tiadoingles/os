-- Reverte a migration 20261009_papel_cs_helpers_e_rls para o estado anterior (policies originais).
-- ATENCAO: reabre a leitura anonima (role public) das tabelas do OS, como era antes. O valor 'cs' do enum
-- user_role nao pode ser removido; basta nao atribuir o papel.
drop policy if exists livros_envios_sel on public.livros_envios; drop policy if exists livros_envios_write on public.livros_envios;
create policy livros_envios_sel on public.livros_envios for select using (true);
create policy livros_envios_write on public.livros_envios for all using (app.is_editor()) with check (app.is_editor());
drop policy if exists faq_interacoes_sel on public.faq_interacoes; drop policy if exists faq_interacoes_write on public.faq_interacoes;
create policy faq_interacoes_sel on public.faq_interacoes for select using (true);
create policy faq_interacoes_write on public.faq_interacoes for all using (app.is_editor()) with check (app.is_editor());
drop policy if exists cs_diagnosticos_write on public.cs_diagnosticos;
create policy cs_diagnosticos_write on public.cs_diagnosticos for all to authenticated using (app.is_editor()) with check (app.is_editor());
drop policy if exists cs_metas_ins on public.cs_metas; drop policy if exists cs_metas_upd on public.cs_metas; drop policy if exists cs_metas_del on public.cs_metas;
create policy cs_metas_ins on public.cs_metas for insert to authenticated with check (app.is_editor());
create policy cs_metas_upd on public.cs_metas for update to authenticated using (app.is_editor()) with check (app.is_editor());
create policy cs_metas_del on public.cs_metas for delete to authenticated using (app.is_editor() and origem = 'manual');
drop policy if exists pesquisa_avatar_sel on public.pesquisa_avatar; create policy pesquisa_avatar_sel on public.pesquisa_avatar for select using (true);
drop policy if exists "chat_widget_logs: cs e editor leem" on public.chat_widget_logs;
create policy "chat_widget_logs: editor le" on public.chat_widget_logs for select using (app.is_editor());
drop policy if exists sync_status_sel on public.sync_status; create policy sync_status_sel on public.sync_status for select using (true);
drop policy if exists automacao_estado_sel on public.automacao_estado; create policy automacao_estado_sel on public.automacao_estado for select using (true);
drop policy if exists agenda_eventos_sel on public.agenda_eventos; create policy agenda_eventos_sel on public.agenda_eventos for select using (true);
drop policy if exists ai_usage_log_sel on public.ai_usage_log; create policy ai_usage_log_sel on public.ai_usage_log for select using (true);
drop policy if exists aulas_agenda_sel on public.aulas_agenda; create policy aulas_agenda_sel on public.aulas_agenda for select using (true);
drop policy if exists conteudo_calendario_sel on public.conteudo_calendario; create policy conteudo_calendario_sel on public.conteudo_calendario for select using (true);
drop policy if exists conteudo_insights_sel on public.conteudo_insights; create policy conteudo_insights_sel on public.conteudo_insights for select using (true);
drop policy if exists conteudo_objetivo_resumo_sel on public.conteudo_objetivo_resumo; create policy conteudo_objetivo_resumo_sel on public.conteudo_objetivo_resumo for select using (true);
drop policy if exists farol_config_sel on public.farol_config; create policy farol_config_sel on public.farol_config for select using (true);
drop policy if exists farol_ind_sel on public.farol_indicadores; create policy farol_ind_sel on public.farol_indicadores for select using (true);
drop policy if exists materiais_pedidos_sel on public.materiais_pedidos; create policy materiais_pedidos_sel on public.materiais_pedidos for select using (true);
drop policy if exists slides_pedidos_sel on public.slides_pedidos; create policy slides_pedidos_sel on public.slides_pedidos for select using (true);
drop policy if exists squad_select_all on public.os_squad_agentes; create policy squad_select_all on public.os_squad_agentes for select using (true);
drop policy if exists ferramentas_select_auth on public.os_ferramentas; create policy ferramentas_select_auth on public.os_ferramentas for select to authenticated using (true);
drop policy if exists ig_dia_sel on public.ig_dia; create policy ig_dia_sel on public.ig_dia for select to authenticated using (true);
drop policy if exists ig_perfil_sel on public.ig_perfil; create policy ig_perfil_sel on public.ig_perfil for select to authenticated using (true);
drop policy if exists ig_post_sel on public.ig_post; create policy ig_post_sel on public.ig_post for select to authenticated using (true);
drop policy if exists profiles_select_all on public.profiles; create policy profiles_select_all on public.profiles for select to authenticated using (true);
drop policy if exists sections_select_auth on public.kb_sections; create policy sections_select_auth on public.kb_sections for select to authenticated using (true);
drop policy if exists documents_select on public.kb_documents;
create policy documents_select on public.kb_documents for select to authenticated using (status <> 'arquivado'::doc_status or app.is_editor());
drop policy if exists kb_storage_select_auth on storage.objects;
create policy kb_storage_select_auth on storage.objects for select to authenticated using (bucket_id = 'kb-documents');
-- As funcoes os_restaurar_cs_metas / os_restaurar_diagnostico: trocar app.is_cs_or_editor() por app.is_editor() na 1a linha do corpo.
-- Helpers app.is_cs(), app.is_cs_or_editor(), app.cs_section_id() podem ficar (inofensivos).
