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

**Nome esperado:** `ata-AAAA-MM-DD-HHmm-<slug>.md` (ex.: `ata-2026-10-13-1900-planejamento.md`), sempre na raiz desta pasta.

**Formato** (o mesmo que o fluxo do Power Automate grava; detalhes em `docs/power-automate-reunioes.md` do AG Pocket):

```markdown
---
tipo: ata-bruta
origem: copilot-insights
data: AAAA-MM-DD
hora: "HH:MM"
titulo: Título da reunião
reuniao_id: identificador-unico-da-reuniao
status: nova
confidencial: true
---

# Título da reunião

## Notas da reunião (Copilot)
- ...

## Decisões
- ...

## Tarefas
- [ ] O que fazer (responsável: Nome) (prazo: AAAA-MM-DD)
```

Responsável e prazo são opcionais. O formato antigo (`## Pauta`, `## Decisões`, `## Tarefas` com `- <o quê> | responsável: <função> | prazo: <AAAA-MM-DD ou vazio>`) também é aceito.

**O que acontece sozinho (com o AG Pocket ligado):** ele lê a ata **sem IA**, cria a nota em `10-Reunioes/` (ver [[Reunião]]) com os nomes trocados por "Responsável A, B..." e `confidencial: true`, e move a ata bruta para `00-Inbox/processadas/` (com `status: processada`). **Nada é apagado** e nenhum conteúdo vai para o Claude.

**Ata fora do formato** (por exemplo, só a transcrição): ela fica aqui e o painel mostra "precisa do /reuniao". Aí sim use o comando, que usa IA e só roda quando você manda:

- `/reuniao ata-2026-10-13-1900-planejamento.md`: processa esse arquivo (caminho relativo a esta pasta).
- `/reuniao` sem argumento: lista as atas com `status: nova` e pergunta qual usar (ou pede para colar o texto).
- `/reuniao <texto colado>`: processa o texto direto, sem arquivo.

O `/reuniao` também grava em `10-Reunioes/` e, para as tarefas que você escolher, em `20-Missoes/` (ver [[Missão]]).

**Para testar sem dados reais:** `npm run ata-ficticia` (no AG Pocket) cria uma ata inventada aqui.
