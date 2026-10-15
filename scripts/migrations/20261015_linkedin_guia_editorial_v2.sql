-- Guia editorial do LinkedIn, versão 2 (15/10/2026): estrutura de roteiro para história /
-- case de aluna / depoimento (seção 4.1, com o exemplo aprovado da Ananda) e tamanho por formato
-- (história/case/depoimento 1.500 a 2.500 caracteres; demais 900 a 1.500).
-- Nova linha em kb_document_versions; o trigger trg_kb_version_insert (app.handle_new_version)
-- aponta kb_documents.current_version_id para ela. Fonte: ~/linkedin-tia/01-guia-editorial-linkedin.md.
insert into public.kb_document_versions (document_id, versao, file_name, changelog, conteudo_md)
select d.id, (select coalesce(max(v.versao), 0) + 1 from public.kb_document_versions v where v.document_id = d.id),
  'guia-editorial-linkedin.md',
  'Versão 2 (15/10/2026): estrutura de roteiro para história/case/depoimento e tamanho por formato',
  $g$# Guia Editorial — LinkedIn da Tia do Inglês (Marcela Miranda)

> Versão 2 · 15/10/2026 · base: avatar (127 clientes), Documento de Marca, Metodologia, banco de 64 depoimentos.
> Novidade da versão 2: estrutura de roteiro para história / case de aluna / depoimento (seção 4.1) e tamanho por formato (seção 5).

## 1. Objetivo
Ser reconhecida no LinkedIn como **a especialista em como o adulto aprende — e destrava — o inglês**. Não "mais uma professora de inglês": a mentora que entende *por que* profissionais competentes travam numa reunião em inglês, e que tem método e ciência para resolver isso.

**Frase de posicionamento para o LinkedIn:**
> "Eu não ensino inglês. Eu destravo adultos que já sabem mais inglês do que pensam."

## 2. Para quem escrevemos aqui
O LinkedIn puxa o lado **profissional** do nosso avatar:
- Mulheres (e homens, em menor parte) que trabalham — CLT, servidoras, empreendedoras, gestoras.
- Estudaram inglês a vida toda, têm a teoria, mas **travam na hora de falar**: reunião, call, entrevista, apresentação, viagem a trabalho.
- Sentem vergonha de estar "em cargo alto e com inglês de iniciante". Muitas escondem isso.
- Também lemos para **RH, líderes e gestores** que precisam do time falando inglês (porta para palestras e programas corporativos no futuro).

**Nunca:** mencionar idade (nem positivamente), usar estatística de pesquisa ("X% das alunas…"), infantilizar, usar diminutivo.

## 3. Os 5 pilares (rodízio semanal)

| # | Pilar | O que entrega | Exemplo de tema |
|---|---|---|---|
| 1 | **Dores e travas ao falar** | Identificação: "ela está falando de mim" | O branco no meio da frase; entender tudo e não conseguir responder |
| 2 | **Inglês no trabalho** | Utilidade imediata | Como sobreviver à primeira reunião; frases para ganhar tempo numa call |
| 3 | **Aprendizagem acelerada para adultos** | Autoridade científica | Por que adulto aprende mais rápido que criança; Retrieval Practice; LEGO Approach |
| 4 | **Bloqueios emocionais** | Profundidade, diferencial (PNL + Fator Afetivo) | Medo de julgamento; perfeccionismo; síndrome da impostora no idioma |
| 5 | **Prova e autoridade** | Confiança | Cases de alunas; minha história em Nova York; opinião contrária ao mercado |

## 4. Formatos

1. **História** — começa numa cena ("Era uma call com Londres…") e termina numa lição. Segue a estrutura de roteiro da seção 4.1.
2. **Mito × Verdade** — derruba uma crença ("Morar fora resolve").
3. **Passo a passo prático** — 3 a 5 passos, aplicáveis hoje.
4. **Case de aluna / depoimento** — contado como roteiro (seção 4.1), nunca como "não conseguia → agora consegue". Confirmar autorização antes de citar nome.
5. **Opinião contrária** — posição firme contra o senso comum ("Gramática não te faz fluente").
6. **Mini-aula** — 3 frases prontas em inglês para uma situação de trabalho, com MYPA quando ajudar.

## 4.1 Formato história/case — estrutura de roteiro

Vale para **história** (minha ou de outra pessoa), **case de aluna** e **depoimento**. O post é escrito como uma cena de filme, série ou novela, não como um depoimento resumido. Nunca pode soar como "eu não conseguia → agora consigo".

**Sequência (nesta ordem):**
1. **Cena de abertura** — uma frase forte, de preferência uma fala ou uma imagem concreta ("Eu me escondia no banheiro.").
2. **Contexto / rotina da personagem** — quem ela é, onde trabalha, o que ela faz bem.
3. **Escalada da tensão** — detalhes sensoriais e concretos (o estômago que fecha, a mão gelada no mouse, a risada meio segundo atrasada).
4. **Fundo do poço** — o custo emocional: culpa, vergonha, a "conta" de anos de curso e de dinheiro investido.
5. **Espelho para o leitor** — "Talvez você conheça…": o leitor se reconhece na cena.
6. **Só então a virada** — o encontro com a Tia / o Método, explicado em linguagem humana (sem jargão técnico).
7. **Resolução sem mágica** — recaídas, dias ruins, "não foi mágica".
8. **Momento-símbolo da vitória** — uma cena pequena e concreta que mostra a mudança ("alguém em Londres disse o nome dela. E ela respondeu.").
9. **Fechamento com leveza** — uma frase que alivia, às vezes com humor.
10. **CTA** — uma pergunta aberta para comentário.

**Regras do formato:**
- Mais desenvolvimento do que resolução: a maior parte do texto fica nos passos 2 a 5.
- Detalhes que pareçam verdadeiros e parecidos com a vida de quem lê.
- Frases curtas, muitas quebras de linha.
- **Tamanho: de 1.500 a 2.500 caracteres** (os demais formatos seguem 900 a 1.500).
- Aluna real: todo detalhe dramatizado que ela não disse precisa ser sinalizado na observação do post ("Detalhes dramatizados — confirmar com a aluna: …") e confirmado com ela antes de publicar, junto com a autorização.

**Exemplo aprovado (case da Ananda):**

```
"Eu me escondia no banheiro."

A Ananda me contou isso rindo.
Mas eu sabia que não tinha graça nenhuma.

Ela era a pessoa que resolvia o que ninguém resolvia na empresa. Respeitada, competente, segura.
Em português.

O problema era o time de Londres.

Quase toda manhã, lá estava no calendário: reunião em inglês, câmera ligada.

Quinze minutos antes, começava.
O estômago fechava. A mão gelava no mouse.
Ela abria as anotações com as frases que tinha ensaiado na noite anterior, e elas pareciam escritas em outra língua.

A call começava.
Os ingleses falavam rápido, emendavam as palavras, riam de uma piada que ela não pegou.
Ela ria junto. Meio segundo atrasada.

E por dentro, uma única frase se repetia:
"Por favor, que ninguém fale o meu nome."

Foi assim que nasceu a famosa "internet do Brasil".
A conexão que caía exatamente quando chegava a vez dela.
Câmera congelada. Microfone mudo. "Sorry, my connection is terrible."

Nos dias piores, nem isso.
Ela saía da mesa, trancava a porta do banheiro e esperava a reunião acabar.

Do outro lado do oceano, os colegas deviam achar que no Brasil o wi-fi não funcionava nunca.

Mas o pior não era a call.
Era depois.
Fechar o notebook e fazer a conta: anos de curso, dinheiro investido, livros pela metade.
E a pergunta que doía mais que a vergonha:
"Se eu estudei tanto, por que eu não consigo?"

Talvez você conheça essa conta.
A certeza silenciosa de que o problema é você.

Quando a Ananda chegou até mim, a primeira coisa que eu disse foi:
"Você não tem um problema de inglês. Você tem um corpo que aprendeu que falar inglês é perigoso."

Mais uma lista de vocabulário não ia resolver.
A gente precisava ensinar o cérebro dela que aquilo não era ameaça.
Ambiente seguro para errar. Frases treinadas até saírem sem pensar. Repetição, dia após dia.

Não foi mágica.
Teve dia de travar de novo. Teve call em que a voz tremeu.

Até que, numa manhã qualquer, alguém em Londres disse o nome dela.

E ela respondeu.

Sem banheiro. Sem queda de conexão.

Hoje ela entra nas reuniões, entende e participa.
E, segundo ela, o wi-fi do Brasil milagrosamente voltou a funcionar.

Se você já inventou uma desculpa para fugir de uma call em inglês, não é falta de capacidade. E tem saída.

Qual foi a desculpa que você já usou?

#inglêsnotrabalho #carreira #fluência
```

## 5. Anatomia de um post

```
[GANCHO — 1 a 2 linhas, aparecem antes do "ver mais". Tem que parar o dedo.]

[Desenvolvimento — parágrafos de 1 a 2 linhas, linguagem falada.]

[Virada / lição — a frase que a pessoa vai querer salvar.]

[CTA — 1 pergunta aberta para comentário.]

[0 a 3 hashtags]
```

**Regras:**
- Tamanho por formato: **história, case de aluna e depoimento: 1.500 a 2.500 caracteres** (estrutura de roteiro da seção 4.1); **demais formatos: 900 a 1.500 caracteres**.
- Gancho em no máximo ~200 caracteres (o LinkedIn corta aí).
- Sem link no corpo do post (derruba o alcance). Link, se houver, vai no **primeiro comentário**.
- Máximo 1 emoji por post, só da marca: 🚀🧠🇺🇸🙏❤️ — no LinkedIn, menos é mais.
- Bullets com moderação (só no formato passo a passo).
- Português impecável. Sem exclamação em excesso.
- Assinatura opcional no fim: "Bora destravar?" ou "See you".
- Responder todo comentário nas primeiras 2 horas (o algoritmo premia conversa).

**Hashtags (escolher até 3):** #inglês #inglêsparaadultos #inglêsnotrabalho #aprendizagemacelerada #carreira #desenvolvimentopessoal #fluência

## 6. Grade de publicação

| Dia | 08:00 (fixo) | 17:30 (opcional) |
|---|---|---|
| Seg | Pilar 1 — Dor | — |
| Ter | Pilar 2 — Trabalho | Pilar 4 — Bloqueio |
| Qua | Pilar 3 — Ciência | Pilar 5 — Case |
| Qui | Pilar 4 — Bloqueio | Pilar 2 — Mini-aula |
| Sex | Pilar 5 — Autoridade/História | — |

= 5 a 8 posts/semana. Começar com os 5 fixos e ligar os opcionais quando o ritmo estiver confortável.

## 7. Checklist antes de aprovar
- [ ] O gancho para o dedo sem precisar do resto?
- [ ] Eu (Marcela) falaria isso exatamente assim?
- [ ] Tem uma ideia só?
- [ ] Ensina, provoca ou emociona — e deixa uma pergunta?
- [ ] Sem idade, sem estatística, sem diminutivo, sem religião/política?
- [ ] Se cita aluna: tenho a autorização?

## 8. Frases-âncora da marca (usar com naturalidade, não todas de uma vez)
- "O problema não é o inglês. É como te ensinaram."
- "Você já tem o inglês na cabeça. Só precisa destravar."
- "Fluência é comunicação, não perfeição."
- "Você não precisa de talento. Só de técnica e treino."
- "A repetição é a mãe da fluência."
- "Só erra quem tenta."
- "Fácil é comer pudim."
$g$
from public.kb_documents d where d.chave_externa = 'linkedin:guia-editorial';
