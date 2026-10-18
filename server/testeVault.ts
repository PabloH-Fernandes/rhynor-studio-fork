// Ajuda para os testes da Caixa de entrada: vault temporário (mkdtemp, nunca o vault de verdade) com
// uma nota de reunião feita pela leitura automática, a partir de uma ata fictícia.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gerarAta, type NomeCenario } from "./ataFicticia.ts";
import { IngestaoInbox } from "./ingestao.ts";

export const AGORA = new Date(2026, 9, 17, 14, 30);

export function semente(n: number): () => number {
  let s = n;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export interface VaultDeTeste {
  vault: string;
  reunioes: string;
  missoes: string;
  limpar: () => void;
}

export function novoVaultDeTeste(): VaultDeTeste {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "caixa-"));
  for (const d of ["00-Inbox", "10-Reunioes", "20-Missoes"]) fs.mkdirSync(path.join(vault, d));
  return {
    vault,
    reunioes: path.join(vault, "10-Reunioes"),
    missoes: path.join(vault, "20-Missoes"),
    limpar: () => fs.rmSync(vault, { recursive: true, force: true }),
  };
}

/** Grava uma ata fictícia no Inbox, roda a leitura automática e devolve o id da nota criada (sem .md). */
export async function criarReuniao(v: VaultDeTeste, cenario: NomeCenario = "projeto-software", n = 1): Promise<string> {
  const ata = gerarAta(cenario, { agora: AGORA, rng: semente(n) });
  fs.writeFileSync(path.join(v.vault, "00-Inbox", ata.nomeArquivo), ata.texto);
  const antes = new Set(fs.readdirSync(v.reunioes));
  await new IngestaoInbox(() => v.vault, { estabilidadeMs: 0, semWatch: true, intervaloMs: 0, now: () => AGORA }).varrer();
  const nova = fs.readdirSync(v.reunioes).filter((f) => f.endsWith(".md") && !antes.has(f));
  if (nova.length !== 1) throw new Error(`esperava 1 nota nova, vieram ${nova.length}`);
  return nova[0].replace(/\.md$/, "");
}
