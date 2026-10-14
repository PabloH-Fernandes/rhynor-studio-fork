// Datas das notas do vault (AAAA-MM-DD): a mesma validação no servidor (ordem) e no painel (texto).

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const dois = (n: number) => String(n).padStart(2, "0");

/** AAAA-MM-DD de um dia que existe (mês 01-12, dia 01-31 e conferido de volta em UTC: 2026-02-31 não) */
export function ehDataValida(texto: string): boolean {
  const m = ISO.exec(texto.trim());
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  // só para validar: o UTC não depende do fuso de quem roda
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** dia local (AAAA-MM-DD) de um instante em ms; "" quando não há instante */
export function diaLocal(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** a data da nota, se válida; senão o dia local de atualizadoEm; "" se não houver nenhuma */
export function dataEfetiva(m: { data: string; atualizadoEm: number }): string {
  const data = m.data.trim();
  return ehDataValida(data) ? data : diaLocal(m.atualizadoEm);
}

/** AAAA-MM-DD → dd/mm/aaaa (texto puro, sem passar por Date) */
export function dataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
