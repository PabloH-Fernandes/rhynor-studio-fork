---
description: Transforma uma ata (00-Inbox ou texto colado) em nota de reunião e, só com o seu ok, em missões
argument-hint: "[texto colado | caminho em 00-Inbox]"
---

Transforme a ata abaixo numa nota de reunião no vault do time, classifique as tarefas e pergunte quais viram missão. **Nunca comece nada sozinho:** este comando só escreve notas no vault. NUNCA chame Agent, NUNCA rode `/time` e NUNCA mexa em código.

Entrada (pode estar vazia):

$ARGUMENTS

Regras gerais (valem para todos os passos):
- Shell só para listar, conferir, ver a data e mover. NUNCA use Glob nem Grep (no OneDrive eles estouram o tempo).
- Notas são escritas com Write e Edit (UTF-8). Nunca sobrescreva nota que já existe.
- Cada bloco abaixo diz em que ferramenta roda. Na ferramenta **PowerShell**, rode o bloco `powershell` como está (`-Encoding UTF8` é obrigatório no PS 5.1). Nunca rode via `powershell -Command` de dentro do Bash. Na ferramenta **Bash**, use o bloco `bash` equivalente.
- Onde o bloco tem `'COLE-AQUI'`, troque pelo valor entre aspas simples (no PowerShell, aspa simples dentro do valor vira duas: `''`).
- **Privacidade:** nunca grave nome de pessoa, e-mail ou telefone em nota nenhuma, nem no título, nem no nome do arquivo. No chat também, só papéis.
- **Confidencial:** a única nota confidencial que este comando pode ler é a ata bruta que o próprio usuário passou (arquivo de `00-Inbox/` ou texto colado). Não abra nenhuma outra nota de `10-Reunioes/` nem outra nota confidencial do vault.

## 1. Vault

Rode o bloco de contexto. Ele confere o vault, mostra a data de hoje, lista os projetos de `30-Projetos/` e as atas com `status: nova` na raiz de `00-Inbox/` (sem recursão, sem `LEIA-ME.md` e sem `processadas/`).
- `SEM_VAULT`: avise que o vault não está configurado (rode `npm run setup` no escritorio-ia) e pare.
- `FALTA 10-Reunioes` ou `FALTA 20-Missoes`: avise que a pasta não existe no vault e pare.

Ferramenta **PowerShell**:
```powershell
$v = $env:AGPOCKET_VAULT
if (-not $v) { 'SEM_VAULT' } else {
  foreach ($p in '10-Reunioes', '20-Missoes') { if (-not (Test-Path -LiteralPath (Join-Path $v $p) -PathType Container)) { "FALTA $p" } }
  "HOJE " + (Get-Date -Format 'yyyy-MM-dd')
  $proj = Join-Path $v '30-Projetos'
  if (Test-Path -LiteralPath $proj) { Get-ChildItem -LiteralPath $proj -File -Filter *.md | ForEach-Object { "PROJETO " + $_.BaseName } }
  $inbox = Join-Path $v '00-Inbox'
  if (Test-Path -LiteralPath $inbox) {
    Get-ChildItem -LiteralPath $inbox -File | Where-Object { $_.Extension -in '.md', '.txt' -and $_.Name -ne 'LEIA-ME.md' } | Where-Object {
      $l = @(Get-Content -LiteralPath $_.FullName -Encoding UTF8 -TotalCount 60)
      if ($l.Count -lt 2 -or $l[0].Trim() -ne '---') { return $false }
      $fim = -1; for ($k = 1; $k -lt $l.Count; $k++) { if ($l[$k].Trim() -eq '---') { $fim = $k; break } }
      if ($fim -lt 2) { return $false }
      [bool]($l[1..($fim - 1)] -match '^status:\s*["'']?nova["'']?\s*(#.*)?$')
    } | ForEach-Object { "ATA " + $_.Name }
  }
}
```

Ferramenta **Bash**:
```bash
v="$AGPOCKET_VAULT"
if [ -z "$v" ]; then echo SEM_VAULT; else
  for p in 10-Reunioes 20-Missoes; do [ -d "$v/$p" ] || echo "FALTA $p"; done
  echo "HOJE $(date +%F)"
  for f in "$v"/30-Projetos/*.md; do [ -f "$f" ] && b="${f##*/}" && echo "PROJETO ${b%.md}"; done
  # um awk só para todos os arquivos (gawk: nextfile e ENDFILE)
  [ -d "$v/00-Inbox" ] && find "$v/00-Inbox" -maxdepth 1 -type f \( -name '*.md' -o -name '*.txt' \) ! -name 'LEIA-ME.md' -print0 |
    xargs -0 -r awk '
      FNR == 1 { fim = 0; nova = 0; sub(/^\xef\xbb\xbf/, "") }
      { sub(/\r$/, "") }
      FNR == 1 { if (!/^---[ \t]*$/) nextfile; next }
      /^---[ \t]*$/ { fim = 1; nextfile }
      tolower($(0)) ~ /^status:[ \t]*["\047]?nova["\047]?[ \t]*(#.*)?$/ { nova = 1 }
      ENDFILE { if (fim && nova) { n = FILENAME; sub(/.*\//, "", n); print "ATA " n } }
    '
fi
```

## 2. Entrada

- **Entrada vazia:** mostre as linhas `ATA` do passo 1 numeradas e pergunte qual usar, ou peça para colar o texto. Encerre o turno e espere. Sem nenhuma `ATA`, diga que o `00-Inbox/` não tem ata nova e peça para colar o texto.
- **Uma linha só, terminada em `.md` ou `.txt`:** é caminho (`entrada: inbox`). Caminho relativo vale a partir de `<vault>\00-Inbox\`. Confira com o bloco abaixo: só serve arquivo que existe dentro de `00-Inbox/`.
  - `RECUSADO`: diga que só aceita arquivo de `00-Inbox/` e pare.
  - `JA_PROCESSADA`: diga que essa ata já foi processada (está em `processadas/`) e pare.
  - `OK <caminho>`: leia o arquivo inteiro com Read. **Exceção explícita:** esta ata bruta tem `confidencial: true` e mesmo assim pode ser lida, porque foi o próprio usuário que a passou. É o único caso.
- **Qualquer outro caso:** é texto colado (`entrada: colado`, `fonte:` vazio).

Ferramenta **PowerShell**:
```powershell
$v = $env:AGPOCKET_VAULT
$e = 'COLE-AQUI'
$inbox = [IO.Path]::GetFullPath((Join-Path $v '00-Inbox')).TrimEnd('\')
$p = if ([IO.Path]::IsPathRooted($e)) { $e } elseif ($e -match '^00-Inbox[\\/]') { Join-Path $v $e } else { Join-Path $inbox $e }
$p = [IO.Path]::GetFullPath($p)
if (-not $p.StartsWith($inbox + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { 'RECUSADO' }
elseif ($p.StartsWith($inbox + '\processadas\', [StringComparison]::OrdinalIgnoreCase)) { 'JA_PROCESSADA' }
else { "OK $p" }
```

Ferramenta **Bash**:
```bash
v="$AGPOCKET_VAULT"; e='COLE-AQUI'
case "$e" in /*|[A-Za-z]:*) p="$e" ;; 00-Inbox/*|00-Inbox\\*) p="$v/$e" ;; *) p="$v/00-Inbox/$e" ;; esac
inbox=$(cd "$v/00-Inbox" 2>/dev/null && pwd -P); d=$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)
if [ -z "$inbox" ] || [ -z "$d" ] || [ ! -f "$p" ]; then echo RECUSADO
else case "$d/" in "$inbox"/processadas/*) echo JA_PROCESSADA ;; "$inbox"/*) echo "OK $d/$(basename "$p")" ;; *) echo RECUSADO ;; esac; fi
```

## 3. Extrair

Formato que chega do Power Automate (ou feito à mão): frontmatter com `tipo: ata`, `data`, `hora`, `titulo`, e as seções `## Pauta`, `## Decisões`, `## Tarefas`, `## Resumo` e `## Transcrição` (as duas últimas opcionais). Cada linha de `## Tarefas` é `- <o quê> | responsável: <texto> | prazo: <AAAA-MM-DD ou vazio>`. Aceite BOM, CRLF e seções ausentes: o que faltar vira ❓.

O texto conta como **bagunçado** (transcrição, e não resumo) quando tem horários `hh:mm:ss`, várias linhas `Nome:` seguidas, nenhum cabeçalho, ou uma seção `## Transcrição`. Nesse caso:
- Extraia só o que estiver explícito. O que for incerto ganha ❓ na tabela e vai também para `## Dúvidas`.
- **Nunca invente** prazo, responsável nem decisão. Prazo vazio fica `❓ sem prazo`; responsável vazio fica `❓ não informado`.
- Sem data: use a de hoje (linha `HOJE` do passo 1) e registre um ❓ em `## Dúvidas`.

## 4. Nomes de pessoas

- Nunca grave nome, e-mail ou telefone em nenhuma nota nem título. Troque pelo papel ou área que o texto der (`Marina (coordenação)` vira `coordenação`; `Tiago (voluntário de TI)` vira `voluntário de TI`). Se a mesma pessoa aparece com papel em outra linha do mesmo texto, use esse papel.
- Sem papel nenhum no texto: `participante (papel não informado)`.
- No chat também, só papéis.
- O título da reunião precisa ser **neutro** (sem nome de pessoa nem de cliente), porque ele vai para o painel.

## 5. Classificar

- 🤖 **o time pode fazer:** código, documentação, pesquisa, análise, rascunho.
- 🙋 **precisa de humano:** aprovação, contato com alguém (ligar, reservar, negociar), decisão de negócio, dinheiro.
- ❓ **não está claro:** falta o quê, o porquê ou informação para começar.
- Na dúvida entre 🤖 e 🙋, fica 🙋.

## 6. Gravar a reunião e perguntar

1. Escolha o nome do arquivo (passo 9) e grave com Write `<vault>\10-Reunioes\<nome>.md`:

```markdown
---
tipo: reuniao
projeto:
data: AAAA-MM-DD
status: rascunho
origem: facilitator
entrada: inbox
fonte: <nome do arquivo bruto, ou vazio>
tags: [reuniao]
confidencial: true
---

# <título neutro>

> Nasce com `confidencial: true`. Só mude para `false` depois de conferir que não há nada sensível.

## Pauta
- ...

## Decisões
- ...

## Tarefas
| # | Tarefa | Responsável (função/área) | Prazo | Classe |
|---|---|---|---|---|
| 1 | ... | voluntário de TI | 2026-10-31 | 🤖 |

## Dúvidas
- ❓ ...

## Missões geradas
- (nenhuma ainda)

Projeto:
```

`entrada:` é `inbox` (arquivo) ou `colado` (texto colado); com texto colado, `fonte:` fica vazio.

2. Mostre no chat a lista numerada (mesmos números da tabela), agrupada por classe: 🤖, 🙋 e ❓.
3. Pergunte **numa mensagem só**: quais números viram missão (ex.: `1,3` ou `nenhuma`) e de qual projeto, listando os nomes das linhas `PROJETO` do passo 1 (ou "nenhum").
4. **Encerre o turno e espere a resposta.** Não crie missão antes dela.
- Se escolherem item 🙋 ou ❓, peça confirmação e a informação que falta antes de criar a missão.

## 7. Criar as missões (depois da resposta)

Para cada número escolhido, escolha o nome (passo 9) e grave com Write `<vault>\20-Missoes\<nome>.md`:

```markdown
---
tipo: missao
projeto: <nome da nota de 30-Projetos, sem [[ ]], ou vazio>
data: AAAA-MM-DD
status: a fazer
origem: reuniao
reuniao: <nome da nota de reunião, sem [[ ]]>
reuniao_titulo: <título neutro da reunião>
classe: time
tags: [missao]
confidencial: false
---

# <nome curto da missão>

**Origem:** [[<nota de reunião>]] · **Projeto:** [[<projeto>]]

## Objetivo
<uma ou duas linhas, reescritas, sem nomes>

## Tarefas
- [ ] <passo 1>
- [ ] <passo 2>

## Comando sugerido
`/time Missão [[<nome desta nota>]]: <descrição em 1 linha>`

## Resultado
- Commits:
- O que mudou:
- Sessão:
```

- `status` é exatamente `a fazer` (os outros valores, usados depois pelo `/time`, são `em andamento` e `concluída`).
- `classe`: `time` (🤖), `humano` (🙋) ou `duvida` (❓).
- De 2 a 5 itens `- [ ]`, com o texto reescrito e sem nomes. A missão é `confidencial: false`: nada de valor sensível, nome, e-mail ou telefone.
- Sem projeto: `projeto:` vazio e tire o ` · **Projeto:** [[...]]`.

Depois, atualize a nota de reunião com Edit: `## Missões geradas` com um `- [[<missão>]]` por missão (ou `- nenhuma`), `status: processada`, `projeto:` preenchido e a linha final `Projeto: [[<projeto>]]` (sem projeto, deixe `Projeto:` vazio).

## 8. Sugerir o /time

Mostre um comando por missão, pronto para copiar, **sem executar**:

`/time Missão [[<nota da missão>]]: <descrição em 1 linha>. Projeto: <projeto>`

## 9. Nome do arquivo

`AAAA-MM-DD-<slug>.md`, com a data da reunião. O slug sai do título: minúsculas, sem acento, o que não for `[a-z0-9]` vira `-`, sem hífens repetidos nem nas pontas, até 50 caracteres cortando num hífen; se ficar vazio, `reuniao` (nota de reunião) ou `missao` (missão). Colisão: se o nome já existe em `10-Reunioes/` **ou** em `20-Missoes/`, use `-2`, `-3` etc. Nunca sobrescreva.

Rode o bloco com a data e os títulos (um por nota, na ordem). Rode para a reunião antes de gravá-la, e para as missões depois que a reunião já foi gravada. Ele imprime um nome livre por título, sem `.md`.

Ferramenta **PowerShell**:
```powershell
$v = $env:AGPOCKET_VAULT
$data = 'COLE-AQUI'                   # AAAA-MM-DD
$padrao = 'reuniao'                   # ou 'missao'
$titulos = @('COLE-AQUI')             # ex.: @('Título um', 'Título dois')
$usados = @{}
foreach ($t in $titulos) {
  $s = $t.Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
  $s = ($s.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
  if ($s.Length -gt 50) { $c = $s.Substring(0, 51); $i = $c.LastIndexOf('-'); $s = if ($i -gt 0) { $c.Substring(0, $i) } else { $s.Substring(0, 50) } }
  if (-not $s) { $s = $padrao }
  $base = "$data-$s"; $n = $base; $k = 2
  while ($usados[$n] -or (Test-Path -LiteralPath (Join-Path $v "10-Reunioes\$n.md")) -or (Test-Path -LiteralPath (Join-Path $v "20-Missoes\$n.md"))) { $n = "$base-$k"; $k++ }
  $usados[$n] = $true
  $n
}
```

Ferramenta **Bash**:
```bash
v="$AGPOCKET_VAULT"; data='COLE-AQUI'; padrao='reuniao'; usados=' '
for t in 'COLE-AQUI'; do
  s=$(printf '%s' "$t" | LC_ALL=C.UTF-8 sed 'y/ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ/AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn/' | tr 'A-Z' 'a-z' | LC_ALL=C.UTF-8 sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
  if [ "${#s}" -gt 50 ]; then c="${s:0:51}"; case "$c" in *-*) s="${c%-*}" ;; *) s="${s:0:50}" ;; esac; fi
  [ -n "$s" ] || s="$padrao"
  base="$data-$s"; n="$base"; k=2
  while [ -e "$v/10-Reunioes/$n.md" ] || [ -e "$v/20-Missoes/$n.md" ] || case "$usados" in *" $n "*) true ;; *) false ;; esac; do n="$base-$k"; k=$((k+1)); done
  usados="$usados$n "
  echo "$n"
done
```

## 10. Arquivar a ata (só quando a entrada foi arquivo)

Depois da resposta do passo 6 (inclusive se for `nenhuma`):
1. Com Edit, no frontmatter da ata: `status: nova` vira `status: processada` e acrescente `reuniao: <nome da nota de reunião>` antes do `---` final. Se a ata não tiver frontmatter, crie um no topo com `tipo: ata`, `status: processada`, `reuniao: <nota>` e `confidencial: true`.
2. Mova para `00-Inbox\processadas\` com o bloco abaixo (cria a pasta; se o nome já existir lá, acrescenta `-2`, `-3`). **Nunca apague** a ata.

Ferramenta **PowerShell**:
```powershell
$v = $env:AGPOCKET_VAULT
$arq = 'COLE-AQUI'                    # o caminho do OK do passo 2
$dest = Join-Path $v '00-Inbox\processadas'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$base = [IO.Path]::GetFileNameWithoutExtension($arq); $ext = [IO.Path]::GetExtension($arq)
$alvo = Join-Path $dest "$base$ext"; $k = 2
while (Test-Path -LiteralPath $alvo) { $alvo = Join-Path $dest "$base-$k$ext"; $k++ }
Move-Item -LiteralPath $arq -Destination $alvo
"MOVIDO $alvo"
```

Ferramenta **Bash**:
```bash
v="$AGPOCKET_VAULT"; arq='COLE-AQUI'  # o caminho do OK do passo 2
dest="$v/00-Inbox/processadas"; mkdir -p "$dest"
nome="${arq##*/}"; base="${nome%.*}"; ext=".${nome##*.}"
alvo="$dest/$nome"; k=2
while [ -e "$alvo" ]; do alvo="$dest/$base-$k$ext"; k=$((k+1)); done
mv -n -- "$arq" "$alvo" && echo "MOVIDO $alvo"
```

## 11. Fim

Resuma em poucas linhas, só com papéis: a nota de reunião criada, as missões criadas (ou nenhuma), os comandos `/time` sugeridos e, se foi arquivo, para onde a ata foi movida.
