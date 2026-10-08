import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoActualizarProducto, ResultadoActualizarProducto } from "@/core/features/catalogo/productos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { texto } from "@/core/texto";
import { datosParaGuardar, validarDatosDeProducto } from "@/server/lecturas/catalogo/datos-de-producto";
import { actualizarCamposDeProducto } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «editar un producto del catálogo» (Hito 4 de la pureza, bloque 4.3, paso H4C-13 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en
 * línea en la Server Action `actualizarProducto` (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL:
 *
 * A diferencia de Apps Script (renombrarProductoEnHistorial_, Catalogo.js:1270-1314), acá el nombre es un campo más: Receta/Presentación/ProveedorPorProducto
 * referencian por `productoId` (FK real), no por nombre — no hace falta reescribir nada más al renombrar. El producto se lee con la base del contexto; el tipo NO
 * se puede cambiar (cambiar el tipo de un producto con historial —recetas, ventas, stock— rompe invariantes reales, así que se rechaza explícito en vez de
 * silenciarlo); los datos se validan (`validarDatosDeProducto`, con la base del contexto), y el `update` y sus TRES filas de auditoría (precio de venta, precio de
 * consignación y paso de venta, cada una no-op si no cambió) van en UNA transacción (Task #41, M10): antes iban sueltos y, si la auditoría fallaba (o el proceso se
 * caía en el medio), el precio quedaba cambiado sin rastro.
 *
 * La Server Action quedó como adaptador (`conPermisoDeEmpresa("producto_editar")` → este caso de uso → `aResultadoAccion` → si salió bien, revalidar la carta
 * pública y DESPUÉS, si el precio de venta cambió (`datos.precioAnterior`/`precioNuevo`), ofrecer sincronizarlo con los hermanos del ítem agrupado —
 * `sincronizable`, docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8—, como antes). Sin guard: la validación lee la unidad de stock a mitad de camino.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja el producto con los datos pedidos (sin cambiar su tipo) y una fila de auditoría por cada uno de sus tres valores de mayor impacto que cambió: todo o nada.
 * @idempotency No aplica — repetir el pedido vuelve a escribir los mismos datos (sin filas de auditoría nuevas: no cambió nada).
 * @transaction `actor.transaccion` (READ COMMITTED): el `update` y sus tres auditorías juntos; el producto y la validación se leen antes con `actor.db`.
 * @sideEffects registrarCambioAuditado (Producto.precioVenta, .precioConsignacion y .pasoVenta, del anterior al nuevo), en la misma transacción. La revalidación de
 *   la carta pública y el `sincronizable` los hace la Server Action.
 * @ficha permiso=producto_editar transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoActualizarProducto,
): Promise<ResultadoActualizarProducto> {
  const { productoId, datos } = comando;
  const existente = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!existente) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  // datosParaGuardar (abajo) no incluye `tipo` a propósito — cambiar el
  // tipo de un producto con historial (recetas, ventas, stock) rompe
  // invariantes reales, así que se rechaza explícito en vez de
  // silenciarlo (antes: se ignoraba sin aviso, "Producto actualizado"
  // mostraba éxito con el tipo viejo intacto).
  if (datos.tipo !== existente.tipo) {
    return fracaso(
      "TIPO_DISTINTO",
      `El tipo no se puede cambiar — este producto ya es "${existente.tipo}". Dado de baja y creá uno nuevo si necesitás el otro tipo.`,
    );
  }

  const validado = await validarDatosDeProducto(actor.db, datos, productoId);
  if ("error" in validado) return fracaso("DATOS_INVALIDOS", validado.error);

  const nuevos = datosParaGuardar(datos, validado.numeros);
  const nombreActual = texto(datos.nombre);
  // El `update` y sus filas de auditoría van en UNA transacción (Task #41, M10): antes iban sueltos y, si la auditoría fallaba
  // (o el proceso se caía en el medio), el precio quedaba cambiado sin rastro.
  await actor.transaccion(async (tx) => {
    await actualizarCamposDeProducto(tx, { id: productoId, campos: nuevos });

    // Auditoría administrativa (A3, Pivote 6) — solo los precios, que son
    // los campos de mayor impacto de negocio/control interno (ver
    // docs/auditoria-motor2-fase6-seguridad-2026-09-18.md).
    await registrarCambioAuditado(tx, {
      entidad: "Producto", entidadId: productoId, campo: "precioVenta",
      descripcion: `Producto "${nombreActual}": precio de venta`,
      valorAnterior: Number(existente.precioVenta), valorNuevo: Number(nuevos.precioVenta), actorId: actor.usuarioId,
    });
    await registrarCambioAuditado(tx, {
      entidad: "Producto", entidadId: productoId, campo: "precioConsignacion",
      descripcion: `Producto "${nombreActual}": precio de consignación`,
      valorAnterior: Number(existente.precioConsignacion), valorNuevo: Number(nuevos.precioConsignacion), actorId: actor.usuarioId,
    });
    // Venta fraccionada (Task #25): se audita igual que el resto de los campos de mayor impacto de negocio.
    await registrarCambioAuditado(tx, {
      entidad: "Producto", entidadId: productoId, campo: "pasoVenta",
      descripcion: `Producto "${nombreActual}": paso de venta`,
      valorAnterior: existente.pasoVenta !== null ? Number(existente.pasoVenta) : null,
      valorNuevo: nuevos.pasoVenta,
      actorId: actor.usuarioId,
    });
  });

  return exito(`Producto "${nombreActual}" actualizado.`, { precioAnterior: Number(existente.precioVenta), precioNuevo: Number(nuevos.precioVenta) });
}
