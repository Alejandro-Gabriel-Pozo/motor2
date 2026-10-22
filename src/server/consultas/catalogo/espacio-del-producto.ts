import "server-only";
import { rechazoSinOrigenDeStock } from "@/core/movimientos/public";
import type { HechosDelProducto } from "@/core/catalogo/public";
import type { Db } from "@/lib/db-tipos";
import { estadoDelProductoEnLaCarta } from "@/server/consultas/carta/admin";
import { cargarOpcionesDelProducto, type OpcionesDelProductoDelPanel } from "@/server/consultas/catalogo/opciones-de-venta";
import { cargarOrigenDeStockParaVender } from "@/server/lecturas/movimientos/receta-para-vender";

/**
 * Las lecturas del ESPACIO DEL PRODUCTO (Fase 6, 6.12; DEC-12): lo que hace falta saber de UN producto para dibujar su marco (la cabecera y la tira de pasos con lo que le falta a cada uno). Solo las piden las
 * pantallas del espacio, así que es una consulta. Sin guarda de permiso adentro (la página la pone antes), PERO con la privacidad del paso en la firma: `permitidas` dice qué pasos puede abrir quien mira y
 * de un paso que no puede abrir NO se lee nada (ni la receta, ni la carta, ni los precios de las opciones): la portada no revela datos de una pantalla que el usuario no ve.
 */

/** Lo básico de un producto que decide qué pasos tiene (su tipo y dos banderas) y lo que el marco muestra de él. */
export interface ProductoDelEspacio {
  id: string;
  nombre: string;
  codigo: string;
  tipo: "PV" | "MP";
  modoDeVenta: "DIRECTO" | "BASE_CONFIGURABLE";
  precioVenta: number;
  /** Solo una materia prima con `seProduce` tiene receta propia. */
  seProduce: boolean;
  /** El producto interno que respalda el stock de un adicional (ADR-030): no se maneja con los pasos de venta. */
  esAnclaDeAdicional: boolean;
}

/** Lo básico de UN producto, o `null` si no existe o es de otra empresa (la RLS no lo deja ver). Una sola fila. */
export async function leerProductoDelEspacio(db: Db, productoId: string): Promise<ProductoDelEspacio | null> {
  const p = await db.producto.findFirst({
    where: { id: productoId },
    select: { id: true, nombre: true, codigo: true, tipo: true, modoDeVenta: true, precioVenta: true, seProduce: true, opcionQueRespalda: { select: { id: true } } },
  });
  if (!p) return null;
  return {
    id: p.id,
    nombre: p.nombre,
    codigo: p.codigo,
    tipo: p.tipo,
    modoDeVenta: p.modoDeVenta === "BASE_CONFIGURABLE" ? "BASE_CONFIGURABLE" : "DIRECTO",
    precioVenta: Number(p.precioVenta),
    seProduce: p.seProduce,
    esAnclaDeAdicional: p.opcionQueRespalda !== null,
  };
}

/** Qué pasos puede abrir quien mira: solo de esos se calcula el pendiente. El paso 1 (los datos) no lee nada más que lo básico del producto. */
export interface LecturasPermitidas {
  opciones: boolean;
  receta: boolean;
  carta: boolean;
}

/**
 * El texto del pendiente de la receta de una materia prima que se produce y todavía no tiene ingredientes: no se puede producir. (Un producto de venta sigue la regla «sin receta no se vende»,
 * `rechazoSinOrigenDeStock`, la misma del POS.)
 */
function rechazoDeUnaMateriaPrimaSinReceta(nombre: string): string {
  return `«${nombre}» se produce y todavía no tiene receta: armala en Catálogo → Recetas para poder producirla.`;
}

/** Por qué la receta del producto falta, o `null` si está. Lee la receta VIGENTE en la sucursal (la propia si la tiene habilitada, si no la central): la misma resolución que la venta. */
async function rechazoDeLaReceta(db: Db, producto: ProductoDelEspacio, sucursalId: string): Promise<string | null> {
  const origen = (await cargarOrigenDeStockParaVender(db, { sucursalId, productoIds: [producto.id] })).get(producto.id);
  const ingredientes = origen?.ingredientesDeLaRecetaVigente ?? 0;
  if (producto.tipo === "MP") return ingredientes > 0 ? null : rechazoDeUnaMateriaPrimaSinReceta(producto.nombre);
  return rechazoSinOrigenDeStock({ nombre: producto.nombre, seProduce: producto.seProduce, esAnclaDeAdicional: producto.esAnclaDeAdicional, ingredientesDeLaRecetaVigente: ingredientes });
}

/**
 * Los hechos de UN producto para calcular sus pendientes (`pendientesDelProducto`), leyendo SOLO los pasos de `permitidas` que además le corresponden por su tipo:
 *  - opciones (un PV que no es de respaldo): si hoy se puede vender en la sucursal (`vistaPrevia.vendible`, la regla de la venta). `precargado.opciones` evita leerlas otra vez cuando la pantalla ya las tiene;
 *  - receta (un PV, o una materia prima que se produce): por qué falta (la regla «sin receta no se vende» en un PV);
 *  - carta (un PV que no es de respaldo): cómo está en la carta de la sucursal (`estadoDelProductoEnLaCarta`).
 * Lo que no se lee queda en `null` (= «sin dato»: el usuario no ve esa pantalla, o el paso no corresponde al tipo).
 */
export async function hechosDelProducto(
  db: Db,
  producto: ProductoDelEspacio,
  sucursalId: string,
  permitidas: LecturasPermitidas,
  precargado: { opciones?: OpcionesDelProductoDelPanel | null } = {}
): Promise<HechosDelProducto> {
  const esDeVenta = producto.tipo === "PV" && !producto.esAnclaDeAdicional;
  const conReceta = permitidas.receta && !producto.esAnclaDeAdicional && (producto.tipo === "PV" || producto.seProduce);
  const [opciones, rechazo, carta] = await Promise.all([
    esDeVenta && permitidas.opciones ? (precargado.opciones !== undefined ? Promise.resolve(precargado.opciones) : cargarOpcionesDelProducto(db, producto.id, sucursalId)) : Promise.resolve(undefined),
    conReceta ? rechazoDeLaReceta(db, producto, sucursalId) : Promise.resolve(undefined),
    esDeVenta && permitidas.carta ? estadoDelProductoEnLaCarta(db, sucursalId, producto.id) : Promise.resolve(undefined),
  ]);
  return {
    tipo: producto.tipo,
    seProduce: producto.seProduce,
    esAnclaDeAdicional: producto.esAnclaDeAdicional,
    modoDeVenta: producto.modoDeVenta,
    precioDeVenta: producto.precioVenta,
    // `null` en el panel = el producto no se encontró: tampoco se puede vender.
    opciones: opciones === undefined ? null : { vendibleAca: opciones?.vistaPrevia.vendible ?? false },
    receta: rechazo === undefined ? null : { rechazo },
    carta: carta === undefined ? null : { estado: carta },
  };
}
