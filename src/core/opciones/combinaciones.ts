import type { EntradaDePrecioDeLinea, OpcionParaPrecio } from "./componer-precio-de-linea";
import { IMPORTE_MINIMO, type TipoDeGrupoDeOpciones } from "./tipos";

/**
 * PRECIO POR COMBINACIÓN (GO-3, ADR-032, frente A). Función pura: sin base, sin reloj; dinero en `number` de 2 decimales validado (nunca se suma ni se redondea acá: el precio de la
 * combinación entra TAL CUAL a `componerPrecioDeLinea`, que hace la cuenta exacta con `core/moneda`).
 *
 * Un producto declara a lo sumo DOS grupos como EJES de sus combinaciones (`ProductoAdmiteGrupo.ejeDeCombinacion` 1 y 2). Una `CombinacionDeProducto` es una SOBRESCRITURA DISPERSA
 * de un par de opciones de esos ejes (eje 1 y, si hay, eje 2): sin fila rige el precio ADITIVO de GO-1 exactamente como hoy; con `activa = false` esa combinación no se vende; con
 * precio propio o grupo de precio, rige ese precio. Nunca se generan todas las combinaciones (no hay carrera de generación).
 *
 * Precedencia (§2 del diseño):
 *  1. la combinación inactiva rechaza la venta (`COMBINACION_NO_DISPONIBLE`);
 *  2. el precio LOCAL de la sucursal: el de la combinación o, si la combinación usa un grupo, el del grupo;
 *  3. el precio propio de la combinación, o el precio del grupo;
 *  4. sin precio propio ni grupo (ni precio local): ADITIVO, exactamente como hoy.
 *
 * Con un precio P, `componerPrecioDeLinea` NO se toca: se le pasa una entrada transformada (`entradaConPrecioDeCombinacion`) con `precioBase := P`, la MEDIDA del eje (si hay) en
 * `ABSOLUTO` con precio P y las VARIANTE de los ejes sin diferencia (importe 0). Así la lista queda en P más lo que sumen las opciones que NO son eje (sus porcentajes, sobre P), y la
 * foto de cada opción queda dentro de los CHECK de `OpcionElegidaEnLinea` (la MEDIDA dice «ABSOLUTO P», que es literalmente su precio en esa combinación). De dónde salió P queda en
 * la otra foto, `CombinacionEnLinea`.
 */

/** De dónde salió el precio de una combinación vendida: el espejo del CHECK `CombinacionEnLinea_origen_precio_chk` (lo comparan `test/persistencia/migracion-go3a.test.ts` y el test de este archivo). */
export const ORIGENES_DE_PRECIO_DE_COMBINACION = ["ADITIVO", "PROPIO", "GRUPO"] as const;

/** Cuántos ejes puede tener un producto. */
const EJES_MAXIMOS = 2;

/** Un grupo que el producto admite, visto para decidir sus ejes: los límites EFECTIVOS (los del producto si los sobrescribe, si no los del grupo). */
export interface GrupoParaEjes {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  /** 1, 2 o `null` (no es eje). */
  eje: number | null;
}

export type ResultadoDeEjes = { ok: true; ejes: { eje1: string | null; eje2: string | null } } | { ok: false; codigo: "EJES_INVALIDOS"; mensaje: string };

/**
 * ¿Los ejes declarados son válidos? A lo sumo dos (números 1 y 2, sin repetir; el 2 solo si hay 1), cada uno de un grupo MEDIDA o VARIANTE que elige EXACTAMENTE una opción
 * (mínimo = máximo = 1: así toda línea tiene una opción por eje) y a lo sumo una MEDIDA entre ellos. Devuelve el grupo de cada eje.
 */
export function validarEjesDeCombinacion(grupos: readonly GrupoParaEjes[]): ResultadoDeEjes {
  const mal = (mensaje: string): ResultadoDeEjes => ({ ok: false, codigo: "EJES_INVALIDOS", mensaje });
  const conEje = grupos.filter((g) => g.eje !== null);
  if (conEje.length > EJES_MAXIMOS) return mal(`Un producto tiene a lo sumo ${EJES_MAXIMOS} ejes de combinación.`);
  const porEje = new Map<number, GrupoParaEjes>();
  for (const g of conEje) {
    if (g.eje !== 1 && g.eje !== 2) return mal(`El eje de «${g.nombre}» tiene que ser 1 o 2.`);
    if (porEje.has(g.eje)) return mal(`Dos grupos no pueden ser el mismo eje (${g.eje}).`);
    porEje.set(g.eje, g);
    if (g.tipo !== "MEDIDA" && g.tipo !== "VARIANTE") return mal(`«${g.nombre}» no puede ser un eje: solo un tamaño o una variante.`);
    if (g.cantidadMinima !== 1 || g.cantidadMaxima !== 1) return mal(`«${g.nombre}» no puede ser un eje: tiene que elegirse siempre exactamente una opción (mínimo 1 y máximo 1).`);
  }
  if (porEje.has(2) && !porEje.has(1)) return mal("Para tener un eje 2 hace falta el eje 1.");
  if (conEje.filter((g) => g.tipo === "MEDIDA").length > 1) return mal("A lo sumo uno de los ejes puede ser un tamaño.");
  return { ok: true, ejes: { eje1: porEje.get(1)?.grupoId ?? null, eje2: porEje.get(2)?.grupoId ?? null } };
}

/** Una opción elegida, vista para encontrar la combinación: su grupo y si es la «ninguna» (que no participa de las combinaciones). */
export interface OpcionElegidaParaCombinacion {
  opcionId: string;
  grupoId: string;
  esNinguna: boolean;
}

/**
 * La identidad de la combinación de una línea: la opción elegida del grupo del eje 1 y la del eje 2 (si hay eje 2). `null` si el producto no tiene ejes, si falta la opción de
 * algún eje o si alguna es la «ninguna»: en esos casos no hay combinación y rige el precio aditivo.
 */
export function identidadDeCombinacion(
  ejes: { eje1: string | null; eje2: string | null },
  elegidas: readonly OpcionElegidaParaCombinacion[],
): { opcionEje1Id: string; opcionEje2Id: string | null } | null {
  if (ejes.eje1 === null) return null;
  const de = (grupoId: string) => elegidas.filter((o) => o.grupoId === grupoId);
  const uno = de(ejes.eje1);
  if (uno.length !== 1 || uno[0]!.esNinguna) return null;
  if (ejes.eje2 === null) return { opcionEje1Id: uno[0]!.opcionId, opcionEje2Id: null };
  const dos = de(ejes.eje2);
  if (dos.length !== 1 || dos[0]!.esNinguna) return null;
  return { opcionEje1Id: uno[0]!.opcionId, opcionEje2Id: dos[0]!.opcionId };
}

/** GO-3b: la clave con que se indexan las combinaciones de un producto (las opciones de sus ejes): eje 1 y eje 2 (vacío sin eje 2). Estable: no depende de versiones ni de precios. */
export function claveDeCombinacion(identidad: { opcionEje1Id: string; opcionEje2Id: string | null }): string {
  return `${identidad.opcionEje1Id}|${identidad.opcionEje2Id ?? ""}`;
}

/** La fila de la combinación vendida (si existe), con su grupo de precio ya leído. */
export interface CombinacionParaPrecio {
  combinacionId: string;
  activa: boolean;
  /** El precio propio (>= 0,01) o `null`. */
  precio: number | null;
  /** El grupo de precio (la tarifa compartida) o `null`. No pueden estar los dos (CHECK). */
  grupo: { grupoDePrecioId: string; nombre: string; precio: number; activo: boolean } | null;
}

/** Los precios de la sucursal que rigen hoy (habilitados y con la capacidad `precio_local` prendida: lo resuelve la lectura del embudo). */
export interface PreciosLocalesDeCombinacion {
  /** El de la combinación, o `null`. */
  deLaCombinacion: number | null;
  /** El del grupo de la combinación, o `null`. */
  delGrupo: number | null;
}

export type PrecioDeCombinacion =
  | { ok: true; origen: "SIN_COMBINACION" }
  | { ok: true; origen: "ADITIVO"; combinacionId: string }
  | { ok: true; origen: "PROPIO"; combinacionId: string; precio: number; precioDeSucursal: boolean }
  | { ok: true; origen: "GRUPO"; combinacionId: string; precio: number; precioDeSucursal: boolean; grupoDePrecioId: string; nombreGrupoDePrecio: string }
  | { ok: false; codigo: "COMBINACION_NO_DISPONIBLE" | "PRECIO_DE_COMBINACION_INVALIDO"; mensaje: string };

/** Un precio de lista válido: finito, de 2 decimales a lo sumo y de 0,01 o más (el CHECK de las tres tablas de precio). */
function esPrecioValido(n: number): boolean {
  return Number.isFinite(n) && n >= IMPORTE_MINIMO && n < 1e12 && Number(n.toFixed(2)) === n;
}

/**
 * El precio de la combinación vendida, por la precedencia de arriba. Sin fila (`null`): `SIN_COMBINACION` (rige el aditivo y no hay foto). Una combinación con un grupo inactivo
 * (no debería pasar: no se desactiva un grupo con miembros) falla cerrado como no disponible. Un precio que no cumple el CHECK falla cerrado (`PRECIO_DE_COMBINACION_INVALIDO`).
 */
export function resolverPrecioDeCombinacion(combinacion: CombinacionParaPrecio | null, locales: PreciosLocalesDeCombinacion, nombreDelProducto: string): PrecioDeCombinacion {
  if (combinacion === null) return { ok: true, origen: "SIN_COMBINACION" };
  const noDisponible: PrecioDeCombinacion = { ok: false, codigo: "COMBINACION_NO_DISPONIBLE", mensaje: `Esa combinación de «${nombreDelProducto}» no está disponible.` };
  if (!combinacion.activa) return noDisponible;
  const invalido = (): PrecioDeCombinacion => ({ ok: false, codigo: "PRECIO_DE_COMBINACION_INVALIDO", mensaje: `El precio de esa combinación de «${nombreDelProducto}» no es válido.` });
  const { combinacionId, grupo } = combinacion;
  if (grupo !== null) {
    if (combinacion.precio !== null) return invalido(); // CHECK `CombinacionDeProducto_precio_o_grupo_chk`: nunca los dos
    if (!grupo.activo) return noDisponible;
    const local = locales.delGrupo;
    const precio = local ?? grupo.precio;
    if (!esPrecioValido(precio)) return invalido();
    return { ok: true, origen: "GRUPO", combinacionId, precio, precioDeSucursal: local !== null, grupoDePrecioId: grupo.grupoDePrecioId, nombreGrupoDePrecio: grupo.nombre };
  }
  const local = locales.deLaCombinacion;
  if (local !== null) return esPrecioValido(local) ? { ok: true, origen: "PROPIO", combinacionId, precio: local, precioDeSucursal: true } : invalido();
  if (combinacion.precio !== null) return esPrecioValido(combinacion.precio) ? { ok: true, origen: "PROPIO", combinacionId, precio: combinacion.precio, precioDeSucursal: false } : invalido();
  return { ok: true, origen: "ADITIVO", combinacionId };
}

/**
 * La entrada de `componerPrecioDeLinea` con el precio P de la combinación (ver arriba). Sin precio (origen `SIN_COMBINACION` o `ADITIVO`) devuelve LA MISMA entrada (el mismo objeto):
 * paridad exacta con el precio aditivo de hoy. `opcionesDeEjes` son los ids de las opciones elegidas que son eje (las de `identidadDeCombinacion`). Las demás opciones no se tocan.
 */
export function entradaConPrecioDeCombinacion(entrada: EntradaDePrecioDeLinea, precio: PrecioDeCombinacion, opcionesDeEjes: readonly string[]): EntradaDePrecioDeLinea {
  if (!precio.ok || precio.origen === "SIN_COMBINACION" || precio.origen === "ADITIVO") return entrada;
  const P = precio.precio;
  const ejes = new Set(opcionesDeEjes);
  const opciones = entrada.opciones.map((op): OpcionParaPrecio => {
    if (!ejes.has(op.opcionId)) return op;
    if (op.tipo === "MEDIDA") return { ...op, modoPrecio: "ABSOLUTO", precioAbsoluto: P, diferencia: null, precioDeSucursal: false };
    return { ...op, diferencia: null, precioDeSucursal: false };
  });
  return { ...entrada, precioBase: P, opciones };
}
