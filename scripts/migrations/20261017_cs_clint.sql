-- Ficha do Mentorado · integração com o Clint (CRM + WhatsApp). Pedido da Tia, 17/10/2026.
-- Cache somente leitura por mentorado (chave = e-mail da Lista de Mentorados), preenchido pela Edge Function
-- "clint-sync" com a API REST do Clint (https://api.clint.digital, header api-token; segredo CLINT_API_TOKEN nas
-- Edge Functions, plano Elite). Os marcos (negócio criado/ganho/perdido, conversa) também viram linhas em
-- cs_mentorado_eventos (fonte 'clint') para a Linha do tempo da ficha.
-- Atualização: cron os-clint-30min (lote dos mentorados sincronizados há mais tempo) e botão "Atualizar do Clint"
-- na ficha (uma pessoa, na hora). O OS nunca escreve no Clint.

create table if not exists public.cs_clint (
  mentorado_email text primary key,
  encontrado boolean not null default false,  -- achou contato no Clint pelo e-mail/telefone
  contatos jsonb not null default '[]'::jsonb, -- [{ id, name, email, phone, tags:[nome], fields, created_at }]
  negocios jsonb not null default '[]'::jsonb, -- [{ id, status, origem, grupo, etapa, dono, created_at, won_at, lost_at, motivo_perda, fields }]
  conversas jsonb not null default '[]'::jsonb, -- [{ id, status, dono, created_at, last_message_at, closed_at, unread, mensagens:[{ type, content, created_at, autor }] }]
  erro text,
  sincronizado_em timestamptz not null default now()
);
create index if not exists cs_clint_sinc_idx on public.cs_clint (sincronizado_em);

alter table public.cs_clint enable row level security;
drop policy if exists cs_clint_sel on public.cs_clint;
create policy cs_clint_sel on public.cs_clint for select to authenticated using (app.tem_area('cs'));
revoke all on public.cs_clint from anon;
revoke insert, update, delete, truncate, references, trigger on public.cs_clint from authenticated;
grant select on public.cs_clint to authenticated;

-- Status do sync (Administração > Sincronizações). Quem tem a aba CS lê esta chave.
insert into public.sync_status (chave, nome, tipo, cadencia_horas, ordem)
values ('clint', 'Clint — CRM e WhatsApp dos mentorados', 'server', 1, 25)
on conflict (chave) do nothing;

drop policy if exists sync_status_sel on public.sync_status;
create policy sync_status_sel on public.sync_status for select to authenticated
  using (app.is_admin() or (app.tem_area('cs') and chave = any (array['metas-planilha','mentorados-planilha',
    'teste-vac-planilha','nivelamento-planilha','pesquisas-respostas','clint'])));

-- Ficha: inclui o bloco do Clint (mesma função de 20261017_cs_ficha_mentorado, com a chave 'clint').
create or replace function public.cs_ficha_mentorado(p_email text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  m public.cs_mentorados;
  emails text[];
  tels text[];
  diag_ids uuid[];
begin
  if e = '' then return null; end if;
  select * into m from public.cs_mentorados x where lower(btrim(x.email)) = e order by x.linha limit 1;
  emails := array[e] || coalesce(array(select v.valor from public.cs_mentorado_vinculos v where v.mentorado_email = e and v.tipo = 'email'), '{}');
  tels := coalesce(array(
    select distinct t from (
      select app.tel10(p) t from regexp_split_to_table(coalesce(m.telefone, ''), '\s*(/|;|,| ou )\s*') p
      union select v.valor from public.cs_mentorado_vinculos v where v.mentorado_email = e and v.tipo = 'telefone'
    ) z where t is not null), '{}');
  diag_ids := coalesce(array(select d.id from public.cs_diagnosticos d
    where lower(btrim(d.email)) = any(emails) or app.tel10(d.dados->>'telefone') = any(tels)), '{}');

  return jsonb_build_object(
    'email', e,
    'chaves', jsonb_build_object('emails', to_jsonb(emails), 'telefones', to_jsonb(tels)),
    'mentorado', case when m.linha is null then null else to_jsonb(m) end,
    'diagnosticos', coalesce((select jsonb_agg(to_jsonb(d) order by d.data_diagnostico desc nulls last, d.created_at desc)
      from public.cs_diagnosticos d where d.id = any(diag_ids)), '[]'::jsonb),
    'metas', coalesce((select jsonb_agg(to_jsonb(x) order by x.concluida_em nulls first, x.vencimento nulls last)
      from public.cs_metas x where lower(btrim(x.mentorado_email)) = any(emails) or x.diagnostico_id = any(diag_ids)), '[]'::jsonb),
    'teste_vac', coalesce((select jsonb_agg(to_jsonb(x) order by x.respondido_em desc nulls last)
      from public.cs_teste_vac x where lower(btrim(x.email)) = any(emails) or app.tel10(x.telefone_digitos) = any(tels)), '[]'::jsonb),
    'nivelamento', coalesce((select jsonb_agg(to_jsonb(x) order by x.enviado_em desc nulls last)
      from public.cs_nivelamento x where lower(btrim(x.email)) = any(emails) or app.tel10(x.whatsapp_digitos) = any(tels)), '[]'::jsonb),
    'pesquisas', coalesce((select jsonb_agg(to_jsonb(x) order by x.respondido_em desc nulls last)
      from public.cs_pesquisa_respostas x where lower(btrim(x.email)) = any(emails) or app.tel10(x.telefone) = any(tels)), '[]'::jsonb),
    'chat', coalesce((select jsonb_agg(c order by c.created_at desc) from (
      select x.id, x.created_at, x.pergunta, x.resposta, x.categoria, x.email from public.chat_widget_logs x
      where lower(btrim(x.email)) = any(emails) order by x.created_at desc limit 50) c), '[]'::jsonb),
    'livros', coalesce((select jsonb_agg(to_jsonb(x) - 'cpf' order by x.data_venda desc nulls last)
      from public.livros_envios x
      where lower(btrim(x.email)) = any(emails) or app.tel10(x.telefone) = any(tels)
         or (m.nome is not null and length(btrim(m.nome)) > 5 and lower(btrim(x.nome)) = lower(btrim(m.nome)))), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from public.cs_mentorado_notas x where x.mentorado_email = e), '[]'::jsonb),
    'vinculos', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at)
      from public.cs_mentorado_vinculos x where x.mentorado_email = e), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(to_jsonb(x) order by x.ocorrido_em desc nulls last)
      from public.cs_mentorado_eventos x
      where x.mentorado_email = e or lower(btrim(x.email)) = any(emails) or app.tel10(x.telefone) = any(tels)), '[]'::jsonb),
    'clint', (select to_jsonb(c) from public.cs_clint c where c.mentorado_email = e)
  );
end $$;
revoke all on function public.cs_ficha_mentorado(text) from public, anon;
grant execute on function public.cs_ficha_mentorado(text) to authenticated;

-- Cron: a cada 30 min a função pega um lote dos mentorados sincronizados há mais tempo.
select cron.unschedule('os-clint-30min') where exists (select 1 from cron.job where jobname = 'os-clint-30min');
select cron.schedule('os-clint-30min', '20,50 * * * *', $cron$
  select net.http_post(
    url := 'https://hmvlkltyvyhlxfyaovpe.supabase.co/functions/v1/clint-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', 'os-sync-tok-9Fx3Qm7Lp2Vw'),
    body := '{"origem":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$cron$);
