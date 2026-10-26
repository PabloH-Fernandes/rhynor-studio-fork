# Identidade visual da Rhynor (Rhynor Studio)

Este arquivo é a fonte da verdade da marca no Studio. Os arquivos citados estão em `referencias/rhynor-marca/`. Não invente cores, fontes ou versões de logo além das descritas aqui. Se faltar algo, pergunte.

## Essência

A Rhynor é um rinoceronte geométrico: força, direção e um pouco de ousadia. Na interface isso vira **escuro, sólido e com um laranja que só aparece onde importa**. O laranja é o "chifre" da tela: chama atenção para uma coisa por vez.

Três palavras para guiar decisões: **firme, direto, noturno**.

## Logo

| Arquivo | Uso |
| --- | --- |
| `logo/rhynor-logo.png` | Fundos claros. Versão original. |
| `logo/rhynor-logo-fundo-escuro.png` | Fundos escuros (padrão do Studio). O corpo vira Névoa e o olho vira Ardósia. |
| `logo/rhynor-logo-512.png` | Avatar, ícones de app, crachá. |
| `logo/favicon-64.png` | Favicon e ícone da aba. |

Regras:

- Não recolorir, esticar, girar, contornar nem aplicar sombra ou brilho.
- Área de respiro mínima ao redor: 1/4 da largura da logo.
- Tamanho mínimo: 32 px de altura em tela.
- Nunca usar a versão original (corpo Ardósia) sobre fundo Noite ou Superfície: o corpo some. Use a versão de fundo escuro.
- Nome escrito: **Rhynor Studio**, em Space Grotesk Bold, com "RHYNOR STUDIO" em caixa alta só em títulos curtos.

## Cores

Todas estão como tokens em `tokens.css`. O código usa só os tokens, nunca o hexadecimal solto.

| Token | Hex | Papel |
| --- | --- | --- |
| `--rh-laranja` | `#FF6500` | Destaque único: botão principal, "ao vivo", agente trabalhando, foco |
| `--rh-brasa` | `#FF8A3D` | Hover e brilho do laranja |
| `--rh-ardosia` | `#263747` | Cor da marca; card em destaque no tema escuro |
| `--rh-aco` | `#A8B0B3` | Texto secundário, ícones inativos |
| `--rh-nevoa` | `#E2E5E7` | Texto principal no escuro |
| `--rh-noite` | `#0F1820` | Fundo do escritório e das páginas |
| `--rh-superficie` | `#18232E` | Painéis, crachás, feed |
| `--rh-ok` | `#3DDC97` | Concluído, aprovado |
| `--rh-aviso` | `#FFC24D` | Aguardando aprovação sua |
| `--rh-alerta` | `#FF4D4D` | Erro, reprovado pelo revisor |

Proporção: cerca de 70% Noite/Superfície, 20% Ardósia/Aço/Névoa, no máximo 10% laranja. Se o laranja estiver em mais de um lugar de destaque na mesma tela, um deles está errado.

Contraste: texto sempre Névoa ou Aço sobre Noite/Superfície. Texto sobre laranja é Noite (`#0F1820`), nunca branco.

## Tipografia

| Uso | Fonte | Peso |
| --- | --- | --- |
| Títulos, nome de agente, placar | Space Grotesk | 600–700 |
| Texto, feed, crachá | Inter | 400–500 |
| Números, horários, status, HUD | JetBrains Mono | 500 |

Todas têm licença OFL (Google Fonts). Hospedar localmente em `assets/fontes/` para o escritório funcionar offline.

## Forma e ícones

- No Studio, tudo segue o estilo pixel (seção "Estilo pixel em tudo"): bordas retas em degrau e sombra dura. Os cantos arredondados (12 px painéis, 6 px botões, 20 px modais) valem só para páginas externas e o tema claro.
- O motivo gráfico da marca é o **triângulo/facetado** da logo: usar em divisores, marcadores de etapa e no indicador de "ao vivo" (um triângulo laranja). Sem gradientes coloridos.
- Ícones em pixel (16 px), cor Aço; laranja só no ativo.

## Aplicação no escritório (pixel art)

- **Ambiente:** escritório noturno de estúdio, fundo Noite, janelas com a cidade e luz de monitor. Dia/noite continua existindo, mas o padrão é noite.
- **Paleta do pixel art:** derivar sombras e luzes das cores da marca (Ardósia para móveis e paredes, Aço para metais, Névoa para luzes, laranja para luminárias, LED de "gravando", tapete e detalhes). Evite tons que não conversem com a paleta.
- **Elenco:** roupas casuais e variadas, sem uniforme e sem logo no peito. A identidade aparece em detalhes: crachá com o rinoceronte e cordão laranja.
- **Agente trabalhando:** contorno ou brilho laranja suave na mesa. Ocioso: sem destaque. Aguardando sua aprovação: etiqueta Aviso.
- **Logo no escritório:** um quadro/letreiro na parede da recepção com a versão de fundo escuro, e o favicon na aba.
- **Crachá:** fundo Superfície, faixa superior Ardósia com o rinoceronte, nome em Space Grotesk, função e estatísticas em JetBrains Mono.

## Estilo pixel em tudo

A vibe do Studio é **pixelizada do começo ao fim**, não só o escritório. A marca entra por cima desse estilo: as cores e a logo são da Rhynor, mas a forma de tudo lembra um jogo em pixel art.

- **Escritório (canvas):** pixel art nítido, sem suavização (`image-rendering: pixelated`, `imageSmoothingEnabled = false`), sprites em grade de 16 ou 32 px e escala inteira (2x, 3x, 4x).
- **Interface ao redor (painéis, crachás, feed, botões, modais):** bordas de 2 px retas em "degrau" no lugar de cantos arredondados (os raios de `tokens.css` valem só para o tema claro e páginas externas), sombra dura deslocada (`4px 4px 0` em Noite) no lugar de sombra borrada, ícones em pixel (16 px) no lugar de ícones de traço.
- **Fontes:** dentro do mundo pixel (placas das salas, balões, tela de votação, letreiros, HUD do escritório) usar **Silkscreen** (OFL) ou outra fonte pixel aprovada. Títulos e textos longos dos painéis continuam em Space Grotesk e Inter para ficarem legíveis; números e status em JetBrains Mono.
- **Logo:** no escritório, além do PNG original, criar uma **versão pixel do rinoceronte** (sprite 32x32 e 64x64) com a mesma paleta, para o letreiro, o crachá e o favicon do escritório. É uma adaptação de estilo, não uma logo nova: mesmas formas e cores. Mostrar para aprovação antes de usar.
- **Animações:** em passos (`steps()`), poucos quadros, sem easing suave. Ex.: o indicador "ao vivo" pisca em 2 quadros.

## Tom de voz (textos da interface)

Português informal e curto, sem jargão técnico para o usuário final. Exemplos: "Roteiro pronto pra você aprovar", "Dublagem em andamento", "Placar fechou: FICA venceu".

## O que não fazer

- Usar navy `#051733`, uniformes, logos ou qualquer coisa da Andrade Gutierrez.
- Laranja como cor de fundo grande.
- Criar uma versão nova da logo (mascote animado, variação de cor) sem aprovação.

`preview.png` mostra a logo nos dois fundos e a paleta.
