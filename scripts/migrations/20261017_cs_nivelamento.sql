-- CS / Suporte · Testes de Nivelamento (#/cs/nivelamento)
-- Cache somente leitura da planilha "Teste de Nivelamento Fluent Mind (respostas)"
-- (1YhlAuX3PqsJ1o0StPPe8GW4zEXsJjYqBY7yjSZhETO8), SÓ a aba "Novo" (pedido da Tia, 17/10/2026),
-- alimentada pela Edge Function pública "nivelamento" (IA avalia e manda a linha pelo Apps Script).
-- A Edge Function "nivelamento-sheet" lê a aba pela conta de serviço do OS e troca o cache inteiro
-- pela RPC cs_nivelamento_substituir (execute só service_role). O OS nunca escreve na planilha.
-- Atualização: ao abrir a aba (se o último sync tiver mais de 5 min), botão "Atualizar" e cron
-- os-nivelamento-planilha-30min. Mesmo modelo de 20261016_cs_teste_vac.sql.

create table if not exists public.cs_nivelamento (
  linha integer primary key,              -- número da linha na aba Novo (2 = primeira resposta)
  enviado_em timestamptz,                 -- "Enviado às" (dd/MM/yyyy, HH:mm:ss) em America/Sao_Paulo
  enviado_txt text,                       -- texto original
  data date,                              -- dia de enviado_em (filtro de período)
  nome text not null default '',
  email text,
  whatsapp text,
  whatsapp_digitos text,
  trilha integer check (trilha between 1 and 5), -- número de "Trilha indicada" (null se ilegível)
  trilha_txt text,                        -- texto original ("SPRINT → Trilha 2 · Básico II")
  nota_vocabulario numeric(4,1),
  nota_leitura numeric(4,1),
  nota_gramatica numeric(4,1),
  nota_listening numeric(4,1),
  nota_escrita numeric(4,1),
  media numeric(4,1),                     -- média das notas preenchidas
  autoavaliacao integer check (autoavaliacao between 1 and 5),
  justificativa text,
  pontos_fortes text,
  pontos_atencao text,
  observacao_emocional text,
  perfil jsonb not null default '[]'::jsonb,     -- [{ "titulo": "Maior dificuldade", "texto": "..." }, ...]
  respostas jsonb not null default '[]'::jsonb,  -- [{ "n": 1, "titulo": "Palavras sobre VIAGEM", "texto": "..." }, ...]
  mentorado boolean not null default false,      -- e-mail (ou WhatsApp) encontrado na Lista de Mentorados
  mentorado_status text,                         -- status da Lista de Mentorados, quando encontrado
  sincronizado_em timestamptz not null default now()
);

create index if not exists cs_nivelamento_enviado_idx on public.cs_nivelamento (enviado_em desc nulls last);

alter table public.cs_nivelamento enable row level security;

-- Leitura: ADM e quem tem a aba CS / Suporte (padrão do acesso por aba). Sem política de escrita:
-- só a service_role (Edge Function) grava, via RPC abaixo.
drop policy if exists cs_nivelamento_sel on public.cs_nivelamento;
create policy cs_nivelamento_sel on public.cs_nivelamento for select to authenticated using (app.tem_area('cs'));

revoke all on public.cs_nivelamento from anon;
revoke insert, update, delete, truncate on public.cs_nivelamento from authenticated;
grant select on public.cs_nivelamento to authenticated;

create or replace function public.cs_nivelamento_substituir(p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer; atual integer;
begin
  if jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'formato inválido: cache mantido';
  end if;
  -- Nunca troca o cache por uma lista muito menor (aba trocada, linhas apagadas por engano).
  select count(*) into atual from public.cs_nivelamento;
  if atual >= 20 and jsonb_array_length(p_linhas) < atual / 2 then
    raise exception 'lista caiu de % para % respostas: cache mantido (confira a planilha)', atual, jsonb_array_length(p_linhas);
  end if;
  delete from public.cs_nivelamento where true;
  insert into public.cs_nivelamento (linha, enviado_em, enviado_txt, data, nome, email, whatsapp, whatsapp_digitos,
    trilha, trilha_txt, nota_vocabulario, nota_leitura, nota_gramatica, nota_listening, nota_escrita, media,
    autoavaliacao, justificativa, pontos_fortes, pontos_atencao, observacao_emocional, perfil, respostas,
    mentorado, mentorado_status, sincronizado_em)
  select (r->>'linha')::int, (r->>'enviado_em')::timestamptz, r->>'enviado_txt', (r->>'data')::date,
    coalesce(r->>'nome', ''), r->>'email', r->>'whatsapp', r->>'whatsapp_digitos',
    (r->>'trilha')::int, r->>'trilha_txt',
    (r->>'nota_vocabulario')::numeric, (r->>'nota_leitura')::numeric, (r->>'nota_gramatica')::numeric,
    (r->>'nota_listening')::numeric, (r->>'nota_escrita')::numeric, (r->>'media')::numeric,
    (r->>'autoavaliacao')::int, r->>'justificativa', r->>'pontos_fortes', r->>'pontos_atencao',
    r->>'observacao_emocional', coalesce(r->'perfil', '[]'::jsonb), coalesce(r->'respostas', '[]'::jsonb),
    coalesce((r->>'mentorado')::boolean, false), r->>'mentorado_status', now()
  from jsonb_array_elements(p_linhas) r;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.cs_nivelamento_substituir(jsonb) from public, anon, authenticated;
grant execute on function public.cs_nivelamento_substituir(jsonb) to service_role;

-- Status do sync (Administração > Sincronizações e aviso da aba). Quem tem a aba CS lê esta chave.
insert into public.sync_status (chave, nome, tipo, cadencia_horas, ordem)
values ('nivelamento-planilha', 'Testes de Nivelamento — aba Novo', 'server', 1, 23)
on conflict (chave) do nothing;

drop policy if exists sync_status_sel on public.sync_status;
create policy sync_status_sel on public.sync_status for select to authenticated
  using (app.is_admin() or (app.tem_area('cs') and chave = any (array['metas-planilha','mentorados-planilha','teste-vac-planilha','nivelamento-planilha'])));

-- Cron leve: a cada 30 min (os testes chegam a qualquer hora).
select cron.unschedule('os-nivelamento-planilha-30min')
where exists (select 1 from cron.job where jobname = 'os-nivelamento-planilha-30min');
select cron.schedule('os-nivelamento-planilha-30min', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://hmvlkltyvyhlxfyaovpe.supabase.co/functions/v1/nivelamento-sheet',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', 'os-sync-tok-9Fx3Qm7Lp2Vw'),
    body := '{"origem":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
