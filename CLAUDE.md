# Rhynor Studio

Escritório pixel art que mostra os agentes do Claude Code trabalhando em tempo real e, a partir da v2, produz séries com uma equipe de agentes.

## Os dois modos
- **`/time`: construir e manter o Studio.** Fluxo planejador, (pesquisador), dev, testador, revisor, documentador. Os 6 agentes estão em `.claude/agents/` (cópia de `agents/`; para atualizar, `node scripts/install-agents.mjs --project .`).
- **Modo showrunner: produzir séries.** Liga na v2. As regras estão em `team/CLAUDE-studio.md` e os 9 agentes de produção também ficam em `.claude/agents/`. O `/time` não delega a eles.

## Marca
- `referencias/rhynor-marca.md` é a regra visual do projeto. Leia antes de mexer em tela, sprite, cor ou fonte.
- Cor só pelo nome do token `--rh-*`, nunca valor literal.
- O `npm test` tem guardas de marca (`scripts/marca.test.mjs`): cor literal ou nome antigo em arquivo versionado quebra o teste.

## Portas
- Servidor: `PORT`, padrão 4848.
- Hook: `STUDIO_PORT`, padrão 4848 (precisa bater com a do servidor).

## Nesta fase
- Não rode o setup global (`npm run setup`, `npm run install-hooks` sem `--project`): nada de escrever em `~/.claude`. O hook deste projeto fica só em `.claude/settings.local.json` (fora do git).

## Memória (vale neste projeto no lugar da memória do time global)
- Neste projeto, **ignore a seção "Memória do time" do `CLAUDE.md` global**: não leia nem escreva no vault apontado pela variável de vault do motor upstream, e não passe caminho de vault ao pesquisador nem ao documentador até a Etapa 3.
- A partir da Etapa 3, os registros de construção vão para uma pasta própria: passe sempre o caminho absoluto de `<STUDIO_VAULT>/20-Producao/Construcao/` (nunca a raiz do vault das séries).
- A regra "o arquivista é o único que escreve no vault" vale só para o conteúdo das séries.
- Nunca guarde senha, token, chave nem dado pessoal em nota.
