# Rhynor Studio 2.0 — plano geral

Fonte da verdade do projeto. Aprovado pelo Pablo em 30/10/2026. Toda missão de construção parte deste plano; se uma missão e este plano discordarem, pare e pergunte.

## A virada

O Studio deixa de ser um fork do AG Pocket e passa a ser um projeto próprio. O repositório começa do zero, e do AG Pocket vem só o motor. O escritório vira um galpão criativo enorme, e a equipe é montada pensando na qualidade de cada episódio, não em reaproveitar o time de TI.

A versão 1 era uma cópia do AG Pocket com outra cor: mesas de planejamento, pesquisa e testes, e os agentes de produção entrando como visitantes. Um estúdio de animação de verdade funciona por departamentos (roteiro, storyboard, arte, dublagem, animação, som, edição) e tem portões de qualidade antes de algo ir ao ar. É isso que o 2.0 copia.

Três mudanças de fundo:

- **Repositório novo:** o fork atual é arquivado, e o motor é transplantado arquivo por arquivo, sem `upstream` do AG Pocket.
- **Qualidade antes de quantidade:** entram storyboard, animatic, design de som e um diretor de qualidade com rubrica.
- **Um lugar que inspira:** o escritório vira um galpão com neon, cheio de gente, culturas e objetos aleatórios, que reage ao que a produção está fazendo.

## O que sai e o que fica

Do AG Pocket fica só o que é motor, ou seja, código que não sabe que existe uma AG. Todo o resto sai, e o que for preciso é reescrito do zero.

| Parte | Destino | Observação |
| --- | --- | --- |
| Servidor de hooks + WebSocket | Fica | Transplantado e renomeado |
| Motor do canvas (loop, câmera, zoom, caminhos, carregador de sprites) | Fica | Ganha mapa maior e minimapa |
| Motor de pausas (café, conversa, pingue-pongue) | Fica | Ganha novas atividades no galpão |
| Elenco persistente e cartão do personagem | Fica | O crachá vira credencial do estúdio |
| Padrão do `/memoria` | Fica | Lê só o `STUDIO_VAULT` |
| Kit da marca Rhynor | Fica | Com a regra interface x mundo (ver `rhynor-marca.md`) |
| Reuniões (`/reuniao`, Teams, Power Automate, ControlaDOR) | Sai | Nada disso serve para um estúdio |
| Vestiário, uniformes e cor por papel | Sai | |
| Vagas paralelas (dev-2, pesquisador-2), convidados e personagens dos agentes nativos (explore, general-purpose) | Sai | Cada personagem é um membro fixo da equipe |
| Time de construção de 6 (planejador, pesquisador, documentador…) | Sai | Vira o mini-time de 3 da oficina |
| Layout atual do escritório e placas das mesas | Sai | Galpão novo, feito do zero |
| Marcadores `ag-pocket:*`, `AGPOCKET_VAULT` e remote `upstream` | Sai | Viram `rhynor-studio:*` e `STUDIO_VAULT` |
| Bugs da v1 | Corrigir na migração | Texto "rode npm run setup", líder respondendo em inglês, brilho borrado das luminárias, logo repetida três vezes |

O fork não é apagado: é renomeado para `rhynor-studio-fork` e arquivado, como referência.

## O Galpão

O escritório junta o galpão criativo com o estúdio futurista: um armazém industrial enorme, de tijolo, aço e claraboias, transformado num estúdio de animação cheio de neon. Cada departamento tem sua sala, e o Showrunner fica no mezanino, de onde enxerga tudo.

```
┌─────────────────────────────────────────────────────────────────────┐
│ MEZANINO · Showrunner, sala de pitch (Desenvolvimento) e sala de   │
│            crítica (Qualidade)                                      │
├──────────────┬─────────────┬──────────────────┬────────────────────┤
│ SALA DE      │ STORYBOARD  │ ATELIÊ DE ARTE   │ CABINE DE DUBLAGEM │
│ ROTEIRO      │ painéis nas │ mesas de luz,    │ vidro e luz ON AIR │
│ mural de fios│ paredes     │ maquetes         │ Diretor de dublagem│
│ Roteirista   │ Storyboarder│ Personagens,     │                    │
│              │             │ Cenógrafo        │                    │
├──────────────┼─────────────┴──────────────────┼────────────────────┤
│ ARQUIVO DO   │ ÁTRIO                          │ SOM & TRILHA       │
│ CÂNONE       │ escultura de rinoceronte com   │ sintetizadores,    │
│ estantes     │ chifre neon · mural de estreias│ vinis              │
│ Guardião     │ · tapetes do mundo             │ Designer de som    │
├──────────────┴─────────┬──────────────┬───────┴────────────────────┤
│ PALCO DE ANIMAÇÃO      │ ILHA DE      │ SALA DE EXIBIÇÃO           │
│ captura de movimento   │ EDIÇÃO       │ poltronas e telona         │
│ Animador               │ Editor       │ animatic e final pro Pablo │
├──────────────────┬─────┴──────────┬───┴──────────┬─────────────────┤
│ CENTRAL DO       │ COPA & LOUNGE  │ RENDER FARM  │ OFICINA R&D     │
│ PÚBLICO          │ café, fliperama│ racks        │ Engenheira,     │
│ telão do placar  │ piano          │ piscando     │ Testador,       │
│ Comunidade       │                │              │ Revisor de código│
└──────────────────┴────────────────┴──────────────┴─────────────────┘
Telhado em dente de serra com claraboias; à noite, o neon domina.
```

O mapa é bem maior que o da v1. A câmera acompanha quem está trabalhando, tem minimapa, e clicar numa sala dá zoom nela. Tudo em pixel art.

## Ambientação

O galpão deve parecer um lugar onde alguém largou um pouco de cada viagem, cada filme e cada disco favorito. A base é industrial (tijolo, aço, madeira e claraboias em dente de serra), e por cima entram neon, plantas e objetos do mundo inteiro, sem ordem rígida.

**Objetos e culturas (exemplos para partir deles; use a criatividade):**

- Bandeirinhas de festa junina e tecido de chita no teto da copa.
- Lanternas de papel e tsurus de origami pendurados sobre a sala de roteiro.
- Papel picado colorido na sala de exibição.
- Painel de azulejos no átrio.
- Tapetes kilim e persa no lounge; tecidos estampados nas poltronas.
- Estante com mangás, HQs, folhetos de cordel e livros de vários países.
- Instrumentos do mundo na sala de som: berimbau, djembê, koto, cítara, acordeon e sintetizadores.
- Grafite numa parede de tijolo, pôsteres de filmes fictícios de vários gêneros, vitrola, skate pendurado, plantas tropicais e um jardim vertical.
- Neons com frases: "E se…?", "Conte uma história", "Você decide".
- No centro do átrio, uma escultura de rinoceronte feita de sucata, com chifre em neon laranja.

Tudo inventado: nada de logos de marcas reais, personagens conhecidos ou pôsteres de filmes que existem.

**Figurantes:** além dos agentes, o galpão tem gente circulando que não representa nenhum agente: cinegrafista com câmera no ombro, barista, atores ensaiando no palco, músico tocando no lounge, pessoas desenhando, um robô de limpeza, um drone entregando café e o gato do estúdio.

**O galpão reage à produção:**

| Quando | O que acontece no escritório |
| --- | --- |
| Alguém está dublando | Luz "ON AIR" laranja acesa na cabine |
| Render rodando | Racks da render farm piscam mais rápido |
| Portão esperando o Pablo | A sala de exibição passa o animatic ou o episódio final, e a Mesa do Showrunner mostra o aviso |
| Votação aberta | O telão da Central do Público mostra o placar real |
| Episódio no ar | Faíscas de neon no átrio e um pôster novo no mural de estreias |
| Ninguém trabalhando | Pausas: café, fliperama, piano, pingue-pongue, sofá |
| Horário real | Dia e noite pelas claraboias; à noite o neon domina |

## Equipe de produção

São 12 agentes mais o Showrunner, divididos como num estúdio de verdade. Continuísta e arquivista viraram o Guardião do cânone; apurador e social media viraram a Comunidade.

| Agente | Sala | O que faz | Modelo |
| --- | --- | --- | --- |
| Showrunner (sessão principal) | Mezanino | Recebe o pedido, distribui o trabalho, junta tudo e traz os portões para o Pablo | Opus em série nova, Sonnet no dia a dia |
| Diretora de desenvolvimento | Mezanino (sala de pitch) | Conduz o protocolo de nova série: questiona, refina e monta a bíblia, o estilo e o elenco antes do primeiro episódio | Opus |
| Roteirista | Sala de Roteiro | Escreve o episódio (gancho, diálogos, pergunta final) e já prepara os dois caminhos da próxima escolha | Opus |
| Guardião do cânone | Arquivo | Confere a continuidade e é o único que escreve no vault | Sonnet |
| Storyboarder | Storyboard | Decupa o roteiro em planos: enquadramento, câmera, timing e atuação. Desenha os quadros-chave do animatic | Sonnet |
| Designer de personagens | Ateliê | Model sheets, expressões, bocas para lip sync e os personagens como componentes animáveis | Sonnet |
| Cenógrafo | Ateliê | Cenários em camadas com parallax, luz, clima e objetos de cena | Sonnet |
| Diretor de dublagem | Cabine | Escala as vozes, dirige a emoção de cada fala e gera os áudios com os tempos de cada palavra | Sonnet |
| Animador | Palco | Atuação dos personagens, lip sync, movimentos secundários e câmera dentro da cena | Sonnet |
| Designer de som | Som & Trilha | Efeitos, ambiência, trilha e mixagem (voz sempre acima da música, −14 LUFS) | Sonnet |
| Editor-finalizador | Ilha de Edição | Monta o animatic e o final: cortes, ritmo, legenda karaokê, cor e render | Sonnet |
| Diretor de qualidade | Mezanino (sala de crítica) | Avalia cada portão com uma rubrica e devolve notas objetivas | Opus |
| Comunidade | Central do Público | Apura votos, modera comentários, posta, mede resultados e passa ao roteiro o que o público está pedindo | Haiku |

Regras:

- **Agente decide, script executa:** gerar áudio, renderizar, contar votos e postar são scripts. Agente só entra onde existe julgamento.
- **Topologia em estrela:** todo mundo se reporta ao Showrunner, nunca diretamente a outro agente.
- **Tudo em português:** respostas, textos da interface e notas do vault.

**Rubrica do Diretor de qualidade** (nota de 1 a 5; passa com média 4 e nenhum item abaixo de 3):

1. O gancho prende nos 2 primeiros segundos?
2. A escolha final é clara e as duas opções são tentadoras?
3. Os personagens estão fiéis ao model sheet?
4. A boca acompanha a fala?
5. O ritmo não tem tempo morto?
6. A legenda dá para ler no celular?
7. O som está limpo, com a voz clara sobre a trilha?
8. A continuidade bate com o cânone?
9. O final deixa vontade de votar?

Cada série pode ajustar pesos e itens na própria ficha (numa série de curiosidades, "o fato está correto e com fonte?" vale mais que "o final deixa vontade de votar").

## Protocolo de nova série

Nenhuma série entra em produção sem passar pelo protocolo, conduzido pela Diretora de desenvolvimento. Mesmo que o Pablo chegue com tudo definido, o papel dela é refinar, questionar e testar a ideia antes de gastar produção. O comando é `/nova-serie`.

1. **Pitch:** o Pablo conta a ideia como quiser. Ela resume o que entendeu e confirma antes de seguir.
2. **Entrevista em rodadas** (poucas perguntas por vez):
   - **Promessa:** o que o público ganha em cada episódio (medo, riso, aprender algo, se emocionar).
   - **Gênero e tom:** suspense, curiosidades, superação, comédia; sério ou leve.
   - **Formato:** duração, estrutura fixa do episódio e tipo de interação (votação binária, quiz, "escolha o próximo tema" ou nenhuma).
   - **Estilo visual:** referências, técnica (2D vetorial, pixel, colagem…), paleta e como os fundos serão feitos.
   - **Personagens:** desejo, medo, voz, jeito de falar e bordão de cada um.
   - **Mundo e regras:** o que pode e o que nunca acontece nesse universo.
   - **Som:** clima da trilha e tipo de efeitos.
   - **Ritmo de postagem** e o que a série **nunca** faz.
3. **Provocação:** ela aponta os pontos fracos, propõe 2 ou 3 alternativas e prova o fôlego da série escrevendo os ganchos de 10 episódios. Se não saírem 10 ganchos bons, a premissa ainda não está pronta.
4. **Pacote de desenvolvimento:** ficha da série e bíblia; 2 ou 3 style frames (Ateliê); elenco com model sheets e amostras de voz (Cabine); roteiro do piloto.
5. **Teste de estilo:** um animatic de 10 a 15 segundos do piloto.
6. **Sinal verde (Pablo):** aprovado, o Guardião cria a pasta da série no vault e o Showrunner passa a produzir.

Estrutura de cada série no vault:

```
10-Series/<serie>/
  serie.md          ficha: gênero, tom, promessa, formato, interação, estilo visual,
                    técnica dos fundos, ritmo, duração, ajustes da rubrica
  biblia.md         mundo, regras, arcos, o que nunca acontece
  estilo/           style frames, paleta da série, referências aprovadas
  desenvolvimento/  pitch original, entrevista, alternativas e os 10 ganchos
  personagens/  cenarios/  episodios/  pistas/  votacoes/
```

Todo agente que trabalha num episódio lê primeiro o `serie.md`.

## Oficina dos fundos

O Studio é construído e mantido por um mini-time de 3 na Oficina R&D, ao lado da render farm. Em missão de construção, o Showrunner desce até a oficina e coordena dali.

| Agente | O que faz | Modelo |
| --- | --- | --- |
| Engenheira | Escreve o código do Studio, dos scripts e do escritório | Sonnet |
| Testador | Roda os testes e confere o resultado (prints só quando a missão permitir) | Haiku |
| Revisor de código | Confere qualidade, segurança (segredos fora do Git), regras da marca e nenhuma referência à AG | Sonnet |

O planejamento das missões fica com o Showrunner; a documentação, com o Guardião do cânone.

## Pipeline do episódio

A voz é gravada **antes** da animação, porque é ela que define o tempo de cada cena e o lip sync. O **animatic** (quadros-chave + vozes + som provisório) é onde se corrige barato.

1. **Apuração:** a Comunidade fecha a votação, escolhe os comentários que vão aparecer e resume o que o público está pedindo.
2. **Roteiro:** Roteirista escreve, Guardião confere continuidade, Diretor de qualidade aplica a rubrica. **Portão 1 (Pablo):** aprovar o roteiro.
3. **Dublagem:** todas as falas com emoção e tempos de cada palavra.
4. **Storyboard e animatic:** Storyboarder define os planos; Editor monta o animatic. Diretor de qualidade revisa. **Portão 2 (Pablo):** aprovar o animatic.
5. **Produção em paralelo:** Designer de personagens e Cenógrafo criam só o que falta na biblioteca; Animador anima; Designer de som faz efeitos, ambiência e trilha.
6. **Finalização:** Editor junta tudo, legenda, cor, mixagem e render.
7. **Revisão final:** Diretor de qualidade aplica a rubrica completa. **Portão 3 (Pablo):** aprovar o episódio final.
8. **Publicação:** a Comunidade posta, fixa o comentário com a regra e confere se ficou público.
9. **Memória:** o Guardião atualiza o vault.

Quando o Pablo confiar no Roteirista, o Portão 1 pode virar automático (só o Diretor de qualidade aprova).

**Biblioteca que acumula qualidade:** personagens com model sheet, expressões, bocas e poses salvas; cenários em camadas. Do episódio 5 em diante quase tudo é reaproveitado.

## Skills: o que cada agente usa

Três grupos: **oficiais** (instalar como estão), **da comunidade** (só as úteis de verdade) e **nossas** (escritas pelo time na v2.2, em português). As nossas carregam o jeito Rhynor de fazer animação.

### Instalar (na pasta do projeto)

| Skill | Origem | Comando |
| --- | --- | --- |
| Remotion | Oficial ([docs](https://www.remotion.dev/docs/ai/skills)) | `npx skills add remotion-dev/skills` |
| ElevenLabs (text-to-speech, sound-effects, music, speech-to-text) | Oficial ([blog](https://elevenlabs.io/blog/elevenlabs-agent-skills)) | `npx skills add elevenlabs/skills` |
| skill-creator e frontend-design | Oficial Anthropic (`anthropics/skills`) | `npx skills add anthropics/skills --skill skill-creator --skill frontend-design` |
| Princípios de animação (animador e cineasta) | [dylantarre/animation-principles](https://claudskills.com/skills/filmmaker/) | Copiar as pastas de `skills/03-by-role-persona/` |
| viral-video-hooks-retention | [JosiahSiegel](https://skillselion.com/skills/josiahsiegel/claude-plugin-marketplace/viral-video-hooks-retention) | `npx skills add https://github.com/JosiahSiegel/claude-plugin-marketplace --skill viral-video-hooks-retention` |
| pixel-art-sprites | [AbsolutelySkilled](https://openskillindex.com/skills/absolutelyskilled-absolutelyskilled-pixel-art-sprites) | Copiar `skills/pixel-art-sprites` do repositório |

### Só referência (aproveitar nas nossas)

- [short-drama-hook-engineering](https://tessl.io/registry/skills/github/nolanx-ai/nolanx.ai/short-drama-hook-engineering/review): gancho em 1 a 3 s, batida a cada 2 s. Vai para `roteiro-rhynor`.
- [scene-writing](https://claudskills.com/skills/scene-writing/): cena com ação visual e estrutura dramática. Vai para `roteiro-rhynor`.
- [storyboard-creation](https://claudemarketplaces.com/skills/inference-sh/skills/storyboard-creation): planos, ângulos, movimentos, regra dos 180°. Vai para `decupagem-vertical` (sem a parte da inference.sh).
- [ai-storyboard (rainlib)](https://vibeindex.ai/skills/rainlib/ai-storyboard/scriptwriter-skill): produtor coordenando roteiro, storyboard e animação. Referência para o `CLAUDE-studio.md`.
- Descartada: scriptwriting-methodology (roteiro de anúncio, não de ficção).

### Nossas skills (v2.2, escritas com a skill-creator)

| Skill | Conteúdo |
| --- | --- |
| `marca-rhynor` | O `rhynor-marca.md` em forma de skill |
| `protocolo-nova-serie` | As 6 etapas, roteiro da entrevista, como provocar sem travar, teste dos 10 ganchos, modelos de `serie.md` e `biblia.md` |
| `roteiro-rhynor` | Estrutura por gênero, gancho em até 2 s, virada a cada 2 a 3 s, falas curtas para dublagem, pergunta final clara, formato JSON do roteiro. Lê o `serie.md` antes |
| `decupagem-vertical` | Planos para 9:16, áreas seguras (legenda e interface do Reels/TikTok cobrem bordas), formato do quadro, montagem do animatic |
| `direcao-de-voz` | Casting, marcações de emoção do ElevenLabs v3, ritmo do português, mesmo voice ID na série inteira |
| `mixagem-rhynor` | Níveis (voz na frente, trilha abaixando sob a fala), −14 LUFS, biblioteca de efeitos |
| `rubrica-qualidade` | A rubrica, nota com evidência ("aos 0:07 a boca não acompanha"), ajustes por série |
| `canone-vault` | Como escrever no Studio-Cerebro: frontmatter, links, pistas, o que nunca entra |
| `publicacao-e-votos` | Regras de voto, legenda, comentário fixado, horários, checagem de visibilidade, métricas |

### Quem usa o quê, e quando

| Agente | Skills | Quando carregar |
| --- | --- | --- |
| Showrunner | `rubrica-qualidade`, `canone-vault` (leitura) | Início de cada episódio |
| Diretora de desenvolvimento | `protocolo-nova-serie`, `viral-video-hooks-retention`, `roteiro-rhynor` | Em todo `/nova-serie` ou ao repensar uma série |
| Roteirista | `roteiro-rhynor`, `viral-video-hooks-retention` | Antes de cada roteiro, depois de ler `serie.md` e `estado.md` |
| Guardião do cânone | `canone-vault` | Ao conferir continuidade e ao atualizar o vault |
| Storyboarder | `decupagem-vertical`, princípios de animação (cineasta), Remotion | Ao decupar e montar o animatic |
| Designer de personagens | Remotion; `marca-rhynor` e `pixel-art-sprites` só quando a série pedir | Personagem novo, model sheet, expressões, bocas |
| Cenógrafo | Remotion; `pixel-art-sprites` só em série pixel | Cenário novo (antes, conferir a biblioteca) |
| Diretor de dublagem | `direcao-de-voz`, ElevenLabs text-to-speech | A cada roteiro aprovado e nas amostras de voz do protocolo |
| Animador | Princípios de animação (animador), Remotion | Ao animar cada cena, depois do animatic aprovado |
| Designer de som | `mixagem-rhynor`, ElevenLabs sound-effects e music | No animatic e na finalização |
| Editor-finalizador | Remotion (legendas, render, Studio), ElevenLabs speech-to-text | Animatic, finalização e conferência da legenda |
| Diretor de qualidade | `rubrica-qualidade`, `viral-video-hooks-retention` | Em cada portão |
| Comunidade | `publicacao-e-votos`, `viral-video-hooks-retention` | Apuração, postagem e resumo semanal |
| Engenheira | `marca-rhynor`, `frontend-design`, `pixel-art-sprites`, Remotion, `skill-creator` | Toda missão de construção |
| Revisor de código | `marca-rhynor` | Ao revisar qualquer mudança visual |

O arquivo de cada agente em `.claude/agents/` lista as skills dele e quando carregar cada uma; o Showrunner lembra ao delegar.

Segurança: instalar tudo no projeto (nunca no global); o Revisor de código lê o SKILL.md e os scripts de qualquer skill de terceiro antes; registrar origem e commit em `skills.lock.md`.

## Mesa do Showrunner

O painel lateral vira a mesa de controle da produção, de cima para baixo:

1. **Série:** seletor com o pôster de cada série.
2. **Te esperando:** aprovações pendentes (cor de aviso), com botão que abre o roteiro, o animatic ou o vídeo.
3. **Esteira do episódio:** Roteiro → Dublagem → Animatic → Produção → Final → No ar, com quem está trabalhando.
4. **Placar ao vivo** da votação aberta, somando as três redes.
5. **Agenda:** próximos posts e fechamento da votação.
6. **Equipe por departamento:** trabalhando, livre ou em pausa; clicar leva a câmera até o personagem e abre a credencial.
7. **Feed:** frases curtas, sem jargão ("Dublagem terminou", "Animatic pronto pra você ver").

Tudo no estilo pixel da marca.

## Limite e ritmo

Cerca de 12 chamadas de agente por episódio, duas em Opus. No plano Pro, provavelmente não aguenta um episódio por dia.

- Começar com uma série e uns 3 episódios por semana no total; medir com `/usage`.
- Se a série pegar, o plano Max é o caminho para um episódio por dia.
- Opus só em roteiro, desenvolvimento e crítica; o Roteirista é o último a sair do Opus.
- A biblioteca reduz o custo com o tempo.
- Missões de construção são pesadas: uma fase por dia, `/compact` entre etapas.

## Decisões tomadas

O Studio não tem estilo único: **cada série define o próprio estilo, técnica e ritmo**; o Studio garante qualidade e continuidade.

| # | Tema | Decisão |
| --- | --- | --- |
| 1 | Cores do galpão | Laranja da Rhynor como cor principal (letreiro, escultura, ON AIR, destaques). Fora isso, o galpão é livre e colorido. A interface segue a marca à risca |
| 2 | Estilo das séries | Cada série escolhe o seu (2D vetorial, pixel, colagem, recorte de papel…). Gêneros previstos: suspense interativo, curiosidades, superação e outros. Definido no protocolo e registrado no `serie.md` |
| 3 | Arte do escritório | Híbrido: base de pacotes de pixel art com licença comercial (preferir gratuitos/CC0), recolorida; tudo o que é único (escultura, neons, letreiros, salas, figurantes, personagens) desenhado pelo time. Pacote pago só com OK do Pablo |
| 4 | Fundos dos episódios | Cada série define no `serie.md`: código (SVG em camadas), pintados por IA e reaproveitados, ou misto. Personagens sempre em código |
| 5 | Ritmo | Cada série define o seu; o Showrunner soma tudo na agenda e avisa se o limite não comporta |

O elenco (nomes, visual e personalidade de cada agente) é proposto pelo time na v2.2, com aprovação do Pablo.

## Fases

1. **v2.0 · Fundação limpa:** arquivar o fork, repositório novo, transplante do motor, mini-time da oficina, regra de português, `STUDIO_VAULT`, setup com marcadores próprios. Aprovação: lista do transplante.
2. **v2.1 · O Galpão:** planta, arte, salas, decoração, figurantes, dia e noite, eventos que reagem à produção. Aprovações: planta e uma sala-piloto (o átrio).
3. **v2.2 · A equipe:** os 12 agentes, `CLAUDE-studio.md` com pipeline e rubrica, instalação das skills e escrita das nossas, elenco. Aprovação: tabela do elenco.
4. **v2.3 · Mesa do Showrunner:** painel novo ligado ao estado real da produção.
5. **v2.4 · Cérebro:** vault Studio-Cerebro, modelo de série, `/memoria`.
6. **v2.5 · Produção:** Remotion, scripts de voz, render e QA, animatic, `/episodio` e o protocolo `/nova-serie`, fechando com a primeira série passando pelo protocolo e o piloto (3 episódios). Aprovações: os 3 portões de cada episódio piloto.
7. **v2.6 · Público:** apuração, postagem e métricas.
