import { IMPORTE_MINIMO, type DiferenciaDePrecio, type ModoDePrecioDeMedida, type ModoDeVenta, type TipoDeGrupoDeOpciones } from "./tipos";

/**
 * El MODO DE VENTA de un producto (Fase 4 de la ola «precio y carta», ADR-035; `Producto.modoDeVenta`). Puro: sin Prisma.
 *
 * Un producto DIRECTO tiene su precio (`precioVenta`). Uno BASE_CONFIGURABLE («se vende por opción») tiene el precio final de cada configuración en su grupo de medida en ABSOLUTO: el precio guardado
 * se conserva pero no se cobra ni se edita. Para que «no se cobra» sea literal, una base:
 *  - es un producto de VENTA que no se produce (el CHECK `Producto_modoDeVenta_base_check` lo repite en la base), no es de consignación (decisión del dueño), no respalda un adicional y no está en un ítem
 *    agrupado de la carta (ese ítem usa el precio guardado de cada producto);
 *  - tiene AL MENOS UN grupo de precio: una admisión activa de un grupo MEDIDA activo en ABSOLUTO, con al menos una opción ofrecida y TODAS las ofrecidas con precio final (0,01 o más). La medida en
 *    ABSOLUTO reemplaza al precio base en la composición (`componerPrecioDeLinea`): es el único camino al precio final desde que se retiró el eje de combinación (GO-3a);
 *  - no tiene diferencias en PORCENTAJE en lo que admite: un porcentaje se calcula sobre el precio base, o sea sobre el valor guardado (solo cuentan las de las opciones que no son el precio final).
 */

/** Si el modo guardado (TEXT de lista cerrada en la base) es «se vende por opción». Cualquier otro valor es DIRECTO: el CHECK de la base no deja guardar otro. */
export function esBaseConfigurable(modo: ModoDeVenta | string): boolean {
  return modo === "BASE_CONFIGURABLE";
}

/** El rechazo base: no hay grupo de precio final. */
export const MENSAJE_FALTA_PRECIO_FINAL =
  "Falta el precio final de cada opción: asigná un grupo de medida con precio propio (por ejemplo «Tipos de Pizza») antes de venderlo por opción.";

/** Lo que la regla mira del producto. */
export interface ProductoParaSerBase {
  nombre: string;
  tipo: "MP" | "PV";
  seProduce: boolean;
  esConsignacion: boolean;
  esAnclaDeAdicional: boolean;
  /** El nombre de un ítem agrupado de la carta en que está (en cualquier sucursal), o `null`. */
  itemAgrupado: string | null;
}

/** Una opción del grupo tal como la admite el producto. */
export interface OpcionAdmitidaParaSerBase {
  nombre: string;
  /** Prendida para toda la empresa. */
  activa: boolean;
  /** La fila del producto existe y está activa. */
  admitida: boolean;
  esNinguna: boolean;
  precioAbsoluto: number | null;
  /** La diferencia que rige: la del producto si la sobrescribe, si no la de la versión vigente (`null` = ninguna). */
  diferencia: DiferenciaDePrecio | null;
}

/** Un grupo que el producto tiene asignado (activo o no en el producto). */
export interface AdmisionParaSerBase {
  grupo: { nombre: string; tipo: TipoDeGrupoDeOpciones; activo: boolean };
  /** La fila de `ProductoAdmiteGrupo` está activa (el grupo no se quitó del producto). */
  activa: boolean;
  modoPrecio: ModoDePrecioDeMedida | null;
  opciones: readonly OpcionAdmitidaParaSerBase[];
}

const ofrecidas = (a: AdmisionParaSerBase) => a.opciones.filter((o) => o.activa && o.admitida);
const vigente = (a: AdmisionParaSerBase) => a.activa && a.grupo.activo;
const esGrupoDePrecio = (a: AdmisionParaSerBase) => vigente(a) && a.grupo.tipo === "MEDIDA" && a.modoPrecio === "ABSOLUTO";
const conPrecioFinal = (o: OpcionAdmitidaParaSerBase) => o.precioAbsoluto !== null && Number.isFinite(o.precioAbsoluto) && o.precioAbsoluto >= IMPORTE_MINIMO;
const lista = (nombres: readonly string[]) => (nombres.length === 1 ? `«${nombres[0]}»` : `${nombres.slice(0, -1).map((n) => `«${n}»`).join(", ")} y «${nombres.at(-1)}»`);

/**
 * Lo que una base exige de lo que ADMITE (lo vigila cada escritor de opciones mientras el producto es base): al menos un grupo de precio con todas sus opciones con precio final, y ningún porcentaje.
 * Devuelve el motivo (para el mensaje) o `null` si se cumple.
 */
export function rechazoDeAdmisionesDeBase(admisiones: readonly AdmisionParaSerBase[]): string | null {
  for (const a of admisiones) {
    if (!vigente(a) || esGrupoDePrecio(a)) continue;
    const conPorcentaje = ofrecidas(a).filter((o) => !o.esNinguna && o.diferencia?.tipo === "PORCENTAJE");
    if (conPorcentaje.length) {
      return `${lista(conPorcentaje.map((o) => o.nombre))} de «${a.grupo.nombre}» ${conPorcentaje.length === 1 ? "tiene" : "tienen"} una diferencia en porcentaje, que se calcula sobre el precio guardado: un producto que se vende por opción solo admite diferencias en monto fijo. Cambiala a un monto antes.`;
    }
  }
  const deMedida = admisiones.filter(esGrupoDePrecio);
  if (deMedida.some((a) => ofrecidas(a).length > 0 && ofrecidas(a).every(conPrecioFinal))) return null;
  const incompleto = deMedida.find((a) => ofrecidas(a).some((o) => !conPrecioFinal(o)));
  if (incompleto) {
    const faltan = ofrecidas(incompleto).filter((o) => !conPrecioFinal(o)).map((o) => o.nombre);
    return `Falta el precio final de cada opción: ${lista(faltan)} de «${incompleto.grupo.nombre}» ${faltan.length === 1 ? "no tiene" : "no tienen"} precio propio.`;
  }
  const vacio = deMedida.find((a) => ofrecidas(a).length === 0);
  if (vacio) return `Falta el precio final de cada opción: «${vacio.grupo.nombre}» no tiene ninguna opción admitida.`;
  return MENSAJE_FALTA_PRECIO_FINAL;
}

/** Lo que una base exige del PRODUCTO mismo (sin mirar lo que admite): lo vigila también la edición de un producto que ya es base (no se le puede tildar «se produce» ni «es consignación»). */
export function rechazoDelProductoComoBase(producto: ProductoParaSerBase): string | null {
  const p = `«${producto.nombre}»`;
  if (producto.tipo !== "PV") return `${p} no es un producto de venta: solo un producto de venta se vende por opción.`;
  if (producto.seProduce) return `${p} se vende por opción y un producto así no se produce (no tiene stock propio): destildá «se produce», o cambiá antes «¿Cómo se vende?» a Directo.`;
  if (producto.esConsignacion) return `${p} se vende por opción y un producto así no puede ser de consignación: destildá «es consignación», o cambiá antes «¿Cómo se vende?» a Directo.`;
  if (producto.esAnclaDeAdicional) return `${p} es el producto de respaldo de un adicional: no se vende por opción.`;
  if (producto.itemAgrupado !== null) return `${p} está en el ítem agrupado «${producto.itemAgrupado}» de la carta, que usa su precio guardado: sacalo de ahí antes de venderlo por opción.`;
  return null;
}

/** Todo lo que exige pasar un producto a «se vende por opción» (el producto y lo que admite). Devuelve el motivo o `null`. */
export function rechazoDeBaseConfigurable(producto: ProductoParaSerBase, admisiones: readonly AdmisionParaSerBase[]): string | null {
  return rechazoDelProductoComoBase(producto) ?? rechazoDeAdmisionesDeBase(admisiones);
}

/**
 * El precio de referencia de una base para el control de precio de lista de una admisión (`controlarPrecioDeLista`): el precio final más barato de sus grupos de precio (el de la empresa; la grilla
 * de cada sucursal la aplica la venta, que igual falla cerrado). `null` si no tiene.
 */
export function precioDeReferenciaDeAdmisiones(admisiones: readonly AdmisionParaSerBase[]): number | null {
  const precios = admisiones.filter(esGrupoDePrecio).flatMap((a) => ofrecidas(a).filter(conPrecioFinal).map((o) => o.precioAbsoluto as number));
  return precios.length ? Math.min(...precios) : null;
}
