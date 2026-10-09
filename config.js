// Configuração pública do sistema.
// A ANON KEY é pública por design — toda a proteção de dados é feita por
// Row Level Security (RLS) no Supabase. Não coloque segredos aqui.
window.__CONFIG__ = {
  SUPABASE_URL: "https://hmvlkltyvyhlxfyaovpe.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtdmxrbHR5dnlobHhmeWFvdnBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTI2MDIsImV4cCI6MjEwMzg2ODYwMn0.w_mVu76PhRqwuyIlxqYi4uqOxTUcRFO0kQ2cFCaJMu8",

  // Acesso: "login" = tela de e-mail e senha (contas criadas só pelo ADM, sem cadastro público).
  // Papéis: ADM (tudo) e CS (só a aba CS / Suporte); Editor e Leitor ficam como papéis legados.
  // O modo antigo "open" (entrada automática com conta compartilhada de testes) foi
  // desligado e as credenciais do visitante saíram deste arquivo, que é público. Para
  // reativá-lo seria preciso informar GUEST_EMAIL e GUEST_PASSWORD de novo (não recomendado).
  AUTH_MODE: "login",
};
