# Missão v5: AG Pocket pronto para apresentar (rodando no PC de casa)

**Contexto:** estou no meu PC pessoal. Aqui **não existe** nada da AG: sem OneDrive da empresa, sem atas reais, sem Teams. Tudo nesta missão usa **dados fictícios**. No PC da AG, depois, eu só aponto o AG Pocket pro vault real (`AG-Cerebro`) e ligo o fluxo do Power Automate, que já salva as atas em `00-Inbox/`.

**Regra de ouro desta missão:** nenhum dado real da AG. Nomes, projetos e reuniões são inventados.

Use o time (planejador → dev → testador → revisor → documentador), um commit por etapa.

**Economia:**
- No máximo 2 prints por etapa, e só o revisor olha.
- Sem sessões extras com `claude -p`.
- Arquivos grandes lidos por trechos.
- A missão tem **duas partes**. Ao terminar a **Parte A**, pare, me mande o resumo e espere. A Parte B eu rodo numa sessão nova.

---

## Etapa 0: preparar este PC

- Confira se o `npm run setup` já rodou aqui. Se não, rode com o vault de teste em `C:\Users\pablo\dev\AG-Cerebro-teste` (crie a partir do `vault-template/`, **nunca** apontando pra pasta da empresa).
- `npm run setup:check` tudo verde (ou explique o que falta).
- Me diga como abrir esse vault no Obsidian.

---

# PARTE A: fechar o fluxo das reuniões e preparar a demo

## Etapa 1: gerador de atas fictícias + leitura sem IA

**1a. `npm run ata-ficticia`**
- Gera uma ata **no mesmo formato que o fluxo do Power Automate vai produzir** (veja `docs/power-automate-reunioes.md`: frontmatter com `tipo: ata-bruta`, `origem: copilot-insights`, `data`, `titulo`, `reuniao_id`, `confidencial: true`, mais as seções `## Notas da reunião (Copilot)` e `## Tarefas` com `- [ ] texto (responsável: Nome)`).
- Salva em `00-Inbox/` do vault configurado.
- Tem 4 a 5 cenários variados: reunião de projeto de software, alinhamento de BI, reunião só com decisões, reunião com tarefas sem prazo e reunião com texto bagunçado. Use `--cenario=<nome>` ou aleatório.
- Nomes, empresas e projetos 100% inventados.

**1b. Leitura determinística (sem IA)**
- Quando chegar uma ata nova no `00-Inbox/`, o servidor do AG Pocket **lê e organiza sozinho, sem chamar o Claude**: título, data, notas, lista de tarefas, responsável e prazo (se tiver).
- Cria a nota em `10-Reunioes/` (como o `/reuniao` já faz, com `confidencial: true` e nomes trocados por "Responsável A, B..." no corpo da nota; o nome original fica só no arquivo bruto arquivado).
- Arquiva a ata bruta em `00-Inbox/_processadas/`.
- **Motivo:** as atas do Copilot já vêm estruturadas. Ler sem IA é grátis, instantâneo e **nenhum conteúdo de reunião vai pro Claude antes da minha aprovação**. Esse é um argumento forte de governança.
- Se a ata vier fora do formato, ela fica no Inbox marcada como "precisa do /reuniao" (aí sim usa IA, quando eu mandar).

## Etapa 2: triagem e aprovação no painel

Nova seção **"Caixa de entrada"** no painel (no topo, quando tiver algo):
- Cada reunião nova aparece com as tarefas listadas.
- Para cada tarefa, eu escolho: **🤖 Time faz** / **🙋 Eu faço** / **🗑️ Ignorar**.
- **Aprovar** cria a nota de missão em `20-Missoes/` (link pra reunião) e mostra o **comando pronto** pra rodar (`/time ...`), com botão **Copiar**.
  - **Não** dispare o Claude sozinho a partir do painel. Quem executa sou eu no terminal (controle de custo e de aprovação).
- Tarefas **🙋 Eu faço** viram pendências minhas (Etapa 3).
- No escritório: quando chega ata nova, toca a animação de reunião (os AGzinhos livres vão pra mesa) e o quadro da parede mostra "📋 Nova ata: [título]".

## Etapa 3: painel de pendências com prazos

Nova seção **"Pendências"**:
- Junta todas as tarefas abertas (minhas e do time) das notas de reunião e de missão.
- Mostra responsável, prazo, origem (reunião) e status.
- Destaque visual: **🔴 atrasada**, **🟠 vence em até 2 dias**, **⚪ sem prazo**. Laranja e vermelho seguindo a paleta AG, mas com ícone e texto além da cor.
- Marcar como **concluída** no painel atualiza o checkbox na nota (`- [x]`) e registra a data.
- Filtros: minhas / do time / atrasadas.
- No escritório, se houver tarefa atrasada, um AGzinho segura uma plaquinha "⚠️ atrasada" (discreto, sem poluir).

## Etapa 4: contador de ganho

Nova seção **"Resultados"** (e um resumo pequeno no topo do painel):
- Atas processadas, tarefas aprovadas, missões concluídas, pendências fechadas: hoje / semana / total.
- **Tempo economizado estimado**, com valores configuráveis em `data/estimativas.json` (ex.: ata processada = 20 min, missão de documentação = 60 min). Sempre com o rótulo **"estimativa"** visível. Nunca apresentar como medição exata.
- Os números vêm das notas do vault (fonte da verdade) e não de contadores soltos em memória.
- Botão **"Exportar resumo"**: gera um `.md` simples com esses números para eu colar num e-mail ou slide.

## Etapa 5: transparência ("o que foi enviado ao Claude")

Nova seção **"Transparência"**:
- Registro (via hooks que já existem) de **quais arquivos do vault** os agentes leram, quando, em qual sessão e para qual missão.
- Destacar em vermelho se algum agente leu nota com `confidencial: true` (isso não deveria acontecer; se acontecer, é bug a corrigir).
- Mostrar também: "atas processadas sem IA" vs "com IA (/reuniao)".
- Log salvo em `data/transparencia/AAAA-MM.jsonl` (fora do git), com exportação em `.md`.
- **Confira na documentação de hooks** quais campos estão disponíveis (`tool_input.file_path` etc.) em vez de supor.

## Etapa 6: modo apresentação

- `http://localhost:4747/?apresentacao=1`:
  - Tela cheia, escritório maior, painel simplificado (Caixa de entrada, Pendências e Resultados).
  - **Modo privacidade** sempre ligado: troca nomes reais por fictícios em tudo que aparece na tela.
- **Roteiro de demo automático** (`?apresentacao=1&demo=1`), em uns 3 minutos:
  1. Chega uma ata fictícia (animação de reunião).
  2. Ela aparece na Caixa de entrada com as tarefas.
  3. Aprovação automática de 2 tarefas pro time.
  4. Os AGzinhos trabalham (simulação que já existe).
  5. As pendências e os Resultados atualizam.
- Teclas: `espaço` pausa e continua, `→` avança o passo.
- Escreva `docs/roteiro-apresentacao.md` com o que eu falo em cada passo (curto, linguagem de quem não é de TI).

**Fim da Parte A.** Pare aqui e me mande: tabela de etapas e commits, o que voltou do testador e do revisor, e as pendências.

---

# PARTE B: eficiência e memória (rodar em sessão nova)

## Etapa 7: modelo por função + gasto por missão

- Revise o `model:` de cada agente em `agents/`: modelo mais leve para tarefas simples (documentador, pesquisador), o padrão para dev e revisor, e justifique em uma linha cada. Confira na documentação de subagentes os valores aceitos.
- **Gasto por missão:** se o hook trouxer `transcript_path`, leia o uso de tokens do transcript no `Stop`/`SubagentStop` e mostre no crachá ("tokens hoje") e na nota da missão. Confira o formato real antes de implementar. Se não der pra obter com confiança, me explique e não invente número.

## Etapa 8: busca no painel

- Campo **"Buscar no cérebro"** no painel: busca **texto local no vault** (sem IA, instantâneo), respeitando `confidencial: true` (essas notas só aparecem pelo título, com cadeado).
- Resultado com trecho e botão **"Abrir no Obsidian"** (link `obsidian://open?vault=...&file=...`).
- Botão **"Perguntar ao time"**: copia o comando `/memoria <pergunta>` pra eu rodar no terminal.

## Etapa 9: replay do dia

- Guardar um resumo leve dos eventos do dia (sem o gravador completo ligado) em `data/replay/AAAA-MM-DD.jsonl`.
- No painel: **"Replay do dia"**, que roda o escritório acelerado (10x, 30x, 60x) com uma linha do tempo pra arrastar.
- Ótimo pra demo: "isso foi o que o time fez hoje".

## Etapa 10: documentação

- README e SETUP.md: Caixa de entrada, Pendências, Resultados, Transparência, modo apresentação, `npm run ata-ficticia`, busca e replay.
- Atualizar a memória do time no vault (decisões e lições desta missão).
- No final, o resumo de sempre: tabela de etapas e commits, o que voltou do testador e do revisor, e as pendências.

---

## Regras gerais

- Não quebrar nada que já funciona: hooks, `/reuniao`, `/memoria`, `/time`, quadro de etapas, ping-pong, vestiário, iluminação.
- Interface em português do Brasil e linguagem simples (sem jargão).
- Testes com replay e com atas fictícias para cada etapa.
- O testador confere no navegador (Playwright), no máximo 2 prints por etapa.
- Nenhum dado real da AG. Na dúvida, invente.
