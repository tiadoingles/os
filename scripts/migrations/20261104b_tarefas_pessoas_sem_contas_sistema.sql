-- Gestão de Tarefas: contas de sistema (sync@ e teste@ em @os.tiadoingles.com.br) não aparecem como responsáveis.
create or replace function public.tarefas_pessoas()
returns table (id uuid, nome text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(trim(p.nome), ''), p.email), p.email
    from public.profiles p
   where auth.uid() is not null and p.role in ('admin', 'equipe')
     and p.email not ilike '%@os.tiadoingles.com.br'
   order by 2;
$$;
revoke all on function public.tarefas_pessoas() from public, anon;
grant execute on function public.tarefas_pessoas() to authenticated;
