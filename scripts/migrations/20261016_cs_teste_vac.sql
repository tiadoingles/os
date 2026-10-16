-- CS / Suporte · Teste VAC (#/cs/teste-vac)
-- Cache somente leitura da planilha "Respostas Teste VAC" (1oyj0QU4n49ZnbJ2ozPPxjaB0qo_Ou4NwaWPehGNvhYM,
-- primeira aba), alimentada pelo site público tiadoingles.github.io/teste-vac (Apps Script).
-- A Edge Function "teste-vac-sheet" lê a planilha pela conta de serviço do OS e troca o cache
-- inteiro pela RPC cs_teste_vac_substituir (execute só service_role). O OS nunca escreve na planilha.
-- Atualização: ao abrir a aba (se o último sync tiver mais de 5 min), botão "Atualizar" e cron
-- os-teste-vac-planilha-30min.

create table if not exists public.cs_teste_vac (
  linha integer primary key,              -- número da linha na planilha (2 = primeira resposta)
  data date,                              -- "Data" (dd/MM/yyyy) convertida; null se ilegível
  data_txt text,                          -- texto original da coluna Data
  horario text,                           -- "Horário" (HH:mm:ss)
  respondido_em timestamptz,              -- Data + Horário em America/Sao_Paulo (ordenação)
  nome text not null default '',
  email text,
  telefone text,
  telefone_digitos text,
  mentorado boolean not null default false, -- "MENTORADO" = true; "NÃO" (Outros cursos) = false
  curso_txt text,                         -- texto original da coluna Mentorado
  respostas jsonb not null default '[]'::jsonb, -- [{ "n": 1, "texto": "A) por escrito" }, ...]
  total_a integer,                        -- Total A (Visual)
  total_b integer,                        -- Total B (Auditivo)
  total_c integer,                        -- Total C (Cinestésico)
  resultado text,                         -- texto original ("Visual", "Visual e Auditivo"...)
  canal text not null default 'indefinido'
    check (canal in ('visual', 'auditivo', 'cinestesico', 'misto', 'indefinido')),
  sincronizado_em timestamptz not null default now()
);

create index if not exists cs_teste_vac_respondido_idx on public.cs_teste_vac (respondido_em desc nulls last);

alter table public.cs_teste_vac enable row level security;

-- Leitura para qualquer usuário logado (inclui o papel CS, como cs_mentorados).
-- Sem política de escrita: só a service_role (Edge Function) grava, via RPC abaixo.
drop policy if exists cs_teste_vac_sel on public.cs_teste_vac;
create policy cs_teste_vac_sel on public.cs_teste_vac for select to authenticated using (true);

revoke all on public.cs_teste_vac from anon;
revoke insert, update, delete, truncate on public.cs_teste_vac from authenticated;
grant select on public.cs_teste_vac to authenticated;

create or replace function public.cs_teste_vac_substituir(p_linhas jsonb)
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
  select count(*) into atual from public.cs_teste_vac;
  if atual >= 20 and jsonb_array_length(p_linhas) < atual / 2 then
    raise exception 'lista caiu de % para % respostas: cache mantido (confira a planilha)', atual, jsonb_array_length(p_linhas);
  end if;
  delete from public.cs_teste_vac where true;
  insert into public.cs_teste_vac (linha, data, data_txt, horario, respondido_em, nome, email, telefone, telefone_digitos,
    mentorado, curso_txt, respostas, total_a, total_b, total_c, resultado, canal, sincronizado_em)
  select (r->>'linha')::int, (r->>'data')::date, r->>'data_txt', r->>'horario', (r->>'respondido_em')::timestamptz,
    coalesce(r->>'nome', ''), r->>'email', r->>'telefone', r->>'telefone_digitos',
    coalesce((r->>'mentorado')::boolean, false), r->>'curso_txt', coalesce(r->'respostas', '[]'::jsonb),
    (r->>'total_a')::int, (r->>'total_b')::int, (r->>'total_c')::int, r->>'resultado',
    coalesce(r->>'canal', 'indefinido'), now()
  from jsonb_array_elements(p_linhas) r;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.cs_teste_vac_substituir(jsonb) from public, anon, authenticated;
grant execute on function public.cs_teste_vac_substituir(jsonb) to service_role;

-- Status do sync (aparece em Administração > Sincronizações e no aviso da aba).
insert into public.sync_status (chave, nome, tipo, cadencia_horas, ordem)
values ('teste-vac-planilha', 'Teste VAC — planilha de respostas', 'server', 1, 22)
on conflict (chave) do nothing;

-- Cron leve: a cada 30 min (os dados chegam a toda hora pelo site público).
select cron.unschedule('os-teste-vac-planilha-30min')
where exists (select 1 from cron.job where jobname = 'os-teste-vac-planilha-30min');
select cron.schedule('os-teste-vac-planilha-30min', '*/30 * * * *', $cron$
  select net.http_post(
    url := 'https://hmvlkltyvyhlxfyaovpe.supabase.co/functions/v1/teste-vac-sheet',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', 'os-sync-tok-9Fx3Qm7Lp2Vw'),
    body := '{"origem":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
