import type { CondicionDeControl, EntradaDeRecepcion } from "./recepcion";

/**
 * Compras, depósitos de uso RECHAZO y CUARENTENA, etapa (i) (docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md, niveles 4 y 5; oráculo `docs/oraculo-combinaciones-compras-cuarentena-y-rechazo-2026-11-17.md`): las reglas PURAS del «uso» de un
 * depósito (`Seccion.uso`) y del destino de cada renglón al confirmar una recepción. Sin base, sin Prisma y sin reloj: el caso de uso las aplica con las secciones de la sucursal ya leídas (y bloqueadas) y el oráculo las contrasta combinación por combinación.
 * Decisión del dueño, 2026-11-17 («4.-lo recomendado», como Pedernal): la línea rechazada va a RECHAZO, la con observaciones a CUARENTENA; se propone según el control, quien confirma puede cambiarla (auditado) y la confirmación se BLOQUEA si la sucursal no tiene el
 * depósito de ese uso («la recepción no se puede confirmar si la sucursal no los tiene»: más estricto que Pedernal).
 */

/** Los usos de un depósito (el CHECK `Seccion_uso_chk` de la base dice lo mismo). Se elige al crearlo y no cambia (disparador de la base). */
export const USOS_DE_SECCION = ["NORMAL", "CUARENTENA", "RECHAZO"] as const;
export type UsoDeSeccion = (typeof USOS_DE_SECCION)[number];

export const ETIQUETA_DE_USO_DE_SECCION: Readonly<Record<UsoDeSeccion, string>> = {
  NORMAL: "Normal",
  CUARENTENA: "Cuarentena",
  RECHAZO: "Rechazo",
};

/** Lista de PERMITIDOS: ¿es uno de los tres usos? (el alta de un depósito rechaza cualquier otro valor). */
export function esUsoDeSeccion(valor: unknown): valor is UsoDeSeccion {
  return typeof valor === "string" && (USOS_DE_SECCION as readonly string[]).includes(valor);
}

/** El uso de depósito que se PROPONE para una línea según su control (`null` = sin control, «no se constató»): sin control o conforme → normal; con observaciones → cuarentena; rechazada → rechazo. */
export const USO_PROPUESTO_POR_CONTROL: Readonly<Record<CondicionDeControl | "SIN_CONTROL", UsoDeSeccion>> = {
  SIN_CONTROL: "NORMAL",
  CONFORME: "NORMAL",
  CON_OBSERVACIONES: "CUARENTENA",
  RECHAZADA: "RECHAZO",
};

export function usoPropuestoPorElControl(condicion: CondicionDeControl | null): UsoDeSeccion {
  return USO_PROPUESTO_POR_CONTROL[condicion ?? "SIN_CONTROL"];
}

export interface SeccionParaElDestino {
  id: string;
  nombre: string;
  uso: UsoDeSeccion;
  activa: boolean;
}

/** Las secciones por nombre (sin distinguir mayúsculas ni acentos) y, ante un empate, por id: el orden con el que se «propone la primera», el mismo en el servidor y en la pantalla. */
export function ordenarSeccionesPorNombre<T extends { id: string; nombre: string }>(secciones: readonly T[]): T[] {
  return [...secciones].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** La sección que se propone para un uso: la primera ACTIVA de ese uso por nombre, o `null` si la sucursal no tiene ninguna activa. */
export function seccionPropuestaParaUso(uso: UsoDeSeccion, secciones: readonly SeccionParaElDestino[]): SeccionParaElDestino | null {
  return ordenarSeccionesPorNombre(secciones.filter((s) => s.activa && s.uso === uso))[0] ?? null;
}

export const MENSAJE_SIN_DEPOSITO_DE_RECHAZO = "Esta sucursal no tiene un depósito de rechazo: no se puede confirmar una recepción con mercadería rechazada.";
export const MENSAJE_SIN_DEPOSITO_DE_CUARENTENA = "Esta sucursal no tiene un depósito de cuarentena: no se puede confirmar una recepción con mercadería con observaciones.";

export type CodigoDeBloqueoDeDestino = "SIN_DEPOSITO_DE_RECHAZO" | "SIN_DEPOSITO_DE_CUARENTENA";

/**
 * ¿Qué depósito de uso especial le falta a la sucursal para confirmar estas líneas? BLOQUEO ESTRICTO: si alguna línea es RECHAZADA y no hay un depósito de RECHAZO activo, o alguna es CON_OBSERVACIONES y no hay uno de CUARENTENA activo, la confirmación entera se
 * rechaza aunque quien confirma quiera mandar la línea a otro depósito. Si faltan los dos, se dice el de rechazo (el más grave). `null` = nada falta. Puro y total.
 */
export function bloqueoPorFaltaDeDeposito(condiciones: readonly (CondicionDeControl | null)[], secciones: readonly SeccionParaElDestino[]): { codigo: CodigoDeBloqueoDeDestino; mensaje: string } | null {
  const hay = (uso: UsoDeSeccion) => secciones.some((s) => s.activa && s.uso === uso);
  if (condiciones.includes("RECHAZADA") && !hay("RECHAZO")) return { codigo: "SIN_DEPOSITO_DE_RECHAZO", mensaje: MENSAJE_SIN_DEPOSITO_DE_RECHAZO };
  if (condiciones.includes("CON_OBSERVACIONES") && !hay("CUARENTENA")) return { codigo: "SIN_DEPOSITO_DE_CUARENTENA", mensaje: MENSAJE_SIN_DEPOSITO_DE_CUARENTENA };
  return null;
}

export interface LineaParaElDestino {
  renglonId: string;
  /** El control registrado (`null` = sin control). */
  condicion: CondicionDeControl | null;
}

/** Lo que queda en la auditoría por renglón: la sección propuesta por el control (`null` si la sucursal no tiene una activa de ese uso), la elegida y si se la cambió. */
export interface DestinoDeRenglon {
  renglonId: string;
  seccionPropuestaId: string | null;
  seccionElegidaId: string;
  /** Sin propuesta (no hay un depósito activo del uso que el control pide) la elegida cuenta como cambiada: no coincide con nada propuesto. */
  cambiado: boolean;
}

type DecisionDeDestinos = { ok: true; destinos: DestinoDeRenglon[] } | { ok: false; codigo: CodigoDeBloqueoDeDestino; mensaje: string };

/**
 * El destino de cada renglón al confirmar: primero el bloqueo (si falta un depósito de uso especial, nada entra) y, si no, la sección propuesta de cada línea (la primera activa por nombre del uso que pide su control) contra la elegida por quien confirma
 * (que el caso de uso ya verificó propia y activa; puede ser cualquier sección activa de la sucursal, de cualquier uso). Una entrada elegida para un renglón que no es de la lista no se toca: eso lo rechaza `validarEntradasDeRecepcion`. Puro y total.
 */
export function decidirDestinosDeRecepcion(e: { lineas: readonly LineaParaElDestino[]; secciones: readonly SeccionParaElDestino[]; elegidas: readonly EntradaDeRecepcion[] }): DecisionDeDestinos {
  const bloqueo = bloqueoPorFaltaDeDeposito(e.lineas.map((l) => l.condicion), e.secciones);
  if (bloqueo) return { ok: false, ...bloqueo };
  const elegidaDe = new Map(e.elegidas.map((x) => [x.renglonId, x.seccionId]));
  const destinos = e.lineas.map((l): DestinoDeRenglon => {
    const propuesta = seccionPropuestaParaUso(usoPropuestoPorElControl(l.condicion), e.secciones)?.id ?? null;
    const elegida = elegidaDe.get(l.renglonId) ?? "";
    return { renglonId: l.renglonId, seccionPropuestaId: propuesta, seccionElegidaId: elegida, cambiado: propuesta === null || propuesta !== elegida };
  });
  return { ok: true, destinos };
}
