# Sincronização de Skills → Base de Conhecimento

`sync_skills.py` lê as skills do Claude no disco e publica cada uma como um
documento em **Base de Conhecimento › Skills e Playbooks** (Supabase).

- 1 skill = 1 documento (chave estável `skill:<nome>`), conteúdo em Markdown
  (SKILL.md + referências + scripts, tudo num arquivo).
- Só cria **nova versão** quando o conteúdo muda (compara SHA-256). Rodar de novo
  é seguro.
- Não precisa de Node nem de bibliotecas — só Python 3 (já vem no macOS).

## Configuração (uma vez)

```bash
mkdir -p ~/tia-do-ingles-os/.sync
cp ~/tia-do-ingles-os/scripts/config.env.example ~/tia-do-ingles-os/.sync/config.env
# edite ~/tia-do-ingles-os/.sync/config.env e preencha SYNC_PASSWORD
chmod 600 ~/tia-do-ingles-os/.sync/config.env
```

A conta `sync@os.tiadoingles.com.br` (papel **editor**) foi criada só para isso.
`.sync/` está no `.gitignore` — a senha nunca vai para o GitHub.

## Uso manual

```bash
python3 ~/tia-do-ingles-os/scripts/sync_skills.py            # sincroniza
python3 ~/tia-do-ingles-os/scripts/sync_skills.py --dry-run  # simula
python3 ~/tia-do-ingles-os/scripts/sync_skills.py --list     # mostra onde achou cada skill
```

## Automação

### Opção A (recomendada) — Tarefa agendada do Claude

Já configurada: tarefa `sync-skills-os`, roda todo dia às 07:15, gerenciável na
seção **"Scheduled"** da barra lateral do app do Claude. Ela só roda **com o app
do Claude aberto** (se estava fechado no horário, roda no próximo abrir). Não
instala nada no sistema. Nada a fazer aqui além de deixar o app abrir de vez em
quando.

### Opção B — LaunchAgent do macOS (roda mesmo com o Claude fechado)

```bash
cp ~/tia-do-ingles-os/scripts/br.com.tiadoingles.os-skillsync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/br.com.tiadoingles.os-skillsync.plist
```

Roda às 08:00, 14:00 e 20:00 (e ao ligar o Mac). Log em `.sync/last-run.log`.
Desligar: `launchctl unload ...` e apagar o arquivo de `~/Library/LaunchAgents/`.

## Adicionar / remover skills da sincronização

Edite a lista `ALLOWLIST` no topo de `sync_skills.py` — cada linha é
`(nome_da_skill, "Título no sistema", "categoria")`. `--list` avisa quais skills
existem no disco mas estão fora da lista.

## Limitação conhecida

O script depende dos arquivos-fonte das skills estarem no disco, em um dos
caminhos de `SEARCH_GLOBS`. Esses caminhos são gerenciados pelo app do Claude; se
mudarem, ajuste `SEARCH_GLOBS`. `--list` mostra o que foi encontrado (ou não).
