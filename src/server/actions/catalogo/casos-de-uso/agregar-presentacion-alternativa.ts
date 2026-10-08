import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { validarCantidad } from "@/core/datos/cantidad";
import type { ComandoAgregarPresentacionAlternativa, ResultadoAgregarPresentacionAlternativa } from "@/core/features/catalogo/productos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarPresentacion } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «agregar (o reactivar con otro factor) una presentación de compra alternativa de un producto» (Hito 4 de la pureza, bloque 4.3, paso H4C-11 —
 * `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server Action `agregarPresentacionAlternativa`
 * (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: el producto (con su unidad de stock) se lee con la base del contexto; la unidad pedida no puede
 * ser la de compra por defecto; el factor se valida con los decimales de la unidad de STOCK del producto (mismo criterio que `factorConversion` de Producto:
 * "unidades de stock por 1 unidad de compra"); la presentación anterior (si había) se lee con la base del contexto, y la presentación y su rastro van en UNA
 * transacción (Pureza 0.7): el factor de conversión mueve el costo por unidad de todo lo que se compre con ella. La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("producto_presentaciones")` → este caso de uso → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos.
 *
 * @contract Deja la presentación (producto, unidad de compra) activa con el factor pedido, con su fila de auditoría si el factor cambió (o es nueva): las dos o ninguna.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo factor (sin fila de auditoría nueva: no cambió).
 * @transaction `actor.transaccion` (READ COMMITTED): la presentación y su auditoría juntas; el producto y la presentación anterior se leen antes con `actor.db`.
 * @sideEffects registrarCambioAuditado (Presentacion.factorConversion, del anterior —o null— al nuevo), en la misma transacción.
 * @ficha permiso=producto_presentaciones transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarPresentacionAlternativaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId">,
  comando: ComandoAgregarPresentacionAlternativa,
): Promise<ResultadoAgregarPresentacionAlternativa> {
  const { productoId, unidadCompraId, factorConversion } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId }, include: { unidadStock: true } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.unidadCompraId === unidadCompraId) {
    return fracaso("ES_LA_UNIDAD_POR_DEFECTO", "Esa ya es la unidad de compra por defecto de este producto.");
  }
  // Mismo criterio que `factorConversion` de Producto (validarComun): "unidades de stock por 1 unidad de compra" — sus
  // decimales son los de la unidad de STOCK de este producto, no los de la unidad de compra alternativa.
  const factor = validarCantidad(factorConversion, producto.unidadStock, { etiqueta: "El factor de conversión", obligatorio: true });
  if (!factor.ok) return fracaso("FACTOR_INVALIDO", factor.mensaje);

  const clave = { productoId_unidadCompraId: { productoId, unidadCompraId } };
  const anterior = await actor.db.presentacion.findUnique({ where: clave, select: { factorConversion: true } });
  // La presentación y su rastro van en UNA transacción (Pureza 0.7): el factor de conversión mueve el costo por unidad de todo lo que se compre con ella.
  await actor.transaccion(async (tx) => {
    const fila = await guardarPresentacion(tx, { productoId, unidadCompraId, factorConversion: factor.valor! });
    if (!anterior || Number(anterior.factorConversion) !== factor.valor!) {
      await registrarCambioAuditado(tx, {
        entidad: "Presentacion",
        entidadId: fila.id,
        campo: "factorConversion",
        descripcion: `Producto "${producto.nombre}": factor de conversión de una presentación de compra`,
        valorAnterior: anterior ? Number(anterior.factorConversion) : null,
        valorNuevo: factor.valor!,
        actorId: actor.usuarioId,
      });
    }
  });
  return exito("Presentación agregada.", null);
}
