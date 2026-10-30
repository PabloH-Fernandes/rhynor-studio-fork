// Papéis da equipe de produção (agentes de .claude/agents/ chamados pelo showrunner).
// No escritório eles entram como visitante extra (p:extra:<id>, aparência por hash), sem tomar o
// Personagem de nenhum convidado do elenco, mas com nome próprio e a plaquinha da função.
// Um módulo só, usado pelo servidor e pelo front.

export interface PapelDeProducao {
  /** nome na etiqueta da cabeça e no feed */
  nome: string;
  /** texto da plaquinha da mesa (caixa alta, cabe na mesa comum) */
  plaquinha: string;
  /** nome curto do feed e da lista quando a primeira palavra do nome não serve ("Direção" → "Arte") */
  curto?: string;
}

export const PAPEIS_DE_PRODUCAO: Readonly<Record<string, PapelDeProducao>> = {
  roteirista: { nome: "Roteirista", plaquinha: "ROTEIRO" },
  continuista: { nome: "Continuísta", plaquinha: "CONTINUIDADE" },
  "diretor-arte": { nome: "Direção de arte", plaquinha: "ARTE", curto: "Arte" },
  "diretor-dublagem": { nome: "Dublagem", plaquinha: "DUBLAGEM", curto: "Dublagem" },
  montador: { nome: "Montagem", plaquinha: "MONTAGEM" },
  "revisor-conteudo": { nome: "Revisão de conteúdo", plaquinha: "CONTEÚDO" },
  apurador: { nome: "Apuração", plaquinha: "APURAÇÃO" },
  "social-media": { nome: "Social media", plaquinha: "SOCIAL" },
  arquivista: { nome: "Arquivista", plaquinha: "ARQUIVO" },
};

/** o papel (já normalizado, ex.: "roteirista") é da equipe de produção? */
export function ehProducao(role: string): boolean {
  return Object.hasOwn(PAPEIS_DE_PRODUCAO, role);
}

/** nome curto próprio do papel de produção (vai no lugar do apelido em nomeCurto); undefined fora da tabela */
export function curtoDeProducao(role: string): string | undefined {
  return ehProducao(role) ? PAPEIS_DE_PRODUCAO[role].curto : undefined;
}
