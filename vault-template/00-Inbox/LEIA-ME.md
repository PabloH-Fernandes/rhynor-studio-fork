---
tipo: inbox
projeto:
data: 2026-10-09
status: ativo
origem: setup
tags: [inbox]
confidencial: false
---

# Inbox

Entrada bruta do vault. Solte aqui atas coladas, transcrições e ideias soltas, sem formatar.

- Arquivos daqui são **brutos e podem ter conteúdo sensível**: trate como `confidencial: true`.
- Voltar: [[_indice]]

## Atas de reunião

**Nome esperado:** `ata-AAAA-MM-DD-HHmm-<slug>.md` (ex.: `ata-2026-10-13-1900-planejamento.md`).

**Frontmatter mínimo:**

```yaml
---
tipo: ata
projeto:
data: AAAA-MM-DD
status: nova
origem: power-automate   # ou manual
tags: [ata, inbox]
confidencial: true
titulo: Título da reunião
hora: "HH:MM"
---
```

Seções: `# título`, `## Pauta`, `## Decisões`, `## Tarefas` (uma por linha: `- <o quê> | responsável: <função> | prazo: <AAAA-MM-DD ou vazio>`), `## Resumo` e `## Transcrição` (opcionais). O que faltar vira ❓.

**Como usar:**

- `/reuniao ata-2026-10-13-1900-planejamento.md`: processa esse arquivo (caminho relativo a esta pasta).
- `/reuniao` sem argumento: lista as atas com `status: nova` e pergunta qual usar (ou pede para colar o texto).
- `/reuniao <texto colado>`: processa o texto direto, sem arquivo.

O resultado vai para `10-Reunioes/` (ver [[Reunião]]) e, para as tarefas que você escolher, para `20-Missoes/` (ver [[Missão]]).

**Depois de processar:** o arquivo ganha `status: processada` e `reuniao: <nota>` no frontmatter e é movido para `00-Inbox/processadas/`. **Nunca é apagado.**
