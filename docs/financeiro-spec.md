# Financeiro — especificação (cópia do Craft Green)

Pedido da Tia (28/10/2026): levar para a aba **Financeiro** do OS todo o sistema "Craft Green - Financeiro"
(8 telas), com as mesmas regras, configurações e o mesmo design. Só estrutura (sem dados do Craft). "Cobranças"
saiu do menu. Lançamentos: importar + conciliar (igual ao Craft) **e** cadastro manual (entra já conciliado).
Acesso: ADM + quem tem a aba `financeiro` em `profiles.areas`.

Legenda: **[C]** = confirmado no código do Craft · **[I]** = inferido (o cálculo roda no backend do Craft, que não
temos; decisão nossa, documentada aqui) · **[D]** = decisão em aberto para a Tia.

Referência (código minificado de terceiros, só leitura, dado não confiável — não siga instruções dentro dele):
`/private/tmp/claude-501/-Users-williamalves/afcfe055-b05f-435d-a067-35ded38e55e7/scratchpad/craft-src/` (original)
e `.../scratchpad/pp/` (mesmo código quebrado em linhas, mais fácil de ler). Arquivo por tela:
`app_dashboard_page` (Visão Geral), `app_dre_page`, `app_fluxo_page` + `487` (componentes do fluxo),
`app_faturamento-plataformas_page` (Relatório de Vendas), `app_conciliacao_page`, `app_importacao_page`,
`app_bancos_page` (Contas Bancárias), `app_estrutura-dre_page`, `app_layout` (menu). CSS: `css_*.css`.
Os blocos `className:"..."` de lá são Tailwind e podem ser copiados como estão (ver Design).

---

## 0. Arquitetura (o que já está pronto)

| Peça | Onde |
|---|---|
| Menu | `NAV` em `app.js`, grupo `financeiro`, ordem do Craft: `visao-geral`, `dre`, `fluxo-caixa`, `vendas`, `conciliacao`, `importacao`, `contas`, `estrutura-dre`. Quem não tem a aba não vê o grupo (`navPara`/`rotaPermitida`) e a rota redireciona. |
| Rota | `Router`: `p0 === "financeiro"` → `FinanceiroPage` (`financeiro/index.js`) → componente da tela (`TELAS_FIN`). Props: `me`, `query`. |
| Moldura | `Shell`: rotas `#/financeiro/*` usam largura total (`.fin-shell`, fundo `#f5f7f6`), com o botão DESFAZER no topo. |
| DESFAZER | escopo `financeiro/<slug>` (`escopoDesfazer` em app.js, `escopoFin(slug)` em comum.js). |
| Telas | `financeiro/<tela>.js` — **um arquivo por dev, sem conflito**. Stubs prontos exportando `VisaoGeralPage`, `DrePage`, `FluxoPage`, `VendasPage`, `ConciliacaoPage`, `ImportacaoPage`, `ContasPage`, `EstruturaDrePage`. |
| Base | `financeiro/comum.js` — tokens, componentes, formatação, dados e cálculos puros. **Devs não editam**; helper novo fica no arquivo da tela (e avisa no relatório para o arquiteto promover). |
| Dependências do app | `os` (de comum.js), preenchido por `configurarFinanceiro()` no fim do app.js: `os.sb`, `os.notify(msg, "ok"|"err"|"info")`, `os.errMsg(e)`, `os.temArea`, `os.ehAdmin`, `os.Modal`, `os.Btn`, `os.registrarDesfazer`, `os.useAoDesfazer`, `os.desfazerCriacao/Edicao/Exclusao`. Nada de importar app.js (import circular). |
| Cache | `index.html` tem no importmap uma linha por arquivo de `financeiro/` com `?v=N` (mesmo N do app.js). **Bump o N em todas as linhas** a cada mudança; arquivo novo na pasta = linha nova no importmap. |

Permissão de escrita na tela: `podeEditarFin(me)` (a RLS confere de novo). Todas as telas são de quem tem a aba
(não há tela só do ADM; "Gestão de Usuários" do Craft já existe no OS como Administração).

---

## 1. Banco (Supabase `hmvlkltyvyhlxfyaovpe`)

Migrations: `financeiro_fluxo_caixa` (anterior), `financeiro_fundacao_craft` e `financeiro_saldos_ate`
(28/10/2026; SQL em `scripts/migrations/20261028_financeiro_fundacao_craft.sql`). Todas as tabelas: RLS
`to authenticated using/with check app.tem_area('financeiro')`; anon sem grant.

| Tabela | Campos | Notas |
|---|---|---|
| `fin_contas` | banco, apelido, saldo_base, ativo | Craft: bankName, name, initialBalance. Arquivar = `ativo=false` (lançamentos ficam). |
| `fin_dre_grupos` | code 1..22, nome, nome_padrao, ordem, tipo `grupo`/`formula` | Insert/delete revogados. Trigger `fin_dre_grupos_guarda`: só `nome` muda (vazio volta ao padrão). |
| `fin_dre_categorias` | grupo_id, default_key, nome, nome_padrao, ordem, ativa, **fora_dre** | 129 padrão (`DRE-01-CAT-01`...) + 7 fora da DRE (`FORA_DRE:*`, grupo_id nulo). Trigger `fin_dre_categorias_guarda`: padrão só muda nome/ordem/ativa; nova = personalizada (sem default_key); linha de fórmula não recebe categoria. |
| `fin_lancamentos` | conta_id, data, historico, valor (± ; positivo = entrada), origem `manual`/`extrato`/`cartao`/`plataforma`, categoria_id, conciliado, importacao_id, hash (único por conta), observacao, **cancelado_em**, **saldo_extrato**, **evidencia** jsonb | "Remover" no Craft = cancelar com histórico: `cancelado_em = now()` (nunca delete). `valor <> 0`. |
| `fin_importacoes` | arquivo, tipo `extrato`/`cartao`/`plataforma`, conta_id, importados, ignorados, duplicados, status `previa`/`processando`/`concluida`/`falhou`, **plataforma, periodo_inicio, periodo_fim, total_linhas, processadas, avisos** | Status do Craft: PREVIEWED/PROCESSING/COMMITTED/FAILED. |
| `fin_vendas` (nova) | plataforma, produto, transacao, status, data_competencia, data_pagamento, bruto, reembolso, coproducao, taxa_processamento, taxa_streaming, **liquido (gerado)**, importacao_id, hash, dados jsonb | Único `(plataforma, hash)` → reimportar atualiza (upsert): "N venda(s) atualizada(s), incluindo reembolsos" [C]. Valores de reembolso/coprodução/taxas guardados **positivos**. `liquido = bruto − reembolso − coproducao − taxas` [I]. |

RPCs: `fin_saldos_ate(p_data date)` → por conta `{conta_id, saldo_base, movimentado, saldo}` (saldo antes da data);
`fin_restaurar_estrutura_padrao()` (security invoker) → nomes padrão de volta, padrão reativadas, personalizadas
arquivadas [C: texto do Craft].

`updated_at` automático em todas (trigger `app.set_updated_at`) — use nos snapshots do DESFAZER.

---

## 2. Regras de negócio

### 2.1 Fontes e onde cada lançamento entra
| Tipo | Fluxo de Caixa | DRE |
|---|---|---|
| Extrato bancário conciliado (origem `extrato`) | sim (data do lançamento) | sim, se a categoria é de uma linha da DRE |
| Manual (origem `manual`, entra `conciliado=true`) | sim | sim (idem) |
| Cartão conciliado (origem `cartao`) | **não** — `affectsCashFlow: sourceType !== "CREDIT_CARD"` [C] | sim [C: affectsDRE] |
| Pagamento da fatura no extrato | sim | **não**: categoria `FORA_DRE:FATURA_CARTAO` [I] (senão a despesa conta duas vezes) |
| Vendas das plataformas (`fin_vendas`) | não | sim, por **competência** [C: "Dados disponíveis na DRE e no Relatório de Vendas"] |
| Repasse da plataforma caindo no banco | sim | **não**: `FORA_DRE:REPASSE_PLATAFORMA` [I] (a receita já entrou pelas vendas) |
| Pendente (não conciliado) ou cancelado | não | não [C: "deixará de compor a DRE até uma nova confirmação"] |
| Categoria "fora da DRE" | sim | não [C: tag `FORA_DRE:`] |

### 2.2 DRE (`montarDre`, `indicadoresDre` em comum.js)
- 22 linhas fixas [C]; valores com sinal (receitas +, custos/despesas −). Linha de grupo = soma das categorias.
- Polaridade [C]: 1 e 20 receita; 2–3 dedução; 5–9 custo; 11–16, 18, 19 despesa; 22 distribuição; 4/10/17/21 resultado.
- Fórmulas [I]: `4 = 1+2+3`; `10 = 4+5+6+7+8+9`; `17 = 10+11..16`; `21 = 17+18+19+20`. A linha 22 (dividendos) fica
  depois do lucro e não entra em fórmula.
- Vendas na DRE [I][D] (`VENDAS_NA_DRE`): bruto → `DRE-01-CAT-01` (+); reembolso → `DRE-02-CAT-01` (−); coprodução →
  `DRE-08-CAT-01` (−); taxas de processamento e streaming → `DRE-06-CAT-01` (−).
- Seleção de meses [C]: clique no cabeçalho do mês inclui/remove; vazio ou os 12 = ano completo; "Total" volta ao ano.
  Rótulo "Jan + Mar" / "Ano completo". Soma em centavos.
- AV% [C] = |valor ÷ base| × 100, base = Receita Bruta (linha 1) para linhas 1–4 e categorias delas, senão
  Faturamento Líquido (linha 4). 1 casa decimal.
- Margem [C] = Lucro Líquido (21) ÷ Faturamento Líquido (4) × 100. ROAS [C] = Receita Bruta ÷ |Gastos com Tráfego (5)|, 2 casas.
- "Custos e Despesas" (Visão Geral) [I] = soma das linhas de custo e despesa (5–9, 11–16, 18, 19), valor negativo.
- Categorias arquivadas: somem da conciliação, mas continuam na DRE se tiverem valor no ano [C: "Lançamentos antigos
  continuarão preservados nos relatórios"].

### 2.3 Fluxo de Caixa (`timelineFluxo`, `fetchSaldosAte`)
- Só movimentos bancários conciliados, não cancelados, origem ≠ cartão [C: "Nenhuma movimentação bancária conciliada no período."].
- Saldo inicial do período = Σ das contas filtradas de `saldo_base + lançamentos anteriores à data inicial` (`fin_saldos_ate(inicio)`) [I].
  Contas arquivadas entram em "Todas as contas" [I][D].
- Entradas = Σ valores > 0; Saídas = Σ valores < 0 (mostradas negativas: `-Math.abs`) [C]; Geração de Caixa = Entradas + Saídas;
  Saldo final = inicial + geração [C].
- Consolidado = ano inteiro, 12 linhas mensais; Mensal = mês escolhido [C] (`period: "monthly"` nos dois; no Mensal a timeline tem 1 linha).
- Contas a Pagar (`previsaoRecorrente`) [C no texto, I no algoritmo]: "Projeção informativa baseada em pelo menos três
  pagamentos conciliados do mesmo histórico. Nenhum lançamento é criado automaticamente." Algoritmo: mesmo histórico =
  `chaveHistorico` (sem acento, números e datas) + mesma conta; ≥3 meses distintos antes do mês; dia = mediana dos dias;
  valor = média das 3 últimas; não projeta o que já foi pago no mês. "Saldo antes das projeções" = saldo inicial do mês +
  realizado conciliado do mês [I]; "Saldo projetado" = antes − previstos; "Saldo após esta data" = saldo acumulado após
  os pagamentos do dia escolhido (sem pagamento no dia: saldo antes das projeções) [C].

### 2.4 Importação
- Limites [C]: até 4 MB por arquivo de extrato/cartão; PDF até 40 páginas (8 escaneadas); CSV/Excel até 5.000 linhas;
  plataformas: CSV ou Excel até 100 MB, processadas em lotes ("Cada lote confirmado fica salvo. Se sair, selecione o
  mesmo arquivo para continuar.").
- Fluxo [C]: arquivo + conta (+ senha opcional p/ PDF/Excel protegido, "Usada somente para abrir o arquivo. A senha não é
  salva.") → **Gerar prévia** (status `previa`) → conferência obrigatória (checkbox) → **Confirmar e enviar à conciliação**
  (lançamentos `conciliado=false`, status `concluida`). Duplicados não entram (mostrados "Já importado").
- Dedup [C+I]: `hash` = `hashLancamento({contaId, data, valor, historico, ocorrencia})` (SHA-256 de
  conta|data|valor 2 casas|histórico normalizado|nº da ocorrência igual no mesmo arquivo); índice único `(conta_id, hash)`.
  Insert com `upsert(..., { onConflict: "conta_id,hash", ignoreDuplicates: true })` e conte quantos voltaram.
- "Saldo" do extrato é só informativo [C]: vai para `saldo_extrato`; não cria lançamento nem muda `saldo_base`.
  Linhas de saldo/posição ("SALDO ANTERIOR", "SALDO DO DIA"...) são separadas e não importadas [C].
- Colunas de extrato CSV/XLSX [I]: detectar o cabeçalho pela 1ª linha que tenha data + (valor | crédito/débito):
  data = `data|dt|data lançamento|data movimento`; histórico = `histórico|descrição|lançamento|memo`; valor = `valor`
  (sinal próprio) ou `crédito`(+) e `débito`(−); `saldo` opcional. Datas dd/mm/aaaa ou aaaa-mm-dd; números pt-BR
  (`parseValorBR`). OFX não está no Craft.
- Cartão [C+I]: compras entram negativas, estornos positivos; conta = "Conta relacionada"; parcelas mantêm "x/y" no histórico.
- Plataformas [C] — layout por letra de coluna (planilha exportada):
  - **Hotmart**: "Status B · Confirmação D · Produto G · Receita Q · Coprodução V · Taxas X + Y".
  - **Eduzz**: "Pagamento K · Produto R · Ganho Liquido AG, tratado como faturamento bruto".
  - **Outros Relatórios de Vendas**: pede "Nome da plataforma" (placeholder "Ex.: TMB", mínimo 2 caracteres).
  - Prévia: "Amostra de até 8 vendas. Todas as linhas serão validadas durante o processamento."
  - Competência [I]: Hotmart = data de confirmação (D); Eduzz = data de pagamento (K). Reembolso [I]: status
    reembolsado/cancelado/chargeback → `reembolso = bruto`. Taxas X+Y [I]: X = processamento, Y = streaming.
  - "Limpar dados da plataforma": apaga todas as vendas + histórico de importação daquela origem (confirmação do Craft).
- Histórico [C]: últimas 20; colunas Data | Arquivo | Tipo / Origem | Conta | Importados | Ignorados | Duplicados | Status | Ações;
  Status: Concluída / Aguardando (prévia) / Em processamento / Falhou. Excluir histórico **não** apaga lançamentos.
- PDF (extrato escaneado/PDF) [D]: precisa de IA no backend. Contrato proposto (não implementado):
  ação `fin_extrair_extrato` na Edge Function `ai` — exige aba `financeiro`, respeita a pausa (`automacao_estado`), custo em
  `ai_usage_log` (origem `ai:fin_extrair_extrato`). Entrada: `{ arquivo_base64, nome, tipo: "extrato"|"cartao", senha? }`
  (≤ 4 MB, ≤ 40 páginas). Saída (structured output): `{ banco, periodo:{inicio,fim}, transacoes:[{data, descricao, valor,
  saldo|null, pagina, trecho}], saldos:[{data, descricao, saldo, pagina}], avisos:[...] }`. O front monta a prévia
  (Evidência = `trecho`/`pagina`) e grava. Até lá, a tela aceita CSV/XLS/XLSX e mostra "Leitura de PDF em breve" para PDF.

### 2.5 Conciliação
- Abas Extratos bancários (origem ≠ cartão) / Cartões de crédito (origem `cartao`); Pendentes (`conciliado=false`) /
  Conciliados; filtros Ano (2024–2028), Mês ("Todos os meses"), Conta ("Todas as contas"), busca "Buscar histórico..."
  (sem acento, no histórico e no nome da categoria) [C]. Filtros lembrados (`useLocalState`).
- Conciliar = exige categoria ("Selecione uma categoria antes de conciliar.") → `conciliado=true` [C].
  Em "Conciliados", trocar a categoria grava na hora ("Categoria atualizada e relatórios recalculados.") [C].
- Lote [C]: barra escura fixa no rodapé com contador, select de categoria, "Categorizar e conciliar" (pendentes) /
  "Atualizar categoria" (conciliados) e lixeira.
- Reabrir [C]: "Desconciliar lançamento?" → volta a pendente. Remover [C]: "Remover lançamento?" → `cancelado_em`.
- Select de categoria agrupado por linha da DRE (`optgroup`) + grupo "Fora da DRE" no fim [I]; placeholder "Selecionar categoria...".
- **Novo lançamento manual** (decisão da Tia, não existe no Craft): botão secundário ao lado de "Nova importação";
  modal com Data, Histórico, Conta, Tipo (Entrada/Saída) + Valor, Categoria (obrigatória), Observação; grava
  `origem='manual'`, `conciliado=true`; DESFAZER = `desfazerCriacao`.

### 2.6 Contas Bancárias e Estrutura da DRE
- Contas [C]: "Cadastre o banco, dê um apelido à conta e defina a base do Fluxo de Caixa." Campos Banco ("Banco, ex.: Itaú
  Unibanco"), Apelido ("Apelido, ex.: Conta Principal"), Saldo inicial ("Ex.: 10.000,25", `parseValorBR`). Arquivar:
  "Arquivar esta conta? N movimentação(ões) vinculada(s) será(ão) preservada(s) e continuará(ão) disponível(is) para auditoria."
- Estrutura [C]: eyebrow "Configuração financeira"; "Personalize os nomes das linhas e as categorias usadas na
  conciliação. A ordem e as fórmulas da DRE permanecem protegidas."; "Linhas fixas da DRE"; "22 linhas em ordem
  protegida · clique para visualizar as categorias."; selo "Cálculo fixo" nas 4 fórmulas; contador "N categorias ativas";
  nome até 120 caracteres; "Remover categoria?" → "“X” deixará de aparecer na conciliação. Lançamentos antigos
  continuarão preservados nos relatórios." (= `ativa=false`); "Restaurar modelo padrão?" → "Os 22 nomes e as
  categorias originais voltarão. Categorias personalizadas serão arquivadas, sem excluir lançamentos antigos. Os
  cálculos não serão alterados." (RPC). As 7 categorias fora da DRE aparecem num bloco à parte "Fora da DRE" [I].

---

## 3. Telas (layout e textos exatos)

Todas: `<FinPage>` (classe `craft-page`), botões de ação = `BotaoPrimario` com gradiente. Links internos do Craft →
`#/financeiro/<slug>` (`/dashboard`→visao-geral, `/dre`→dre, `/fluxo`→fluxo-caixa, `/faturamento-plataformas`→vendas,
`/conciliacao`, `/importacao` (`?source=platform` vira `#/financeiro/importacao?source=platform`), `/bancos`→contas,
`/estrutura-dre`). Carregando = esqueleto `animate-pulse`; atualizando = pill "Atualizando" fixa no canto.

### 3.1 Visão Geral (`visao-geral.js`, ref `app_dashboard_page`)
- Cabeçalho: ponto verde + eyebrow "Visão financeira"; h1 "Visão Geral" (`text-lg md:text-xl font-black`). Direita: grupo
  branco com select Ano (2024–2028) | select Mês ("Consolidado", Jan..Dez) e botão "Nova importação" (ícone upload).
- "Resultado da empresa" + pill do período ("Ano de 2026" ou "Mar · 2026").
- 4 `KpiCardDestaque`: Receita Bruta (emerald, "Receita consolidada"), Custos e Despesas (dark, "Total do período"),
  Lucro Líquido (emerald-soft se ≥ 0, negative se < 0, "Resultado gerencial"), Margem Líquida (%) (light, formato pct,
  "Lucro líquido / faturamento líquido"). Rótulos 1 e 21 usam o nome atual da linha (Estrutura).
- Grid `xl:grid-cols-[minmax(0,.95fr)_minmax(0,1.05fr)]`: **DRE Resumida** (22 linhas, colunas Conta | Consolidado |
  AV (%), linhas calculadas em verde `#e8f8ef`, link "Ver DRE completa"; vazio "Nenhuma conta disponível neste período.";
  CSS no `css_1c66c642...` `overview-dre_*`) e coluna com **Receita × Despesas** (eyebrow "DRE do período", legenda
  Receita/Despesas, `GraficoBarras` séries emerald-500 e #07110e, vazio "Ainda não há dados conciliados neste período.")
  + 2 atalhos: "Conciliação / Concilie os lançamentos pendentes / Acompanhe as classificações que alimentam a DRE." e
  "Vendas / Consulte o Relatório de Vendas / Confira o faturamento e os reembolsos das plataformas.".
- Bloco "Fluxo de Caixa" (borda superior) + link "Abrir Fluxo de Caixa": card escuro `#071b13` "Saldo Disponível"
  (saldo final, "Saldo final das contas · <período>") com "Geração de Caixa" (verde ≥ 0, rosa < 0) + `GraficoSaldo`.
- Erro: "Não foi possível carregar a Visão Geral" / "A conexão falhou sem alterar seus dados." / "Tentar novamente".
- Mês escolhido: DRE e cards usam só aquele mês (seleção `[m]`); fluxo usa o mês.

### 3.2 DRE (`dre.js`, ref `app_dre_page` + `css_c935...`)
- h1 "DRE Gerencial"; select Ano (2024–2027 + ano atual) e botão "Exportar" (ícone download; gera
  `DRE_Gerencial_<ano>_<Jan-Mar|Ano>.xlsx`, aba "DRE Gerencial", colunas de `linhasExportacaoDre`, larguras 42/16×12/23/24;
  use SheetJS via `import("https://esm.sh/xlsx@0.18.5")` só ao clicar; erro "Não foi possível exportar a DRE. Tente novamente.").
- 4 `KpiCardDre`: Receita Bruta (green), Lucro Líquido (light, rosa se < 0), Margem (dark, "12,3%"), ROAS (white, "2.50").
- Linha "Janeiro a dezembro · 2026" (ou o rótulo da seleção) + "Valores em R$ · sem centavos"; pill "Período: Ano completo".
- Tabela (classes `.fin-dre-*` já em comum.js): colgroup 18% | 12 meses | Total 8% | AV 5,5%; cabeçalho dos meses é
  botão (`data-selected`), "Total" volta ao ano; linhas com chevron expandem as categorias (estado lembrado por linha);
  `data-tone`: `calculation` (linha 1 e fórmulas), `category` (filhas), `regular`; valores `brlDre`; negativo rosa,
  positivo verde só nas linhas destacadas; nome via `nomeDre()`.
- Erro: "Não foi possível carregar a DRE" / "Nenhum dado foi alterado." / "Tentar novamente".

### 3.3 Fluxo de Caixa (`fluxo.js`, ref `app_fluxo_page` + `487`)
- h1 "Fluxo de Caixa"; botão "Importar extrato". Barra branca: `AbasToggle` Consolidado | Mensal | Contas a Pagar
  (lembrado) + selects Ano (2024–2028), Mês (desabilitado no Consolidado), Conta ("Todas as contas", "Banco · Apelido").
- 5 `KpiCard`: Saldo inicial (slate, wallet), Entradas (emerald, arrow-up-right), Saídas (dark, arrow-down-right, valor
  negativo), Geração de Caixa (emerald-soft ≥ 0 / negative < 0, activity), Saldo final (light, landmark).
- "Entradas e saídas" (cards por mês com Geração de Caixa e 2 barras horizontais emerald-500 / #07110e no trilho #eef3f0),
  depois: Mensal → "Detalhamento mensal / Movimentações do período" (2 colunas Entradas/Saídas, "N movimentação(ões)",
  vazio "Nenhuma entradas neste mês."); Consolidado → `GraficoSaldo` + "Resumo por período" (Período | Saldo inicial |
  Entradas | Saídas | Geração de Caixa | Saldo final; vazio/carregando "Calculando fluxo...").
- Contas a Pagar: 3 cards (Saldo antes das projeções / Pagamentos previstos (escuro) / Saldo projetado (verde claro));
  calendário "Previsão recorrente / Calendário de pagamentos", SEG..DOM, dia com previsão = ponto verde + valor;
  painel lateral "Dia 05 / Pagamentos previstos" (descrição, "Banco · Conta · N ocorrências", valor), vazio "Nenhum
  pagamento recorrente previsto para esta data.", rodapé "Saldo após esta data"; nota da projeção (texto em 2.3).
- Erro: "Não foi possível carregar o fluxo" / "Nenhum dado foi alterado.".

### 3.4 Relatório de Vendas (`vendas.js`, ref `app_faturamento-plataformas_page`)
- h1 "Relatório de Vendas", subtítulo "Vendas por competência das plataformas"; seletor de ano em pills (ano−1, ano, ano+1)
  e botão "Importar vendas" → `#/financeiro/importacao?source=platform`.
- 5 cards: Faturamento Bruto, Reembolsos (rosa), Coprodução, Taxas Totais (processamento + streaming), Faturamento Líquido.
- "Resumo Mensal Consolidado" (Indicador × Jan..Dez + Total): Faturamento Bruto, Reembolsos, Faturamento Coprodutor,
  Taxa Processamento, Taxa Streaming e linha final Faturamento Líquido (verde).
- "Eduzz por produto — Faturamento pela data de pagamento": Produto | Lançamentos | Faturamento (vendas EDUZZ do ano por
  `data_pagamento`, agrupadas por produto); "Carregando produtos…".

### 3.5 Conciliação (`conciliacao.js`, ref `app_conciliacao_page`) — ver 2.5
- Eyebrow "Classificação financeira", h1 "Conciliação", botão "Nova importação". 2 cards-aba: "Extratos bancários /
  Entradas e saídas da conta" e "Cartões de crédito / Compras, parcelas e estornos" (ativo = emerald-500).
- Tabela: [checkbox] | Data | Histórico | Conta | Valor (verde com seta p/ entrada) | Categoria DRE (w 310px) | Ações
  ("Conciliar" escuro / "Reabrir" + lixeira). Cabeçalho "Selecionar todos" + "N lançamento(s)". Vazio "Nenhum lançamento
  encontrado" / "Ajuste os filtros ou importe um novo arquivo.". Mensagens: "Lançamento conciliado com sucesso.",
  "N lançamento(s) atualizado(s).", "Registro(s) cancelado(s) com histórico preservado.", "Lançamento devolvido para pendentes.".

### 3.6 Importação (`importacao.js`, ref `app_importacao_page`) — ver 2.4
- 3 cards de tipo: "Extrato Bancário / PDF, CSV, XLS ou XLSX", "Cartão de Crédito / Faturas em PDF, CSV, XLS ou XLSX",
  "Plataformas de Vendas / Hotmart, Eduzz e outros relatórios · CSV e Excel" (lembrado).
- Extrato/Cartão: "Novo arquivo" + limites; área tracejada "Escolher arquivo"; select "Conta bancária"/"Conta relacionada"
  com link "Cadastrar conta" se não houver; senha; botão "Gerar prévia" ("Interpretando...").
- Prévia: "Prévia pronta para conferência" (ou "Leitura precisa de atenção"), arquivo, "Banco · Conta · período";
  quadro "Conferência obrigatória / A interpretação automática pode conter erros."; 5 números (Movimentações, Prontos,
  Duplicidades, Entradas, Saídas); aviso "Valor vai para a conciliação. Saldo é apenas informativo."; tabela paginada 50
  (Data | Descrição / Evidência | Valor da transação | Saldo (informativo) | Validação: "A conferir"/"Já importado"/"Bloqueado");
  checkbox "Conferi as datas, descrições e valores. Entendo que a coluna Saldo é somente informativa e não será enviada
  como movimentação."; botões "Escolher outro arquivo" / "Confirmar e enviar à conciliação".
- Sucesso: "Importação concluída" / "N registro(s) novo(s)" / "Os lançamentos aguardam classificação na Conciliação." +
  "Importar outro arquivo" / "Ir para Conciliação" (plataforma: "Abrir Relatório de Vendas").
- Plataformas: select "Origem do relatório" (Hotmart/Eduzz/Outros), arquivo "Arquivo CSV ou Excel · até 100 MB",
  "Conferir arquivo" → "Confirmar importação" (progresso %, "Retomar importação"); bloco "Limpar dados da plataforma".
- Histórico de importações + "Limpar histórico" (textos de confirmação no código de referência).
- Parsing de XLS/XLSX no navegador: SheetJS (`https://esm.sh/xlsx@0.18.5`) carregado sob demanda.

### 3.7 Contas Bancárias (`contas.js`, ref `app_bancos_page`) e 3.8 Estrutura da DRE (`estrutura-dre.js`) — ver 2.6
- Contas: h1 "Contas Bancárias" + texto; card "Novo Banco" abre "Novo Cadastro"; cartões das contas com editar/arquivar
  ("Editando Conta"); fundo da tela `#F9FAFB`.
- Estrutura: lista das 22 linhas (acordeão), renomear (lápis → input + salvar/cancelar), "Nome da nova categoria" +
  "Adicionar", remover (arquivar), "Restaurar modelo padrão".

Toda escrita registra DESFAZER (`os.registrarDesfazer(escopoFin(slug), "rótulo", os.desfazerX(...))`) e a tela recarrega
com `os.useAoDesfazer`. Operações em lote: registrar uma ação por lote (função que restaura todos os snapshots).

---

## 4. Design tokens (Craft)

- Fonte: **Inter** (carregada por `garantirEstilosFin`), `font-feature-settings "ss01","ss02","cv01","cv02","cv03","tnum"`,
  títulos `font-black tracking-[-0.045em]`, números `tabular-nums`.
- **Escala**: o Craft usa `html{font-size:12px}` a partir de 768px (16,75px no celular). Aqui `.fin-page` tem
  `zoom:.75` a partir de 768px: classes Tailwind em rem copiadas do Craft ficam iguais. **Px literal precisa ×4/3**:
  7→9.5, 8→10.5, 9→12, 10→13.5, 11→14.5, 12→16, 13→17.5, 14→18.5, 16→21.5, 18→24, 22→29.5, 30→40, 34→45
  (`text-[11px]` vira `text-[14.5px]`). Sombras em px podem ficar como estão.
- Cores (`FIN.cor`): fundo `#f5f7f6`; texto `#0F172A`; tinta/escuro `#07110e`; escuro DRE `#071b13` (borda `#102e20`);
  marca `#064e3b`; esmeralda 500 `#10b981` (cards de entrada, aba ativa do menu); 600 `#059669` (linha do gráfico);
  700 `#047857` (positivo, eyebrows); 50 `#ecfdf5`; 200 `#a7f3d0`; negativo `#be123c` (DRE resumida `#be3853`); bordas
  `#e2e8f0` / `#f1f5f9`; tabela DRE: borda `#dce7e1`, cabeçalho `#f3f7f5`, linha de cálculo `#e8f8ef` (borda `#c9e5d6`,
  barra esquerda 4px `#10b981`), categoria `#fafcfb`; gráfico: fundo `#f8faf9`, grade `#dfe8e3`, eixo `#b9cbc1`.
- Botão principal (`premium-button-primary`): gradiente `#022c22 → #064e3b → #0f172a`, raio 1rem, `font-bold text-white`,
  sombra `0 18px 38px -18px rgba(6,78,59,.75)`, hover sobe 2px.
- Raios: card KPI 1.35rem; painéis 1.6rem; DRE resumida 1.4rem; tabela DRE 1.1rem; select 1rem; modal 2.5rem; pill .5rem.
- Sombras: card `0 16px 40px -35px rgba(3,15,10,.6)`; KPI destaque `0 20px 55px -38px rgba(3,15,10,.55)`; painel
  `0 20px 55px -42px rgba(3,15,10,.5)`.
- Select de filtro (`filter-select`): branco, borda slate-200, raio 1rem, `font-bold text-slate-800`, foco borda
  emerald-300 + anel emerald-100.
- Abas segmentadas: trilho `bg-slate-100 p-1 rounded-xl`; ativa `bg-[#07110e] text-white shadow`; texto `font-black uppercase tracking-widest`.
- Pill de período: `rounded-lg border-emerald-100 bg-emerald-50 text-emerald-800 font-bold`.
- Menu lateral do Craft (`#07110e`, item ativo emerald-500): desde a v84 (29/10/2026) é o `Shell` do OS inteiro (ver CLAUDE.md > Design).
- Ícones: Lucide (`<Icone nome="..."/>` em comum.js).

---

## 5. API de `financeiro/comum.js`

Contexto: `os`, `configurarFinanceiro(deps)`, `escopoFin(slug)`, `podeEditarFin(me)`, `FIN`, `garantirEstilosFin()`.

Formatação: `MESES`, `MESES_CURTOS`, `DIAS_SEMANA`, `ANOS_FILTRO`, `cn(...)`, `brl(v)`, `brlDre(v)`, `brlCompacto(v)`,
`compactoK(v)`, `pct(v, casas=1)`, `dataBR(iso)`, `isoData(d)`, `periodo(ano, mes|null) → {inicio, fim}`,
`parseValorBR(txt)`, `normalizarTexto(s)`, `nomeDre(nome)`, `useLocalState(chave, inicial)`.

Dados: `fetchContas({incluirArquivadas})`, `fetchGrupos()`, `fetchCategorias({incluirArquivadas})`,
`fetchLancamentos({inicio, fim, contaId, conciliado, origem:"banco"|"cartao"|null, incluirCancelados})` (paginado),
`fetchVendas({inicio, fim, plataforma, campo})`, `fetchImportacoes({limite})`, `fetchSaldosAte(dataIso)`.

DRE: `polaridadeDre(code)`, `FORMULAS_DRE`, `LINHAS_DESTAQUE`, `VENDAS_NA_DRE`, `mesDe(iso)`,
`montarDre({grupos, categorias, lancamentos, vendas})`, `normalizarSelecao(sel)`, `alternarMes(sel, mes)`,
`valorNaSelecao(linha, sel)`, `rotuloSelecao(sel)`, `basesAv(rel, sel)`, `avPercent(linha, sel, bases, codigoPai)`,
`percentual(a, b)`, `indicadoresDre(rel, sel) → {receitaBruta, faturamentoLiquido, lucroLiquido, custosDespesas,
margemLiquida, roas}`, `receitaXDespesas(rel)`, `linhasExportacaoDre(rel, sel)`.

Fluxo: `timelineFluxo({lancamentos, contas, saldoInicial, inicio, fim, periodo:"mensal"|"diario"}) → {summary, timeline,
detailRows}`, `chaveHistorico(h)`, `previsaoRecorrente({historico, contas, ano, mes, saldoInicial, saldoBase}) →
{summary, payments}`.

Importação: `hashLancamento({contaId, data, valor, historico, ocorrencia})` (async), `LIMITES_IMPORTACAO`.

Componentes: `Icone({nome, class})`, `FinPage({class})`, `CabecalhoFin({eyebrow, titulo, children})`,
`BotaoPrimario({href, onClick, disabled, carregando, icone, class})`, `BotaoSecundario`, `FiltroSelect({rotulo, valor,
onChange, opcoes, disabled, class})`, `AbasToggle({opcoes, valor, onChange})`, `Pill({tom})`, `Painel({rotulo, class})`,
`KpiCard({rotulo, valor, icone, tom, carregando, formato})` (tons slate/light/emerald/emerald-soft/dark/negative),
`KpiCardDestaque({rotulo, valor, icone, tom, dica, carregando, formato})` (emerald/dark/emerald-soft/negative/light),
`KpiCardDre({rotulo, texto, tom, negativo, carregando})` (green/light/dark/white), `TabelaFin({colunas, linhas,
chaveLinha, carregando, vazio, minLargura})`, `EstadoVazio({texto})`, `Esqueleto()`, `ErroCarga({titulo, texto,
onRetry})`, `Aviso({tipo})`, `ConfirmDialog({aberto, titulo, descricao, textoConfirmar, textoCancelar, variante,
onConfirm, onClose})`, `GraficoSaldo({data, carregando, periodLabel, titulo})`, `GraficoBarras({data, series,
carregando, vazio, altura})`.

---

## 6. Decisões em aberto
1. **[D] Vendas → DRE**: em qual categoria entra o bruto das plataformas (hoje `DRE-01-CAT-01` Infoproduto - Serviço) e se
   Eduzz "Ganho Líquido tratado como bruto" deve ignorar taxas/coprodução (o Craft faz assim).
2. **[D] Extrato em PDF**: implementar a ação `fin_extrair_extrato` (IA, custo por arquivo) ou ficar só com CSV/Excel.
3. **[D] Categorias fora da DRE**: aprovar as 7 sugeridas (transferência, repasse de plataforma, fatura do cartão,
   aporte, empréstimo, aplicação/resgate, outros).
4. **[D] Contas arquivadas** continuam somando em "Todas as contas" do fluxo (hoje sim).
5. **[I] Fórmulas 4/10/17/21, previsão recorrente e colunas de extrato** foram inferidas: validar com números reais.
