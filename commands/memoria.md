---
description: Responde uma pergunta só com base no vault do time (memória)
argument-hint: <pergunta>
---

Responda a pergunta abaixo usando só o que está escrito no vault do time. Não use conhecimento geral.

Pergunta: $ARGUMENTS

Passos:
1. Leia o caminho do vault em `$env:AGPOCKET_VAULT` (PowerShell) ou `$AGPOCKET_VAULT` (bash). Se estiver vazio, avise que o vault não está configurado (rode `npm run setup` no escritorio-ia) e pare.
2. Leia `<vault>/_indice.md`.
3. Busque no shell, NUNCA com Glob ou Grep (no OneDrive eles estouram o tempo). Escolha de 2 a 4 palavras-chave da pergunta e troque `termo1|termo2` por elas, com classes para acento e variações (ex.: `decis[aã]o|upload`; no bash, se o acento falhar, use `.` no lugar da letra: `decis.{1,2}o`).
   O comando já tira `.obsidian/`, `Templates/` e toda nota confidencial: nota sem frontmatter legível, com `confidencial: true` (também `"true"`, `True` ou com `# comentário`) e nota de `10-Reunioes/` sem `confidencial: false` explícito.
   - Na ferramenta **PowerShell**, rode este bloco como está (`-Encoding UTF8` é obrigatório no PS 5.1). Nunca rode via `powershell -Command` de dentro do Bash:
     ```powershell
     $v = $env:AGPOCKET_VAULT
     function Liberada($f) {
       $l = @(Get-Content -LiteralPath $f.FullName -Encoding UTF8 -TotalCount 200)
       if ($l.Count -lt 2 -or $l[0].Trim() -ne '---') { return $false }
       $fim = -1; for ($k = 1; $k -lt $l.Count; $k++) { if ($l[$k].Trim() -eq '---') { $fim = $k; break } }
       if ($fim -lt 1) { return $false }
       $fm = @(if ($fim -gt 1) { $l[1..($fim - 1)] })
       if ($fm -match '^confidencial:\s*["'']?true["'']?\s*(#.*)?$') { return $false }
       if ($f.FullName -match '\\10-Reunioes\\' -and -not ($fm -match '^confidencial:\s*["'']?false["'']?\s*(#.*)?$')) { return $false }
       return $true
     }
     Get-ChildItem -LiteralPath $v -Recurse -File -Filter *.md | Where-Object { $_.FullName -notmatch '\\(\.obsidian|Templates)\\' -and (Liberada $_) } | Select-String -Pattern 'termo1|termo2' -Encoding UTF8 | Group-Object Path | Sort-Object Count -Descending | Select-Object -First 8 Count,Name
     ```
   - Na ferramenta **Bash**, use esta versão (mesmas regras):
     ```bash
     liberada() {
       case "${1}" in */10-Reunioes/*) r=1 ;; *) r=0 ;; esac
       awk -v reuniao="$r" '
         { sub(/\r$/, "") }
         NR == 1 { sub(/^\xef\xbb\xbf/, ""); if (!/^---[ \t]*$/) exit 1; next }
         /^---[ \t]*$/ { fim = 1; exit }
         { l = tolower($(0)) }
         l ~ /^confidencial:[ \t]*["\047]?true["\047]?[ \t]*(#.*)?$/ { conf = 1 }
         l ~ /^confidencial:[ \t]*["\047]?false["\047]?[ \t]*(#.*)?$/ { livre = 1 }
         END { if (!fim || conf || (reuniao && !livre)) exit 1; exit 0 }
       ' "${1}"
     }
     cd "$AGPOCKET_VAULT" && find . -type f -name '*.md' -not -path './.obsidian/*' -not -path '*/Templates/*' -print0 |
       while IFS= read -r -d '' f; do liberada "$f" && printf '%s\0' "$f"; done |
       xargs -0 -r env LC_ALL=C.UTF-8 grep -cHiE 'termo1|termo2' -- |
       awk -F: '$NF > 0 { c = $NF; sub(/:[0-9]+$/, ""); print c "\t" $(0) }' | sort -nr | head -8
     ```
   - Se o shell falhar, leia as notas de entrada: `90-Memoria-do-time/Decisões.md`, `Pendências.md`, `Lições aprendidas.md`, `Sessões.md`, `40-Conhecimento/Conhecimento.md` e a nota do projeto em `30-Projetos/`.
4. Leia com Read no máximo 5 notas, só os trechos que interessam. Sem conferir, só pode abrir nota que saiu da lista filtrada do passo 3. Qualquer outra (link do `_indice.md`, de um hub ou do passo de reserva) precisa ser conferida antes, só pelo frontmatter: rode a função `Liberada`/`liberada` acima na mesma chamada do shell, ou, sem shell, leia só as primeiras linhas com Read (`limit`) até o fim do frontmatter e aplique as mesmas regras. Se for confidencial ou não der para saber, pare e não leia o resto.
5. Responda curto, citando cada afirmação com a nota de onde ela veio, como `[[nome-da-nota]]`.
6. Se não achar, diga "Não achei isso no vault" e sugira só uma pasta do `_indice.md` onde a informação poderia estar, sem afirmar o que tem nela. Nunca invente nem complete com conhecimento geral.

Regras:
- Não edite nenhum arquivo.
- NUNCA abra com Read uma nota confidencial (passo 4). Se só o título dela aparecer no `_indice.md`, pode dizer que existe uma nota confidencial com aquele título, sem o conteúdo.
