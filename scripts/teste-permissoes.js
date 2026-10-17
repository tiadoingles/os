// Teste dos helpers de acesso por aba do app.js (rotaPermitida, rotaEntrada, navPara, temArea...).
// Não precisa de build nem de rede: extrai o bloco "const NAV = [" ... "// </permissoes>" do app.js
// e roda as verificações. Uso (precisa de Node):
//   node scripts/teste-permissoes.js
// Sem Node: no console do preview, fetch deste arquivo + new Function(...)(module) e
// module.exports.executar(textoDoAppJs). Sai com código 1 se algum caso falhar.
//
// A RLS do banco (app.tem_area) é a barreira real; estes testes cobrem a camada de interface
// (menu + guarda do Router + quem grava em cada tela).

function carregar(src) {
  const ini = src.indexOf("const NAV = [");
  const fim = src.indexOf("// </permissoes>");
  if (ini < 0 || fim < 0) throw new Error("bloco NAV/permissoes não encontrado no app.js");
  const corpo = src.slice(ini, fim);
  // eslint-disable-next-line no-new-func
  return new Function(corpo + "\nreturn { NAV, AREAS, NOME_AREA, ehAdmin, areasDe, temArea, rotuloAcesso, areaDaRota, rotaPermitida, rotaEntrada, navPara, podeEscreverRota, normalizarAcesso, regrasSenha, mensagemErroSenha, mensagemErroLogin };")();
}

function executar(src) {
  const m = carregar(src);
  const linhas = [];
  let total = 0;
  let falhas = 0;
  const confere = (desc, obtido, esperado) => {
    total++;
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    if (!ok) { falhas++; linhas.push("FALHOU: " + desc + " -> obtido " + JSON.stringify(obtido) + ", esperado " + JSON.stringify(esperado)); }
    return ok;
  };

  const equipe = (...areas) => ({ role: "equipe", areas });
  const ADM = { role: "admin", areas: [] };
  const TODAS = m.AREAS.slice();
  confere("7 abas na ordem do menu", TODAS, ["bc", "agenda", "pedagogico", "cs", "comercial", "financeiro", "conteudo"]);

  // rotas de cada aba (todas as do NAV) + rotas que não são de aba
  const rotasDaAba = {};
  for (const g of m.NAV) {
    rotasDaAba[g.id] = g.id === "bc"
      ? ["/base", "/secao/cs-suporte", "/secao/metodologia", "/doc/abc", "/novo", "/novo?secao=x"]
      : g.itens.map((it) => "/" + g.id + "/" + it.slug);
  }
  const rotasSoAdm = ["/", "", "/squad", "/farol", "/pedir-ia", "/ferramentas", "/admin", "/admin/usuarios", "/rota-inexistente"];
  const rotasInvalidas = ["/cs", "/cs/", "/cs/xyz", "/cs/faq/extra", "/CS/faq", "/cs/../base", "/secao", "/doc", "/base/extra", "/bc", "/bc/x", "/conteudo/instagram", "//cs//faq//x"];
  const todasRotas = [].concat(...Object.values(rotasDaAba));

  // --- ADM: tudo ---
  for (const r of [...todasRotas, ...rotasSoAdm, "/perfil"]) confere("adm " + r, m.rotaPermitida(ADM, r), true);
  confere("adm entrada", m.rotaEntrada(ADM), "/");
  confere("adm nav = 7 grupos", m.navPara(ADM).map((g) => g.id), TODAS);
  confere("adm rótulo", m.rotuloAcesso(ADM), "ADM");
  for (const a of TODAS) confere("adm temArea " + a, m.temArea(ADM, a), true);
  for (const r of [...todasRotas, "/admin", "/farol", "/ferramentas"]) confere("adm escreve " + r, m.podeEscreverRota(ADM, r), true);

  // --- cada aba sozinha: só as rotas dela + /perfil ---
  for (const a of TODAS) {
    const u = equipe(a);
    for (const g of TODAS) for (const r of rotasDaAba[g]) confere(a + " " + r, m.rotaPermitida(u, r), g === a);
    for (const r of rotasSoAdm) confere(a + " " + r, m.rotaPermitida(u, r), false);
    for (const r of rotasInvalidas) confere(a + " inválida " + r, m.rotaPermitida(u, r), false);
    confere(a + " /perfil", m.rotaPermitida(u, "/perfil"), true);
    confere(a + " nav", m.navPara(u).map((g) => g.id), [a]);
    for (const g of TODAS) for (const r of rotasDaAba[g]) confere(a + " escreve " + r, m.podeEscreverRota(u, r), g === a);
    for (const r of ["/admin", "/farol", "/ferramentas", "/", "/squad"]) confere(a + " escreve " + r, m.podeEscreverRota(u, r), false);
    const ent = m.rotaEntrada(u);
    confere(a + " entrada permitida", m.rotaPermitida(u, ent), true);
  }
  confere("entrada bc", m.rotaEntrada(equipe("bc")), "/base");
  confere("entrada cs", m.rotaEntrada(equipe("cs")), "/cs/faq");
  confere("entrada conteudo", m.rotaEntrada(equipe("conteudo")), "/conteudo/metricas");
  confere("entrada agenda", m.rotaEntrada(equipe("agenda")), "/agenda/calendario");

  // --- combinação cs + pedagogico ---
  const cp = equipe("cs", "pedagogico");
  confere("cs+ped nav na ordem do menu", m.navPara(cp).map((g) => g.id), ["pedagogico", "cs"]);
  confere("cs+ped entrada = 1ª aba do menu", m.rotaEntrada(cp), "/pedagogico/aulas-praticas");
  confere("cs+ped vê cs", m.rotaPermitida(cp, "/cs/metas"), true);
  confere("cs+ped vê pedagógico", m.rotaPermitida(cp, "/pedagogico/gerador-materiais"), true);
  confere("cs+ped não vê conteúdo", m.rotaPermitida(cp, "/conteudo/linkedin"), false);
  confere("cs+ped não vê base", m.rotaPermitida(cp, "/secao/cs-suporte"), false);
  confere("cs+ped rótulo", m.rotuloAcesso(cp), "Pedagógico, CS / Suporte");
  confere("cs+ped áreas", m.areasDe(equipe("cs", "pedagogico", "cs")), ["pedagogico", "cs"]);

  // --- sem aba / perfil inválido: só /perfil, aviso no perfil ---
  const semAba = [equipe(), { role: "equipe" }, { role: "equipe", areas: null }, null, undefined, {},
    { role: "editor", areas: TODAS }, { role: "leitor" }, { role: "cs", areas: ["cs"] }, { role: "ADMIN" }, { role: "Admin" },
    { role: "__proto__" }, { role: "equipe", areas: ["farol", "admin", "__proto__"] }, { role: "equipe", areas: "cs" }];
  for (const u of semAba) {
    const nome = "sem acesso(" + JSON.stringify(u) + ")";
    for (const r of [...todasRotas, ...rotasSoAdm]) confere(nome + " " + r, m.rotaPermitida(u, r), false);
    confere(nome + " /perfil", m.rotaPermitida(u, "/perfil"), true);
    confere(nome + " entrada", m.rotaEntrada(u), "/perfil");
    confere(nome + " nav", m.navPara(u), []);
    confere(nome + " rótulo", m.rotuloAcesso(u), "Sem abas liberadas");
    for (const r of todasRotas) confere(nome + " escreve " + r, m.podeEscreverRota(u, r), false);
  }

  // --- subrotas declaradas no item do menu (Pesquisas de Alunos: mentorados / outros) ---
  const soCs = equipe("cs");
  for (const r of ["/cs/pesquisas/mentorados", "/cs/pesquisas/outros"]) {
    confere("cs " + r, m.rotaPermitida(soCs, r), true);
    confere("adm " + r, m.rotaPermitida(ADM, r), true);
    confere("conteudo " + r, m.rotaPermitida(equipe("conteudo"), r), false);
    confere("sem aba " + r, m.rotaPermitida(equipe(), r), false);
    confere("cs escreve " + r, m.podeEscreverRota(soCs, r), true);
  }
  for (const r of ["/cs/pesquisas/xyz", "/cs/pesquisas/mentorados/extra", "/cs/metas/mentorados", "/cs/faq/outros", "/conteudo/metricas/outros"])
    confere("cs subrota inválida " + r, m.rotaPermitida(soCs, r), false);

  // --- rota → aba ---
  confere("aba /base", m.areaDaRota("/base"), "bc");
  confere("aba /doc/x", m.areaDaRota("/doc/x"), "bc");
  confere("aba /cs/faq", m.areaDaRota("/cs/faq"), "cs");
  confere("aba /farol", m.areaDaRota("/farol"), null);
  confere("aba /admin", m.areaDaRota("/admin"), null);
  confere("aba /", m.areaDaRota("/"), null);

  // --- normalização do acesso (Administração) ---
  confere("acesso ADM zera abas", m.normalizarAcesso(true, ["cs"]), { admin: true, areas: [] });
  confere("acesso abas na ordem e sem lixo", m.normalizarAcesso(false, ["conteudo", "cs", "xyz", "cs"]), { admin: false, areas: ["cs", "conteudo"] });
  confere("acesso vazio", m.normalizarAcesso(false, null), { admin: false, areas: [] });

  // --- regras da senha nova (troca obrigatória e Meu perfil) ---
  const ok = (a, b) => m.regrasSenha(a, b).ok;
  confere("senha vazia", ok("", ""), false);
  confere("senha curta", ok("abc1234", "abc1234"), false);
  confere("senha só letras", ok("abcdefgh", "abcdefgh"), false);
  confere("senha só números", ok("12345678", "12345678"), false);
  confere("senha ok", ok("abcdefg1", "abcdefg1"), true);
  confere("senha ok com acento", ok("coração9", "coração9"), true);
  confere("confirmação diferente", ok("abcdefg1", "abcdefg2"), false);
  confere("itens da checklist", m.regrasSenha("a1", "").itens.map((i) => i.ok), [false, true, true, false]);
  confere("erro same_password", m.mensagemErroSenha({ code: "same_password" }), "A senha nova precisa ser diferente da senha atual. Escolha outra.");
  confere("erro weak_password", m.mensagemErroSenha({ code: "weak_password" }), "Essa senha não foi aceita por ser fraca. Use pelo menos 8 caracteres, com letras e números.");
  confere("erro sessão", m.mensagemErroSenha({ message: "Auth session missing!" }), "Sua sessão expirou. Saia e entre de novo para trocar a senha.");
  confere("erro genérico senha", m.mensagemErroSenha(null), "Não foi possível trocar a senha agora. Tente de novo em instantes.");

  // --- mensagens de erro do login ---
  confere("erro credenciais", m.mensagemErroLogin({ message: "Invalid login credentials", status: 400 }), "E-mail ou senha incorretos. Confira os dados e tente de novo.");
  confere("erro limite", m.mensagemErroLogin({ message: "x", status: 429 }), "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.");
  confere("erro vazio", m.mensagemErroLogin(null), "Não foi possível entrar agora. Tente de novo em instantes.");

  return { total, falhas, linhas, matriz: matriz(m) };
}

// Tabela acesso x rota para o relatório (legível a olho).
function matriz(m) {
  const rotas = ["/", "/base", "/agenda/calendario", "/pedagogico/gerador-materiais", "/cs/faq", "/conteudo/linkedin", "/financeiro/dre", "/admin", "/farol", "/perfil"];
  const quem = [["ADM", { role: "admin", areas: [] }], ["cs", { role: "equipe", areas: ["cs"] }], ["cs+ped", { role: "equipe", areas: ["cs", "pedagogico"] }],
    ["conteudo", { role: "equipe", areas: ["conteudo"] }], ["sem aba", { role: "equipe", areas: [] }]];
  const linhas = ["rota".padEnd(32) + quem.map(([n]) => n.padEnd(10)).join("")];
  for (const r of rotas) linhas.push(r.padEnd(32) + quem.map(([, u]) => (m.rotaPermitida(u, r) ? "sim" : "-").padEnd(10)).join(""));
  return linhas.join("\n");
}

if (typeof module !== "undefined" && typeof require !== "undefined" && require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const r = executar(src);
  console.log(r.matriz);
  console.log("");
  r.linhas.forEach((l) => console.log(l));
  console.log(r.falhas === 0 ? "OK: " + r.total + " verificações" : "FALHAS: " + r.falhas + " de " + r.total);
  process.exit(r.falhas === 0 ? 0 : 1);
}
if (typeof module !== "undefined") module.exports = { executar, carregar };
