# Instalando o AG Pocket em outro PC

Guia para quem não conhece o projeto. Tempo estimado: 10 a 15 minutos (a maior parte é download).

## 1. O que é o AG Pocket

Um escritório pixel art que mostra, em tempo real, o seu time de agentes do Claude Code trabalhando: cada agente é um **AGzinho** que senta na mesa, digita, pede ajuda e descansa. O `npm run setup` deixa o PC pronto: instala o time de agentes, os hooks, o vault do Obsidian (a memória do time), os comandos `/time`, `/memoria` e `/reuniao`, o Playwright e as skills, e monta o escritório.

## 2. Pré-requisitos

| O que | Versão | Link |
|---|---|---|
| Node.js (com npm) | 20 ou mais novo | https://nodejs.org |
| Git | qualquer recente | https://git-scm.com/downloads |
| Claude Code, **já logado** | recente | https://docs.claude.com/en/docs/claude-code/setup |
| Edge ou Chrome | qualquer recente | https://www.microsoft.com/edge · https://www.google.com/chrome |

Para conferir, num terminal novo: `node --version` (precisa mostrar v20 ou maior), `git --version` e `claude --version`. Rode `claude` uma vez e faça o login antes do setup.

## 3. Instalação

```bash
git clone https://github.com/PabloH-Fernandes/rhynor-studio.git
cd rhynor-studio
npm run setup
npm start
```

O `npm run setup` roda `npm install` sozinho. Ao fim, `npm start` sobe o escritório em http://127.0.0.1:4848. Abra uma sessão **nova** do Claude Code em qualquer projeto: o líder entra pela porta e, quando delegar, os outros chegam.

O setup é seguro para rodar de novo: o que já está em dia é pulado, e arquivos de configuração do Claude (`settings.json`, `CLAUDE.md`) ganham um backup `*.backup-*` antes de mudar.

### Opções (flags)

Com `npm run`, as flags vão **depois de um `--`**:

```bash
npm run setup -- --dry-run
npm run setup -- --completo --browser=chrome
```

| Flag | O que faz |
|---|---|
| `--dry-run` | Só mostra o que faria, sem escrever nada. Boa para o primeiro contato. |
| `--completo` | Instala também os **extras** (skills e plugins de terceiros, ver seção 5). |
| `--sem-plugins` | Pula marketplaces, plugins e skills. Útil em rede restrita. |
| `--browser=NAV` | Navegador do Playwright: `chrome`, `msedge`, `firefox` ou `webkit`. Padrão: `msedge` no Windows e `chrome` nos outros sistemas. |
| `--check` | Só confere (o mesmo que `npm run setup:check`). |
| `--vault=PASTA` | Onde criar o vault (caminho completo ou começando com `~`). Só vale se `AGPOCKET_VAULT` ainda não estiver no settings.json; senão é ignorada, com aviso. Padrão: `AG-Cerebro` ao lado do repositório. |

## 4. Como conferir

```bash
npm run setup:check
```

Não instala nem escreve nada: lista o que está em dia e o que falta. Dentro do Claude Code, `/agents` deve listar os 6 agentes (planejador, pesquisador, dev, testador, revisor, documentador) e `/time`, `/memoria` e `/reuniao` devem existir como comandos. Para testar a memória, rode `/memoria o que tem no vault?`.

**Mudou o `model:` de um agente em `agents/`?** Rode `npm run install-agents` antes de qualquer outra coisa. Até lá, o `npm run setup:check` acusa os agentes como "desatualizados" (isso é esperado, não é erro do setup).

```bash
npm run install-agents
npm run setup:check      # deve ficar verde
```

## 5. O que é instalado

O setup roda os comandos oficiais do `claude` no escopo de **usuário** (vale para todos os projetos). A lista vem de `setup/skills.json`.

Além do catálogo abaixo, o setup também faz estas coisas:

| O quê | Onde fica |
|---|---|
| 6 agentes do time | `~/.claude/agents/` |
| Hooks que mandam os eventos ao escritório | `~/.claude/settings.json` |
| `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (lista de tarefas, usada pelo quadro de etapas) | `~/.claude/settings.json`, em `env` |
| Vault do Obsidian (segundo cérebro), copiado de `vault-template/` **só se a pasta ainda não existir**. Vault existente nunca é sobrescrito: o setup só confere a estrutura e avisa o que falta | `AG-Cerebro` ao lado do repositório, ou a pasta de `--vault=` (nunca dentro do repositório) |
| `AGPOCKET_VAULT` com o caminho do vault (gravado depois que a pasta existe; se já houver um valor, não troca) | `~/.claude/settings.json`, em `env` |
| Bloco do time (`team/CLAUDE-time.md`) entre `<!-- ag-pocket:inicio -->` e `<!-- ag-pocket:fim -->` | `~/.claude/CLAUDE.md` |
| Bloco de memória (`team/CLAUDE-memoria.md`: o que ler no começo e no fim de missão e as regras de privacidade) entre `<!-- ag-pocket:memoria:inicio -->` e `<!-- ag-pocket:memoria:fim -->`. Cópias antigas sem marcadores saem só se o setup reconhecer todas as linhas (com backup) | `~/.claude/CLAUDE.md` |
| Comandos: **todo** `commands/*.md` (hoje `/memoria`, `/reuniao` e `/time`). Arquivo diferente ganha backup antes de ser trocado | `~/.claude/commands/` |
| Elenco inicial, copiado de `data/agzinhos.example.json` (se ainda não existir) | `data/agzinhos.json` |
| Build do escritório | `web/dist/` |

### O vault: outro PC e atualizações

- **Em outro PC** o setup cria um vault **novo e vazio** (só o modelo de `vault-template/`). Nada é migrado: reuniões, missões e memória do PC antigo ficam lá. Para levar, copie a pasta do vault à mão (ou use uma pasta sincronizada) e aponte o `AGPOCKET_VAULT` para ela **antes** de rodar o setup, ou use `--vault=`.
- Se uma pasta acima do vault novo já tiver `.obsidian/` (outro vault), o setup avisa: os links `[[ ]]` podem ficar ambíguos até o vault antigo ser arquivado.
- Se o vault existir mas estiver incompleto, o setup não mexe nele e **não grava** o `AGPOCKET_VAULT`: complete as pastas (ou escolha outra com `--vault=`) e rode de novo.
- **Mudanças em `vault-template/` não chegam a um vault que já existe.** Depois de um `git pull` que mexa no modelo (templates, `_indice.md`, `LEIA-ME.md`), copie à mão o que quiser.
- **Depois de atualizar** (`git pull` + `npm run setup`), reinicie o AG Pocket (`npm start` de novo) e abra uma sessão **nova** do Claude Code. O servidor lê o vault e monta as mensagens no momento em que sobe: um servidor antigo não conhece o `GET /api/missoes` nem as mensagens `missoes` e `reuniao`. A sessão nova carrega os comandos e o bloco de memória novos.

### Essenciais (sempre instalados)

| Item | Tipo | Para que serve | Onde fica |
|---|---|---|---|
| `claude-code-plugins` | marketplace | Catálogo oficial de plugins do Claude Code (`anthropics/claude-code`) | `~/.claude/plugins/` |
| `frontend-design` | plugin | Ajuda o Claude a criar interfaces bonitas e diferentes do padrão genérico | `~/.claude/plugins/` |
| `anthropic-agent-skills` | marketplace | Catálogo de skills oficiais da Anthropic (`anthropics/skills`) | `~/.claude/plugins/` |
| `example-skills` | plugin | Skills de exemplo da Anthropic (theme-factory, webapp-testing e outras) | `~/.claude/plugins/` |
| `playwright` | MCP | Deixa o testador e o revisor abrirem o site num navegador de verdade | `~/.claude.json` (escopo de usuário) |
| `web-design-guidelines` | skill | Revisa interface contra boas práticas de design e acessibilidade | `~/.claude/skills/` |
| `brainstorming` | skill | Ajuda a explorar a ideia antes de sair implementando | `~/.claude/skills/` |
| `webapp-testing` | skill | Plano B do testador: scripts Playwright para testar sites | `~/.claude/skills/` |
| `find-skills` | skill | Ajuda a achar e instalar outras skills | `~/.claude/skills/` |

### Extras (só com `--completo`)

> **Atenção:** os extras são de **terceiros** e rodam com as suas permissões (podem ler arquivos, rodar comandos e acessar a rede). Os de geração de imagem chamam um serviço externo. Revise cada um antes de instalar.

| Item | Tipo | Para que serve | Onde fica |
|---|---|---|---|
| `superpowers` | plugin (do marketplace `claude-plugins-official`, que o setup não adiciona; para remover: `claude plugin uninstall superpowers@claude-plugins-official`) | Pacote de fluxos de trabalho (planejar, depurar, revisar) | `~/.claude/plugins/` |
| `agent-browser` | skill | Controla um navegador pela linha de comando | `~/.claude/skills/` |
| `grill-me` | skill | O Claude te questiona até a ideia ficar clara | `~/.claude/skills/` |
| `copywriting` | skill | Escrita de textos de marketing | `~/.claude/skills/` |
| `nano-banana-2` | skill | Geração de imagens com IA (chama serviço externo) | `~/.claude/skills/` |
| `ai-image-generation` | skill | Geração de imagens com IA (chama serviço externo) | `~/.claude/skills/` |
| `remotion-motion-graphics` | skill (manual) | Vídeos e animações com Remotion. O setup só imprime a instrução: copie a pasta da skill de `haidrrrry/claude-remotion-skill` para `~/.claude/skills/` | `~/.claude/skills/` |
| `karpathy-skills` | marketplace (repo `forrestchang/andrej-karpathy-skills`) | Diretrizes de comportamento para o Claude errar menos ao programar | `~/.claude/plugins/` |
| `context-engineering-marketplace` | marketplace (repo `muratcankoylan/Agent-Skills-for-Context-Engineering`) | Skills de engenharia de contexto para agentes | `~/.claude/plugins/` |

## 6. O que NÃO vai pelo git (e como levar)

O `.gitignore` deixa de fora:

| Caminho | O que é | Como levar para o outro PC |
|---|---|---|
| `data/agzinhos.json` | Seu elenco personalizado (nomes, roupas, textos) | Copie o arquivo para a pasta `data/` do novo PC. Sem ele, vale o elenco de exemplo. |
| `data/escritorio.json` e `data/eventos/` | Estado do escritório e gravação de eventos (têm caminhos e prompts da sua máquina) | Não leve. Não compartilhe. |
| `data/replay/`, `data/gasto/`, `data/transparencia/`, `data/exportacoes/` | Resumo do dia, contagem de tokens, log de acesso ao vault e cópias exportadas (têm nomes de arquivos e caminhos) | Não leve. Veja a seção 12. |
| `data/estimativas.json` | Minutos usados na estimativa de tempo economizado (só números) | Pode copiar. Se não existir, vale o padrão. |
| `referencias/` | Material de referência (logos, manual de marca etc.) | Copie à mão, por um canal que a empresa aprove. |
| `prints/` | Prints de conferência de quem desenvolveu | Opcional; não é necessário para rodar. |
| `node_modules/` e `web/dist/` | Gerados pelo `npm install` e pelo build | O setup recria. |
| O vault do Obsidian | Fica **fora** do repositório (só o modelo `vault-template/` vai pelo git) | Veja "O vault: outro PC e atualizações" na seção 5. Reuniões são confidenciais: só por canal que a empresa aprove. |

## 7. Problemas comuns

**`npm` ou `node` não é reconhecido.** O Node não está no PATH. Reinstale marcando a opção de adicionar ao PATH e **abra um terminal novo**.

**PowerShell diz que a execução de scripts está desabilitada** (erro de ExecutionPolicy ao rodar `npm`). Libere só para o seu usuário:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

**Erro de certificado (rede com proxy)**, como `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` ou `self-signed certificate in certificate chain`. Peça ao Node para usar os certificados do Windows e rode o setup de novo:

```powershell
$env:NODE_OPTIONS="--use-system-ca"; npm run setup
```
```bash
NODE_OPTIONS=--use-system-ca npm run setup
```

**Nunca desligue a verificação SSL** (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `strict-ssl false`, `--insecure`). Isso abre a porta para interceptação. Se a rede bloquear mesmo assim, fale com a TI ou use `--sem-plugins`.

**OneDrive travando arquivos** (erros de `EBUSY`, `EPERM`, `npm install` lento ou que não termina). Clone para uma pasta **fora do OneDrive**, por exemplo `C:\Users\<voce>\dev`, e rode o setup de lá.

**Playwright não abre o navegador.** Confira se o Edge ou o Chrome está instalado. Para outro navegador, remova o servidor e rode o setup de novo com a flag:

```bash
claude mcp remove playwright --scope user
npm run setup -- --browser=chrome
```

**Os comandos `claude` demoram e dão timeout** (PC lento, antivírus). O limite padrão é 300 segundos por item. Aumente:

```powershell
$env:AG_SETUP_TIMEOUT_S="600"; npm run setup
```

Se um item estourar o tempo, o setup avisa "tempo esgotado" e mostra o comando manual. No Windows, o processo filho (npx/node) pode continuar rodando em segundo plano mesmo assim; confira no Gerenciador de Tarefas antes de tentar de novo.

Se algum item falhar, o setup mostra o comando manual equivalente e segue com os outros. Rodar de novo só refaz o que faltou.

## 8. Como desinstalar

1. Hooks: `npm run uninstall-hooks` (tira só as entradas do AG Pocket do `~/.claude/settings.json`).
2. Agentes: apague de `~/.claude/agents/` os 6 arquivos `planejador.md`, `pesquisador.md`, `dev.md`, `testador.md`, `revisor.md` e `documentador.md`.
3. Comandos: apague `~/.claude/commands/time.md`, `memoria.md` e `reuniao.md`.
4. Blocos do time e de memória: abra `~/.claude/CLAUDE.md` e apague tudo entre `<!-- ag-pocket:inicio -->` e `<!-- ag-pocket:fim -->` e entre `<!-- ag-pocket:memoria:inicio -->` e `<!-- ag-pocket:memoria:fim -->`, inclusive as linhas de marcador.
5. Variáveis (opcional): remova `CLAUDE_CODE_ENABLE_TODO_TOOLS` e `AGPOCKET_VAULT` de `env` no `~/.claude/settings.json`. O vault em si **não** é apagado: guarde ou apague a pasta à mão.
6. Playwright: `claude mcp remove playwright --scope user`.
7. Plugins e marketplaces, se quiser: `claude plugin uninstall <plugin>` e `claude plugin marketplace remove <nome>` (nomes na seção 5; o `superpowers` sai com `claude plugin uninstall superpowers@claude-plugins-official`, e os marketplaces extras se chamam `karpathy-skills` e `context-engineering-marketplace`), ou use `/plugin` dentro do Claude Code. Skills avulsas ficam em `~/.claude/skills/` (e `~/.agents/skills/`): apague a pasta da skill.
8. Por fim, apague a pasta do projeto.

## 9. Avisos

- **O repositório é privado.** Ele guarda a identidade visual da empresa (logo e cores). Não torne público nem compartilhe fora da empresa.
- **Antes de usar com dados da empresa**, confirme com a TI/segurança que os hooks, o servidor local e os plugins de terceiros são permitidos. Os hooks mandam cada evento do Claude Code (comandos, caminhos de arquivos, trechos de prompt) para o servidor local, que escuta só em `127.0.0.1`. O arquivo `data/escritorio.json` guarda esses caminhos e, em pasta sincronizada (OneDrive), sobe junto.
- **Os extras são de terceiros e rodam com as suas permissões.** Use `--completo` só depois de revisar a lista da seção 5.
- **O bloco de memória (Obsidian) não tem caminho pessoal.** O `team/CLAUDE-memoria.md` manda ler o vault da variável `AGPOCKET_VAULT` (`env` do `~/.claude/settings.json`), que o passo do vault grava.
- **Privacidade do vault:** nota com `confidencial: true` não é lida pelos agentes nem pelo painel; toda nota de reunião nasce confidencial; o painel recebe só títulos e a contagem de atas novas; o `/reuniao` troca nomes por papéis (revise a nota gerada). Nunca guarde senha, token, chave ou dado pessoal no vault. Regras completas no README ("Segundo cérebro").
- **Conteúdo de reunião em IA precisa de aprovação da TI/governança.** E lembre: com `AGPOCKET_GRAVAR=1` (desligado por padrão) o prompt cru, inclusive a ata colada no `/reuniao`, vai para `data/eventos/`.

## 10. Vault de teste e vault real

Para testar sem mexer na memória de verdade, use um **vault de teste**, com dados inventados.

1. Escolha uma pasta fora do repositório e fora do OneDrive da empresa, por exemplo `C:\Users\<voce>\dev\AG-Cerebro-teste`.
2. Aponte o setup para ela:
   ```powershell
   npm run setup -- --vault=C:\Users\<voce>\dev\AG-Cerebro-teste
   ```
   Se o `AGPOCKET_VAULT` já existir no `settings.json`, a flag é ignorada com aviso. Nesse caso, troque o valor à mão (veja abaixo).
3. Confira com `npm run setup:check`.
4. Gere atas fictícias para testar a leitura: `npm run ata-ficticia -- --cenario=projeto-software`. Detalhes no README, em "Atas fictícias".

**Apontar para o vault real depois:**
- O setup **não troca** um `AGPOCKET_VAULT` que já existe. Para mudar, edite o valor à mão no `env` do `~/.claude/settings.json` (faça backup antes).
- Se o terminal que sobe o `npm start` tiver `AGPOCKET_VAULT` definido, esse valor vence o do `settings.json`. Tire-o do terminal se for o caso.
- Depois, reinicie o `npm start` e abra uma sessão **nova** do Claude Code. Rode `npm run setup:check`.
- Se o vault real estiver incompleto, o setup não grava o caminho e avisa o que falta.
- Mantenha os dois separados: um vault de teste nunca deve apontar para a memória real, e vice-versa.

**Abrir o vault no Obsidian:**
1. Instale o Obsidian (https://obsidian.md) se ainda não tiver.
2. No Obsidian, escolha a opção de abrir uma **pasta como cofre** (vault).
3. Escolha a pasta do vault (a que está em `AGPOCKET_VAULT`).
4. No painel do AG Pocket, o botão "Abrir no Obsidian" da busca usa o **nome** dessa pasta. Dois vaults com o mesmo nome podem abrir o errado.

## 11. Variáveis `AGPOCKET_*`

Defina a variável no terminal antes de subir o servidor:

```powershell
$env:AGPOCKET_INGESTAO = "0"; npm start
```

O servidor **não herda** o `env` do `settings.json` do Claude Code. A única exceção é `AGPOCKET_VAULT`, que ele lê de lá quando a variável do terminal está vazia. Por isso, as outras variáveis precisam estar no terminal que sobe o `npm start`.

| Variável | Para que serve | Padrão |
|---|---|---|
| `AGPOCKET_VAULT` | Pasta do vault do Obsidian | Sem valor, o servidor lê o `env` do `~/.claude/settings.json` |
| `AGPOCKET_INGESTAO` | `0` desliga a leitura automática das atas do `00-Inbox/` (o `/reuniao` continua funcionando) | Ligada |
| `AGPOCKET_PROJETOS_DIR` | Pasta onde o Claude Code guarda as transcrições, usada na contagem de tokens. Serve sobretudo para testes | `~/.claude/projects` |
| `AGPOCKET_REPLAY_DIR` | Pasta do replay do dia (caminho relativo à raiz do projeto) | `data/replay` |
| `AGPOCKET_ESTADO` | Arquivo com o estado do escritório (caminho relativo à raiz do projeto) | `data/escritorio.json` |
| `AGPOCKET_GRAVAR` | `1` grava cada evento dos hooks em `data/eventos/`. Guarda o prompt cru, inclusive a ata do `/reuniao` | Desligada |
| `AG_SESSION_TIMEOUT_MIN` | Minutos sem nenhum evento até uma sessão sem sinal sair do escritório | 30 |
| `AG_SETUP_TIMEOUT_S` | Segundos de espera por item do `npm run setup` | 300 |
| `PORT` | Porta do servidor | 4848 |
| `STUDIO_PORT` | Porta para onde o `hooks/hook.mjs` manda os eventos. Se mudar `PORT`, defina `STUDIO_PORT` com o mesmo valor no ambiente do Claude Code | 4848 |

Se a porta 4848 já estiver em uso por outro programa, escolha outra com `PORT` (por exemplo `$env:PORT = "4800"; npm start`) e abra o endereço com essa porta.

## 12. Onde ficam os dados do painel

Tudo isso fica em `data/`, **fora do git**. Nenhum desses arquivos tem senha ou token, mas podem ter nomes de arquivos e caminhos da sua máquina.

| Caminho | O que é | Pode apagar? |
|---|---|---|
| `data/replay/AAAA-MM-DD.jsonl` | Resumo leve do dia, para o Replay. Guarda 30 dias (cerca de 5 MB por dia) | Sim |
| `data/gasto/AAAA-MM-DD.json` | Total de tokens por função, por dia. `_arquivos.json` guarda caminhos absolutos | Sim (o total de tokens zera) |
| `data/transparencia/AAAA-MM.jsonl` e `.md` | Log de arquivos do vault abertos pelos agentes, e a exportação do mês | Guarde ou apague à mão. Pode ter nome de arquivo sensível |
| `data/exportacoes/resultados-AAAA-MM-DD.md` | Cópia do resumo de Resultados exportado | Sim. No mesmo dia, o arquivo é substituído |
| `data/estimativas.json` | Minutos da estimativa de tempo economizado. Copie de `data/estimativas.example.json` | Sim. Sem o arquivo, vale o padrão |
| `data/escritorio.json` | Estado do escritório | Sim |

- Os dados de `data/replay/`, `data/gasto/`, `data/transparencia/` e `data/exportacoes/` **não** devem ir para outro PC (veja a seção 6).
- `AGPOCKET_ESTADO` troca só o `escritorio.json`. `data/gasto/` e `data/replay/` continuam na mesma pasta `data/`: dois servidores usando a mesma pasta misturam esses dados. Para testes em paralelo, use outra cópia do projeto.
