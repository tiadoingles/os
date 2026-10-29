-- Produtor de carrosséis: listas do avatar para escolher a base do conteúdo antes do tema
-- (dores, desejos, mitos, crenças e objeções). Fonte: pesquisas da Mentoria (cs_pesquisa_respostas,
-- chaves 'mentoria-fluent-mind' — 42 respostas — e 'pnl-mentoria' — 630 respostas sobre crenças), lidas em 29/10/2026.
-- Leitura: aba Conteúdo. Escrita: só ADM (a lista é curada; atualizar = nova leitura das pesquisas).
create table public.conteudo_avatar (
  id uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('dor', 'desejo', 'mito', 'crenca', 'objecao')),
  ordem int not null,
  texto text not null,
  detalhe text,
  origem text not null default 'Pesquisas da Mentoria',
  ativo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (categoria, ordem)
);
comment on table public.conteudo_avatar is
  'Dores, desejos, mitos, crenças e objeções do avatar (pesquisas da Mentoria) para o Produtor de carrosséis.';
create trigger conteudo_avatar_updated_at before update on public.conteudo_avatar
  for each row execute function app.set_updated_at();
create trigger zz_os_atividade after insert or update or delete on public.conteudo_avatar
  for each row execute function app.os_atividade_registrar();
alter table public.conteudo_avatar enable row level security;
revoke all on public.conteudo_avatar from anon;
grant select, insert, update, delete on public.conteudo_avatar to authenticated;
create policy conteudo_avatar_sel on public.conteudo_avatar for select to authenticated using (app.tem_area('conteudo'));
create policy conteudo_avatar_adm on public.conteudo_avatar for all to authenticated using (app.is_admin()) with check (app.is_admin());

insert into public.conteudo_avatar (categoria, ordem, texto, detalhe, origem) values
-- DORES (mentoria-fluent-mind: autoavaliação, maior dificuldade, o que impede, fracasso)
('dor', 1, 'Entende inglês, mas não consegue falar', '"Consigo entender conversas simples, mas não consigo falar nada em inglês" (a resposta mais comum na autoavaliação)', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 2, 'Esquece o que estudou', '"Eu esqueço o que aprendi com muita facilidade" / "Não consigo reter nada que aprendo"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 3, 'Não entende nativos falando', '"Entender nativos falando inglês" e "entender qualquer conversa" lideram a maior dificuldade', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 4, 'Medo e vergonha de errar na frente dos outros', '"Medo, insegurança e vergonha" / "Vergonha dos erros"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 5, 'Trava na hora de falar', '"Ser natural, falar sem ter muito delay, sem suar frio" / "tenho bloqueio para falar"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 6, 'Traduz tudo na cabeça antes de falar', '"me comunicar em inglês sem ficar montando mentalmente as frases"', 'Pesquisa Módulo PNL Mentoria'),
('dor', 7, 'Anos de estudo sem sair do lugar', '"Por mais que eu estudava inglês nunca adquiria a fluência" / "Após muitos anos de frustração"', 'Pesquisa Módulo PNL Mentoria'),
('dor', 8, 'Falta de tempo e de constância', '"acabo priorizando a família e me enrolo no estudo" / "Sou muito ansiosa e sobrecarregada"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 9, 'Passar vergonha no trabalho em reuniões em inglês', '"ter que entrar em 3 agendas com nativos e mesmo sendo a diretora da área não conseguir conduzir"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('dor', 10, 'Sensação de impotência diante da língua', '"A sensação de impotência que a língua me causa"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
-- DESEJOS (maior sonho, sucesso, fluência, viagem dos sonhos)
('desejo', 1, 'Autorrealização: provar para si mesma que consegue', 'Resposta mais escolhida como maior sonho / "Que eu consigo!!"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 2, 'Viajar para fora com independência', '"Quero viajar com mais independência"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 3, 'Crescer na carreira e conduzir reuniões em inglês', '"em quanto tempo eu consigo fazer uma reunião em inglês?"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 4, 'Conversar com filhos, netos e amigos que moram fora', '"Poder falar com familiares e amigos fora do Brasil"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 5, 'Assistir filmes e séries sem legenda', '"Poder consumir conteúdo em inglês sem legendas"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 6, 'Falar com naturalidade, sem montar a frase na cabeça', '"Não precisar pensar muito para falar" / "estado de flow"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 7, 'Falar sem medo e sem vergonha', '"se comunicar com o mundo sem vergonha e sem medo"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 8, 'Liberdade', '"Fluência é liberdade, é encontrar caminhos para chegar onde queremos"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 9, 'Ter alguém acompanhando, sem estudar sozinha', '"Que eu teria uma mentora para acompanhar meu progresso" / "não sou autodidata"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('desejo', 10, 'Resolver a vida sozinha num país estrangeiro', '"entender e resolver problemas num país estrangeiro"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
-- MITOS (ideias falsas sobre como se aprende inglês)
('mito', 1, 'Adulto não aprende mais inglês', '"Idoso não aprende a língua" / "Que não é possível aprender inglês depois de adulta"', 'Pesquisa Módulo PNL Mentoria'),
('mito', 2, 'Para ser fluente é preciso morar fora', '"Eu posso até aprender muita coisa, mas para ser fluente tenho que morar fora"', 'Pesquisa Módulo PNL Mentoria'),
('mito', 3, 'Para falar inglês é preciso pensar em inglês', '"Para falar em inglês tenho que pensar em inglês"', 'Pesquisa Módulo PNL Mentoria'),
('mito', 4, 'Fluência é falar perfeito, como nativo', '"ver que o que é considerado fluente não é a perfeição de falar como um nativo"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('mito', 5, 'Precisa saber tudo antes de começar a falar', '"não precisava esperar estar pronta para começar a conversar" / "Preciso saber 100% para falar"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('mito', 6, 'Quem traduz na cabeça nunca vai ser fluente', '"Eu traduzo tudo na minha mente e por isso nunca vou aprender a falar"', 'Pesquisa Módulo PNL Mentoria'),
('mito', 7, 'A memória piora com a idade e não tem jeito', '"A minha memória está falhando" / "sou muito lenta para memorizar"', 'Pesquisa Módulo PNL Mentoria'),
('mito', 8, 'Ficar fluente leva muitos anos', '"garantia de aprendizado sem precisar estudar por anos"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('mito', 9, 'Depois de adulto a pronúncia não muda', '"Que minha musculatura está velha para ser remodulada"', 'Pesquisa Módulo PNL Mentoria'),
('mito', 10, 'Só se aprende anotando e decorando', '"Que só conseguiria aprender anotando tudo"', 'Pesquisa Módulo PNL Mentoria'),
-- CRENÇAS (crenças limitantes que as alunas descobriram no módulo de PNL)
('crenca', 1, 'Estou velha demais para aprender inglês', 'A crença mais citada no módulo de PNL', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 2, 'Todo mundo consegue, menos eu', 'Muito citada, quase sempre junto com "nunca vou ser fluente"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 3, 'Lá no fundo, acho que nunca vou ser fluente', '"Lá no fundo eu acho que nunca vou ser fluente em inglês"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 4, 'Eu sempre desisto no meio do caminho', '"A crença de nunca terminar o que inicio foi a principal"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 5, 'Eu não posso errar', '"Eu não posso errar" / "não me permito errar"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 6, 'Tenho medo do que os outros vão pensar', '"Se eu errar as pessoas vão achar que eu..."', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 7, 'Tenho vergonha, por isso não falo', '"Eu tenho vergonha por isso não falo"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 8, 'Não sou capaz / sou burra', '"Que eu não conseguiria por ser burra" / "Que sou uma fraude, não sou capaz"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 9, 'Inglês não é para mim', '"Achar que inglês não é para mim" / "Eu não gosto de inglês"', 'Pesquisa Módulo PNL Mentoria'),
('crenca', 10, 'Sou procrastinadora', 'Procrastinação aparece entre as respostas mais frequentes', 'Pesquisa Módulo PNL Mentoria'),
-- OBJEÇÕES (dúvidas antes de entrar: o que impede, perguntas para a Marcela, o que precisaram ouvir para decidir)
('objecao', 1, 'Na minha idade ainda dá tempo?', '"Com 60 anos, acha mesmo que posso ainda entender e falar o inglês fluente?"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 2, 'Em quanto tempo eu fico fluente?', '"é possível daqui 1 ano eu conseguir a fluência que eu busco?"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 3, 'Já tentei vários cursos e nenhum funcionou', '"já tentou vários métodos e ainda não se sente segura para falar" / "já havia desistido de buscar mais um curso"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 4, 'Não tenho tempo', '"No momento meu tempo com duas crianças pequenas" / "Disciplina e tempo"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 5, 'Minha memória não ajuda, esqueço tudo', '"Pela minha idade acho que pode ser difícil memorizar as palavras"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 6, 'Aula gravada não funciona para mim', '"não apenas aulas gravadas que para mim não funcionaram" / "não sou autodidata"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 7, 'E se eu não conseguir?', '"vc já teve alguma aluna com 50+ que não conseguiu aprender o inglês, seja muito sincera"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 8, 'O investimento', '"Era o financeiro e a procrastinação"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 9, 'Estou começando do zero', '"Acreditei que é possível mesmo saindo do zero e tendo 52 anos"', 'Pesquisa Aluno - Mentoria Fluent Mind'),
('objecao', 10, 'Tenho vergonha de falar com outras pessoas', '"Me ajude a não passar mais vergonha em reuniões e visitas"', 'Pesquisa Aluno - Mentoria Fluent Mind');
