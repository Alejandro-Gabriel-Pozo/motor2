import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { FALTAS_FILTRABLES, whereBusquedaDeProducto, whereDisponibleEn, whereDisponibleEnAlguna, type FaltaFiltrable, type FiltrosDeProductos } from "@/core/catalogo/public";
import { accionesDelMenuQueElUsuarioPuedeVer, obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import { denegacionDeModuloDeAccion } from "@/server/acceso/modulos-de-empresa";
import { cargarOrigenDeStockParaVender } from "@/server/lecturas/movimientos/receta-para-vender";

/**
 * Los filtros de la lista de Productos como `where` de Prisma (Fase 6, bloque 3, 3b). Todo se decide acá, en el servidor, sobre las tablas de la empresa del usuario (la RLS por empresa no se toca) y de
 * su sucursal activa: lo único que viene de afuera son PALABRAS de listas cerradas (`core/catalogo/filtros-de-productos.ts`), nunca un id ni un trozo de consulta. Cada criterio repite, como filtro, el
 * mismo cálculo con el que el espacio del producto marca un pendiente, y un test de DB los cruza producto por producto (`test/catalogo/filtros-de-productos.test.ts`).
 */

/** Lo que estos lectores necesitan del contexto del usuario (el de `requerirVerDeEmpresa`). */
export interface ContextoDeLosFiltros {
  usuarioId: string;
  empresaId: string;
  sucursalId: string;
  db: PrismaClient;
}

/**
 * Qué «le falta algo» puede pedir quien mira. `sin-precio` lo ve cualquiera que abra la lista (el precio es parte del paso 1 y de la ficha); `sin-receta` exige el «Ver» de `guardar_receta` y el módulo
 * Recetas; `fuera-de-la-carta` exige el «Ver» de `carta_ver` en la sucursal activa y el módulo Carta (la misma cuenta del marco del espacio, `cargarMarcoDelEspacio`). Un filtro por algo que no se ve
 * revelaría justo eso: el servidor ignora el que no corresponde, y la pantalla no lo ofrece.
 */
export async function faltasQueSePuedenFiltrar(ctx: ContextoDeLosFiltros): Promise<readonly FaltaFiltrable[]> {
  const [receta, carta, sinRecetas, sinCarta] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db),
    denegacionDeModuloDeAccion("guardar_receta", ctx.empresaId, ctx.db),
    denegacionDeModuloDeAccion("carta_ver", ctx.empresaId, ctx.db),
  ]);
  return FALTAS_FILTRABLES.filter((f) => f === "sin-precio" || (f === "sin-receta" && receta.ver && !sinRecetas) || (f === "fuera-de-la-carta" && carta.ver && !sinCarta));
}

/**
 * Fase 7, Catálogo, M2 (diseño `docs/diseno-modulo-catalogo-2026-10-28.md` I9): ¿puede quien busca encontrar un producto por cómo lo llama un proveedor (`ProveedorPorProducto.referenciaProveedor`)? Solo
 * quien ya ve ese dato en otra pantalla: el «Ver» de `proveedores` (la ficha del proveedor, «En su factura dice») o de `proceso_compra` en la sucursal activa (la compra lo precarga). Cada clave en su contexto,
 * con el mismo cálculo del menú. Sin ninguna de las dos, la búsqueda es por nombre y código, como siempre.
 */
export async function puedeBuscarPorReferenciaDelProveedor(ctx: ContextoDeLosFiltros): Promise<boolean> {
  return (await accionesDelMenuQueElUsuarioPuedeVer(ctx.usuarioId, ctx.empresaId, ctx.sucursalId, ["proveedores", "proceso_compra"], ctx.db)).size > 0;
}

/** Los criterios que no dependen de la receta: la búsqueda (por referencia del proveedor solo si `porReferencia`), el tipo, el modo, la disponibilidad y los dos «le falta» que son una condición de tabla. */
function criteriosDeTabla(ctx: ContextoDeLosFiltros, f: FiltrosDeProductos, faltasPermitidas: readonly FaltaFiltrable[], porReferencia: boolean): Prisma.ProductoWhereInput[] {
  const y: Prisma.ProductoWhereInput[] = [];
  if (f.q !== "") y.push(whereBusquedaDeProducto(f.q, porReferencia));
  switch (f.tipo) {
    case "venta":
      y.push({ tipo: "PV", opcionQueRespalda: { is: null } });
      break;
    case "respaldo":
      y.push({ tipo: "PV", opcionQueRespalda: { isNot: null } });
      break;
    case "materia-prima":
      y.push({ tipo: "MP" });
      break;
    case "se-produce":
      y.push({ tipo: "MP", seProduce: true });
      break;
    case null:
      break;
  }
  if (f.modo === "directo") y.push({ modoDeVenta: "DIRECTO" });
  if (f.modo === "por-opcion") y.push({ modoDeVenta: "BASE_CONFIGURABLE" });
  switch (f.disponible) {
    case "aca":
      y.push(whereDisponibleEn(ctx.sucursalId));
      break;
    case "no-aca":
      y.push({ NOT: whereDisponibleEn(ctx.sucursalId) });
      break;
    case "en-alguna":
      y.push(whereDisponibleEnAlguna());
      break;
    case "en-ninguna":
      y.push({ NOT: whereDisponibleEnAlguna() });
      break;
    case null:
      break;
  }
  if (f.falta && faltasPermitidas.includes(f.falta)) {
    if (f.falta === "sin-precio") y.push({ tipo: "PV", opcionQueRespalda: { is: null }, modoDeVenta: "DIRECTO", precioVenta: { lte: 0 } });
    // El estado «fuera» de la carta (`estadoDelProductoEnLaCarta`): un producto de venta (no el de respaldo) disponible acá, sin contenido de carta y sin grupo en esta sucursal.
    if (f.falta === "fuera-de-la-carta") {
      y.push({ tipo: "PV", opcionQueRespalda: { is: null }, ...whereDisponibleEn(ctx.sucursalId) });
      y.push({ contenidosCarta: { none: whereCartaDeSucursal(ctx.sucursalId) }, opcionesItemAgrupadoCarta: { none: whereCartaDeSucursal(ctx.sucursalId) } });
    }
  }
  return y;
}

/**
 * Los ids de los productos a los que les falta la receta, entre los que cumplen el resto de los criterios: un producto de venta que no se produce ni respalda un adicional y no tiene ingredientes en su
 * receta vigente de la sucursal (la regla «sin receta no se vende», `rechazoSinOrigenDeStock`), y una materia prima que se produce sin ingredientes. La receta vigente la resuelve el lector de la venta
 * (`cargarOrigenDeStockParaVender`: la propia de la sucursal si la habilitó, si no la central), no una consulta nueva.
 */
async function idsSinReceta(db: PrismaClient, sucursalId: string, y: Prisma.ProductoWhereInput[]): Promise<string[]> {
  const candidatos = await db.producto.findMany({
    where: { AND: [...y, { OR: [{ tipo: "PV", seProduce: false, opcionQueRespalda: { is: null } }, { tipo: "MP", seProduce: true }] }] },
    select: { id: true },
  });
  const origen = await cargarOrigenDeStockParaVender(db, { sucursalId, productoIds: candidatos.map((c) => c.id) });
  return candidatos.filter((c) => (origen.get(c.id)?.ingredientesDeLaRecetaVigente ?? 0) === 0).map((c) => c.id);
}

/**
 * El `where` de la lista con los filtros ya validados. `db` es la base con la que va a correr la lista (la del usuario, o la de verificación si `necesitaLaEmpresaEntera`): con ella se calculan también los
 * ids de «sin receta». Un filtro de «le falta» que el usuario no puede ver (`faltasQueSePuedenFiltrar`) no suma ningún criterio.
 */
export async function whereDeLosProductos(ctx: ContextoDeLosFiltros, db: PrismaClient, f: FiltrosDeProductos): Promise<Prisma.ProductoWhereInput> {
  const [permitidas, porReferencia] = await Promise.all([faltasQueSePuedenFiltrar(ctx), f.q !== "" ? puedeBuscarPorReferenciaDelProveedor(ctx) : false]);
  const y = criteriosDeTabla(ctx, f, permitidas, porReferencia);
  if (f.falta === "sin-receta" && permitidas.includes("sin-receta")) y.push({ id: { in: await idsSinReceta(db, ctx.sucursalId, y) } });
  return y.length ? { AND: y } : {};
}
