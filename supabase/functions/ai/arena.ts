// Gerador de Materiais das Arenas (Pedagógico > Gerador de Materiais), sob demanda.
// Ações: arena_gerar (1 material por chamada), arena_ajustar (aplica uma instrução livre a 1 material)
// e arena_regras_sugerir (transforma os ajustes de um pedido em regras gerais).
// Nada aqui grava em materiais_pedidos: o front recebe o material e grava com a sessão de quem pediu.
// Leitura com o cliente `sb` (JWT de quem chamou => RLS); no modo de teste, o cliente service_role.

type Anthropic = (system: string, user: string, maxTokens: number, opts?: { schema?: unknown; effort?: string }) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; stop_reason?: string }>;
type Log = (origem: string, usage: any) => Promise<void>;
type Ctx = { sb: any; uid: string | null; teste: boolean; anthropic: Anthropic; log: Log };

// ---------------- regras base (fallback se a tabela arena_regras não puder ser lida) ----------------
// Mesmo texto da semente origem='base' (scripts/migrations/20261016_arenas_previa_regras.sql).
export const REGRAS_BASE = [
  "Recém Chegados (RC): Reading Practice com cerca de 5 parágrafos curtos (3 a 4 linhas cada), em inglês simples e natural, cabendo inteiro em uma página. Simple Past ou Simple Present de preferência.",
  "RC: varie o narrador e o sujeito da história (I, we, he, she, they; personagens homens e mulheres). Não escreva sempre sobre uma mulher em terceira pessoa. Dentro do mesmo pedido, os materiais RC usam narradores diferentes.",
  "RC: alterne nomes, cenários, aberturas, acontecimentos e finais. Não termine sempre com projeção futura (\"Next week...\"): o final pode ser uma surpresa, uma solução, uma lição, uma frase engraçada ou um diálogo.",
  "RC: use diálogos curtos quando fizerem sentido, vocabulário comum e phrasal verbs sem forçar quantidade. A história não precisa ser sobre uma mulher brasileira 40+, mas a linguagem é sempre adulta e respeitosa.",
  "RC: pelo menos 2/3 dos itens do Glossary aparecem de fato no Reading Practice; o restante são itens úteis para o tema. O Glossary tem que ajudar a entender a leitura.",
  "RC: as 12 perguntas são simples e concretas, para iniciantes, ligadas à leitura E à vida das alunas (podem partir da história e trazer para a experiência delas).",
  "BIA (Básico, Intermediário e Avançado): 3 páginas (Capa, Glossary, Questions). Perguntas abertas, variadas e específicas do tema, que geram histórias, opiniões e conversas reais: situações concretas, dilemas leves, experiências, humor e opinião.",
  "BIA: no máximo 2 perguntas do tipo preferência (\"What is your favorite...\"), rotina (\"How do you usually...\") ou planos futuros por material. Não repita a mesma lógica de perguntas de um tema para outro.",
  "BIA: progressão de dificuldade nas perguntas 1-4 (fáceis), 5-8 (um pouco mais pessoais/descritivas) e 9-12 (mais reflexivas, ainda acessíveis). Perguntas de até ~15 palavras (até ~20 nas 9-12).",
  "Glossary: entre 15 e 25 itens (priorize 25), 3 colunas English | MYPA | Tradução, ordenados por relevância para o tema (não alfabética).",
  "MYPA: pronúncia aproximada com sons do português, em CAIXA ALTA entre barras /.../, seguindo as regras e o banco de exemplos da skill mypa. A mesma palavra tem sempre o mesmo MYPA.",
  "Questions: exatamente 12 perguntas, só em inglês, sem tradução, sem o prefixo \"Ask your classmate:\", e nenhuma pode ser respondida com sim ou não. Pelo menos 5 perspectivas diferentes (opinião, experiência passada, hipótese, contexto cultural/social, planos).",
  "Temas proibidos em qualquer parte do material: religião, sexo/intimidade, identidade de gênero, política, finanças pessoais detalhadas, saúde pessoal sensível e perguntar a idade de alguém. O tema \"Are We Too Old for That?\" é permitido só pelo lado dos costumes e expectativas da sociedade, nunca perguntando ou expondo a idade da aluna.",
  "Marca: zero emojis, nada de diminutivos ou linguagem infantil, tom acolhedor e adulto (amiga mais experiente), aplicação na vida real das alunas (princípio APR).",
  "Antes de entregar, compare com o histórico dos últimos materiais e com os outros materiais do mesmo pedido: não repita narrador, nomes de personagens, situação central, tipo de final nem perguntas.",
];

const METODO = [
  "=== MÉTODO TIA DO INGLÊS (resumo) ===",
  "- Público: mulheres brasileiras adultas (40+), que já tentaram aprender inglês e travam para falar. Tom da Tia: amiga mais experiente, acolhedora, adulta; nunca formal/acadêmico nem infantilizado.",
  "- Arena de Conversação: sessão ao vivo de prática oral em grupo. O material é um guia leve para estudar antes e usar durante a sessão (não é exercício formal).",
  "- APR (Aplicação Prática Real): vocabulário e perguntas que a aluna usa na vida real. Fator Afetivo: ambiente seguro, perguntas confortáveis de responder em voz alta, sem expor a aluna.",
  "- As perguntas são para as alunas conversarem entre si (não são interpretação de texto no BIA). Devem ser entendidas na primeira leitura.",
].join("\n");

const MYPA = [
  "=== MYPA (My Phonetic Alphabet) — pronúncia aproximada com sons do português do Brasil ===",
  "Formato: CAIXA ALTA, entre barras /.../, acentos marcam a sílaba tônica/qualidade da vogal. Prioridade: um brasileiro lendo em voz alta deve soar próximo do inglês.",
  "Regras: H inicial vira R (/RÁUS/ house, /RÉPI/ happy). W inicial vira U (/UÔRK/ work, /UÉL/ well). TH surdo = TH (/THÍNK/), TH sonoro = DH (/DHÃ/ the, /DHÉT/ that).",
  "T entre vogais (flap) vira R (/BÉRER/ better, /UÓRER/ water). CH/TCH = TCH (/TÍTCH/ teach). O longo = ÔU (/NÔU/, /ÔUPEN/). OO/U longo = Ú (/FÚD/). EE = Í (/PLÍZ/).",
  "AI/AY = ÁI (/FÁIN/, /TÁIM/). A curto = É (/FÉST/, /ÉFTER/). SH = SH (/FÍNISH/). J/DG = DJ (/DJÂST/, /NÓLIDJ/). R no meio/fim = R (/MÓRNIN/). -TION = CHEN/SHEN (/KUÉSTCHEN/).",
  "-ING = IN (/MÓRNIN/, /UÓKIN/). K mudo some (/NÔU/ know). To antes de verbo = TCHU. The = DHÃ (consoante) / DHI (vogal). Contrações: I'm /AIM/, don't /DÔUNT/, that's /DHÉTS/.",
  "Expressões: espaço entre os blocos das palavras (/GUD MÓRNIN/, /TÊIK KÉR ÓV/).",
  "Banco oficial (use exatamente estes quando aparecerem): Hello /RÉLÔU/ · Thank you /THÉNK IU/ · Please /PLÍZ/ · Friend /FRÉND/ · House /RÁUS/ · Work /UÔRK/ · Study /STÂDI/ · Understand /ÂNDERSTÉND/ · Speak /SPÍK/ · Listen /LÍSEN/ · Travel /TRÉVEL/ · Important /IMPÓRTANT/ · Different /DÍFRENT/ · Because /BICÓZ/ · Always /ÓUEIZ/ · Decide /DISÁID/ · Happen /RÉPEN/ · Believe /BILÍV/ · Remember /RIMÊMBER/ · Confidence /KÂNFIDENS/ · Learn /LÂRN/ · Think /THÍNK/ · Want /UÂNT/ · Need /NÍD/ · Try /TRAI/ · Start /STÁRT/ · Finish /FÍNISH/ · Open /ÔUPEN/ · Close /CLÔUZ/ · Easy /ÍZI/ · Hard /RÁRD/ · Better /BÉRER/ · Happy /RÉPI/ · Tired /TAIÊRD/ · Busy /BÍZI/ · Ready /RÉDI/ · Today /TUDÊI/ · Tomorrow /TUMÓROU/ · Yesterday /IÉSTERDEI/ · Now /NÁU/ · Later /LÊIRER/ · Before /BIFÓR/ · After /ÉFTER/ · Again /EGUÉN/ · Sometimes /SÂM TAIMS/ · Never /NÉVER/",
].join("\n");

// Exemplos aprovados pela Tia em 16/10/2026 (~/arenas-teste). Referência de QUALIDADE e de formato.
const EXEMPLO_RC = {
  tema: "When Plans Go Wrong",
  reading: [
    "My name is Daniel. Last Saturday was my wife's birthday, and I had a perfect plan. I booked a table at a nice Italian restaurant, I bought flowers, and I asked my brother to take care of our dog. Everything was ready. I felt very proud of myself.",
    "At six o'clock, we got in the car. After ten minutes, the car stopped in the middle of the street. I turned the key again and again, but nothing happened. \"Oh no,\" I said. \"Not today!\" My wife just looked at me and started to laugh.",
    "We called a taxi, but the app said thirty minutes. Then it started to rain. We waited at a small bus stop, wet and hungry. When we finally arrived at the restaurant, the waiter said, \"Sorry, sir. We gave your table to another couple.\"",
    "I wanted to disappear. We walked to a little pizza place around the corner. It was simple and noisy, but the pizza was hot and delicious. A man was playing the guitar, and everybody in the room sang \"Happy Birthday\" to my wife.",
    "On the way home, she held my hand and said, \"This was the best birthday in years.\" I didn't understand. My plan went wrong from start to finish. But now, when she tells this story to our friends, she always laughs the loudest.",
  ],
  glossary: [["Go Wrong", "/GÔU RÓNG/", "Dar Errado"], ["Book A Table", "/BUK Ã TÊIBOL/", "Reservar Uma Mesa"], ["Take Care Of", "/TÊIK KÉR ÓV/", "Cuidar De"], ["Proud", "/PRÁUD/", "Orgulhoso"], ["In The Middle Of", "/IN DHÃ MÍDOL ÓV/", "No Meio De"], ["Turn The Key", "/TÂRN DHÃ KÍ/", "Girar A Chave"], ["Laugh", "/LÉF/", "Rir"], ["Wet", "/UÉT/", "Molhado"], ["Hungry", "/RÂNGRI/", "Com Fome"], ["Waiter", "/UÊIRER/", "Garçom"], ["Around The Corner", "/ARÁUND DHÃ KÓRNER/", "Virando A Esquina"], ["On The Way Home", "/ÓN DHÃ UÊI RÔUM/", "No Caminho De Casa"], ["From Start To Finish", "/FRÂM STÁRT TCHU FÍNISH/", "Do Começo Ao Fim"], ["…", "…", "(até 25 itens)"]],
  questions: ["What was Daniel's plan for his wife's birthday?", "What went wrong first in the story?", "Why did Daniel's wife laugh in the car?", "What did they eat at the end of the night?", "What do you do when your car or your phone stops working?", "Who do you call when you have a problem on the street?", "What is the best birthday surprise you remember?", "How do you feel when a plan goes wrong?", "What is your Plan B for a rainy Saturday?", "In your opinion, why was this the best birthday for Daniel's wife?", "…(12 no total)"],
  variacao: { narrador: "I (Daniel, homem)", personagens: "Daniel, a esposa, o irmão", situacao: "jantar de aniversário dá tudo errado (carro, chuva, reserva perdida)", final: "virada afetiva e engraçada: a esposa adorou", angulos: "história, experiência própria, sentimento, plano B, opinião" },
};
const EXEMPLO_BIA = {
  tema: "When Plans Go Wrong",
  reading: [],
  glossary: [["Go Wrong", "/GÔU RÓNG/", "Dar Errado"], ["Plan B", "/PLÉN BÍ/", "Plano B"], ["Last-Minute", "/LÉST MÍNIT/", "De Última Hora"], ["Call Off", "/KÓL ÓF/", "Cancelar"], ["Fall Through", "/FÓL THRÚ/", "Não Dar Certo, Furar"], ["Run Late", "/RÂN LÊIT/", "Estar Atrasado"], ["Stuck In Traffic", "/STÂK IN TRÉFIK/", "Preso No Trânsito"], ["Go With The Flow", "/GÔU UIDH DHÃ FLÔU/", "Deixar Rolar"], ["Blessing In Disguise", "/BLÉSSIN IN DISGÁIZ/", "Males Que Vêm Para Bem"], ["Just In Case", "/DJÂST IN KÊIS/", "Só Por Garantia"], ["…", "…", "(até 25 itens)"]],
  questions: ["What is the most common reason for a plan to fall through in Brazil?", "Who is the person in your family who is always running late?", "Your restaurant reservation disappeared. What do you say to the manager?", "What is the funniest thing that ever went wrong at a party?", "Plan B or go with the flow: which one is more you, and why?", "Tell us about a small disaster that turned out to be a blessing in disguise.", "Which is worse: a last-minute cancellation or a friend who never arrives? Why?", "The weather forecast was wrong and your beach day is ruined. How do you make the best of it?", "…(12 no total)"],
  variacao: { narrador: "", personagens: "", situacao: "", final: "", angulos: "cultura brasileira, família, situação concreta, humor, dilema, opinião, hipótese" },
};

// Schema do structured output (output_config.format): o JSON volta sempre válido; as regras de conteúdo
// (contagens, sim/não etc.) são conferidas depois em validarMaterial.
const S = { type: "string" };
export const SCHEMA_MATERIAL = {
  type: "object", additionalProperties: false,
  required: ["tema", "reading", "glossary", "questions", "variacao"],
  properties: {
    tema: S,
    reading: { type: "array", items: S },
    glossary: { type: "array", items: { type: "object", additionalProperties: false, required: ["en", "mypa", "pt"], properties: { en: S, mypa: S, pt: S } } },
    questions: { type: "array", items: S },
    variacao: { type: "object", additionalProperties: false, required: ["narrador", "personagens", "situacao", "final", "angulos"],
      properties: { narrador: S, personagens: S, situacao: S, final: S, angulos: S } },
  },
};
const SCHEMA_REGRAS = {
  type: "object", additionalProperties: false, required: ["regras"],
  properties: { regras: { type: "array", items: { type: "object", additionalProperties: false, required: ["texto", "motivo"], properties: { texto: S, motivo: S } } } },
};
const exemploJSON = (e: any) => JSON.stringify({ ...e, glossary: e.glossary.map(([en, mypa, pt]: string[]) => ({ en, mypa, pt })) });

const FORMATO = [
  "Responda APENAS com um objeto JSON válido (sem markdown, sem texto antes ou depois), exatamente neste formato:",
  `{"tema":"<tema em inglês>","reading":["<parágrafo 1>","..."],"glossary":[{"en":"<English>","mypa":"/<MYPA>/","pt":"<Tradução>"},...],"questions":["<pergunta 1>",...],"variacao":{"narrador":"<I/we/he/she/they + quem>","personagens":"<nomes e papéis>","situacao":"<situação central em poucas palavras>","final":"<tipo de final>","angulos":"<ângulos das perguntas>"}}`,
  "- reading: só no Recém Chegados (4 a 6 parágrafos, ideal 5, cada um com 200 a 330 caracteres; total de 1.150 a 1.600 caracteres). No BIA e em \"Outro\": [] (lista vazia).",
  "- glossary: de 15 a 25 itens (priorize 25), cada item {en, mypa, pt}. MYPA em CAIXA ALTA entre barras. Tradução em português.",
  "- questions: exatamente 12 strings, só em inglês, sem número na frente, sem tradução.",
  "- variacao: preencha sempre (no BIA, narrador/personagens/final podem ficar vazios; angulos é obrigatório).",
  "- A história do RC tem que ser coerente do começo ao fim (personagens, relações, fatos e final).",
  "- Traduções sem diminutivo (nada de \"-inho/-inha\"); se a expressão for idiomática, explique entre parênteses.",
  "- Perguntas de experiência não pressupõem que a aluna viveu a situação (nada de \"Describe a time when the hotel lost your reservation\"); prefira hipóteses ou \"...or a story you heard\".",
  "- Nunca use emoji. Aspas dentro dos textos: use aspas duplas escapadas (\\\").",
].join("\n");

const ESTRUTURA = [
  "=== ESTRUTURA POR NÍVEL ===",
  "- Recém Chegados (RC, iniciantes absolutos): 4 páginas = Capa · Reading Practice · Glossary · Questions. O Reading Practice é uma HISTÓRIA curta e interessante (não um texto informativo), em inglês simples.",
  "- BIA (Básico, Intermediário e Avançado juntos): 3 páginas = Capa · Glossary · Questions. Sem Reading Practice. Glossary com expressões úteis do tema (phrasal verbs e chunks) e perguntas que nascem do tema e do Glossary, com progressão 1-4 / 5-8 / 9-12.",
  "- \"Outro: <descrição>\": estrutura do BIA (3 páginas), ajustando vocabulário e perguntas ao nível descrito.",
  "- Cada seção ocupa UMA página: Reading Practice curto o bastante para caber (cerca de 5 parágrafos de 3 a 4 linhas); perguntas curtas.",
].join("\n");

export function tipoNivel(nivel: string): "rc" | "bia" {
  return /rec[eé]m/i.test(String(nivel || "")) ? "rc" : "bia";
}

// ---------------- validação (schema + regras duras) ----------------
const EMOJI = /\p{Extended_Pictographic}/u;
const SIM_NAO = /^(do|does|did|is|are|was|were|have|has|had|can|could|will|would|should|shall|may|might|must|am|isn't|aren't|don't|doesn't|didn't|haven't|hasn't|won't|wouldn't|can't)\b/i;
export function ehSimNao(q: string): boolean {
  const s = String(q || "").trim();
  if (!SIM_NAO.test(s)) return false;
  if (/\bor\b/i.test(s)) return false; // alternativa ("... or ...?") pede escolha + justificativa
  if (/\?\s*(what|why|how|where|when|who|which|tell)\b/i.test(s)) return false; // pergunta de apoio aberta
  return true;
}
const STOP_EN = new Set(["the", "a", "an", "of", "to", "in", "on", "at", "for", "and", "or", "my", "your", "with", "up", "out", "off", "by", "as", "i", "it", "is"]);
function palavras(s: string) { return String(s || "").toLowerCase().replace(/[^a-z' -]/g, " ").split(/[\s-]+/).filter(Boolean); }
// Item do Glossary "aparece no texto" se cada palavra significativa dele aparece como início de alguma palavra do texto.
export function itemNoTexto(en: string, texto: string): boolean {
  const toks = palavras(texto);
  const sig = palavras(en).filter((w) => !STOP_EN.has(w));
  if (!sig.length) return false;
  return sig.every((w) => { const raiz = w.length > 4 ? w.slice(0, Math.max(4, w.length - 2)) : w; return toks.some((t) => t.startsWith(raiz)); });
}

export function normalizarMaterial(raw: any, base: { nivel: string; n: number; tema: string }, permitirTema = false) {
  const rc = tipoNivel(base.nivel) === "rc";
  const str = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
  const reading = rc && Array.isArray(raw?.reading) ? raw.reading.map(str).filter(Boolean) : [];
  const glossary = Array.isArray(raw?.glossary) ? raw.glossary.map((it: any) => {
    const a = Array.isArray(it) ? it : [it?.en ?? it?.english, it?.mypa, it?.pt ?? it?.traducao];
    let mypa = str(a[1]).toUpperCase().replace(/^\/+|\/+$/g, "").trim();
    mypa = mypa ? `/${mypa}/` : "";
    return [str(a[0]), mypa, str(a[2])];
  }).filter((x: string[]) => x[0] && !/^…|^\.\.\./.test(x[0])) : [];
  const questions = Array.isArray(raw?.questions) ? raw.questions.map((q: any) =>
    str(q).replace(/^\d+[.)]\s*/, "").replace(/^ask your classmate:\s*/i, "")).filter(Boolean) : [];
  const v = raw?.variacao && typeof raw.variacao === "object" ? raw.variacao : {};
  const variacao = { narrador: str(v.narrador), personagens: str(v.personagens), situacao: str(v.situacao), final: str(v.final), angulos: str(v.angulos) };
  const tema = permitirTema && str(raw?.tema) ? str(raw.tema).slice(0, 120) : base.tema;
  return { nivel: base.nivel, n: base.n, tema, reading, glossary, questions, variacao };
}

export function validarMaterial(m: any): string[] {
  const e: string[] = [];
  const rc = tipoNivel(m.nivel) === "rc";
  if (rc) {
    if (m.reading.length < 4 || m.reading.length > 6) e.push(`Reading Practice com ${m.reading.length} parágrafos (precisa de 4 a 6, ideal 5)`);
    const longos = m.reading.filter((p: string) => p.length > 420).length;
    if (longos) e.push(`${longos} parágrafo(s) longo(s) demais (máximo ~4 linhas, ~380 caracteres)`);
    const total = m.reading.join(" ").length;
    if (total > 1800) e.push(`Reading Practice com ${total} caracteres (não cabe numa página; máximo ~1.700)`);
    if (m.glossary.length) {
      const texto = m.reading.join(" ");
      const noTexto = m.glossary.filter((g: string[]) => itemNoTexto(g[0], texto)).length;
      if (noTexto < m.glossary.length / 2) e.push(`só ${noTexto} de ${m.glossary.length} itens do Glossary aparecem no texto (precisa de pelo menos 2/3)`);
    }
  }
  if (m.glossary.length < 15 || m.glossary.length > 25) e.push(`Glossary com ${m.glossary.length} itens (precisa de 15 a 25)`);
  const semMypa = m.glossary.filter((g: string[]) => !g[1] || !g[2]).length;
  if (semMypa) e.push(`${semMypa} item(ns) do Glossary sem MYPA ou sem tradução`);
  if (m.questions.length !== 12) e.push(`${m.questions.length} perguntas (precisa de exatamente 12)`);
  const simNao = m.questions.filter(ehSimNao);
  if (simNao.length) e.push(`perguntas de sim/não: ${simNao.map((q: string) => `"${q}"`).join("; ")}`);
  const tudo = [...m.reading, ...m.glossary.flat(), ...m.questions].join(" ");
  if (EMOJI.test(tudo)) e.push("tem emoji (proibido)");
  if (!m.variacao.angulos) e.push("variacao.angulos vazio");
  if (rc && !m.variacao.narrador) e.push("variacao.narrador vazio");
  return e;
}

function extrairObjeto(raw: string): any | null {
  const t = String(raw || "").replace(/^```[a-z]*\s*|\s*```$/gi, "");
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}

// ---------------- contexto ----------------
async function exigirEditor(ctx: Ctx): Promise<string | null> {
  if (ctx.teste) return null;
  // Acesso por aba: aba Pedagógico (ou ADM). O index.ts já confere antes; aqui é a segunda trava.
  const { data } = await ctx.sb.from("profiles").select("role, areas").eq("id", ctx.uid).maybeSingle();
  if (!data || !(data.role === "admin" || (Array.isArray(data.areas) && data.areas.includes("pedagogico"))))
    return "Só quem tem a aba Pedagógico pode gerar materiais das Arenas.";
  return null;
}

async function lerPedido(ctx: Ctx, id: string) {
  const { data, error } = await ctx.sb.from("materiais_pedidos")
    .select("id,tema,categoria,niveis,quantidade,briefing,conteudo,ajustes,status").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function lerRegras(ctx: Ctx): Promise<{ base: string[]; aprendidas: string[] }> {
  try {
    const { data, error } = await ctx.sb.from("arena_regras").select("texto,origem,ordem,created_at").eq("ativa", true)
      .order("origem").order("ordem").order("created_at");
    if (error || !data) throw error;
    const base = data.filter((r: any) => r.origem === "base").map((r: any) => r.texto);
    const aprendidas = data.filter((r: any) => r.origem === "aprendida").map((r: any) => r.texto);
    return { base: base.length ? base : REGRAS_BASE, aprendidas };
  } catch { return { base: REGRAS_BASE, aprendidas: [] }; }
}

async function lerHistorico(ctx: Ctx, excetoId: string) {
  const { data } = await ctx.sb.from("materiais_pedidos").select("id,tema,conteudo,processado_em")
    .eq("status", "pronto").neq("id", excetoId).order("processado_em", { ascending: false, nullsFirst: false }).limit(10);
  const itens: any[] = [];
  for (const p of data || []) for (const m of (Array.isArray(p.conteudo) ? p.conteudo : [])) if (m && m.variacao) itens.push(m);
  return itens;
}

function linhaVariacao(m: any) {
  const v = m.variacao || {};
  return `- ${m.nivel} · ${m.tema}: narrador=${v.narrador || "-"}; personagens=${v.personagens || "-"}; situação=${v.situacao || "-"}; final=${v.final || "-"}; ângulos=${v.angulos || "-"}`;
}

// Ordem de rodízio: os exemplos aprovados usam I e we, então a sugestão começa pelos outros.
const NARRADORES = ["they (duas ou mais pessoas)", "she (protagonista mulher)", "he (protagonista homem)", "we (grupo ou família)", "I (primeira pessoa)"];
function narradorSugerido(pedido: any, indice: number, historico: any[]): string | null {
  const conteudo = Array.isArray(pedido.conteudo) ? pedido.conteudo : [];
  const alvo = conteudo[indice];
  if (!alvo || tipoNivel(alvo.nivel) !== "rc") return null;
  const escolhido = String(pedido.briefing?.narrador || "").trim();
  if (escolhido && !/autom/i.test(escolhido)) return escolhido;
  const recentes = historico.filter((m) => tipoNivel(m.nivel) === "rc").slice(0, 4)
    .map((m) => String(m.variacao?.narrador || "").toLowerCase().split(/[\s(]/)[0]);
  const pool = [...NARRADORES.filter((n) => !recentes.includes(n.split(" ")[0])), ...NARRADORES.filter((n) => recentes.includes(n.split(" ")[0]))];
  const posRc = conteudo.slice(0, indice).filter((m: any) => tipoNivel(m.nivel) === "rc").length;
  return pool[posRc % pool.length];
}

function blocoBriefing(p: any): string {
  const b = p.briefing || {};
  const campos: [string, any][] = [
    ["Categoria", p.categoria],
    ["Objetivo da Arena (o que a aluna deve conseguir falar ao final)", b.objetivo],
    ["Situação real de uso", b.situacao],
    ["Vocabulário/expressões OBRIGATÓRIOS (têm que estar no Glossary e, no RC, na leitura)", b.vocabulario],
    ["Foco gramatical", b.foco_gramatical],
    ["Tom", b.tom],
    ["História do RC — personagens e cenário", b.personagens],
    ["Perguntas — ângulos desejados ou o que evitar", b.perguntas],
    ["Material de referência", b.referencia ? String(b.referencia).slice(0, 4000) : ""],
    ["Observações", b.observacoes],
  ];
  const linhas = campos.filter(([, v]) => v != null && String(v).trim()).map(([k, v]) => `- ${k}: ${String(v).trim()}`);
  return linhas.length ? linhas.join("\n") : "(sem campos extras: use o melhor julgamento para o tema)";
}

function systemPrompt(regras: { base: string[]; aprendidas: string[] }) {
  return [
    "Você é a redatora pedagógica do Método Tia do Inglês e cria os materiais das Arenas de Conversação (guias de prática oral para alunas brasileiras adultas).",
    "Escreve inglês 100% correto e natural (americano), simples na medida do nível, e português do Brasil impecável nas traduções.",
    "",
    METODO,
    "",
    ESTRUTURA,
    "",
    "=== REGRAS APROVADAS PELA TIA (obrigatórias) ===",
    ...regras.base.map((r, i) => `${i + 1}. ${r}`),
    regras.aprendidas.length ? "\n=== REGRAS APRENDIDAS COM OS AJUSTES DA TIA (obrigatórias; valem mais que as gerais em caso de conflito) ===" : "",
    ...regras.aprendidas.map((r, i) => `A${i + 1}. ${r}`),
    "",
    MYPA,
    "",
    "=== EXEMPLOS APROVADOS (referência de QUALIDADE e de FORMATO; NÃO copie tema, nomes, situação, frases nem perguntas) ===",
    "Recém Chegados: " + exemploJSON(EXEMPLO_RC),
    "BIA: " + exemploJSON(EXEMPLO_BIA),
    "",
    FORMATO,
  ].filter((x) => x !== "").join("\n");
}

// ---------------- chamada com 1 nova tentativa se vier fora do formato ----------------
async function gerarComValidacao(ctx: Ctx, origem: string, system: string, user: string, base: { nivel: string; n: number; tema: string }, permitirTema: boolean) {
  let tentativa = 0, ultimoErro: string[] = [], material: any = null, rawPrev = "";
  let usageTotal = { input_tokens: 0, output_tokens: 0 };
  while (tentativa < 2) {
    const msg = tentativa === 0 ? user : [
      user, "",
      "=== SUA RESPOSTA ANTERIOR (fora das regras) ===", rawPrev.slice(0, 12000), "",
      "Ela tem estes problemas: " + ultimoErro.join("; ") + ".",
      "Corrija TODOS os problemas e devolva o JSON completo de novo, no formato pedido.",
    ].join("\n");
    const { text, usage, stop_reason } = await ctx.anthropic(system, msg, 16000, { schema: SCHEMA_MATERIAL, effort: "medium" });
    usageTotal = { input_tokens: usageTotal.input_tokens + usage.input_tokens, output_tokens: usageTotal.output_tokens + usage.output_tokens };
    await ctx.log(origem, usage);
    rawPrev = text;
    const obj = extrairObjeto(text);
    if (!obj) { ultimoErro = [stop_reason === "max_tokens" ? "a resposta foi cortada (longa demais)" : stop_reason === "refusal" ? "a IA recusou o pedido" : "a resposta não é um JSON válido"]; tentativa++; continue; }
    material = normalizarMaterial(obj, base, permitirTema);
    ultimoErro = validarMaterial(material);
    if (!ultimoErro.length) return { ok: true, material, tentativas: tentativa + 1, usage: usageTotal };
    tentativa++;
  }
  return { ok: false, material, erros: ultimoErro, tentativas: tentativa, usage: usageTotal };
}

// ---------------- ações ----------------
export async function arenaGerar(ctx: Ctx, body: Record<string, any>) {
  const erroPapel = await exigirEditor(ctx);
  if (erroPapel) return { status: 403, body: { error: erroPapel } };
  const pedidoId = String(body.pedido_id ?? "").trim();
  const indice = Number(body.indice);
  if (!pedidoId || !Number.isInteger(indice) || indice < 0) return { status: 400, body: { error: "Envie pedido_id e indice do material." } };
  const pedido = await lerPedido(ctx, pedidoId);
  if (!pedido) return { status: 404, body: { error: "Pedido não encontrado." } };
  const conteudo = Array.isArray(pedido.conteudo) ? pedido.conteudo : [];
  const alvo = conteudo[indice];
  if (!alvo || !alvo.nivel) return { status: 400, body: { error: "Material fora do plano do pedido." } };
  const base = { nivel: String(alvo.nivel), n: Number(alvo.n) || 1, tema: String(alvo.tema || pedido.tema) };

  const [regras, historico] = await Promise.all([lerRegras(ctx), lerHistorico(ctx, pedidoId)]);
  const irmaos = conteudo.filter((m: any, i: number) => i !== indice && m && m.variacao && (m.questions || []).length);
  const narrador = narradorSugerido(pedido, indice, historico);
  const rc = tipoNivel(base.nivel) === "rc";
  const ultimasPerguntas = historico.filter((m) => tipoNivel(m.nivel) === tipoNivel(base.nivel)).slice(0, 4)
    .flatMap((m) => (m.questions || []).slice(0, 6)).map((q: string) => `- ${q}`).join("\n");

  const user = [
    `Crie o material ${base.n} do nível "${base.nivel}" (${rc ? "Recém Chegados: Reading Practice + Glossary + Questions" : "estrutura BIA: Glossary + Questions"}).`,
    `Tema: "${base.tema}" (tema do pedido: "${pedido.tema}").`,
    narrador ? `Narrador do Reading Practice: ${narrador}.` : "",
    "",
    "=== BRIEFING DO PEDIDO ===",
    blocoBriefing(pedido),
    "",
    "=== OUTROS MATERIAIS DESTE PEDIDO (não repita narrador, personagens, situação, final nem perguntas) ===",
    irmaos.length ? irmaos.map(linhaVariacao).join("\n") : "(nenhum pronto ainda)",
    "",
    "=== HISTÓRICO DOS ÚLTIMOS MATERIAIS (não repita narrador, nomes, situação central, tipo de final nem ângulos) ===",
    historico.length ? historico.slice(0, 20).map(linhaVariacao).join("\n") : "(ainda não há histórico)",
    ultimasPerguntas ? "\nÚltimas perguntas usadas neste nível (não repita nem reformule):\n" + ultimasPerguntas : "",
  ].filter((x) => x !== "").join("\n");

  const r = await gerarComValidacao(ctx, "ai:arena_gerar", systemPrompt(regras), user, base, false);
  if (!r.ok) return { status: 502, body: { error: "A IA devolveu o material fora das regras duas vezes: " + (r.erros || []).join("; ") + ". Tente de novo.", material: r.material } };
  return { status: 200, body: { configured: true, material: r.material, tentativas: r.tentativas, usage: r.usage, narrador_sugerido: narrador } };
}

export async function arenaAjustar(ctx: Ctx, body: Record<string, any>) {
  const erroPapel = await exigirEditor(ctx);
  if (erroPapel) return { status: 403, body: { error: erroPapel } };
  const pedidoId = String(body.pedido_id ?? "").trim();
  const indice = Number(body.indice);
  const instrucao = String(body.instrucao ?? "").trim().slice(0, 2000);
  if (!pedidoId || !Number.isInteger(indice) || indice < 0) return { status: 400, body: { error: "Envie pedido_id e indice do material." } };
  if (!instrucao) return { status: 400, body: { error: "Escreva o que você quer ajustar." } };
  const pedido = await lerPedido(ctx, pedidoId);
  if (!pedido) return { status: 404, body: { error: "Pedido não encontrado." } };
  const conteudo = Array.isArray(pedido.conteudo) ? pedido.conteudo : [];
  const salvo = conteudo[indice];
  if (!salvo || !salvo.nivel) return { status: 400, body: { error: "Material fora do plano do pedido." } };
  // Versão atual vinda do front (ainda não salva) tem prioridade sobre a do banco.
  const atual = body.material && typeof body.material === "object" ? body.material : salvo;
  const base = { nivel: String(salvo.nivel), n: Number(salvo.n) || 1, tema: String(atual.tema || salvo.tema || pedido.tema) };
  const regras = await lerRegras(ctx);
  const irmaos = conteudo.filter((m: any, i: number) => i !== indice && m && m.variacao && (m.questions || []).length);

  const system = systemPrompt(regras) + "\n\n" + [
    "=== TAREFA: AJUSTE ===",
    "Você recebe um material pronto e uma instrução da Tia. Aplique a instrução com cuidado e devolva o material COMPLETO no mesmo formato JSON.",
    "Mantenha tudo o que a instrução não pediu para mudar. Continue cumprindo todas as regras acima (se mudar o texto do RC, ajuste o Glossary e as perguntas que dependem dele).",
    "Releia o resultado inteiro e garanta coerência: personagens, relações entre eles, fatos e final têm que fazer sentido do começo ao fim.",
    "Atualize o campo variacao para refletir a versão nova.",
  ].join("\n");
  const user = [
    `Nível: ${base.nivel} · material ${base.n} · tema: ${base.tema}`,
    "",
    `INSTRUÇÃO DA TIA: ${instrucao}`,
    "",
    "=== MATERIAL ATUAL ===",
    JSON.stringify({ tema: atual.tema, reading: atual.reading || [], glossary: atual.glossary || [], questions: atual.questions || [], variacao: atual.variacao || {} }),
    irmaos.length ? "\n=== OUTROS MATERIAIS DESTE PEDIDO (não repita) ===\n" + irmaos.map(linhaVariacao).join("\n") : "",
  ].filter((x) => x !== "").join("\n");

  const r = await gerarComValidacao(ctx, "ai:arena_ajustar", system, user, base, true);
  if (!r.ok) return { status: 502, body: { error: "A IA devolveu o ajuste fora das regras duas vezes: " + (r.erros || []).join("; ") + ". Tente reformular a instrução.", material: r.material } };
  return { status: 200, body: { configured: true, material: r.material, tentativas: r.tentativas, usage: r.usage } };
}

export async function arenaRegrasSugerir(ctx: Ctx, body: Record<string, any>) {
  const erroPapel = await exigirEditor(ctx);
  if (erroPapel) return { status: 403, body: { error: erroPapel } };
  const pedidoId = String(body.pedido_id ?? "").trim();
  if (!pedidoId) return { status: 400, body: { error: "Envie pedido_id." } };
  const pedido = await lerPedido(ctx, pedidoId);
  if (!pedido) return { status: 404, body: { error: "Pedido não encontrado." } };
  const ajustes = (Array.isArray(pedido.ajustes) ? pedido.ajustes : []).map((a: any) => String(a?.instrucao || "").trim()).filter(Boolean);
  const unicos = [...new Set(ajustes)];
  if (!unicos.length) return { status: 200, body: { configured: true, regras: [] } };
  const regras = await lerRegras(ctx);

  const system = [
    "Você ajuda a Tia do Inglês a transformar os ajustes que ela pediu num material das Arenas de Conversação em REGRAS GERAIS para os próximos materiais.",
    "Regras gerais: valem para qualquer tema e qualquer material futuro. Nada de detalhes deste material (nomes de personagens, tema, frases específicas).",
    "Ignore ajustes pontuais que não fazem sentido como regra (ex.: \"troque o nome do personagem para João\"). Se nenhum ajuste virar regra, devolva lista vazia.",
    "Não repita regras que já existem (lista abaixo). Escreva cada regra em português do Brasil, em uma frase curta e direta (até 200 caracteres), no imperativo.",
    "Devolva de 0 a 5 regras.",
    "",
    "=== REGRAS QUE JÁ EXISTEM ===",
    ...[...regras.base, ...regras.aprendidas].map((r) => "- " + r),
    "",
    'Responda APENAS com JSON: {"regras":[{"texto":"<regra geral>","motivo":"<de qual ajuste veio, em poucas palavras>"}]}',
  ].join("\n");
  const user = "Ajustes pedidos pela Tia neste pedido (tema \"" + pedido.tema + "\"):\n" + unicos.map((a, i) => `${i + 1}. ${a}`).join("\n");

  const { text, usage } = await ctx.anthropic(system, user, 6000, { schema: SCHEMA_REGRAS, effort: "medium" });
  await ctx.log("ai:arena_regras", usage);
  const obj = extrairObjeto(text);
  const lista = Array.isArray(obj?.regras) ? obj.regras : null;
  if (!lista) return { status: 502, body: { error: "Não consegui interpretar a resposta da IA. Tente de novo." } };
  const out = lista.map((r: any) => ({ texto: String(r?.texto ?? r ?? "").replace(/\s+/g, " ").trim().slice(0, 600), motivo: String(r?.motivo ?? "").trim().slice(0, 200) }))
    .filter((r: any) => r.texto.length >= 3).slice(0, 5);
  return { status: 200, body: { configured: true, regras: out } };
}
