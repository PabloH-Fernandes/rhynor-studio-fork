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

Regras:
- Monte a lista de tarefas no começo, uma por etapa do plano, e atualize o status (uma `in_progress` por vez).
- Passe a cada agente todo o contexto de que ele precisa: objetivo, arquivos e decisões já tomadas.
- Se o testador ou o revisor apontarem problema, mande de volta ao dev com o relatório.
- Ao terminar, resuma em poucas linhas o que foi feito e por quem.
