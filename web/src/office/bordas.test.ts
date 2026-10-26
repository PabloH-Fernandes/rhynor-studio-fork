// Casos de borda da plaquinha e do "O que eu faço" (testador): npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROSTER, LIMITS, validateRoster } from "../../../shared/roster";
import type { Personagem, Roster } from "../../../shared/types";
import { numeroNoPapel, rotuloDaMesa, rotuloQueCabe } from "./deskLabel";
import { aplicarRascunhos, chavesSujas, copiarVisual, prepararEnvio, trocarResponsabilidade } from "../components/vestiarioLogic";

const com = (key: string, fn: (a: Personagem) => void): Roster => {
  const r = structuredClone(DEFAULT_ROSTER);
  fn(r.personagens.find((a) => a.key === key)!);
  return r;
};
const ok = (r: Roster) => validateRoster(r).ok;

describe("O que eu faço: limites", () => {
  it("exatamente no limite passa; limite+1 falha; 2 e 3 itens passam; 1 e 4 falham", () => {
    assert.ok(ok(com("dev", (a) => (a.oQueFaco = "x".repeat(LIMITS.oQueFaco)))));
    assert.ok(!ok(com("dev", (a) => (a.oQueFaco = "x".repeat(LIMITS.oQueFaco + 1)))));
    assert.ok(ok(com("dev", (a) => (a.responsabilidades = ["a".repeat(LIMITS.responsabilidade), "b"]))));
    assert.ok(!ok(com("dev", (a) => (a.responsabilidades = ["a".repeat(LIMITS.responsabilidade + 1), "b"]))));
    assert.ok(!ok(com("dev", (a) => (a.responsabilidades = ["a"]))));
    assert.ok(!ok(com("dev", (a) => (a.responsabilidades = ["a", "b", "c", "d"]))));
    assert.ok(!ok(com("dev", (a) => (a.responsabilidades = ["a", "  "]))));
  });
  it("HTML passa como texto puro (React escapa); emoji e tipos errados falham", () => {
    assert.ok(ok(com("dev", (a) => (a.oQueFaco = "<b>oi</b> & <script>x</script>"))));
    assert.ok(!ok(com("dev", (a) => (a.oQueFaco = "ok ❤️"))));
    assert.ok(!ok(com("dev", (a) => (a.responsabilidades = ["a", "b 👍"]))));
    assert.ok(!ok(com("dev", (a) => ((a as any).responsabilidades = "texto solto"))));
    assert.ok(!ok(com("dev", (a) => ((a as any).oQueFaco = 42))));
  });
});

describe("vestiário: Desfazer, Voltar ao padrão, Esc (lógica)", () => {
  const dev = () => structuredClone(DEFAULT_ROSTER.personagens.find((a) => a.key === "dev")!);
  it("alterar só os campos novos suja; apagar o rascunho (Desfazer/Esc) limpa", () => {
    const sujo = { ...dev(), oQueFaco: "Outra." };
    assert.deepEqual(chavesSujas(DEFAULT_ROSTER, { dev: sujo }), ["dev"]);
    assert.deepEqual(chavesSujas(DEFAULT_ROSTER, {}), []);
    const volta = { ...sujo, oQueFaco: dev().oQueFaco };
    assert.deepEqual(chavesSujas(DEFAULT_ROSTER, { dev: volta }), []);
  });
  it("Voltar ao padrão restaura frase e lista; caixa vazia no fim não suja nem vai pro servidor", () => {
    const sujo = { ...dev(), oQueFaco: "x", responsabilidades: ["só"] };
    const v = copiarVisual(sujo, dev());
    assert.equal(v.oQueFaco, dev().oQueFaco);
    assert.deepEqual(v.responsabilidades, dev().responsabilidades);
    const lista = trocarResponsabilidade(dev().responsabilidades, 2, "");
    assert.deepEqual(lista, dev().responsabilidades.slice(0, 2));
    const comVazia = { ...dev(), responsabilidades: [...dev().responsabilidades.slice(0, 2), "  "] };
    const env = prepararEnvio(DEFAULT_ROSTER, { dev: comVazia });
    assert.ok(env.ok);
    assert.equal(aplicarRascunhos(DEFAULT_ROSTER, { dev: comVazia }).personagens.find((a) => a.key === "dev")!.responsabilidades.length, 2);
  });
  it("apagar a frase ou ficar com 1 item bloqueia o envio", () => {
    assert.ok(!prepararEnvio(DEFAULT_ROSTER, { dev: { ...dev(), oQueFaco: "   " } }).ok);
    assert.ok(!prepararEnvio(DEFAULT_ROSTER, { dev: { ...dev(), responsabilidades: ["um"] } }).ok);
  });
});

describe("plaquinhas: 2 devs + 2 pesquisadores + visitante extra juntos", () => {
  const pers = DEFAULT_ROSTER.personagens;
  const mesas = [
    rotuloDaMesa("dev", { papel: "dev", numero: numeroNoPapel(pers, "dev") }),
    rotuloDaMesa("convidado", { papel: "dev", numero: numeroNoPapel(pers, "dev-2") }),
    rotuloDaMesa("pesquisador", { papel: "pesquisador", numero: numeroNoPapel(pers, "pesquisador") }),
    rotuloDaMesa("convidado", { papel: "pesquisador", numero: numeroNoPapel(pers, "pesquisador-2") }),
    rotuloDaMesa("convidado", { papel: "tipo-inventado" }),
    rotuloDaMesa("convidado", null),
  ];
  it("cada mesa tem o rótulo certo e o número só aparece na 2ª", () => {
    assert.deepEqual(mesas, ["DESENVOLVIMENTO", "DESENVOLVIMENTO 2", "PESQUISA", "PESQUISA 2", "CONVIDADO", "LIVRE"]);
  });
  it("abreviação só quando não cabe", () => {
    const m = (s: string) => [...s].length * 2.8;
    assert.equal(rotuloQueCabe("DESENVOLVIMENTO 2", 38, m), "DESENVOLV. 2");
    assert.equal(rotuloQueCabe("PESQUISA 2", 38, m), "PESQUISA 2");
    assert.equal(rotuloQueCabe("CONVIDADO", 38, m), "CONVIDADO");
  });
});
