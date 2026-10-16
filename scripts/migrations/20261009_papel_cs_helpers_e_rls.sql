-- Migration 20261009_papel_cs_helpers_e_rls (revisada e APLICADA em 16/10/2026 como papel_cs_helpers_e_rls).
-- Pre-requisito ja aplicado: user_role_add_cs (alter type public.user_role add value 'cs').
-- Teste de RLS apos aplicar: teste_rls_cs.sql (roda tudo em transacao que termina em erro => rollback).
-- Reverter: rollback_papel_cs.sql.
-- Compativel com 20261016_troca_senha_e_adm_limitado (ADM limitado e role editor: entra em is_cs_or_editor;
-- esta migration so mexe nas politicas de select de kb_sections/os_ferramentas/os_squad_agentes, nunca
-- nas de escrita com app.is_editor_estrutura()) e com 20261016_cs_teste_vac (cs_teste_vac ja e
-- select to authenticated; sync_status libera a chave teste-vac-planilha para o cs).
-- ===== Papel "cs": helpers, escrita nas tabelas de CS e leitura restrita nas demais =====

-- Helpers (schema app, mesmo padrao de is_editor/is_admin: security definer, so authenticated executa).
create or replace function app.is_cs()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_user_role() = 'cs', false);
$$;

create or replace function app.is_cs_or_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_user_role() in ('cs', 'editor', 'admin'), false);
$$;

-- Secao da Base de Conhecimento que alimenta o FAQ de CS (unica que o papel cs pode ler).
create or replace function app.cs_section_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.kb_sections where slug = 'cs-suporte';
$$;

revoke all on function app.is_cs() from public, anon;
revoke all on function app.is_cs_or_editor() from public, anon;
revoke all on function app.cs_section_id() from public, anon;
grant execute on function app.is_cs() to authenticated;
grant execute on function app.is_cs_or_editor() to authenticated;
grant execute on function app.cs_section_id() to authenticated;

-- ---------- Tabelas de CS: escrita para cs + editor + admin; leitura so para logados ----------
drop policy if exists livros_envios_sel on public.livros_envios;
drop policy if exists livros_envios_write on public.livros_envios;
create policy livros_envios_sel on public.livros_envios for select to authenticated using (true);
create policy livros_envios_write on public.livros_envios for all to authenticated
  using (app.is_cs_or_editor()) with check (app.is_cs_or_editor());

drop policy if exists faq_interacoes_sel on public.faq_interacoes;
drop policy if exists faq_interacoes_write on public.faq_interacoes;
create policy faq_interacoes_sel on public.faq_interacoes for select to authenticated
  using (not app.is_cs() or secao_slug = 'cs-suporte');
create policy faq_interacoes_write on public.faq_interacoes for all to authenticated
  using (app.is_cs_or_editor() and (not app.is_cs() or secao_slug = 'cs-suporte'))
  with check (app.is_cs_or_editor() and (not app.is_cs() or secao_slug = 'cs-suporte'));

drop policy if exists cs_diagnosticos_write on public.cs_diagnosticos;
create policy cs_diagnosticos_write on public.cs_diagnosticos for all to authenticated
  using (app.is_cs_or_editor()) with check (app.is_cs_or_editor());

drop policy if exists cs_metas_ins on public.cs_metas;
drop policy if exists cs_metas_upd on public.cs_metas;
drop policy if exists cs_metas_del on public.cs_metas;
create policy cs_metas_ins on public.cs_metas for insert to authenticated with check (app.is_cs_or_editor());
create policy cs_metas_upd on public.cs_metas for update to authenticated
  using (app.is_cs_or_editor()) with check (app.is_cs_or_editor());
create policy cs_metas_del on public.cs_metas for delete to authenticated
  using (app.is_cs_or_editor() and origem = 'manual');

-- Leitura de dados que so a aba CS usa (cs enxerga; editor/admin como antes).
drop policy if exists pesquisa_avatar_sel on public.pesquisa_avatar;
create policy pesquisa_avatar_sel on public.pesquisa_avatar for select to authenticated using (true);

drop policy if exists "chat_widget_logs: editor le" on public.chat_widget_logs;
create policy "chat_widget_logs: cs e editor leem" on public.chat_widget_logs for select to authenticated
  using (app.is_cs_or_editor());

drop policy if exists sync_status_sel on public.sync_status;
create policy sync_status_sel on public.sync_status for select to authenticated
  using (not app.is_cs() or chave in ('metas-planilha', 'mentorados-planilha', 'teste-vac-planilha'));

-- Flag de pausa de IA: o cs precisa le-la (a Edge Function ai consulta com o JWT de quem chama).
drop policy if exists automacao_estado_sel on public.automacao_estado;
create policy automacao_estado_sel on public.automacao_estado for select to authenticated using (true);

-- ---------- Tabelas fora de CS: papel cs nao le (e anon tambem deixa de ler) ----------
drop policy if exists agenda_eventos_sel on public.agenda_eventos;
create policy agenda_eventos_sel on public.agenda_eventos for select to authenticated using (not app.is_cs());
drop policy if exists ai_usage_log_sel on public.ai_usage_log;
create policy ai_usage_log_sel on public.ai_usage_log for select to authenticated using (not app.is_cs());
drop policy if exists aulas_agenda_sel on public.aulas_agenda;
create policy aulas_agenda_sel on public.aulas_agenda for select to authenticated using (not app.is_cs());
drop policy if exists conteudo_calendario_sel on public.conteudo_calendario;
create policy conteudo_calendario_sel on public.conteudo_calendario for select to authenticated using (not app.is_cs());
drop policy if exists conteudo_insights_sel on public.conteudo_insights;
create policy conteudo_insights_sel on public.conteudo_insights for select to authenticated using (not app.is_cs());
drop policy if exists conteudo_objetivo_resumo_sel on public.conteudo_objetivo_resumo;
create policy conteudo_objetivo_resumo_sel on public.conteudo_objetivo_resumo for select to authenticated using (not app.is_cs());
drop policy if exists farol_config_sel on public.farol_config;
create policy farol_config_sel on public.farol_config for select to authenticated using (not app.is_cs());
drop policy if exists farol_ind_sel on public.farol_indicadores;
create policy farol_ind_sel on public.farol_indicadores for select to authenticated using (not app.is_cs());
drop policy if exists materiais_pedidos_sel on public.materiais_pedidos;
create policy materiais_pedidos_sel on public.materiais_pedidos for select to authenticated using (not app.is_cs());
drop policy if exists slides_pedidos_sel on public.slides_pedidos;
create policy slides_pedidos_sel on public.slides_pedidos for select to authenticated using (not app.is_cs());
drop policy if exists squad_select_all on public.os_squad_agentes;
create policy squad_select_all on public.os_squad_agentes for select to authenticated using (not app.is_cs());
drop policy if exists ferramentas_select_auth on public.os_ferramentas;
create policy ferramentas_select_auth on public.os_ferramentas for select to authenticated using (not app.is_cs());
drop policy if exists ig_dia_sel on public.ig_dia;
create policy ig_dia_sel on public.ig_dia for select to authenticated using (not app.is_cs());
drop policy if exists ig_perfil_sel on public.ig_perfil;
create policy ig_perfil_sel on public.ig_perfil for select to authenticated using (not app.is_cs());
drop policy if exists ig_post_sel on public.ig_post;
create policy ig_post_sel on public.ig_post for select to authenticated using (not app.is_cs());

-- Pessoas: cs ve so o proprio perfil.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles for select to authenticated
  using (id = auth.uid() or not app.is_cs());

-- Base de Conhecimento: cs ve apenas a secao CS / Suporte (alimenta o FAQ via Edge Function ai).
-- kb_document_versions herda: a policy dela consulta kb_documents sob RLS.
drop policy if exists sections_select_auth on public.kb_sections;
create policy sections_select_auth on public.kb_sections for select to authenticated
  using (not app.is_cs() or id = app.cs_section_id());

drop policy if exists documents_select on public.kb_documents;
create policy documents_select on public.kb_documents for select to authenticated
  using ((status <> 'arquivado'::doc_status or app.is_editor())
         and (not app.is_cs() or section_id = app.cs_section_id()));

drop policy if exists kb_storage_select_auth on storage.objects;
create policy kb_storage_select_auth on storage.objects for select to authenticated
  using (bucket_id = 'kb-documents' and not app.is_cs());

-- Atividade da Base: cs nao registra (a aba CS nao grava kb_activity_log).
drop policy if exists activity_insert_self on public.kb_activity_log;
create policy activity_insert_self on public.kb_activity_log for insert to authenticated
  with check (actor_id = auth.uid() and not app.is_cs());

-- ---------- DESFAZER: restauracao por RPC tambem para cs ----------
-- Troca so a checagem de papel (app.is_editor() -> app.is_cs_or_editor()) no corpo ATUAL das funcoes,
-- sem recopiar o corpo (evita sobrescrever ajustes feitos nelas depois desta migration).
do $m$
declare f text; def text;
begin
  foreach f in array array['os_restaurar_cs_metas(jsonb)', 'os_restaurar_diagnostico(uuid)'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    if position('app.is_editor()' in def) = 0 and position('app.is_cs_or_editor()' in def) = 0 then
      raise exception 'checagem de papel nao encontrada em %', f;
    end if;
    execute replace(def, 'app.is_editor()', 'app.is_cs_or_editor()');
  end loop;
end $m$;
