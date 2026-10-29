-- Linter do Supabase (function_search_path_mutable): fixa o search_path das guardas novas do Financeiro.
-- Os avisos "security definer executável por authenticated" (linkedin_conexao_status, os_restaurar_cs_metas,
-- os_restaurar_diagnostico) são intencionais: as três checam permissão por dentro (tem_area / is_cs_or_editor).
alter function app.fin_cobrancas_guarda() set search_path = public;
alter function app.fin_hotmart_pedidos_guarda() set search_path = public;
