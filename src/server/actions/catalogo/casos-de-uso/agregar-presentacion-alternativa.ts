import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { validarCantidad } from "@/core/datos/cantidad";
import type { ComandoAgregarPresentacionAlternativa, ResultadoAgregarPresentacionAlternativa } from "@/core/features/catalogo/productos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { presentacionTieneUso } from "@/server/lecturas/catalogo/historia-de-producto";
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
 * M-4 (auditoría final, cierra la parte de código; la clave fina `producto_campos_sensibles` queda pendiente: M.2, [MIG]): si la presentación YA EXISTE, ya se usó en compras (`presentacionTieneUso`: hay un vínculo
 * proveedor↔producto con esa unidad de compra, que cada compra con proveedor escribe) y el factor pedido es distinto del guardado, se rechaza (`FACTOR_CON_USO`) sin escribir. Crear una presentación nueva, o
 * reactivar una con el mismo factor, sigue permitido. La presentación anterior se lee dentro de la transacción.
 *
 * @contract Deja la presentación (producto, unidad de compra) activa con el factor pedido, con su fila de auditoría si el factor cambió (o es nueva): las dos o ninguna. No cambia el factor de una presentación que ya se usó.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo factor (sin fila de auditoría nueva: no cambió).
 * @transaction `actor.transaccion` (READ COMMITTED): la presentación anterior, la pregunta por su uso, la presentación y su auditoría juntas; el producto se lee antes con `actor.db`.
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
  // La presentación y su rastro van en UNA transacción (Pureza 0.7): el factor de conversión mueve el costo por unidad de todo lo que se compre con ella. La presentación anterior (y si ya se usó) se lee
  // DENTRO de ella (M-4 / S-51): la comparación y la escritura ven el mismo estado.
  return actor.transaccion(async (tx): Promise<ResultadoAgregarPresentacionAlternativa> => {
    const anterior = await tx.presentacion.findUnique({ where: clave, select: { factorConversion: true } });
    const cambiaElFactor = anterior !== null && Number(anterior.factorConversion) !== factor.valor!;
    // M-4: el factor de una presentación que ya se usó en compras NO se cambia. Un operario con `producto_presentaciones` lo pisaba con este mismo alta (un `upsert`) y la compra siguiente metía
    // más o menos stock del que había. Crear una presentación nueva, o reactivar una con el mismo factor, sigue como siempre.
    if (cambiaElFactor && (await presentacionTieneUso(tx, { productoId, unidadCompraId }))) {
      const unidad = await tx.unidad.findUnique({ where: { id: unidadCompraId }, select: { nombre: true } });
      return fracaso(
        "FACTOR_CON_USO",
        `La presentación en ${unidad?.nombre ?? "esa unidad"} de "${producto.nombre}" ya se usó en compras: su factor de conversión no se puede cambiar, porque cambiaría el stock que entra y el costo por unidad de lo que se compre con ella. ` +
          `Si el factor está mal, desactivala y creá otra presentación con otra unidad de compra.`,
      );
    }
    const fila = await guardarPresentacion(tx, { productoId, unidadCompraId, factorConversion: factor.valor! });
    if (!anterior || cambiaElFactor) {
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
    return exito("Presentación agregada.", null);
  });
}
