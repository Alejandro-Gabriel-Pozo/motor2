import { TOPE_EN_CENTAVOS } from "./dinero-de-caja";
import { explicacionDesdeTexto } from "./explicacion";

/**
 * Corrección de medio de un cobro, declaración de totales y ajuste a una jornada cerrada (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, nivel 4; Pedernal `caja/dominio/correccion.ts` y `movimiento.ts`, e3b §4.3 y §4.4,
 * e3 §3.11.3): registros nuevos que nunca tocan lo original (movimientos y arqueos quedan como se contaron) y solo mueven la conciliación del día. Cada cambio es una fila con `secuencia + 1`; lo vigente es la de mayor secuencia.
 * Puro: sin reloj ni azar.
 */

/** La secuencia de la fila nueva: la mayor de las que hay más uno (la primera es 1). La base exige que siga sin huecos. */
function secuenciaSiguiente(secuencias: readonly number[]): number {
  return Math.max(0, ...secuencias) + 1;
}

interface CorreccionGuardada {
  readonly secuencia: number;
  readonly medioDespuesId: string;
}

/** El medio vigente de un cobro: el destino de su última corrección o, si no hubo, el original. */
export function medioVigenteDelCobro(medioOriginalId: string, correcciones: readonly CorreccionGuardada[]): string {
  const ultima = correcciones.reduce<CorreccionGuardada | null>((v, c) => (v === null || c.secuencia > v.secuencia ? c : v), null);
  return ultima?.medioDespuesId ?? medioOriginalId;
}

/**
 * Traslada el importe completo del cobro del medio vigente a otro: `antes` es el vigente y `secuencia` la siguiente. Corregir a lo que ya es vigente no cambia nada (`MEDIO_DEL_COBRO_SIN_CAMBIOS`; la base lo repite en
 * `CorreccionDeMedio_cambia_chk`). Que el destino sea un medio activo lo decide el caso de uso; que la jornada esté en auditoría, la base y el caso de uso.
 */
export function decidirCorreccionDeMedio(entrada: Readonly<{ medioOriginalId: string; correcciones: readonly CorreccionGuardada[]; destinoId: string }>): { ok: true; valor: { medioAntesId: string; secuencia: number } } | { ok: false; error: "MEDIO_DEL_COBRO_SIN_CAMBIOS" } {
  const medioAntesId = medioVigenteDelCobro(entrada.medioOriginalId, entrada.correcciones);
  if (entrada.destinoId === medioAntesId) return { ok: false, error: "MEDIO_DEL_COBRO_SIN_CAMBIOS" };
  return { ok: true, valor: { medioAntesId, secuencia: secuenciaSiguiente(entrada.correcciones.map((c) => c.secuencia)) } };
}

/**
 * Una declaración de total (e3b §4.4): el total que dice el resumen de la terminal, del QR o del banco por medio. El efectivo NO se declara (su total es lo contado por billetes al cerrar cada caja): `MEDIO_NO_DECLARABLE`. Importe >= 0 y
 * dentro del tope de la columna: `IMPORTE_INVALIDO`.
 */
export function decidirDeclaracion(entrada: Readonly<{ tipoDeMedio: string; importeEnCentavos: bigint; secuenciasDelMedio: readonly number[] }>): { ok: true; valor: { secuencia: number } } | { ok: false; error: "MEDIO_NO_DECLARABLE" | "IMPORTE_INVALIDO" } {
  if (entrada.tipoDeMedio === "EFECTIVO") return { ok: false, error: "MEDIO_NO_DECLARABLE" };
  if (entrada.importeEnCentavos < BigInt(0) || entrada.importeEnCentavos >= TOPE_EN_CENTAVOS) return { ok: false, error: "IMPORTE_INVALIDO" };
  return { ok: true, valor: { secuencia: secuenciaSiguiente(entrada.secuenciasDelMedio) } };
}

/** El motivo obligatorio (corrección de medio, ajuste): la misma explicación de la lista de permitidos pero SIN omitirse. */
export function motivoObligatorio(texto: string | null | undefined): { ok: true; valor: string } | { ok: false; error: "MOTIVO_INVALIDO" } {
  const e = explicacionDesdeTexto(texto);
  if (!e.ok || e.valor === null) return { ok: false, error: "MOTIVO_INVALIDO" };
  return { ok: true, valor: e.valor };
}

type ErrorDeJornadaACorregir = "JORNADA_A_CORREGIR_NO_ENCONTRADA" | "JORNADA_A_CORREGIR_NO_CERRADA" | "JORNADA_A_CORREGIR_NO_ANTERIOR";

/**
 * Un ajuste (e3 §3.11.3): dinero real sin otro registro, de cualquier medio, con signo distinto de cero, dentro del tope y con motivo obligatorio. Si corrige una jornada ya cerrada, esa jornada existe, está CERRADA y es ANTERIOR a la de la sesión
 * donde se registra (la jornada cerrada no cambia: el ajuste cae en el día en curso y queda enlazado). La base repite estas reglas (`MovimientoCaja_validar`).
 */
export function decidirAjuste(
  entrada: Readonly<{
    importeEnCentavos: bigint;
    motivo: string | null | undefined;
    /** «AAAA-MM-DD» de la jornada cerrada que explica, o `null` (ajuste común). */
    corrigeJornada: string | null;
    /** El estado de esa jornada en la sucursal de la caja, o `null` si no existe. */
    estadoDeLaJornadaACorregir: string | null;
    fechaDeLaSesion: string;
  }>,
): { ok: true; valor: { motivo: string } } | { ok: false; error: "IMPORTE_INVALIDO" | "MOTIVO_INVALIDO" | ErrorDeJornadaACorregir } {
  if (entrada.importeEnCentavos === BigInt(0) || entrada.importeEnCentavos >= TOPE_EN_CENTAVOS || entrada.importeEnCentavos <= -TOPE_EN_CENTAVOS) return { ok: false, error: "IMPORTE_INVALIDO" };
  const motivo = motivoObligatorio(entrada.motivo);
  if (!motivo.ok) return motivo;
  if (entrada.corrigeJornada !== null) {
    if (entrada.estadoDeLaJornadaACorregir === null) return { ok: false, error: "JORNADA_A_CORREGIR_NO_ENCONTRADA" };
    if (entrada.estadoDeLaJornadaACorregir !== "CERRADA") return { ok: false, error: "JORNADA_A_CORREGIR_NO_CERRADA" };
    // «AAAA-MM-DD» ordena como texto igual que como fecha.
    if (entrada.corrigeJornada >= entrada.fechaDeLaSesion) return { ok: false, error: "JORNADA_A_CORREGIR_NO_ANTERIOR" };
  }
  return { ok: true, valor: { motivo: motivo.valor } };
}
