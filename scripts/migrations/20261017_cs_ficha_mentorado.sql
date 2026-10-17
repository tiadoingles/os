-- CS / Suporte · Ficha do Mentorado (#/cs/mentorados?ficha=<email>). Pedido da Tia, 17/10/2026.
-- Chave da ficha = e-mail do mentorado (lower(trim)), único em cs_mentorados. Os dados de outras abas entram
-- por e-mail OU telefone (últimos 10 dígitos) OU por vínculo manual (cs_mentorado_vinculos).
--   cs_mentorado_notas    anotações da equipe (autor e data travados por trigger; DESFAZER restaura o autor
--                          original a partir de os_desfazer_snapshots)
--   cs_mentorado_vinculos outros e-mails/telefones da mesma pessoa (ligação manual pelo CS)
--   cs_mentorado_eventos  linha do tempo de integrações externas (Clint, Zoom, Cademí, Hotmart...): só a
--                          service_role grava; cada integração nova grava aqui com (fonte, chave_externa) único
--   RPC cs_ficha_mentorado(email)   tudo sobre a pessoa num jsonb (security invoker: vale o RLS de cada tabela)
--   RPC cs_mentorados_resumo()      contagens por mentorado para os ícones/filtros da Lista de Mentorados
-- RLS: aba CS (app.tem_area('cs')); ADM vê tudo.

-- Telefone normalizado: últimos 10 dígitos (DDD + número, sem DDI); null se tiver menos de 10.
create or replace function app.tel10(p text)
returns text language sql immutable set search_path = public as $$
  select case when length(d) >= 10 then right(d, 10) end from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$$;
grant execute on function app.tel10(text) to authenticated, service_role;

-- ---------------- Anotações ----------------
create table if not exists public.cs_mentorado_notas (
  id uuid primary key default gen_random_uuid(),
  mentorado_email text not null,
  texto text not null check (length(btrim(texto)) between 1 and 5000),
  autor_id uuid default auth.uid(),
  autor_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cs_mentorado_notas_email_idx on public.cs_mentorado_notas (mentorado_email, created_at desc);

create or replace function app.cs_mentorado_notas_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
declare snap jsonb; uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    -- Autor, data de criação e pessoa nunca mudam; só o texto.
    new.autor_id := old.autor_id; new.autor_nome := old.autor_nome;
    new.created_at := old.created_at; new.mentorado_email := old.mentorado_email;
    new.updated_at := now();
    return new;
  end if;
  new.mentorado_email := lower(btrim(new.mentorado_email));
  if uid is null then return new; end if; -- service_role (integrações/manutenção)
  -- DESFAZER de exclusão: volta com o autor e a data originais guardados pelo banco.
  select s.dados into snap from public.os_desfazer_snapshots s
   where s.tabela = 'cs_mentorado_notas' and s.registro_id = new.id and s.operacao = 'DELETE'
   order by s.id desc limit 1;
  if snap is not null and ((snap->>'autor_id')::uuid = uid or app.is_admin()) then
    new.autor_id := (snap->>'autor_id')::uuid; new.autor_nome := snap->>'autor_nome';
    new.created_at := (snap->>'created_at')::timestamptz; new.mentorado_email := snap->>'mentorado_email';
  else
    new.autor_id := uid;
    new.autor_nome := (select coalesce(nullif(btrim(p.nome), ''), p.email) from public.profiles p where p.id = uid);
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cs_mentorado_notas_guarda on public.cs_mentorado_notas;
create trigger cs_mentorado_notas_guarda before insert or update on public.cs_mentorado_notas
  for each row execute function app.cs_mentorado_notas_guarda();
drop trigger if exists cs_mentorado_notas_desfazer_guardar on public.cs_mentorado_notas;
create trigger cs_mentorado_notas_desfazer_guardar before delete or update on public.cs_mentorado_notas
  for each row execute function app.os_desfazer_guardar();

alter table public.cs_mentorado_notas enable row level security;
drop policy if exists cs_mentorado_notas_sel on public.cs_mentorado_notas;
drop policy if exists cs_mentorado_notas_ins on public.cs_mentorado_notas;
drop policy if exists cs_mentorado_notas_upd on public.cs_mentorado_notas;
drop policy if exists cs_mentorado_notas_del on public.cs_mentorado_notas;
create policy cs_mentorado_notas_sel on public.cs_mentorado_notas for select to authenticated using (app.tem_area('cs'));
create policy cs_mentorado_notas_ins on public.cs_mentorado_notas for insert to authenticated with check (app.tem_area('cs'));
create policy cs_mentorado_notas_upd on public.cs_mentorado_notas for update to authenticated
  using (app.tem_area('cs') and (autor_id = auth.uid() or app.is_admin()))
  with check (app.tem_area('cs') and (autor_id = auth.uid() or app.is_admin()));
create policy cs_mentorado_notas_del on public.cs_mentorado_notas for delete to authenticated
  using (app.tem_area('cs') and (autor_id = auth.uid() or app.is_admin()));
revoke all on public.cs_mentorado_notas from anon;
grant select, insert, update, delete on public.cs_mentorado_notas to authenticated;

-- ---------------- Vínculos (outros e-mails/telefones da pessoa) ----------------
create table if not exists public.cs_mentorado_vinculos (
  id uuid primary key default gen_random_uuid(),
  mentorado_email text not null,
  tipo text not null check (tipo in ('email', 'telefone')),
  valor text not null,
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  created_at timestamptz not null default now(),
  unique (tipo, valor)
);
create index if not exists cs_mentorado_vinculos_email_idx on public.cs_mentorado_vinculos (mentorado_email);

create or replace function app.cs_mentorado_vinculos_guarda()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.mentorado_email := lower(btrim(new.mentorado_email));
  if new.tipo = 'email' then
    new.valor := lower(btrim(new.valor));
    if new.valor !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'e-mail inválido'; end if;
    if new.valor = new.mentorado_email then raise exception 'este já é o e-mail principal da ficha'; end if;
  else
    new.valor := app.tel10(new.valor);
    if new.valor is null then raise exception 'telefone inválido: informe DDD e número'; end if;
  end if;
  if auth.uid() is not null then
    new.criado_por := auth.uid();
    new.criado_por_nome := (select coalesce(nullif(btrim(p.nome), ''), p.email) from public.profiles p where p.id = auth.uid());
    new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists cs_mentorado_vinculos_guarda on public.cs_mentorado_vinculos;
create trigger cs_mentorado_vinculos_guarda before insert or update on public.cs_mentorado_vinculos
  for each row execute function app.cs_mentorado_vinculos_guarda();

alter table public.cs_mentorado_vinculos enable row level security;
drop policy if exists cs_mentorado_vinculos_sel on public.cs_mentorado_vinculos;
drop policy if exists cs_mentorado_vinculos_ins on public.cs_mentorado_vinculos;
drop policy if exists cs_mentorado_vinculos_del on public.cs_mentorado_vinculos;
create policy cs_mentorado_vinculos_sel on public.cs_mentorado_vinculos for select to authenticated using (app.tem_area('cs'));
create policy cs_mentorado_vinculos_ins on public.cs_mentorado_vinculos for insert to authenticated with check (app.tem_area('cs'));
create policy cs_mentorado_vinculos_del on public.cs_mentorado_vinculos for delete to authenticated using (app.tem_area('cs'));
revoke all on public.cs_mentorado_vinculos from anon;
grant select, insert, delete on public.cs_mentorado_vinculos to authenticated;

-- ---------------- Eventos de integrações externas (etapa 2) ----------------
create table if not exists public.cs_mentorado_eventos (
  id uuid primary key default gen_random_uuid(),
  mentorado_email text,                   -- quando a integração já sabe de quem é
  email text,                             -- e-mail como veio da fonte
  telefone text,                          -- telefone como veio da fonte
  fonte text not null,                    -- 'clint' | 'zoom' | 'cademi' | 'hotmart' | ...
  tipo text not null,                     -- ex.: 'conversa', 'negocio', 'presenca', 'aula', 'compra'
  ocorrido_em timestamptz,
  titulo text not null,
  dados jsonb not null default '{}'::jsonb,
  chave_externa text not null,
  sincronizado_em timestamptz not null default now(),
  unique (fonte, chave_externa)
);
create index if not exists cs_mentorado_eventos_email_idx on public.cs_mentorado_eventos (lower(email));
create index if not exists cs_mentorado_eventos_tel_idx on public.cs_mentorado_eventos (app.tel10(telefone));
alter table public.cs_mentorado_eventos enable row level security;
drop policy if exists cs_mentorado_eventos_sel on public.cs_mentorado_eventos;
create policy cs_mentorado_eventos_sel on public.cs_mentorado_eventos for select to authenticated using (app.tem_area('cs'));
revoke all on public.cs_mentorado_eventos from anon;
revoke insert, update, delete, truncate on public.cs_mentorado_eventos from authenticated;
grant select on public.cs_mentorado_eventos to authenticated;

-- ---------------- Ficha completa ----------------
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
      where x.mentorado_email = e or lower(btrim(x.email)) = any(emails) or app.tel10(x.telefone) = any(tels)), '[]'::jsonb)
  );
end $$;
revoke all on function public.cs_ficha_mentorado(text) from public, anon;
grant execute on function public.cs_ficha_mentorado(text) to authenticated;

-- ---------------- Resumo para a lista ----------------
-- Junções em conjunto (e-mail e telefone separados, com união), nunca uma busca por mentorado: ~300 x tabelas.
create or replace function public.cs_mentorados_resumo()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with m as (
    select distinct on (lower(btrim(x.email))) lower(btrim(x.email)) as e, x.telefone
    from public.cs_mentorados x where coalesce(btrim(x.email), '') <> '' order by lower(btrim(x.email)), x.linha
  ),
  ke as (
    select m.e, m.e as v from m
    union select v.mentorado_email, v.valor from public.cs_mentorado_vinculos v join m on m.e = v.mentorado_email where v.tipo = 'email'
  ),
  kt as (
    select m.e, app.tel10(p) as v from m, regexp_split_to_table(coalesce(m.telefone, ''), '\s*(/|;|,| ou )\s*') p where app.tel10(p) is not null
    union select v.mentorado_email, v.valor from public.cs_mentorado_vinculos v join m on m.e = v.mentorado_email where v.tipo = 'telefone'
  ),
  dg as (
    select ke.e, d.id from public.cs_diagnosticos d join ke on ke.v = lower(btrim(d.email))
    union select kt.e, d.id from public.cs_diagnosticos d join kt on kt.v = app.tel10(d.dados->>'telefone')
  ),
  mt as (
    select z.e, x.id, x.concluida_em, x.removida_da_ficha, x.vencimento from (
      select ke.e, x.id from public.cs_metas x join ke on ke.v = lower(btrim(x.mentorado_email))
      union select dg.e, x.id from public.cs_metas x join dg on dg.id = x.diagnostico_id
    ) z join public.cs_metas x on x.id = z.id
  ),
  vac as (
    select ke.e, x.linha from public.cs_teste_vac x join ke on ke.v = lower(btrim(x.email))
    union select kt.e, x.linha from public.cs_teste_vac x join kt on kt.v = app.tel10(x.telefone_digitos)
  ),
  niv as (
    select ke.e, x.linha from public.cs_nivelamento x join ke on ke.v = lower(btrim(x.email))
    union select kt.e, x.linha from public.cs_nivelamento x join kt on kt.v = app.tel10(x.whatsapp_digitos)
  ),
  pq as (
    select ke.e, x.chave, x.linha from public.cs_pesquisa_respostas x join ke on ke.v = lower(btrim(x.email))
    union select kt.e, x.chave, x.linha from public.cs_pesquisa_respostas x join kt on kt.v = app.tel10(x.telefone)
  ),
  nt as (select n.mentorado_email as e, count(*) as n, max(n.created_at) as ultima from public.cs_mentorado_notas n group by 1),
  c_dg as (select e, count(*) n from dg group by e),
  c_mt as (select e, count(*) filter (where concluida_em is null and not removida_da_ficha) abertas,
             count(*) filter (where concluida_em is null and not removida_da_ficha and vencimento < current_date) atrasadas
           from mt group by e),
  c_vac as (select e, count(*) n from vac group by e),
  c_niv as (select e, count(*) n from niv group by e),
  c_pq as (select e, count(*) n from pq group by e)
  select coalesce(jsonb_agg(jsonb_build_object(
    'email', m.e, 'diag', coalesce(c_dg.n, 0),
    'metas_abertas', coalesce(c_mt.abertas, 0), 'metas_atrasadas', coalesce(c_mt.atrasadas, 0),
    'vac', coalesce(c_vac.n, 0), 'nivel', coalesce(c_niv.n, 0), 'pesq', coalesce(c_pq.n, 0),
    'notas', coalesce(nt.n, 0), 'ultima_nota', nt.ultima
  )), '[]'::jsonb)
  from m left join nt on nt.e = m.e left join c_dg on c_dg.e = m.e left join c_mt on c_mt.e = m.e
    left join c_vac on c_vac.e = m.e left join c_niv on c_niv.e = m.e left join c_pq on c_pq.e = m.e;
$$;
revoke all on function public.cs_mentorados_resumo() from public, anon;
grant execute on function public.cs_mentorados_resumo() to authenticated;

-- Higiene de grants (revisão do QA): o RLS já bloqueia, mas authenticated não precisa destes privilégios.
-- Obs.: desfazer a remoção de um vínculo regrava criado_por com quem desfez (vínculo não tem snapshot; aceitável).
revoke truncate, references, trigger on public.cs_mentorado_notas, public.cs_mentorado_vinculos from authenticated;
revoke update on public.cs_mentorado_vinculos from authenticated;
