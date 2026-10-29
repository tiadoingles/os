// Conteúdo → Produtor de carrosséis (#/conteudo/carrosseis).
// Monta carrosséis/posts do Instagram nos modelos do "Manual de carrosséis" da O20 (out/2026) e exporta
// PNG 1080×1350 no navegador (html-to-image + JSZip, carregados só na hora de exportar).
// Fase 1: modelos + editor manual + exportação. Fase 2 (IA escreve o roteiro) e Fase 3 (fotos do Drive)
// entram depois — por enquanto a foto vem de upload local (data URL, sem problema de CORS no PNG).
// Marcação nos textos: *palavra* = destaque (grifo na capa, vermelho escuro no papel, turquesa no azul),
// _trecho_ = itálico (final da frase de virada), Enter = quebra de linha forçada.
import { html } from "htm/preact";
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "preact/hooks";

/* ============================ Dependências do app ============================ */
// Preenchido por app.js (configurarCarrosseis) antes do primeiro render: notify, errMsg, Btn, cx, inputCls, carregarJSZip.
const os = {};
export function configurarCarrosseis(deps) { Object.assign(os, deps); }

/* ============================ Tokens do manual (seções 2 e 3) ============================ */
export const CARROSSEL_TOKENS = {
  papel: "#F6F2EC",
  azul: "#123871",
  texto: "#2E3F5E",
  cinza: "#4A5B78",
  azulClaro: "#C9D3E6",
  vermelho: "#EA5167",
  vermelhoEsc: "#D63E57",
  turquesa: "#4DBDC6",
  balaoT: "#DDF1F2",
  balaoA: "#E3ECF7",
  linha: "#DCD4C8",
};
const T = CARROSSEL_TOKENS;
const W = 1080, H = 1350, MARGEM = 104;
const SANS = "'DM Sans', ui-sans-serif, system-ui, sans-serif";
const SERIF = "'DM Serif Display', Georgia, serif";
const FONTES_URL =
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400;1,700&family=DM+Serif+Display:ital@0;1&display=swap";

/* ============================ Modelos (seção 7) ============================ */
// campos: [chave, rótulo, tipo, dica]. Tipos: text | area | foto | bool | select:<a>,<b> .
const CAMPO_PONTE = ["ponte", "Frase de ponte (pé do slide)", "text", "Puxa para o próximo slide. Opcional."];
const CAMPOS_FOTO = [
  ["foto", "Foto", "foto"],
];
export const MODELOS = {
  capa: { nome: "Capa", fundo: "foto", campos: [
    ...CAMPOS_FOTO,
    ["headline", "Headline", "area", "86–90 px. Marque a palavra-chave do grifo com *asteriscos* (só uma)."],
    ["subtitulo", "Subtítulo", "text", "Opcional, 34 px."],
    ["posTexto", "Posição do texto", "select:baixo,cima"],
  ]},
  abertura: { nome: "Abertura azul", fundo: "azul", campos: [
    ["frase", "Frase (serifa)", "area", "Final em itálico turquesa com _sublinhados_."],
    ["apoio", "Texto de apoio", "area"],
    CAMPO_PONTE,
  ]},
  conteudo: { nome: "Conteúdo", fundo: "papel|azul", campos: [
    ["titulo", "Título", "area"],
    ["linha", "Linha vermelha sob o título", "bool"],
    ["texto", "Texto corrido", "area", "Linha em branco separa parágrafos. *destaque*."],
    CAMPO_PONTE,
  ]},
  item: { nome: "Item de lista", fundo: "papel|azul", campos: [
    ["numeral", "Numeral", "text", "01, 02…"],
    ["palavra", "Palavra/expressão (caixa alta)", "text", "Para listas de palavras. Deixe vazio se usar título em frase."],
    ["tituloFrase", "Título em frase (só 1ª maiúscula)", "area", "Para listas de comportamento/cultura."],
    ["errada", "Frase errada / o mico (itálico)", "area"],
    ["texto", "Consequência / explicação", "area"],
    ["rotulo", "Rótulo do balão", "text", "DIGA, PREFIRA, ANTES DE TUDO…"],
    ["balao", "Frase certa em inglês (balão)", "area"],
    ["efeito", "Frase de efeito (itálico serifado)", "area", "Fecha o item nas listas de cultura."],
    CAMPO_PONTE,
  ]},
  regra: { nome: "Regra / passo", fundo: "papel|azul", campos: [
    ["numeral", "Numeral", "text"],
    ["rotulo", "Rótulo", "text", "REGRA 1, PASSO 2…"],
    ["titulo", "Título", "area"],
    ["texto", "Explicação", "area"],
    ["exemplos", "Exemplos (um por linha)", "area", "A parte que muda vai entre *asteriscos* (vermelho escuro)."],
    CAMPO_PONTE,
  ]},
  passos: { nome: "Passo a passo em lista", fundo: "papel", campos: [
    ["titulo", "Título", "area"],
    ["itens", "Passos (um por linha)", "area"],
    CAMPO_PONTE,
  ]},
  resumo: { nome: "Resumo", fundo: "papel", campos: [
    ["titulo", "Título", "text"],
    ["itens", "Itens (um por linha: Rótulo | texto)", "area"],
    CAMPO_PONTE,
  ]},
  virada: { nome: "Virada", fundo: "azul", campos: [
    ["frase", "Frase de impacto", "area", "Final em itálico turquesa com _sublinhados_."],
    ["apoio", "Apoio (opcional)", "area"],
  ]},
  fotoFrase: { nome: "Foto e frase", fundo: "papel", campos: [
    ...CAMPOS_FOTO,
    ["frase", "Frase (serifa)", "area", "_itálico_ no final."],
    ["apoio", "Apoio", "area"],
    ["cta", "CTA (quando for o último slide)", "text", "Termina em \"clica no link da bio\"."],
  ]},
  finalFoto: { nome: "Final com foto cheia", fundo: "foto", campos: [
    ...CAMPOS_FOTO,
    ["texto", "Texto principal", "area"],
    ["cta", "CTA", "text", "Termina em \"clica no link da bio\"."],
    ["posTexto", "Posição do texto", "select:cima,meio,baixo"],
    ["alinhar", "Alinhamento", "select:centro,esquerda,direita"],
  ]},
  ctaComentario: { nome: "CTA de comentário", fundo: "azul", campos: [
    ["texto", "Texto acima", "area", "Ex.: Comenta"],
    ["palavra", "Palavra-chave", "text", "Sem acento se for gatilho de automação."],
    ["apoio", "Apoio", "area"],
  ]},
  conversa: { nome: "Conversa (fala de aluna)", fundo: "papel", campos: [
    ["titulo", "Título (opcional)", "area"],
    ["fala", "Fala da aluna", "area"],
    ["nome", "Nome", "text"],
    ["contexto", "Contexto", "text"],
  ]},
};
const MODELOS_COM_FOTO = new Set(["capa", "fotoFrase", "finalFoto"]);
const EH_FECHAMENTO = new Set(["finalFoto", "fotoFrase"]); // seção 10: o fechamento alterna entre os dois
const ehAzul = (s) => MODELOS[s.modelo].fundo === "azul" || (MODELOS[s.modelo].fundo === "papel|azul" && s.fundo === "azul");

/* ============================ Formatos (seção 8) e ritmo de cores (seção 6) ============================ */
export const FORMATOS = {
  lista: { nome: "Lista de palavras ou frases", min: 5, sugerido: 8 },
  cultura: { nome: "Lista de comportamentos / cultura", min: 5, sugerido: 8 },
  educativo: { nome: "Educativo / regras", min: 6, sugerido: 9 },
  storytelling: { nome: "Storytelling", min: 8, sugerido: 10 },
};
const MAX_SLIDES = 20; // limite do Instagram

const novo = (modelo, extra = {}) => ({ id: Math.random().toString(36).slice(2, 10), modelo, ...extra });
const num2 = (n) => String(n).padStart(2, "0");
const FINAL_PADRAO = { texto: "Quer aprender inglês comigo?", cta: "Clica no link da bio", posTexto: "baixo", alinhar: "centro" };

/** Esqueleto de N slides para o formato, já no ritmo de cores. */
export function montarEstrutura(formato, n) {
  const f = FORMATOS[formato];
  n = Math.max(f.min, Math.min(MAX_SLIDES, n | 0));
  const s = [novo("capa", { headline: "Headline do gancho com a *palavra* grifada", posTexto: "baixo" }),
    novo("abertura", { frase: "Frase que quebra a crença, _com o final em itálico._", apoio: "Texto de apoio curto." })];
  if (formato === "lista" || formato === "cultura") {
    const k = n - 4;
    for (let i = 1; i <= k; i++) {
      s.push(formato === "lista"
        ? novo("item", { numeral: num2(i), palavra: "Palavra", errada: "A frase que dá mico.", texto: "O que o americano entende.", rotulo: "DIGA", balao: "The right sentence." })
        : novo("item", { numeral: num2(i), tituloFrase: "Comportamento em frase", texto: "Por que isso soa diferente lá.", efeito: "_Frase de efeito que fecha o item._" }));
    }
    s.push(novo("virada", { frase: "O problema nunca foi você. _Foi o contexto._" }));
  } else if (formato === "educativo") {
    const k = n - 5;
    for (let i = 1; i <= k; i++) s.push(novo("regra", { numeral: num2(i), rotulo: `REGRA ${i}`, titulo: "Título da regra", texto: "Explicação curta.", exemplos: "work → work*ed*" }));
    s.push(novo("resumo", { titulo: "Resumo", linha: true, itens: Array.from({ length: k }, (_, i) => `Regra ${i + 1} | resumo`).join("\n") }));
    s.push(novo("virada", { frase: "Regra você já tem. _Agora é usar._" }));
  } else {
    const k = n - 7;
    for (let i = 1; i <= k; i++) s.push(novo("conteudo", { fundo: "papel", fixo: true, titulo: "Cena da história", texto: "O que aconteceu.\n\n_E aí, o que eu faço agora?_" }));
    s.push(novo("virada", { frase: "_Dá._" }));
    s.push(novo("passos", { titulo: "O que eu fiz", itens: "Primeiro passo\nSegundo passo\nTerceiro passo" }));
    s.push(novo("fotoFrase", { frase: "A conquista, _contada numa frase._", apoio: "Uma linha de apoio." }));
    s.push(novo("ctaComentario", { texto: "Comenta", palavra: "PALAVRA", apoio: "que eu te mando o material." }));
  }
  s.push(novo("finalFoto", { ...FINAL_PADRAO }));
  return aplicarRitmo(s);
}

/** Seção 6: capa · azul · papel… e azul de novo a cada 3 ou 4 slides de conteúdo · final com foto. */
// Slide com fixo=true (ex.: história no storytelling, que o manual pede no papel) não muda de cor.
// Nunca deixa dois azuis seguidos: se o próximo já é azul fixo (virada, CTA), este fica no papel.
export function aplicarRitmo(slides) {
  let desdeAzul = 0;
  return slides.map((sl, i) => {
    const m = MODELOS[sl.modelo];
    if (m.fundo === "azul") { desdeAzul = 0; return sl; }
    if (m.fundo !== "papel|azul" || sl.fixo) { if (m.fundo !== "foto" && !ehAzul(sl)) desdeAzul++; else if (ehAzul(sl)) desdeAzul = 0; return sl; }
    desdeAzul++;
    const prox = slides[i + 1];
    const proxAzul = prox && MODELOS[prox.modelo].fundo === "azul";
    if (desdeAzul >= 3 && !proxAzul) { desdeAzul = 0; return { ...sl, fundo: "azul" }; }
    return { ...sl, fundo: "papel" };
  });
}

/* ============================ Exemplos de referência (posts do histórico do manual: 21/10 Simple Past e 26/10 casa de um americano) ============================ */
const EXEMPLOS = {
  "simple-past": {
    tema: "Simple Past", formato: "educativo",
    slides: [
      novo("capa", { headline: "Explicando Simple Past como se você fosse minha sobrinha de *5 anos*", subtitulo: "o passado em inglês", posTexto: "baixo" }),
      novo("abertura", { frase: "O passado em inglês é _mais fácil que o português._", apoio: "Em português você conjuga: eu trabalhei, tu trabalhaste, ele trabalhou. Em inglês é worked pra todo mundo." }),
      novo("regra", { numeral: "01", rotulo: "REGRA 1", titulo: "Verbo regular ganha -ed", texto: "A maioria dos verbos só ganha um -ed no final, e pronto.", exemplos: "work → work*ed*\nplay → play*ed*\nwatch → watch*ed*" }),
      novo("regra", { numeral: "02", rotulo: "REGRA 2", titulo: "Os rebeldes pedem treino", texto: "Os irregulares mudam de forma. Esses você aprende usando.", exemplos: "go → *went*\nbuy → *bought*\nhave → *had*" }),
      novo("regra", { numeral: "03", rotulo: "REGRA 3", titulo: "Na pergunta, entra o did", texto: "E o verbo volta pro presente. O did já avisou que é passado.", exemplos: "*Did* you *go* to the party?\n*Did* she *work* yesterday?" }),
      novo("regra", { numeral: "04", rotulo: "REGRA 4", titulo: "Na negativa, didn't", texto: "Mesma lógica: o verbo volta pro presente.", exemplos: "I *didn't go*.\nShe *didn't work*." }),
      novo("resumo", { titulo: "Resumo", linha: true, itens: "Regular | ganha -ed\nIrregular | muda de forma\nPergunta | did + verbo no presente\nNegativa | didn't + verbo no presente" }),
      novo("virada", { frase: "Regra você já tem. _Agora é usar em voz alta._" }),
      novo("finalFoto", { ...FINAL_PADRAO }),
    ],
    legenda: "Simple Past em inglês sem complicação.\nO passado em 4 regras.\n\nQual dessas regras você esquecia?\n\n#inglesparaadultos #tiadoingles #simplepast #inglesonline",
  },
  "casa-americano": {
    tema: "Casa de um americano", formato: "cultura",
    slides: [
      novo("capa", { headline: "5 coisas que você faria na casa de um americano achando que está sendo *educada*", posTexto: "baixo" }),
      novo("abertura", { frase: "Carinho existe nos dois lugares. _Só as regras mudam._", apoio: "Aqui, carinho é chegar junto e insistir. Lá, é respeitar o espaço e o tempo do outro." }),
      novo("item", { numeral: "01", tituloFrase: "Chegar de mãos vazias", texto: "É muito comum levar um vinho ou uma sobremesa.", rotulo: "ANTES DE IR, PERGUNTE", balao: "Can I bring anything?", efeito: "_Chegar com algo é dizer obrigada antes._" }),
      novo("item", { numeral: "02", tituloFrase: "Dizer não esperando que insistam", texto: "Lá, um \"no, thanks\" é resposta final.", efeito: "_Respeitar o não também é carinho._" }),
      novo("item", { numeral: "03", tituloFrase: "Ir embora sem agradecer", rotulo: "NA SAÍDA, DIGA", balao: "Thank you for having me.", efeito: "_O agradecimento é a última impressão._" }),
      novo("item", { numeral: "04", tituloFrase: "Beijar no rosto quem acabou de conhecer", texto: "Um aperto de mão ou um sorriso já basta.", efeito: "_Espaço pessoal é sagrado._" }),
      novo("item", { numeral: "05", tituloFrase: "Esquecer de mandar mensagem no dia seguinte", texto: "Agradecer de novo é comum e deixa ótima impressão.", efeito: "_Gentileza também tem segundo tempo._" }),
      novo("virada", { frase: "O inglês de verdade vai _muito além do vocabulário._" }),
      novo("finalFoto", { ...FINAL_PADRAO }),
    ],
    legenda: "Etiqueta americana: o que fazer quando você é convidada para jantar na casa de um americano.\n\nQual dessas te pegou de surpresa?\n\n#inglesparaadultos #tiadoingles #etiquetaamericana #inglesparaviagem",
  },
};

/* ============================ Texto rico ============================ */
// *x* destaque, _x_ itálico, \n quebra. modo: "grifo" (capa) | "cor" (cor = destaque).
function Rico({ t, destaque = T.vermelhoEsc, italico, modo = "cor", serifItalico = false }) {
  if (!t) return null;
  const linhas = String(t).split("\n");
  return linhas.map((ln, li) => html`${li ? html`<br />` : null}${ln.split(/(\*[^*]+\*|_[^_]+_)/g).filter(Boolean).map((p) => {
    if (p.length > 2 && p[0] === "*" && p.at(-1) === "*") {
      const x = p.slice(1, -1);
      if (modo === "grifo") return html`<${Grifo}>${x}<//>`;
      return html`<span style=${{ color: destaque }}>${x}</span>`;
    }
    if (p.length > 2 && p[0] === "_" && p.at(-1) === "_")
      return html`<em style=${{ fontStyle: "italic", color: italico || "inherit", fontFamily: serifItalico ? SERIF : "inherit" }}>${p.slice(1, -1)}</em>`;
    return p;
  })}`);
}

/** Grifo vermelho feito à mão: traço levemente curvo sob a palavra-chave (só um por capa). */
function Grifo({ children }) {
  return html`<span style=${{ position: "relative", display: "inline-block", whiteSpace: "nowrap" }}>${children}<svg
    viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"
    style=${{ position: "absolute", left: "-3%", width: "106%", bottom: "-0.16em", height: "0.24em", overflow: "visible" }}>
    <path d="M2 8.5 C 22 4.5, 48 3.5, 70 5 S 92 7.5, 98 4.2" fill="none" stroke=${T.vermelho} stroke-width="9"
      stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg></span>`;
}

/** Fonte que encolhe (de 2 em 2 px) até caber na caixa [data-limite] mais próxima, sem passar do mínimo do manual. */
function Fit({ max, min, texto, style, children, tick }) {
  const ref = useRef(null);
  const chave = `${texto}|${max}|${min}|${tick}`;
  const [st, setSt] = useState({ k: chave, fs: max });
  const fs = st.k === chave ? st.fs : max;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const caixa = el.closest("[data-limite]") || el;
    const passa = caixa.scrollHeight > caixa.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (passa && fs > min) setSt({ k: chave, fs: Math.max(min, fs - 2) });
    else if (st.k !== chave) setSt({ k: chave, fs });
  });
  return html`<div ref=${ref} style=${{ ...style, fontSize: fs, overflowWrap: "normal" }}>${children}</div>`;
}

/* ============================ Peças de marca ============================ */
const Rotulo = ({ t, cor }) => t ? html`<div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 28, letterSpacing: "0.14em", textTransform: "uppercase", color: cor }}>${t}</div>` : null;
const LinhaVermelha = () => html`<div style=${{ width: 120, height: 5, background: T.vermelho, borderRadius: 3 }}></div>`;
const Numeral = ({ t, azul, size = 140 }) => t ? html`<div style=${{ fontFamily: SERIF, fontSize: size, lineHeight: 0.9, color: azul ? T.turquesa : T.vermelho }}>${t}</div>` : null;

/** Balão: retângulo bem arredondado com um canto quase reto (12 px), inspirado no símbolo do logo. */
const RAIO_BALAO = "44px 44px 44px 12px";
function Balao({ rotulo, t, cor = T.balaoT, azulFundo }) {
  if (!t) return null;
  return html`<div>
    ${rotulo ? html`<div style=${{ marginBottom: 16 }}><${Rotulo} t=${rotulo} cor=${azulFundo ? T.azulClaro : T.cinza} /></div>` : null}
    <div style=${{ background: cor, borderRadius: RAIO_BALAO, padding: "34px 44px" }}>
      <div style=${{ fontFamily: SERIF, fontStyle: "italic", fontSize: 54, lineHeight: 1.18, color: T.azul }}><${Rico} t=${t} destaque=${T.vermelhoEsc} /></div>
    </div>
  </div>`;
}

/** Marca d'água: símbolo em branco, bem grande, cortado no canto inferior direito, 3,5% (só nos slides azuis).
 * Enquanto não chega o arquivo do símbolo do logo, usa a forma do balão (que é derivada dele). */
const MarcaDagua = () => html`<div aria-hidden="true" style=${{ position: "absolute", right: -300, bottom: -320, width: 980, height: 980,
  background: "#fff", opacity: 0.035, borderRadius: "420px 420px 420px 60px", pointerEvents: "none" }}></div>`;

function Ponte({ t, azul }) {
  if (!t) return null;
  return html`<div style=${{ marginTop: "auto", paddingTop: 28, borderTop: `2px solid ${azul ? "rgba(255,255,255,.18)" : T.linha}`,
    fontFamily: SANS, fontWeight: 700, fontSize: 34, lineHeight: 1.3, color: azul ? "#fff" : T.azul }}><${Rico} t=${t} destaque=${azul ? T.turquesa : T.vermelhoEsc} /></div>`;
}

function Paragrafos({ t, azul, size = 38 }) {
  if (!t) return null;
  return String(t).split(/\n\s*\n/).map((p, i) => html`<p style=${{ margin: i ? "26px 0 0" : 0, fontFamily: SANS, fontSize: size, lineHeight: 1.45,
    color: azul ? T.azulClaro : T.texto }}><${Rico} t=${p.trim()} destaque=${azul ? T.turquesa : T.vermelhoEsc} italico=${azul ? T.turquesa : T.azul} serifItalico=${true} /></p>`);
}

/** Foto cheia (ou no quadro) com recorte, zoom e espelhamento. */
function Foto({ foto, aj = {}, w, h, raio = 0 }) {
  const box = { position: "absolute", inset: 0, width: w, height: h, overflow: "hidden", borderRadius: raio };
  if (!foto) return html`<div style=${{ ...box, background: "linear-gradient(160deg,#4A5B78,#2E3F5E)", display: "flex", alignItems: "center", justifyContent: "center",
    color: "rgba(255,255,255,.35)", fontFamily: SANS, fontSize: 40, fontWeight: 700 }}>Escolha a foto</div>`;
  const zoom = aj.zoom || 1;
  return html`<div style=${box}><img src=${foto.src} alt="" style=${{ width: "100%", height: "100%", objectFit: "cover",
    objectPosition: `${aj.x ?? 50}% ${aj.y ?? 50}%`, transform: `scale(${zoom})${aj.espelhar ? " scaleX(-1)" : ""}`,
    transformOrigin: `${aj.x ?? 50}% ${aj.y ?? 50}%`, display: "block" }} /></div>`;
}

/* ============================ Renderização dos slides ============================ */
// Bloco central: o conteúdo fica no meio da altura livre e a frase de ponte continua presa no pé.
const Centro = ({ children }) => html`<div style=${{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>${children}</div>`;
const corpoPadrao = (extra = {}) => ({ position: "absolute", inset: 0, padding: `120px ${MARGEM}px 104px`, display: "flex", flexDirection: "column", ...extra });

function SlideConteudo({ s, foto, tick }) {
  const azul = ehAzul(s);
  const corTitulo = azul ? "#fff" : T.azul;
  const destaque = azul ? T.turquesa : T.vermelhoEsc;
  switch (s.modelo) {
    case "capa": {
      const cima = s.posTexto === "cima";
      return html`
        <${Foto} foto=${foto} aj=${s.foto} w=${W} h=${H} />
        <div style=${{ position: "absolute", left: 0, right: 0, height: "62%", [cima ? "top" : "bottom"]: 0,
          background: `linear-gradient(${cima ? "180deg" : "0deg"}, rgba(10,18,36,.72) 0%, rgba(10,18,36,.38) 50%, rgba(10,18,36,0) 100%)` }}></div>
        <div data-limite style=${{ position: "absolute", left: 64, right: 64, [cima ? "top" : "bottom"]: cima ? 88 : 96, maxHeight: "56%",
          overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: cima ? "flex-start" : "flex-end", textAlign: "center", color: "#fff" }}>
          <${Fit} max=${90} min=${84} texto=${s.headline} tick=${tick}
            style=${{ fontFamily: SANS, fontWeight: 700, lineHeight: 1.12, textShadow: "0 2px 18px rgba(0,0,0,.35)", paddingBottom: 14 }}>
            <${Rico} t=${s.headline} modo="grifo" />
          <//>
          ${s.subtitulo ? html`<div style=${{ fontFamily: SANS, fontSize: 34, marginTop: 14, opacity: 0.94, textShadow: "0 1px 10px rgba(0,0,0,.4)" }}>${s.subtitulo}</div>` : null}
        </div>`;
    }
    case "abertura":
    case "virada":
      return html`
        <${MarcaDagua} />
        <div data-limite style=${corpoPadrao({ overflow: "hidden" })}>
          <${Centro}>
          <${Fit} max=${s.modelo === "virada" ? 104 : 92} min=${56} texto=${s.frase} tick=${tick}
            style=${{ fontFamily: SERIF, lineHeight: 1.1, color: "#fff" }}>
            <${Rico} t=${s.frase} italico=${T.turquesa} destaque=${T.turquesa} />
          <//>
          ${s.apoio ? html`<div style=${{ marginTop: 48 }}><${Paragrafos} t=${s.apoio} azul=${true} /></div>` : null}
          <//>
          <${Ponte} t=${s.ponte} azul=${true} />
        </div>`;
    case "conteudo":
      return html`
        ${azul ? html`<${MarcaDagua} />` : null}
        <div data-limite style=${corpoPadrao({ overflow: "hidden" })}>
          <${Centro}>
          <div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 62, lineHeight: 1.12, color: corTitulo }}><${Rico} t=${s.titulo} destaque=${destaque} /></div>
          ${s.linha ? html`<div style=${{ margin: "36px 0 0" }}><${LinhaVermelha} /></div>` : null}
          <div style=${{ marginTop: 44 }}><${Paragrafos} t=${s.texto} azul=${azul} /></div>
          <//>
          <${Ponte} t=${s.ponte} azul=${azul} />
        </div>`;
    case "item":
      return html`
        ${azul ? html`<${MarcaDagua} />` : null}
        <div data-limite style=${corpoPadrao({ overflow: "hidden", paddingTop: 110 })}>
          <${Centro}>
          <${Numeral} t=${s.numeral} azul=${azul} />
          <div style=${{ marginTop: 30 }}>
            ${s.palavra
              ? html`<${Fit} max=${84} min=${76} texto=${s.palavra} tick=${tick}
                  style=${{ fontFamily: SANS, fontWeight: 700, lineHeight: 1.05, textTransform: "uppercase", color: corTitulo, letterSpacing: "-0.01em" }}><${Rico} t=${s.palavra} destaque=${destaque} /><//>`
              : html`<div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 62, lineHeight: 1.12, color: corTitulo }}><${Rico} t=${s.tituloFrase} destaque=${destaque} /></div>`}
          </div>
          ${s.errada ? html`<div style=${{ marginTop: 30, fontFamily: SANS, fontStyle: "italic", fontSize: 40, lineHeight: 1.45, color: azul ? T.azulClaro : T.texto }}><${Rico} t=${s.errada} destaque=${destaque} /></div>` : null}
          ${s.texto ? html`<div style=${{ marginTop: 24 }}><${Paragrafos} t=${s.texto} azul=${azul} size=${36} /></div>` : null}
          ${s.balao ? html`<div style=${{ marginTop: 44 }}><${Balao} rotulo=${s.rotulo} t=${s.balao} azulFundo=${azul} /></div>` : null}
          ${s.efeito ? html`<div style=${{ marginTop: 40, fontFamily: SERIF, fontSize: 56, lineHeight: 1.15, color: azul ? "#fff" : T.azul }}><${Rico} t=${s.efeito} italico=${azul ? T.turquesa : T.azul} /></div>` : null}
          <//>
          <${Ponte} t=${s.ponte} azul=${azul} />
        </div>`;
    case "regra":
      return html`
        ${azul ? html`<${MarcaDagua} />` : null}
        <div data-limite style=${corpoPadrao({ overflow: "hidden", paddingTop: 110 })}>
          <${Centro}>
          <${Numeral} t=${s.numeral} azul=${azul} size=${130} />
          <div style=${{ marginTop: 28 }}><${Rotulo} t=${s.rotulo} cor=${azul ? T.azulClaro : T.cinza} /></div>
          <div style=${{ marginTop: 14, fontFamily: SANS, fontWeight: 700, fontSize: 62, lineHeight: 1.12, color: corTitulo }}><${Rico} t=${s.titulo} destaque=${destaque} /></div>
          ${s.texto ? html`<div style=${{ marginTop: 28 }}><${Paragrafos} t=${s.texto} azul=${azul} size=${36} /></div>` : null}
          ${s.exemplos ? html`<div style=${{ marginTop: 40, display: "flex", flexDirection: "column", gap: 18 }}>
            ${String(s.exemplos).split("\n").filter((l) => l.trim()).map((l) => html`<div style=${{ fontFamily: SANS, fontWeight: 500, fontSize: 48, lineHeight: 1.2,
              color: azul ? "#fff" : T.azul }}><${Rico} t=${l} destaque=${azul ? T.turquesa : T.vermelhoEsc} /></div>`)}
          </div>` : null}
          <//>
          <${Ponte} t=${s.ponte} azul=${azul} />
        </div>`;
    case "passos": {
      const itens = String(s.itens || "").split("\n").filter((l) => l.trim());
      return html`
        <div data-limite style=${corpoPadrao({ overflow: "hidden" })}>
          <${Centro}>
          <div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 60, lineHeight: 1.12, color: T.azul }}><${Rico} t=${s.titulo} /></div>
          <div style=${{ marginTop: 40 }}>
            ${itens.map((l, i) => html`<div style=${{ display: "flex", alignItems: "baseline", gap: 32, padding: "26px 0", borderTop: i ? `2px solid ${T.linha}` : "none" }}>
              <div style=${{ fontFamily: SERIF, fontSize: 72, lineHeight: 1, color: T.vermelho, width: 96, flexShrink: 0 }}>${num2(i + 1)}</div>
              <div style=${{ fontFamily: SANS, fontSize: 38, lineHeight: 1.45, color: T.texto }}><${Rico} t=${l} /></div>
            </div>`)}
          </div>
          <//>
          <${Ponte} t=${s.ponte} />
        </div>`;
    }
    case "resumo": {
      const itens = String(s.itens || "").split("\n").filter((l) => l.trim()).map((l) => l.split("|").map((x) => x.trim()));
      return html`
        <div data-limite style=${corpoPadrao({ overflow: "hidden" })}>
          <${Centro}>
          <div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 62, lineHeight: 1.12, color: T.azul }}>${s.titulo}</div>
          <div style=${{ margin: "36px 0 20px" }}><${LinhaVermelha} /></div>
          ${itens.map(([r, t], i) => html`<div style=${{ display: "flex", alignItems: "baseline", gap: 30, padding: "24px 0", borderTop: i ? `2px solid ${T.linha}` : "none" }}>
            <div style=${{ fontFamily: SERIF, fontSize: 64, lineHeight: 1, color: T.vermelho, width: 86, flexShrink: 0 }}>${num2(i + 1)}</div>
            <div style=${{ fontFamily: SANS, fontSize: 36, lineHeight: 1.45, color: T.texto }}>
              ${t !== undefined ? html`<strong style=${{ color: T.azul, fontWeight: 700 }}>${r}</strong> ${t}` : html`<${Rico} t=${r} />`}
            </div>
          </div>`)}
          <//>
          <${Ponte} t=${s.ponte} />
        </div>`;
    }
    case "fotoFrase":
      return html`
        <div style=${{ position: "absolute", left: MARGEM, top: MARGEM, width: 872, height: 640 }}><${Foto} foto=${foto} aj=${s.foto} w=${872} h=${640} raio=${32} /></div>
        <div data-limite style=${{ position: "absolute", left: MARGEM, right: MARGEM, top: MARGEM + 640 + 64, bottom: 96, overflow: "hidden" }}>
          <${Fit} max=${64} min=${56} texto=${s.frase} tick=${tick} style=${{ fontFamily: SERIF, lineHeight: 1.14, color: T.azul }}>
            <${Rico} t=${s.frase} italico=${T.azul} />
          <//>
          ${s.apoio ? html`<div style=${{ marginTop: 28 }}><${Paragrafos} t=${s.apoio} size=${36} /></div>` : null}
          ${s.cta ? html`<div style=${{ marginTop: 32, fontFamily: SANS, fontWeight: 700, fontSize: 38, color: T.azul }}>${s.cta}</div>` : null}
        </div>`;
    case "finalFoto": {
      const pos = s.posTexto || "baixo";
      const al = { centro: "center", esquerda: "left", direita: "right" }[s.alinhar || "centro"];
      const grad = pos === "cima" ? "180deg" : pos === "baixo" ? "0deg" : null;
      return html`
        <${Foto} foto=${foto} aj=${s.foto} w=${W} h=${H} />
        <div style=${{ position: "absolute", inset: 0, background: grad
          ? `linear-gradient(${grad}, rgba(10,18,36,.72) 0%, rgba(10,18,36,.3) 45%, rgba(10,18,36,0) 70%)`
          : "rgba(10,18,36,.32)" }}></div>
        ${s.cta && pos !== "baixo" ? html`<div style=${{ position: "absolute", left: 0, right: 0, bottom: 0, height: 320,
          background: "linear-gradient(0deg, rgba(10,18,36,.6) 0%, rgba(10,18,36,0) 100%)" }}></div>` : null}
        <div data-limite style=${{ position: "absolute", left: 72, right: 72, top: 88, bottom: 96, overflow: "hidden", display: "flex", flexDirection: "column",
          justifyContent: pos === "cima" ? "flex-start" : pos === "meio" ? "center" : "flex-end", textAlign: al, color: "#fff", textShadow: "0 2px 16px rgba(0,0,0,.4)" }}>
          <div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 72, lineHeight: 1.12, paddingBottom: pos === "baixo" ? 0 : 90 }}><${Rico} t=${s.texto} destaque=${T.turquesa} /></div>
          ${s.cta && pos === "baixo" ? html`<div style=${{ marginTop: 28, fontFamily: SANS, fontWeight: 700, fontSize: 42 }}>${s.cta}</div>` : null}
        </div>
        ${s.cta && pos !== "baixo" ? html`<div style=${{ position: "absolute", left: 72, right: 72, bottom: 96, textAlign: al, color: "#fff", fontFamily: SANS, fontWeight: 700,
          fontSize: 42, textShadow: "0 2px 16px rgba(0,0,0,.45)" }}>${s.cta}</div>` : null}`;
    }
    case "ctaComentario":
      return html`
        <${MarcaDagua} />
        <div data-limite style=${corpoPadrao({ justifyContent: "center", alignItems: "center", textAlign: "center", overflow: "hidden" })}>
          <div style=${{ fontFamily: SERIF, fontSize: 72, lineHeight: 1.1, color: "#fff" }}><${Rico} t=${s.texto} italico=${T.turquesa} /></div>
          <div style=${{ marginTop: 44, background: T.balaoT, borderRadius: RAIO_BALAO, padding: "40px 64px", maxWidth: "100%" }}>
            <${Fit} max=${112} min=${72} texto=${s.palavra} tick=${tick} style=${{ fontFamily: SANS, fontWeight: 700, lineHeight: 1, color: T.azul, letterSpacing: "0.02em", textTransform: "uppercase", whiteSpace: "nowrap" }}>${s.palavra}<//>
          </div>
          ${s.apoio ? html`<div style=${{ marginTop: 44, fontFamily: SANS, fontSize: 40, lineHeight: 1.45, color: T.azulClaro }}><${Rico} t=${s.apoio} destaque=${T.turquesa} /></div>` : null}
        </div>`;
    case "conversa":
      return html`
        <div data-limite style=${corpoPadrao({ justifyContent: "center", overflow: "hidden" })}>
          ${s.titulo ? html`<div style=${{ fontFamily: SANS, fontWeight: 700, fontSize: 60, lineHeight: 1.12, color: T.azul, marginBottom: 56 }}><${Rico} t=${s.titulo} /></div>` : null}
          <div style=${{ background: T.balaoA, borderRadius: RAIO_BALAO, padding: "44px 52px" }}>
            <div style=${{ fontFamily: SERIF, fontStyle: "italic", fontSize: 52, lineHeight: 1.22, color: T.azul }}><${Rico} t=${s.fala} /></div>
          </div>
          <div style=${{ marginTop: 32, fontFamily: SANS, fontWeight: 700, fontSize: 34, color: T.azul }}>${s.nome}</div>
          ${s.contexto ? html`<div style=${{ marginTop: 6, fontFamily: SANS, fontSize: 30, color: T.cinza }}>${s.contexto}</div>` : null}
        </div>`;
    default:
      return null;
  }
}

/** Um slide 1080×1350 no tamanho real (o pai escala para a prévia; a exportação usa este nó). */
function Slide({ s, foto, tick, idx }) {
  const fundo = MODELOS[s.modelo].fundo === "foto" ? "#1b2333" : ehAzul(s) ? T.azul : T.papel;
  // Estilos herdáveis zerados aqui: o html-to-image copia o estilo computado, e a miniatura fica dentro de um <button>.
  return html`<div data-slide=${idx} style=${{ position: "relative", width: W, height: H, overflow: "hidden", background: fundo, fontFamily: SANS,
    textAlign: "left", fontWeight: 400, fontSize: 36, lineHeight: 1.2, letterSpacing: "normal", color: T.texto, whiteSpace: "normal",
    fontFeatureSettings: "normal", fontVariationSettings: "normal",
    WebkitFontSmoothing: "antialiased" }}><${SlideConteudo} s=${s} foto=${foto} tick=${tick} /></div>`;
}

function Escala({ escala, children }) {
  return html`<div style=${{ width: W * escala, height: H * escala, overflow: "hidden", flexShrink: 0 }}>
    <div style=${{ transform: `scale(${escala})`, transformOrigin: "top left", width: W, height: H }}>${children}</div>
  </div>`;
}

/* ============================ Avisos (texto estourando, foto) ============================ */
function medirEstouro(raiz) {
  const fora = new Set();
  if (!raiz) return fora;
  raiz.querySelectorAll("[data-slide]").forEach((el) => {
    const idx = +el.getAttribute("data-slide");
    el.querySelectorAll("[data-limite]").forEach((c) => { if (c.scrollHeight > c.clientHeight + 2) fora.add(idx); });
  });
  return fora;
}

/** Quantos px reais da foto cobrem a largura do quadro depois do recorte/zoom (manual: ≥ 1080 úteis). */
function larguraUtil(foto, aj, w, h) {
  if (!foto || !foto.w) return null;
  const k = Math.max(w / foto.w, h / foto.h) * (aj?.zoom || 1); // px do slide por px da foto
  return Math.round(w / k);
}

function avisosDoSlide(s, fotos, estourou) {
  const a = [];
  if (estourou) a.push("O texto não cabe no tamanho mínimo do manual. Encurte o texto.");
  if (MODELOS_COM_FOTO.has(s.modelo)) {
    const f = s.foto && fotos[s.foto.id];
    if (!f) a.push("Falta escolher a foto.");
    else {
      const [w, h] = s.modelo === "fotoFrase" ? [872, 640] : [W, H];
      const util = larguraUtil(f, s.foto, w, h);
      if (util && util < w) a.push(`Foto com pouca resolução: ${util} px úteis para ${w} px de largura.`);
    }
  }
  if (s.modelo === "capa") {
    const n = (String(s.headline || "").match(/\*[^*]+\*/g) || []).length;
    if (n > 1) a.push("A capa tem mais de um grifo. O manual pede só um.");
  }
  return a;
}

/** Checklist das seções 9 e 10 que dá para conferir sem IA (campo a campo, para não juntar textos). */
const POR_EXTENSO = { duas: 2, dois: 2, "três": 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
function checklist(slides, briefing) {
  const a = [];
  const campos = slides.flatMap((s) => Object.entries(s).filter(([k, v]) => typeof v === "string" && !["id", "modelo", "fundo", "posTexto", "alinhar"].includes(k)).map(([, v]) => v));
  const todo = campos.join("\n");
  if (/\bebook\b/i.test(todo)) a.push("Escreva \"e-book\", não \"ebook\".");
  if (/\b(3[0-24-9]|[12]\d)\s*anos de (experi[eê]ncia|carreira|sala de aula|profiss)/i.test(todo)) a.push("Confira os anos de experiência: são 33 anos (desde outubro de 2026).");
  const idiomas = /(\S)\s+(Inglês|Português|Espanhol|Francês|Italiano|Alemão)\b/;
  campos.forEach((c) => c.split("\n").forEach((ln) => {
    const m = ln.match(idiomas);
    if (m && !/[.!?:]$/.test(m[1])) a.push(`Nome de idioma vai em minúscula no meio da frase ("${m[2].toLowerCase()}").`);
    if (/\?\s+[a-záéíóúâêôãõç]/.test(ln)) a.push("Depois de \"?\" a frase seguinte começa com maiúscula.");
  }));
  const nums = slides.filter((s) => s.modelo === "item" || s.modelo === "regra").map((s) => parseInt(s.numeral, 10)).filter((n) => !isNaN(n));
  nums.forEach((n, i) => { if (n !== i + 1) a.push(`A numeração pulou: o ${i + 1}º item está como ${num2(n)}.`); });
  const capa = slides.find((s) => s.modelo === "capa");
  const mCapa = capa && String(capa.headline || "").match(/^\s*(\d+)\s/);
  if (mCapa && nums.length && +mCapa[1] !== nums.length) a.push(`A capa diz ${mCapa[1]}, mas há ${nums.length} itens numerados.`);
  const regras = slides.filter((s) => s.modelo === "regra").length;
  const resumo = slides.find((s) => s.modelo === "resumo");
  if (resumo && regras) {
    const nRes = String(resumo.itens || "").split("\n").filter((l) => l.trim()).length;
    if (nRes !== regras) a.push(`O resumo tem ${nRes} itens, mas o carrossel tem ${regras} regras.`);
  }
  const total = nums.length || regras;
  if (total) {
    for (const m of todo.matchAll(/\b(\d+|duas|dois|três|quatro|cinco|seis|sete|oito|nove|dez)\s+(regras|itens|palavras|frases|coisas|dicas|passos)\b/gi)) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : POR_EXTENSO[m[1].toLowerCase()];
      if (n && n !== total) a.push(`O texto fala em "${m[0]}", mas o carrossel tem ${total}.`);
    }
  }
  slides.filter((s) => s.modelo === "ctaComentario").forEach((s) => {
    if (/[áàâãéêíóôõúç]/i.test(s.palavra || "")) a.push(`Palavra-chave "${s.palavra}" tem acento. Se for gatilho de automação, tire o acento.`);
  });
  const fech = slides.filter((s) => EH_FECHAMENTO.has(s.modelo) && s.cta);
  if (slides.length > 1 && !fech.some((s) => /clica no link da bio\.?\s*$/i.test(s.cta))) a.push("O CTA final deve terminar em \"clica no link da bio\".");
  if (briefing.youtube && !fech.some((s) => /link da legenda/i.test(s.cta))) a.push("Vai para o YouTube: falta a versão do último slide com \"clica no link da legenda\".");
  slides.filter((s) => s.modelo === "item" && s.tituloFrase && !s.palavra && !s.efeito && !s.balao).forEach((s) =>
    a.push(`Item ${s.numeral || ""}: nas listas de cultura cada item fecha com uma frase de efeito em itálico.`));
  return [...new Set(a)];
}

/* ============================ Exportação ============================ */
let _cssFontes = null;
/** CSS das fontes (só o subset latin) com os arquivos embutidos em data URL, para o PNG sair com DM Sans/Serif. */
async function cssFontesEmbutidas() {
  if (_cssFontes) return _cssFontes;
  const css = await (await fetch(FONTES_URL)).text();
  const blocos = [...css.matchAll(/\/\*\s*latin\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)].map((m) => m[1]);
  const paraDataUrl = async (u) => {
    const b = await (await fetch(u)).blob();
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
  };
  const out = [];
  for (const b of blocos) {
    const u = (b.match(/url\(([^)]+)\)/) || [])[1];
    out.push(u ? b.replace(u, await paraDataUrl(u.replace(/['"]/g, ""))) : b);
  }
  _cssFontes = out.join("\n");
  return _cssFontes;
}

const slug = (t) => String(t || "carrossel").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "carrossel";

function baixar(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function exportar(raiz, n, tema, onProgresso) {
  const { toBlob } = await import("html-to-image");
  await document.fonts.ready;
  const fontEmbedCSS = await cssFontesEmbutidas();
  const base = slug(tema);
  const arquivos = [];
  for (let i = 0; i < n; i++) {
    onProgresso && onProgresso(i + 1, n);
    const el = raiz.querySelector(`[data-slide="${i}"]`);
    const opts = { width: W, height: H, pixelRatio: 1, fontEmbedCSS, cacheBust: false, style: { transform: "none" } };
    if (!el) throw new Error("A sequência mudou durante a exportação. Exporte de novo.");
    if (i === 0) await toBlob(el, opts); // Safari/WebKit costuma perder a imagem (data URL) na primeira renderização
    const blob = await toBlob(el, opts);
    arquivos.push([`${base}-slide-${num2(i + 1)}.png`, blob]);
  }
  if (arquivos.length === 1) { baixar(arquivos[0][1], arquivos[0][0]); return; }
  const JSZip = await os.carregarJSZip(); // o mesmo carregador do Gerador de Materiais (cdnjs, 3.10.1)
  const zip = new JSZip();
  arquivos.forEach(([nome, b]) => zip.file(nome, b));
  baixar(await zip.generateAsync({ type: "blob" }), `${base}.zip`);
}

/* ============================ Rascunho local ============================ */
const CHAVE_RASCUNHO = "os.carrossel.rascunho";
// Rascunho de versão antiga: descarta slides de modelo que não existe mais e volta o formato para "lista".
function lerRascunho() {
  try {
    const d = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || "null");
    if (!d) return null;
    d.slides = (Array.isArray(d.slides) ? d.slides : []).filter((s) => s && MODELOS[s.modelo]);
    if (d.briefing && !FORMATOS[d.briefing.formato]) d.briefing.formato = "lista";
    if (d.briefing && !MODELOS[d.briefing.modeloUnico]) d.briefing.modeloUnico = "capa";
    return d;
  } catch { return null; }
}
function salvarRascunho(d) { try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(d)); } catch { /* sem storage */ } }

/* ============================ Página ============================ */
export function CarrosselPage() {
  const { Btn, cx, inputCls, notify, errMsg } = os;
  const r0 = useMemo(lerRascunho, []);
  const [briefing, setBriefing] = useState(r0?.briefing || { tema: "", formato: "lista", tipo: "carrossel", qtd: 8, youtube: false, modeloUnico: "capa" });
  const [slides, setSlides] = useState(r0?.slides || []);
  const [legenda, setLegenda] = useState(r0?.legenda || "");
  const [sel, setSel] = useState(0);
  const [fotos, setFotos] = useState({}); // id -> { src, w, h, nome } (só na memória; não vai pro rascunho)
  const [tick, setTick] = useState(0);
  const [estouro, setEstouro] = useState(new Set());
  const [exportando, setExportando] = useState(null);
  const galeria = useRef(null);

  useEffect(() => { document.fonts && document.fonts.ready.then(() => setTick((t) => t + 1)); }, []);
  useEffect(() => { salvarRascunho({ briefing, slides, legenda }); }, [briefing, slides, legenda]);
  useEffect(() => {
    const t = setTimeout(() => {
      const novo = medirEstouro(galeria.current);
      setEstouro((v) => (v.size === novo.size && [...novo].every((x) => v.has(x)) ? v : novo)); // só muda se mudou (senão re-renderiza sem fim)
    }, 180);
    return () => clearTimeout(t);
  });

  const setB = (k, v) => setBriefing((b) => ({ ...b, [k]: v }));
  const fmt = FORMATOS[briefing.formato];
  const atual = slides[sel];

  function montar() {
    if (slides.length && !confirm("Substituir os slides atuais pela estrutura nova?")) return;
    let s;
    if (briefing.tipo === "unico") s = [novo(briefing.modeloUnico, briefing.modeloUnico === "capa" ? { headline: "Headline com a *palavra* grifada" } : {})];
    else s = montarEstrutura(briefing.formato, briefing.qtd);
    if (briefing.youtube && briefing.tipo !== "unico") s = comVersaoYoutube(s);
    setSlides(s); setSel(0);
  }
  function carregarExemplo(k) {
    if (slides.length && !confirm("Substituir os slides atuais pelo exemplo?")) return;
    const ex = EXEMPLOS[k];
    setBriefing((b) => ({ ...b, tema: ex.tema, formato: ex.formato, tipo: "carrossel", qtd: ex.slides.length }));
    setSlides(aplicarRitmo(ex.slides.map((s) => ({ ...s, id: novo("x").id }))));
    setLegenda(ex.legenda); setSel(0);
  }
  function comVersaoYoutube(s) {
    const ult = s[s.length - 1];
    if (!ult || !EH_FECHAMENTO.has(ult.modelo)) return s;
    let cta = String(ult.cta || "").replace(/link da bio/i, "link da legenda");
    if (!/link da legenda/i.test(cta)) cta = "Clica no link da legenda";
    return [...s, { ...ult, id: novo("x").id, cta }];
  }

  const travado = !!exportando;
  const upd = (i, patch) => travado ? null : setSlides((arr) => arr.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const mover = (i, d) => travado ? null : setSlides((arr) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return arr;
    const n = [...arr]; [n[i], n[j]] = [n[j], n[i]]; setSel(j); return n;
  });
  const duplicar = (i) => { if (travado) return; if (slides.length >= MAX_SLIDES) return notify(`O Instagram aceita até ${MAX_SLIDES} imagens.`, "err"); setSlides((arr) => [...arr.slice(0, i + 1), { ...arr[i], id: novo("x").id }, ...arr.slice(i + 1)]); setSel(i + 1); };
  const remover = (i) => { if (travado) return; if (!confirm(`Excluir o slide ${i + 1}?`)) return; setSlides((arr) => arr.filter((_, j) => j !== i)); setSel((x) => Math.max(0, Math.min(x, slides.length - 2))); };
  const inserir = (modelo) => {
    if (travado) return;
    if (slides.length >= MAX_SLIDES) return notify(`O Instagram aceita até ${MAX_SLIDES} imagens.`, "err");
    const i = slides.length ? sel + 1 : 0;
    const extra = modelo === "finalFoto" ? { ...FINAL_PADRAO } : MODELOS[modelo].fundo === "papel|azul" ? { fundo: "papel" } : {};
    setSlides((arr) => [...arr.slice(0, i), novo(modelo, extra), ...arr.slice(i)]); setSel(i);
  };

  function escolherFoto(i, file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const id = novo("x").id;
        setFotos((f) => ({ ...f, [id]: { src: r.result, w: img.naturalWidth, h: img.naturalHeight, nome: file.name } }));
        upd(i, { foto: { id, x: 50, y: 40, zoom: 1, espelhar: false } });
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }

  async function onExportar() {
    if (!slides.length) return;
    const faltaFoto = slides.some((s) => MODELOS_COM_FOTO.has(s.modelo) && !(s.foto && fotos[s.foto.id]));
    if (faltaFoto && !confirm("Tem slide sem foto. Exportar mesmo assim?")) return;
    try {
      setExportando("0");
      await exportar(galeria.current, slides.length, briefing.tema, (a, n) => setExportando(`${a}/${n}`));
      notify(slides.length === 1 ? "PNG exportado." : `${slides.length} PNGs exportados no .zip.`, "ok");
    } catch (e) { notify(errMsg ? errMsg(e) : String(e), "err"); }
    finally { setExportando(null); }
  }

  const avisosCheck = checklist(slides, briefing);
  const avisosSel = atual ? avisosDoSlide(atual, fotos, estouro.has(sel)) : [];
  const Radio = ({ val, cur, set, children }) => html`
    <button type="button" onClick=${() => set(val)}
      class=${cx("rounded-lg border px-3 py-1.5 text-sm transition",
        cur === val ? "border-emerald-500 bg-brand-light font-medium text-brand-dark" : "border-line text-ink/70 hover:bg-black/[0.04]")}>
      ${children}
    </button>`;

  return html`
    <div>
      <div class="os-eyebrow">Conteúdo</div>
      <h1 class="mt-2 os-titulo text-2xl sm:text-[1.75rem]">Produtor de carrosséis</h1>
      <p class="mt-1 text-xs text-muted">Monta os slides nos modelos do Manual de carrosséis e exporta PNG 1080 × 1350. O roteiro com IA e o banco de fotos do Drive chegam nas próximas fases.</p>

      <div class="mt-5 rounded-[1.6rem] border border-line bg-card shadow-card p-5">
        <div class="grid gap-4 lg:grid-cols-[1fr_auto]">
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-muted">Tema</span>
            <input class=${cx(inputCls, "mt-1")} value=${briefing.tema} onInput=${(e) => setB("tema", e.target.value)} placeholder="Ex.: 5 palavras com duplo sentido" />
          </label>
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-muted">Tipo</div>
            <div class="mt-1 flex gap-2">
              <${Radio} val="carrossel" cur=${briefing.tipo} set=${(v) => setB("tipo", v)}>Carrossel<//>
              <${Radio} val="unico" cur=${briefing.tipo} set=${(v) => setB("tipo", v)}>Post único<//>
            </div>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          ${briefing.tipo === "carrossel" ? html`
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-muted">Formato</span>
              <select class=${cx(inputCls, "mt-1")} value=${briefing.formato}
                onChange=${(e) => { const f = e.target.value; setBriefing((b) => ({ ...b, formato: f, qtd: FORMATOS[f].sugerido })); }}>
                ${Object.entries(FORMATOS).map(([k, f]) => html`<option value=${k}>${f.nome}</option>`)}
              </select>
            </label>
            <label class="block w-32">
              <span class="text-xs font-medium uppercase tracking-wide text-muted">Nº de imagens</span>
              <input type="number" min=${fmt.min} max=${MAX_SLIDES} class=${cx(inputCls, "mt-1")} value=${briefing.qtd}
                onInput=${(e) => setB("qtd", +e.target.value)} />
            </label>
            <label class="flex items-center gap-2 pb-2 text-sm text-ink/80">
              <input type="checkbox" checked=${briefing.youtube} onChange=${(e) => setB("youtube", e.target.checked)} />
              Também vai para o YouTube (slide extra "link da legenda")
            </label>` : html`
            <label class="block">
              <span class="text-xs font-medium uppercase tracking-wide text-muted">Modelo</span>
              <select class=${cx(inputCls, "mt-1")} value=${briefing.modeloUnico} onChange=${(e) => setB("modeloUnico", e.target.value)}>
                ${Object.entries(MODELOS).map(([k, m]) => html`<option value=${k}>${m.nome}</option>`)}
              </select>
            </label>`}
          <${Btn} onClick=${montar}>Montar estrutura<//>
          <div class="flex items-center gap-2 pb-1 text-xs text-muted">
            Exemplos:
            <button type="button" class="underline hover:text-ink" onClick=${() => carregarExemplo("simple-past")}>Simple Past</button>
            <button type="button" class="underline hover:text-ink" onClick=${() => carregarExemplo("casa-americano")}>Casa de um americano</button>
          </div>
        </div>
        ${briefing.tipo === "carrossel" ? html`<p class="mt-2 text-xs text-muted">${fmt.nome}: mínimo ${fmt.min}, sugerido ${fmt.sugerido} imagens (até ${MAX_SLIDES}).</p>` : null}
      </div>

      ${!slides.length ? html`
        <div class="mt-6 rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-14 text-center text-sm text-muted">
          Escolha o formato e clique em <b>Montar estrutura</b>, ou abra um dos exemplos.
        </div>` : html`
        <div class="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm font-semibold text-ink">Slide ${sel + 1} de ${slides.length} · ${atual && MODELOS[atual.modelo].nome}</div>
              <div class="flex flex-wrap gap-1.5">
                <${Btn} variant="ghost" onClick=${() => mover(sel, -1)} disabled=${sel === 0}>←</${Btn}>
                <${Btn} variant="ghost" onClick=${() => mover(sel, 1)} disabled=${sel === slides.length - 1}>→<//>
                <${Btn} variant="ghost" onClick=${() => duplicar(sel)}>Duplicar<//>
                <${Btn} variant="danger" onClick=${() => remover(sel)}>Excluir<//>
              </div>
            </div>
            <div class="mt-3 flex justify-center rounded-[1.35rem] bg-slate-100 p-4">
              ${atual ? html`<${Escala} escala=${0.42}><${Slide} s=${atual} foto=${atual.foto && fotos[atual.foto.id]} tick=${tick} idx=${-1} /><//>` : null}
            </div>
            ${avisosSel.length ? html`<ul class="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              ${avisosSel.map((a) => html`<li class="flex gap-2"><span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"></span><span>${a}</span></li>`)}
            </ul>` : null}
          </div>

          <div class="rounded-[1.6rem] border border-line bg-card shadow-card p-5">
            ${atual ? html`<${EditorSlide} key=${atual.id} s=${atual} i=${sel} upd=${upd} fotos=${fotos} escolherFoto=${escolherFoto} />` : null}
          </div>
        </div>

        <div class="mt-7 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Sequência (${slides.length} ${slides.length === 1 ? "imagem" : "imagens"})</h2>
          <div class="flex flex-wrap items-center gap-2">
            <select class=${cx(inputCls, "w-auto")} value="" onChange=${(e) => { if (e.target.value) inserir(e.target.value); e.target.value = ""; }}>
              <option value="">+ Inserir slide depois do atual…</option>
              ${Object.entries(MODELOS).map(([k, m]) => html`<option value=${k}>${m.nome}</option>`)}
            </select>
            <${Btn} variant="ghost" onClick=${() => setSlides(aplicarRitmo)}>Reaplicar ritmo de cores<//>
            <${Btn} onClick=${onExportar} loading=${!!exportando}>${exportando ? `Exportando ${exportando}…` : slides.length === 1 ? "Exportar PNG" : "Exportar .zip"}<//>
          </div>
        </div>
        <div ref=${galeria} class="mt-3 flex gap-3 overflow-x-auto pb-3">
          ${slides.map((s, i) => html`
            <button type="button" key=${s.id} onClick=${() => setSel(i)}
              class=${cx("relative shrink-0 rounded-xl p-1 transition", i === sel ? "ring-2 ring-emerald-500" : "ring-1 ring-line hover:ring-slate-300")}>
              <${Escala} escala=${0.16}><${Slide} s=${s} foto=${s.foto && fotos[s.foto.id]} tick=${tick} idx=${i} /><//>
              <span class="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 text-[11px] font-bold text-white">${i + 1}</span>
              ${avisosDoSlide(s, fotos, estouro.has(i)).length ? html`<span class="absolute right-2 top-2 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-white" title="Tem aviso neste slide"></span>` : null}
            </button>`)}
        </div>

        <div class="mt-5 grid gap-5 lg:grid-cols-2">
          <div class="rounded-[1.6rem] border border-line bg-card shadow-card p-5">
            <div class="text-sm font-semibold text-ink">Checklist do roteiro (seção 9)</div>
            ${avisosCheck.length
              ? html`<ul class="mt-2 space-y-1 text-sm text-amber-900">${avisosCheck.map((a) => html`<li class="flex gap-2"><span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"></span><span>${a}</span></li>`)}</ul>`
              : html`<p class="mt-2 text-sm text-muted">Nada a corrigir nos pontos automáticos. Revise também concordância e o inglês dos exemplos.</p>`}
          </div>
          <div class="rounded-[1.6rem] border border-line bg-card shadow-card p-5">
            <div class="flex items-center justify-between">
              <div class="text-sm font-semibold text-ink">Legenda</div>
              <button type="button" class="text-xs text-muted underline hover:text-ink"
                onClick=${() => navigator.clipboard.writeText(legenda).then(() => notify("Legenda copiada.", "ok"), () => notify("O navegador não deixou copiar. Selecione o texto e copie à mão.", "err"))}>Copiar</button>
            </div>
            <textarea rows="7" class=${cx(inputCls, "mt-2")} value=${legenda} onInput=${(e) => setLegenda(e.target.value)}
              placeholder="1ª linha com a palavra-chave do tema. Uma frase por linha, sem travessão. 4 ou 5 hashtags, com #inglesparaadultos e #tiadoingles."></textarea>
          </div>
        </div>`}
    </div>`;
}

/* ============================ Editor do slide selecionado ============================ */
function EditorSlide({ s, i, upd, fotos, escolherFoto }) {
  const { cx, inputCls } = os;
  const m = MODELOS[s.modelo];
  const foto = s.foto && fotos[s.foto.id];
  const aj = s.foto || {};
  const setAj = (k, v) => upd(i, { foto: { ...aj, [k]: v } });
  return html`
    <div class="space-y-4">
      <label class="block">
        <span class="text-xs font-medium uppercase tracking-wide text-muted">Modelo</span>
        <select class=${cx(inputCls, "mt-1")} value=${s.modelo} onChange=${(e) => upd(i, { modelo: e.target.value, fundo: s.fundo || "papel" })}>
          ${Object.entries(MODELOS).map(([k, mm]) => html`<option value=${k}>${mm.nome}</option>`)}
        </select>
      </label>
      ${m.fundo === "papel|azul" ? html`
        <div>
          <div class="text-xs font-medium uppercase tracking-wide text-muted">Fundo</div>
          <div class="mt-1 flex gap-2">
            ${[["papel", "Papel", T.papel], ["azul", "Azul", T.azul]].map(([k, nome, cor]) => html`
              <button type="button" onClick=${() => upd(i, { fundo: k })}
                class=${cx("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", (s.fundo || "papel") === k ? "border-emerald-500 font-medium" : "border-line text-ink/70")}>
                <span class="inline-block h-4 w-4 rounded border border-black/10" style=${{ background: cor }}></span>${nome}
              </button>`)}
          </div>
        </div>` : null}
      ${m.campos.map(([k, rot, tipo, dica]) => {
        if (tipo === "foto") return html`
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-muted">${rot}</div>
            <input type="file" accept="image/*" class="mt-1 block w-full text-sm" onChange=${(e) => { escolherFoto(i, e.target.files[0]); e.target.value = ""; }} />
            ${foto ? html`
              <div class="mt-1 text-xs text-muted">${foto.nome} · ${foto.w} × ${foto.h} px</div>
              <div class="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>Horizontal</span><input type="range" min="0" max="100" value=${aj.x ?? 50} onInput=${(e) => setAj("x", +e.target.value)} />
                <span>Vertical</span><input type="range" min="0" max="100" value=${aj.y ?? 50} onInput=${(e) => setAj("y", +e.target.value)} />
                <span>Zoom</span><input type="range" min="1" max="2.5" step="0.05" value=${aj.zoom || 1} onInput=${(e) => setAj("zoom", +e.target.value)} />
              </div>
              <label class="mt-2 flex items-center gap-2 text-sm text-ink/80">
                <input type="checkbox" checked=${!!aj.espelhar} onChange=${(e) => setAj("espelhar", e.target.checked)} />
                Espelhar (selfie com texto ao contrário no fundo)
              </label>` : s.foto ? html`<div class="mt-1 text-xs text-amber-700">A foto não fica salva no rascunho. Escolha de novo.</div>` : null}
          </div>`;
        if (tipo === "bool") return html`
          <label class="flex items-center gap-2 text-sm text-ink/80">
            <input type="checkbox" checked=${!!s[k]} onChange=${(e) => upd(i, { [k]: e.target.checked })} /> ${rot}
          </label>`;
        if (tipo.startsWith("select:")) return html`
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-muted">${rot}</span>
            <select class=${cx(inputCls, "mt-1")} value=${s[k] || tipo.slice(7).split(",")[0]} onChange=${(e) => upd(i, { [k]: e.target.value })}>
              ${tipo.slice(7).split(",").map((o) => html`<option value=${o}>${o}</option>`)}
            </select>
          </label>`;
        return html`
          <label class="block">
            <span class="text-xs font-medium uppercase tracking-wide text-muted">${rot}</span>
            ${tipo === "area"
              ? html`<textarea rows="3" class=${cx(inputCls, "mt-1")} value=${s[k] || ""} onInput=${(e) => upd(i, { [k]: e.target.value })}></textarea>`
              : html`<input class=${cx(inputCls, "mt-1")} value=${s[k] || ""} onInput=${(e) => upd(i, { [k]: e.target.value })} />`}
            ${dica ? html`<span class="mt-1 block text-xs text-muted">${dica}</span>` : null}
          </label>`;
      })}
      <p class="text-xs text-muted">Marcação: <code>*palavra*</code> destaque · <code>_trecho_</code> itálico · Enter força a quebra de linha.</p>
    </div>`;
}
