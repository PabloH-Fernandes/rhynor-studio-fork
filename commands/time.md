---
description: Roda a tarefa com o time de AGzinhos (planejador, dev, testador, revisor, documentador)
---

Use o time de subagentes para a tarefa abaixo, sem fazer o trabalho sozinho na conversa principal.

Tarefa: $ARGUMENTS

Fluxo, nesta ordem:
1. **planejador**: quebra a tarefa em etapas pequenas, com arquivos e riscos.
2. **pesquisador** (só se precisar de informação de fora do projeto: doc de lib, erro desconhecido).
3. **dev**: implementa cada etapa do plano.
4. **testador**: escreve e roda os testes. Se a tarefa tiver interface (site, página, tela), peça explicitamente o teste no navegador com o Playwright (desktop 1280px e celular 390px, erros de console, no máximo 2 prints).
5. **revisor**: revisa o diff antes de dar como pronto. Se achar problema, devolve ao dev.
6. **documentador**: atualiza README e docs no fim.
   No vault, ele também atualiza a nota da missão, a do projeto e a memória do time.

Regras:
- No começo, leia a memória como manda o bloco "Memória do time" e passe o caminho do vault (`AGPOCKET_VAULT`) aos agentes que usam o vault.
- Se a tarefa citar uma nota de `20-Missoes/` (ex.: `Missão [[2026-10-13-pagina-de-inscricao]]`), leia essa nota, mude `status:` para `em andamento` antes do planejador e passe o nome dela ao documentador, que marca `concluída` e preenche `## Resultado`. A nota de missão nasce com `confidencial: false`, mas confira mesmo assim antes de ler: leia só as primeiras linhas com Read (`limit`) até o fim do frontmatter; se tiver `confidencial: true` ou não der para saber, pare e não leia o resto.
- Monte a lista de tarefas no começo, uma por etapa do plano, e atualize o status (uma `in_progress` por vez).
- Passe a cada agente todo o contexto de que ele precisa: objetivo, arquivos e decisões já tomadas.
- Se o testador ou o revisor apontarem problema, mande de volta ao dev com o relatório.
- Ao terminar, resuma em poucas linhas o que foi feito e por quem.
