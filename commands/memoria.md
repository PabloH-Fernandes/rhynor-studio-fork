---
description: Responde uma pergunta só com base no vault do time (memória)
argument-hint: <pergunta>
---

Responda a pergunta abaixo usando só o que está escrito no vault do time. Não use conhecimento geral.

Pergunta: $ARGUMENTS

Passos:
1. Leia o caminho do vault em `$env:AGPOCKET_VAULT` (PowerShell) ou `$AGPOCKET_VAULT` (bash). Se estiver vazio, avise que o vault não está configurado (rode `npm run setup` no escritorio-ia) e pare.
2. Leia `<vault>/_indice.md`.
3. Busque no shell, NUNCA com Glob ou Grep (no OneDrive eles estouram o tempo). Escolha de 2 a 4 palavras-chave da pergunta e use classes para acento e variações (ex.: `decis[aã]o|upload`). No PowerShell, `-Encoding UTF8` é obrigatório:
   ```powershell
   $v=$env:AGPOCKET_VAULT; Get-ChildItem -LiteralPath $v -Recurse -File -Filter *.md | Where-Object { $_.FullName -notmatch '\\(\.obsidian|Templates)\\' -and -not (Get-Content -LiteralPath $_.FullName -TotalCount 15 -Encoding UTF8 | Select-String '^confidencial:\s*true\s*$' -Quiet) } | Select-String -Pattern 'termo1|termo2' -Encoding UTF8 | Group-Object Path | Sort-Object Count -Descending | Select-Object -First 8 Count,Name
   ```
   No bash, a alternativa é `grep -rliE --include='*.md' --exclude-dir=.obsidian --exclude-dir=Templates 'termo1|termo2' "$AGPOCKET_VAULT"`, tirando da lista os arquivos que têm `confidencial: true` no frontmatter.
   Se o shell falhar, leia as notas de entrada: `90-Memoria-do-time/Decisões.md`, `Pendências.md`, `Lições aprendidas.md`, `Sessões.md`, `40-Conhecimento/Conhecimento.md` e a nota do projeto em `30-Projetos/`.
4. Leia com Read no máximo 5 notas, só os trechos que interessam.
5. Responda curto, citando cada afirmação com a nota de onde ela veio, como `[[nome-da-nota]]`.
6. Se não achar, diga "Não achei isso no vault" e sugira onde a informação poderia estar (pasta ou nota). Nunca invente nem complete com conhecimento geral.

Regras:
- Não edite nenhum arquivo.
- NUNCA abra com Read uma nota com `confidencial: true`. Se só o título dela aparecer no `_indice.md`, pode dizer que existe uma nota confidencial com aquele título, sem o conteúdo.
