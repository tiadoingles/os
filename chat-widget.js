(function () {
  "use strict";
  if (window.__tiaChatWidgetLoaded) return;
  window.__tiaChatWidgetLoaded = true;

  var SUPABASE_URL = "https://hmvlkltyvyhlxfyaovpe.supabase.co";
  var ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtdmxrbHR5dnlobHhmeWFvdnBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTI2MDIsImV4cCI6MjEwMzg2ODYwMn0.w_mVu76PhRqwuyIlxqYi4uqOxTUcRFO0kQ2cFCaJMu8";
  var ENDPOINT = SUPABASE_URL + "/functions/v1/public-chat";
  var BRAND = "#ea5167";
  var GREETING =
    "Oi, eu sou o TIRA DÚVIDAS sobre CONTEÚDOS da Tia do Inglês!\nMe conta, qual a sua dúvida sobre conteúdo?";

  function sessionId() {
    try {
      var k = "tia_chat_session_id";
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return String(Date.now());
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatResposta(text) {
    var lines = escapeHtml(text).split("\n");
    var html = "";
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var bullet = /^\s*[-•]\s+(.*)/.exec(line);
      if (bullet) {
        if (!inList) { html += "<ul>"; inList = true; }
        html += "<li>" + bullet[1] + "</li>";
        continue;
      }
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim() === "") { html += "<br>"; continue; }
      html += "<p>" + line + "</p>";
    }
    if (inList) html += "</ul>";
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return html;
  }

  // Widget inteiro vive dentro de uma Shadow DOM: isola o CSS nos dois sentidos,
  // para nao vazar (nem sofrer vazamento de) estilos globais da pagina host
  // (ex.: uma classe generica como ".loading" definida pelo CSS da Cademi).
  var host = document.createElement("div");
  host.id = "tia-chat-host";
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var css =
    ":host{all:initial}" +
    "*{box-sizing:border-box}" +
    "#tia-chat-bubble{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;" +
    "background:" + BRAND + ";box-shadow:0 4px 16px rgba(0,0,0,.2);border:none;cursor:pointer;z-index:999998;" +
    "display:flex;align-items:center;justify-content:center;transition:transform .15s ease}" +
    "#tia-chat-bubble:hover{transform:scale(1.06)}" +
    "#tia-chat-bubble svg{width:28px;height:28px}" +
    "#tia-chat-panel{position:fixed;bottom:92px;right:20px;width:360px;max-width:calc(100vw - 24px);" +
    "height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;" +
    "box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:999999;display:none;flex-direction:column;overflow:hidden;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
    "#tia-chat-panel.open{display:flex}" +
    "#tia-chat-header{background:" + BRAND + ";color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}" +
    "#tia-chat-header .title{font-weight:600;font-size:15px}" +
    "#tia-chat-header .subtitle{font-size:12px;opacity:.9;margin-top:2px}" +
    "#tia-chat-close{background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;padding:4px}" +
    "#tia-chat-messages{flex:1;overflow-y:auto;padding:14px;background:#f6f3ee;display:flex;flex-direction:column;gap:10px}" +
    ".tia-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.45;word-wrap:break-word}" +
    ".tia-msg p{margin:0 0 6px}" +
    ".tia-msg p:last-child{margin-bottom:0}" +
    ".tia-msg ul{margin:4px 0;padding-left:18px}" +
    ".tia-msg-bot{align-self:flex-start;background:#fff;color:#2b2b2b;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.08)}" +
    ".tia-msg-user{align-self:flex-end;background:" + BRAND + ";color:#fff;border-bottom-right-radius:4px}" +
    ".tia-msg-error{align-self:flex-start;background:#fdeceb;color:#9c2b23;border-bottom-left-radius:4px}" +
    ".tia-msg-loading{align-self:flex-start;background:#fff;color:#9a9a9a;font-style:italic}" +
    "#tia-chat-inputrow{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}" +
    "#tia-chat-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:9px 14px;font-size:13.5px;outline:none;resize:none;max-height:80px;font-family:inherit}" +
    "#tia-chat-input:focus{border-color:" + BRAND + "}" +
    "#tia-chat-send{background:" + BRAND + ";border:none;color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;" +
    "display:flex;align-items:center;justify-content:center;flex-shrink:0}" +
    "#tia-chat-send:disabled{opacity:.5;cursor:default}" +
    "@media (max-width:480px){#tia-chat-panel{right:8px;left:8px;width:auto;bottom:84px}#tia-chat-bubble{right:16px;bottom:16px}}";

  var style = document.createElement("style");
  style.textContent = css;
  root.appendChild(style);

  var bubble = document.createElement("button");
  bubble.id = "tia-chat-bubble";
  bubble.setAttribute("aria-label", "Abrir chat de dúvidas");
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 4h16v12H7l-3 3V4z" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    "</svg>";

  var panel = document.createElement("div");
  panel.id = "tia-chat-panel";
  panel.innerHTML =
    '<div id="tia-chat-header">' +
    '<div><div class="title">Tira Dúvidas de Conteúdo</div><div class="subtitle">Método Tia do Inglês</div></div>' +
    '<button id="tia-chat-close" aria-label="Fechar">×</button>' +
    "</div>" +
    '<div id="tia-chat-messages"></div>' +
    '<div id="tia-chat-inputrow">' +
    '<textarea id="tia-chat-input" rows="1" placeholder="Digite sua pergunta..."></textarea>' +
    '<button id="tia-chat-send" aria-label="Enviar">' +
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 20l17-8L4 4l0 7 11 1-11 1z" fill="#fff"/></svg>' +
    "</button>" +
    "</div>";

  root.appendChild(bubble);
  root.appendChild(panel);

  var messagesEl = panel.querySelector("#tia-chat-messages");
  var inputEl = panel.querySelector("#tia-chat-input");
  var sendBtn = panel.querySelector("#tia-chat-send");
  var closeBtn = panel.querySelector("#tia-chat-close");

  function addMessage(kind, html) {
    var div = document.createElement("div");
    div.className = "tia-msg tia-msg-" + kind;
    div.innerHTML = html;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  var greeted = false;
  function openPanel() {
    panel.classList.add("open");
    if (!greeted) {
      addMessage("bot", "<p>" + escapeHtml(GREETING).replace(/\n/g, "<br>") + "</p>");
      greeted = true;
    }
    inputEl.focus();
  }
  function closePanel() {
    panel.classList.remove("open");
  }

  bubble.addEventListener("click", function () {
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);

  inputEl.addEventListener("input", function () {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + "px";
  });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);

  var sending = false;
  function send() {
    var pergunta = inputEl.value.trim();
    if (!pergunta || sending) return;
    sending = true;
    sendBtn.disabled = true;
    addMessage("user", "<p>" + escapeHtml(pergunta) + "</p>");
    inputEl.value = "";
    inputEl.style.height = "auto";
    var loading = addMessage("loading", "Digitando...");

    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: "Bearer " + ANON_KEY,
      },
      body: JSON.stringify({ pergunta: pergunta, session_id: sessionId() }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        loading.remove();
        if (!res.ok || res.data.error) {
          addMessage("error", "<p>" + escapeHtml(res.data.error || "Não consegui responder agora. Tente de novo em instantes.") + "</p>");
          return;
        }
        addMessage("bot", formatResposta(res.data.resposta || ""));
      })
      .catch(function () {
        loading.remove();
        addMessage("error", "<p>Não consegui me conectar agora. Verifique sua internet e tente de novo.</p>");
      })
      .finally(function () {
        sending = false;
        sendBtn.disabled = false;
      });
  }
})();
