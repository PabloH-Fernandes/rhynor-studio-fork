// Hora do escritório: noite padrão, ciclo do dia e ?hora= (npm test)
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NIGHT_HOUR, clockDate, hourNow, parseHourParam, setCicloReal, setHourOverride } from "./daylight";

afterEach(() => {
  setCicloReal(false);
  setHourOverride(null);
});

const as15h30 = new Date(2026, 9, 26, 15, 30, 0);

describe("hora do escritório", () => {
  it("sem ciclo e sem ?hora=, é noite (22h)", () => {
    assert.equal(NIGHT_HOUR, 22);
    assert.equal(hourNow(as15h30), 22);
    const c = clockDate(as15h30);
    assert.equal(c.getHours(), 22);
    assert.equal(c.getMinutes(), 30, "os minutos seguem o relógio");
  });

  it("com o ciclo ligado, segue a hora real", () => {
    setCicloReal(true);
    assert.equal(hourNow(as15h30), 15.5);
    assert.equal(clockDate(as15h30).getHours(), 15);
  });

  it("?hora= vence o ciclo e a noite padrão", () => {
    setHourOverride(7.5);
    assert.equal(hourNow(as15h30), 7.5);
    setCicloReal(true);
    assert.equal(hourNow(as15h30), 7.5);
    const c = clockDate(as15h30);
    assert.deepEqual([c.getHours(), c.getMinutes()], [7, 30]);
  });

  it("parseHourParam: HH, HH.MM e HH:MM; inválidos viram null", () => {
    assert.equal(parseHourParam("22"), 22);
    assert.equal(parseHourParam("7.30"), 7.5);
    assert.equal(parseHourParam("7:05"), 7 + 5 / 60);
    assert.equal(parseHourParam("24"), null);
    assert.equal(parseHourParam("7:60"), null);
    assert.equal(parseHourParam("noite"), null);
    assert.equal(parseHourParam(null), null);
  });
});
