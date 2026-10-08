# AG Pocket

> Instalando em outro PC? Veja o [SETUP.md](SETUP.md).

Um escritório pixel art que mostra seu time de agentes do Claude Code trabalhando em tempo real. Cada agente é um **AGzinho**: um personagem com nome, uniforme da sua função e jeito próprio. Ele senta na própria mesa, digita quando está usando ferramenta, levanta um **!** quando precisa de você, manda envelopes pros colegas e, quando fica de boa, vai tomar café, jogar ping-pong ou bater papo.

![Escritório rodando a simulação](docs/preview.png)

```
Claude Code ──hooks──▶ servidor Node (Express) ──WebSocket──▶ tela React + canvas
```

## O que tem aqui

| Pasta | O que é |
|---|---|
| `agents/` | Os 6 subagentes do time ([[planejador]], [[pesquisador]], [[dev]], [[testador]], [[revisor]], [[documentador]]) |
| `team/CLAUDE-time.md` | Instruções pro Claude principal saber quando chamar cada um e montar a lista de tarefas ([[CLAUDE-time]]) |
| `team/CLAUDE-memoria.md` | Bloco opcional e pessoal da memória no Obsidian (tem caminho do vault; o setup não instala) ([[CLAUDE-memoria]]) |
| `hooks/hook.mjs` | O hook: pega cada evento do Claude Code e manda pro servidor |
| `server/` | Recebe os eventos, traduz em "quem está fazendo o quê", guarda o elenco e transmite |
| `shared/roster.ts` | Elenco padrão dos AGzinhos e as regras de validação (roda no servidor e no navegador) |
| `web/` | O escritório em si (React + canvas, tudo desenhado por código) |
| `web/src/theme.ts` | **Onde você personaliza** nome, logo, cores e uniformes |
| `web/src/office/map.ts` | Planta do escritório (posição das mesas, móveis) |
| `data/agzinhos.example.json` | Elenco de exemplo, versionado. O `data/agzinhos.json` real fica fora do git |
| `setup/skills.json` | Catálogo do que o `npm run setup` instala (essenciais e extras de terceiros) |
| `commands/` | Comando `/time` do Claude Code, copiado para `~/.claude/commands/` pelo setup |
| `scripts/setup.mjs` | O instalador (`npm run setup`, `npm run setup:check`); veja o [SETUP.md](SETUP.md) |

## Rodando (5 minutos)

Precisa de Node 20+ e do Claude Code instalado (e logado).

**Jeito rápido:** `npm run setup` faz tudo abaixo de uma vez (dependências, agentes, hooks, `/time`, Playwright, plugins, build). Depois é só `npm start`. Opções e detalhes no [SETUP.md](SETUP.md); `npm run setup -- --dry-run` mostra o que ele faria sem escrever nada.

**Manual (alternativa):**

```bash
npm install

# 1. instala os 6 agentes em ~/.claude/agents (ficam disponíveis em todos os projetos)
npm run install-agents

# 2. liga os hooks em ~/.claude/settings.json (faz backup antes)
npm run install-hooks

# 3. sobe o escritório
npm run build
npm start          # abre em http://127.0.0.1:4747
```

O servidor escuta **só em `127.0.0.1`**: outras máquinas da rede não enxergam o escritório nem conseguem mandar eventos pra ele. A porta padrão é 4747 (mude com a variável `PORT`).

Agora abra uma sessão **nova** do Claude Code em qualquer projeto e peça algo. O líder aparece entrando pela porta e, quando ele delegar, os outros chegam.

Quer ver antes de ligar no Claude? Clique em **Rodar simulação** na tela.

### Fazendo o Claude usar o time
Rode `npm run setup` (instala o bloco de `team/CLAUDE-time.md` no seu `~/.claude/CLAUDE.md`, entre marcadores) ou copie o conteúdo à mão. Ou peça direto: *"usa o planejador pra quebrar isso e depois o dev implementa"*. Dentro do Claude Code, `/agents` lista os agentes instalados.

### Desenvolvendo o escritório
```bash
npm run dev        # servidor + Vite com hot reload em http://localhost:5173
```

> **Dica:** se o time estiver editando o próprio AG Pocket, rode o escritório com `npm run build && npm start` em vez de `npm run dev`. O `tsx watch` reinicia o servidor a cada mudança em `server/` ou `shared/`. Com a persistência ninguém some, mas o último ~1 s antes do reinício pode se perder.

### Desligando
```bash
npm run uninstall-hooks
```
Com o servidor desligado os hooks não atrapalham nada: eles rodam em segundo plano e ignoram o erro de conexão.

Só quer em um projeto específico? Use `npm run install-hooks -- --project C:\caminho\do\projeto` (e o mesmo para `install-agents`).

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
- **O mesmo papel volta como a mesma pessoa.** Toda vez que o `dev` aparece, é a Bia; o `revisor` é sempre a Lúcia, em qualquer sessão. O mesmo agente chamado de novo volta **à mesma mesa**.
- **Cada evento mexe só no AGzinho do próprio `agent_id`.** Um subagente nunca "puxa" o estado de outro.
- **Trabalho em paralelo ganha variação.** Se dois devs (ou dois pesquisadores) trabalham ao mesmo tempo, o segundo é a Yasmin (Dev 2) e o Tomás (Pesquisa 2), com visual próprio, em vez de um clone.
- **Convidados por tipo de agente.** Agentes de fora do time entram como visitantes: `Explore` é a Iara, `general-purpose` é o Jorge e qualquer outro tipo (como `Plan`) é a Sofia.
- **Visitantes são temporários.** Visitante é todo subagente de fora do time (Iara, Jorge, Sofia e os extras `ag:extra:<id>`). Ele usa uma mesa de visita e, no `SubagentStop`, **sai andando até a porta** (nunca fica "de boa": isso é só do time). Sem `SubagentStop`, sai sozinho depois de **3 min sem eventos** (`VISITANTE_SEM_EVENTO_MS`), a não ser que esteja esperando você. Depois de sair, o `agent_id` fica "aposentado" por ~60 s: evento atrasado dele não o traz de volta; só um `SubagentStart` do mesmo id reabre.
- **No máximo 3 visitantes na tela.** Os que passam disso continuam no estado, mas não aparecem no mapa (o painel mostra só "+N visitantes"); o 4º entra quando um dos 3 sai, por ordem de chegada.
- **Visitante não conta no TIME.** O quadro da parede mostra `TIME 7 · VISITANTES 2 · FAZENDO 3`: `TIME` só tem o time (o trecho `VISITANTES` some quando não há nenhum), e `FAZENDO` é quem está trabalhando no mapa (time + visitantes visíveis). O painel separa "Time · N" do grupo recolhível "Visitantes (N)" (fechado por padrão). Visitante também não conta na fase do quadro de etapas e não é gravado em `data/escritorio.json` (não volta num reinício do servidor).

## Ciclo de vida

- **Os AGzinhos ficam até o `SessionEnd`.** Terminar a tarefa (`Stop`) não manda ninguém embora: o time fica no escritório, de boa, até a sessão acabar.
- **Reiniciar não manda ninguém embora.** O estado do escritório fica em `data/escritorio.json` (fora do git), salvo ~1 s depois de cada mudança e ao desligar o servidor. Mude o caminho com `AGPOCKET_ESTADO`. O arquivo guarda as atividades **com caminhos de arquivos**, e se o projeto estiver numa pasta sincronizada (OneDrive, por exemplo) ele sobe junto: atenção.
- **`/compact` e `/resume` mantêm o time.** O `/clear` **transfere** o time para a conversa nova (mesmo projeto, em até 30 s).
- **Sessão sem sinal expira.** Se o Claude Code fechar sem mandar o `SessionEnd` (terminal fechado na marra, queda de energia), a sessão sai sozinha depois de `AG_SESSION_TIMEOUT_MIN` minutos sem nenhum evento (padrão: **30**). Quem está **esperando você** (o **!**) nunca expira, e quem tem ferramenta em andamento espera 4x mais.

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
- **"Limpar" cancela a simulação** em andamento (os timers dela são desligados), esvazia o escritório e apaga também o `data/escritorio.json`.

## Vida no escritório

Quem está de boa não fica parado. O agendador (`web/src/office/activities.ts`) sorteia uma atividade de descanso:

- **Café** na copa (às vezes leva o copo pra mesa e termina de beber lá);
- **Ping-pong**, em dupla;
- **Papo**, em duas ou três pessoas, cada uma com as falas do próprio elenco;
- **Sofá com celular**;
- **Maquete** de obra, na mesa de reunião;
- **Bebedouro**;
- **Regar** a planta;
- **Espreguiçar**.

O **trabalho sempre ganha do descanso**: quando chega tarefa, quem está descansando larga o que está fazendo e volta pra mesa (o descanso só começa depois de uns 20 s sem trabalho). Os balões de fala do papo são discretos e **não se sobrepõem** (o motor segura um intervalo por AGzinho e enfileira os balões, em `web/src/office/bubbles.ts`).

## Crachá e Vestiário

- **Mesas com a função:** cada mesa mostra a função de quem a usa (LÍDER, PLANEJAMENTO, PESQUISA, DESENVOLVIMENTO, TESTES, REVISÃO, DOCUMENTAÇÃO, CONVIDADO ou LIVRE). Quando não cabe, abrevia ("DESENVOLV. 2"); a segunda mesa de visita é "CONVIDADO 2". O apelido não aparece na mesa.
- **Crachá:** clique num AGzinho no escritório ou na lista "Time" do painel. Abre uma ficha de RPG com nome, cargo, matrícula, personalidade, o estado atual, **"O que eu faço"**, **"Sou responsável por"** e a barra de entregas do dia (10 por nível; "Nível N" só aparece a partir da 10ª entrega).
- **Vestiário:** botão **Vestiário** no painel, ou **Personalizar** no crachá. Dá pra mudar **nome, apelido, gênero, tom de pele, cabelo (estilo e cor), roupa, destaque, acessórios e os textos "O que eu faço" e "Sou responsável por"** (campos `oQueFaco` e `responsabilidades` do elenco), com a pré-visualização do sprite ao lado.

Regras de uniforme (o vestiário só oferece o que é permitido e o servidor confere de novo):
- **Terno só no líder.** O líder não usa outra roupa.
- **Blazer no planejador e no revisor.** Só eles usam blazer (o revisor pode ter o blazer cinza).
- **Polo marinho ou camisa branca** em todos os outros papéis.
- **Um acessório por camada do corpo**: cabeça, pelos, rosto, tronco, mão e pulso (`CAMADA_DO_ACESSORIO`). Por isso barba e óculos convivem, mas dois acessórios de cabeça não.
- **O cargo acompanha o gênero**: Desenvolvedora ou Desenvolvedor, Revisora ou Revisor etc. (`cargoDe`).
- **Campos fixos**, que o vestiário não muda: papel, cordão do crachá, matrícula e falas (`CAMPOS_EDITAVEIS` lista só o que pode mudar).

**Onde fica salvo:** `data/agzinhos.json`, escrito pelo servidor e **fora do git** (`.gitignore`). O `data/agzinhos.example.json` é versionado e serve de modelo. Sem o arquivo, vale o elenco padrão.

**API:**
```bash
curl http://127.0.0.1:4747/api/roster                 # lê o elenco
curl -X PUT http://127.0.0.1:4747/api/roster \
     -H "Content-Type: application/json" -d @elenco.json   # grava (valida antes)
```
O `PUT` valida tudo e ignora tentativa de mexer em campo fixo.

## Quadro "AGzinhos na Etapa X"

No topo do painel, o quadro mostra em que etapa o trabalho está ("AGzinhos na Etapa 3 de 6") e quem está nela. Ele pega os dados, nesta ordem:

1. **A lista de tarefas do Claude Code**: `TaskCreate`/`TaskUpdate` ou `TodoWrite` (`server/progress.ts`). A tarefa `in_progress` é a etapa atual.
2. **A reserva por papel**: sem lista de tarefas, o quadro deduz a fase pelos papéis que estão trabalhando (planejador, dev, testador...).
3. **"De boa"**: sem ninguém trabalhando.

A regra que faz o líder montar a lista está em `team/CLAUDE-time.md`: em trabalho com mais de 2 etapas, sempre criar uma tarefa por etapa e atualizar o status.

### Ferramentas de tarefa por modelo

As ferramentas de tarefa só existem **por padrão** no Claude 3.x, Opus 4 a 4.7, Sonnet 4 a 4.6 e Haiku 4.5 (Claude Code v2.1.268+). Nos outros modelos é preciso ativar com `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (requer Claude Code v2.1.233+), de um destes jeitos:

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

`CLAUDE_CODE_ENABLE_TASKS=0` troca as ferramentas `Task*` pelo `TodoWrite`. Sem nenhuma das ferramentas, o quadro continua funcionando pela reserva por papel.

Fontes: https://code.claude.com/docs/en/agent-sdk/todo-tracking e https://code.claude.com/docs/en/env-vars

### Gravador de eventos: `AGPOCKET_GRAVAR=1`

Grava **cada evento** que chega dos hooks em `data/eventos/AAAA-MM-DD.jsonl` (uma linha por evento, com a hora de chegada), pra investigar o que aconteceu numa sessão real. Desligado por padrão e fora do git. (`AG_HOOK_LOG=1` ainda funciona, mas está obsoleto.)

```powershell
$env:AGPOCKET_GRAVAR = "1"; npm start
npm run replay -- data/eventos/2026-10-05.jsonl                            # linha do tempo e estado final
npm run replay -- --anonimizar data/eventos/2026-10-05.jsonl saida.jsonl   # cópia sem dados pessoais
```

Atenção: o arquivo guarda prompts, comandos, pastas e caminhos da sua máquina. **Nunca compartilhe o arquivo cru**; para virar fixture de teste (`server/fixtures/sessoes/`), use só a cópia anonimizada. Os testes de sessões reais usam essas fixtures via `reproduzir()` (`server/replay.ts`).

## Painel lateral (para quem não é de TI)

- **Time** e **O que tá rolando** são seções recolhíveis; o navegador lembra se você as deixou abertas.
- Cada linha do Time tem mini retrato, apelido, função e o status com ícone em pixel.
- O feed usa **frases simples, sem jargão** ("Editando App.tsx" vira algo como "mexendo num arquivo"). Repetidos são agrupados, e há destaques: 🙋 precisa de você, 🏁 etapa concluída, 🎉 trabalho concluído, ✅ terminou a parte.
- O botão **Ver detalhes técnicos** troca as frases simples pelas técnicas (balões, crachá e lista incluídos); **Ver frases simples** volta.
- Visual de jogo em pixel: molduras em degrau, letras pixeladas e botões que afundam ao clicar.

Para quem vai mexer: as frases ficam todas em `shared/frases.ts` (reexportadas por `server/frases.ts`); as fontes são Press Start 2P (títulos) e VT323 (texto).

## Simulação

O botão **Rodar simulação** conta uma sessão inteira, passando pelas mesmas situações de uma sessão real (frases simples e destaques no painel, retomada de quem é chamado de novo, Dev 2 em paralelo):

- o líder (Guto) recebe o pedido, monta uma lista de 6 tarefas e chama a Marina e o Caio; o quadro sai de "Planejamento" para "Etapa 1 de 6";
- os dois entregam, comemoram e **ficam** no escritório, indo descansar;
- **dois devs trabalham em paralelo** (Bia e Yasmin) junto com o Rafa, que pede permissão (o **!** laranja) e troca envelopes com eles;
- quando os três entregam, fica todo mundo de boa ao mesmo tempo: aparecem **ping-pong, papo e café**;
- no meio do descanso o **Caio é chamado de novo**, larga o que estava fazendo, volta pra mesa e entrega pela segunda vez;
- a Lúcia revisa, o Davi documenta e o quadro chega em "concluíram 6 de 6 ✓";
- o líder termina ("Terminou, esperando você") e, no fim da sessão, todos saem pela porta.

Dá pra ver tudo sem ligar o Claude. Ela vive em `server/demo.ts`; **Limpar** interrompe. Se uma sessão real estiver aberta, ela fica com o Guto e a simulação usa convidados no lugar dos AGzinhos ocupados.

## Identidade

O produto se chama **AG Pocket** (nome no cabeçalho do painel e no favicon). O escritório em si segue a identidade visual da Andrade Gutierrez: a placa da recepção continua com a logo da empresa. Marinho `#051733` + branco; o marinho foi lido direto do pixel do fundo da logo oficial (não é chute de paleta). Tudo é desenhado por código; nenhuma imagem gerada por IA.

**Cores com regra:**
- **Laranja de obra `#FF8A00`** é exclusivo do estado "te esperando" (o **!** e o alerta no painel), e sempre aparece sobre marinho, nunca solto. Nenhum cordão de crachá pode usar essa cor.
- O **testador é turquesa** (`#2EC4B6`) justamente para não competir com o laranja.
- Os HEX ficam em `palette` (`web/src/theme.ts`), a fonte única.

**O que tem no escritório:**
- Placa da recepção com a logo oficial em pixels duros (a PNG é reduzida e vira só marinho e branco).
- Janelas com guindaste e prédio em obra (o céu muda com a hora, veja abaixo).
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

Os acessórios (óculos, headset etc.) agora são do AGzinho, não do papel: veja o elenco acima.

**Iluminação pela hora real.** O escritório acompanha o relógio do seu computador: manhã, tarde, entardecer e noite (céu, cor ambiente, luzes de teto e telas acesas, estrelas e lua). Pra ver uma hora específica, use `?hora=HH.MM` na URL:

```
http://localhost:5173/?hora=22      # noite
http://localhost:5173/?hora=7.30    # 7h30 (formato HH.MM, não decimal: 7.5 seria 7h05)
```

Também aceita `HH:MM`. Valor inválido é ignorado e vale a hora real.

**Animações:** o agente **espreguiça** ao ficar livre e **comemora com confete** ao entregar a tarefa. Com `prefers-reduced-motion` ativado no sistema, as duas viram um gesto curto de braços, sem pulo. O canvas sempre desenha em **escala inteira**, pra manter os pixels nítidos.

**Zoom e navegação:** o escritório é uma câmera livre (lógica em `web/src/office/camera.ts`, zoom de 50% a 600% por CSS transform, sem redesenhar o canvas).
- **Mouse:** roda dá zoom no ponto do cursor; arrastar move; duplo clique alterna 2x e "ajustar".
- **Trackpad e toque:** pinça (ou Ctrl + roda) dá zoom; um dedo arrasta; duplo toque alterna 2x e "ajustar".
- **Teclado:** setas movem, `+`/`-` dão zoom, `0` ajusta.
- Botão **Ajustar** e o rótulo ZOOM no canto. Arrastar não seleciona AGzinho; um clique simples seleciona após ~300 ms (espera o duplo clique). Respeita `prefers-reduced-motion`.
- Nos botões e no teclado o zoom para em escala inteira; no zoom intermediário (roda, pinça) os pixels ficam um pouco menos nítidos.

## Como personalizar

Tudo visual fica em `web/src/theme.ts`. O resto do código lê de lá. Quem são os AGzinhos fica no elenco (abaixo).

### Mudar o elenco
- **Pelo Vestiário**, na tela (o jeito fácil), ou
- **Pelo JSON**: copie `data/agzinhos.example.json` para `data/agzinhos.json` e edite. Campo ausente cai no padrão; um arquivo inválido é recusado com a lista de erros. O padrão de fábrica está em `DEFAULT_ROSTER` (`shared/roster.ts`).

### Criar um acessório novo
Os passos estão no comentário de `web/src/office/accessories.ts`:
1. Some o nome em `Acessorio` e `ACESSORIOS`, e a camada dele em `CAMADA_DO_ACESSORIO` (`shared/roster.ts`);
2. Desenhe o acessório em `DESENHOS`, em `accessories.ts` (de perfil, desenhe virado pra direita);
3. Dê o nome em português em `NOME_ACESSORIO` (`web/src/components/vestiarioLogic.ts`).

O TypeScript reclama se faltar o passo 2 ou o 3.

### Tempo de sessão
`AG_SESSION_TIMEOUT_MIN` (minutos, padrão 30). Veja "Ciclo de vida".

### Trocar a logo
1. Coloque a nova PNG em `web/public/` (ex.: `logo-minha-empresa.png`).
2. Aponte para ela em `theme.logoUrl`:
   ```ts
   logoUrl: "/logo-minha-empresa.png",
   ```
3. A placa da recepção reduz a imagem para pixels duros e aplica um **limiar marinho/branco**: só existem essas duas cores na placa, então logos coloridas perdem a cor. Prefira logo de alto contraste.
4. Se `logoUrl` for vazio ou a imagem falhar ao carregar, a placa cai para o "AG" em pixels de `web/src/office/agMark.ts` (`AG_LETTERS`, e `AG_CHEST` para o peito do uniforme). Troque os bitmaps lá se a marca não for AG.
5. O favicon é `web/public/favicon-agpocket.svg`, referenciado em `web/index.html` (junto do `<title>`). `logo-ag-simbolo.png` também está em `web/public/`.

### Trocar cores
1. Edite `palette` em `web/src/theme.ts` (ex.: `navy900` é a cor da marca).
2. Atualize as variáveis do `:root` em `web/src/styles.css` com os mesmos HEX. O CSS (painel lateral) não lê o TypeScript, então os dois **precisam ficar em sincronia** (o comentário no topo do arquivo lembra disso).
3. `theme.colors` liga a paleta ao cenário (piso, parede, lambril, placa). `palette.sky` define o céu por hora.

### Trocar uniformes
- Em `theme.uniforms` cada papel é montado com uma destas funções: `polo(accent, trim)`, `camisa(accent, trim)`, `blazer(shirt, shirtShade, accent, pants)`; o líder é um objeto `terno` escrito à mão. Exemplo, o dev de polo com manga colorida:
  ```ts
  dev: polo(ROLE_COLORS.dev, "manga"),
  ```
- `trim` é `"gola"`, `"manga"` ou `"lenco"`. Papéis sem entrada usam `uniforms.convidado`.
- `ROLE_COLORS` (exposto como `theme.roleColors`) define a cor do papel: cordão, plaquinha da mesa e painel. `theme.deskLabels` define o texto da plaquinha (a função da mesa).
- Tons de pele e cabelo: `SKIN_TONES` e `HAIR_COLORS` em `shared/roster.ts` (o `theme.ts` reexporta como `SKINS` e `HAIRS`). Estilos de cabelo: `EstiloCabelo`, desenhados em `web/src/office/sprites.ts`.
- Se mudar as regras de uniforme (quem pode usar terno, blazer etc.), é em `ROUPAS_PERMITIDAS` e `DESTAQUES_PERMITIDOS`.

### Layout e sprites
Pra mudar o layout (mais mesas, outro formato de sala), mexa em `DESKS` no `web/src/office/map.ts`. Os móveis e o cenário ficam em `map.ts` e `decor.ts`. Os personagens são desenhados em `web/src/office/sprites.ts` (e nos módulos de corpo, cabelo e acessórios ao lado dele) com retângulos, então dá pra mudar cabelo, adicionar capacete, colete etc. sem mexer com imagens. Os sprites prontos ficam em cache (`spriteCache.ts`). A luz do dia está em `web/src/office/daylight.ts`.

> Pra usar a marca oficial: peça a logo e o manual de marca pro time de comunicação e mantenha o repositório privado.

## Como funciona por dentro

1. O Claude Code dispara um **hook** a cada evento (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `Stop`...). O `hook.mjs` manda o JSON do evento pro servidor e sai na hora.
2. O **servidor** (`server/state.ts`) junta os eventos em agentes: o líder é a sessão, cada subagente é identificado pelo `agent_id` que o Claude Code manda nos hooks de dentro dele. A ferramenta usada vira uma frase ("Editando App.tsx", "Rodando os testes"). O `server/progress.ts` monta o quadro de etapas e o `server/roster.ts` guarda o elenco.
3. A **tela** recebe tudo por WebSocket. O `engine.ts` decide pra onde cada personagem vai (mesa do papel → mesa de convidado → em pé na mesa de reunião), anda pelo corredor e desenha.

Se você abrir várias sessões ao mesmo tempo, cada uma traz o seu líder.

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
- `web/src/office/deskLabel.test.ts`: rótulos das mesas;
- `web/src/xp.test.ts`: barra de entregas do crachá;
- `server/progress.test.ts`: quadro de etapas (TodoWrite, TaskCreate/TaskUpdate, reserva por papel);
- `server/roster.test.ts`: persistência do elenco e o `PUT /api/roster`;
- `shared/roster.test.ts`: validação e regras de uniforme;
- `web/src/office/camera.test.ts`: câmera do zoom (limites, ajuste, zoom no cursor, mola);
- `web/src/office/activities.test.ts`, `bubbles.test.ts`, `overlay.test.ts`: atividades de descanso, balões e camadas da tela;
- `web/src/components/vestiarioLogic.test.ts`: lógica do vestiário;
- `web/src/progresso.test.ts`: o quadro na tela.

## Como o time construiu isso

A identidade AG foi feita pelo próprio time de agentes, em três fases. Depois veio a missão v2, que deu vida aos AGzinhos.

### Fase 1: descoberta (em paralelo)
- **Líder:** leu o HEX exato dos PNGs via PowerShell/System.Drawing (`#051733` na logo horizontal, `#01102F` no símbolo). Usou a skill *brainstorming* e fechou 4 decisões com o usuário: editar só favicon e title do `index.html`; laranja de obra para o estado de espera; porcelanato cinza-azulado; logo PNG em pixels duros. Depois, testador em turquesa e commits só de código.
- **Pesquisador:** trouxe técnicas de pixel art 3/4, lightmap com `multiply` + `lighter`, paletas com hue shift (Lospec Apollo, Sweetie16, Endesga32), animações e o método de "assar" a logo em pixels duros.
- **Planejador:** mapeou a arquitetura (lanes, faixas livres, eventos que disparam animações) e escreveu a proposta com paleta, uniformes, cenário e 6 etapas.

### Fase 2: 6 etapas
Cada etapa seguiu o ciclo: dev implementa, roda typecheck/build e tira prints com Playwright, testador, revisor, ajustes, commit. Os prints de conferência ficam em `prints/` (não versionados).

1. **Paleta e painel:** tokens, tema e painel lateral. Voltou pro dev: subtítulo quebrando e HEX soltos no código.
2. **Uniformes AG e personagens:** Voltou: cordão de lado parecia gravata, crachá sumia na camisa branca, "!" do monitor ainda amarelo; a logo do peito virou forma de "A".
3. **Parede de recepção:** logo AG na placa e janelas com obra. Voltou: cache da falha do bake, translação, limiar só em k=1.
4. **Piso, mobília e detalhes marinho:** Voltou: anel de hover invisível, tapete escuro escondia uniformes marinho, metade de baixo desequilibrada (entrou a credenza), vapor do café.
5. **Animações de espreguiçar e comemorar:** Voltou: espreguiçar parecia capuz, o líder comemorava no `SessionEnd`, confete branco sumia.
6. **Iluminação pela hora real:** Voltou: quadro ilegível à noite, luzes de teto fortes, 18h salmão competindo com o laranja, luar como manchas, personagens virando silhueta.

### Fase 3: documentação
O documentador escreveu este README.

### Missão v2: os AGzinhos ganham vida

**Fase 1: descoberta e plano.** O pesquisador e o planejador leram as referências. A pasta `ag-pocket` só tinha logos, sem mascotes, e o usuário escolheu seguir a descrição da missão. O planejador propôs o elenco e um plano em **9 etapas**. O usuário aprovou o elenco e decidiu: mapa de 36 colunas, líder também no descanso, servidor só em `127.0.0.1`, quadro de etapas no lugar dos contadores, "AG Pocket" como nome, testador turquesa (da v1) e escala sempre inteira.

**Fase 2: 9 etapas.** Mesmo ciclo da v1 (dev, testador, revisor, ajustes, commit). O que entrou e o que testador e revisor devolveram ao dev:

1. **Elenco e persistência** (`8fb3295`): `shared/roster.ts`, `data/agzinhos.json` e `GET/PUT /api/roster`. Voltou: o PUT precisava normalizar igual ao load; saneamento por AGzinho.
2. **Ficar até o fim da sessão** (`ce52c0c`): mesmo papel volta como a mesma pessoa, AGzinhos "de boa" até o `SessionEnd`, timeout de sessão, "Limpar" cancelando a simulação. Voltou: o timeout derrubava quem estava esperando, extras se acumulavam, a simulação disputava o Guto, líder fantasma.
3. **AGzinhos chibi e cache de sprites** (`9aea82b`): cabeça maior, olhos com brilho, piscar e respirar, animações novas (gole, celular, raquete, queixo, regar), acessórios por camada, galeria em `?galeria=1`. Voltou: o coque da Marina ficava invisível.
4. **Ala de descanso e agendador** (`0624cb3`): 36 colunas, mesa de ping-pong, bebedouro, café de verdade, sofá, maquete, regar, interrupção por trabalho. Voltou: escala não inteira, FPS, fantasmas depois do `SessionEnd`, copo indo pra mesa errada, ping-pong parecendo armário.
5. **Ping-pong, bate-papo e balões sem sobreposição** (`bf06014`). Voltou: AGzinho trabalhando em pé no ping-pong, ligadura "fi" no nome (Sofia virava "Soña").
6. **Crachá AG no lugar de "Detalhes"** (`92587b6`). Voltou: foco e acessibilidade do crachá.
7. **Vestiário** (`c501278`, com ajuste de rodapé em `64b6835`). Voltou: corrida entre salvar e o WebSocket, Esc repetido, PUT burlando campos fixos, barba + óculos.
8. **Quadro "AGzinhos na Etapa X"** (`0e6aad1`). Voltou: TodoWrite de subagente apagando a lista do líder, simulação presa em "1 de 1".
9. **Simulação nova, 2 devs em paralelo e reduced-motion** (`7948e76`). Voltou: dois devs seguidos sem descrição.

**Skills usadas:** *brainstorming* (fase 1); *frontend-design*, *web-design-guidelines* e *theme-factory*. **Não usadas:** geração de imagem, *brand-guidelines*, *superpowers* e *agent-browser*. Os prints de conferência ficam em `prints/` (fora do git).

**Skills e resultado da v1:** *brainstorming*, *frontend-design*, *web-design-guidelines*, *theme-factory* e Playwright para os prints; sem geração de imagem por IA (as referências da AG não saem da máquina). O testador mediu cerca de 115 a 144 FPS (limitado pelo vsync) e nenhuma regressão no fluxo.

## Limitações conhecidas

- **Ping-pong e papo se formam pouco em uso real**: só nascem nas trocas de atividade, então com pouca gente de boa quase não aparecem.
- **A decoração da v1 ainda anima com `prefers-reduced-motion`**: LEDs, vapor e monitor não respeitam a preferência (os AGzinhos respeitam).
- **O pareamento Start↔Agent depende da ordem de chegada** dos eventos: se o hook do `SubagentStart` e o do `Agent` chegarem trocados, um subagente pode ser ligado ao pedido errado.
- **Em telas estreitas (< ~600 px)** o canvas é reduzido por CSS, e o pixel deixa de ser inteiro.
- **`engine.ts`, `decor.ts`, `map.ts` e `activities.ts` são arquivos grandes** e pedem divisão.
- **"Limpar" zera também a sessão real** (e apaga o `data/escritorio.json`); ela volta no evento seguinte do Claude Code.
- **Líder duplicado num `/clear` com eventos fora de ordem**: o líder antigo pode caminhar até a porta enquanto o novo já está na mesa.
- **Perda de até ~1 s num desligamento forçado** (kill): o estado é salvo ~1 s após cada mudança, então o que veio depois do último salvamento some.
- **Simulação não sobrevive a reinício**: os AGzinhos da simulação não são salvos de propósito; se o servidor reiniciar no meio dela, o escritório volta só com a sessão real.
- **"Foi chamado de novo" repetido**: se o servidor reiniciar entre o líder chamar alguém e o primeiro passo dessa pessoa, a linha pode aparecer duas vezes no feed.

## Próximos passos (ideias)
- ~~Ligar o Obsidian como memória~~ (feito): o vault tem `memoria/` e o protocolo está em `team/CLAUDE-memoria.md`.
- Ativar **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): cada colega vira uma sessão própria e as mensagens entre eles (ferramenta `SendMessage`) viram envelopes voando. Como é experimental, pode precisar de ajuste conforme o formato dos eventos mudar.
- Sons (teclado, notificação quando alguém levanta o **!**).
- Dividir os arquivos grandes do `web/src/office/` e fazer a decoração respeitar `prefers-reduced-motion`.
- Fazer ping-pong e papo se formarem também quando alguém fica livre ao lado de outro de boa.
