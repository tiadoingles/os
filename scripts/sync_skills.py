#!/usr/bin/env python3
"""
Sincroniza as skills do Claude (arquivos-fonte no disco) para a Base de Conhecimento
do Sistema Operacional (Supabase), na seção "Skills e Playbooks".

- Cada skill vira 1 documento (chave estável `skill:<nome>`), conteúdo em Markdown
  (SKILL.md + referências + scripts, num arquivo só).
- Só cria uma nova versão quando o conteúdo muda (compara SHA-256).
- Rodar de novo é seguro (idempotente). Use --dry-run para simular, --list para inspecionar.

Config: ~/tia-do-ingles-os/.sync/config.env  (SUPABASE_URL, SUPABASE_ANON_KEY, SYNC_EMAIL, SYNC_PASSWORD)
Sem dependências externas — só a biblioteca padrão do Python 3.
"""
import os, sys, json, glob, hashlib, datetime, argparse
import urllib.request, urllib.error, urllib.parse

HOME = os.path.expanduser("~")
CONFIG = os.environ.get("SYNC_CONFIG", os.path.join(HOME, "tia-do-ingles-os", ".sync", "config.env"))
DEFAULT_SECAO = "skills-e-playbooks"

# Skills sincronizadas: (nome, titulo, categoria, secao_slug).
# `secao_slug` decide em qual seção da Base de Conhecimento o documento nasce.
# Só é aplicada na criação — se o documento já existe, mudar aqui NÃO move sozinho
# (mova pelo botão "Editar" na página, ou apague e deixe o sync recriar).
ALLOWLIST = [
    ("corretor-tarefas-alunos",            "Corretor de Tarefas de Alunas",          "feedback",     "metodologia"),
    ("depoimentos-tia-do-ingles",          "Banco de Depoimentos de Alunas",         "prova-social", "resultados-e-provas"),
    ("agente-vendas-high-ticket-mentoria", "Agente de Vendas High Ticket — Mentoria", "vendas",       "skills-e-playbooks"),
    ("agente-vendas-low-ticket",           "Agente de Vendas Low Ticket",            "vendas",       "skills-e-playbooks"),
    ("avatar-tia-do-ingles",               "Avatar / Cliente Ideal",                 "avatar",       "cliente-e-avatar"),
    ("documento-de-marca-tia-do-ingles",   "Documento de Marca",                     "marca",        "documentacao-e-processos"),
    ("metodologia-tia-do-ingles",          "Metodologia — Pensamento Pedagógico",     "metodologia",  "metodologia"),
    ("mypa",                               "MYPA — Alfabeto Fonético",               "metodologia",  "metodologia"),
    ("tia-do-ingles-materials",            "Materiais e Roteiros de Aula",           "metodologia",  "metodologia"),
    ("tia-feedback-engine",                "Feedback Engine — Sistema de Feedback",   "feedback",     "metodologia"),
    ("transcricao-calls-closer",           "Transcrição de Calls de Vendas",         "vendas",       "skills-e-playbooks"),
    ("youtube-viral-tia",                  "YouTube Viral — Playbook",               "conteudo",     "skills-e-playbooks"),
]

# Onde o Claude guarda as pastas de skills (padrões glob). Cada match contém <skill>/SKILL.md
SEARCH_GLOBS = [
    os.path.join(HOME, ".claude", "skills"),
    os.path.join(HOME, "Library", "Application Support", "Claude",
                 "local-agent-mode-sessions", "skills-plugin", "*", "*", "skills"),
    os.path.join(HOME, "Library", "Application Support", "Claude",
                 "local-agent-mode-sessions", "*", "*", "rpm", "plugin_*", "skills"),
]


def log(msg):
    print(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}", flush=True)


def load_config(path):
    if not os.path.isfile(path):
        sys.exit(f"config não encontrada: {path}\nCrie a partir de scripts/config.env.example")
    cfg = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "SYNC_EMAIL", "SYNC_PASSWORD"):
        if not cfg.get(k):
            sys.exit(f"config incompleta: falta {k} em {path}")
    cfg["SUPABASE_URL"] = cfg["SUPABASE_URL"].rstrip("/")
    return cfg


def find_skill_dir(name):
    """Retorna a pasta da skill com o SKILL.md mais recente (caso haja cópias em sessões diferentes)."""
    matches = []
    for pattern in SEARCH_GLOBS:
        for base in glob.glob(pattern):
            skill_md = os.path.join(base, name, "SKILL.md")
            if os.path.isfile(skill_md):
                matches.append((os.path.getmtime(skill_md), os.path.join(base, name)))
    if not matches:
        return None
    matches.sort()
    return matches[-1][1]


def all_skill_names_on_disk():
    known = set()
    for pattern in SEARCH_GLOBS:
        for base in glob.glob(pattern):
            for d in glob.glob(os.path.join(base, "*")):
                if os.path.isfile(os.path.join(d, "SKILL.md")):
                    known.add(os.path.basename(d))
    return known


def strip_frontmatter(text):
    if text.startswith("---\n") or text.startswith("---\r\n"):
        end = text.find("\n---", 3)
        if end != -1:
            nl = text.find("\n", end + 1)
            return text[nl + 1:] if nl != -1 else ""
    return text


def read(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def build_md(name, titulo, categoria, d):
    today = datetime.date.today().isoformat()
    parts = [
        f"# {titulo}\n",
        f"> **Skill:** `{name}` · **Categoria:** {categoria} · **Sincronizada da fonte em:** {today}\n>\n"
        f"> Documento gerado automaticamente a partir dos arquivos-fonte da skill "
        f"(SKILL.md + referências). Não editar manualmente — as alterações são "
        f"sobrescritas na próxima sincronização.\n",
        "---\n",
        "## Instrução principal (SKILL.md)\n",
        strip_frontmatter(read(os.path.join(d, "SKILL.md"))).strip() + "\n",
    ]
    for sub, label in (("references", "Referência"), ("scripts", "Script")):
        p = os.path.join(d, sub)
        if not os.path.isdir(p):
            continue
        for fn in sorted(os.listdir(p)):
            fp = os.path.join(p, fn)
            if not os.path.isfile(fp):
                continue
            ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
            parts.append(f"\n## {label} — {fn}\n")
            if ext in ("md", "markdown", "mdx", "txt"):
                parts.append(read(fp).strip() + "\n")
            elif ext == "py":
                parts.append("```python\n" + read(fp).rstrip() + "\n```\n")
            elif ext in ("js", "mjs", "ts", "jsx", "tsx"):
                parts.append("```javascript\n" + read(fp).rstrip() + "\n```\n")
            elif ext == "json":
                raw = read(fp)
                try:
                    raw = json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
                except Exception:
                    pass
                parts.append("<details><summary>Ver conteúdo (" + fn + ")</summary>\n\n```json\n"
                             + raw.rstrip() + "\n```\n\n</details>\n")
            else:
                parts.append(f"_(arquivo não textual — não incluído: `{fn}`)_\n")
    ap = os.path.join(d, "assets")
    if os.path.isdir(ap):
        items = [fn for fn in sorted(os.listdir(ap)) if os.path.isfile(os.path.join(ap, fn))]
        if items:
            parts.append("\n## Anexos (não incluídos no texto)\n")
            for fn in items:
                parts.append(f"- `{fn}` ({os.path.getsize(os.path.join(ap, fn))} bytes)")
            parts.append("")
    return "\n".join(parts).strip() + "\n"


class API:
    def __init__(self, cfg, token):
        self.base = cfg["SUPABASE_URL"] + "/rest/v1"
        self.h = {
            "apikey": cfg["SUPABASE_ANON_KEY"],
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _call(self, method, path, body=None, prefer=None):
        headers = dict(self.h)
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            sys.exit(f"API {method} {path} -> HTTP {e.code}: {e.read().decode()[:500]}")

    def get(self, path):
        return self._call("GET", path)

    def post(self, path, body):
        return self._call("POST", path, body, prefer="return=representation")


def get_token(cfg):
    body = json.dumps({"email": cfg["SYNC_EMAIL"], "password": cfg["SYNC_PASSWORD"]}).encode()
    req = urllib.request.Request(
        cfg["SUPABASE_URL"] + "/auth/v1/token?grant_type=password",
        data=body,
        headers={"apikey": cfg["SUPABASE_ANON_KEY"], "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"login da conta de sync falhou: HTTP {e.code} {e.read().decode()[:300]}")


def main():
    p = argparse.ArgumentParser(description="Sincroniza skills do Claude para a Base de Conhecimento.")
    p.add_argument("--dry-run", action="store_true", help="mostra o que faria, sem escrever")
    p.add_argument("--list", action="store_true", help="lista as skills e onde foram encontradas")
    args = p.parse_args()

    if args.list:
        for name, _titulo, _cat, secao in ALLOWLIST:
            print(f"{name:40} [{secao:24}] {find_skill_dir(name) or '*** NÃO ENCONTRADA ***'}")
        extra = all_skill_names_on_disk() - {n for n, *_ in ALLOWLIST}
        if extra:
            print("\nSkills no disco fora do allowlist (edite ALLOWLIST em sync_skills.py p/ incluir):")
            for n in sorted(extra):
                print("  -", n)
        return

    cfg = load_config(CONFIG)
    log(f"login como {cfg['SYNC_EMAIL']}")
    api = API(cfg, get_token(cfg))

    secs = api.get("/kb_sections?select=id,slug")
    sec_by_slug = {s["slug"]: s["id"] for s in (secs or [])}
    if DEFAULT_SECAO not in sec_by_slug:
        sys.exit(f"seção '{DEFAULT_SECAO}' não existe no banco")

    created = updated = unchanged = missing = 0
    for name, titulo, categoria, secao in ALLOWLIST:
        d = find_skill_dir(name)
        if not d:
            log(f"[--] {name}: fonte não encontrada no disco — pulada")
            missing += 1
            continue
        section_id = sec_by_slug.get(secao) or sec_by_slug[DEFAULT_SECAO]
        md = build_md(name, titulo, categoria, d)
        sha = hashlib.sha256(md.encode("utf-8")).hexdigest()
        key = f"skill:{name}"
        docs = api.get(f"/kb_documents?chave_externa=eq.{urllib.parse.quote(key)}&select=id")

        is_new_doc = not docs
        if is_new_doc:
            if args.dry_run:
                log(f"[NOVO] {name} → {secao} (dry-run)")
                created += 1
                continue
            row = api.post("/kb_documents", {
                "section_id": section_id,
                "titulo": titulo,
                "descricao": f"Skill do Claude sincronizada automaticamente. Categoria: {categoria}.",
                "kind": "documento",
                "tags": [categoria, "skill"],
                "status": "publicado",
                "origem": "skill-sync",
                "chave_externa": key,
            })
            doc_id = row[0]["id"]
        else:
            doc_id = docs[0]["id"]

        last = api.get(
            f"/kb_document_versions?document_id=eq.{doc_id}&select=versao,conteudo_sha&order=versao.desc&limit=1"
        )
        if last and last[0].get("conteudo_sha") == sha:
            unchanged += 1
            log(f"[==] {name}: sem alteração")
            continue

        nextv = (last[0]["versao"] + 1) if last else 1
        if args.dry_run:
            log(f"[{'NOVO' if is_new_doc else 'ATUALIZA'}] {name}: v{nextv} ({len(md)} bytes)")
        else:
            api.post("/kb_document_versions", {
                "document_id": doc_id,
                "versao": nextv,
                "conteudo_md": md,
                "conteudo_sha": sha,
                "file_name": f"{name}.md",
                "changelog": f"Sincronização automática — {datetime.date.today().isoformat()}",
            })
            log(f"[{'NOVO' if is_new_doc else 'ATUALIZADO'}] {name}: v{nextv} ({len(md)} bytes)")
        if is_new_doc:
            created += 1
        else:
            updated += 1

    log(f"Resumo: {created} criada(s), {updated} atualizada(s), "
        f"{unchanged} sem mudança, {missing} não encontrada(s).")


if __name__ == "__main__":
    main()
