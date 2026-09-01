# Sistema Operacional — Tia do Inglês

Aplicação interna da empresa. **Módulo 1: Base de Conhecimento** — tudo sobre a
empresa, metodologia, produto, cliente e resultados, com biblioteca de documentos
versionada.

A seção **Skills e Playbooks** guarda as skills do Claude da empresa como
documentos em Markdown, sincronizadas automaticamente a partir dos arquivos-fonte
(ver [`scripts/README.md`](scripts/README.md)).

Os setores **Financeiro, Comercial, CS/Suporte, Conteúdo e Ferramentas** aparecem
no menu como "em breve" e serão adicionados nos próximos módulos.

## Como funciona

- **Front-end sem build**: HTML + CSS + JS puro (Preact + htm via CDN). Nada para
  compilar. Publicado no **GitHub Pages**.
- **Back-end**: projeto **Supabase** `tia-do-ingles-os`
  (`hmvlkltyvyhlxfyaovpe`) — Postgres + Auth (e-mail/senha) + Storage.
- **Segurança**: todo acesso a dados passa por Row Level Security (RLS). A
  `ANON KEY` em `config.js` é pública por design.

### Papéis

| Papel  | Pode |
|--------|------|
| leitor | consultar todas as seções e documentos |
| editor | + criar/editar documentos e novas versões, editar descrição das seções |
| admin  | + criar/excluir usuários, definir papéis, gerar senhas temporárias, excluir documentos |

## Arquivos

| Arquivo | Função |
|---------|--------|
| `index.html` | casca da página, importmap, Tailwind (Play CDN) |
| `config.js` | URL e chave pública do Supabase |
| `app.js` | toda a aplicação (Preact) |
| `styles.css` | complementos de estilo |
| `.nojekyll` | desliga o processamento Jekyll do GitHub Pages |

## Desenvolvimento

Não precisa de Node. Para testar localmente, sirva a pasta com qualquer servidor
estático, por exemplo:

```bash
python3 -m http.server 5173
```

E abra <http://localhost:5173>.

## Deploy

Automático: qualquer `git push` na branch `main` publica em
`https://tiadoingles.github.io/os/` (GitHub Pages a partir da raiz da `main`).

## Gestão de usuários

Feita pela tela **Administração** (só admin), que chama a Edge Function
`admin-users` no Supabase. Novos usuários recebem uma **senha temporária** — devem
trocá-la em "Meu perfil" no primeiro acesso. Não há e-mail de confirmação.

## Banco de dados

Tabelas em `public`: `profiles`, `kb_sections`, `kb_documents`,
`kb_document_versions`, `kb_activity_log`. Funções auxiliares de RLS ficam no
schema `app` (fora da API). Migrations aplicadas via Supabase.
