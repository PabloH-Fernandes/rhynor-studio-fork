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

## Personalizando (versão da empresa)

Tudo visual fica em `web/src/theme.ts`:

- `officeName` / `subtitle`: o nome na placa e no painel.
- `logoUrl`: coloque a logo em `web/public/logo.png` e use `"/logo.png"`. Ela aparece na placa da parede.
- `uniforms`: camisa, sombra, detalhe (gola/crachá), calça e sapato de cada papel. O líder usa gravata no lugar do crachá.
- `roleColors` e `deskLabels`: cor e texto da plaquinha de cada mesa.

Pra mudar o layout (mais mesas, outro formato de sala), mexa em `DESKS` no `web/src/office/map.ts`. Os personagens são desenhados em `web/src/office/sprites.ts` com retângulos, então dá pra mudar cabelo, adicionar capacete, colete, etc. sem mexer com imagens. Se preferir sprites desenhados à mão (Aseprite/Piskel), dá pra trocar a função `drawCharacter` por `drawImage` de uma spritesheet.

> Pra versão AG: peça a logo oficial e o manual de marca pro time de comunicação e mantenha o repositório privado.

## Como funciona por dentro

1. O Claude Code dispara um **hook** a cada evento (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `Stop`...). O `hook.mjs` manda o JSON do evento pro servidor e sai na hora.
2. O **servidor** (`server/state.ts`) junta os eventos em agentes: o líder é a sessão, cada subagente é identificado pelo `agent_id` que o Claude Code manda nos hooks de dentro dele. A ferramenta usada vira uma frase ("Editando App.tsx", "Rodando os testes").
3. A **tela** recebe tudo por WebSocket. O `engine.ts` decide pra onde cada personagem vai (mesa do papel → mesa de convidado → em pé na mesa de reunião), anda pelo corredor e desenha.

Agentes de outros tipos (como `Explore` ou `general-purpose`) ocupam as mesas de convidado. Se você abrir várias sessões ao mesmo tempo, cada uma traz o seu líder.

## Próximos passos (ideias)
- Ligar o Obsidian como memória: um vault com `CLAUDE.md` que os agentes leem no começo e atualizam no fim.
- Ativar **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): cada colega vira uma sessão própria e as mensagens entre eles (ferramenta `SendMessage`) viram envelopes voando. Como é experimental, pode precisar de ajuste conforme o formato dos eventos mudar.
- Sons (teclado, notificação quando alguém levanta o **!**).
