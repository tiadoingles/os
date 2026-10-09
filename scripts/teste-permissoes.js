// Teste dos helpers de papel/permissão do app.js (rotaPermitida, rotaEntrada, navParaRole...).
// Não precisa de build nem de rede: extrai o bloco "const NAV = [" ... "// </permissoes>" do app.js
// e roda as verificações. Uso (precisa de Node):
//   node scripts/teste-permissoes.js
// Sai com código 1 se algum caso falhar.
//
// A RLS do banco é a barreira real; estes testes cobrem a camada de interface (menu + guarda do Router).

function carregar(src) {
  const ini = src.indexOf("const NAV = [");
  const fim = src.indexOf("// </permissoes>");
  if (ini < 0 || fim < 0) throw new Error("bloco NAV/permissoes não encontrado no app.js");
  const corpo = src.slice(ini, fim);
  // eslint-disable-next-line no-new-func
  return new Function(corpo + "\nreturn { NAV, ROLE_LABEL, SLUGS_CS, roleValido, rotuloRole, ehEditor, podeEscreverCS, rotaPermitida, rotaEntrada, navParaRole, mensagemErroLogin };")();
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

  const slugsCS = m.NAV.find((g) => g.id === "cs").itens.map((i) => i.slug);
  const rotasCS = slugsCS.map((s) => "/cs/" + s);
  const rotasForaDoCS = [
    "/", "", "/base", "/secao/cs-suporte", "/secao/metodologia", "/doc/abc", "/novo", "/novo?secao=x",
    "/agenda/calendario", "/agenda/datas-importantes", "/pedagogico/aulas-praticas", "/pedagogico/materiais",
    "/comercial/vendas", "/comercial/dash-fad", "/financeiro/cobrancas", "/financeiro/dre", "/conteudo/metricas",
    "/squad", "/farol", "/pedir-ia", "/ferramentas", "/admin", "/admin/usuarios",
    "/cs", "/cs/", "/cs/xyz", "/cs/faq/extra", "/CS/faq", "/rota-inexistente", "/cs/../base", "//cs//faq//x",
  ];
  const rotasQuaseCS = { "/cs/faq": true, "/cs/faq?x=1": true, "/cs/diagnostico?id=123": true, "/cs/diagnostico?novo=1": true, "/perfil": true };

  // --- admin (ADM): tudo ---
  for (const r of [...rotasCS, ...rotasForaDoCS, "/perfil"]) confere("admin " + r, m.rotaPermitida("admin", r), true);

  // --- editor e leitor: tudo, menos /admin ---
  for (const papel of ["editor", "leitor"]) {
    for (const r of [...rotasCS, ...rotasForaDoCS, "/perfil"]) {
      const admin = r === "/admin" || r === "/admin/usuarios";
      confere(papel + " " + r, m.rotaPermitida(papel, r), !admin);
    }
  }

  // --- cs: somente os itens do grupo CS / Suporte e o próprio perfil ---
  for (const r of rotasCS) confere("cs " + r, m.rotaPermitida("cs", r), true);
  for (const r of Object.keys(rotasQuaseCS)) confere("cs " + r, m.rotaPermitida("cs", r), rotasQuaseCS[r]);
  for (const r of rotasForaDoCS) confere("cs " + r, m.rotaPermitida("cs", r), false);
  // nenhum item de nenhum outro grupo do NAV vira acessível ao cs
  for (const g of m.NAV) {
    if (g.id === "cs") continue;
    if (g.path) confere("cs " + g.path, m.rotaPermitida("cs", g.path), false);
    for (const it of g.itens || []) confere("cs /" + g.id + "/" + it.slug, m.rotaPermitida("cs", "/" + g.id + "/" + it.slug), false);
  }

  // --- papel desconhecido/ausente: nenhum privilégio (só /perfil) ---
  for (const papel of [undefined, null, "", "root", "ADMIN", "Admin", "cs ", "__proto__", "constructor", "toString", 0, {}]) {
    for (const r of [...rotasCS, ...rotasForaDoCS]) confere("desconhecido(" + String(papel) + ") " + r, m.rotaPermitida(papel, r), false);
    confere("desconhecido(" + String(papel) + ") /perfil", m.rotaPermitida(papel, "/perfil"), true);
    confere("desconhecido(" + String(papel) + ") rotaEntrada", m.rotaEntrada(papel), "/perfil");
    confere("desconhecido(" + String(papel) + ") nav", m.navParaRole(papel), []);
    confere("desconhecido(" + String(papel) + ") ehEditor", m.ehEditor(papel), false);
    confere("desconhecido(" + String(papel) + ") podeEscreverCS", m.podeEscreverCS(papel), false);
  }

  // --- rota de entrada: sempre permitida para o próprio papel (sem laço de redirecionamento) ---
  for (const papel of ["admin", "cs", "editor", "leitor", undefined, "xyz"]) {
    confere("entrada permitida " + String(papel), m.rotaPermitida(papel, m.rotaEntrada(papel)), true);
  }
  confere("entrada cs", m.rotaEntrada("cs"), "/cs/faq");
  confere("entrada admin", m.rotaEntrada("admin"), "/");
  confere("entrada editor", m.rotaEntrada("editor"), "/");
  confere("entrada leitor", m.rotaEntrada("leitor"), "/");

  // --- menu lateral ---
  confere("nav cs = só o grupo CS", m.navParaRole("cs").map((g) => g.id), ["cs"]);
  confere("nav admin = tudo", m.navParaRole("admin").length, m.NAV.length);
  confere("nav editor = tudo", m.navParaRole("editor").length, m.NAV.length);
  confere("nav leitor = tudo", m.navParaRole("leitor").length, m.NAV.length);
  confere("nav cs tem todos os itens do grupo", m.navParaRole("cs")[0].itens.map((i) => i.slug), slugsCS);

  // --- escrita na interface ---
  const escrita = { admin: [true, true], editor: [true, true], cs: [false, true], leitor: [false, false] };
  for (const papel of Object.keys(escrita)) {
    confere(papel + " ehEditor", m.ehEditor(papel), escrita[papel][0]);
    confere(papel + " podeEscreverCS", m.podeEscreverCS(papel), escrita[papel][1]);
  }

  // --- rótulos ---
  confere("rótulo admin", m.rotuloRole("admin"), "ADM");
  confere("rótulo cs", m.rotuloRole("cs"), "CS");
  confere("rótulo editor", m.rotuloRole("editor"), "Editor");
  confere("rótulo leitor", m.rotuloRole("leitor"), "Leitor");
  confere("rótulo desconhecido", m.rotuloRole("xyz"), "Sem papel");
  confere("rótulo __proto__", m.rotuloRole("__proto__"), "Sem papel");

  // --- mensagens de erro do login ---
  confere("erro credenciais", m.mensagemErroLogin({ message: "Invalid login credentials", status: 400 }), "E-mail ou senha incorretos. Confira os dados e tente de novo.");
  confere("erro não confirmado", m.mensagemErroLogin({ message: "Email not confirmed" }), "Esta conta ainda não foi ativada. Fale com o ADM.");
  confere("erro limite", m.mensagemErroLogin({ message: "x", status: 429 }), "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.");
  confere("erro rede", m.mensagemErroLogin({ message: "Failed to fetch" }), "Não foi possível conectar. Verifique sua internet e tente de novo.");
  confere("erro genérico", m.mensagemErroLogin({ message: "boom" }), "Não foi possível entrar agora. Tente de novo em instantes.");
  confere("erro vazio", m.mensagemErroLogin(null), "Não foi possível entrar agora. Tente de novo em instantes.");

  return { total, falhas, linhas, matriz: matriz(m) };
}

// Tabela papel x rota para o relatório (legível a olho).
function matriz(m) {
  const rotas = ["/", "/cs/faq", "/cs/metas", "/cs/nps", "/base", "/financeiro/dre", "/admin", "/squad", "/farol", "/rota-inexistente"];
  const papeis = ["admin", "cs", "editor", "leitor"];
  const linhas = ["rota".padEnd(22) + papeis.map((p) => p.padEnd(8)).join("")];
  for (const r of rotas) linhas.push(r.padEnd(22) + papeis.map((p) => (m.rotaPermitida(p, r) ? "sim" : "-").padEnd(8)).join(""));
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
