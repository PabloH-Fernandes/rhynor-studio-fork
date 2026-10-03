# 🏢 Escritório de IA

Um escritório pixel art que mostra seu time de agentes do Claude Code trabalhando em tempo real: cada agente é um personagem com uniforme da sua função, senta na própria mesa, digita quando está usando ferramenta, levanta um **!** quando precisa de você, manda envelopes pros colegas e vai tomar café quando fica ocioso.

![Escritório rodando a simulação](docs/preview.png)

```
Claude Code ──hooks──▶ servidor Node (Express) ──WebSocket──▶ tela React + canvas
```

## O que tem aqui

| Pasta | O que é |
|---|---|
| `agents/` | Os 6 subagentes do time (planejador, pesquisador, dev, testador, revisor, documentador) |
| `team/CLAUDE-time.md` | Instruções pro Claude principal saber quando chamar cada um |
| `hooks/hook.mjs` | O hook: pega cada evento do Claude Code e manda pro servidor |
| `server/` | Recebe os eventos, traduz em "quem está fazendo o quê" e transmite |
| `web/` | O escritório em si (React + canvas, tudo desenhado por código) |
| `web/src/theme.ts` | **Onde você personaliza** nome, logo, cores e uniformes |
| `web/src/office/map.ts` | Planta do escritório (posição das mesas, móveis) |

## Rodando (5 minutos)

Precisa de Node 20+ e do Claude Code instalado.

```bash
npm install

# 1. instala os 6 agentes em ~/.claude/agents (ficam disponíveis em todos os projetos)
npm run install-agents

# 2. liga os hooks em ~/.claude/settings.json (faz backup antes)
npm run install-hooks

# 3. sobe o escritório
npm run build
npm start          # abre em http://localhost:4747
```

Agora abra uma sessão **nova** do Claude Code em qualquer projeto e peça algo. O líder aparece entrando pela porta e, quando ele delegar, os outros chegam.

Quer ver antes de ligar no Claude? Clique em **Rodar simulação** na tela.

### Fazendo o Claude usar o time
Copie o conteúdo de `team/CLAUDE-time.md` para o seu `~/.claude/CLAUDE.md`. Ou peça direto: *"usa o planejador pra quebrar isso e depois o dev implementa"*. Dentro do Claude Code, `/agents` lista os agentes instalados.

### Desenvolvendo o escritório
```bash
npm run dev        # servidor + Vite com hot reload em http://localhost:5173
```

### Desligando
```bash
npm run uninstall-hooks
```
Com o servidor desligado os hooks não atrapalham nada: eles rodam em segundo plano e ignoram o erro de conexão.

Só quer em um projeto específico? Use `npm run install-hooks -- --project C:\caminho\do\projeto` (e o mesmo para `install-agents`).

## Identidade Andrade Gutierrez

O escritório usa a identidade visual da AG: **marinho `#051733` + branco**. O marinho foi lido direto do pixel do fundo da logo oficial (não é chute de paleta). Tudo é desenhado por código; nenhuma imagem gerada por IA.

**Cores com regra:**
- **Laranja de obra `#FF8A00`** é exclusivo do estado "te esperando" (o **!** e o alerta no painel), e sempre aparece sobre marinho, nunca solto.
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
| Revisor | blazer cinza + óculos | lenço de bolso |
| Pesquisador | polo marinho, logo AG branca no peito | gola |
| Testador | polo marinho, logo AG branca no peito | manga |
| Dev | camisa branca, logo AG marinha no peito | gola |
| Documentador | camisa branca, logo AG marinha no peito | manga |
| Convidado | polo marinho + crachá cinza "visitante" | só o crachá |

**Iluminação pela hora real.** O escritório acompanha o relógio do seu computador: manhã, tarde, entardecer e noite (céu, cor ambiente, luzes de teto e telas acesas, estrelas e lua). Pra ver uma hora específica, use `?hora=HH.MM` na URL:

```
http://localhost:5173/?hora=22      # noite
http://localhost:5173/?hora=7.30    # 7h30 (formato HH.MM, não decimal: 7.5 seria 7h05)
```

Também aceita `HH:MM`. Valor inválido é ignorado e vale a hora real.

**Animações novas:** o agente **espreguiça** ao ficar livre e **comemora com confete** ao entregar a tarefa. Com `prefers-reduced-motion` ativado no sistema, as duas viram um gesto curto de braços, sem pulo.

## Como personalizar

Tudo visual fica em `web/src/theme.ts`. O resto do código lê de lá.

### Trocar a logo
1. Coloque a nova PNG em `web/public/` (ex.: `logo-minha-empresa.png`).
2. Aponte para ela em `theme.logoUrl`:
   ```ts
   logoUrl: "/logo-minha-empresa.png",
   ```
3. A placa da recepção reduz a imagem para pixels duros e aplica um **limiar marinho/branco**: só existem essas duas cores na placa, então logos coloridas perdem a cor. Prefira logo de alto contraste.
4. Se `logoUrl` for vazio ou a imagem falhar ao carregar, a placa cai para o "AG" em pixels de `web/src/office/agMark.ts` (`AG_LETTERS`, e `AG_CHEST` para o peito do uniforme). Troque os bitmaps lá se a marca não for AG.
5. O favicon é `web/public/favicon-ag.svg`, referenciado em `web/index.html` (junto do `<title>`). `logo-ag-simbolo.png` também está em `web/public/`.

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
- `ROLE_COLORS` (exposto como `theme.roleColors`) define a cor do papel: cordão, plaquinha da mesa e painel. `theme.deskLabels` define o texto da plaquinha.
- Cabelo e acessório fixos de cada papel ficam em `ROLE_LOOK` em `web/src/office/engine.ts` (`hairStyle` e `accessory`: `"relogio"`, `"oculos"`, `"headset"`, `"lapis"`, `"nenhum"`...). Quem não está lá sai do hash do id.
- Tons de pele e cabelo sorteados: `SKINS` e `HAIRS` no fim do `theme.ts`.

### Layout e sprites
Pra mudar o layout (mais mesas, outro formato de sala), mexa em `DESKS` no `web/src/office/map.ts`. Os móveis e o cenário ficam em `map.ts` e `decor.ts`. Os personagens são desenhados em `web/src/office/sprites.ts` com retângulos, então dá pra mudar cabelo, adicionar capacete, colete, etc. sem mexer com imagens. A luz do dia está em `web/src/office/daylight.ts`.

> Pra usar a marca oficial: peça a logo e o manual de marca pro time de comunicação e mantenha o repositório privado.

## Como funciona por dentro

1. O Claude Code dispara um **hook** a cada evento (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `Stop`...). O `hook.mjs` manda o JSON do evento pro servidor e sai na hora.
2. O **servidor** (`server/state.ts`) junta os eventos em agentes: o líder é a sessão, cada subagente é identificado pelo `agent_id` que o Claude Code manda nos hooks de dentro dele. A ferramenta usada vira uma frase ("Editando App.tsx", "Rodando os testes").
3. A **tela** recebe tudo por WebSocket. O `engine.ts` decide pra onde cada personagem vai (mesa do papel → mesa de convidado → em pé na mesa de reunião), anda pelo corredor e desenha.

Agentes de outros tipos (como `Explore` ou `general-purpose`) ocupam as mesas de convidado. Se você abrir várias sessões ao mesmo tempo, cada uma traz o seu líder.

## Como o time construiu isso

A identidade AG foi feita pelo próprio time de agentes, em três fases.

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

**Skills usadas:** *brainstorming* (fase 1); *frontend-design*, *web-design-guidelines* e *theme-factory* (etapa 1, painel e tokens); Playwright para os prints. **Não usadas de propósito:** geração de imagem por IA (as referências da AG não saem da máquina; tudo é desenhado por código) e *brand-guidelines* (é da Anthropic).

**Resultado dos testes:** o testador mediu cerca de 115 a 144 FPS (limitado pelo vsync) e nenhuma regressão no fluxo: andar, digitar, "!", envelopes, café, balões, painel e "Rodar simulação".

## Limitação conhecida

O botão **Limpar** não cancela os timers de uma simulação em andamento (`server/demo.ts`). Fora do escopo deste trabalho.

## Próximos passos (ideias)
- Ligar o Obsidian como memória: um vault com `CLAUDE.md` que os agentes leem no começo e atualizam no fim.
- Ativar **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): cada colega vira uma sessão própria e as mensagens entre eles (ferramenta `SendMessage`) viram envelopes voando. Como é experimental, pode precisar de ajuste conforme o formato dos eventos mudar.
- Sons (teclado, notificação quando alguém levanta o **!**).
