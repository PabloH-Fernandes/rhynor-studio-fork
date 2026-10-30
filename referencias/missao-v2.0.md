# Missão v2.0: fundação limpa do Rhynor Studio

## Antes de tudo

Leia `referencias/plano-studio-2.md` inteiro. É a fonte da verdade do Studio 2.0: o que sai e o que fica, o galpão, a equipe, o protocolo de nova série, o pipeline, as skills e as fases. Leia também `referencias/rhynor-marca.md`.

Esta missão é a fase **v2.0** do plano: sair do fork da v1 e criar um repositório novo e limpo, com só o motor transplantado, o mini-time da oficina e as regras da casa. **Não** é para construir o galpão, a equipe de produção nem a Mesa do Showrunner. Isso vem nas próximas missões.

**Onde você está:** esta sessão roda na pasta do fork da v1, que o Pablo renomeou para `C:\dev\rhynor-studio-fork`. O projeto novo vai nascer em `C:\dev\rhynor-studio`.

## Regras desta missão

- **Português sempre:** respostas, relatórios, resumos, mensagens de commit e textos da interface. Na v1 o líder passou a responder em inglês no meio de um teste; isso não pode se repetir.
- **Separação da AG:** projeto pessoal, PC pessoal, conta pessoal. Nada de AG, Andrade Gutierrez, AG Pocket, AGzinho, `#051733`, uniformes ou `AGPOCKET_VAULT` no repositório novo. As únicas menções permitidas ficam dentro de `referencias/`.
- **Nada fora do projeto:** nenhum comando desta missão escreve no `~/.claude` global, no `CLAUDE.md` global ou em qualquer pasta fora de `C:\dev\rhynor-studio` e `C:\dev\rhynor-studio-fork`. O `npm run setup` antigo **não** deve ser rodado.
- **Economia:** Sonnet, no máximo 2 prints na missão inteira, arquivos grandes lidos por trechos, sem sessões extras com `claude -p`, nenhuma dependência nova sem justificativa. `/compact` entre etapas se o contexto passar de ~150 mil tokens.
- **Um commit por etapa**, mensagem em português.
- Use o time de construção que já existe no fork para executar. O mini-time novo (Engenheira, Testador, Revisor de código) só passa a existir no repositório novo, a partir da Etapa 4.

---

## Etapa 0: preparação

1. Confirmar que a sessão está em `C:\dev\rhynor-studio-fork` e que o working tree do fork está limpo. Se houver mudanças sem commit (por exemplo, a correção do "foi embora"), commitar no fork antes de tudo e informar o hash.
2. **GitHub** (se o `gh` estiver instalado e logado; se não, parar e pedir ao Pablo para fazer pelo site):
   - Renomear o repositório remoto `rhynor-studio` para `rhynor-studio-fork` e atualizar o `origin` do fork.
   - Criar um repositório novo, **privado** e vazio, chamado `rhynor-studio`.
   - **Não arquivar o fork ainda.** Isso é feito no fim, com a confirmação do Pablo.
3. Criar `C:\dev\rhynor-studio`, rodar `git init` e apontar o `origin` para o repositório novo. Sem remote `upstream`.
4. Copiar para `C:\dev\rhynor-studio\referencias\` **só** estes itens do fork: `plano-studio-2.md`, `rhynor-marca.md`, a pasta `rhynor-marca/` e `missao-v2.0.md`. As missões e materiais da v1 ficam só no fork.
5. Criar `.gitignore` (node_modules, `.env`, renders, caches) e `.env.example` com `STUDIO_VAULT=`.

**Pronto quando:** `C:\dev\rhynor-studio` existe com `referencias/`, `.gitignore` e `.env.example`, o `origin` aponta para o repositório novo e privado, e o primeiro commit foi enviado.

## Etapa 1: inventário do transplante (ponto de aprovação)

Levantar no fork tudo o que é motor e montar a lista do que vai para o repositório novo. Nada é copiado antes da aprovação do Pablo.

**Candidatos a ficar** (conforme o plano):

- Servidor de hooks e WebSocket.
- Motor do canvas: loop, câmera, zoom, caminhos, carregador de sprites.
- Motor de pausas: café, conversa, pingue-pongue.
- Elenco persistente e cartão do personagem.
- Padrão do comando `/memoria`.
- Tokens da marca, fontes locais e o sprite pixel do rinoceronte.
- Os testes do motor e a correção do "foi embora" (quando dois agentes terminam juntos).

**Fica de fora** (conforme o plano):

- Reuniões (`/reuniao`, Teams, Power Automate).
- Vestiário e uniformes.
- Vagas paralelas, convidados e personagens dos agentes nativos.
- O layout e as placas das mesas.
- O time de construção de 6.
- O setup antigo.

**Formato do relatório para o Pablo:**

| Arquivo ou módulo no fork | O que faz | Destino no repositório novo | Adaptação necessária |
| --- | --- | --- | --- |

Abaixo da tabela:

- O que ficou de fora e por quê.
- As dependências do `package.json` que serão mantidas, com o motivo de cada uma.
- Riscos encontrados: por exemplo, pedaços do motor que dependem de algo que vai sair.

**Pare aqui e espere o OK do Pablo.**

## Etapa 2: transplante

1. Estrutura sugerida: `server/`, `web/`, `shared/`, `scripts/`, `assets/`, `docs/`. Se o motor pedir outra, justificar.
2. Copiar só o que foi aprovado e renomear identificadores: "personagem" no lugar de qualquer nome herdado, nada de `ag-pocket`. Remover código morto que dependia do que ficou de fora.
3. **Galpão provisório:** um chão simples em pixel art com uma placa "Galpão em construção". Basta para os personagens andarem e o motor rodar. O galpão de verdade é a missão v2.1; não gaste esforço de arte aqui.
4. Porta própria do servidor (diferente da do fork e da do AG Pocket).
5. Testes do motor passando.

**Pronto quando:** `npm install` e `npm run dev` sobem o Studio novo na porta própria, com o galpão provisório, e os testes passam.

## Etapa 3: configuração e setup seguro

1. **Vault:** ler só `STUDIO_VAULT`, sem fallback. Se não estiver configurado, o painel diz "Cérebro ainda não configurado (vem na v2.4)". Nenhum texto manda rodar `npm run setup`.
2. **Novo `npm run setup`:**
   - Escreve **somente dentro do projeto**, por exemplo os hooks em `.claude/settings.json` apontando para a porta do Studio.
   - Nunca toca no `~/.claude` nem no `CLAUDE.md` global.
   - Usa marcadores `rhynor-studio:*`, é idempotente e tem `--dry-run`, que mostra o que mudaria sem mudar nada.
3. **Teste de segurança:**
   - Antes de rodar o setup, salvar o hash do `~/.claude/settings.json` e do `~/.claude/CLAUDE.md`.
   - Rodar o setup duas vezes.
   - Conferir que os hashes não mudaram e que a segunda execução não alterou nada.

**Pronto quando:** o setup roda duas vezes sem mudar nada fora do projeto (hashes iguais), e os hooks do projeto chegam ao servidor do Studio.

## Etapa 4: oficina e regras da casa

1. **`CLAUDE.md` do projeto:**
   - Responder sempre em português, inclusive relatórios, resumos e falas de subagentes.
   - `referencias/plano-studio-2.md` é a fonte da verdade; se uma missão e o plano discordarem, perguntar.
   - Dois modos: **Oficina** (construir e manter o Studio, ativo agora) e **Produção** (séries e episódios, ativado na v2.2).
   - Regras da marca (`rhynor-marca.md`), separação da AG, economia de limite e pontos de aprovação.
   - Topologia em estrela: subagentes só se reportam à sessão principal.
2. **Mini-time em `.claude/agents/`:**

| Arquivo | Papel | Ferramentas | Modelo |
| --- | --- | --- | --- |
| `engenheira.md` | Escreve o código do Studio, dos scripts e do escritório | Read, Write, Edit, Bash, Glob, Grep | sonnet |
| `testador.md` | Roda testes e confere resultados; print só quando a missão permitir | Read, Bash, Glob, Grep | haiku |
| `revisor-codigo.md` | Qualidade, segurança (segredos fora do Git), marca, nenhuma referência à AG, nada escrito fora do projeto | Read, Bash, Glob, Grep | sonnet |

   Cada arquivo diz quando a sessão principal deve chamar o agente, o que ele entrega, o que ele **não** faz e que responde em português.
3. **Comando `/oficina`:** recebe uma missão de construção, monta a lista de tarefas e coordena o mini-time na ordem Engenheira → Testador → Revisor de código, com um commit por etapa. Substitui o antigo `/time`.
4. **Personagens provisórios:** o Showrunner e os 3 da oficina aparecem no galpão provisório usando sprites do elenco aprovado na v1, marcados como provisórios. O elenco definitivo é proposto na v2.2.

**Pronto quando:** `/oficina` existe, os 3 agentes estão em `.claude/agents/`, e o `CLAUDE.md` tem as regras acima.

## Etapa 5: teste real e fechamento

1. Com o servidor no ar, chamar cada agente do mini-time com uma tarefa boba. Conferir no estado do servidor:
   - Cada um aparece no galpão com nome e função.
   - Cada um termina com "entregou o trabalho".
   - As respostas vêm em português.
2. **Checagens finais (Revisor de código):**
   - Busca por `AG`, `Andrade`, `AGzinho`, `ag-pocket`, `AGPOCKET` e `#051733` sem resultado fora de `referencias/`.
   - Nenhum hexadecimal fora dos tokens.
   - `.env` fora do Git.
   - Nada escrito fora do projeto (hashes da Etapa 3).
3. **README:** o que é o Studio, como rodar do zero (`npm install`, `npm run setup`, `npm run dev`), o modo Oficina e o roteiro das fases v2.1 a v2.6, com link para o plano.
4. **Relatório da missão** em `docs/missoes/v2.0.md`: o que foi feito, hashes dos commits, o que ficou pendente para a v2.1 e quanto do limite a missão consumiu (`/usage` no início e no fim).
5. Push de tudo.
6. **Pergunte ao Pablo** se pode arquivar o repositório `rhynor-studio-fork` no GitHub. Só arquive com o "sim" dele.
7. Diga ao Pablo o próximo passo: abrir uma sessão nova na pasta `C:\dev\rhynor-studio` para a missão v2.1 (O Galpão).

**Pronto quando:** tudo commitado e enviado, testes verdes, checagens limpas, README e relatório escritos.
