/**
 * Diagnóstico do Mentorado — Apps Script (Web App) da Tia do Inglês
 * ------------------------------------------------------------------
 * Recebe os dados do formulário "Diagnóstico do Mentorado" do Sistema
 * Operacional (via Edge Function `diagnostico-drive` do Supabase), cria a
 * planilha "<Nome completo> - DD/MM/AAAA" na pasta
 * "0.1 Diagnóstico Inicial [Marcela]" a partir do modelo e preenche as células.
 * Se o diagnóstico for concluído de novo, atualiza o MESMO arquivo (fileId).
 *
 * Propriedades do script (Configurações do projeto → Propriedades do script):
 *   DIAG_TOKEN  — segredo compartilhado com o Supabase (obrigatório).
 *   MODELO_ID   — ID do Google Sheet modelo. Preenchida sozinha por criarModelo().
 *
 * Funções para rodar à mão (menu "Executar"):
 *   criarModelo() — constrói o modelo do zero (layout fiel ao xlsx original)
 *                   na pasta-mãe e grava o ID em MODELO_ID. Rode uma vez.
 *
 * Implantação: Implantar → Nova implantação → App da Web, "Executar como: eu" e
 * "Quem pode acessar: qualquer pessoa" (a Edge Function não envia credencial
 * Google; a proteção é o DIAG_TOKEN).
 *
 * NUNCA coloque o valor do DIAG_TOKEN neste arquivo — o repositório é público.
 */

var PASTA_DIAGNOSTICOS_ID = '1_6Ckmc6aVAdE1rUOuIua3Se5b_DCm2Et'; // 0.1 Diagnóstico Inicial [Marcela]
var PASTA_MODELO_ID = '1Xe_779iGkAwF_0x8lnxI5OLcc9pq_IDI';      // pasta-mãe (guarda o modelo)
var NOME_MODELO = 'MODELO Diagnóstico Mentorado [não editar]';
var ABA = 'NOVO';
var FUSO = 'America/Sao_Paulo';

/* ============================== Web App ============================== */

function doGet() {
  return json_({ ok: true, servico: 'diagnostico-mentorado', modeloConfigurado: !!modeloValido_() });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'JSON inválido' });
  }
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('DIAG_TOKEN');
  if (!token) return json_({ ok: false, error: 'DIAG_TOKEN não configurado nas Propriedades do script' });
  if (!body || body.token !== token) return json_({ ok: false, error: 'Token inválido' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return json_({ ok: false, error: 'Outra planilha está sendo gerada. Tente de novo em instantes.' });
  try {
    var dados = body.dados || {};
    var nome = String(dados.nome || '').trim();
    if (!nome) return json_({ ok: false, error: 'Nome completo é obrigatório' });
    var dataDiag = parseData_(dados.data_diagnostico);
    if (!dataDiag) return json_({ ok: false, error: 'Data do diagnóstico é obrigatória' });
    if (nome.length > 150) nome = nome.slice(0, 150);
    var nomeArquivo = nome + ' - ' + Utilities.formatDate(dataDiag, FUSO, 'dd/MM/yyyy');

    var ss = null;
    if (body.fileId) {
      var existente = null;
      try { existente = DriveApp.getFileById(String(body.fileId)); } catch (err) { existente = null; }
      if (existente && !existente.isTrashed()) {
        // Só atualiza planilhas de diagnóstico: Google Sheet, dentro da pasta 0.1, com a aba NOVO.
        if (existente.getMimeType() !== MimeType.GOOGLE_SHEETS || !naPastaDiagnosticos_(existente)) {
          return json_({ ok: false, error: 'O arquivo vinculado não é uma planilha da pasta de diagnósticos' });
        }
        var aberto = SpreadsheetApp.openById(existente.getId());
        if (!aberto.getSheetByName(ABA)) return json_({ ok: false, error: 'A planilha vinculada não tem a aba ' + ABA });
        existente.setName(nomeArquivo);
        ss = aberto;
      } // apagado (lixeira) ou inexistente: cria outro
    }
    if (!ss) {
      var modeloId = modeloValido_() || criarModelo();
      var copia = DriveApp.getFileById(modeloId)
        .makeCopy(nomeArquivo, DriveApp.getFolderById(PASTA_DIAGNOSTICOS_ID));
      ss = SpreadsheetApp.openById(copia.getId());
    }
    preencher_(ss, dados);
    SpreadsheetApp.flush();
    return json_({ ok: true, url: ss.getUrl(), fileId: ss.getId(), nome: nomeArquivo });
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

function modeloValido_() {
  var id = PropertiesService.getScriptProperties().getProperty('MODELO_ID');
  if (!id) return null;
  try {
    var f = DriveApp.getFileById(id);
    return f.isTrashed() ? null : id;
  } catch (err) {
    return null;
  }
}

/* ============================ Preenchimento ============================ */

// Campo do formulário → célula da aba NOVO (campos mesclados = célula da esquerda).
// Toda célula mapeada é sempre reescrita (vazia quando o campo está vazio), para
// que uma segunda conclusão atualize o arquivo sem deixar valor antigo.
var MAPA = [
  ['data_inicio', 'B1', 'data'],
  ['onboarding_data', 'B2', 'data'],
  ['onboarding_hora', 'D2', 'hora'],
  ['data_diagnostico', 'B3', 'data'],
  ['nivelamento', 'B4', 'texto'],
  ['nome', 'B6', 'texto'],
  ['idade', 'B7', 'numero'],
  ['email', 'B8', 'texto'],
  ['profissao', 'B9', 'texto'],
  ['horario_pratica', 'B10', 'texto'],
  ['objetivo', 'B12', 'texto'],
  ['objetivo_detalhe', 'F12', 'longo', 3, 52],
  ['dificuldades', 'B15', 'longo', 3, 62],
  ['nota_speaking', 'B16', 'numero'],
  ['nota_listening', 'B18', 'numero'],
  ['vac', 'B20', 'vac', 3, 62],
  ['o_que_fez', 'B22', 'longo', 3, 62],
  ['trilha', 'B24', 'texto'],
  ['trilha_obs', 'B25', 'longo', 3, 62],
  ['rotina_trilha', 'C26', 'texto'],
  ['rotina_arena', 'C27', 'texto'],
  ['arena_nivel', 'F27', 'texto'],
  ['rotina_labs', 'C28', 'texto'],
  ['rotina_video', 'C29', 'texto'],
  ['rotina_pratica', 'C30', 'texto'],
  ['meta', 'B32', 'longo', 3, 62],
  ['meta_data', 'G32', 'data'],
  ['observacoes', 'B35', 'longo', 3, 100],
];

function preencher_(ss, d) {
  ss.setSpreadsheetTimeZone(FUSO);
  var sh = ss.getSheetByName(ABA);
  if (!sh) throw new Error('Aba ' + ABA + ' não encontrada');
  var alturas = {};
  MAPA.forEach(function (m) {
    var campo = m[0], cel = sh.getRange(m[1]), tipo = m[2];
    var v = d[campo];
    if (tipo === 'vac') {
      v = [d.vac, d.vac_obs].filter(function (x) { return x && String(x).trim(); }).join(' — ');
      tipo = 'longo';
    }
    if (tipo === 'longo') { var r0 = cel.getRow(); alturas[r0] = alturas[r0] || MODELO_ALTURA_LINHA; }
    if (v === undefined || v === null || String(v).trim() === '') {
      cel.clearContent();
      return;
    }
    if (tipo === 'data') {
      var dt = parseData_(v);
      if (dt) { cel.setNumberFormat('dd/MM/yyyy').setValue(dt); } else { cel.setValue(String(v)); }
    } else if (tipo === 'hora') {
      cel.setNumberFormat('@').setValue(String(v).slice(0, 5));
    } else if (tipo === 'numero') {
      var n = Number(String(v).replace(',', '.'));
      cel.setValue(isNaN(n) ? String(v) : n);
    } else {
      cel.setValue(String(v));
      if (tipo === 'longo') {
        cel.setWrap(true).setVerticalAlignment('top');
        // Linhas de células mescladas não crescem sozinhas: estima a altura.
        var porLinha = m[4] || 60, linhas = 0;
        String(v).split('\n').forEach(function (l) { linhas += Math.max(1, Math.ceil(l.length / porLinha)); });
        var row = cel.getRow();
        alturas[row] = Math.max(alturas[row] || MODELO_ALTURA_LINHA, Math.min(400, linhas * 17 + 6));
      }
    }
  });
  Object.keys(alturas).forEach(function (r) { sh.setRowHeight(Number(r), alturas[r]); });
}

// "2026-10-06" → Date local (sem deslocar o dia por fuso).
function parseData_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  return null;
}

/* ============================ Modelo do zero ============================ */
// Reprodução do arquivo "❌MODELO PLANILHA MENTORADO❌-2.xlsx" (aba NOVO):
// rótulos, mesclagens, larguras/alturas, fontes, cores, bordas e os 5 dropdowns.
// Ajustes em relação ao xlsx (o xlsx tinha uma mesclagem B15:E16 que engolia a
// célula da Nota Speaking em B16):
//   - B15:E16 → B15:E15 (caixa de Dificuldades), liberando B16:E16 (mesclada, como a
//     Nota Listening em B18:E18) para a Nota Speaking;
//   - B35:H35 mesclada, para as Observações Gerais quebrarem linha.

var MODELO_CELULAS = [
  {"a": "A1", "v": "Data de início", "f": "Montserrat", "b": 1, "bg": "#FFF2CC", "bd": "tlbr"},
  {"a": "B1", "f": "Montserrat", "bd": "tlbr", "h": "center", "n": "dd/MM/yyyy"},
  {"a": "C1", "f": "Montserrat"},
  {"a": "D1", "f": "Montserrat"},
  {"a": "E1", "f": "Montserrat"},
  {"a": "A2", "v": "Data de call de Onboarding", "f": "Montserrat", "b": 1, "bg": "#FFF2CC", "bd": "tlbr"},
  {"a": "B2", "f": "Montserrat", "bd": "tlbr", "h": "center", "n": "dd/MM/yyyy"},
  {"a": "C2", "v": "Horário", "f": "Montserrat", "b": 1, "h": "center"},
  {"a": "D2", "f": "Montserrat"},
  {"a": "E2", "f": "Montserrat"},
  {"a": "A3", "v": "Data do Diagnóstico [Marcela]", "f": "Montserrat", "b": 1, "bg": "#FFF2CC", "bd": "tlbr"},
  {"a": "B3", "f": "Montserrat", "bd": "tlb", "h": "center", "n": "dd/MM/yyyy"},
  {"a": "C3", "f": "Montserrat", "bd": "tlbr"},
  {"a": "D3", "f": "Montserrat"},
  {"a": "E3", "f": "Montserrat"},
  {"a": "A4", "v": "Resultado do Teste de nivelamento:", "f": "Montserrat", "b": 1, "bg": "#F4CCCC"},
  {"a": "B4", "f": "Montserrat", "bg": "#F4CCCC"},
  {"a": "A5", "f": "Montserrat", "b": 1},
  {"a": "B5", "f": "Montserrat"},
  {"a": "C5", "f": "Montserrat"},
  {"a": "D5", "f": "Montserrat"},
  {"a": "E5", "f": "Montserrat"},
  {"a": "A6", "v": "Nome", "f": "Montserrat", "b": 1, "bg": "#FFF2CC", "bd": "tlbr"},
  {"a": "B6", "f": "Montserrat", "bd": "tlbr", "h": "left"},
  {"a": "C6", "bd": "tb"},
  {"a": "D6", "bd": "tb"},
  {"a": "E6", "bd": "tbr"},
  {"a": "A7", "v": "Idade", "f": "Montserrat", "b": 1, "bg": "#FFF2CC", "bd": "tlbr"},
  {"a": "B7", "f": "Montserrat", "bd": "tlbr", "h": "left"},
  {"a": "C7", "bd": "tb"},
  {"a": "D7", "bd": "tb"},
  {"a": "E7", "bd": "tbr"},
  {"a": "A8", "v": "Email", "f": "Montserrat", "b": 1, "bg": "#FFF2CC", "bd": "tlbr"},
  {"a": "B8", "f": "Montserrat", "s": 11.0, "c": "#232333", "bg": "#FFFFFF", "bd": "br"},
  {"a": "C8", "bd": "b"},
  {"a": "D8", "bd": "b"},
  {"a": "E8", "bd": "br"},
  {"a": "A9", "v": "Profissão", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B9", "f": "Montserrat", "bd": "tlbr", "h": "left"},
  {"a": "C9", "bd": "tb"},
  {"a": "D9", "bd": "tb"},
  {"a": "E9", "bd": "tbr"},
  {"a": "A10", "v": "Horário Sessão Prática", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B10", "f": "Montserrat", "bd": "tlbr", "h": "left"},
  {"a": "C10", "bd": "tb"},
  {"a": "D10", "bd": "tb"},
  {"a": "E10", "bd": "tbr"},
  {"a": "A11", "f": "Montserrat", "b": 1},
  {"a": "B11", "f": "Montserrat", "h": "left"},
  {"a": "C11", "f": "Montserrat", "h": "left"},
  {"a": "D11", "f": "Montserrat", "h": "left"},
  {"a": "E11", "f": "Montserrat", "h": "left"},
  {"a": "A12", "v": "Objetivo", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B12", "v": "Profissional"},
  {"a": "F12", "v": "Descrever em detalhes"},
  {"a": "A13", "f": "Montserrat", "b": 1},
  {"a": "B13", "f": "Montserrat", "h": "left", "vt": "top", "w": 1},
  {"a": "C13", "f": "Montserrat", "h": "left", "vt": "top", "w": 1},
  {"a": "D13", "f": "Montserrat", "h": "left", "vt": "top", "w": 1},
  {"a": "E13", "f": "Montserrat", "h": "left", "vt": "top", "w": 1},
  {"a": "A14", "v": "Dificuldades (O que mais frustrou antes)", "f": "Montserrat", "b": 1, "bg": "#C9DAF8"},
  {"a": "B14", "f": "Montserrat", "h": "left", "vt": "top", "w": 1},
  {"a": "B15", "f": "Montserrat", "bd": "tlbr", "h": "left", "vt": "top", "w": 1},
  {"a": "C15", "bd": "t"},
  {"a": "D15", "bd": "t"},
  {"a": "E15", "bd": "tr"},
  {"a": "A16", "v": "Nota Speaking", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B16", "bd": "lb"},
  {"a": "C16", "bd": "b"},
  {"a": "D16", "bd": "b"},
  {"a": "E16", "bd": "br"},
  {"a": "A17", "f": "Montserrat", "b": 1},
  {"a": "B17", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C17", "h": "left", "vt": "top"},
  {"a": "D17", "h": "left", "vt": "top"},
  {"a": "E17", "h": "left", "vt": "top"},
  {"a": "A18", "v": "Nota Listening", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B18", "f": "Montserrat", "bd": "tlbr", "h": "left", "vt": "top"},
  {"a": "C18", "bd": "tb"},
  {"a": "D18", "bd": "tb"},
  {"a": "E18", "bd": "tbr"},
  {"a": "B19", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C19", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "D19", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "E19", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "A20", "v": "Resultado Teste VAC", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B20", "v": "** Ideia: Fazer teste vac com IA e pegar o resultado automático. Ou pedir para preencher no teste de nivelamento", "f": "Montserrat", "bd": "tlbr", "h": "left", "vt": "top"},
  {"a": "C20", "bd": "tb"},
  {"a": "D20", "bd": "tb"},
  {"a": "E20", "bd": "tbr"},
  {"a": "A21", "f": "Montserrat", "b": 1},
  {"a": "B21", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C21", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "D21", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "E21", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "A22", "v": "O que já fez antes (tempo e formato)", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
  {"a": "B22", "f": "Montserrat", "bd": "tlbr", "h": "left", "vt": "top"},
  {"a": "C22", "bd": "tb"},
  {"a": "D22", "bd": "tb"},
  {"a": "E22", "bd": "tbr"},
  {"a": "A23", "f": "Montserrat", "b": 1},
  {"a": "B23", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C23", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "D23", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "E23", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "A24", "v": "Trilha Inicial", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlb"},
  {"a": "B24", "f": "Montserrat", "bd": "tbr", "h": "left", "vt": "top", "w": 1},
  {"a": "C24", "bd": "tb"},
  {"a": "D24", "bd": "tb"},
  {"a": "E24", "bd": "tbr"},
  {"a": "A25", "f": "Montserrat", "b": 1},
  {"a": "B25", "f": "Montserrat", "bd": "tlbr", "h": "left", "vt": "top", "w": 1},
  {"a": "C25", "bd": "tb"},
  {"a": "D25", "bd": "tb"},
  {"a": "E25", "bd": "tbr"},
  {"a": "A26", "v": "Rotina", "f": "Montserrat", "b": 1},
  {"a": "B26", "v": "Trilha", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C26", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "B27", "v": "Arena", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C27", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "F27", "v": "RC, Básico, Inter, Avançado"},
  {"a": "A28", "f": "Montserrat", "b": 1},
  {"a": "B28", "v": "Labs", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "C28", "f": "Montserrat", "h": "left", "vt": "top"},
  {"a": "B29", "v": "Vídeo Semanal"},
  {"a": "B30", "v": "Sessão Prática"},
  {"a": "A32", "v": "Meta", "b": 1},
  {"a": "B32", "v": "Exemplo : Concluir X aulas até data Y"},
  {"a": "F32", "v": "DATA DA META 1"},
  {"a": "A35", "v": "Observações Gerais", "f": "Montserrat", "b": 1, "bg": "#CFE2F3", "bd": "tlbr"},
];

var MODELO_MESCLAS = [
  // [intervalo, borda externa?]
  ['B4:E4', false], ['B6:E6', true], ['B7:E7', true], ['B8:E8', false], ['B9:E9', true],
  ['B10:E10', true], ['B12:E12', false], ['F12:H12', false], ['B14:E14', false],
  ['B15:E15', true], ['B16:E16', true], ['B18:E18', true], ['B20:E20', true], ['B22:E22', true],
  ['B24:E24', true], ['B25:E25', true], ['C26:E26', false], ['C27:E27', false],
  ['C28:E28', false], ['C29:E29', false], ['C30:E30', false], ['B32:E32', false],
  ['B35:H35', false],
];

var MODELO_DROPDOWNS = [
  ['B10', ['17h', '19h']],
  ['B12', ['Profissional', 'Viagem', 'Realização Pessoal', 'Outros']],
  ['B24', ['TRILHA 1', 'TRILHA 2', 'TRILHA 3', 'TRILHA 4', 'TRILHA 5']],
  ['C26:C30', ['1x Semana', '2x Semana', '3x Semana', '4x Semana', '5x Semana']],
  ['F27', ['RC', 'Básico', 'Inter', 'Avançado']],
];

// Larguras do xlsx (caracteres) convertidas para pixels (~7px por caractere + 5).
var MODELO_LARGURAS = { A: 258, B: 96, C: 96, D: 96, E: 160, F: 185, G: 96, H: 96 };
var MODELO_LINHAS = 35;
var MODELO_ALTURA_LINHA = 21; // 15,75 pt

function criarModelo() {
  var ss = SpreadsheetApp.create(NOME_MODELO, MODELO_LINHAS, 8);
  ss.setSpreadsheetTimeZone(FUSO);
  try { ss.setSpreadsheetLocale('pt_BR'); } catch (err) { /* ignora */ }
  var sh = ss.getSheets()[0];
  sh.setName(ABA);

  var tudo = sh.getRange(1, 1, MODELO_LINHAS, 8);
  tudo.setFontFamily('Arial').setFontSize(10).setFontColor('#000000').setVerticalAlignment('bottom');
  Object.keys(MODELO_LARGURAS).forEach(function (col) {
    sh.setColumnWidth(sh.getRange(col + '1').getColumn(), MODELO_LARGURAS[col]);
  });
  sh.setRowHeights(1, MODELO_LINHAS, MODELO_ALTURA_LINHA);

  var HAIR = SpreadsheetApp.BorderStyle.DOTTED; // "hair" do Excel
  MODELO_CELULAS.forEach(function (c) {
    var r = sh.getRange(c.a);
    if (c.f) r.setFontFamily(c.f);
    if (c.s) r.setFontSize(c.s);
    if (c.b) r.setFontWeight('bold');
    if (c.c) r.setFontColor(c.c);
    if (c.bg) r.setBackground(c.bg);
    if (c.h) r.setHorizontalAlignment(c.h);
    if (c.vt) r.setVerticalAlignment(c.vt);
    if (c.w) r.setWrap(true);
    if (c.n) r.setNumberFormat(c.n);
    if (c.bd) {
      r.setBorder(c.bd.indexOf('t') >= 0, c.bd.indexOf('l') >= 0, c.bd.indexOf('b') >= 0,
        c.bd.indexOf('r') >= 0, null, null, '#000000', HAIR);
    }
    if (c.v !== undefined) r.setValue(c.v);
  });
  // B4:E4 tem fundo rosa em toda a faixa; B16 vira caixa própria da Nota Speaking.
  sh.getRange('B4:E4').setBackground('#F4CCCC');
  sh.getRange('B16').setBorder(true, true, true, true, null, null, '#000000', HAIR)
    .setFontFamily('Montserrat').setHorizontalAlignment('left');
  sh.getRange('B35').setFontFamily('Montserrat').setWrap(true).setVerticalAlignment('top');
  sh.getRange('B3').setBorder(true, true, true, true, null, null, '#000000', HAIR);
  sh.getRange('D2').setFontFamily('Montserrat').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, null, null, '#000000', HAIR);
  sh.getRange('G32').setNumberFormat('dd/MM/yyyy');

  MODELO_MESCLAS.forEach(function (m) {
    var r = sh.getRange(m[0]);
    r.merge();
    if (m[1]) r.setBorder(true, true, true, true, null, null, '#000000', HAIR);
  });

  MODELO_DROPDOWNS.forEach(function (d) {
    var regra = SpreadsheetApp.newDataValidation().requireValueInList(d[1], true).setAllowInvalid(false).build();
    sh.getRange(d[0]).setDataValidation(regra);
  });

  SpreadsheetApp.flush();
  var arquivo = DriveApp.getFileById(ss.getId());
  arquivo.moveTo(DriveApp.getFolderById(PASTA_MODELO_ID));
  PropertiesService.getScriptProperties().setProperty('MODELO_ID', ss.getId());
  Logger.log('Modelo criado: ' + ss.getUrl());
  return ss.getId();
}
