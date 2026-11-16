import { explicacionDesdeTexto } from "./explicacion";

/**
 * Cuándo se puede cerrar la jornada y qué queda guardado (docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, nivel 5; Pedernal `cierre/aporte-al-cierre.ts` y `cierre/dominio/cierre.ts`, E3b §3.3 y §3.4; decisiones 160 y 167).
 * «Resuelto o reconocido» = ningún control `BLOQUEA` con hallazgos y todo control `RECONOCIBLE` con hallazgos reconocido (el texto es opcional); un `INFORMA` nunca frena. Reconocer = listar el control en `cerrarJornada` junto con la
 * huella que se vio. Puro: sin reloj ni azar (la huella la calcula el caso de uso con `calcularPayloadHash`).
 */
export type Severidad = "BLOQUEA" | "RECONOCIBLE" | "INFORMA";

/** Una fila del detalle de un control: valores simples en orden fijo (entra en la huella). */
export type FilaDeDetalle = readonly (string | number | null)[];

/** Cuántas referencias (ids para navegar al detalle) lleva un control como máximo, como Pedernal. */
const MAXIMO_DE_REFERENCIAS = 50;

/** Un control del día: `modulo.control` en minúsculas y guion bajo, con su severidad fija, la cantidad de hallazgos (0 = sin hallazgos), el detalle y las referencias. */
export interface ControlDelDia {
  readonly modulo: string;
  readonly clave: string;
  readonly severidad: Severidad;
  readonly cantidad: number;
  readonly detalle: readonly FilaDeDetalle[];
  readonly referencias: readonly string[];
}

/** Arma un control: el detalle se ordena por su texto (unidades de código, sin comparador propio) y las referencias son únicas, ordenadas y hasta el tope. La cantidad por defecto es la de filas. */
export function armarControl(def: Readonly<{ modulo: string; clave: string; severidad: Severidad }>, filas: readonly FilaDeDetalle[], referencias: readonly string[], cantidad: number = filas.length): ControlDelDia {
  const detalle = filas.map((f) => JSON.stringify(f)).sort().map((t) => JSON.parse(t) as FilaDeDetalle);
  return { modulo: def.modulo, clave: def.clave, severidad: def.severidad, cantidad, detalle, referencias: [...new Set(referencias)].sort().slice(0, MAXIMO_DE_REFERENCIAS) };
}

/** Lo que impide cerrar: `BLOQUEA` con hallazgos. */
export function impideCerrar(control: Pick<ControlDelDia, "severidad" | "cantidad">): boolean {
  return control.severidad === "BLOQUEA" && control.cantidad > 0;
}

/** Lo que hay que reconocer para cerrar: `RECONOCIBLE` con hallazgos. */
export function pideReconocimiento(control: Pick<ControlDelDia, "severidad" | "cantidad">): boolean {
  return control.severidad === "RECONOCIBLE" && control.cantidad > 0;
}

/**
 * Orden total y estable de los controles: por clave (que empieza con el módulo), comparando unidades de código (sin depender del idioma del servidor). Se ordena la clave con el orden por defecto de los textos, sin comparador propio.
 */
export function ordenarControles<T extends Readonly<{ clave: string }>>(controles: readonly T[]): T[] {
  const porClave = new Map<string, T>();
  for (const c of controles) porClave.set(c.clave, c);
  return [...porClave.keys()].sort().map((k) => porClave.get(k) as T);
}

/** Lo que llega al pedir el cierre: qué reconoce quien cierra. `texto` es la explicación opcional del control. */
export interface ReconocimientoPedido {
  readonly clave: string;
  readonly texto: string | null;
}

/** Tope de reconocimientos por pedido: sobra para los controles de todos los módulos, y acota lo que se procesa. */
const MAXIMO_DE_RECONOCIMIENTOS = 100;

/** Lista de permitidos de la clave de un control (la repite el CHECK `ControlDeJornadaCerrada_clave_chk`): `modulo.control` en minúsculas y guion bajo. */
const FORMA_DE_LA_CLAVE = /^[a-z_]+\.[a-z_]+$/;
const LARGO_MAXIMO_DE_LA_CLAVE = 81;

/**
 * Valida y canoniza lo que pide reconocer, sin mirar todavía los controles: forma de la clave (lista de permitidos), sin repetidos, el texto cumple la explicación y no se pasa del tope. Cualquier cosa fuera de eso es
 * `RECONOCIMIENTO_INVALIDO`.
 */
export function reconocimientosValidos(pedidos: readonly ReconocimientoPedido[]): { ok: true; valor: readonly ReconocimientoPedido[] } | { ok: false; error: "RECONOCIMIENTO_INVALIDO" } {
  if (pedidos.length > MAXIMO_DE_RECONOCIMIENTOS) return { ok: false, error: "RECONOCIMIENTO_INVALIDO" };
  const vistos = new Set<string>();
  const validos: ReconocimientoPedido[] = [];
  for (const pedido of pedidos) {
    if (typeof pedido.clave !== "string" || pedido.clave.length > LARGO_MAXIMO_DE_LA_CLAVE || !FORMA_DE_LA_CLAVE.test(pedido.clave) || vistos.has(pedido.clave)) return { ok: false, error: "RECONOCIMIENTO_INVALIDO" };
    const texto = explicacionDesdeTexto(pedido.texto);
    if (!texto.ok) return { ok: false, error: "RECONOCIMIENTO_INVALIDO" };
    vistos.add(pedido.clave);
    validos.push({ clave: pedido.clave, texto: texto.valor });
  }
  return { ok: true, valor: validos };
}

/** Un control con su constancia de reconocimiento (cuándo y quién los pone la persistencia, con el actor). */
export type ControlResuelto = ControlDelDia & { readonly reconocido: boolean; readonly texto: string | null };

export type ErrorDeCierre =
  | { readonly codigo: "CONTROLES_CAMBIARON"; readonly controles: readonly ControlDelDia[] }
  | { readonly codigo: "CONTROLES_QUE_BLOQUEAN"; readonly claves: readonly string[] }
  | { readonly codigo: "CONTROLES_SIN_RECONOCER"; readonly claves: readonly string[] }
  | { readonly codigo: "RECONOCIMIENTO_INVALIDO" };

/**
 * Decide el cierre con los controles RECALCULADOS dentro de la transacción. En este orden (el primero que falla manda):
 *  1. la huella que se vio no es la de ahora → `CONTROLES_CAMBIARON` (con los controles actuales: la pantalla vuelve a mostrar);
 *  2. se reconoce algo que no es un control `RECONOCIBLE` con hallazgos → `RECONOCIMIENTO_INVALIDO`;
 *  3. algún `BLOQUEA` con hallazgos → `CONTROLES_QUE_BLOQUEAN`;
 *  4. algún `RECONOCIBLE` con hallazgos sin reconocer → `CONTROLES_SIN_RECONOCER`.
 * Si pasa, devuelve TODOS los controles (incluso los de cantidad 0 y los que solo informan) con su constancia de reconocimiento.
 */
export function decidirCierre(entrada: Readonly<{ controles: readonly ControlDelDia[]; huellaActual: string; huellaVista: string; reconocimientos: readonly ReconocimientoPedido[] }>): { ok: true; valor: readonly ControlResuelto[] } | { ok: false; error: ErrorDeCierre } {
  const { controles, reconocimientos } = entrada;
  if (entrada.huellaVista !== entrada.huellaActual) return { ok: false, error: { codigo: "CONTROLES_CAMBIARON", controles } };
  const porClave = new Map(controles.map((c) => [c.clave, c]));
  for (const r of reconocimientos) {
    const control = porClave.get(r.clave);
    if (control === undefined || !pideReconocimiento(control)) return { ok: false, error: { codigo: "RECONOCIMIENTO_INVALIDO" } };
  }
  const bloquean = controles.filter(impideCerrar).map((c) => c.clave);
  if (bloquean.length > 0) return { ok: false, error: { codigo: "CONTROLES_QUE_BLOQUEAN", claves: bloquean } };
  const reconocidas = new Map(reconocimientos.map((r) => [r.clave, r.texto]));
  const sinReconocer = controles.filter((c) => pideReconocimiento(c) && !reconocidas.has(c.clave)).map((c) => c.clave);
  if (sinReconocer.length > 0) return { ok: false, error: { codigo: "CONTROLES_SIN_RECONOCER", claves: sinReconocer } };
  return { ok: true, valor: controles.map((c) => ({ ...c, reconocido: reconocidas.has(c.clave), texto: reconocidas.get(c.clave) ?? null })) };
}

/**
 * ¿El pedido de cierre repite el que ya cerró la jornada? Sí si trae la misma huella, la misma observación y exactamente los mismos reconocimientos (control y texto) que quedaron guardados: entonces `cerrarJornada` responde
 * `yaEstabaCerrada` sin escribir. Cualquier otra diferencia es otro cierre y recibe `JORNADA_CERRADA`. Previene: un doble clic o un reintento de red que duplique el cierre, y que alguien «cierre otra vez» con otras explicaciones sobre una jornada congelada.
 */
export function repiteElCierre(
  cerrado: Readonly<{ huellaDeCierre: string | null; observacion: string | null; reconocidos: readonly Readonly<{ clave: string; texto: string | null }>[] }>,
  pedido: Readonly<{ huellaVista: string; observacion: string | null; reconocimientos: readonly ReconocimientoPedido[] }>,
): boolean {
  if (cerrado.huellaDeCierre !== pedido.huellaVista) return false;
  if (cerrado.observacion !== pedido.observacion) return false;
  if (cerrado.reconocidos.length !== pedido.reconocimientos.length) return false;
  const guardados = new Map(cerrado.reconocidos.map((r) => [r.clave, r.texto]));
  return pedido.reconocimientos.every((r) => guardados.has(r.clave) && guardados.get(r.clave) === r.texto);
}
