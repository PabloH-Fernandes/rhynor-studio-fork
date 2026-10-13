---
tipo: indice
projeto:
data: 2026-10-09
status: ativo
origem: setup
tags: [indice]
confidencial: false
---

# Índice do vault

Mapa curto. Os agentes leem **este arquivo primeiro** e depois só as notas de que precisam. Nunca leem o vault inteiro.

## Pastas

| Pasta | O que tem |
|---|---|
| `00-Inbox/` | Entrada bruta: atas coladas, ideias soltas. Ver [[LEIA-ME]] |
| `10-Reunioes/` | Uma nota por reunião (modelo: [[Reunião]]) |
| `20-Missoes/` | Uma nota por missão: origem, tarefas, status, commits (modelo: [[Missão]]) |
| `30-Projetos/` | Uma nota por projeto ou repositório (modelo: [[Projeto]]) |
| `40-Conhecimento/` | Padrões, glossário, "como fazer X", lições reutilizáveis. Entrada: [[Conhecimento]] |
| `50-Time/` | Um card por agente e o mapa [[AGENTES.canvas|AGENTES]] |
| `90-Memoria-do-time/` | [[Memória]]: [[Decisões]], [[Lições aprendidas]], [[Pendências]], [[Sessões]] |
| `Templates/` | Modelos de nota |

## Como o time usa

1. **Início de missão:** ler este índice, depois só a nota do projeto atual (`30-Projetos/`), as [[Decisões]] e as [[Pendências]] relacionadas.
2. **Fim de missão:** o [[documentador]] atualiza a nota da missão, a do projeto e a memória do time.
3. **Consulta:** `/memoria <pergunta>` responde só com base no vault.
4. **Reunião:** `/reuniao` transforma uma ata de `00-Inbox/` (ou texto colado) numa nota em `10-Reunioes/`, classifica as tarefas (🤖 time, 🙋 humano, ❓ dúvida) e, só para as que você escolher, cria missões em `20-Missoes/` com o `/time` sugerido. Nunca começa nada sozinho.
5. Toda nota tem frontmatter: `tipo`, `projeto`, `data`, `status`, `origem`, `tags`, `confidencial`.

## Regra de confidencial

- Nota com `confidencial: true` **não é lida** pelos agentes. Só o título dela pode aparecer aqui no índice.
- Toda nota de reunião nasce com `confidencial: true` até o dono mudar para `false`.
- Nunca salvar senha, token, chave ou dado pessoal no vault.
