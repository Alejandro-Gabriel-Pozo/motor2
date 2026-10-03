import { esCuitValido, normalizarCuit } from "./cuit";

export interface FilaConCuit {
  /** Identifica la fila sin revelar el CUIT ni el nombre (p. ej. «slug/PRV_000001»). */
  referencia: string;
  /** Ámbito dentro del que el CUIT debe ser único: el `empresaId` en proveedores, uno solo en empresas. */
  grupo: string;
  cuit: string | null;
}

export type MotivoDeCuit = "no_normaliza" | "prefijo_invalido" | "verificador_invalido";

export interface DiagnosticoDeCuit {
  total: number;
  vacios: number;
  canonicos: number;
  validosConSeparadores: number;
  noNormalizan: number;
  prefijoInvalido: number;
  verificadorInvalido: number;
  /** Grupos de filas que, al normalizar a 11 dígitos, comparten CUIT dentro del mismo ámbito (lo que frenaría el índice único). */
  gruposDuplicados: number;
  filasEnDuplicados: number;
  detalle: Array<{ referencia: string; motivo: MotivoDeCuit | "duplicado" }>;
}

const PREFIJOS = new Set(["20", "23", "24", "27", "30", "33", "34"]);

/** Cuenta cuántos CUIT de una tabla ya están en orden y cuáles hay que corregir antes de exigir CUIT canónico y único. Puro: nunca devuelve un CUIT. */
export function diagnosticarCuits(filas: readonly FilaConCuit[]): DiagnosticoDeCuit {
  const d: DiagnosticoDeCuit = {
    total: filas.length,
    vacios: 0,
    canonicos: 0,
    validosConSeparadores: 0,
    noNormalizan: 0,
    prefijoInvalido: 0,
    verificadorInvalido: 0,
    gruposDuplicados: 0,
    filasEnDuplicados: 0,
    detalle: [],
  };
  const porClave = new Map<string, string[]>();

  for (const fila of filas) {
    const crudo = (fila.cuit ?? "").trim();
    if (!crudo) {
      d.vacios++;
      continue;
    }
    const digitos = normalizarCuit(crudo);
    if (!digitos) {
      d.noNormalizan++;
      d.detalle.push({ referencia: fila.referencia, motivo: "no_normaliza" });
      continue;
    }
    const clave = `${fila.grupo}|${digitos}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), fila.referencia]);
    if (!PREFIJOS.has(digitos.slice(0, 2))) {
      d.prefijoInvalido++;
      d.detalle.push({ referencia: fila.referencia, motivo: "prefijo_invalido" });
    } else if (!esCuitValido(digitos)) {
      d.verificadorInvalido++;
      d.detalle.push({ referencia: fila.referencia, motivo: "verificador_invalido" });
    } else if (crudo === digitos) d.canonicos++;
    else d.validosConSeparadores++;
  }

  for (const referencias of porClave.values()) {
    if (referencias.length < 2) continue;
    d.gruposDuplicados++;
    d.filasEnDuplicados += referencias.length;
    for (const referencia of referencias) d.detalle.push({ referencia, motivo: "duplicado" });
  }
  return d;
}
