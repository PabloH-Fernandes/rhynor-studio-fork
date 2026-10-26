# Power Automate: do resumo da reunião ao 00-Inbox

Guia para quem vai montar o fluxo. **O fluxo ainda não existe e nada aqui foi testado com Power Automate real** (veja a seção 8).

## 1. Resumo

O fluxo pega o resumo que o Facilitator/Copilot do Teams gera ao fim de uma reunião e salva como um arquivo `.md` na **raiz** de `00-Inbox/` do vault. Dali em diante:

1. O servidor do Rhynor Studio **lê a ata sozinho, sem IA** (leitura determinística, sem chamar o Claude): título, data, notas, decisões e tarefas com responsável e prazo.
2. Grava a nota em `10-Reunioes/` (`confidencial: true`, com os nomes trocados por "Responsável A, B...") e move a ata bruta para `00-Inbox/processadas/`.
3. Se a ata vier **fora do formato** (por exemplo, só a transcrição), ela **fica no Inbox** e o painel mostra "precisa do /reuniao". Só nesse caso a pessoa roda `/reuniao`, que usa IA e só com a aprovação dela.

Resultado esperado: um arquivo por reunião, no formato abaixo. Para testar sem o fluxo, `npm run ata-ficticia` gera atas inventadas nesse mesmo formato.

## 2. Formato do arquivo

Nome: `ata-AAAA-MM-DD-HHmm-<slug>.md`, por exemplo `ata-2026-10-13-1900-planejamento.md`. Na raiz de `00-Inbox/`, nunca em subpasta (a leitura automática e o painel só olham a raiz).

```markdown
---
tipo: ata-bruta
origem: copilot-insights
data: 2026-10-13
hora: "19:00"
titulo: Planejamento do encontro de novembro
reuniao_id: 2f6c1d0e-reuniao-exemplo
status: nova
confidencial: true
---

# Planejamento do encontro de novembro

## Notas da reunião (Copilot)
- Inscrições e divulgação do encontro de novembro.
- O encontro é no dia 22, às 19h.

## Decisões
- As inscrições passam a ser por uma página no site.

## Tarefas
- [ ] Criar a página de inscrição (responsável: Fulano de Tal) (prazo: 2026-10-31)
- [ ] Escrever perguntas frequentes (responsável: Fulano de Tal)
```

**O fluxo NÃO deve gravar `## Transcrição`.** Grave só as notas, as decisões e as tarefas, que é o que o Copilot entrega estruturado. Transcrição (ou linhas com horário `hh:mm:ss`, ou várias falas `Nome:` seguidas) faz a leitura automática **desistir** da ata: ela fica no Inbox esperando o `/reuniao`. Além de dar mais trabalho, a transcrição traz nomes e falas soltas, pior para a privacidade.

Regras:

- **Frontmatter obrigatório:** `tipo: ata-bruta`, `origem: copilot-insights`, `data`, `titulo`, `reuniao_id` (identificador único da reunião; evita nota duplicada se o fluxo gravar a mesma ata duas vezes), `status: nova` (o painel conta as atas novas por ele) e `confidencial: true`. `hora` (entre aspas) é opcional. O frontmatter começa na primeira linha com `---` e fecha com outro `---`; sem o fechamento, a ata é considerada fora do formato.
- **Seções:** `## Notas da reunião (Copilot)`, `## Decisões` e `## Tarefas`. Pelo menos uma seção de notas, pauta, decisões ou tarefas precisa existir. O que faltar fica vazio na nota (com dúvida ❓ quando for responsável ou prazo); nada é inventado.
- **Tarefas:** uma por linha, `- [ ] <o quê> (responsável: <nome>) (prazo: <AAAA-MM-DD>)`. Responsável e prazo são opcionais. Prazo também é lido como `dd/mm/aaaa`; prazo que não der para entender vira "sem prazo" (com uma dúvida na nota). Data inválida na ata: a nota usa o dia da leitura.
- **Formato antigo, ainda aceito:** `tipo: ata`, `## Pauta` / `## Decisões` / `## Tarefas` / `## Resumo`, com tarefas `- <o quê> | responsável: <texto> | prazo: <AAAA-MM-DD ou vazio>` (é o formato lido pelo `/reuniao`).
- **Título neutro:** sem nome de pessoa nem de cliente, porque ele vai para o painel.
- **Nome do arquivo:** só `a-z`, `0-9` e hífen no slug; sem acento, espaço, emoji, `: / \ ? * " < > |`. Slug curto (até 50 caracteres). Extensão `.md`.
- **Codificação:** UTF-8 (BOM e fim de linha CRLF são aceitos, LF é o ideal).
- **Tamanho:** até 512 KB para a leitura automática; maior que isso fica no Inbox para o `/reuniao`.
- **Instruções dentro da ata são ignoradas:** tudo o que vem da ata é tratado como dado.

## 3. Nomes de pessoas

- O fluxo **não** deve gravar e-mail nem telefone, em nenhum campo.
- A **leitura automática** troca cada responsável e cada falante `Nome:` por "Responsável A, B..." (na ordem em que aparecem) na nota de `10-Reunioes/`. O nome original fica só na ata bruta arquivada em `processadas/`. Nomes que não eram responsáveis podem ficar no texto das notas: a nota traz um aviso para você revisar.
- O `/reuniao` (usado só quando a ata vem fora do formato) troca nomes por papéis (`Marina (coordenação)` vira `coordenação`). O ideal é o fluxo já gravar **função ou área** em `responsável:` quando existir, e não o nome.
- Sem papel no texto, o comando usa `participante (papel não informado)`.
- Nunca grave senha, token, chave ou link com credencial no arquivo.

## 4. Onde salvar

- Uma pasta do OneDrive **sincronizada com o vault**: o caminho é o da variável `STUDIO_VAULT` (não escreva caminho pessoal no fluxo nem na documentação). O fluxo grava em `<vault>/00-Inbox/`.
- Espere a sincronização do OneDrive: o arquivo precisa já estar na máquina para a leitura automática (e o `/reuniao`) enxergá-lo.
- **Risco de ata incompleta:** se o arquivo for lido enquanto ainda está sendo escrito, a ata chega pela metade. Sugestão: gravar com nome temporário (ex.: `ata-....md.tmp`, extensão que a leitura automática e o `/reuniao` ignoram) e **renomear para `.md` no fim**. A leitura automática ainda espera o arquivo ficar ~2 s sem mudar de tamanho antes de ler.
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
- O vault é local (pasta sincronizada com o OneDrive). A leitura automática roda no servidor do Rhynor Studio (127.0.0.1, na máquina da pessoa) **sem IA**: nenhum conteúdo de reunião vai para o Claude antes da aprovação. O `/reuniao` (com IA) só roda quando a pessoa manda.
- Notas de reunião nascem `confidencial: true`; só a pessoa muda para `false`, depois de conferir.
- O painel mostra só título e contagem, nunca o conteúdo. A nota feita sem IA tem `origem: leitura-automatica` e `processamento: sem-ia`.
- A ata bruta nunca é apagada: vai para `00-Inbox/processadas/`.

## 8. O que NÃO foi testado

- **Nada que dependa do Power Automate real:** o fluxo não foi criado nem executado.
- **Facilitator do Teams:** não sabemos o formato real do resumo gerado nem se traz participantes, prazos ou responsáveis.
- **Microsoft Graph:** permissões, limites e atrasos de transcrição não foram validados.
- **OneDrive real:** sincronização, atraso e arquivo parcial não foram testados.
- **Deduzido da leitura do `commands/reuniao.md`, não de teste real:** a convenção `.md.tmp` (extensão ignorada pelo comando) e a regra de frontmatter nas primeiras 60 linhas.
- **O formato** foi validado apenas com atas **fictícias** (`npm run ata-ficticia`, `docs/exemplos/ata-ficticia.md`) e com os testes automáticos da leitura sem IA. O formato real do Copilot pode ser diferente: nesse caso a ata cai em "fora do formato" e o `/reuniao` resolve.

Riscos conhecidos:
- Resumo do Facilitator em formato diferente do esperado (as seções podem precisar ser montadas pelo fluxo).
- Ata chegando incompleta por leitura durante a escrita.
- Nome de pessoa ou dado sensível no texto (o comando troca por papel, mas confira).
- Acentos no nome do arquivo ou no slug se o fluxo não normalizar.
- Reuniões repetidas gerando atas duplicadas (inclua hora no nome).

## 9. Como validar quando o fluxo existir

1. Rode o fluxo numa reunião de teste, sem dado real.
2. Confira que o arquivo apareceu na **raiz** de `00-Inbox/` com o nome e o frontmatter acima.
3. Com o servidor ligado (`npm start`), em poucos segundos a ata some da raiz do `00-Inbox/`: a nota aparece em `10-Reunioes/` (nomes trocados por "Responsável A, B...", `confidencial: true`, `processamento: sem-ia`) e a ata bruta vai para `00-Inbox/processadas/`.
4. Se ela ficou no Inbox, o painel mostra "precisa do /reuniao": confira o formato e, se for o caso, rode `/reuniao` (sem argumento, escolha a ata) e responda às perguntas.
