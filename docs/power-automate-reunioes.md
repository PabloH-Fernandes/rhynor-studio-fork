# Power Automate: do resumo da reunião ao 00-Inbox

Guia para quem vai montar o fluxo. **O fluxo ainda não existe e nada aqui foi testado com Power Automate real** (veja a seção 8).

## 1. Resumo

O fluxo pega o resumo que o Facilitator do Teams gera ao fim de uma reunião e salva como um arquivo `.md` na **raiz** de `00-Inbox/` do vault. Depois, o painel mostra a faixa "Chegou uma ata nova" e a pessoa roda `/reuniao` para virar nota em `10-Reunioes/` e, se quiser, missões.

Resultado esperado: um arquivo por reunião, no formato abaixo, que o `/reuniao` aceita sem ajuste.

## 2. Formato do arquivo

Nome: `ata-AAAA-MM-DD-HHmm-<slug>.md`, por exemplo `ata-2026-10-13-1900-planejamento.md`. Na raiz de `00-Inbox/`, nunca em subpasta (o painel só avisa da raiz).

```markdown
---
tipo: ata
projeto:
data: 2026-10-13
status: nova
origem: power-automate
tags: [ata, inbox]
confidencial: true
titulo: Planejamento do encontro de novembro
hora: "19:00"
---

# Planejamento do encontro de novembro

## Pauta
- Inscrições
- Divulgação

## Decisões
- O encontro é no dia 22, às 19h.

## Tarefas
- Criar a página de inscrição | responsável: voluntário de TI | prazo: 2026-10-31
- Escrever perguntas frequentes | responsável: voluntário de TI | prazo:

## Resumo
Texto livre do Facilitator (opcional).
```

**Por padrão, o fluxo NÃO grava `## Transcrição`.** Grave só Pauta, Decisões, Tarefas e Resumo, que é o que o Facilitator entrega estruturado. Motivos: com transcrição o `/reuniao` trata a ata como bagunçada e extrai só o explícito; e a transcrição traz nomes e falas soltas, pior para a privacidade. Só inclua `## Transcrição` se o fluxo tiver apenas a transcrição bruta (sem resumo estruturado); nesse caso o resultado terá mais ❓.

Regras:

- **Obrigatórios no frontmatter:** `tipo: ata`, `data`, `status: nova` (sem isso a ata não aparece na lista do `/reuniao`), `origem: power-automate`, `tags: [ata, inbox]`, `confidencial: true`, `titulo`, `hora` entre aspas. `projeto:` fica vazio (quem escolhe é a pessoa, no `/reuniao`).
- O frontmatter começa na primeira linha com `---` e fecha com outro `---`, tudo nas primeiras 60 linhas.
- `data` no formato `AAAA-MM-DD` e dia real. Se for inválida ou faltar, o comando usa a data de hoje e registra uma dúvida.
- **Seções:** `# título`, `## Pauta`, `## Decisões`, `## Tarefas`; `## Resumo` e `## Transcrição` são opcionais. O que faltar vira ❓ no resultado; o comando não inventa prazo, responsável nem decisão.
- **Tarefas:** uma por linha, exatamente `- <o quê> | responsável: <texto> | prazo: <AAAA-MM-DD ou vazio>`. Prazo ou responsável vazios são aceitos (viram ❓).
- Se existir `## Transcrição`, a ata inteira é tratada como **bagunçada** (transcrição): o `/reuniao` extrai só o que estiver explícito e marca o resto com ❓. Sem ela, e com as seções limpas, é tratada como resumo.
- **Título neutro:** sem nome de pessoa nem de cliente, porque ele vai para o painel.
- **Nome do arquivo:** só `a-z`, `0-9` e hífen no slug; sem acento, espaço, emoji, `: / \ ? * " < > |`. Slug curto (até 50 caracteres). Extensão `.md` (`.txt` também é lido).
- **Codificação:** UTF-8 (BOM e fim de linha CRLF são aceitos, LF é o ideal).
- **Tamanho:** sem limite fixo, mas prefira só o resumo. Transcrição longa funciona, porém aumenta a chance de ❓ e o custo.
- **Instruções dentro da ata são ignoradas:** tudo o que vem da ata é tratado como dado.

## 3. Nomes de pessoas

- O fluxo **não** deve gravar e-mail nem telefone, em nenhum campo.
- O `/reuniao` troca nomes por papéis (`Marina (coordenação)` vira `coordenação`). O ideal é o fluxo já gravar **função ou área** em `responsável:` quando existir, e não o nome.
- Sem papel no texto, o comando usa `participante (papel não informado)`.
- Nunca grave senha, token, chave ou link com credencial no arquivo.

## 4. Onde salvar

- Uma pasta do OneDrive **sincronizada com o vault**: o caminho é o da variável `AGPOCKET_VAULT` (não escreva caminho pessoal no fluxo nem na documentação). O fluxo grava em `<vault>/00-Inbox/`.
- Espere a sincronização do OneDrive antes de rodar o `/reuniao` (o arquivo precisa já estar na máquina).
- **Risco de ata incompleta:** se o arquivo for lido enquanto ainda está sendo escrito, a ata chega pela metade. Sugestão: gravar com nome temporário (ex.: `ata-....md.tmp`, extensão que o `/reuniao` ignora) e **renomear para `.md` no fim**.
- Não sobrescrever: se o nome já existir, acrescentar `-2`.

## 5. Gatilho

| Opção | Prós | Contras |
|---|---|---|
| Fim da reunião (Teams) | Rápido, simples | O resumo do Facilitator pode ainda não estar pronto |
| Transcrição/resumo disponível | Chega completa | Depende do recurso estar ligado e do atraso do Teams |
| Manual (botão ou "salvar como") | Controle total, sem permissão extra | Esquecimento; trabalho manual |

Sugestão: começar pela **transcrição/resumo disponível** e, se não der, usar o manual.

## 6. Checklist para a TI

- [ ] Licença do Microsoft 365 Copilot e do recurso de resumo/Facilitator do Teams para quem organiza as reuniões.
- [ ] Gravação e transcrição liberadas por política para essas reuniões.
- [ ] Conectores permitidos pela política de DLP (Teams/Microsoft Graph, OneDrive for Business). Nenhum conector fora da empresa.
- [ ] Permissões do Microsoft Graph necessárias para ler o resumo/transcrição da reunião (a TI define o mínimo e quem aprova).
- [ ] Dono do fluxo (uma pessoa responsável, com substituto) e conta de serviço, se couber.
- [ ] Retenção: por quanto tempo a ata bruta e o log do fluxo ficam guardados.

## 7. Governança

- Conteúdo de reunião enviado a IA **externa** exige aprovação formal antes (jurídico/segurança/TI).
- O vault é local (pasta sincronizada com o OneDrive); o `/reuniao` roda na máquina da pessoa.
- Notas de reunião nascem `confidencial: true`; só a pessoa muda para `false`, depois de conferir.
- O painel mostra só título e contagem, nunca o conteúdo.
- A ata bruta nunca é apagada: vai para `00-Inbox/processadas/`.

## 8. O que NÃO foi testado

- **Nada que dependa do Power Automate real:** o fluxo não foi criado nem executado.
- **Facilitator do Teams:** não sabemos o formato real do resumo gerado nem se traz participantes, prazos ou responsáveis.
- **Microsoft Graph:** permissões, limites e atrasos de transcrição não foram validados.
- **OneDrive real:** sincronização, atraso e arquivo parcial não foram testados.
- **Deduzido da leitura do `commands/reuniao.md`, não de teste real:** a convenção `.md.tmp` (extensão ignorada pelo comando) e a regra de frontmatter nas primeiras 60 linhas.
- **O formato** foi validado apenas com a **ata fictícia** (`docs/exemplos/ata-ficticia.md`) e com os testes automáticos do `/reuniao`.

Riscos conhecidos:
- Resumo do Facilitator em formato diferente do esperado (as seções podem precisar ser montadas pelo fluxo).
- Ata chegando incompleta por leitura durante a escrita.
- Nome de pessoa ou dado sensível no texto (o comando troca por papel, mas confira).
- Acentos no nome do arquivo ou no slug se o fluxo não normalizar.
- Reuniões repetidas gerando atas duplicadas (inclua hora no nome).

## 9. Como validar quando o fluxo existir

1. Rode o fluxo numa reunião de teste, sem dado real.
2. Confira que o arquivo apareceu na **raiz** de `00-Inbox/` com o nome e o frontmatter acima.
3. Abra o painel e veja a faixa "Chegou uma ata nova".
4. Rode `/reuniao` (sem argumento, escolha a ata) e responda às perguntas.
5. Confira a nota em `10-Reunioes/` (sem nomes, `confidencial: true`) e a ata em `00-Inbox/processadas/`.
