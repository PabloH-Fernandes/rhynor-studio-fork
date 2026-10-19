# Roteiro da apresentação

Demonstração automática do escritório, para quem não é de TI. Dura uns 3 minutos e 20 segundos.

**Endereço:** `http://localhost:4747/?apresentacao=1&demo=1` (o servidor precisa estar rodando: `npm start`).

## Antes de começar

1. Abra o endereço no navegador e aperte **F** (ou clique em "Tela cheia") para ocupar a tela toda. O navegador só aceita a tela cheia depois de um clique ou tecla, por isso ela não liga sozinha.
2. O roteiro começa assim que a página abre. Se quiser ensaiar, use **espaço** e **→** e depois **recarregue a página para começar do zero** (o recarregamento reinicia o roteiro).
3. Para o passo 1 ter gente na mesa de reunião, deixe alguém no escritório antes (rode a simulação uma vez, ou deixe uma sessão aberta). Com o escritório vazio, só o quadro da parede avisa "Nova ata".

## Teclas

| Tecla | O que faz |
|---|---|
| `espaço` | Pausa e continua o roteiro (a legenda mostra "Pausado") |
| `→` | Pula para o próximo passo |
| `F` | Liga e desliga a tela cheia |

A pausa vale só para o roteiro. Os AGzinhos do passo 4 são uma simulação do servidor e **não param** quando você pausa.

## O que falar em cada passo

**Passo 1, "Chega a ata da reunião" (10 s)**
"Toda reunião gera uma ata. Aqui chegou uma agora. Repare no escritório: o time senta na mesa de reunião e o quadro da parede avisa que tem ata nova."

**Passo 2, "A ata aparece na Caixa de entrada" (12 s)**
"A ata virou uma lista de tarefas, sem ninguém digitar nada. Cada tarefa tem responsável e prazo."

**Passo 3, "Aprovamos duas tarefas para o time" (16 s)**
"Eu decido quem faz cada tarefa: o time de agentes ou eu mesmo. Duas ficam com o time. Ao aprovar, o painel entrega o comando pronto para colar. Nada roda sozinho: quem manda começar sou eu."

**Passo 4, "O time trabalhando" (2 min 12 s)**
"Agora o time trabalha. Cada pessoinha é um agente de IA com uma função: planejar, programar, testar, revisar, documentar. Dá para ver quem está trabalhando, quem está pensando e quem está esperando uma resposta minha. Quando termina, eles descansam: café, ping-pong, conversa."
*Dica: o quadro da parede mostra em que etapa o time está. Este é o momento de deixar a animação falar por você.*

**Passo 5, "Pendências e Resultados atualizam" (30 s)**
"O trabalho do time saiu das pendências e os números subiram: atas processadas, tarefas aprovadas, missões concluídas. O tempo economizado é uma **estimativa**, não uma medição exata. Dá para ajustar a conta."

Depois do passo 5 aparece "Fim da demonstração". A tela fica como está para perguntas.

## Se algo falhar

| Problema | O que fazer |
|---|---|
| A legenda avisa que não conseguiu iniciar a simulação | O servidor caiu. Rode `npm start` e recarregue a página: o roteiro recomeça do passo 1. |
| O escritório fica vazio no passo 4 | Confira se o servidor está rodando (`npm start`) e recarregue a página. A simulação leva alguns segundos para o time chegar. |
| Perdeu o passo | `espaço` pausa e você conversa o tempo que quiser; `→` pula para o próximo. |
| A tela cheia não liga | Clique na página e aperte **F** de novo (o navegador só aceita depois de um gesto). |
| Quer recomeçar | Recarregue a página (F5). A simulação anterior é substituída pela nova no passo 4. |
| Aparece um nome real | Veja o aviso abaixo e use um vault fictício. |

## Aviso sobre privacidade

No modo apresentação a privacidade fica sempre ligada: projetos, arquivos, títulos de reunião e responsáveis viram apelidos ("Projeto Alfa", "Reunião 1", "Responsável A"). Mas isso é **melhor esforço**: a troca é feita no navegador, os dados reais ainda chegam até ele e podem ser vistos pelas ferramentas do navegador (aba Rede) ou escapar em algum texto livre.

Na apresentação, o conteúdo de conversas entre agentes, descrições de tarefas, comandos e buscas é trocado por rótulos genéricos ("Conversando", "Trabalhando numa tarefa", "Executando uma tarefa no computador", "Pesquisando"). A privacidade **não cobre**: texto livre que fuja desses rótulos genéricos, nomes com menos de 3 letras (não são trocados) e nomes que ninguém registrou (que não aparecem em projeto, reunião, missão nem responsável).

**Numa apresentação de verdade, o ideal é usar um vault fictício** (por exemplo, um vault de teste com `npm run ata-ficticia`), e não o seu vault de trabalho.

Os dados da demo (a ata "Planejamento da Loja Aurora", as tarefas, as pendências e os números) são inventados, ficam só no navegador e não são gravados no vault. O único pedido que a demo faz ao servidor é iniciar a simulação de AGzinhos.
