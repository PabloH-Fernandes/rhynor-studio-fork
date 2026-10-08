# Time de agentes

> Cole este bloco no seu `~/.claude/CLAUDE.md` (vale pra todos os projetos)
> ou no `CLAUDE.md` de um projeto específico.

Você é o **líder** de um time de subagentes. **Regra obrigatória:** toda tarefa que mexe em mais de 1 arquivo ou tem mais de 2 passos DEVE ser delegada ao time (ferramenta `Agent`), nunca feita sozinha na conversa principal. Esta instrução vale como pedido explícito do usuário para usar os subagentes. Planejador primeiro, depois dev, testador e revisor; pesquisador quando precisar de informação externa; documentador no final:

| Agente | Quando chamar |
|---|---|
| [[planejador]] | Primeiro, em qualquer feature/refatoração: quebra em tarefas |
| [[pesquisador]] | Quando precisar de doc de lib, erro desconhecido, comparação de opções |
| [[dev]] | Para implementar cada tarefa do plano |
| [[testador]] | Depois do dev: escreve e roda testes |
| [[revisor]] | Antes de considerar pronto: revisa o diff |
| [[documentador]] | No fim: atualiza README/docs |

Fluxo padrão: **planejador → (pesquisador) → dev → testador → revisor → documentador**.

- Agentes que não dependem um do outro podem rodar em paralelo (ex.: planejador e pesquisador; dev e testador em arquivos diferentes).
- Passe para cada agente todo o contexto que ele precisa (ele não vê esta conversa): objetivo, arquivos, decisões já tomadas.
- Se o testador ou o revisor apontar problema, mande de volta pro dev com o relatório.
- Em tarefa com interface (site, página, tela), peça **explicitamente** ao [[testador]] o teste no navegador (Playwright) e, quando fizer sentido, ao [[revisor]] o olhar visual. O testador deve testar no navegador sempre que houver interface; o pedido explícito do líder serve para garantir que isso aconteça.
- Em trabalho com mais de 2 etapas, **sempre** monte a lista de tarefas no começo (`TodoWrite` ou `TaskCreate`, uma tarefa por etapa) e atualize o status de cada uma: `in_progress` ao começar, `completed` ao terminar, com uma tarefa `in_progress` por vez. É essa lista que alimenta o quadro "AGzinhos na Etapa X de Y" do escritório.
- Monte a lista de tarefas a partir do plano do planejador: uma tarefa por etapa do plano.
- Só faça sozinho tarefas triviais (uma linha, uma pergunta, um comando). Na dúvida entre sozinho e time, use o time.
- Ao terminar, me diga em poucas linhas o que foi feito e por quem.

## Memória (vault do Obsidian)

A memória do time fica no vault `C:\Users\pablo.fernandes\OneDrive - Andrade Gutierrez\Área de Trabalho\AG-Project`, pasta `memoria/`. Índice: [[Memória]].

**No começo** de trabalho com mais de 2 etapas, leia: `memoria/Decisões.md`, `memoria/Lições aprendidas.md`, `memoria/Pendências.md` e as 2 notas mais recentes de `memoria/sessoes/`. Não reabra uma decisão `aceita` sem motivo novo.

**No fim**, peça ao [[documentador]] para:
1. Criar `memoria/sessoes/AAAA-MM-DD título.md` seguindo `templates/Sessão.md` e linkar a nota em `memoria/Sessões.md`.
2. Se houve escolha importante, criar a nota em `memoria/decisoes/` (`templates/Decisão.md`) e linkar em `memoria/Decisões.md`.
3. Se o [[testador]] ou o [[revisor]] devolveram algo que pode se repetir, registrar em `memoria/Lições aprendidas.md`.
4. Atualizar `memoria/Pendências.md` (marcar o que foi resolvido, incluir o que surgiu).

**Regras das notas:** use wikilinks (`[[nome]]`) com nome curto para agentes, decisões e arquivos citados; não guarde segredo, token nem dado pessoal; fatos que o código ou o git já mostram não precisam de nota.
