# Missão Studio v1: fundação do Rhynor Studio

## Contexto

Vamos criar o **Rhynor Studio**: um escritório de IA, irmão do AG Pocket, para produzir séries animadas interativas (episódios curtos para Reels, TikTok e Shorts em que o público vota nos comentários e decide a continuação). Um showrunner delega cada parte da produção para agentes especializados: roteiro, arte, dublagem, edição, apuração de votos e publicação. A estrutura já nasce preparada para várias séries, mas começa com uma.

O Studio nasce como **fork do AG Pocket**: reaproveita o motor (servidor de hooks, WebSocket, escritório em canvas, elenco persistente, crachás, quadro de etapas, `/memoria`) e troca tudo o que é da AG pela marca **Rhynor**, a agência de IA do Pablo.

Nesta missão o time **não produz episódios**. Ele prepara o terreno: repositório limpo e sem nada da AG, a marca Rhynor aplicada em estilo pixel, a equipe de produção definida e o cérebro no Obsidian funcionando.

Use o time (planejador → pesquisador se precisar → dev → testador → revisor → documentador), com um commit por etapa.

**Economia:** no máximo 2 prints na missão inteira, sem sessões extras com `claude -p`, lendo arquivos grandes por trechos. Nenhuma dependência nova sem justificativa.

**Regra de separação:** este projeto é pessoal. Ele roda no PC pessoal, com conta pessoal, em repositório privado próprio. Nenhum arquivo, nome, logo, cor, uniforme ou referência da Andrade Gutierrez pode ficar no Studio, nem o vault AG-Cerebro.

---

## A marca Rhynor (leia antes de qualquer etapa visual)

A identidade visual foi criada a partir da logo da Rhynor (um rinoceronte geométrico em ardósia, aço e névoa, com chifres e triângulo laranja) e está em:

- `referencias/rhynor-marca.md`: fonte da verdade da marca. Explica a essência (**firme, direto, noturno**), as versões da logo e quando usar cada uma, a paleta, a tipografia, o estilo pixel, as regras do escritório e o que não fazer.
- `referencias/rhynor-marca/tokens.css`: todas as cores, fontes e formas como variáveis `--rh-*`. O código usa só esses tokens, nunca hexadecimal solto.
- `referencias/rhynor-marca/logo/`: `rhynor-logo.png` (fundos claros), `rhynor-logo-fundo-escuro.png` (padrão do Studio, com o corpo claro para não sumir no fundo noite), `rhynor-logo-512.png` e `favicon-64.png`.
- `referencias/rhynor-marca/preview.png`: a logo nos dois fundos e a paleta, para referência rápida.

Resumo do que importa:

- **Cores da logo:** laranja `#FF6500`, ardósia `#263747`, aço `#A8B0B3`, névoa `#E2E5E7`. Fundo do Studio: noite `#0F1820` e superfície `#18232E`.
- **Laranja é o "chifre" da tela:** marca uma coisa por vez (agente trabalhando, botão principal, "ao vivo"). No máximo cerca de 10% da tela. Texto sobre laranja é noite, nunca branco.
- **Fontes:** Space Grotesk (títulos), Inter (texto), JetBrains Mono (números e status), Silkscreen (textos dentro do mundo pixel). Todas OFL, hospedadas em `assets/fontes/` para funcionar offline.
- Não recolorir, esticar ou criar versões novas da logo sem aprovação.

### Estilo pixel em tudo

O Pablo quer **manter a vibe pixelizada em todo o Studio**, não só no escritório. A marca Rhynor entra por cima desse estilo: as cores e a logo são da Rhynor, mas a forma de tudo lembra um jogo em pixel art.

- **Escritório (canvas):** pixel art nítido, sem suavização (`image-rendering: pixelated`, `imageSmoothingEnabled = false`), sprites em grade de 16 ou 32 px, escala sempre inteira.
- **Interface ao redor** (painéis, crachás, feed, botões, modais, quadro de etapas): bordas retas de 2 px em "degrau", sombra dura deslocada (`4px 4px 0`) no lugar de sombra borrada, ícones em pixel de 16 px. Nada de cantos arredondados, gradientes ou desfoque.
- **Textos dentro do mundo pixel** (placas das salas, balões, letreiros, HUD do escritório): fonte pixel (Silkscreen). Textos longos dos painéis continuam em Space Grotesk e Inter para ficarem legíveis.
- **Animações em passos** (`steps()`), poucos quadros, sem easing suave.
- **Logo pixel:** criar um sprite do rinoceronte (32x32 e 64x64) com as mesmas formas e cores da logo, para o letreiro da recepção, o crachá e o favicon do escritório. É adaptação de estilo, não logo nova.
- **Paleta do pixel art:** móveis e paredes em ardósia, metais em aço, luzes em névoa, detalhes em laranja (luminárias, LED de "gravando", tapete). Ambiente padrão: noite, com a cidade na janela.

---

## Etapa 0: preparação do repositório

- Clonar o AG Pocket em `C:\dev\rhynor-studio` (fora de pastas sincronizadas com OneDrive, iCloud ou Dropbox).
- Remotes: `upstream` aponta pro AG Pocket (só para puxar correções do motor), `origin` aponta para o repositório novo e **privado** `rhynor-studio` (URL informada na mensagem que iniciou a missão).
- Copiar a pasta `referencias/` inteira para o novo repositório (missão e kit da marca).
- Conferir os pré-requisitos: Node 22+, Git e ffmpeg (o ffmpeg vai ser usado na v2; só verificar e avisar se faltar).
- Criar `.env.example` com `STUDIO_VAULT=` e garantir que `.env` está no `.gitignore`.
- Trocar o nome do projeto em `package.json`, título da página, README e porta do servidor, para não conflitar com o AG Pocket rodando ao mesmo tempo.

**Pronto quando:** `npm run dev` sobe o escritório com o nome Rhynor Studio, em outra porta, `git remote -v` mostra `origin` e `upstream`, e `referencias/rhynor-marca.md` está no repositório novo. Pare e avise o Pablo, porque as próximas etapas rodam numa sessão aberta na pasta nova.

## Etapa 1: troca da marca AG pela Rhynor, em estilo pixel

1. **Levantamento:** buscar no repositório por "AG", "Andrade", "AGzinho", "AG Pocket", pelas cores `#051733` e afins, logos e uniformes. Listar tudo o que encontrou antes de remover.
2. **Tokens:** copiar `referencias/rhynor-marca/tokens.css` para o projeto e fazer toda a interface e o canvas lerem as cores desses tokens. Nenhum hexadecimal solto no código.
3. **Fontes:** baixar Space Grotesk, Inter, JetBrains Mono e Silkscreen para `assets/fontes/` (todas OFL) e documentar as licenças.
4. **Interface em estilo pixel:** aplicar as regras da seção "Estilo pixel em tudo" a painéis, crachás, feed, botões e quadro de etapas.
5. **Escritório:** repintar o pixel art com a paleta da Rhynor, ambiente noturno como padrão, letreiro da recepção e brilho laranja na mesa de quem está trabalhando.
6. **Logo:** favicon e cabeçalho do painel com os PNGs de `referencias/rhynor-marca/logo/`. Criar o sprite pixel do rinoceronte (32x32 e 64x64) para o letreiro e o crachá.
7. **Elenco:** trocar os AGzinhos por personagens fictícios novos, com roupas casuais e variadas, sem uniforme e sem logo no peito. A marca aparece só no crachá com o rinoceronte e no cordão laranja.

**Pontos de aprovação (pare e mostre antes de implementar):**

- Tabela do elenco: nome, gênero, visual e função de cada personagem.
- Sprite pixel do rinoceronte, ao lado da logo original, para conferir se manteve as formas e cores.

**Pronto quando:** a busca não encontra mais nenhuma referência à AG fora do histórico do Git, o escritório abre com a marca Rhynor em estilo pixel e o elenco novo, e nenhum hexadecimal aparece fora de `tokens.css`. Usar aqui um dos 2 prints da missão para conferir o resultado.

## Etapa 2: equipe de produção

Manter o time de construção atual (planejador, pesquisador, dev, testador, revisor, documentador) para manutenção do Studio, e criar a equipe de produção em `.claude/agents/`:

| Arquivo | Papel | Ferramentas | Modelo |
| --- | --- | --- | --- |
| `roteirista.md` | Escreve o episódio a partir da bíblia, do estado e da votação | Read, Write | sonnet |
| `continuista.md` | Confere o roteiro contra o cânone do vault | Read, Grep, Glob | haiku |
| `diretor-arte.md` | Cria e mantém componentes de personagens e cenários, seguindo a marca Rhynor | Read, Write, Edit, Bash | sonnet |
| `diretor-dublagem.md` | Escala vozes, marca emoções, roda o script de vozes | Read, Write, Bash | haiku |
| `montador.md` | Monta a composição, sincroniza áudio e legenda, renderiza | Read, Write, Edit, Bash | sonnet |
| `revisor-conteudo.md` | Revisa roteiro, vídeo e textos do post antes de chegarem ao Pablo | Read, Bash | sonnet |
| `apurador.md` | Lê a contagem, decide empates, escolhe e modera comentários | Read, Write, Bash | haiku |
| `social-media.md` | Legenda, hashtags, comentário fixado, postagem e checagem de visibilidade | Read, Write, Bash | haiku |
| `arquivista.md` | Único agente que escreve no vault: episódios, personagens, pistas, estado | Read, Write, Edit | haiku |

- Cada arquivo tem uma descrição clara de quando o showrunner deve chamá-lo, o que ele entrega e o que ele **não** faz.
- O nome `revisor-conteudo` existe para não conflitar com o `revisor` do time de construção.
- O `diretor-arte` e o `revisor` do time de construção devem ler `referencias/rhynor-marca.md` antes de qualquer trabalho visual.
- Criar `CLAUDE-studio.md` com as regras do showrunner: topologia em estrela (agentes só se reportam ao showrunner), regra "agente decide, script executa", os dois pontos de aprovação (roteiro e vídeo final) e a ordem do fluxo de um episódio.
- O `CLAUDE.md` principal passa a explicar os dois modos: `/time` para construir e manter o Studio, e o modo showrunner para produzir séries (ativado na v2). Ele também aponta para `referencias/rhynor-marca.md` como regra visual do projeto.
- Os agentes de produção devem aparecer no escritório quando chamados (mesas genéricas por enquanto; as salas de cada departamento vêm na v3).

**Pronto quando:** os 9 arquivos existem em `.claude/agents/`, e uma chamada de teste a cada agente (com uma tarefa boba) aparece no escritório e volta com resposta coerente com o papel.

## Etapa 3: cérebro no Obsidian (Studio-Cerebro)

- Criar o vault fora do repositório, no caminho de `STUDIO_VAULT`, com esta estrutura:

```
Studio-Cerebro/
  00-Studio/          manual de estilo, marca, regras de voto, equipe, contas (sem segredos)
  10-Series/
    _modelo/          estrutura que /nova-serie vai copiar na v2
      biblia.md
      estado.md
      personagens/
      cenarios/
      episodios/
      pistas/
      votacoes/
  20-Producao/
  30-Metricas/
  40-Biblioteca/
```

- Templates com frontmatter para: personagem (visual, voz, bordões, aparições), episódio (roteiro, pergunta, resultado, métricas), pista (`plantada_em`, `paga_em`) e votação (placar, comentários escolhidos).
- Seed de `00-Studio/`: nota da marca (resumo do `rhynor-marca.md` com link para o arquivo no repositório), regras de voto (palavra-chave, um voto por conta, respostas não contam, horário de fechamento, desempate) e a nota da equipe com links para cada agente.
- Adaptar o `/memoria` do AG Pocket para ler o `STUDIO_VAULT`, respondendo só com o que está no vault e citando `[[links]]`.
- O arquivista é o único que escreve no vault; os outros agentes só leem.

**Pronto quando:** o vault abre no Obsidian com o graph view mostrando as notas de `00-Studio` ligadas, e `/memoria quais são as cores da marca?` e `/memoria quais são as regras de voto?` respondem citando as notas certas.

## Etapa 4: documentação e revisão final

- README do Studio: o que é, como rodar, os dois modos, a marca e o estilo pixel (link para `referencias/rhynor-marca.md`), a estrutura do vault e o que vem nas próximas versões (v2 produção, v3 escritório com salas por departamento, v4 apuração e publicação, v5 escala).
- O revisor confere a missão inteira: nenhuma referência à AG, nenhum hexadecimal fora dos tokens, estilo pixel consistente nos painéis e no escritório, segredos fora do Git, agentes com papéis sem sobreposição.
- O documentador registra no vault uma nota `20-Producao/missao-studio-v1.md` com o que foi feito, os hashes dos commits e as pendências. Usar aqui o segundo print da missão, se precisar.

**Pronto quando:** a missão está toda commitada, o README explica como rodar do zero, e as pendências estão listadas para a missão v2.
