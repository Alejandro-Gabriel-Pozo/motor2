/**
 * La conciliación por medio de una jornada (Pedernal `caja/dominio/conciliacion.ts`; E3b §4.4): por cada medio lo REGISTRADO (Σ de los movimientos de las sesiones de la jornada), las CORRECCIONES de medio (+importe en el medio de destino,
 * −importe en el de origen), lo DECLARADO y la DIFERENCIA = declarado − (registrado + correcciones), al centavo y en `bigint`. En C2 el par es solo el medio (no hay cuenta de cobro hasta C3). Puro: sin reloj ni azar.
 */
export type EstadoDeConteo = "CONTADO" | "DECLARADO" | "CONFORME" | "SIN_DATO";

interface Movimiento {
  readonly medioDePagoId: string;
  readonly importeEnCentavos: bigint;
}

interface Correccion {
  readonly importeEnCentavos: bigint;
  readonly medioAntesId: string;
  readonly medioDespuesId: string;
}

interface Declaracion {
  readonly medioDePagoId: string;
  readonly secuencia: number;
  readonly importeEnCentavos: bigint;
}

/** Lo que dejó el cierre de una caja para un medio: lo contado (el efectivo), o el conforme con quién y cuándo (los demás; lo da quien cierra la sesión). */
export type CierreDeCajaDelMedio = { readonly medioDePagoId: string } & (
  | { readonly conforme: false; readonly contadoEnCentavos: bigint }
  | { readonly conforme: true; readonly conformePorId: string; readonly conformeEn: Date }
);

interface EntradaDeConciliacion {
  readonly efectivoId: string;
  /** Todos los movimientos de las sesiones de la sucursal y la fecha. */
  readonly movimientos: readonly Movimiento[];
  readonly correcciones: readonly Correccion[];
  /** Todas las declaraciones de la jornada (rige la de mayor secuencia por medio). */
  readonly declaraciones: readonly Declaracion[];
  /** El «conforme general» de la jornada (uno solo), si se dio. */
  readonly conformeGeneral: Readonly<{ porId: string; en: Date }> | null;
  /** Las líneas de arqueo de todas las sesiones de la jornada. */
  readonly cierres: readonly CierreDeCajaDelMedio[];
}

export interface LineaDeConciliacion {
  readonly medioDePagoId: string;
  readonly registradoEnCentavos: bigint;
  readonly correccionesEnCentavos: bigint;
  /** `null` si es `CONFORME` o `SIN_DATO`. */
  readonly declaradoEnCentavos: bigint | null;
  readonly estado: EstadoDeConteo;
  readonly conformePorId: string | null;
  readonly conformeEn: Date | null;
  /** declarado − (registrado + correcciones); `null` si `CONFORME` (muestra «conforme») o `SIN_DATO`. */
  readonly diferenciaEnCentavos: bigint | null;
}

type Conteo = Pick<LineaDeConciliacion, "estado" | "declaradoEnCentavos" | "conformePorId" | "conformeEn">;

const SIN_DATO: Conteo = { estado: "SIN_DATO", declaradoEnCentavos: null, conformePorId: null, conformeEn: null };
const declarado = (importe: bigint): Conteo => ({ estado: "DECLARADO", declaradoEnCentavos: importe, conformePorId: null, conformeEn: null });
const conforme = (por: string, en: Date): Conteo => ({ estado: "CONFORME", declaradoEnCentavos: null, conformePorId: por, conformeEn: en });

function sumaDeContados(cierres: readonly CierreDeCajaDelMedio[]): bigint {
  let total = BigInt(0);
  for (const c of cierres) if (!c.conforme) total += c.contadoEnCentavos;
  return total;
}

/**
 * Cómo se sabe el total de un medio (Pedernal e3b §4.4, en este orden). El efectivo es siempre `CONTADO` (la suma de lo contado por billetes en cada caja). Los demás: (1) la declaración vigente del medio → `DECLARADO`; (2) si no, el conforme
 * general de la jornada → `CONFORME`; (3) si no, lo derivado de los cierres de caja: todas las líneas contadas → `DECLARADO` con la suma; todas conformes → `CONFORME` con quién y cuándo del último; mezcla → `SIN_DATO`; (4) sin nada → `SIN_DATO`.
 * La declaración explícita gana siempre sobre el conforme general. Previene un total inventado y que un conforme tape una declaración.
 */
function conteoDelMedio(medioId: string, entrada: EntradaDeConciliacion, vigente: Declaracion | null, cierres: readonly CierreDeCajaDelMedio[]): Conteo {
  if (medioId === entrada.efectivoId) return { ...declarado(sumaDeContados(cierres)), estado: "CONTADO" };
  if (vigente !== null) return declarado(vigente.importeEnCentavos);
  if (entrada.conformeGeneral !== null) return conforme(entrada.conformeGeneral.porId, entrada.conformeGeneral.en);
  const contadas = cierres.filter((c) => !c.conforme);
  if (cierres.length > 0 && contadas.length === cierres.length) return declarado(sumaDeContados(cierres));
  const conformes = cierres.flatMap((c) => (c.conforme ? [c] : []));
  if (cierres.length > 0 && conformes.length === cierres.length) {
    // El último en cerrar; con el mismo instante, el de mayor id de quien cerró (la base ordena igual: `CierreDeCajaDeJornada_verificar`).
    const ultimo = conformes.reduce((mejor, c) => (c.conformeEn > mejor.conformeEn || (c.conformeEn.getTime() === mejor.conformeEn.getTime() && c.conformePorId > mejor.conformePorId) ? c : mejor));
    return conforme(ultimo.conformePorId, ultimo.conformeEn);
  }
  return SIN_DATO;
}

/** La declaración vigente de una lista: la de mayor secuencia, o `null`. */
function declaracionVigente<T extends Readonly<{ secuencia: number }>>(filas: readonly T[]): T | null {
  return filas.reduce<T | null>((vigente, fila) => (vigente === null || fila.secuencia > vigente.secuencia ? fila : vigente), null);
}

/** La conciliación de la jornada: una línea por cada medio con movimientos, correcciones o declaración, ordenada por medio. La diferencia solo existe donde hay un total (`CONTADO` o `DECLARADO`). */
export function conciliarJornada(entrada: EntradaDeConciliacion): readonly LineaDeConciliacion[] {
  const medios = new Set<string>();
  const registrado = new Map<string, bigint>();
  const correcciones = new Map<string, bigint>();
  const sumar = (mapa: Map<string, bigint>, medio: string, importe: bigint) => mapa.set(medio, (mapa.get(medio) ?? BigInt(0)) + importe);
  for (const m of entrada.movimientos) {
    medios.add(m.medioDePagoId);
    sumar(registrado, m.medioDePagoId, m.importeEnCentavos);
  }
  for (const c of entrada.correcciones) {
    medios.add(c.medioAntesId);
    medios.add(c.medioDespuesId);
    sumar(correcciones, c.medioAntesId, -c.importeEnCentavos);
    sumar(correcciones, c.medioDespuesId, c.importeEnCentavos);
  }
  for (const d of entrada.declaraciones) medios.add(d.medioDePagoId);
  return [...medios].sort().map((medioId) => {
    const conteo = conteoDelMedio(medioId, entrada, declaracionVigente(entrada.declaraciones.filter((d) => d.medioDePagoId === medioId)), entrada.cierres.filter((c) => c.medioDePagoId === medioId));
    const reg = registrado.get(medioId) ?? BigInt(0);
    const cor = correcciones.get(medioId) ?? BigInt(0);
    return { medioDePagoId: medioId, registradoEnCentavos: reg, correccionesEnCentavos: cor, ...conteo, diferenciaEnCentavos: conteo.declaradoEnCentavos === null ? null : conteo.declaradoEnCentavos - (reg + cor) };
  });
}

/** ¿Hay que explicar esta línea? Sí si no hay dato o si la diferencia es distinta de cero. Las `CONFORME` no (no hay diferencia que explicar). Es lo que cuenta `caja.conciliacion_por_medio`. */
export function lineaPorExplicar(l: Pick<LineaDeConciliacion, "estado" | "diferenciaEnCentavos">): boolean {
  return l.estado === "SIN_DATO" || (l.diferenciaEnCentavos !== null && l.diferenciaEnCentavos !== BigInt(0));
}
