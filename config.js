// Configuração pública do sistema.
// A ANON KEY é pública por design — toda a proteção de dados é feita por
// Row Level Security (RLS) no Supabase. Não coloque segredos aqui.
window.__CONFIG__ = {
  SUPABASE_URL: "https://hmvlkltyvyhlxfyaovpe.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtdmxrbHR5dnlobHhmeWFvdnBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTI2MDIsImV4cCI6MjEwMzg2ODYwMn0.w_mVu76PhRqwuyIlxqYi4uqOxTUcRFO0kQ2cFCaJMu8",

  // PERÍODO DE TESTES: entrada liberada, sem tela de login.
  // O app entra sozinho com uma conta compartilhada (papel: editor).
  // Para voltar a exigir login: AUTH_MODE = "login".
  AUTH_MODE: "open",
  GUEST_EMAIL: "teste@os.tiadoingles.com.br",
  GUEST_PASSWORD: "os-teste-2026",
};
