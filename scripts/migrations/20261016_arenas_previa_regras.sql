-- Gerador de Materiais das Arenas: geração sob demanda no OS (prévia, ajustes e regras aprendidas).
-- Aplicada em 16/10/2026 (nome no Supabase: arenas_previa_regras).
-- Fluxo: rascunho -> gerando_previa -> previa -> gerando_pdf -> pronto (ou erro).
-- 'pendente'/'processando' ficam só por compatibilidade com pedidos antigos da fila (desativada).

-- 1) materiais_pedidos: status novos + conteúdo e histórico de ajustes
alter table public.materiais_pedidos drop constraint if exists materiais_pedidos_status_check;
alter table public.materiais_pedidos add constraint materiais_pedidos_status_check
  check (status in ('rascunho', 'gerando_previa', 'previa', 'gerando_pdf', 'pronto', 'erro', 'pendente', 'processando'));
alter table public.materiais_pedidos alter column status set default 'rascunho';
-- conteudo: um item por material {nivel, n, tema, reading[], glossary[[en,mypa,pt]], questions[], variacao{...}}
alter table public.materiais_pedidos add column if not exists conteudo jsonb not null default '[]'::jsonb;
-- ajustes: histórico [{em, por, escopo, indice, instrucao, antes}]
alter table public.materiais_pedidos add column if not exists ajustes jsonb not null default '[]'::jsonb;
-- (categoria segue sem CHECK; briefing jsonb ganha os campos novos do formulário)

-- 2) arena_regras: regras base (16/10/2026) + regras aprendidas com os ajustes da Tia
create table if not exists public.arena_regras (
  id uuid primary key default gen_random_uuid(),
  texto text not null check (char_length(btrim(texto)) between 3 and 1000),
  origem text not null default 'aprendida' check (origem in ('base', 'aprendida')),
  ativa boolean not null default true,
  pendente_skill boolean not null default false,
  ordem integer not null default 100,
  pedido_id uuid references public.materiais_pedidos(id) on delete set null,
  criado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.arena_regras enable row level security;

drop trigger if exists trg_arena_regras_updated_at on public.arena_regras;
create trigger trg_arena_regras_updated_at before update on public.arena_regras
  for each row execute function app.set_updated_at();

-- Leitura: padrão do OS (logado, menos o papel cs). Escrita: editor/admin (inclui ADM limitado),
-- e só nas regras aprendidas. As regras base mudam só por migration.
drop policy if exists arena_regras_sel on public.arena_regras;
create policy arena_regras_sel on public.arena_regras for select to authenticated using (not app.is_cs());
drop policy if exists arena_regras_ins on public.arena_regras;
create policy arena_regras_ins on public.arena_regras for insert to authenticated
  with check (app.is_editor() and origem = 'aprendida');
drop policy if exists arena_regras_upd on public.arena_regras;
create policy arena_regras_upd on public.arena_regras for update to authenticated
  using (app.is_editor() and origem = 'aprendida') with check (app.is_editor() and origem = 'aprendida');
drop policy if exists arena_regras_del on public.arena_regras;
create policy arena_regras_del on public.arena_regras for delete to authenticated
  using (app.is_editor() and origem = 'aprendida');
revoke all on public.arena_regras from anon;

create index if not exists arena_regras_ativa_idx on public.arena_regras (ativa, origem, ordem);
create index if not exists materiais_pedidos_status_idx on public.materiais_pedidos (status, processado_em desc);

-- 3) Semente: regras de conteúdo aprovadas pela Tia em 16/10/2026 (origem base)
insert into public.arena_regras (texto, origem, ordem, pendente_skill, criado_por)
select t, 'base', o, false, null from (values
  (1,  'Recém Chegados (RC): Reading Practice com cerca de 5 parágrafos curtos (3 a 4 linhas cada), em inglês simples e natural, cabendo inteiro em uma página. Simple Past ou Simple Present de preferência.'),
  (2,  'RC: varie o narrador e o sujeito da história (I, we, he, she, they; personagens homens e mulheres). Não escreva sempre sobre uma mulher em terceira pessoa. Dentro do mesmo pedido, os materiais RC usam narradores diferentes.'),
  (3,  'RC: alterne nomes, cenários, aberturas, acontecimentos e finais. Não termine sempre com projeção futura ("Next week..."): o final pode ser uma surpresa, uma solução, uma lição, uma frase engraçada ou um diálogo.'),
  (4,  'RC: use diálogos curtos quando fizerem sentido, vocabulário comum e phrasal verbs sem forçar quantidade. A história não precisa ser sobre uma mulher brasileira 40+, mas a linguagem é sempre adulta e respeitosa.'),
  (5,  'RC: pelo menos 2/3 dos itens do Glossary aparecem de fato no Reading Practice; o restante são itens úteis para o tema. O Glossary tem que ajudar a entender a leitura.'),
  (6,  'RC: as 12 perguntas são simples e concretas, para iniciantes, ligadas à leitura E à vida das alunas (podem partir da história e trazer para a experiência delas).'),
  (7,  'BIA (Básico, Intermediário e Avançado): 3 páginas (Capa, Glossary, Questions). Perguntas abertas, variadas e específicas do tema, que geram histórias, opiniões e conversas reais: situações concretas, dilemas leves, experiências, humor e opinião.'),
  (8,  'BIA: no máximo 2 perguntas do tipo preferência ("What is your favorite..."), rotina ("How do you usually...") ou planos futuros por material. Não repita a mesma lógica de perguntas de um tema para outro.'),
  (9,  'BIA: progressão de dificuldade nas perguntas 1-4 (fáceis), 5-8 (um pouco mais pessoais/descritivas) e 9-12 (mais reflexivas, ainda acessíveis). Perguntas de até ~15 palavras (até ~20 nas 9-12).'),
  (10, 'Glossary: entre 15 e 25 itens (priorize 25), 3 colunas English | MYPA | Tradução, ordenados por relevância para o tema (não alfabética).'),
  (11, 'MYPA: pronúncia aproximada com sons do português, em CAIXA ALTA entre barras /.../, seguindo as regras e o banco de exemplos da skill mypa. A mesma palavra tem sempre o mesmo MYPA.'),
  (12, 'Questions: exatamente 12 perguntas, só em inglês, sem tradução, sem o prefixo "Ask your classmate:", e nenhuma pode ser respondida com sim ou não. Pelo menos 5 perspectivas diferentes (opinião, experiência passada, hipótese, contexto cultural/social, planos).'),
  (13, 'Temas proibidos em qualquer parte do material: religião, sexo/intimidade, identidade de gênero, política, finanças pessoais detalhadas, saúde pessoal sensível e perguntar a idade de alguém. O tema "Are We Too Old for That?" é permitido só pelo lado dos costumes e expectativas da sociedade, nunca perguntando ou expondo a idade da aluna.'),
  (14, 'Marca: zero emojis, nada de diminutivos ou linguagem infantil, tom acolhedor e adulto (amiga mais experiente), aplicação na vida real das alunas (princípio APR).'),
  (15, 'Antes de entregar, compare com o histórico dos últimos materiais e com os outros materiais do mesmo pedido: não repita narrador, nomes de personagens, situação central, tipo de final nem perguntas.')
) v(o, t)
where not exists (select 1 from public.arena_regras where origem = 'base');
