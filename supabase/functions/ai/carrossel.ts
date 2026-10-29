// Produtor de carrosséis (aba Conteúdo > Produtor de carrosséis): a IA escreve o roteiro slide a slide
// nos modelos do Manual de carrosséis (guia na Base, chave_externa 'carrossel:manual') e a legenda.
// Nada aqui grava no banco: o front recebe os slides, a Tia revisa no editor e salva em conteudo_carrosseis.
// Os nomes de modelo e campo são os de MODELOS em conteudo/carrosseis.js — mantenha os dois iguais.

type Anthropic = (system: string, user: string, maxTokens: number, opts?: { schema?: unknown; effort?: string }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; stop_reason?: string }>;
type Ctx = { sb: any; sbGuia: any; uid: string; anthropic: Anthropic; log: (origem: string, usage: any) => Promise<void> };

export const CHAVE_GUIA_CARROSSEL = "carrossel:manual";

const MODELOS = ["capa", "abertura", "conteudo", "item", "regra", "passos", "resumo", "virada", "fotoFrase", "finalFoto", "ctaComentario", "conversa"] as const;
const CAMPOS = ["headline", "subtitulo", "frase", "apoio", "titulo", "texto", "ponte", "numeral", "palavra", "tituloFrase", "errada",
  "rotulo", "balao", "efeito", "exemplos", "itens", "cta", "fala", "nome", "contexto", "foto_sugerida"] as const;
const FORMATOS: Record<string, string> = {
  lista: "Lista de palavras ou frases (série)",
  cultura: "Lista de comportamentos / cultura",
  educativo: "Educativo / regras",
  storytelling: "Storytelling (história da Marcela)",
};

// Limites de caracteres por campo para caber no tamanho mínimo de fonte do manual (seção 3) em 1080×1350.
const LIMITE: Record<string, number> = {
  headline: 95, subtitulo: 60, frase: 110, apoio: 230, titulo: 70, texto: 330, ponte: 90, numeral: 3, palavra: 22,
  tituloFrase: 70, errada: 90, rotulo: 26, balao: 70, efeito: 80, exemplos: 200, itens: 260, cta: 60, fala: 200, nome: 40,
  contexto: 60, foto_sugerida: 200,
};

const S = { type: "string" };
const SCHEMA_SLIDE = {
  type: "object", additionalProperties: false,
  required: ["modelo", "fundo", "linha", "posTexto", ...CAMPOS],
  properties: {
    modelo: { type: "string", enum: [...MODELOS] },
    fundo: { type: "string", enum: ["papel", "azul"] },
    linha: { type: "boolean" },
    posTexto: { type: "string", enum: ["baixo", "cima", "meio"] },
    ...Object.fromEntries(CAMPOS.map((c) => [c, S])),
  },
};
const SCHEMA_ROTEIRO = {
  type: "object", additionalProperties: false, required: ["slides", "legenda", "correcoes", "duvidas"],
  properties: {
    slides: { type: "array", items: SCHEMA_SLIDE },
    legenda: S,
    correcoes: { type: "array", items: S },
    duvidas: { type: "array", items: S },
  },
};
const SCHEMA_UM_SLIDE = { type: "object", additionalProperties: false, required: ["slide"], properties: { slide: SCHEMA_SLIDE } };

const CAMPOS_POR_MODELO = [
  "CAMPOS DE CADA MODELO (deixe \"\" nos campos que o modelo não usa; linha=false e posTexto=\"baixo\" quando não se aplicar):",
  "- capa: headline (com a palavra-chave do grifo entre *asteriscos*, UMA só), subtitulo (opcional), posTexto (baixo|cima), foto_sugerida.",
  "- abertura: frase (serifa; final em _itálico_ entre sublinhados), apoio, ponte (opcional). Sempre azul.",
  "- conteudo: titulo, linha (true/false), texto (parágrafos separados por linha em branco), ponte (opcional). fundo papel ou azul.",
  "- item: numeral (\"01\"), palavra (CAIXA ALTA, listas de palavras) OU tituloFrase (só 1ª maiúscula, listas de cultura), errada (o mico, sem aspas), texto (consequência), rotulo (DIGA, PREFIRA, ANTES DE TUDO…), balao (frase certa em inglês), efeito (frase de efeito em _itálico_, listas de cultura), ponte (opcional).",
  "- regra: numeral, rotulo (\"REGRA 1\"), titulo, texto, exemplos (um por linha; a parte que muda entre *asteriscos*), ponte (opcional).",
  "- passos: titulo, itens (um passo por linha, sem número na frente).",
  "- resumo: titulo, linha=true, itens (um por linha no formato \"Rótulo | texto\").",
  "- virada: frase de impacto (final em _itálico_), apoio (opcional). Sempre azul.",
  "- fotoFrase: frase (serifa, final em _itálico_), apoio, cta (só se for o último slide), foto_sugerida.",
  "- finalFoto: texto (principal), cta (termina em \"Clica no link da bio\"), posTexto (baixo|cima|meio), foto_sugerida.",
  "- ctaComentario: texto (ex.: \"Comenta\"), palavra (a palavra-chave em CAIXA ALTA, SEM acento), apoio (o que a pessoa recebe). Sempre azul.",
  "- conversa: titulo (opcional), fala (fala da aluna), nome, contexto.",
  "MARCAÇÃO: *x* = destaque (grifo na capa; vermelho escuro no papel; turquesa no azul). _x_ = itálico. \\n = quebra de linha forçada (use para evitar quebra feia em título).",
  "foto_sugerida: descreva em uma frase a foto da Marcela que ajuda a interpretar o gancho (ex.: \"mão na boca, expressão de vergonha\"). Só em capa, fotoFrase e finalFoto; nos outros, \"\".",
].join("\n");

const REGRAS_MARCA = [
  "REGRAS DE MARCA (obrigatórias):",
  "- Público: mulheres de 40 a 70 anos que estudaram inglês e travam para falar. Tom adulto, acolhedor e direto, voz da Marcela falando com \"você\".",
  "- Português do Brasil impecável. \"inglês\" (e nomes de idioma) em minúscula no meio da frase. Depois de \"?\" a frase seguinte começa com maiúscula.",
  "- NUNCA emoji, diminutivo ou linguagem infantil (nada de \"inglesinho\", \"rapidinho\", \"pouquinho\"). NUNCA religião, política ou tema polêmico.",
  "- Evite \"gente\" no feed. Sem travessão na legenda.",
  "- Inglês dos exemplos 100% correto, natural e americano atual.",
  "- Anos de experiência da Marcela: 33 anos (desde outubro de 2026). Histórias pessoais só as que ela já contou em público.",
  "- \"e-book\", nunca \"ebook\".",
  "- O Método ensina pelo uso (aprender usando, não decorando). Não mande \"decorar\".",
  "- Textos curtos: cada slide tem UMA ideia. Respeite os limites de caracteres; texto longo não cabe no slide.",
].join("\n");

function limitesTexto() {
  return "LIMITES DE CARACTERES POR CAMPO (para caber no tamanho mínimo da fonte): " +
    Object.entries(LIMITE).map(([k, v]) => `${k} ≤ ${v}`).join(", ") + ".";
}

async function exigirConteudo(ctx: Ctx): Promise<string | null> {
  const { data } = await ctx.sb.from("profiles").select("role, areas").eq("id", ctx.uid).maybeSingle();
  if (!data || !(data.role === "admin" || (Array.isArray(data.areas) && data.areas.includes("conteudo"))))
    return "Só quem tem a aba Conteúdo pode usar o Produtor de carrosséis.";
  return null;
}

async function lerGuia(sb: any): Promise<string> {
  const { data } = await sb.from("kb_documents").select("current:current_version_id(conteudo_md)")
    .eq("chave_externa", CHAVE_GUIA_CARROSSEL).maybeSingle();
  return (data?.current?.conteudo_md || "").trim();
}

function extrairObjeto(raw: string): any | null {
  const i = raw.indexOf("{"), j = raw.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(raw.slice(i, j + 1)); } catch { return null; }
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Limpa o slide: só modelos/campos conhecidos, textos sem espaço sobrando, fundo fixo onde o modelo pede. */
function normalizarSlide(x: any) {
  const modelo = (MODELOS as readonly string[]).includes(x?.modelo) ? x.modelo : "conteudo";
  const s: Record<string, any> = { modelo };
  for (const c of CAMPOS) { const v = String(x?.[c] ?? "").replace(/\r/g, "").trim(); if (v) s[c] = v; }
  if (["abertura", "virada", "ctaComentario"].includes(modelo)) delete s.fundo;
  else if (["conteudo", "item", "regra"].includes(modelo)) s.fundo = x?.fundo === "azul" ? "azul" : "papel";
  if (modelo === "conteudo" || modelo === "resumo") s.linha = !!x?.linha;
  if (["capa", "finalFoto"].includes(modelo)) s.posTexto = ["baixo", "cima", "meio"].includes(x?.posTexto) && !(modelo === "capa" && x.posTexto === "meio") ? x.posTexto : "baixo";
  if (modelo === "finalFoto") s.alinhar = "centro";
  if (modelo === "ctaComentario" && s.palavra) s.palavra = semAcento(s.palavra).toUpperCase();
  return s;
}

/** Regras duras (o que dá para conferir no código). Devolve a lista de problemas; vazia = ok. */
export function validarRoteiro(slides: any[], b: { tipo: string; qtd: number; formato: string; cta_tipo: string; palavra: string }): string[] {
  const e: string[] = [];
  const unico = b.tipo === "unico";
  if (unico && slides.length !== 1) e.push(`o post único tem que ter exatamente 1 slide (veio ${slides.length})`);
  if (!unico && slides.length !== b.qtd) e.push(`o carrossel tem que ter exatamente ${b.qtd} slides (veio ${slides.length})`);
  slides.forEach((s, i) => {
    for (const [c, lim] of Object.entries(LIMITE)) {
      const v = String(s[c] || "");
      if (v.length > lim) e.push(`slide ${i + 1} (${s.modelo}): o campo ${c} tem ${v.length} caracteres, o limite é ${lim}`);
    }
    const tudo = CAMPOS.map((c) => String(s[c] || "")).join(" ");
    if (/\p{Extended_Pictographic}/u.test(tudo)) e.push(`slide ${i + 1}: tem emoji`);
    if (/\bebook\b/i.test(tudo)) e.push(`slide ${i + 1}: escreva "e-book"`);
  });
  if (!unico) {
    if (slides[0]?.modelo !== "capa") e.push("o slide 1 tem que ser a capa");
    const capa = slides[0];
    if (capa) {
      const grifos = (String(capa.headline || "").match(/\*[^*]+\*/g) || []).length;
      if (grifos !== 1) e.push(`a headline da capa tem que ter exatamente 1 palavra grifada entre *asteriscos* (tem ${grifos})`);
    }
    const ult = slides[slides.length - 1];
    if (!ult || !["finalFoto", "fotoFrase"].includes(ult.modelo)) e.push("o último slide tem que ser finalFoto ou fotoFrase (fechamento com foto)");
    else if (!/clica no link da bio\.?\s*$/i.test(String(ult.cta || ""))) e.push("o CTA do último slide tem que terminar em \"Clica no link da bio\"");
    for (let i = 1; i < slides.length; i++) {
      const azul = (s: any) => ["abertura", "virada", "ctaComentario"].includes(s.modelo) || s.fundo === "azul";
      if (azul(slides[i]) && azul(slides[i - 1])) e.push(`os slides ${i} e ${i + 1} estão os dois no azul (nunca dois azuis seguidos)`);
    }
    const numerados = slides.filter((s) => s.modelo === "item" || s.modelo === "regra");
    numerados.forEach((s, i) => { if (String(s.numeral || "") !== String(i + 1).padStart(2, "0")) e.push(`o ${i + 1}º item/regra tem que ter o numeral "${String(i + 1).padStart(2, "0")}"`); });
    const mCapa = String(capa?.headline || "").match(/^\s*(\d+)\s/);
    if (mCapa && numerados.length && +mCapa[1] !== numerados.length) e.push(`a capa diz ${mCapa[1]}, mas há ${numerados.length} itens`);
    const resumo = slides.find((s) => s.modelo === "resumo");
    const regras = slides.filter((s) => s.modelo === "regra").length;
    if (resumo && regras && String(resumo.itens || "").split("\n").filter((l) => l.trim()).length !== regras) e.push(`o resumo tem que ter ${regras} linhas (uma por regra)`);
    if (b.formato === "lista" && !numerados.length) e.push("a lista precisa de slides de item");
    if (b.formato === "lista") numerados.forEach((s, i) => { if (!s.palavra || !s.balao) e.push(`item ${i + 1}: lista de palavras precisa de palavra e balao`); });
    if (b.formato === "cultura") numerados.forEach((s, i) => { if (!s.tituloFrase || !s.efeito) e.push(`item ${i + 1}: lista de cultura precisa de tituloFrase e efeito`); });
    if (b.formato === "educativo" && (!regras || !resumo)) e.push("o educativo precisa de slides de regra e de um resumo");
    if (b.formato === "storytelling" && !slides.some((s) => s.modelo === "virada")) e.push("o storytelling precisa de uma virada");
    if (b.cta_tipo === "comentario") {
      const c = slides.find((s) => s.modelo === "ctaComentario");
      if (!c) e.push("falta o slide ctaComentario antes do final");
      else if (b.palavra && c.palavra !== semAcento(b.palavra).toUpperCase()) e.push(`a palavra-chave do ctaComentario tem que ser ${semAcento(b.palavra).toUpperCase()}`);
    }
  }
  return e;
}

function estruturaPedida(b: { tipo: string; qtd: number; formato: string; cta_tipo: string; palavra: string; modelo_unico: string }) {
  if (b.tipo === "unico") return `POST ÚNICO: exatamente 1 slide, no modelo "${b.modelo_unico}".`;
  const cta = b.cta_tipo === "comentario"
    ? `Antes do final, um slide ctaComentario com a palavra-chave ${semAcento(b.palavra || "").toUpperCase() || "(escolha uma palavra curta, sem acento)"}.`
    : "Sem slide de CTA de comentário: o CTA fica só no último slide.";
  const estrutura: Record<string, string> = {
    lista: "capa · abertura (azul) · itens 01..N (modelo item com palavra em CAIXA ALTA, o mico em errada, a consequência em texto, a troca no balao com rótulo) · virada (azul, explica o porquê) · fechamento.",
    cultura: "capa · abertura (azul) · itens 01..N (modelo item com tituloFrase, texto e efeito; balao com rótulo quando houver frase em inglês) · virada (azul) · fechamento.",
    educativo: "capa · abertura (azul, quebra a crença) · regras 01..N (modelo regra, rótulo \"REGRA n\", exemplos com a parte que muda entre *asteriscos*) · resumo (uma linha por regra) · virada (azul, frase de marca) · fechamento.",
    storytelling: "capa com a cena · abertura ou primeira cena · slides de história (modelo conteudo, fundo papel, perguntas internas em _itálico_) · virada azul (ex.: \"_Dá._\") · método em passos (modelo passos) · fotoFrase com a conquista · fechamento.",
  };
  return [
    `CARROSSEL de exatamente ${b.qtd} slides, formato ${FORMATOS[b.formato] || b.formato}.`,
    `Estrutura: ${estrutura[b.formato] || estrutura.lista}`,
    cta,
    "Fechamento (último slide): finalFoto ou fotoFrase, com cta terminando em \"Clica no link da bio\". NÃO crie a versão do YouTube: o sistema cria sozinho.",
    "Ritmo de cores (seção 6): slide 2 azul; conteúdo em sequência no papel; azul de novo a cada 3 ou 4 slides em momento-chave; NUNCA dois slides azuis seguidos (abertura, virada e ctaComentario são sempre azuis).",
    "Ajuste a quantidade de itens/regras/cenas para fechar exatamente o número de slides pedido, e faça o número da capa (se houver) bater com a quantidade de itens.",
  ].join("\n");
}

function montarSystem(guia: string) {
  return [
    "Você é a roteirista dos carrosséis do Instagram da Marcela Miranda, a Tia do Inglês (Método Tia do Inglês, inglês para adultos).",
    "Escreve o roteiro slide a slide nos modelos do Manual de carrosséis e a legenda do post. Antes de responder, confira o checklist da seção 9 e corrija o que for simples.",
    "",
    "=== MANUAL DE CARROSSÉIS (fonte da verdade) ===",
    guia,
    "",
    REGRAS_MARCA,
    "",
    CAMPOS_POR_MODELO,
    "",
    limitesTexto(),
    "",
    "LEGENDA (seção 13): complementa o carrossel sem repetir os slides; uma frase por linha, linhas curtas; sem travessão; primeira linha com a palavra-chave do tema (SEO);",
    "fecha com pergunta que gera comentário de reconhecimento ou com a palavra-chave do CTA; 4 ou 5 hashtags de nicho no fim, incluindo #inglesparaadultos e #tiadoingles.",
    "",
    "correcoes: lista curta do que você corrigiu ou ajustou por conta do checklist (ex.: \"Numeração ajustada para 01 a 05\"). duvidas: perguntas de conteúdo para a Tia confirmar (ex.: \"A palavra MEMORIA é gatilho de automação?\"). Listas vazias se não houver.",
  ].join("\n");
}

async function contexto(ctx: Ctx) {
  const [insRes, recRes] = await Promise.all([
    ctx.sb.from("conteudo_insights").select("categoria,texto").order("categoria").order("ordem"),
    ctx.sb.from("conteudo_carrosseis").select("tema,formato,created_at").order("created_at", { ascending: false }).limit(15),
  ]);
  const insights = (insRes.data || []).map((r: any) => `- [${r.categoria}] ${r.texto}`).join("\n");
  const recentes = (recRes.data || []).map((r: any) => `- ${r.tema} (${r.formato || "?"})`).join("\n");
  return { insights, recentes };
}

export async function carrosselRoteiro(ctx: Ctx, body: Record<string, any>) {
  const erro = await exigirConteudo(ctx);
  if (erro) return { status: 403, body: { error: erro } };
  const b = {
    tema: String(body.tema ?? "").trim().slice(0, 300),
    tipo: body.tipo === "unico" ? "unico" : "carrossel",
    formato: FORMATOS[body.formato] ? String(body.formato) : "lista",
    qtd: Math.max(3, Math.min(20, Number(body.qtd) || 8)),
    cta_tipo: body.cta_tipo === "comentario" ? "comentario" : "bio",
    palavra: String(body.palavra ?? "").trim().slice(0, 30),
    modelo_unico: (MODELOS as readonly string[]).includes(body.modelo_unico) ? String(body.modelo_unico) : "capa",
    observacoes: String(body.observacoes ?? "").trim().slice(0, 1500),
  };
  if (!b.tema) return { status: 400, body: { error: "Escreva o tema do carrossel." } };
  const guia = await lerGuia(ctx.sbGuia);
  if (!guia) return { status: 400, body: { error: `Manual de carrosséis não encontrado na Base (chave_externa '${CHAVE_GUIA_CARROSSEL}').` } };
  const { insights, recentes } = await contexto(ctx);

  const system = montarSystem(guia);
  const user = [
    `TEMA: ${b.tema}`,
    b.observacoes ? `OBSERVAÇÕES DA TIA: ${b.observacoes}` : "",
    "",
    estruturaPedida(b),
    "",
    "=== INSIGHTS DAS PESQUISAS COM ALUNAS (matéria-prima de dores, desejos e mitos; não cite números) ===",
    insights || "(sem insights)",
    "",
    "=== CARROSSÉIS RECENTES (não repita tema nem gancho) ===",
    recentes || "(nenhum ainda)",
  ].filter((x) => x !== "").join("\n");

  let tentativa = 0, problemas: string[] = [], slides: any[] = [], legenda = "", correcoes: string[] = [], duvidas: string[] = [], rawPrev = "";
  while (tentativa < 2) {
    const msg = tentativa === 0 ? user : [
      user, "", "=== SUA RESPOSTA ANTERIOR (fora das regras) ===", rawPrev.slice(0, 14000), "",
      "Ela tem estes problemas: " + problemas.join("; ") + ".",
      "Corrija TODOS e devolva o JSON completo de novo.",
    ].join("\n");
    // ~25 chaves por slide (inclusive as vazias) + pensamento adaptativo contam no max_tokens: escala com a quantidade.
    const { text, usage, stop_reason } = await ctx.anthropic(system, msg, Math.min(32000, 9000 + 1100 * (b.tipo === "unico" ? 1 : b.qtd)), { schema: SCHEMA_ROTEIRO, effort: "medium" });
    await ctx.log("ai:carrossel_roteiro", usage);
    rawPrev = text;
    const obj = extrairObjeto(text);
    if (!obj || !Array.isArray(obj.slides)) {
      problemas = [stop_reason === "max_tokens" ? "a resposta foi cortada" : stop_reason === "refusal" ? "a IA recusou o pedido" : "a resposta não é um JSON válido"];
      tentativa++; continue;
    }
    slides = obj.slides.map(normalizarSlide);
    legenda = String(obj.legenda || "").trim();
    correcoes = (obj.correcoes || []).map((x: any) => String(x)).filter(Boolean).slice(0, 12);
    duvidas = (obj.duvidas || []).map((x: any) => String(x)).filter(Boolean).slice(0, 8);
    problemas = validarRoteiro(slides, b);
    if (/—/.test(legenda)) problemas.push("a legenda tem travessão");
    if (!/#inglesparaadultos/i.test(legenda) || !/#tiadoingles/i.test(legenda)) problemas.push("a legenda tem que ter #inglesparaadultos e #tiadoingles");
    if (!problemas.length) break;
    tentativa++;
  }
  if (!slides.length) return { status: 502, body: { error: "A IA não devolveu o roteiro. Tente de novo.", detalhes: problemas } };
  // Mesmo fora de alguma regra, devolve o roteiro: a Tia edita no editor e os avisos mostram o que falta.
  return { status: 200, body: { configured: true, slides, legenda, correcoes, duvidas, pendencias: problemas } };
}

export async function carrosselReescrever(ctx: Ctx, body: Record<string, any>) {
  const erro = await exigirConteudo(ctx);
  if (erro) return { status: 403, body: { error: erro } };
  const instrucao = String(body.instrucao ?? "").trim().slice(0, 1200);
  const slide = body.slide && typeof body.slide === "object" ? normalizarSlide(body.slide) : null;
  if (!slide) return { status: 400, body: { error: "Envie o slide." } };
  if (!instrucao) return { status: 400, body: { error: "Escreva o que mudar no slide." } };
  const guia = await lerGuia(ctx.sbGuia);
  const vizinhos = Array.isArray(body.vizinhos) ? body.vizinhos.slice(0, 20).map((s: any, i: number) =>
    `${i + 1}. ${s?.modelo}: ${CAMPOS.map((c) => s?.[c]).filter(Boolean).join(" / ").slice(0, 220)}`).join("\n") : "";
  const system = [
    "Você revisa um slide de carrossel do Instagram da Tia do Inglês, nos modelos do Manual de carrosséis.",
    guia ? "=== MANUAL DE CARROSSÉIS ===\n" + guia : "",
    REGRAS_MARCA, CAMPOS_POR_MODELO, limitesTexto(),
    "Aplique a instrução sem quebrar nenhuma regra. Mantenha o modelo e a ideia do slide, salvo se a instrução pedir outra coisa. Devolva o slide completo.",
  ].filter(Boolean).join("\n\n");
  const user = [
    `TEMA DO CARROSSEL: ${String(body.tema ?? "").slice(0, 300)}`,
    vizinhos ? "=== SEQUÊNCIA ATUAL (contexto) ===\n" + vizinhos : "",
    `=== SLIDE ${Number(body.indice) + 1 || ""} ATUAL ===\n${JSON.stringify(slide)}`,
    `INSTRUÇÃO: ${instrucao}`,
  ].filter(Boolean).join("\n\n");
  const { text, usage } = await ctx.anthropic(system, user, 4000, { schema: SCHEMA_UM_SLIDE, effort: "low" });
  await ctx.log("ai:carrossel_reescrever", usage);
  const obj = extrairObjeto(text);
  if (!obj?.slide) return { status: 502, body: { error: "A IA não devolveu o slide. Tente de novo." } };
  const novo = normalizarSlide(obj.slide);
  const avisos: string[] = [];
  for (const [c, lim] of Object.entries(LIMITE)) if (String(novo[c] || "").length > lim) avisos.push(`O campo ${c} passou de ${lim} caracteres.`);
  return { status: 200, body: { configured: true, slide: novo, avisos } };
}
