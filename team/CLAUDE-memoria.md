# Memória do time (vault do Obsidian)

> O `npm run setup` instala este bloco no seu `~/.claude/CLAUDE.md` (entre os marcadores `rhynor-studio:memoria`), logo depois do bloco do time ([[CLAUDE-time]]); sem o bloco do time, no fim do arquivo.
> Não tem caminho pessoal: o vault é a pasta da variável `STUDIO_VAULT` (`env` do `~/.claude/settings.json`).

O vault do time é a pasta da variável de ambiente `STUDIO_VAULT`. Leia o caminho dela; nunca use caminho fixo. Passe esse caminho aos agentes que usam o vault.

**No começo** de missão (trabalho com mais de 2 etapas), leia só: `_indice.md`, a nota do projeto em `30-Projetos/` e, em `90-Memoria-do-time/`, os itens de `Decisões.md` e `Pendências.md` ligados ao projeto. Não leia o vault inteiro nem reabra decisão `aceita` sem motivo novo. O [[planejador]] consulta `Lições aprendidas.md` quando o assunto se repete.

**No fim**, o [[documentador]] atualiza a nota da missão em `20-Missoes/` (status, commits, o que mudou) e a do projeto (decisões novas), cria a sessão a partir de `Templates/Sessão.md` e atualiza `Sessões.md`, `Decisões.md`, `Lições aprendidas.md` e `Pendências.md`. Notas curtas, sem código nem logs.

**Privacidade:** nota com `confidencial: true` não é lida; só o título aparece no índice. Nota de reunião nasce com `confidencial: true`. Nunca guarde senha, token, chave nem dado pessoal no vault.
