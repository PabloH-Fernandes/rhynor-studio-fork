# Rhynor Studio

> Fork do AG Pocket (remote `upstream`: escritorio-ia). A marca Rhynor entra na Etapa 1; por enquanto só nome, título e portas mudaram.

> Instalando em outro PC? Veja o [SETUP.md](SETUP.md).

Um escritório em pixel art que mostra, ao vivo, o seu time de agentes do Claude Code trabalhando. Cada agente é um **AGzinho**: um personagem com nome, uniforme da sua função e jeito próprio. Ele senta na mesa, digita quando usa uma ferramenta, levanta um **!** quando precisa de você, manda envelopes para os colegas e, quando fica de boa, vai tomar café, jogar ping-pong ou bater papo.

![Escritório rodando a simulação](docs/preview.png)

```
Claude Code ──hooks──▶ servidor Node (Express) ──WebSocket──▶ tela React + canvas
```

## O que você encontra no painel

- **Missões:** as missões do vault, com status e de qual reunião vieram.
- **Caixa de entrada:** reuniões lidas que esperam você decidir o que o time faz e o que fica com você.
- **Pendências:** tarefas em aberto, com prazo e responsável.
- **Resultados:** quanto o AG Pocket já ajudou (com o tempo economizado sempre como estimativa).
- **Transparência:** quais arquivos do vault os agentes abriram.
- **Buscar no cérebro:** procura texto nas notas do vault, sem IA.
- **Replay do dia:** toca de novo o que o time fez num dia.
- **Modo apresentação e demo:** para mostrar o escritório a outras pessoas, com dados fictícios.

## O que tem aqui

| Pasta | O que é |
|---|---|
| `agents/` | Os 6 subagentes do time ([[planejador]], [[pesquisador]], [[dev]], [[testador]], [[revisor]], [[documentador]]) |
| `team/CLAUDE-time.md` | Instruções para o Claude principal saber quando chamar cada agente e montar a lista de tarefas ([[CLAUDE-time]]) |
| `team/CLAUDE-memoria.md` | Bloco de memória no Obsidian; o vault vem de `AGPOCKET_VAULT` e o setup instala ([[CLAUDE-memoria]]) |
| `hooks/hook.mjs` | O hook: pega cada evento do Claude Code e manda para o servidor |
| `server/` | Recebe os eventos, traduz em "quem está fazendo o quê", guarda o elenco, lê o vault e transmite tudo para a tela |
| `shared/roster.ts` | Elenco padrão dos AGzinhos e as regras de validação (roda no servidor e no navegador) |
| `web/` | O escritório em si (React + canvas, tudo desenhado por código) |
| `web/src/theme.ts` | **Onde você personaliza** nome, logo, cores e uniformes |
| `web/src/office/map.ts` | Planta do escritório (posição das mesas e móveis) |
| `data/agzinhos.example.json` | Elenco de exemplo, versionado. O `data/agzinhos.json` real fica fora do git |
| `data/estimativas.example.json` | Modelo dos minutos usados na estimativa de tempo economizado |
| `setup/skills.json` | Catálogo do que o `npm run setup` instala (essenciais e extras de terceiros) |
| `commands/` | Comandos `/time`, `/memoria` e `/reuniao`, copiados para `~/.claude/commands/` pelo setup |
| `vault-template/` | Modelo do vault do Obsidian (o "segundo cérebro"); o setup cria o vault a partir dele |
| `docs/agentes-modelos.md` | Qual modelo cada agente usa e por quê |
| `docs/power-automate-reunioes.md` | Formato da ata que um fluxo do Power Automate deve gravar no `00-Inbox/` (não testado) |
| `docs/exemplos/ata-ficticia.md` | Ata inventada, no formato do Power Automate, para testar a leitura automática |
| `docs/roteiro-apresentacao.md` | O que falar em cada passo da demo, teclas e o que fazer se algo falhar |
| `scripts/setup.mjs` | O instalador (`npm run setup`, `npm run setup:check`); veja o [SETUP.md](SETUP.md) |

## Rodando (5 minutos)

Precisa de Node 20 ou mais novo e do Claude Code instalado e logado.

**Jeito rápido:** `npm run setup` faz tudo de uma vez (dependências, agentes, hooks, vault do Obsidian, comandos `/time`, `/memoria` e `/reuniao`, Playwright, plugins e build). Depois é só `npm start`. Opções e detalhes no [SETUP.md](SETUP.md). `npm run setup -- --dry-run` mostra o que ele faria sem escrever nada.

**Manual (alternativa):**

```bash
npm install

# 1. instala os 6 agentes em ~/.claude/agents (ficam disponíveis em todos os projetos)
npm run install-agents

# 2. liga os hooks em ~/.claude/settings.json (faz backup antes)
npm run install-hooks

# 3. sobe o escritório
npm run build
npm start          # abre em http://127.0.0.1:4848
```

Mudou o `model:` de algum agente em `agents/`? Rode `npm run install-agents` de novo. Até lá, o `npm run setup:check` avisa que os agentes estão desatualizados.

O servidor escuta **só em `127.0.0.1`**: outras máquinas da rede não enxergam o escritório nem conseguem mandar eventos para ele. A porta padrão é 4848 (mude com a variável `PORT`).

Agora abra uma sessão **nova** do Claude Code em qualquer projeto e peça algo. O líder aparece entrando pela porta e, quando ele delegar, os outros chegam.

Quer ver antes de ligar no Claude? Clique em **Rodar simulação** na tela.

### Fazendo o Claude usar o time

Rode `npm run setup`: ele coloca o bloco de `team/CLAUDE-time.md` no seu `~/.claude/CLAUDE.md`, entre marcadores. Ou copie o conteúdo à mão. Você também pode pedir direto: *"usa o planejador pra quebrar isso e depois o dev implementa"*. Dentro do Claude Code, `/agents` lista os agentes instalados.

### Desenvolvendo o escritório

```bash
npm run dev        # servidor + Vite com hot reload em http://localhost:5174
```

> **Dica:** se o time estiver editando o próprio AG Pocket, rode com `npm run build && npm start` em vez de `npm run dev`. O `tsx watch` reinicia o servidor a cada mudança em `server/` ou `shared/`. Com a persistência ninguém some, mas o último ~1 s antes do reinício pode se perder.

### Desligando

```bash
npm run uninstall-hooks
```

Com o servidor desligado os hooks não atrapalham nada: eles rodam em segundo plano e ignoram o erro de conexão.

Só quer em um projeto específico? Use `npm run install-hooks -- --project C:\caminho\do\projeto` (e o mesmo para `install-agents`).

## Segundo cérebro (vault do Obsidian) e reuniões

O time tem uma **memória**: um vault do Obsidian (uma pasta de notas) com reuniões, missões, projetos, decisões e lições. As reuniões são a porta de entrada: a ata vira nota e, **com o seu ok**, vira missão para o `/time`.

```
ata da reunião → nota em 10-Reunioes → você escolhe as tarefas → notas em 20-Missoes
→ /time executa → o painel mostra a missão e a reunião de origem → o documentador atualiza a memória
```

### Onde fica o vault

- **Sempre fora do repositório.** O setup recusa um vault dentro da pasta do código.
- **Um lugar só:** `AGPOCKET_VAULT` no `env` do `~/.claude/settings.json`. Agentes, comandos e servidor leem dali; nenhum arquivo do projeto tem caminho fixo.
- **O `npm run setup` cria o vault** a partir de `vault-template/`, se a pasta ainda não existir. **Nunca sobrescreve** um vault que já existe: só confere a estrutura e avisa o que falta.
- **Onde ele cria:** primeiro o `AGPOCKET_VAULT` que já estiver no settings.json; depois a flag `--vault=<pasta>`; e, se nada disso existir, a pasta `AG-Cerebro` ao lado do repositório.
  ```bash
  npm run setup -- --vault=~/Documentos/AG-Cerebro
  ```
- Se uma pasta **acima** do vault novo já for um vault do Obsidian (tem `.obsidian/`), o setup avisa: os links `[[ ]]` podem ficar ambíguos até o vault antigo ser arquivado.
- **O servidor** lê `AGPOCKET_VAULT` do ambiente e, se estiver vazia, do `env` do `~/.claude/settings.json` (o `npm start` não herda o env do Claude Code).

### Estrutura

| Pasta | O que tem |
|---|---|
| `_indice.md` | Mapa curto do vault. Os agentes leem **este** primeiro |
| `00-Inbox/` | Entrada bruta: atas e ideias soltas. Atas processadas vão para `00-Inbox/processadas/` (nunca são apagadas) |
| `10-Reunioes/` | Uma nota por reunião (nasce confidencial) |
| `20-Missoes/` | Uma nota por missão: origem, tarefas, status, commits |
| `30-Projetos/` | Uma nota por projeto ou repositório: contexto, stack, decisões |
| `40-Conhecimento/` | Padrões, glossário, "como fazer X", lições reutilizáveis |
| `50-Time/` | Um card por agente e o mapa `AGENTES.canvas` |
| `90-Memoria-do-time/` | Sessões, Decisões, Lições aprendidas e Pendências |
| `Templates/` | Modelos: Reunião, Missão, Projeto, Sessão, Decisão, Lição |

Toda nota tem o mesmo cabeçalho (frontmatter), e as notas se ligam por `[[ ]]`:

```yaml
---
tipo: missao          # reuniao, missao, ata, indice...
projeto: escritorio-ia
data: 2026-10-13
status: a fazer
origem: reuniao       # facilitator, power-automate, manual...
tags: [missao]
confidencial: false
---
```

### Regras de memória do time

O setup instala um bloco de memória (`team/CLAUDE-memoria.md`) no seu `~/.claude/CLAUDE.md`, entre os marcadores `<!-- ag-pocket:memoria:inicio -->` e `<!-- ag-pocket:memoria:fim -->`:

- **Começo de missão:** o líder lê `_indice.md`, depois **só** a nota do projeto em `30-Projetos/` e os itens de Decisões e Pendências ligados a ele. Nada de ler o vault inteiro.
- **Fim de missão:** o documentador atualiza a nota da missão (status, commits, o que mudou), a do projeto e a memória do time. Notas curtas, sem código nem logs.
- **Pesquisador:** consulta `40-Conhecimento/` antes de buscar na web e salva lá o que aprender de reutilizável.
- O líder passa o caminho do vault aos agentes que precisam dele.

### Comandos

| Comando | O que faz |
|---|---|
| `/memoria <pergunta>` | Responde **só** com base no vault, citando as notas como `[[nota]]`. Se não achar, diz "Não achei isso no vault" e não inventa. Não edita nada |
| `/reuniao` | Transforma uma ata (texto colado ou arquivo de `00-Inbox/`) em nota de reunião e, com o seu ok, em missões |
| `/time <tarefa>` | Roda a tarefa com o time. Se citar uma missão (`Missão [[nota]]`), ela vai para `em andamento` e o documentador marca `concluída` no fim |

### Atas que entram sozinhas (leitura automática, sem IA)

Com o servidor ligado, toda ata `.md` que cair na **raiz** de `00-Inbox/` é lida pelo próprio AG Pocket, **sem chamar o Claude**:

- Ele espera o arquivo ficar quieto (~2 s), extrai título, data, notas, decisões e tarefas (com responsável e prazo, quando houver), grava a nota em `10-Reunioes/` e move a ata bruta para `00-Inbox/processadas/`. Nada é apagado.
- A nota nasce com `confidencial: true`, `origem: leitura-automatica` e `processamento: sem-ia`. Os nomes de responsáveis e de quem falou viram "Responsável A, B..." (o nome original fica só na ata arquivada).
- **Nomes residuais podem sobrar** no texto (um nome que não era responsável nem falante). Cada nota traz o aviso para revisar.
- Rodar de novo não duplica: a mesma ata (mesma fonte com o mesmo hash, ou mesmo `reuniao_id`) não vira duas notas.
- Ata **fora do formato** (transcrição, sem cabeçalho fechado, sem seções) não é tocada: fica no Inbox e o painel mostra "precisa do /reuniao".
- Ao subir o servidor, atas boas que já estavam no Inbox são lidas na hora, sem o aviso de "ata nova".
- `AGPOCKET_INGESTAO=0` desliga a leitura automática. Vale só no terminal que sobe o servidor, porque o servidor não lê esse valor do `settings.json`.
- O formato da ata está em [docs/power-automate-reunioes.md](docs/power-automate-reunioes.md). **O fluxo do Power Automate ainda não existe** e nada disso foi testado com ele.

### Usando `/reuniao` passo a passo

Use quando a ata veio fora do formato, ou quando você cola o texto. Exemplo: a ata fictícia de `docs/exemplos/ata-ficticia.md`.

1. Copie a ata para `<vault>/00-Inbox/ata-2026-10-13-1900-clube-de-leitura.md` (ou cole o texto direto no comando).
2. No Claude Code, rode `/reuniao ata-2026-10-13-1900-clube-de-leitura.md`. Sem argumento, ele lista as atas com `status: nova` e pergunta qual usar.
3. Ele cria a nota em `10-Reunioes/AAAA-MM-DD-<titulo>.md` com `confidencial: true`, trocando nomes de pessoas por papéis ("voluntário de TI").
4. Mostra as tarefas classificadas: 🤖 o time pode fazer, 🙋 precisa de humano, ❓ não está claro. Na ata fictícia, o esperado é 🤖 1, 2 e 3; 🙋 4 e 5; ❓ 6.
5. **Pergunta quais viram missão** e de qual projeto (ex.: `1,3`). Nunca começa nada sozinho: só escreve notas.
6. Cria uma nota por missão em `20-Missoes/` (`status: a fazer`, com link para a reunião e o projeto) e **sugere**, sem rodar, o comando pronto. Exemplo ilustrativo:
   ```
   /time Missão [[2026-10-13-pagina-de-inscricao]]: criar a página de inscrição. Projeto: <projeto>
   ```
7. A ata do Inbox ganha `status: processada` e vai para `00-Inbox/processadas/`.

Quando você roda o `/time` sugerido, a missão passa de `a fazer` para `em andamento`. No fim, o documentador marca `concluída` e preenche o resultado (commits, o que mudou, sessão).

### Atas fictícias para testar e apresentar

`npm run ata-ficticia` grava uma ata inventada em `00-Inbox/` do vault configurado.

```bash
npm run ata-ficticia                                # um cenário sorteado
npm run ata-ficticia -- --cenario=projeto-software  # cenário escolhido
npm run ata-ficticia -- --sem-gravar                # só mostra o texto
npm run ata-ficticia -- --vault=C:\caminho\do\vault # vault específico (caminho absoluto)
```

- Cenários: `projeto-software`, `alinhamento-bi`, `so-decisoes`, `tarefas-sem-prazo` e `bagunçado` (também aceito como `baguncado`).
- O cenário `bagunçado` é uma transcrição de propósito: ele fica no Inbox esperando o `/reuniao`.
- Todos os nomes, empresas e projetos são inventados.

## O painel, parte por parte

### Missões

- A seção **Missões** (recolhível) mostra nome, status (a fazer / em andamento / concluída), barra de progresso quando a missão tem lista de tarefas e "📋 da reunião X". Clicar mostra o resumo da missão.
- Duas abas: **Abertas · N** (a fazer e em andamento) e **Concluídas · N**. O título "Missões · N" conta só as abertas. O navegador lembra a aba escolhida, e dá para trocar pelo teclado (setas, Home, End).
- Na aba Concluídas, cada item mostra "Nota de dd/mm/aaaa". É a **data da nota**, não a data de conclusão.
- O painel mostra até **50 abertas e 50 concluídas**, as mais recentes primeiro. As contagens das abas são os totais de verdade; quando há corte aparece "Mostrando as 50 mais recentes de N".

### Caixa de entrada

Aparece no topo do painel só quando há reunião para decidir. Cada reunião lida sem IA (`status: rascunho`) aparece com título, data e tarefas em aberto (responsável e prazo).

- Para cada tarefa você escolhe **🤖 Time faz**, **🙋 Eu faço** ou **🗑️ Ignorar** (botões com texto, que também funcionam pelo teclado). **Aprovar** só habilita quando todas têm escolha. Reunião sem tarefas mostra "sem tarefas" e o botão **Arquivar**.
- Ao aprovar, o servidor grava a escolha na linha de cada tarefa da nota (`classe: time` ou `classe: eu`; ignorar vira `- [-]`), cria **uma única missão** em `20-Missoes/` com todas as tarefas "Time faz" e muda a reunião para `status: processada`. Sem nenhuma tarefa "Time faz", não nasce missão.
- O painel mostra o **comando pronto** (`/time Missão [[nota]]: ...`) com o botão **Copiar comando**. **O painel nunca roda o Claude**: quem cola e executa o comando é você, no terminal.
- Tarefas "Eu faço" ficam na nota (`classe: eu`) e aparecem nas Pendências.
- Aprovar duas vezes a mesma reunião é recusado. Reiniciar o servidor mantém a lista, porque ela vem das notas do vault.
- **Limite:** o painel mostra as 40 primeiras tarefas em aberto (com aviso). As demais ficam intocadas na nota.
- **A aprovação é a sua revisão.** A missão nasce com `confidencial: false` e com o texto da tarefa como está na nota. Leia as tarefas antes de aprovar.
- **Conferência:** se a nota foi editada depois que o painel carregou, o servidor responde "A nota mudou, tente de novo", desfaz a missão criada e não sobrescreve a sua edição.
- **Ata nova no escritório:** quando a leitura automática lê uma ata, os AGzinhos livres sentam na mesa de reunião por ~12 s e o quadro da parede mostra "Nova ata" (sem o título, de propósito). Não substitui uma reunião de verdade (`/reuniao`) em andamento.

### Pendências

As tarefas em aberto com prazo, de duas fontes:

- **Reunião** (`10-Reunioes/`): só as linhas `- [ ]` com `classe: eu`, as que ficaram com você. Reuniões confidenciais entram aqui, mas o painel mostra só o título da nota, o texto, o responsável e o prazo da tarefa.
- **Missão** (`20-Missoes/`, que não esteja concluída nem confidencial): todas as linhas `- [ ]` da seção `## Tarefas`. O dono é o time; missão criada pelo `/reuniao` com `classe: humano` ou `duvida` fica com você.
- Cada item mostra texto, responsável, prazo (dd/mm/aaaa), origem, de quem é e o selo: **🔴 Atrasada**, **🟠 Vence em até 2 dias** ou **⚪ Sem prazo**. O selo sempre traz ícone e texto. Prazo inválido (como 2026-02-31) conta como sem prazo.
- Filtros **Minhas**, **Do time** e **Atrasadas** (o escolhido fica lembrado).
- **Concluir** marca a tarefa na nota (`- [x] ... | concluída: AAAA-MM-DD`) e o foco vai para o próximo item. Se era a última tarefa aberta da missão, a missão também vira `concluída` (com a data) e sai das pendências, indo para os Resultados. A resposta traz `missaoConcluida: true`. Missão `cancelada`, `pausada` ou com outro status não muda de status; só a tarefa é marcada.
- **Reabrir uma tarefa no Obsidian:** desmarque a caixinha de uma linha que o painel concluiu (a marca `| concluída: AAAA-MM-DD` continua na linha). O painel reabre a missão: ela volta a "em andamento", a pendência volta e os Resultados deixam de contar aquela missão e aquela pendência. A reabertura é calculada na leitura; o arquivo não é regravado. Concluir de novo troca a marca pela data nova.
- **No escritório:** com pelo menos uma pendência atrasada, um AGzinho do time que está de boa segura uma plaquinha de aviso (quadrado vermelho com "!"). Ela some quando não há mais atrasadas e fica parada se o sistema pede menos movimento.
- **Limites:** a tabela de `## Tarefas` que o `/reuniao` escreve (colunas com `|`, sem caixinha) **não entra**: só linhas `- [ ] texto | responsável: ... | prazo: AAAA-MM-DD`. Notas com nome fora de letras, números, espaço, hífen e sublinhado também ficam de fora. O painel mostra até 100 pendências.

### Resultados (estimativa)

Quanto o AG Pocket já ajudou, **contado das notas do vault**. A nota é a fonte da verdade: apagar uma nota derruba o número, e reiniciar o servidor não muda nada (não existe contador guardado em memória). O painel mostra **hoje**, **semana** (últimos 7 dias, contando hoje) e **total** de:

- **Atas processadas**, separadas em **sem IA** (a leitura automática; data = `processada_em`) e **com IA** (`/reuniao`; data = data da reunião). Reunião escrita à mão, sem esse marcador, **não conta** como ata.
- **Tarefas aprovadas** (das missões criadas pela Caixa, pela data `aprovada_em`). A tarefa "Time faz" existe na reunião e na missão, mas conta **uma vez só**.
- **Missões concluídas** (data = `concluida_em`). Missão concluída sem essa data entra **só no total**, e o painel avisa "data aproximada".
- **Pendências fechadas** (`- [x] ... | concluída: AAAA-MM-DD`).
- **Tempo economizado (estimativa):** contagem × minutos de cada tipo. O rótulo **(estimativa)** e a frase "O tempo economizado é uma estimativa, não uma medição exata." ficam sempre à vista. Nota de demonstração (`ficticia: true`) conta e o painel avisa.

**Minutos configuráveis** em `data/estimativas.json` (fora do git; copie `data/estimativas.example.json`): `ataProcessada` (20), `tarefaAprovada` (0), `missaoConcluida` (60) e `pendenciaFechada` (0). Vale sem reiniciar. Valor negativo, texto ou acima de 10000 é recusado: usa o padrão daquele item e avisa no log. Os valores **somam**: tarefa e pendência vêm em 0 por padrão para não contar o mesmo trabalho duas vezes.

**Exportar resumo:** gera um `.md` simples (números, período, minutos usados e a frase da estimativa), mostra o texto com **Copiar** e **Baixar**, e guarda uma cópia em `data/exportacoes/resultados-AAAA-MM-DD.md` (no mesmo dia, o arquivo é substituído).

Passando de 5000 notas por pasta, o servidor avisa no log e conta só as primeiras 5000. O painel só lê e exporta, e só números saem do servidor (nenhum título nem texto de nota).

### Transparência ("o que foi enviado ao Claude")

Mostra **quais arquivos do vault os agentes abriram**, para você conferir se nota confidencial foi lida. Os hooks já cobrem isso; não precisa reinstalar nada.

- **O que registra:** leituras e escritas (`Read`, `Write`, `Edit`, `MultiEdit`) e buscas (`Grep`, `Glob`) dentro do vault. Fora do vault, ignora.
- **Nunca grava conteúdo:** cada linha tem só a hora, a sessão, o agente, a ferramenta, a ação, o arquivo (relativo ao vault), se é confidencial e a missão. Nada do texto do arquivo, nada do que foi buscado.
- **Confidencial** = `confidencial: true` no começo da nota, ou qualquer coisa em `10-Reunioes/` e em `00-Inbox/` (menos o `LEIA-ME.md`).
- **Níveis (sempre ícone e texto):**
  - **ATENÇÃO** (vermelho): agente leu nota confidencial fora do `/reuniao`, leu algo de `10-Reunioes/` (mesmo durante o `/reuniao`), ou buscou dentro de lugar confidencial.
  - **Esperado** (âmbar): o próprio `/reuniao` abriu a ata do Inbox, ou outra nota confidencial.
  - **Aviso** (âmbar): busca na raiz do vault (pode alcançar notas confidenciais), ou edição em nota de pasta confidencial (menos o que o `/reuniao` faz normalmente).
  - O resto é normal.
- A faixa vermelha "ATENÇÃO" fica no painel enquanto o mês tiver violação e mostra sempre a última (hora e arquivo). A seção **Violações** guarda as 5 mais recentes do mês. A seção mostra também as atas do mês (sem IA e com IA).
- **Quando o registro é feito:** antes de o Claude Code pedir ou negar a permissão. Por isso uma leitura **negada também aparece**. A tela fala em "abriu", mas pode ter sido só uma tentativa.
- **Onde fica:** `data/transparencia/AAAA-MM.jsonl` (um arquivo por mês; a pasta `data/` fica fora do git). O botão **Exportar** grava `data/transparencia/AAAA-MM.md`.
- **O nome do arquivo pode ser sensível.** Uma nota como `10-Reunioes/Demissão Fulano.md` aparece com o nome como ele é, no log, na tela e no arquivo exportado. Trate o log e o export com o mesmo cuidado das notas.
- **Limite honesto (aparece sempre no painel):** só registra o que chegou do Claude Code ao servidor. **Leituras feitas por comandos de shell (`cat`, `type`, `Get-Content`) não são vistas**, nem o que acontece com hooks desligados ou com o servidor fora do ar. É um registro de conferência, não uma garantia de que nada foi lido.

### Buscar no cérebro

Campo **Buscar no cérebro** no alto do painel: procura texto nas notas do vault, na hora, **sem IA** e só para leitura.

- **O que busca:** o nome da nota, os cabeçalhos e o texto. Maiúscula e acento não importam; várias palavras valem juntas. Precisa de pelo menos 2 letras (até 80). Mostra até 20 notas, com trecho de uns 160 caracteres.
- **O que nunca mostra:** nota com `confidencial: true` e **tudo em `00-Inbox/` e `10-Reunioes/`** (mesmo sem a marca) aparecem **só pelo título**, com cadeado 🔒. O texto dessas notas nem fica na memória do servidor, e a busca não olha dentro delas. Se o cabeçalho da nota estiver ilegível ou se a releitura falhar, ela também fica só com o título.
- **Não busca:** `.obsidian`, `.trash`, `.git`, `Templates`, arquivos que não são `.md`, links simbólicos, **arquivos maiores que ~200 KB** (não aparecem, nem pelo título), pastas com mais de 6 níveis. Passando de 5000 notas, avisa no terminal e conta só as primeiras.
- **Abrir no Obsidian:** botão que usa um link `obsidian://open?vault=NOME&file=...`. O link leva só o **nome da pasta** do vault; dois vaults com o mesmo nome podem abrir o errado.
- **Perguntar ao time:** só **copia** `/memoria <sua busca>` para você colar no terminal. O painel nunca roda o Claude.
- **No modo apresentação a busca não aparece.**

### Replay do dia

Toca de novo o que o time fez num dia, num segundo escritório dentro do painel. O escritório ao vivo continua por trás, e o replay nunca escreve nele.

- **Como usar:** abra a seção, escolha o dia, aperte **Tocar** e escolha **10x, 30x ou 60x**. Arraste a barra para ir a qualquer hora. Sem dias gravados, aparece "Ligue o servidor durante o dia para ter replay."
- **Onde fica:** `data/replay/AAAA-MM-DD.jsonl` (dia local, fora do git). `AGPOCKET_REPLAY_DIR` troca a pasta (relativa à raiz do projeto). Fica sempre ligado, sem precisar do gravador.
- **O que guarda:** a hora de cada evento, o tipo, os ids da sessão e do agente, o tipo do agente (`dev`, `revisor`), o nome da ferramenta, o status e a estrutura das listas de tarefas. Caminhos viram `arquivo-N.ext` e a pasta vira `/projeto`.
- **O que NÃO guarda:** prompts, a ata do `/reuniao`, mensagens entre agentes, comandos, buscas, URLs, respostas das ferramentas, caminhos reais e texto livre. Por isso o replay mostra o que cada AGzinho fazia (trabalhando, pensando, esperando), mas não o assunto.
- **Limites:** cerca de 5 MB por dia (passou disso, o dia para de gravar e o terminal avisa uma vez) e 30 dias de retenção (os mais antigos são apagados quando o servidor sobe). Dia com mais de 20 mil mudanças mostra só as mudanças de status.
- **Na apresentação** a seção fica escondida.
- **API (só no próprio computador):** `GET /api/replay/dias` e `GET /api/replay/dia?data=AAAA-MM-DD`.

### Painel lateral

- **Time** e **O que tá rolando** são seções recolhíveis; o navegador lembra se você as deixou abertas.
- Cada linha do Time tem mini retrato, apelido, função e o status com ícone.
- O feed usa frases simples, sem jargão ("Editando App.tsx" vira "mexendo num arquivo"). Repetidos são agrupados. Há destaques: 🙋 precisa de você, 🏁 etapa concluída, 🎉 trabalho concluído, ✅ terminou a parte.
- O botão **Ver detalhes técnicos** troca as frases simples pelas técnicas; **Ver frases simples** volta.
- **Som** (no topo, ao lado do indicador de conexão): sons sintetizados no navegador, em volume baixo. Um **bip duplo** quando alguém passa a te esperar (o **!**), um **ding** quando um AGzinho entrega uma tarefa e cliques leves de teclado enquanto alguém trabalha (no máximo ~4 por segundo). Vem **ligado**; o botão desliga e o navegador lembra. Navegadores só liberam áudio depois de um clique ou tecla na página. Ao abrir ou reconectar o painel, nada toca.
- Visual de jogo em pixel: molduras em degrau, letras pixeladas e botões que afundam ao clicar.

As frases ficam em `shared/frases.ts` (reexportadas por `server/frases.ts`). As fontes são Press Start 2P (títulos) e VT323 (texto).

## Modelos por função e gasto de tokens

**Modelo por função.** Cada agente em `agents/*.md` tem um campo `model`:

| Agente | Modelo | Por quê |
|---|---|---|
| Dev | `inherit` (o da conversa) | Escreve o código: não economiza aqui |
| Revisor | `inherit` | Revisar bem exige o mesmo nível de quem escreveu |
| Planejador | `inherit` | Um plano ruim estraga o resto |
| Testador | `sonnet` | Escreve e roda testes: um modelo intermediário dá conta |
| Documentador | `haiku` | Texto curto e direto: o modelo mais leve basta |
| Pesquisador | `haiku` | Busca e resume informação. Lê a web: se a qualidade cair, volte para `sonnet` |

A justificativa completa está em [docs/agentes-modelos.md](docs/agentes-modelos.md). Depois de mudar `agents/`, rode `npm run install-agents`. Se a variável `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` estiver definida no seu computador, ela ignora esse campo para todos os subagentes.

**Gasto de tokens.** O escritório lê o registro (transcript) que o próprio Claude Code grava e soma os **tokens de hoje por função**. Aparece em "Tokens hoje" no topo do painel e no crachá de cada AGzinho (o cache lido vem à parte). Quando a missão atual vem de uma reunião, o total também vai para a nota dela (`tokens_total` e `tokens_atualizado_em`, no máximo 1 vez por minuto e ao fim da sessão).

- **É:** uma contagem de tokens lida do registro, atualizada quando um agente termina. Sem dado, o painel mostra "—" (nunca 0 nem estimativa). Na demo aparece "—".
- **Não é:** custo em dinheiro, gasto por tarefa nem leitura de conversa. Só números são lidos; nenhum texto do registro é guardado.
- **Segurança:** só abre registros `.jsonl` dentro de `~/.claude/projects` (que não sejam link simbólico). Caminhos de rede e de dispositivo são recusados. Os totais ficam em `data/gasto/AAAA-MM-DD.json` (fora do git).
- **Limites conhecidos:**
  - A nota da missão é **aproximada**. O valor ainda não gravado fica só na memória: se o servidor cair, o valor mais recente se perde (subconta). Se você editar `tokens_total` à mão, o valor novo vira a base do próximo incremento.
  - Só conta para a nota a missão pedida pela própria sessão (`/time Missão [[nota]]`), e só o que veio depois do pedido. Sem pedido, nada vai para nota alguma.
  - Registro reescrito ou truncado pelo Claude não é recontado.
  - Registro com 50 MB ou mais: lê só os últimos 50 MB e avisa uma vez no log. O que veio antes não entra na conta.
  - `data/gasto/_arquivos.json` guarda **caminhos absolutos** dos registros (não compartilhe a pasta). Guarda os 300 registros usados mais recentemente.
  - Na primeira leitura de um registro antigo, o painel também conta os dias anteriores que ele tiver. Isso não vai para a nota da missão.
  - É tokens, não dinheiro: **não** é custo em reais ou dólares, nem por tarefa.

## Modo apresentação e demo

Para mostrar o escritório a outras pessoas (reunião, projetor, gravação de tela):

- **`http://localhost:4848/?apresentacao=1`**: tela cheia, escritório maior e painel simplificado, só com **Caixa de entrada**, **Pendências**, **Resultados** e o quadro de etapas. Time, Missões, feed, Transparência, Replay, Busca, vestiário, Limpar e os botões técnicos ficam escondidos. O modo é **só leitura**: nada é aprovado, concluído nem exportado por ali. O botão **Tela cheia** e a tecla **F** ligam e desligam a tela cheia (o navegador aceita só depois de um clique ou tecla). O modo normal (`/`) continua igual.
- **`http://localhost:4848/?apresentacao=1&demo=1`**: roteiro automático de uns 3 minutos, em 5 passos (legenda "Passo n de 5" embaixo do escritório):
  1. chega uma ata fictícia (a animação de ata nova);
  2. ela aparece na Caixa com as tarefas;
  3. duas tarefas são aprovadas para o time e o comando `/time` aparece pronto;
  4. a simulação de AGzinhos trabalha;
  5. Pendências e Resultados atualizam, com os contadores subindo (sem animação se o sistema pede menos movimento). O tempo economizado aparece sempre como **estimativa**.
  `?demo=1` sozinho, sem `apresentacao=1`, não faz nada.
- **Teclas da demo:** `espaço` pausa e continua o roteiro (mesmo com um botão em foco), `→` avança um passo, `F` tela cheia. A pausa vale só para o roteiro: a simulação do servidor, depois de começar (passo 4), segue até o fim.
- **A demo é isolada:** a Caixa, as Pendências e os Resultados da demo são inventados (`web/src/demo/dadosDemo.ts`), vivem só no navegador e **não escrevem no vault**. O único pedido ao servidor é o `POST /api/demo` da simulação. O passo 1 anima a reunião com quem estiver no escritório: se estiver vazio, só o quadro da parede avisa "Nova ata" (rode a simulação uma vez antes, ou deixe uma sessão aberta).
- **Privacidade (melhor esforço):** na apresentação ela fica **sempre ligada**. Nomes de projeto (pasta), arquivos e caminhos, comandos e buscas, títulos de reunião e de missão, responsáveis e o texto das tarefas viram apelidos estáveis ("Projeto Alfa", "Reunião 1", "Responsável A", "arquivo 1"; a mesma entrada dá sempre o mesmo apelido). A troca acontece **no navegador** (`web/src/privacidade.ts`): os dados reais ainda chegam até ele e aparecem na aba Rede das ferramentas do navegador. Conversas entre agentes, descrições de subagentes e comandos viram rótulos genéricos ("Conversando", "Trabalhando numa tarefa", "Pesquisando"). Nomes só são trocados como palavra inteira.
  - **Não coberto:** texto livre que fuja desses rótulos, nomes com menos de 3 letras e nomes que ninguém registrou (fora de projeto, reunião, missão e responsável).
  - **Numa apresentação de verdade, o ideal é um vault fictício** (veja `npm run ata-ficticia` e o [SETUP.md](SETUP.md)).

O que falar em cada passo está em [docs/roteiro-apresentacao.md](docs/roteiro-apresentacao.md).

## Segurança e privacidade

### Pedidos ao servidor

O servidor só ouve `127.0.0.1`, mas uma página aberta no navegador poderia tentar mandar pedidos para ele. Por isso:

- **Pedidos que gravam** (Caixa, Pendências, exportar Resultados, exportar Transparência) exigem `Content-Type: application/json` e, se o pedido trouxer `Origin`, ele tem que ser `http://127.0.0.1:PORTA` ou `http://localhost:PORTA`. Pedido sem `Origin` (curl e scripts locais) passa.
- **Leituras** (`GET`) recusam `Host` que não seja `127.0.0.1:PORTA` ou `localhost:PORTA`. O WebSocket recusa `Origin` de outro site.
- O id da reunião é validado (só letras, números e hífen; nunca um caminho). Os arquivos só são montados dentro de `10-Reunioes/` e `20-Missoes/`. A missão é gravada sem sobrescrever. A nota é regravada de forma segura, mantendo CRLF e BOM, e as aprovações rodam uma de cada vez.
- A pendência só é regravada se a linha e a data do arquivo ainda forem as que o painel viu.
- No `npm run dev`, o proxy do Vite troca o `Origin` (porta 5174) pelo do servidor, para o POST funcionar.
- **Exceção conhecida:** `POST /api/demo` e `POST /api/reset` ainda **não** passam por essa checagem (não exigem JSON nem `Origin` do painel). O risco é só visual: a simulação e o "Limpar", que não mexem no vault. Fica para a próxima etapa.

### Privacidade

- Nota com `confidencial: true` **não é lida** pelos agentes nem pelo painel. Só o título pode aparecer na busca, com cadeado. Tudo em `00-Inbox/` e `10-Reunioes/` vale como confidencial, mesmo sem a marca.
- Toda nota de reunião **nasce confidencial**; só mude para `false` depois de conferir que não há nada sensível.
- A **leitura automática** roda no seu computador (`127.0.0.1`) e **sem IA**: nenhum conteúdo de reunião vai para o Claude antes da sua aprovação.
- O `/reuniao` troca nomes de pessoas por papéis ou áreas. Mesmo assim, **revise a nota gerada** e as missões.
- O painel recebe só o necessário: título neutro da reunião, dados da missão, a contagem de atas novas, e na Caixa e nas Pendências o título, a data, o texto, o responsável e o prazo das tarefas (reuniões: só as suas, `classe: eu`). Pauta, decisões e dúvidas das notas nunca vão para o painel.
- Nomes de arquivo podem ser sensíveis: eles aparecem na Transparência e nos logs de `data/`.
- Nunca guarde senha, token, chave ou dado pessoal no vault.
- `AGPOCKET_GRAVAR=1` (desligado por padrão) grava o prompt cru em `data/eventos/`, **inclusive a ata colada no `/reuniao`**. Veja "Gravador de eventos".
- Conteúdo de reunião em IA precisa de **aprovação da TI e da governança** antes do uso com dados reais.

### Power Automate (próximo passo)

A ideia é um fluxo do Power Automate gravar o resumo do Facilitator do Teams direto no `00-Inbox/`. O formato exato, as recomendações e o que conferir com a TI estão em [docs/power-automate-reunioes.md](docs/power-automate-reunioes.md). **O fluxo não existe e nada disso foi testado** com Power Automate real.

## Os AGzinhos

Cada agente do Claude Code vira um AGzinho do **elenco fixo**. O elenco padrão tem 12 pessoas (`DEFAULT_ROSTER` em `shared/roster.ts`). Todos os nomes são **fictícios**: qualquer semelhança com gente de verdade é coincidência.

| Nome | Apelido | Papel | Roupa | Acessório |
|---|---|---|---|---|
| Augusto Vilela | GUTO | Líder | terno + gravata dourada | relógio |
| Marina Toledo | MARINA | Planejadora | blazer marinho | prancheta |
| Caio Nogueira | CAIO | Pesquisador | polo marinho | óculos |
| Beatriz Lima | BIA | Desenvolvedora | camisa branca | headset |
| Rafael Mendes | RAFA | Testador | polo marinho | relógio |
| Lúcia Ferraz | LÚCIA | Revisora | blazer cinza | óculos |
| Davi Sampaio | DAVI | Documentador | camisa branca | lápis e barba |
| Yasmin Okada | YASMIN | Desenvolvedora (Dev 2) | polo marinho | headset |
| Tomás Ribeiro | TOMÁS | Pesquisador (Pesquisa 2) | camisa branca | prancheta |
| Iara Campos | IARA | Exploradora (convidada) | polo marinho + crachá de visitante | capacete branco |
| Jorge Batista | JORGE | Generalista (convidado) | camisa branca + crachá de visitante | colete |
| Sofia Arruda | SOFIA | Consultora (convidada) | polo marinho + crachá de visitante | caneca |

Como a escalação funciona:
- **O mesmo papel volta como a mesma pessoa.** Toda vez que o `dev` aparece, é a Bia; o `revisor` é sempre a Lúcia. O mesmo agente chamado de novo volta **à mesma mesa**.
- **Cada evento mexe só no AGzinho do próprio `agent_id`.** Um subagente nunca "puxa" o estado de outro.
- **Trabalho em paralelo ganha variação.** Se dois devs (ou dois pesquisadores) trabalham ao mesmo tempo, o segundo é a Yasmin (Dev 2) ou o Tomás (Pesquisa 2), com visual próprio.
- **Convidados por tipo de agente.** `Explore` é a Iara, `general-purpose` é o Jorge e qualquer outro tipo (como `Plan`) é a Sofia.
- **Visitantes são temporários.** Visitante é todo subagente de fora do time (Iara, Jorge, Sofia e os extras `ag:extra:<id>`). Ele usa uma mesa de visita e, no `SubagentStop`, **sai andando até a porta** (nunca fica "de boa": isso é só do time). Sem `SubagentStop`, sai sozinho depois de **3 min sem eventos** (`VISITANTE_SEM_EVENTO_MS`), a não ser que esteja esperando você. Depois de sair, o `agent_id` fica "aposentado" por ~60 s: evento atrasado dele não o traz de volta; só um `SubagentStart` do mesmo id reabre.
- **No máximo 3 visitantes na tela.** Os que passam disso continuam no estado, mas não aparecem no mapa (o painel mostra "+N visitantes"); o 4º entra quando um dos 3 sai, por ordem de chegada.
- **Visitante não conta no TIME.** O quadro da parede mostra `TIME 7 · VISITANTES 2 · FAZENDO 3`. `TIME` só tem o time (o trecho `VISITANTES` some quando não há nenhum), e `FAZENDO` é quem está trabalhando no mapa. Visitante também não conta na fase do quadro de etapas e não é gravado em `data/escritorio.json`.

## Ciclo de vida

- **Os AGzinhos ficam até o `SessionEnd`.** Terminar a tarefa (`Stop`) não manda ninguém embora: o time fica no escritório, de boa, até a sessão acabar.
- **"Trabalhando" só vale com ferramenta em andamento ou evento recente.** O servidor guarda, por agente, as ferramentas que começaram (`PreToolUse`) e ainda não terminaram (`PostToolUse` ou falha). Sem nenhum evento por **2 min** (`TRABALHANDO_EXPIRA_MS`), ou **10 min** se a ferramenta em andamento for o `Bash` ou um `Agent`/`Task` (`TRABALHANDO_BASH_MS`), o agente volta para "De boa". "Pensando" expira em **5 min** (`PENSANDO_EXPIRA_MS`): o Esc no prompt não dispara `Stop`. Ferramenta em andamento há mais de 10 min é descartada. Entregar o resultado (`SubagentHandback`) e perguntar a você (`AskUserQuestion`) não contam como trabalho; "esperando" (!) nunca expira.
- O `Stop` do líder faz todo mundo **daquela sessão** voltar para "de boa" (visitantes sem ferramenta em andamento saem; quem espera você continua esperando). Evento atrasado de quem acabou de dar `SubagentStop` (até ~5 s, `JANELA_TARDIO_MS`) não o traz de volta.
- **Ao restaurar, ninguém volta trabalhando.** `trabalhando` e `pensando` do `data/escritorio.json` viram "De boa" (o líder, "Esperando seu próximo pedido"); o próximo evento de verdade põe o agente para trabalhar de novo.
- **Reiniciar não manda ninguém embora.** O estado fica em `data/escritorio.json` (fora do git), salvo ~1 s depois de cada mudança e ao desligar o servidor. Mude o caminho com `AGPOCKET_ESTADO`. O arquivo guarda as atividades **com caminhos de arquivos**: se o projeto estiver numa pasta sincronizada (OneDrive, por exemplo), ele sobe junto. Atenção.
- **`/compact` e `/resume` mantêm o time.** O `/clear` **transfere** o time para a conversa nova (mesmo projeto, em até 30 s).
- **Sessão sem sinal expira.** Se o Claude Code fechar sem mandar o `SessionEnd` (terminal fechado na marra, queda de energia), a sessão sai sozinha depois de `AG_SESSION_TIMEOUT_MIN` minutos sem nenhum evento (padrão: **30**). Quem está esperando você (o **!**) nunca expira, e a sessão com ferramenta em andamento espera 4x mais.

  ```powershell
  # PowerShell
  $env:AG_SESSION_TIMEOUT_MIN = "60"; npm start
  ```
  ```bash
  # bash
  AG_SESSION_TIMEOUT_MIN=60 npm start
  ```
  Valor vazio usa o padrão; valor inválido (zero, negativo, texto) avisa no console e também usa o padrão.
- **Sessão real vence a simulação.** O Guto da simulação não disputa com o Guto de uma sessão real: se uma sessão de verdade está rodando, ela fica com o papel de líder.
- **"Limpar" cancela a simulação** em andamento, esvazia o escritório e apaga também o `data/escritorio.json`.

## Vida no escritório

Quem está de boa não fica parado. O agendador (`web/src/office/activities.ts`) sorteia uma atividade de descanso:

- **Café** na copa (às vezes leva o copo para a mesa e termina de beber lá);
- **Ping-pong**, em dupla;
- **Papo**, em duas ou três pessoas, cada uma com as falas do próprio elenco;
- **Sofá com celular**;
- **Maquete** de obra, na mesa de reunião;
- **Bebedouro**;
- **Regar** a planta;
- **Espreguiçar**.

O **trabalho sempre ganha do descanso**: quando chega tarefa, quem está descansando larga o que está fazendo e volta para a mesa (o descanso só começa depois de uns 20 s sem trabalho). Os balões de fala do papo são discretos e **não se sobrepõem** (o motor enfileira os balões, em `web/src/office/bubbles.ts`).

## Crachá e Vestiário

- **Mesas com a função:** cada mesa mostra a função de quem a usa (LÍDER, PLANEJAMENTO, PESQUISA, DESENVOLVIMENTO, TESTES, REVISÃO, DOCUMENTAÇÃO, CONVIDADO ou LIVRE). Quando não cabe, abrevia ("DESENVOLV. 2"). O apelido não aparece na mesa.
- **Crachá:** clique num AGzinho no escritório ou na lista "Time" do painel. Abre uma ficha com nome, cargo, matrícula, personalidade, o estado atual, **"O que eu faço"**, **"Sou responsável por"** e a barra de entregas do dia (10 por nível; "Nível N" só aparece a partir da 10ª entrega).
- **Vestiário:** botão **Vestiário** no painel, ou **Personalizar** no crachá. Dá para mudar nome, apelido, gênero, tom de pele, cabelo (estilo e cor), roupa, destaque, acessórios e os textos "O que eu faço" e "Sou responsável por", com a pré-visualização ao lado.

Regras de uniforme (o vestiário só oferece o que é permitido, e o servidor confere de novo):
- **Terno só no líder.**
- **Blazer no planejador e no revisor.**
- **Polo marinho ou camisa branca** nos outros papéis.
- **Um acessório por região do corpo**: cabeça, pelos, rosto, tronco, mão e pulso. Por isso barba e óculos convivem, mas dois acessórios de cabeça não.
- **O cargo acompanha o gênero**: Desenvolvedora ou Desenvolvedor, Revisora ou Revisor.
- **Campos fixos**, que o vestiário não muda: papel, cordão do crachá, matrícula e falas.

**Onde fica salvo:** `data/agzinhos.json`, escrito pelo servidor e **fora do git**. O `data/agzinhos.example.json` é o modelo. Sem o arquivo, vale o elenco padrão.

**API:**
```bash
curl http://127.0.0.1:4848/api/roster                 # lê o elenco
curl -X PUT http://127.0.0.1:4848/api/roster \
     -H "Content-Type: application/json" -d @elenco.json   # grava (valida antes)
```
O `PUT` valida tudo e ignora tentativa de mexer em campo fixo.

## Quadro "AGzinhos na Etapa X"

No topo do painel, o quadro mostra em que etapa o trabalho está ("AGzinhos na Etapa 3 de 6") e quem está nela. Ele pega os dados nesta ordem:

1. **A lista de tarefas do Claude Code**: `TaskCreate`/`TaskUpdate` ou `TodoWrite` (`server/progress.ts`). A tarefa `in_progress` é a etapa atual.
2. **A reserva por papel**: sem lista de tarefas, o quadro deduz a fase pelos papéis que estão trabalhando.
3. **"De boa"**: sem ninguém trabalhando.

A regra que faz o líder montar a lista está em `team/CLAUDE-time.md`: em trabalho com mais de 2 etapas, criar uma tarefa por etapa e atualizar o status.

### Ferramentas de tarefa por modelo

As ferramentas de tarefa existem **por padrão** no Claude 3.x, Opus 4 a 4.7, Sonnet 4 a 4.6 e Haiku 4.5 (Claude Code v2.1.268 ou mais novo). Nos outros modelos, ative com `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (requer Claude Code v2.1.233 ou mais novo):

```bash
# bash: variável de ambiente no shell
export CLAUDE_CODE_ENABLE_TODO_TOOLS=1
```
```powershell
# PowerShell
$env:CLAUDE_CODE_ENABLE_TODO_TOOLS="1"
```
```json
// ou no settings.json do Claude Code
{ "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
```

`CLAUDE_CODE_ENABLE_TASKS=0` troca as ferramentas `Task*` pelo `TodoWrite`. Sem nenhuma delas, o quadro continua funcionando pela reserva por papel.

Fontes: https://code.claude.com/docs/en/agent-sdk/todo-tracking e https://code.claude.com/docs/en/env-vars

## Gravador de eventos (para investigar)

`AGPOCKET_GRAVAR=1` grava **cada evento** que chega dos hooks em `data/eventos/AAAA-MM-DD.jsonl`, para investigar o que aconteceu numa sessão real. Desligado por padrão e fora do git. (`AG_HOOK_LOG=1` ainda funciona, mas está obsoleto.)

```powershell
$env:AGPOCKET_GRAVAR = "1"; npm start
npm run replay -- data/eventos/2026-10-05.jsonl                            # linha do tempo e estado final
npm run replay -- --anonimizar data/eventos/2026-10-05.jsonl saida.jsonl   # cópia sem dados pessoais
```

Atenção: o arquivo guarda o prompt cru, **inclusive a ata colada com `/reuniao`** (que é confidencial), além de comandos, pastas e caminhos da sua máquina. **Nunca compartilhe o arquivo cru**; para virar fixture de teste (`server/fixtures/sessoes/`), use só a cópia anonimizada.

## Simulação

O botão **Rodar simulação** conta uma sessão inteira, com as mesmas situações de uma sessão real:

- o líder (Guto) recebe o pedido, monta uma lista de 6 tarefas e chama a Marina e o Caio; o quadro sai de "Planejamento" para "Etapa 1 de 6";
- os dois entregam, comemoram e **ficam** no escritório, indo descansar;
- **dois devs trabalham em paralelo** (Bia e Yasmin) junto com o Rafa, que pede permissão (o **!** laranja) e troca envelopes com eles;
- quando os três entregam, fica todo mundo de boa ao mesmo tempo: aparecem **ping-pong, papo e café**;
- no meio do descanso o **Caio é chamado de novo**, larga o que estava fazendo, volta para a mesa e entrega pela segunda vez;
- a Lúcia revisa, o Davi documenta e o quadro chega em "concluíram 6 de 6";
- o líder termina ("Terminou, esperando você") e, no fim da sessão, todos saem pela porta.

Dá para ver tudo sem ligar o Claude. Ela vive em `server/demo.ts`; **Limpar** interrompe. Se uma sessão real estiver aberta, ela fica com o Guto e a simulação usa convidados no lugar dos AGzinhos ocupados.

## Identidade

O produto se chama **AG Pocket** (nome no cabeçalho do painel e no favicon). O escritório segue a identidade visual da Andrade Gutierrez: a placa da recepção tem a logo da empresa. Marinho `#051733` + branco; o marinho foi lido direto do pixel do fundo da logo oficial. Tudo é desenhado por código; nenhuma imagem gerada por IA.

**Cores com regra:**
- **Laranja de obra `#FF8A00`** é exclusivo do estado "te esperando" (o **!** e o alerta no painel), e sempre aparece sobre marinho. Nenhum cordão de crachá pode usar essa cor.
- **Âmbar escuro** é o do "vence em até 2 dias" no painel.
- **O testador é turquesa** (`#2EC4B6`) para não competir com o laranja.
- Os HEX ficam em `palette` (`web/src/theme.ts`), a fonte única.

**O que tem no escritório:**
- Placa da recepção com a logo oficial em pixels duros (a PNG é reduzida e vira só marinho e branco).
- Janelas com guindaste e prédio em obra (o céu muda com a hora).
- Quadros de ponte e de torre, sofás, impressora, cabideiro com capacetes, balcão "AG", credenza e plantas.
- Maquete de obra na mesa de reunião.

**Uniformes por papel** (cada um tem a cor do papel no cordão do crachá, na gola, na manga ou no lenço):

| Papel | Uniforme | Detalhe na cor do papel |
|---|---|---|
| Líder | terno marinho escuro + gravata dourada, crachá AG na lapela | gravata |
| Planejador | blazer marinho | lenço de bolso |
| Revisor | blazer cinza | lenço de bolso |
| Pesquisador | polo marinho, logo AG branca no peito | gola |
| Testador | polo marinho, logo AG branca no peito | manga |
| Dev | camisa branca, logo AG marinha no peito | gola |
| Documentador | camisa branca, logo AG marinha no peito | manga |
| Convidado | polo ou camisa + crachá cinza "visitante" | só o crachá |

Os acessórios (óculos, headset etc.) são do AGzinho, não do papel: veja o elenco acima.

**Iluminação pela hora real.** O escritório acompanha o relógio do computador: manhã, tarde, entardecer e noite. Para ver uma hora específica, use `?hora=HH.MM` na URL:

```
http://localhost:5174/?hora=22      # noite
http://localhost:5174/?hora=7.30    # 7h30 (formato HH.MM, não decimal: 7.5 seria 7h05)
```

Também aceita `HH:MM`. Valor inválido é ignorado e vale a hora real.

**Animações:** o agente espreguiça ao ficar livre e comemora com confete ao entregar a tarefa. Com `prefers-reduced-motion` ativado no sistema, as duas viram um gesto curto, sem pulo. A decoração também para: LEDs e folha da impressora apagados, vapor do café sumido e linhas de código do monitor num quadro fixo. O canvas sempre desenha em **escala inteira**, para manter os pixels nítidos.

**Zoom e navegação:** o escritório é uma câmera livre (zoom de 50% a 600%, sem redesenhar o canvas).
- **Mouse:** roda dá zoom no ponto do cursor; arrastar move; duplo clique alterna 2x e "ajustar".
- **Trackpad e toque:** pinça (ou Ctrl + roda) dá zoom; um dedo arrasta; duplo toque alterna 2x e "ajustar".
- **Teclado:** setas movem, `+`/`-` dão zoom, `0` ajusta.
- Botão **Ajustar** e o rótulo ZOOM no canto. Um clique simples seleciona um AGzinho após ~300 ms (espera o duplo clique). Respeita `prefers-reduced-motion`.
- Nos botões e no teclado o zoom para em escala inteira; no zoom intermediário (roda, pinça) os pixels ficam um pouco menos nítidos.

## Como personalizar

Tudo visual fica em `web/src/theme.ts`. O resto do código lê de lá. Quem são os AGzinhos fica no elenco.

### Mudar o elenco
- **Pelo Vestiário**, na tela (o jeito fácil), ou
- **Pelo JSON**: copie `data/agzinhos.example.json` para `data/agzinhos.json` e edite. Campo ausente cai no padrão; um arquivo inválido é recusado com a lista de erros. O padrão de fábrica está em `DEFAULT_ROSTER` (`shared/roster.ts`).

### Criar um acessório novo
Os passos estão no comentário de `web/src/office/accessories.ts`:
1. Some o nome em `Acessorio` e `ACESSORIOS`, e a camada dele em `CAMADA_DO_ACESSORIO` (`shared/roster.ts`);
2. Desenhe o acessório em `DESENHOS`, em `accessories.ts` (de perfil, desenhe virado para a direita);
3. Dê o nome em português em `NOME_ACESSORIO` (`web/src/components/vestiarioLogic.ts`).

O TypeScript reclama se faltar o passo 2 ou o 3.

### Tempo de sessão
`AG_SESSION_TIMEOUT_MIN` (minutos, padrão 30). Veja "Ciclo de vida".

### Várias sessões e projetos
Cada sessão do Claude Code mostra o **projeto** (nome da pasta do `cwd`) na etiqueta do líder no mapa e no crachá; os subagentes herdam o projeto do líder. Com mais de um projeto aberto, o painel mostra **Mostrar: todas as sessões / só o projeto X**. O projeto é só o **nome da pasta**: duas pastas com o mesmo nome em lugares diferentes se misturam no filtro. O navegador lembra a escolha. O aviso "te esperando" olha **todos** os agentes, mesmo com filtro, e diz quantos estão em outro projeto. A lógica fica em `web/src/projetoLogic.ts`.

### `AGPOCKET_IGNORAR_PRINT`: não implementado (de propósito)
A ideia seria descartar as sessões de `claude -p` (modo não interativo). Não dá para identificá-las pelos eventos: o JSON dos hooks não diz como o Claude foi iniciado (conferido na documentação de hooks, https://code.claude.com/docs/en/hooks, e em `HookInput` em `server/state.ts`). `permission_mode` é o modo de permissão, não o de execução. Como também não há sinal confiável, não foi criada heurística: ela esconderia sessões de verdade. Se a Anthropic passar a mandar esse campo, é só descartar o `session_id` em `server/index.ts` antes da fila.

### Trocar a logo
1. Coloque a nova PNG em `web/public/` (ex.: `logo-minha-empresa.png`).
2. Aponte para ela em `theme.logoUrl`:
   ```ts
   logoUrl: "/logo-minha-empresa.png",
   ```
3. A placa da recepção reduz a imagem para pixels duros e aplica um **limiar marinho/branco**: só existem essas duas cores na placa, então logos coloridas perdem a cor. Prefira logo de alto contraste.
4. Se `logoUrl` for vazio ou a imagem falhar ao carregar, a placa cai para o "AG" em pixels de `web/src/office/agMark.ts` (`AG_LETTERS`, e `AG_CHEST` para o peito do uniforme).
5. O favicon é `web/public/favicon-agpocket.svg`, referenciado em `web/index.html`.

### Trocar cores
1. Edite `palette` em `web/src/theme.ts` (ex.: `navy900` é a cor da marca).
2. Atualize as variáveis do `:root` em `web/src/styles.css` com os mesmos HEX. O CSS não lê o TypeScript, então os dois **precisam ficar em sincronia** (o comentário no topo do arquivo lembra disso).
3. `theme.colors` liga a paleta ao cenário. `palette.sky` define o céu por hora.

### Trocar uniformes
- Em `theme.uniforms` cada papel é montado com uma destas funções: `polo(accent, trim)`, `camisa(accent, trim)`, `blazer(shirt, shirtShade, accent, pants)`; o líder é um objeto `terno` escrito à mão. Exemplo, o dev de polo com manga colorida:
  ```ts
  dev: polo(ROLE_COLORS.dev, "manga"),
  ```
- `trim` é `"gola"`, `"manga"` ou `"lenco"`. Papéis sem entrada usam `uniforms.convidado`.
- `ROLE_COLORS` (exposto como `theme.roleColors`) define a cor do papel: cordão, plaquinha da mesa e painel. `theme.deskLabels` define o texto da plaquinha.
- Tons de pele e cabelo: `SKIN_TONES` e `HAIR_COLORS` em `shared/roster.ts`. Estilos de cabelo: `EstiloCabelo`, desenhados em `web/src/office/sprites.ts`.
- Regras de uniforme (quem pode usar terno, blazer etc.): `ROUPAS_PERMITIDAS` e `DESTAQUES_PERMITIDOS`.

### Layout e sprites
Para mudar o layout, mexa em `DESKS` no `web/src/office/map.ts`. Os móveis ficam em `map.ts` e nos módulos `decorMoveis.ts` e `decorJanela.ts`, com os helpers de desenho em `decorBase.ts` (`decor.ts` só reexporta os três). Os personagens são desenhados com retângulos em `web/src/office/sprites.ts` (e nos módulos de corpo, cabelo e acessórios), então dá para mudar cabelo ou adicionar capacete sem mexer com imagens. Os sprites ficam em cache (`spriteCache.ts`). A luz do dia está em `web/src/office/daylight.ts`.

> Para usar a marca oficial: peça a logo e o manual de marca ao time de comunicação e mantenha o repositório privado.

## Como funciona por dentro

1. O Claude Code dispara um **hook** a cada evento (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `Stop`...). O `hook.mjs` manda o JSON do evento para o servidor e sai na hora.
2. O **servidor** (`server/state.ts`) junta os eventos em agentes: o líder é a sessão, cada subagente é identificado pelo `agent_id` que o Claude Code manda. A ferramenta usada vira uma frase ("Editando App.tsx"). O `server/progress.ts` monta o quadro de etapas e o `server/roster.ts` guarda o elenco.
3. A **tela** recebe tudo por WebSocket. O `engine.ts` decide para onde cada personagem vai (mesa do papel, mesa de convidado ou em pé na mesa de reunião), anda pelo corredor e desenha.

Se você abrir várias sessões ao mesmo tempo, cada uma traz o seu líder.

## Referência técnica (rotas e mensagens)

Para quem vai mexer no código. Tudo responde só ao próprio computador.

| Rota | O que faz |
|---|---|
| `GET /api/missoes` | Missões (até 50 abertas e 50 concluídas), os totais de cada grupo e a contagem de atas novas |
| `GET /api/caixa` | Reuniões de `10-Reunioes/` que esperam decisão (título, data, tarefas). Pauta, decisões e dúvidas nunca saem do servidor |
| `POST /api/caixa/aprovar` | Corpo `{ "reuniao": "<nota sem .md>", "decisoes": [{ "n": 1, "acao": "time" ou "eu" ou "ignorar", "h": "<hash de 8 hex>" }] }`, com **todas** as tarefas mostradas (máximo 40). Responde `{ ok, comando, missao }`. Erros: `400`, `404`, `409` (já aprovada ou nota mudou), `403`, `415` |
| `GET /api/pendencias` | Pendências com `dono` (`eu` ou `time`) e `urgencia` (`atrasada`, `logo`, `no-prazo`, `sem-prazo`) |
| `POST /api/pendencias/concluir` | Corpo `{ "id": "r:<nota>:<n>:<hash>" ou "m:...", "h": "<hash de 8 hex>" }`. Responde `{ ok, concluidaEm }`. Erros: `400`, `404`, `409` (a linha ou o arquivo mudou; nada é gravado), `403`, `415` |
| `GET /api/resultados` | Contagens de hoje, semana e total, e o tempo economizado (minutos) |
| `POST /api/resultados/exportar` | Grava `data/exportacoes/resultados-AAAA-MM-DD.md` e responde `{ ok, arquivo, texto }` |
| `GET /api/transparencia?mes=AAAA-MM` | Log do mês (as últimas 100 linhas), contagens, alerta e atas do mês. Mês inválido dá `400` |
| `POST /api/transparencia/exportar` | Corpo `{}` ou `{ "mes": "AAAA-MM" }`. Grava `data/transparencia/AAAA-MM.md` |
| `GET /api/busca?q=...` | Busca no vault (mínimo 2 letras, até 80). Nota confidencial só com o título |
| `GET /api/replay/dias` e `GET /api/replay/dia?data=AAAA-MM-DD` | Dias gravados e o resumo de um dia |
| `GET /api/roster` e `PUT /api/roster` | Lê e grava o elenco (o `PUT` valida antes) |
| `POST /api/demo` e `POST /api/reset` | Simulação e "Limpar" (ainda sem a checagem de `Origin`, veja Segurança) |
| `POST /api/hook` | Recebe os eventos dos hooks do Claude Code |

**WebSocket:** o servidor manda `missoes`, `reuniao` (uma reunião começou ou acabou), `caixa`, `ata-nova` (só texto fixo e hora, para a animação), `pendencias`, `resultados`, `transparencia` (no máximo uma vez por segundo) e as atualizações do escritório.

**Dentro do vault:** `server/vault.ts` (caminho do vault), `server/vaultWatcher.ts` (observa mudanças, relê a cada ~30 s), `server/ingestao.ts` (leitura automática), `server/aprovacao.ts` (Caixa), `server/pendencias.ts`, `server/resultados.ts`, `server/transparenciaLog.ts`, `server/busca.ts`, `server/gastoTokens.ts`, `server/resumoDia.ts` e `server/replayRotas.ts`. A segurança dos pedidos fica em `server/seguranca.ts`.

## Testes

```bash
npm test      # node:test via tsx
npm run typecheck
```

Os testes ficam ao lado do código que cobrem:
- `server/state.test.ts`: ciclo de vida, timeout, sessões e eventos;
- `server/sessoes.test.ts`, `server/bordas.test.ts`, `server/replay.test.ts`: sessões reproduzidas com `reproduzir()` (retomada, 3 em paralelo, eventos fora de ordem, reinício do servidor), a partir das fixtures anonimizadas em `server/fixtures/sessoes/`;
- `server/persistencia.test.ts`: `data/escritorio.json`, /compact e /clear;
- `server/gravador.test.ts`: o gravador de eventos;
- `server/frases.test.ts`, `server/frases.extra.test.ts`: frases simples sem jargão;
- `server/progress.test.ts`: quadro de etapas (TodoWrite, TaskCreate/TaskUpdate, reserva por papel);
- `server/roster.test.ts`: persistência do elenco e o `PUT /api/roster`;
- `shared/roster.test.ts`: validação e regras de uniforme;
- `server/ingestao.test.ts`, `server/vault.test.ts`: leitura automática e observação do vault;
- `server/pendencias.test.ts`, `server/estimativas.test.ts`, `server/transparencia.test.ts`: Pendências, minutos da estimativa e Transparência;
- `server/busca.test.ts`, `server/gastoTokens.test.ts`, `server/resumoDia.test.ts`: busca, gasto de tokens e replay do dia;
- `web/src/demo/*.test.ts`, `web/src/privacidade.test.ts`: roteiro da demo, dados e privacidade da apresentação;
- `web/src/office/deskLabel.test.ts`, `web/src/xp.test.ts`, `web/src/progresso.test.ts`: rótulos das mesas, barra de entregas e quadro na tela;
- `web/src/office/camera.test.ts`, `web/src/office/activities.test.ts`, `bubbles.test.ts`, `overlay.test.ts`: câmera do zoom, atividades de descanso, balões e camadas;
- `web/src/components/vestiarioLogic.test.ts`: lógica do vestiário.

Alguns testes são pulados no Windows quando o sistema não permite criar links simbólicos (é preciso o Modo Desenvolvedor) ou quando o sistema de arquivos não aceita nomes com acento decomposto.

## Como o time construiu isso

A identidade AG foi feita pelo próprio time de agentes, em três fases. Depois veio a missão v2, que deu vida aos AGzinhos.

### Fase 1: descoberta (em paralelo)
- **Líder:** leu o HEX exato dos PNGs (`#051733` na logo horizontal, `#01102F` no símbolo) e fechou 4 decisões com o usuário: editar só favicon e title do `index.html`; laranja de obra para o estado de espera; porcelanato cinza-azulado; logo PNG em pixels duros. Testador em turquesa e commits só de código.
- **Pesquisador:** trouxe técnicas de pixel art 3/4, lightmap com `multiply` + `lighter`, paletas com hue shift (Lospec Apollo, Sweetie16, Endesga32), animações e o método de "assar" a logo em pixels duros.
- **Planejador:** mapeou a arquitetura (lanes, faixas livres, eventos que disparam animações) e escreveu a proposta com paleta, uniformes, cenário e 6 etapas.

### Fase 2: 6 etapas
Cada etapa seguiu o ciclo: dev implementa, roda typecheck e build e tira prints com Playwright, testador, revisor, ajustes, commit. Os prints de conferência ficam em `prints/` (não versionados).

1. **Paleta e painel:** tokens, tema e painel lateral. Voltou: subtítulo quebrando e HEX soltos no código.
2. **Uniformes AG e personagens:** Voltou: cordão de lado parecia gravata, crachá sumia na camisa branca, "!" do monitor ainda amarelo; a logo do peito virou forma de "A".
3. **Parede de recepção:** logo AG na placa e janelas com obra. Voltou: cache da falha do bake, translação, limiar só em k=1.
4. **Piso, mobília e detalhes marinho:** Voltou: anel de hover invisível, tapete escuro escondia uniformes marinho, metade de baixo desequilibrada (entrou a credenza), vapor do café.
5. **Animações de espreguiçar e comemorar:** Voltou: espreguiçar parecia capuz, o líder comemorava no `SessionEnd`, confete branco sumia.
6. **Iluminação pela hora real:** Voltou: quadro ilegível à noite, luzes de teto fortes, 18h salmão competindo com o laranja, luar como manchas, personagens virando silhueta.

### Fase 3: documentação
O documentador escreveu este README.

### Missão v2: os AGzinhos ganham vida

**Fase 1: descoberta e plano.** O pesquisador e o planejador leram as referências. O usuário aprovou o elenco e decidiu: mapa de 36 colunas, líder também no descanso, servidor só em `127.0.0.1`, quadro de etapas no lugar dos contadores, "AG Pocket" como nome, testador turquesa e escala sempre inteira.

**Fase 2: 9 etapas.** Mesmo ciclo da v1 (dev, testador, revisor, ajustes, commit). O que entrou e o que testador e revisor devolveram ao dev:

1. **Elenco e persistência** (`8fb3295`): `shared/roster.ts`, `data/agzinhos.json` e `GET/PUT /api/roster`. Voltou: o PUT precisava normalizar igual ao load; saneamento por AGzinho.
2. **Ficar até o fim da sessão** (`ce52c0c`): mesmo papel volta como a mesma pessoa, AGzinhos "de boa" até o `SessionEnd`, timeout de sessão, "Limpar" cancelando a simulação. Voltou: o timeout derrubava quem estava esperando, extras se acumulavam, a simulação disputava o Guto, líder fantasma.
3. **AGzinhos chibi e cache de sprites** (`9aea82b`): cabeça maior, olhos com brilho, piscar e respirar, animações novas, acessórios por camada, galeria em `?galeria=1`. Voltou: o coque da Marina ficava invisível.
4. **Ala de descanso e agendador** (`0624cb3`): 36 colunas, mesa de ping-pong, bebedouro, café, sofá, maquete, regar, interrupção por trabalho. Voltou: escala não inteira, FPS, fantasmas depois do `SessionEnd`, copo indo para a mesa errada, ping-pong parecendo armário.
5. **Ping-pong, bate-papo e balões sem sobreposição** (`bf06014`). Voltou: AGzinho trabalhando em pé no ping-pong, ligadura "fi" no nome (Sofia virava "Soña").
6. **Crachá AG no lugar de "Detalhes"** (`92587b6`). Voltou: foco e acessibilidade do crachá.
7. **Vestiário** (`c501278`, com ajuste de rodapé em `64b6835`). Voltou: corrida entre salvar e o WebSocket, Esc repetido, PUT burlando campos fixos, barba + óculos.
8. **Quadro "AGzinhos na Etapa X"** (`0e6aad1`). Voltou: TodoWrite de subagente apagando a lista do líder, simulação presa em "1 de 1".
9. **Simulação nova, 2 devs em paralelo e reduced-motion** (`7948e76`). Voltou: dois devs seguidos sem descrição.

**Skills usadas:** *brainstorming* (fase 1); *frontend-design*, *web-design-guidelines* e *theme-factory*. **Não usadas:** geração de imagem, *brand-guidelines*, *superpowers* e *agent-browser*. Os prints de conferência ficam em `prints/` (fora do git).

**Resultado da v1:** *brainstorming*, *frontend-design*, *web-design-guidelines*, *theme-factory* e Playwright para os prints; sem geração de imagem por IA (as referências da AG não saem da máquina). O testador mediu cerca de 115 a 144 FPS (limitado pelo vsync) e nenhuma regressão no fluxo.

## Limitações conhecidas

**Escritório e simulação**
- **Ping-pong e papo se formam pouco em uso real**: só nascem nas trocas de atividade, então com pouca gente de boa quase não aparecem.
- **O pareamento Start↔Agent depende da ordem de chegada** dos eventos: se o `SubagentStart` e o `Agent` chegarem trocados, um subagente pode ser ligado ao pedido errado.
- **Em telas estreitas (< ~600 px)** o canvas é reduzido por CSS, e o pixel deixa de ser inteiro.
- **Simulação não sobrevive a reinício**: os AGzinhos da simulação não são salvos de propósito.
- **"Foi chamado de novo" repetido**: se o servidor reiniciar entre o líder chamar alguém e o primeiro passo dessa pessoa, a linha pode aparecer duas vezes no feed.
- **"Limpar" zera também a sessão real** (e apaga o `data/escritorio.json`); ela volta no evento seguinte do Claude Code.
- **Líder duplicado num `/clear` com eventos fora de ordem**: o líder antigo pode caminhar até a porta enquanto o novo já está na mesa.
- **Perda de até ~1 s num desligamento forçado** (kill): o que veio depois do último salvamento some.
- **Desligar com Ctrl+C no Windows** ainda não foi testado de ponta a ponta.
- **`.sr-only` e rolagem vertical:** em apresentação, a altura da página é maior que a da tela por causa do conteúdo do painel (ainda não corrigido).

**Memória, painel e dados**
- **`/reuniao` e `/memoria` de ponta a ponta** dependem de uma sessão do Claude Code: o teste completo (ata, nota, missões) não roda no `npm test`.
- **Nomes de pessoas nas atas** ficam por conta do `/reuniao` e da leitura automática (que trocam por papéis, com nomes residuais possíveis): revise a nota e as missões geradas.
- **Power Automate não testado**: o formato em `docs/power-automate-reunioes.md` ainda não rodou com um fluxo real.
- **`fs.watch` no OneDrive** pode atrasar: o servidor relê o vault a cada ~30 s, então missão, ata nova ou faixa podem levar até ~30 s para aparecer.
- **Caixa:** o painel mostra até 40 tarefas por reunião; o resto fica na nota.
- **Pendências:** até 100 itens; a tabela de `## Tarefas` do `/reuniao` não entra.
- **Missão cancelada ou pausada** aparece como "a fazer" no painel (o status da nota não é lido para isso).
- **Missão concluída à mão sem a data de conclusão** entra nos Resultados só no total, com o aviso "data aproximada".
- **Resultados:** passando de 5000 notas por pasta, só as 5000 primeiras contam.
- **Busca:** notas maiores que ~200 KB não aparecem, nem pelo título. Passando de 100 MB de texto indexado, as demais entram só pelo título.
- **Replay:** cerca de 5 MB por dia e 30 dias de retenção.
- **Tokens:** a nota da missão é aproximada (pode subcontar se o servidor cair).
- **Transparência:** leituras feitas por comandos de shell não são vistas.
- **`data/` é compartilhada** entre servidores: `AGPOCKET_ESTADO` isola só o `escritorio.json`, não o `data/gasto` nem o `data/replay`.

**Apresentação**
- **Privacidade da apresentação é melhor esforço.** Os dados reais chegam ao navegador (aparecem na aba Rede das ferramentas) e texto livre fora dos rótulos pode passar. Para apresentar de verdade, use um vault fictício.

**Outros**
- **`engine.ts` e `map.ts` são arquivos grandes** e pedem divisão (`decor.ts` e `activities.ts` já foram divididos).
- **Segurança do `POST /api/demo` e do `POST /api/reset`:** essas duas rotas não exigem `Origin` do painel nem JSON (veja Segurança). Pendência conhecida.
- **Só tema escuro** no painel (não há tema claro).

## Próximos passos (ideias)
- ~~Ligar o Obsidian como memória~~ (feito na v4): veja "Segundo cérebro (vault do Obsidian) e reuniões".
- Fluxo do Power Automate que grava a ata sozinho no `00-Inbox/` (formato pronto em `docs/power-automate-reunioes.md`).
- Ativar **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): cada colega vira uma sessão própria e as mensagens entre eles viram envelopes voando. Como é experimental, pode precisar de ajuste conforme o formato dos eventos mudar.
- Dividir os arquivos grandes do `web/src/office/`: `engine.ts` e `map.ts` ficaram de fora por serem muito acoplados.
- Fazer ping-pong e papo se formarem também quando alguém fica livre ao lado de outro de boa.
