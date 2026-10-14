-- Guia editorial do LinkedIn na Base de Conhecimento (seção Documentação e Processos),
-- documento Markdown com chave_externa 'linkedin:guia-editorial' (lido pela ação linkedin_semana da Edge Function ai).
with d as (
  insert into public.kb_documents (section_id, titulo, descricao, kind, tags, status, origem, chave_externa)
  select s.id, 'Guia Editorial — LinkedIn da Tia do Inglês',
    'Pilares, formatos, anatomia do post, grade de publicação e checklist do LinkedIn pessoal da Tia (Marcela Miranda). Usado pela IA ao gerar a fila semanal em Conteúdo > LinkedIn.',
    'documento', array['linkedin','conteudo','guia-editorial'], 'publicado', 'manual', 'linkedin:guia-editorial'
  from public.kb_sections s where s.slug = 'documentacao-e-processos'
  returning id
)
insert into public.kb_document_versions (document_id, versao, file_name, changelog, conteudo_md)
select d.id, 1, 'guia-editorial-linkedin.md', 'Versão 1 (14/10/2026)', $g$# Guia Editorial — LinkedIn da Tia do Inglês (Marcela Miranda)

> Versão 1 · 14/10/2026 · base: avatar (127 clientes), Documento de Marca, Metodologia, banco de 64 depoimentos.

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

1. **História** — começa numa cena ("Era uma call com Londres…") e termina numa lição.
2. **Mito × Verdade** — derruba uma crença ("Morar fora resolve").
3. **Passo a passo prático** — 3 a 5 passos, aplicáveis hoje.
4. **Case de aluna** — situação real → virada → resultado (confirmar autorização antes de citar nome).
5. **Opinião contrária** — posição firme contra o senso comum ("Gramática não te faz fluente").
6. **Mini-aula** — 3 frases prontas em inglês para uma situação de trabalho, com MYPA quando ajudar.

## 5. Anatomia de um post

```
[GANCHO — 1 a 2 linhas, aparecem antes do "ver mais". Tem que parar o dedo.]

[Desenvolvimento — parágrafos de 1 a 2 linhas, linguagem falada.]

[Virada / lição — a frase que a pessoa vai querer salvar.]

[CTA — 1 pergunta aberta para comentário.]

[0 a 3 hashtags]
```

**Regras:**
- 900 a 1.500 caracteres.
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
$g$ from d;
