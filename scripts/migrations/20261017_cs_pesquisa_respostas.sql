-- CS / Suporte · Pesquisas de Alunos (#/cs/pesquisas, #/cs/pesquisas/mentorados, #/cs/pesquisas/outros)
-- Cache somente leitura das RESPOSTAS individuais das pesquisas (a tabela pesquisa_avatar continua só com
-- totais e o resumo da IA). Pedido da Tia (17/10/2026): separar em Mentorados e Outros, com pizzas,
-- filtros e um campo para perguntar sobre os dados.
--   grupo 'mentorados': mentoria-fluent-mind (Pesquisa Aluno - Mentoria Fluent Mind) e pnl-mentoria
--   grupo 'outros':     metodo-tia-do-ingles, decole-com-a-tia, memorizacao (planilha do funil, aba
--                       "Pesquisa", coluna Fonte Pesquisa) e pnl-metodo
-- A Edge Function "pesquisas-respostas" lê as planilhas pela conta de serviço do OS e troca o cache pela RPC
-- cs_pesquisa_substituir (execute só service_role). O OS nunca escreve nas planilhas.
-- Atualização: ao abrir a aba (se o último sync tiver mais de 10 min), botão "Atualizar" e cron
-- os-pesquisas-respostas-30min. A mesma função responde às perguntas (op "perguntar", IA).

create table if not exists public.cs_pesquisa_respostas (
  chave text not null,                    -- pesquisa_avatar.chave
  linha integer not null,                 -- número da linha na planilha/aba de origem
  grupo text not null check (grupo in ('mentorados', 'outros')),
  respondido_em timestamptz,
  nome text,
  email text,
  telefone text,
  na_lista boolean not null default false, -- e-mail/telefone encontrado na Lista de Mentorados (cs_mentorados)
  dados jsonb not null default '[]'::jsonb, -- [{ "p": "pergunta (cabeçalho)", "r": "resposta" }, ...] na ordem da planilha
  sincronizado_em timestamptz not null default now(),
  primary key (chave, linha)
);

create index if not exists cs_pesquisa_respostas_grupo_idx on public.cs_pesquisa_respostas (grupo, respondido_em desc nulls last);

alter table public.cs_pesquisa_respostas enable row level security;

-- Leitura: ADM e quem tem a aba CS / Suporte. Sem política de escrita (só a service_role, via RPC).
drop policy if exists cs_pesquisa_respostas_sel on public.cs_pesquisa_respostas;
create policy cs_pesquisa_respostas_sel on public.cs_pesquisa_respostas for select to authenticated using (app.tem_area('cs'));

revoke all on public.cs_pesquisa_respostas from anon;
revoke insert, update, delete, truncate on public.cs_pesquisa_respostas from authenticated;
grant select on public.cs_pesquisa_respostas to authenticated;

-- Troca as respostas por pesquisa. Nunca troca uma pesquisa por uma lista muito menor (aba renomeada,
-- linhas apagadas por engano): essa pesquisa fica como estava e volta no retorno em "mantidas".
create or replace function public.cs_pesquisa_substituir(p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c text; atual integer; novo integer; n integer := 0; mantidas text[] := '{}';
begin
  if jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'formato inválido: cache mantido';
  end if;
  for c in select distinct r->>'chave' from jsonb_array_elements(p_linhas) r loop
    select count(*) into atual from public.cs_pesquisa_respostas where chave = c;
    select count(*) into novo from jsonb_array_elements(p_linhas) r where r->>'chave' = c;
    if atual >= 20 and novo < atual / 2 then
      mantidas := mantidas || c;
      continue;
    end if;
    delete from public.cs_pesquisa_respostas where chave = c;
    insert into public.cs_pesquisa_respostas (chave, linha, grupo, respondido_em, nome, email, telefone, na_lista, dados, sincronizado_em)
    select r->>'chave', (r->>'linha')::int, r->>'grupo', (r->>'respondido_em')::timestamptz, r->>'nome', r->>'email',
      r->>'telefone', coalesce((r->>'na_lista')::boolean, false), coalesce(r->'dados', '[]'::jsonb), now()
    from jsonb_array_elements(p_linhas) r where r->>'chave' = c;
    n := n + novo;
  end loop;
  return jsonb_build_object('linhas', n, 'mantidas', to_jsonb(mantidas));
end $$;

revoke all on function public.cs_pesquisa_substituir(jsonb) from public, anon, authenticated;
grant execute on function public.cs_pesquisa_substituir(jsonb) to service_role;

-- Status do sync (Administração > Sincronizações e aviso da aba). Quem tem a aba CS lê esta chave.
insert into public.sync_status (chave, nome, tipo, cadencia_horas, ordem)
values ('pesquisas-respostas', 'Pesquisas de Alunos — respostas', 'server', 1, 24)
on conflict (chave) do nothing;

drop policy if exists sync_status_sel on public.sync_status;
create policy sync_status_sel on public.sync_status for select to authenticated
  using (app.is_admin() or (app.tem_area('cs') and chave = any (array['metas-planilha','mentorados-planilha',
    'teste-vac-planilha','nivelamento-planilha','pesquisas-respostas'])));

-- Cron a cada 30 min (minutos 15 e 45, para não coincidir com os outros crons de planilha).
select cron.unschedule('os-pesquisas-respostas-30min')
where exists (select 1 from cron.job where jobname = 'os-pesquisas-respostas-30min');
select cron.schedule('os-pesquisas-respostas-30min', '15,45 * * * *', $cron$
  select net.http_post(
    url := 'https://hmvlkltyvyhlxfyaovpe.supabase.co/functions/v1/pesquisas-respostas',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-token', 'os-sync-tok-9Fx3Qm7Lp2Vw'),
    body := '{"origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);

-- Painel da tela inicial (#/cs/pesquisas): contagens por pesquisa e das perguntas de múltipla escolha, sem
-- baixar as respostas. security invoker: o RLS da tabela vale (quem não tem a aba CS recebe []).
-- Regra de múltipla escolha igual a ehCategoricaPesq (app.js) e ehCategorica (Edge Function).
create or replace function public.cs_pesquisa_painel()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with x as (
    select r.chave, d->>'p' as p, d->>'r' as v
    from public.cs_pesquisa_respostas r, jsonb_array_elements(r.dados) d
  ),
  q as (select chave, p, count(*) as n, count(distinct v) as dist, avg(length(v)) as m from x group by 1, 2),
  cat as (select chave, p, n from q where dist <= 15 and m <= 80 and (dist <= 6 or dist <= n / 3)),
  vals as (select x.chave, x.p, x.v, count(*) as c from x join cat using (chave, p) group by 1, 2, 3),
  perg as (
    select vals.chave, vals.p, max(cat.n) as n, jsonb_agg(jsonb_build_array(vals.v, vals.c) order by vals.c desc) as itens
    from vals join cat using (chave, p) group by vals.chave, vals.p
  ),
  tot as (
    select chave, grupo, count(*) as n, max(respondido_em) as ultima, count(*) filter (where na_lista) as na_lista,
      max(sincronizado_em) as sincronizado_em
    from public.cs_pesquisa_respostas group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'chave', t.chave, 'grupo', t.grupo, 'n', t.n, 'ultima', t.ultima, 'na_lista', t.na_lista,
    'sincronizado_em', t.sincronizado_em,
    'perguntas', (select coalesce(jsonb_agg(jsonb_build_object('p', g.p, 'n', g.n, 'itens', g.itens)), '[]'::jsonb)
                  from perg g where g.chave = t.chave)
  )), '[]'::jsonb)
  from tot t;
$$;
revoke all on function public.cs_pesquisa_painel() from public, anon;
grant execute on function public.cs_pesquisa_painel() to authenticated;
