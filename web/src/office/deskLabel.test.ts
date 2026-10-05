// Testes do texto da plaquinha da mesa (sem canvas): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROSTER } from "../../../shared/roster";
import { palette, theme } from "../theme";
import { MAX_APERTO, numeroNoPapel, rotuloDaMesa, rotuloQueCabe, rotulosDasMesas } from "./deskLabel";

/** largura da VT323 a 7px: 2,8 px por caractere (medido no navegador) */
const vt323 = (s: string) => [...s].length * 2.8;
/** texto da maior plaquinha de mesa comum: tampo de 44 px - 6 */
const MESA = 38;

describe("rotuloDaMesa", () => {
  it("mostra a função de quem está sentado", () => {
    assert.equal(rotuloDaMesa("lider", { papel: "lider" }), "LÍDER");
    assert.equal(rotuloDaMesa("planejador", { papel: "planejador", numero: 1 }), "PLANEJAMENTO");
    assert.equal(rotuloDaMesa("testador", { papel: "testador" }), "TESTES");
    assert.equal(rotuloDaMesa("revisor", { papel: "revisor" }), "REVISÃO");
    assert.equal(rotuloDaMesa("documentador", { papel: "documentador" }), "DOCUMENTAÇÃO");
    assert.equal(rotuloDaMesa("convidado-1", { papel: "convidado" }), "CONVIDADO");
  });

  it("a segunda do mesmo papel ganha o número, em qualquer mesa", () => {
    assert.equal(rotuloDaMesa("dev", { papel: "dev", numero: 2 }), "DESENVOLVIMENTO 2");
    assert.equal(rotuloDaMesa("convidado", { papel: "pesquisador", numero: 2 }), "PESQUISA 2");
  });

  it("mesa vazia: a do papel mostra o setor; a de convidado, LIVRE", () => {
    assert.equal(rotuloDaMesa("convidado", null), "LIVRE");
    assert.equal(rotuloDaMesa("dev", null), "DESENVOLVIMENTO");
  });

  it("visitante extra (tipo sem papel no time) é CONVIDADO", () => {
    assert.equal(rotuloDaMesa("convidado", { papel: "statusline-setup" }), "CONVIDADO");
  });
});

describe("numeroNoPapel", () => {
  it("principal é 1; dev-2 e pesquisador-2 são 2; convidados não contam como variação", () => {
    const ags = DEFAULT_ROSTER.agzinhos;
    assert.equal(numeroNoPapel(ags, "dev"), 1);
    assert.equal(numeroNoPapel(ags, "dev-2"), 2);
    assert.equal(numeroNoPapel(ags, "pesquisador-2"), 2);
    assert.equal(numeroNoPapel(ags, "curinga"), 1);
    assert.equal(numeroNoPapel(ags, "nao-existe"), 1);
  });

  it("uma terceira variação vira 3", () => {
    const ags = [...DEFAULT_ROSTER.agzinhos, { ...DEFAULT_ROSTER.agzinhos[7], key: "dev-3" }];
    assert.equal(numeroNoPapel(ags, "dev-3"), 3);
  });
});

describe("rotuloQueCabe", () => {
  it("os rótulos cabem na plaquinha, só DESENVOLVIMENTO 2 abrevia", () => {
    for (const r of ["LÍDER", "PLANEJAMENTO", "PESQUISA", "DESENVOLVIMENTO", "TESTES", "REVISÃO", "DOCUMENTAÇÃO", "CONVIDADO", "LIVRE", "PESQUISA 2"]) {
      assert.equal(rotuloQueCabe(r, MESA, vt323), r);
    }
    assert.equal(rotuloQueCabe("DESENVOLVIMENTO 2", MESA, vt323), "DESENVOLV. 2");
    assert.ok(vt323("DESENVOLV. 2") <= MESA);
  });

  it("na mesa grande (líder) DESENVOLVIMENTO 2 cabe inteiro", () => {
    assert.equal(rotuloQueCabe("DESENVOLVIMENTO 2", 51, vt323), "DESENVOLVIMENTO 2");
  });
});

describe("rotulosDasMesas", () => {
  const ags = DEFAULT_ROSTER.agzinhos;
  const mesa = (papel: string, quem: { agzinho?: string; role: string } | null) => ({ papel, quem });

  it("convidados juntos: numerados pela ordem no elenco, não pela mesa", () => {
    const r = rotulosDasMesas(
      [
        mesa("convidado", { agzinho: "curinga", role: "convidado" }),
        mesa("convidado", { agzinho: "explore", role: "convidado" }),
        mesa("convidado", { agzinho: "general-purpose", role: "convidado" }),
      ],
      ags,
    );
    assert.deepEqual(r, ["CONVIDADO 3", "CONVIDADO", "CONVIDADO 2"]);
  });

  it("convidado sozinho é só CONVIDADO; extra sem AGzinho vem depois dos do elenco", () => {
    assert.deepEqual(rotulosDasMesas([mesa("convidado", { agzinho: "curinga", role: "convidado" }), mesa("convidado", null)], ags), ["CONVIDADO", "LIVRE"]);
    const r = rotulosDasMesas(
      [mesa("convidado", { role: "statusline-setup" }), mesa("convidado", { agzinho: "general-purpose", role: "convidado" })],
      ags,
    );
    assert.deepEqual(r, ["CONVIDADO 2", "CONVIDADO"]);
  });

  it("variações mantêm o número do elenco e não contam entre os convidados", () => {
    const r = rotulosDasMesas(
      [
        mesa("dev", { agzinho: "dev", role: "dev" }),
        mesa("convidado", { agzinho: "dev-2", role: "dev" }),
        mesa("convidado", { agzinho: "explore", role: "convidado" }),
        mesa("testador", null),
      ],
      ags,
    );
    assert.deepEqual(r, ["DESENVOLVIMENTO", "DESENVOLVIMENTO 2", "CONVIDADO", "TESTES"]);
  });
});

describe("plaquinha legível", () => {
  /** larguras de texto: mesa comum (2,75 tiles) e mesa grande (3,6 tiles), menos 6 px */
  const LARGURAS = [2.75 * 16 - 6, 3.6 * 16 - 6];

  it("todo rótulo possível (1 a 3 por função) cabe sem espremer além do limite", () => {
    const rotulos = [
      "LIVRE",
      ...Object.values(theme.deskLabels).flatMap((f) => [f, `${f} 2`, `${f} 3`]),
    ];
    assert.ok(rotulos.includes("DOCUMENTAÇÃO 2") && rotulos.includes("CONVIDADO 3"));
    for (const maxW of LARGURAS) {
      for (const r of rotulos) {
        const final = rotuloQueCabe(r, maxW, vt323);
        // o fillText(maxW) espreme até maxW: a escala nunca passa do MAX_APERTO
        const escala = Math.min(1, maxW / vt323(final));
        assert.ok(escala >= MAX_APERTO, `${r} → ${final} em ${maxW}px: escala ${escala.toFixed(2)}`);
      }
    }
  });

  /** razão de contraste WCAG entre duas cores #RRGGBB */
  function contraste(a: string, b: string) {
    const lum = (hex: string) => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  it("texto navy950 sobre a cor de cada papel tem contraste de pelo menos 4,5:1", () => {
    for (const [papel, cor] of Object.entries(theme.roleColors)) {
      const r = contraste(cor, palette.navy950);
      assert.ok(r >= 4.5, `${papel} ${cor}: ${r.toFixed(2)}:1`);
    }
  });
});
