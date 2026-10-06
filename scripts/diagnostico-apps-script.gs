/**
 * Diagnóstico do Mentorado — Apps Script (Web App) da Tia do Inglês — versão 2
 * ----------------------------------------------------------------------------
 * Recebe os dados do formulário "Diagnóstico do Mentorado" do Sistema
 * Operacional (via Edge Function `diagnostico-drive` do Supabase) e monta, do
 * zero, a planilha "<Nome completo> - DD/MM/AAAA" na pasta
 * "0.1 Diagnóstico Inicial [Marcela]", num layout próprio (não usa mais modelo).
 * Se o diagnóstico for concluído de novo, a aba do MESMO arquivo (fileId) é
 * apagada e reconstruída — inclusive arquivos antigos no layout da aba NOVO.
 * Abas criadas à mão no arquivo são mantidas; edições feitas na aba "Diagnóstico"
 * são substituídas pelo conteúdo do OS a cada atualização.
 *
 * Propriedade do script (Configurações do projeto → Propriedades do script):
 *   DIAG_TOKEN — segredo compartilhado com o Supabase (obrigatório).
 *   (MODELO_ID, da versão 1, não é mais usada e pode ser apagada.)
 *
 * Implantação: Implantar → Gerenciar implantações → lápis (editar) →
 * Versão: "Nova versão" → Implantar. Assim a URL /exec continua a mesma.
 * Configuração da implantação: App da Web, "Executar como: eu",
 * "Quem pode acessar: qualquer pessoa" (a proteção é o DIAG_TOKEN).
 *
 * NUNCA coloque o valor do DIAG_TOKEN neste arquivo — o repositório é público.
 */

var VERSAO = 2;
var PASTA_DIAGNOSTICOS_ID = '1_6Ckmc6aVAdE1rUOuIua3Se5b_DCm2Et'; // 0.1 Diagnóstico Inicial [Marcela]
var ABA = 'Diagnóstico';
var FUSO = 'America/Sao_Paulo';

// Paleta e tipografia
var COR = {
  marca: '#ea5167',
  marcaEscura: '#d13c53',
  marcaClara: '#fbe7e4',
  creme: '#f6f3ee',
  borda: '#e5ded3',
  texto: '#39352f',
  rotulo: '#6b6459',
  vazio: '#b3aca0',
  branco: '#ffffff',
};
var FONTE = 'Montserrat';

// Grade: A e G são margens; B:C rótulo 1, D valor 1, E rótulo 2, F valor 2.
var LARGURAS = { A: 20, B: 40, C: 170, D: 240, E: 190, F: 240, G: 20 };
var LARGURA_VALOR_LONGO = 670; // D:F em pixels (para estimar a altura de textos longos)

/* ============================== Web App ============================== */

function doGet() {
  return json_({ ok: true, servico: 'diagnostico-mentorado', versao: VERSAO });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  var token = PropertiesService.getScriptProperties().getProperty('DIAG_TOKEN');
  if (!token) return json_({ ok: false, error: 'DIAG_TOKEN não configurado nas Propriedades do script' });
  if (!body || body.token !== token) return json_({ ok: false, error: 'Token inválido' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: 'Outra planilha está sendo gerada. Tente de novo em instantes.' });
  try {
    var d = body.dados || {};
    var nome = String(d.nome || '').trim();
    if (!nome) return json_({ ok: false, error: 'Nome completo é obrigatório' });
    if (nome.length > 150) nome = nome.slice(0, 150);
    var dataDiag = parseData_(d.data_diagnostico);
    if (!dataDiag) return json_({ ok: false, error: 'Data do diagnóstico é obrigatória' });
    var nomeArquivo = nome + ' - ' + Utilities.formatDate(dataDiag, FUSO, 'dd/MM/yyyy');

    var ss = null;
    if (body.fileId) {
      var existente = null;
      try { existente = DriveApp.getFileById(String(body.fileId)); } catch (err) { existente = null; }
      if (existente && !existente.isTrashed()) {
        // Só reescreve planilhas da pasta de diagnósticos.
        if (existente.getMimeType() !== MimeType.GOOGLE_SHEETS || !naPastaDiagnosticos_(existente)) {
          return json_({ ok: false, error: 'O arquivo vinculado não é uma planilha da pasta de diagnósticos' });
        }
        ss = SpreadsheetApp.openById(existente.getId());
        existente.setName(nomeArquivo);
      } // apagado (lixeira) ou inexistente: cria outro
    }
    var criadoAgora = false;
    if (!ss) {
      ss = SpreadsheetApp.create(nomeArquivo);
      criadoAgora = true;
      DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(PASTA_DIAGNOSTICOS_ID));
    }
    try {
      construir_(ss, d, nome, dataDiag, criadoAgora);
    } catch (errConstrucao) {
      // Não deixa arquivo pela metade na pasta (a próxima tentativa criaria outro).
      if (criadoAgora) { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch (e2) { /* ignora */ } }
      throw errConstrucao;
    }
    SpreadsheetApp.flush();
    return json_({ ok: true, url: ss.getUrl(), fileId: ss.getId(), nome: nomeArquivo, versao: VERSAO });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function naPastaDiagnosticos_(file) {
  var pais = file.getParents();
  while (pais.hasNext()) { if (pais.next().getId() === PASTA_DIAGNOSTICOS_ID) return true; }
  return false;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================== Dados ============================== */

function txt_(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// "2026-10-06" → Date ao meio-dia (sem deslocar o dia por fuso).
function parseData_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  return null;
}

function data_(v) {
  var dt = parseData_(v);
  return dt ? Utilities.formatDate(dt, FUSO, 'dd/MM/yyyy') : txt_(v);
}

function lista_(v) {
  if (Array.isArray(v)) return v.map(txt_).filter(Boolean);
  var s = txt_(v);
  return s ? s.split(/\s*(?:,|\be\b)\s*/).filter(Boolean) : [];
}

function nota_(v) {
  var s = txt_(v);
  if (!s) return '';
  return s.replace('.', ',') + ' / 10';
}

// Aceita o formato novo (horario_pratica_lista, vac_predominante, metas[]) e o antigo.
function normalizar_(d) {
  var horarios = lista_(d.horario_pratica_lista || d.horario_pratica);
  var metas = [];
  if (Array.isArray(d.metas)) {
    d.metas.forEach(function (m) {
      if (m && (txt_(m.descricao) || txt_(m.data))) metas.push({ descricao: txt_(m.descricao), data: txt_(m.data) });
    });
  } else if (txt_(d.meta) || txt_(d.meta_data)) {
    metas.push({ descricao: txt_(d.meta), data: txt_(d.meta_data) });
  }
  return {
    horarios: horarios,
    vacPredominante: txt_(d.vac_predominante || d.vac),
    vacObservacoes: txt_(d.vac_observacoes || d.vac_obs),
    metas: metas,
  };
}

/* ============================== Layout ============================== */

function construir_(ss, d, nome, dataDiag, arquivoNovo) {
  ss.setSpreadsheetTimeZone(FUSO);
  try { ss.setSpreadsheetLocale('pt_BR'); } catch (err) { /* ignora */ }

  // Aba nova e limpa; depois remove só as abas geradas por este script (a "Diagnóstico"
  // anterior, a "NOVO" do layout antigo e restos "_novo_*"). Abas criadas à mão pela
  // equipe são mantidas. Num arquivo recém-criado, remove também a aba padrão vazia.
  var tmp = ss.insertSheet('_novo_' + new Date().getTime(), 0);
  ss.getSheets().forEach(function (s) {
    if (s.getSheetId() === tmp.getSheetId()) return;
    var n = s.getName();
    if (arquivoNovo || n === ABA || n === 'NOVO' || n.indexOf('_novo_') === 0) ss.deleteSheet(s);
  });
  tmp.setName(ABA);
  var sh = tmp;
  var n = normalizar_(d);

  sh.setHiddenGridlines(true);
  var colunas = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  colunas.forEach(function (c, i) { sh.setColumnWidth(i + 1, LARGURAS[c]); });

  var L = new Layout_(sh);

  // Cabeçalho
  L.espaco(14);
  L.titulo('Diagnóstico Inicial — Mentoria Fluent Mind');
  L.subtitulo(nome, 'Diagnóstico em ' + Utilities.formatDate(dataDiag, FUSO, 'dd/MM/yyyy'));
  L.espaco(16);

  // Datas
  var onboarding = data_(d.onboarding_data);
  if (txt_(d.onboarding_hora)) onboarding = (onboarding ? onboarding + ' às ' : '') + txt_(d.onboarding_hora).slice(0, 5);
  L.secao('Datas');
  L.par('Data de início', data_(d.data_inicio), 'Data do diagnóstico', data_(d.data_diagnostico));
  L.par('Call de onboarding', onboarding, 'Teste de nivelamento', txt_(d.nivelamento));
  L.espaco(14);

  // Dados pessoais
  L.secao('Dados pessoais');
  L.par('Nome completo', nome, 'Idade', txt_(d.idade));
  L.par('Email', txt_(d.email), 'Profissão', txt_(d.profissao));
  L.par('Horário Sessão Prática', n.horarios.join(' e '), '', null);
  L.espaco(14);

  // Objetivo & Dificuldades
  L.secao('Objetivo & Dificuldades');
  L.par('Objetivo', txt_(d.objetivo), '', null);
  L.longo('Objetivo em detalhes', txt_(d.objetivo_detalhe));
  L.longo('Dificuldades (o que mais frustrou antes)', txt_(d.dificuldades));
  L.espaco(14);

  // Notas & VAC
  L.secao('Notas & VAC');
  L.notas('Nota Speaking', nota_(d.nota_speaking), 'Nota Listening', nota_(d.nota_listening));
  L.par('VAC predominante', n.vacPredominante, '', null);
  L.longo('VAC observações', n.vacObservacoes);
  L.espaco(14);

  // Histórico
  L.secao('Histórico');
  L.longo('O que já fez antes (tempo e formato)', txt_(d.o_que_fez));
  L.espaco(14);

  // Trilha & Rotina
  L.secao('Trilha & Rotina');
  L.par('Trilha inicial', txt_(d.trilha), '', null);
  L.longo('Observação sobre a trilha', txt_(d.trilha_obs));
  L.espaco(8);
  L.tabelaCabecalho([['B', 'C', 'Atividade'], ['D', 'D', 'Frequência'], ['E', 'F', 'Detalhe']]);
  var nivel = txt_(d.arena_nivel);
  var rotina = [
    ['Trilha', txt_(d.rotina_trilha), ''],
    ['Arena de Conversação', txt_(d.rotina_arena), nivel ? 'Nível: ' + nivel : ''],
    ['Fluent Labs', txt_(d.rotina_labs), ''],
    ['Vídeo Semanal', txt_(d.rotina_video), ''],
    ['Sessão Prática', txt_(d.rotina_pratica), n.horarios.length ? 'Horário: ' + n.horarios.join(' e ') : ''],
  ];
  rotina.forEach(function (r, i) {
    L.tabelaLinha([['B', 'C', r[0], true], ['D', 'D', r[1]], ['E', 'F', r[2]]], i % 2 === 1);
  });
  L.espaco(14);

  // Metas
  L.secao('Metas');
  L.tabelaCabecalho([['B', 'B', '#'], ['C', 'E', 'Meta'], ['F', 'F', 'Data']]);
  if (!n.metas.length) {
    L.tabelaLinha([['B', 'F', 'Nenhuma meta registrada.']], false, true);
  } else {
    n.metas.forEach(function (m, i) {
      L.tabelaLinha([['B', 'B', String(i + 1), true, 'center'], ['C', 'E', m.descricao], ['F', 'F', data_(m.data), false, 'center']], i % 2 === 1);
    });
  }
  L.espaco(14);

  // Observações
  L.secao('Observações');
  L.textoLivre(txt_(d.observacoes));
  L.espaco(14);

  // Rodapé
  L.rodape('Gerado pelo Sistema Operacional da Tia do Inglês em ' +
    Utilities.formatDate(new Date(), FUSO, "dd/MM/yyyy 'às' HH:mm") + '.');

  // Remove linhas e colunas sobrando.
  var usadas = L.linha - 1;
  if (sh.getMaxRows() > usadas) sh.deleteRows(usadas + 1, sh.getMaxRows() - usadas);
  if (sh.getMaxColumns() > 7) sh.deleteColumns(8, sh.getMaxColumns() - 7);
  sh.setActiveSelection('A1');
}

function Layout_(sh) {
  this.sh = sh;
  this.linha = 1;
}

Layout_.prototype._garante = function () {
  if (this.sh.getMaxRows() < this.linha) this.sh.insertRowsAfter(this.sh.getMaxRows(), this.linha - this.sh.getMaxRows() + 20);
};

Layout_.prototype._r = function (c1, c2) {
  return this.sh.getRange(c1 + this.linha + ':' + c2 + this.linha);
};

Layout_.prototype._base = function (r) {
  return r.setFontFamily(FONTE).setFontSize(10).setFontColor(COR.texto).setVerticalAlignment('middle');
};

Layout_.prototype.espaco = function (px) {
  this._garante();
  this.sh.setRowHeight(this.linha, px);
  this.linha++;
};

Layout_.prototype.titulo = function (t) {
  this._garante();
  var r = this._r('B', 'F').merge();
  this._base(r).setNumberFormat('@').setValue('   ' + t).setBackground(COR.marca).setFontColor(COR.branco)
    .setFontSize(16).setFontWeight('bold').setHorizontalAlignment('left');
  this.sh.setRowHeight(this.linha, 48);
  this.linha++;
};

Layout_.prototype.subtitulo = function (nome, data) {
  this._garante();
  var a = this._r('B', 'D').merge();
  this._base(a).setNumberFormat('@').setValue('   ' + nome).setFontSize(13).setFontWeight('bold').setBackground(COR.marcaClara);
  var b = this._r('E', 'F').merge();
  this._base(b).setNumberFormat('@').setValue(data + '   ').setFontColor(COR.marcaEscura).setFontWeight('bold')
    .setHorizontalAlignment('right').setBackground(COR.marcaClara);
  this.sh.setRowHeight(this.linha, 36);
  this.linha++;
};

Layout_.prototype.secao = function (t) {
  this._garante();
  var r = this._r('B', 'F').merge();
  this._base(r).setNumberFormat('@').setValue(t.toUpperCase()).setFontColor(COR.marcaEscura).setFontWeight('bold')
    .setFontSize(10).setBackground(COR.marcaClara)
    .setBorder(null, true, null, null, null, null, COR.marca, SpreadsheetApp.BorderStyle.SOLID_THICK)
    .setBorder(null, null, true, null, null, null, COR.marca, SpreadsheetApp.BorderStyle.SOLID);
  this.sh.setRowHeight(this.linha, 28);
  this.linha++;
};

Layout_.prototype._rotulo = function (r, t) {
  this._base(r).setNumberFormat('@').setValue(t).setBackground(COR.creme).setFontColor(COR.rotulo).setFontWeight('bold').setWrap(true)
    .setBorder(true, true, true, true, null, null, COR.borda, SpreadsheetApp.BorderStyle.SOLID);
};

Layout_.prototype._valor = function (r, v) {
  var vazio = !v;
  this._base(r).setNumberFormat('@').setValue(vazio ? '—' : v).setBackground(COR.branco)
    .setFontColor(vazio ? COR.vazio : COR.texto).setWrap(true)
    .setBorder(true, true, true, true, null, null, COR.borda, SpreadsheetApp.BorderStyle.SOLID);
};

// Dois pares rótulo/valor por linha. Passe rótulo2 = '' para deixar a metade direita vazia.
Layout_.prototype.par = function (r1, v1, r2, v2) {
  this._garante();
  this._rotulo(this._r('B', 'C').merge(), r1);
  this._valor(this._r('D', 'D'), v1);
  if (r2) {
    this._rotulo(this._r('E', 'E'), r2);
    this._valor(this._r('F', 'F'), v2);
  }
  var maior = Math.max(String(v1 || '').length / 30, String(v2 || '').length / 30, 1);
  this.sh.setRowHeight(this.linha, Math.max(30, Math.min(120, Math.ceil(maior) * 16 + 12)));
  this.linha++;
};

Layout_.prototype.notas = function (r1, v1, r2, v2) {
  this._garante();
  this._rotulo(this._r('B', 'C').merge(), r1);
  this._valor(this._r('D', 'D'), v1);
  this._rotulo(this._r('E', 'E'), r2);
  this._valor(this._r('F', 'F'), v2);
  [['D', v1], ['F', v2]].forEach(function (p) {
    var c = this.sh.getRange(p[0] + this.linha);
    if (p[1]) c.setFontSize(16).setFontWeight('bold').setFontColor(COR.marca);
    c.setHorizontalAlignment('center');
  }, this);
  this.sh.setRowHeight(this.linha, 40);
  this.linha++;
};

// Rótulo à esquerda e texto longo ocupando D:F.
Layout_.prototype.longo = function (rotulo, v) {
  this._garante();
  this._rotulo(this._r('B', 'C').merge(), rotulo);
  this._valor(this._r('D', 'F').merge(), v);
  this._r('D', 'F').setVerticalAlignment('top');
  this._r('B', 'C').setVerticalAlignment('top');
  this.sh.setRowHeight(this.linha, alturaTexto_(v, LARGURA_VALOR_LONGO, 30));
  this.linha++;
};

Layout_.prototype.textoLivre = function (v) {
  this._garante();
  this._valor(this._r('B', 'F').merge(), v);
  this._r('B', 'F').setVerticalAlignment('top');
  this.sh.setRowHeight(this.linha, alturaTexto_(v, LARGURA_VALOR_LONGO + 210, 40));
  this.linha++;
};

// celulas: [[colIni, colFim, texto], ...]
Layout_.prototype.tabelaCabecalho = function (celulas) {
  this._garante();
  celulas.forEach(function (c) {
    var r = this._r(c[0], c[1]);
    if (c[0] !== c[1]) r.merge();
    this._base(r).setNumberFormat('@').setValue(c[2]).setBackground(COR.marca).setFontColor(COR.branco).setFontWeight('bold')
      .setHorizontalAlignment(c[2] === '#' || c[2] === 'Data' ? 'center' : 'left')
      .setBorder(true, true, true, true, null, null, COR.marca, SpreadsheetApp.BorderStyle.SOLID);
  }, this);
  this.sh.setRowHeight(this.linha, 28);
  this.linha++;
};

// celulas: [[colIni, colFim, texto, negrito?, alinhamento?], ...]
Layout_.prototype.tabelaLinha = function (celulas, zebra, discreto) {
  this._garante();
  var maior = 1;
  celulas.forEach(function (c) {
    var r = this._r(c[0], c[1]);
    if (c[0] !== c[1]) r.merge();
    var vazio = !c[2];
    this._base(r).setNumberFormat('@').setValue(vazio ? '—' : c[2]).setWrap(true)
      .setBackground(zebra ? COR.creme : COR.branco)
      .setFontColor(vazio || discreto ? COR.vazio : COR.texto)
      .setFontWeight(c[3] ? 'bold' : 'normal')
      .setHorizontalAlignment(c[4] || 'left')
      .setBorder(true, true, true, true, null, null, COR.borda, SpreadsheetApp.BorderStyle.SOLID);
    maior = Math.max(maior, Math.ceil(String(c[2] || '').length / 60));
  }, this);
  this.sh.setRowHeight(this.linha, Math.max(28, Math.min(200, maior * 16 + 12)));
  this.linha++;
};

Layout_.prototype.rodape = function (t) {
  this._garante();
  var r = this._r('B', 'F').merge();
  this._base(r).setNumberFormat('@').setValue(t).setFontSize(8).setFontColor(COR.vazio).setFontStyle('italic');
  this.sh.setRowHeight(this.linha, 22);
  this.linha++;
};

// Estima a altura de uma célula com quebra de texto (merged não cresce sozinha).
function alturaTexto_(v, larguraPx, minimo) {
  var porLinha = Math.max(20, Math.floor(larguraPx / 7.2));
  var linhas = 0;
  String(v || '—').split('\n').forEach(function (l) { linhas += Math.max(1, Math.ceil(l.length / porLinha)); });
  return Math.max(minimo, Math.min(600, linhas * 17 + 14));
}
