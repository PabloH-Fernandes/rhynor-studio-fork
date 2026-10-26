---
tipo: missao
projeto:
data: {{date:YYYY-MM-DD}}
status: a fazer
origem: reuniao
reuniao:
reuniao_titulo:
classe: time
tags: [missao]
confidencial: false
---
<!--
Valores válidos (o painel do Rhynor Studio lê este frontmatter):
- projeto: nome da nota de 30-Projetos/ sem os colchetes do link, ou vazio
- status: a fazer | em andamento | concluída (exatamente assim, com acento)
- origem: reuniao (criada pelo /reuniao) | manual
- reuniao: nome da nota de 10-Reunioes/ sem os colchetes do link, ou vazio
- reuniao_titulo: título neutro da reunião, sem nome de pessoa
- classe: time | humano | duvida
- Nome do arquivo: 20-Missoes/AAAA-MM-DD-<slug>.md
-->

# {{title}}

**Origem:** [[AAAA-MM-DD-titulo-da-reuniao]] · **Projeto:** [[nome-do-projeto]]

## Objetivo
Em uma ou duas linhas.

## Tarefas
- [ ]

## Comando sugerido
`/time Missão [[AAAA-MM-DD-nome-da-missao]]: <descrição em 1 linha>. Projeto: <projeto>`
(só para `classe: time`; para `humano` ou `duvida`, escreva o que falta antes)

## Resultado
- Commits:
- O que mudou:
- Sessão: [[AAAA-MM-DD título-da-sessão]]
