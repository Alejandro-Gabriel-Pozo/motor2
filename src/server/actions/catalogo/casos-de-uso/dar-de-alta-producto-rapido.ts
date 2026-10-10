import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public";
import { crearConCodigoAutogenerado, esErrorDeUnicidad } from "@/core/catalogo/public-servidor";
import { rechazoDeReferenciaDeProducto } from "@/core/features/catalogo/referencias-de-producto";
import type { ComandoDarDeAltaProductoRapido, ResultadoDarDeAltaProducto } from "@/core/features/catalogo/productos.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { conEscrituraEnLaEmpresa } from "@/server/acceso/alcance";
import { crearProductoNuevo, sembrarDisponibilidadDeProductoNuevo } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «alta rápida inline de una MP nueva, sin salir del wizard de Compra por proveedor» (docs/plan-migracion.md §4 — refinamiento de UX; Hito 4 de la
 * pureza, bloque 4.3, paso H4C-12 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `darDeAltaProductoRapido`
 * (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: solo nombre + unidad de stock — categoría/insumo/unidad de compra alternativa quedan para completar
 * después en el catálogo si hace falta, no bloquean la compra de HOY. `factorConversion: 1` (compra y stock en la misma unidad), mismo default que usa el form
 * completo cuando no se toca ese campo. Un producto DISPONIBLE con el mismo nombre se rechaza; el código se autogenera (`MP_…`) con reintento ante un choque, el
 * producto se crea con la base del contexto SIN transacción (el reintento atrapa el P2002 del INSERT: dentro de una transacción interactiva de Postgres el
 * primer INSERT fallido abortaría la transacción entera) y DESPUÉS se siembra su disponibilidad: sin formulario donde poner el tilde de §4.1, sigue su mismo
 * default — activo en todas las sucursales que existen hoy. La Server Action quedó como adaptador (`conPermisoDeEmpresa("alta_producto")` →
 * `guardComandoDarDeAltaProductoRapido` → este caso de uso, con la fuente de azar del proceso → `aResultadoAccion` y el id y el nombre para su `ResultadoConId`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato (el guard). No lee el azar por su cuenta: lo recibe
 * (`azar`, para el código autogenerado; precedente: `agregar-o-actualizar-usuario.ts`).
 *
 * @contract Crea la MP con un código único y la deja disponible en todas las sucursales, salvo que ya haya un producto disponible con ese nombre; devuelve su id y su nombre.
 * @idempotency Por estado — repetir el pedido encuentra el producto ya disponible con ese nombre y se rechaza: no crea otro.
 * @transaction Ninguna, a propósito: el reintento del código autogenerado necesita que el INSERT fallido no aborte nada; la disponibilidad va después, con `actor.db`.
 * @sideEffects Ninguno (el alta no se audita: excepciones `crearProductoNuevo` y `sembrarDisponibilidadDeProductoNuevo` de escrituras-auditadas).
 * @ficha permiso=alta_producto transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function darDeAltaProductoRapidoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "empresaId" | "alcance">,
  comando: ComandoDarDeAltaProductoRapido,
  azar: FuenteDeAzar,
): Promise<ResultadoDarDeAltaProducto> {
  const { nombre: n, unidadStockId } = comando;
  const dup = await actor.db.producto.findFirst({ where: { ...whereDisponibleEnAlguna(), nombre: { equals: n, mode: "insensitive" } } });
  if (dup) return fracaso("YA_EXISTE", `Ya existe un producto disponible llamado "${n}".`);

  try {
    const producto = await crearConCodigoAutogenerado(
      "MP",
      undefined,
      (codigo) => crearProductoNuevo(actor.db, { codigo, tipo: "MP", campos: { nombre: n, unidadStockId, factorConversion: 1 } }),
      azar,
    );
    // Sin formulario donde poner el tilde de §4.1 — sigue su mismo default: activo en todas las sucursales que existen hoy.
    // M.3-A6: sembrar en todas es una escritura de EMPRESA ENTERA (`EMPRESA_ENTERA` de GT-4): se ensancha a la lista cerrada de las sucursales de la empresa, que es la que ya se leía acá.
    const enLaEmpresa = await conEscrituraEnLaEmpresa(actor);
    const sucursalIds = [...enLaEmpresa.sucursalIdsDeLaEmpresa];
    // Siempre una MP (no se vende: el POS solo pide PV), así que no hay precio que proteger y nace disponible (M.2-A4: el PV sin `producto_campos_sensibles` es el que nace apagado, en `dar-de-alta-producto.ts`).
    await sembrarDisponibilidadDeProductoNuevo(enLaEmpresa.db, { productoId: producto.id, sucursalIds, disponible: true });
    return exito(`Producto "${producto.nombre}" (${producto.codigo}) creado.`, { id: producto.id, nombre: producto.nombre });
  } catch (e) {
    if (esErrorDeUnicidad(e)) return fracaso("CODIGO_REPETIDO", "Ya existe un producto con ese código.");
    // O.175: la unidad de stock de OTRA empresa (o inexistente) la rechaza la clave foránea compuesta de la base: se traduce a «No se encontró …» (sin transacción acá, el INSERT fallido no aborta nada).
    const rechazo = rechazoDeReferenciaDeProducto(e);
    if (rechazo) return fracaso("REFERENCIA_NO_ENCONTRADA", rechazo);
    throw e;
  }
}
