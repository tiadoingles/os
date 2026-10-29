-- Administração → Usuários: último acesso e histórico do que cada pessoa fez no OS (pedido da Tia, 29/10/2026).
-- * profiles.ultimo_acesso_em: gravado pelo app (rpc os_registrar_acesso, no máx. 1x a cada 5 min por aba).
--   Preenchido de início com auth.users.last_sign_in_at.
-- * os_atividade: um registro por criação/edição/exclusão feita por uma PESSOA (auth.uid() presente) em qualquer
--   tabela do OS, mais "entrou no sistema" (rpc com p_login). Sincronizações e Edge Functions (service_role) não
--   entram. Guarda só um resumo (nome/título do item e os campos alterados), não a linha inteira.
-- * Leitura só para ADM. Ninguém escreve direto: só os gatilhos/funções (security definer).
-- * Retenção: 365 dias (limpeza no próprio registrar_acesso, barata por índice).

alter table public.profiles add column if not exists ultimo_acesso_em timestamptz;
update public.profiles p set ultimo_acesso_em = u.last_sign_in_at
  from auth.users u where u.id = p.id and p.ultimo_acesso_em is null;

create table if not exists public.os_atividade (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  quando timestamptz not null default now(),
  acao text not null check (acao in ('criou', 'editou', 'excluiu', 'entrou')),
  tabela text,
  registro_id text,
  item text,
  campos text[]
);
create index if not exists os_atividade_user_quando on public.os_atividade (user_id, quando desc);
create index if not exists os_atividade_quando on public.os_atividade (quando);
alter table public.os_atividade enable row level security;
drop policy if exists os_atividade_sel_admin on public.os_atividade;
create policy os_atividade_sel_admin on public.os_atividade for select to authenticated using (app.is_admin());
revoke insert, update, delete on public.os_atividade from anon, authenticated;

create or replace function app.os_atividade_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  linha jsonb;
  antiga jsonb;
  mudou text[];
begin
  if uid is null then return coalesce(new, old); end if;
  linha := to_jsonb(coalesce(new, old));
  if tg_op = 'UPDATE' then
    antiga := to_jsonb(old);
    select array_agg(k order by k) into mudou from jsonb_object_keys(linha) k
      where k not in ('updated_at', 'created_at', 'ultimo_acesso_em') and linha -> k is distinct from antiga -> k;
    if mudou is null then return new; end if;
  end if;
  insert into os_atividade (user_id, acao, tabela, registro_id, item, campos)
  values (uid,
    case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'editou' else 'excluiu' end,
    tg_table_name,
    coalesce(linha ->> 'id', linha ->> 'chave'),
    left(coalesce(linha ->> 'nome', linha ->> 'titulo', linha ->> 'title', linha ->> 'cliente_nome', linha ->> 'historico',
                  linha ->> 'apelido', linha ->> 'email', linha ->> 'pergunta', linha ->> 'descricao', linha ->> 'tema'), 160),
    mudou);
  return coalesce(new, old);
exception when others then
  -- O histórico nunca pode impedir a alteração em si.
  return coalesce(new, old);
end $$;

-- Gatilho em todas as tabelas do OS, menos logs/caches/o próprio histórico.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('os_atividade', 'ai_usage_log', 'ai_respostas_cache', 'chat_widget_logs', 'kb_activity_log',
                                   'os_desfazer_snapshots', 'automacao_estado', 'sync_status')
  loop
    execute format('drop trigger if exists zz_os_atividade on public.%I', t);
    execute format('create trigger zz_os_atividade after insert or update or delete on public.%I for each row execute function app.os_atividade_registrar()', t);
  end loop;
end $$;

create or replace function public.os_registrar_acesso(p_login boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  update profiles set ultimo_acesso_em = now() where id = uid;
  if p_login then
    insert into os_atividade (user_id, acao) values (uid, 'entrou');
    delete from os_atividade where quando < now() - interval '365 days';
  end if;
end $$;
revoke execute on function public.os_registrar_acesso(boolean) from public, anon;
grant execute on function public.os_registrar_acesso(boolean) to authenticated;
