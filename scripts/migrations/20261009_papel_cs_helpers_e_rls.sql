-- Migration 20261009_papel_cs_helpers_e_rls (NAO APLICADA em producao: aguarda autorizacao).
-- Pre-requisito ja aplicado: user_role_add_cs (alter type public.user_role add value 'cs').
-- Teste de RLS apos aplicar: teste_rls_cs.sql (roda tudo em transacao que termina em erro => rollback).
-- Reverter: rollback_papel_cs.sql.
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
  using (not app.is_cs() or chave in ('metas-planilha', 'mentorados-planilha'));

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

-- ---------- DESFAZER: restauracao por RPC tambem para cs ----------
CREATE OR REPLACE FUNCTION public.os_restaurar_cs_metas(p_versoes jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb; snap jsonb; m public.cs_metas; atual public.cs_metas; f public.cs_diagnosticos; fm jsonb; n integer := 0;
begin
  if not app.is_cs_or_editor() then raise exception 'sem permissão para restaurar metas'; end if;
  if jsonb_typeof(p_versoes) is distinct from 'array' or jsonb_array_length(p_versoes) > 200 then
    raise exception 'formato inválido';
  end if;
  perform set_config('app.metas_sync', '1', true);
  for v in select x from jsonb_array_elements(p_versoes) x loop
    select s.dados into snap from public.os_desfazer_snapshots s
     where s.tabela = 'cs_metas' and s.registro_id = (v->>'id')::uuid
       and (s.dados->>'updated_at')::timestamptz = (v->>'updated_at')::timestamptz
     order by s.id desc limit 1;
    if snap is null then raise exception 'versão anterior da meta não encontrada'; end if;
    m := jsonb_populate_record(null::public.cs_metas, snap);
    select * into atual from public.cs_metas where id = m.id;
    if found and atual.origem <> m.origem then raise exception 'a meta mudou de origem'; end if;
    m.updated_at := now();
    if m.origem = 'diagnostico' then
      select * into f from public.cs_diagnosticos where id = m.diagnostico_id;
      if not found then raise exception 'a ficha desta meta não existe mais'; end if;
      fm := null;
      select x into fm from jsonb_array_elements(case when jsonb_typeof(f.dados->'metas') = 'array' then f.dados->'metas' else '[]'::jsonb end) x
        where x->>'id' = m.meta_id limit 1;
      if fm is not null then -- a ficha manda no texto/data; da versão guardada volta o FEITO
        m.descricao := btrim(coalesce(fm->>'descricao', ''));
        m.vencimento := case when coalesce(fm->>'data', '') ~ '^\d{4}-\d{2}-\d{2}$' then (fm->>'data')::date end;
        m.mentorado_nome := coalesce(f.nome, ''); m.mentorado_email := nullif(btrim(coalesce(f.email, '')), '');
        m.removida_da_ficha := false;
      elsif m.concluida_em is null then
        continue; -- meta aberta que já não está na ficha: não volta
      else
        m.removida_da_ficha := true;
      end if;
      -- linha recriada pela sincronização da ficha (aberta, outro id) dá lugar à versão guardada
      delete from public.cs_metas where diagnostico_id = m.diagnostico_id and meta_id = m.meta_id
        and id <> m.id and concluida_em is null;
      if exists (select 1 from public.cs_metas where diagnostico_id = m.diagnostico_id and meta_id = m.meta_id and id <> m.id) then
        raise exception 'já existe outra meta concluída para este item da ficha';
      end if;
    elsif m.diagnostico_id is not null and not exists (select 1 from public.cs_diagnosticos where id = m.diagnostico_id) then
      m.diagnostico_id := null;
    end if;
    insert into public.cs_metas values (m.*)
    on conflict (id) do update set
      diagnostico_id = excluded.diagnostico_id, meta_id = excluded.meta_id,
      mentorado_nome = excluded.mentorado_nome, mentorado_email = excluded.mentorado_email,
      descricao = excluded.descricao, vencimento = excluded.vencimento,
      concluida_em = excluded.concluida_em, concluida_por = excluded.concluida_por, concluida_por_nome = excluded.concluida_por_nome,
      removida_da_ficha = excluded.removida_da_ficha
    where cs_metas.origem = excluded.origem;
    n := n + 1;
  end loop;
  perform set_config('app.metas_sync', '', true);
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.os_restaurar_diagnostico(p_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s_ficha public.os_desfazer_snapshots; f public.cs_diagnosticos; s record; m public.cs_metas; n integer := 0;
begin
  if not app.is_cs_or_editor() then raise exception 'sem permissão para restaurar a ficha'; end if;
  if exists (select 1 from public.cs_diagnosticos where id = p_id) then raise exception 'a ficha já existe'; end if;
  select * into s_ficha from public.os_desfazer_snapshots
   where tabela = 'cs_diagnosticos' and registro_id = p_id and operacao = 'DELETE' order by id desc limit 1;
  if not found then raise exception 'cópia da ficha não encontrada'; end if;
  f := jsonb_populate_record(null::public.cs_diagnosticos, s_ficha.dados);
  perform set_config('app.restaurando', '1', true);
  insert into public.cs_diagnosticos values (f.*);
  perform set_config('app.restaurando', '', true);

  perform set_config('app.metas_sync', '1', true);
  for s in select * from public.os_desfazer_snapshots
            where txid = s_ficha.txid and tabela = 'cs_metas' order by id loop
    m := jsonb_populate_record(null::public.cs_metas, s.dados);
    if m.origem = 'manual' then
      update public.cs_metas set diagnostico_id = p_id where id = m.id and diagnostico_id is null;
    elsif s.operacao = 'DELETE' and m.diagnostico_id = p_id then
      delete from public.cs_metas where diagnostico_id = p_id and meta_id = m.meta_id and id <> m.id and concluida_em is null;
      m.updated_at := now();
      insert into public.cs_metas values (m.*) on conflict (id) do nothing;
      n := n + 1;
    end if;
  end loop;
  perform set_config('app.metas_sync', '', true);
  return n;
end $function$;
