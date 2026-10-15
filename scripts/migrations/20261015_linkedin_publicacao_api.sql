-- LinkedIn da Tia, Fase 3: publicação automática pela API oficial do LinkedIn.
-- Aplicada no Supabase como migrations "linkedin_publicacao_api" + "linkedin_publicacao_api_janela_24h"
-- (a segunda só recria linkedin_svc_reservar com a janela de 24 h; este arquivo já tem a versão final).
--
-- O que entra:
--   1. Tabelas PRIVADAS no schema app (fora da API REST: o PostgREST só expõe public, e mesmo assim
--      sem grant para anon/authenticated e com RLS ligado sem política): conexão OAuth (token),
--      states do OAuth pendentes e o token do cron.
--   2. RPCs linkedin_svc_* (security definer, execute só para service_role) usadas pela Edge
--      Function "linkedin". O front nunca recebe o access_token.
--   3. RPC linkedin_conexao_status() para editor/admin: só {conectado, nome, expires_at}.
--   4. linkedin_posts: status 'publicando' (trava contra execução dupla) + coluna
--      publicacao_iniciada_em + trigger que impede o front de mexer em post publicado/publicando,
--      no linkedin_urn/publicado_em e de aprovar post sem data.
--   5. O cron "linkedin-publicar" (*/5) é criado em SQL à parte (ver final), lendo o token do
--      cron de app.linkedin_config — o valor do token NUNCA vai para este repo (é público).

-- ---------------------------------------------------------------- 1. tabelas privadas
create table app.linkedin_conexao (
  id int primary key default 1 check (id = 1),
  access_token text not null,
  expires_at timestamptz not null,
  refresh_token text null,
  refresh_expires_at timestamptz null,
  escopo text null,
  person_urn text not null check (person_urn like 'urn:li:person:%'),
  nome text null,
  conectado_por uuid null references auth.users(id) on delete set null,
  conectado_em timestamptz not null default now()
);
comment on table app.linkedin_conexao is
  'Conexão OAuth do LinkedIn pessoal da Tia (1 linha). PRIVADA: só service_role via RPC linkedin_svc_*; nunca expor ao front.';

create table app.linkedin_oauth_state (
  state text primary key,
  criado_por uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
comment on table app.linkedin_oauth_state is
  'States do OAuth do LinkedIn pendentes (uso único, expiram em 10 min).';

create table app.linkedin_config (
  id int primary key default 1 check (id = 1),
  cron_token text not null
);
comment on table app.linkedin_config is
  'Token que o cron linkedin-publicar manda no header x-cron-token. Gerado no banco, nunca versionado.';
insert into app.linkedin_config (id, cron_token)
values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

alter table app.linkedin_conexao enable row level security;
alter table app.linkedin_oauth_state enable row level security;
alter table app.linkedin_config enable row level security;
revoke all on app.linkedin_conexao, app.linkedin_oauth_state, app.linkedin_config from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. linkedin_posts
alter table public.linkedin_posts drop constraint linkedin_posts_status_check;
alter table public.linkedin_posts add constraint linkedin_posts_status_check
  check (status in ('rascunho', 'aprovado', 'publicando', 'publicado', 'erro', 'descartado'));
alter table public.linkedin_posts add column publicacao_iniciada_em timestamptz null;

-- Guarda do front (authenticated/anon). A Edge Function usa service_role e passa direto.
-- Evita, entre outras coisas, que um DESFAZER antigo devolva um post já publicado para
-- "aprovado" (o que o publicaria de novo no LinkedIn).
create or replace function app.linkedin_posts_guarda()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'publicando' then
      raise exception 'Status "publicando" é exclusivo da publicação automática.';
    end if;
    if new.status = 'aprovado' and new.agendado_para is null then
      raise exception 'Para aprovar, defina a data e a hora de publicação.';
    end if;
    return new;
  end if;
  -- UPDATE
  if old.status in ('publicando', 'publicado') and new.status is distinct from old.status then
    raise exception 'Este post já foi (ou está sendo) publicado no LinkedIn e não pode mudar de status por aqui.';
  end if;
  if new.status in ('publicando', 'publicado') and new.status is distinct from old.status then
    raise exception 'Só a publicação automática marca um post como publicando/publicado.';
  end if;
  if new.linkedin_urn is distinct from old.linkedin_urn
     or new.publicado_em is distinct from old.publicado_em
     or new.publicacao_iniciada_em is distinct from old.publicacao_iniciada_em then
    raise exception 'Os campos da publicação no LinkedIn são preenchidos só pela publicação automática.';
  end if;
  if new.status = 'aprovado' and new.agendado_para is null then
    raise exception 'Para aprovar, defina a data e a hora de publicação.';
  end if;
  return new;
end $$;
revoke all on function app.linkedin_posts_guarda() from public, anon, authenticated;

create trigger linkedin_posts_guarda before insert or update on public.linkedin_posts
  for each row execute function app.linkedin_posts_guarda();

-- ---------------------------------------------------------------- 3. RPCs da Edge Function (service_role)
create or replace function public.linkedin_svc_cron_token_ok(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(length(p_token) >= 32 and p_token = (select cron_token from app.linkedin_config where id = 1), false);
$$;

create or replace function public.linkedin_svc_salvar_state(p_state text, p_user uuid)
returns void language sql security definer set search_path = public as $$
  delete from app.linkedin_oauth_state where criado_em < now() - interval '1 day';
  insert into app.linkedin_oauth_state (state, criado_por) values (p_state, p_user);
$$;

-- Uso único: apaga e devolve quem criou, se ainda estiver nos 10 minutos.
create or replace function public.linkedin_svc_consumir_state(p_state text)
returns uuid language sql security definer set search_path = public as $$
  with d as (delete from app.linkedin_oauth_state where state = p_state returning criado_por, criado_em)
  select criado_por from d where criado_em > now() - interval '10 minutes';
$$;

create or replace function public.linkedin_svc_salvar_conexao(
  p_access_token text, p_expires_at timestamptz, p_refresh_token text, p_refresh_expires_at timestamptz,
  p_escopo text, p_person_urn text, p_nome text, p_user uuid)
returns void language sql security definer set search_path = public as $$
  insert into app.linkedin_conexao as c (id, access_token, expires_at, refresh_token, refresh_expires_at, escopo, person_urn, nome, conectado_por, conectado_em)
  values (1, p_access_token, p_expires_at, p_refresh_token, p_refresh_expires_at, p_escopo, p_person_urn, p_nome, p_user, now())
  on conflict (id) do update set access_token = excluded.access_token, expires_at = excluded.expires_at,
    refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at, escopo = excluded.escopo,
    person_urn = excluded.person_urn, nome = excluded.nome,
    conectado_por = coalesce(excluded.conectado_por, c.conectado_por),
    conectado_em = case when excluded.conectado_por is null then c.conectado_em else now() end;
$$;

create or replace function public.linkedin_svc_conexao()
returns table (access_token text, expires_at timestamptz, refresh_token text, refresh_expires_at timestamptz,
               person_urn text, nome text, conectado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select access_token, expires_at, refresh_token, refresh_expires_at, person_urn, nome, conectado_em
  from app.linkedin_conexao where id = 1;
$$;

create or replace function public.linkedin_svc_desconectar()
returns void language sql security definer set search_path = public as $$
  delete from app.linkedin_conexao where id = 1;
  delete from app.linkedin_oauth_state;
$$;

-- Trava contra execução dupla: (1) post preso em "publicando" há mais de 15 min vira "erro"
-- (NÃO é republicado: pode ter saído no LinkedIn); (2) reserva atômica de até p_limite posts
-- aprovados e vencidos há no máximo 24 h (for update skip locked), marcando "publicando".
-- Aprovado com horário vencido há mais de 24 h fica parado (a aba avisa para ajustar a data).
create or replace function public.linkedin_svc_reservar(p_limite int)
returns setof public.linkedin_posts language plpgsql security definer set search_path = public as $$
begin
  update public.linkedin_posts
     set status = 'erro',
         erro = 'A publicação começou em ' || to_char(publicacao_iniciada_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') ||
                ' e não terminou. O post PODE ter saído no LinkedIn: confira no seu perfil antes de clicar em Tentar de novo.'
   where status = 'publicando' and coalesce(publicacao_iniciada_em, updated_at) < now() - interval '15 minutes';

  return query
  update public.linkedin_posts p
     set status = 'publicando', publicacao_iniciada_em = now(), erro = null
   where p.id in (
     select id from public.linkedin_posts
      where status = 'aprovado' and agendado_para is not null and agendado_para <= now()
        and agendado_para > now() - interval '24 hours' -- atrasado há +24h não sai sozinho (evita rajada de posts velhos)
      order by agendado_para
      limit greatest(1, least(coalesce(p_limite, 3), 10))
      for update skip locked)
     and p.status = 'aprovado'
  returning p.*;
end $$;

-- Devolve para "aprovado" um post reservado que NÃO chegou ao LinkedIn (token inválido, 429).
create or replace function public.linkedin_svc_devolver(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.linkedin_posts set status = 'aprovado', publicacao_iniciada_em = null
   where id = p_id and status = 'publicando';
$$;

create or replace function public.linkedin_svc_concluir(
  p_id uuid, p_ok boolean, p_urn text, p_erro text, p_observacao text)
returns void language sql security definer set search_path = public as $$
  update public.linkedin_posts
     set status = case when p_ok then 'publicado' else 'erro' end,
         linkedin_urn = case when p_ok then p_urn else linkedin_urn end,
         publicado_em = case when p_ok then now() else publicado_em end,
         erro = p_erro,
         observacao = case when p_observacao is null then observacao
                           else concat_ws(' ', nullif(observacao, ''), p_observacao) end
   where id = p_id and status = 'publicando';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.linkedin_svc_cron_token_ok(text)',
    'public.linkedin_svc_salvar_state(text, uuid)',
    'public.linkedin_svc_consumir_state(text)',
    'public.linkedin_svc_salvar_conexao(text, timestamptz, text, timestamptz, text, text, text, uuid)',
    'public.linkedin_svc_conexao()',
    'public.linkedin_svc_desconectar()',
    'public.linkedin_svc_reservar(int)',
    'public.linkedin_svc_devolver(uuid)',
    'public.linkedin_svc_concluir(uuid, boolean, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. status para o front (editor/admin)
create or replace function public.linkedin_conexao_status()
returns table (conectado boolean, nome text, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.is_editor() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select true, c.nome, c.expires_at from app.linkedin_conexao c where c.id = 1
    union all
    select false, null::text, null::timestamptz where not exists (select 1 from app.linkedin_conexao where id = 1);
end $$;
revoke all on function public.linkedin_conexao_status() from public, anon;
grant execute on function public.linkedin_conexao_status() to authenticated;

-- ---------------------------------------------------------------- 5. cron (rodar à parte, mesmo padrão do os-sync-30min)
-- select cron.schedule('linkedin-publicar', '*/5 * * * *', $cron$
--   select net.http_post(
--     url := 'https://hmvlkltyvyhlxfyaovpe.supabase.co/functions/v1/linkedin',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cron-token', (select cron_token from app.linkedin_config where id = 1)
--     ),
--     body := '{"op":"publicar_pendentes"}'::jsonb,
--     timeout_milliseconds := 60000
--   );
-- $cron$);
