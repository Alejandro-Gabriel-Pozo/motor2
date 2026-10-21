import "server-only";
import type { PrismaClient } from "@prisma/client";
import { pasosDelEspacio, pendientesDelProducto, type AccesoAlEspacio, type PasoDeLaPortada } from "@/core/catalogo/public";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa } from "@/server/acceso/gate";
import { denegacionDeModuloDeAccion } from "@/server/acceso/modulos-de-empresa";
import { disponibilidadPorSucursalDeProducto } from "@/server/consultas/catalogo/disponibilidad";
import { hechosDelProducto, type ProductoDelEspacio } from "@/server/consultas/catalogo/espacio-del-producto";
import type { OpcionesDelProductoDelPanel } from "@/server/consultas/catalogo/opciones-de-venta";

/**
 * Lo que el marco del espacio del producto necesita del servidor (Fase 6, 6.12): los pasos del producto con su enlace (o sin él) y su estado, y si el producto está disponible en la sucursal activa.
 *
 * Quién puede abrir cada paso se calcula acá, en el servidor, con el permiso de la pantalla de ese paso (no con `EnlaceInterno`, que solo conoce los «Ver» y no entiende las rutas con id):
 *  - paso 1, los datos: «Editar» de `producto_editar` (la pantalla lo exige);
 *  - paso 2, opciones y precio: «Editar» de `producto_opciones_admitidas` (idem);
 *  - paso 3, la receta: «Ver» de `guardar_receta` (la pantalla de la receta pide Ver); sin el módulo Recetas el paso NO aparece;
 *  - paso 4, en la carta: «Ver» de `carta_ver` (de la sucursal activa); sin el módulo Carta el paso NO aparece.
 * De un paso que no puede abrir NO se lee nada (`hechosDelProducto` solo lee lo permitido), y `pasosDelEspacio` lo marca sin enlace y sin dato. Es cortesía de la interfaz: cada pantalla vuelve a exigir su permiso.
 */
export interface MarcoCargado {
  pasos: PasoDeLaPortada[];
  /** El producto está disponible en la sucursal activa (la insignia de la cabecera). */
  disponibleAca: boolean;
}

interface ContextoDelMarco {
  usuarioId: string;
  empresaId: string;
  sucursalId: string;
  db: PrismaClient;
}

/** Lo que la pantalla ya leyó y el marco no tiene que volver a leer. */
export interface PrecargadoDelMarco {
  opciones?: OpcionesDelProductoDelPanel | null;
  disponibleAca?: boolean;
}

export async function cargarMarcoDelEspacio(ctx: ContextoDelMarco, producto: ProductoDelEspacio, precargado: PrecargadoDelMarco = {}): Promise<MarcoCargado> {
  const [datos, opciones, receta, carta, sinRecetas, sinCarta, disponibleAca] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_editar", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "producto_opciones_admitidas", ctx.db),
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "guardar_receta", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db),
    denegacionDeModuloDeAccion("guardar_receta", ctx.empresaId, ctx.db),
    denegacionDeModuloDeAccion("carta_ver", ctx.empresaId, ctx.db),
    precargado.disponibleAca !== undefined ? Promise.resolve(precargado.disponibleAca) : disponibilidadPorSucursalDeProducto(producto.id, ctx.db).then((filas) => filas.find((f) => f.sucursalId === ctx.sucursalId)?.disponible ?? false),
  ]);
  const acceso: AccesoAlEspacio = {
    datos: datos.editar,
    opciones: opciones.editar,
    receta: sinRecetas ? "sin-modulo" : receta.ver ? "si" : "sin-permiso",
    carta: sinCarta ? "sin-modulo" : carta.ver ? "si" : "sin-permiso",
  };
  const hechos = await hechosDelProducto(ctx.db, producto, ctx.sucursalId, { opciones: acceso.opciones, receta: acceso.receta === "si", carta: acceso.carta === "si" }, { opciones: precargado.opciones });
  const pasos = pasosDelEspacio(producto.id, producto, acceso, pendientesDelProducto(hechos));
  return { pasos, disponibleAca };
}
