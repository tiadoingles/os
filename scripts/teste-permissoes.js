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
  return new Function(corpo + "\nreturn { NAV, ROLE_LABEL, SLUGS_CS, PAPEIS_ADMIN, roleValido, rotuloRole, ehEditor, podeEscreverCS, podeMexerEstrutura, papelEfetivo, regrasSenha, mensagemErroSenha, rotaPermitida, rotaEntrada, navParaRole, mensagemErroLogin };")();
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

  // --- editor, leitor e ADM limitado: tudo, menos /admin ---
  for (const papel of ["editor", "leitor", "adm_limitado"]) {
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
  for (const papel of ["admin", "adm_limitado", "cs", "editor", "leitor", undefined, "xyz"]) {
    confere("entrada permitida " + String(papel), m.rotaPermitida(papel, m.rotaEntrada(papel)), true);
  }
  confere("entrada cs", m.rotaEntrada("cs"), "/cs/faq");
  confere("entrada admin", m.rotaEntrada("admin"), "/");
  confere("entrada editor", m.rotaEntrada("editor"), "/");
  confere("entrada leitor", m.rotaEntrada("leitor"), "/");
  confere("entrada adm_limitado", m.rotaEntrada("adm_limitado"), "/");

  // --- menu lateral ---
  confere("nav cs = só o grupo CS", m.navParaRole("cs").map((g) => g.id), ["cs"]);
  confere("nav admin = tudo", m.navParaRole("admin").length, m.NAV.length);
  confere("nav editor = tudo", m.navParaRole("editor").length, m.NAV.length);
  confere("nav leitor = tudo", m.navParaRole("leitor").length, m.NAV.length);
  confere("nav adm_limitado = tudo", m.navParaRole("adm_limitado").length, m.NAV.length);
  confere("nav cs tem todos os itens do grupo", m.navParaRole("cs")[0].itens.map((i) => i.slug), slugsCS);

  // --- escrita na interface ---
  // [ehEditor, podeEscreverCS, podeMexerEstrutura]
  const escrita = { admin: [true, true, true], adm_limitado: [true, true, false], editor: [true, true, true], cs: [false, true, false], leitor: [false, false, false], xyz: [false, false, false] };
  for (const papel of Object.keys(escrita)) {
    confere(papel + " ehEditor", m.ehEditor(papel), escrita[papel][0]);
    confere(papel + " podeEscreverCS", m.podeEscreverCS(papel), escrita[papel][1]);
    confere(papel + " podeMexerEstrutura", m.podeMexerEstrutura(papel), escrita[papel][2]);
  }

  // --- papel efetivo a partir da linha de profiles ---
  confere("efetivo admin", m.papelEfetivo({ role: "admin", acesso_limitado: false }), "admin");
  confere("efetivo editor", m.papelEfetivo({ role: "editor", acesso_limitado: false }), "editor");
  confere("efetivo editor sem coluna", m.papelEfetivo({ role: "editor" }), "editor");
  confere("efetivo limitado", m.papelEfetivo({ role: "editor", acesso_limitado: true }), "adm_limitado");
  confere("efetivo admin+limitado (inválido) sem privilégio", m.papelEfetivo({ role: "admin", acesso_limitado: true }), null);
  confere("efetivo cs", m.papelEfetivo({ role: "cs", acesso_limitado: false }), "cs");
  confere("efetivo nulo", m.papelEfetivo(null), null);
  confere("limitado não é admin na rota /admin", m.rotaPermitida(m.papelEfetivo({ role: "editor", acesso_limitado: true }), "/admin"), false);
  confere("papéis do formulário", m.PAPEIS_ADMIN.map((p) => p[0]), ["admin", "adm_limitado", "cs", "editor", "leitor"]);

  // --- regras da senha nova ---
  const ok = (a, b) => m.regrasSenha(a, b).ok;
  confere("senha vazia", ok("", ""), false);
  confere("senha curta", ok("abc1234", "abc1234"), false);
  confere("senha só letras", ok("abcdefgh", "abcdefgh"), false);
  confere("senha só números", ok("12345678", "12345678"), false);
  confere("senha ok", ok("abcdefg1", "abcdefg1"), true);
  confere("senha ok com acento", ok("coração9", "coração9"), true);
  confere("confirmação diferente", ok("abcdefg1", "abcdefg2"), false);
  confere("itens da checklist", m.regrasSenha("a1", "").itens.map((i) => i.ok), [false, true, true, false]);
  confere("erro same_password", m.mensagemErroSenha({ code: "same_password", message: "New password should be different from the old password." }), "A senha nova precisa ser diferente da senha atual. Escolha outra.");
  confere("erro same_password por texto", m.mensagemErroSenha({ message: "New password should be different from the old password." }), "A senha nova precisa ser diferente da senha atual. Escolha outra.");
  confere("erro weak_password", m.mensagemErroSenha({ code: "weak_password", message: "Password should be at least 8 characters." }), "Essa senha não foi aceita por ser fraca. Use pelo menos 8 caracteres, com letras e números.");
  confere("erro reauth", m.mensagemErroSenha({ code: "reauthentication_needed" }), "Por segurança, saia e entre de novo antes de trocar a senha.");
  confere("erro sessão", m.mensagemErroSenha({ message: "Auth session missing!" }), "Sua sessão expirou. Saia e entre de novo para trocar a senha.");
  confere("erro genérico senha", m.mensagemErroSenha(null), "Não foi possível trocar a senha agora. Tente de novo em instantes.");

  // --- rótulos ---
  confere("rótulo admin", m.rotuloRole("admin"), "ADM");
  confere("rótulo cs", m.rotuloRole("cs"), "CS");
  confere("rótulo editor", m.rotuloRole("editor"), "Editor");
  confere("rótulo leitor", m.rotuloRole("leitor"), "Leitor");
  confere("rótulo adm_limitado", m.rotuloRole("adm_limitado"), "ADM limitado");
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
  const papeis = ["admin", "adm_limitado", "cs", "editor", "leitor"];
  const linhas = ["rota".padEnd(22) + papeis.map((p) => p.padEnd(14)).join("")];
  for (const r of rotas) linhas.push(r.padEnd(22) + papeis.map((p) => (m.rotaPermitida(p, r) ? "sim" : "-").padEnd(14)).join(""));
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
