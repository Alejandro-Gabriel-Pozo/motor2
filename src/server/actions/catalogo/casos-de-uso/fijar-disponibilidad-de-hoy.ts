import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ComandoFijarDisponibilidadDeHoy, ResultadoFijarDisponibilidadDeHoy } from "@/core/features/carta/mantenimiento.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { tomarFilaDeProducto } from "@/server/persistencia/catalogo/productos";
import { escribirCambioDeDisponibilidadEnTx, validarCambioDeDisponibilidadEnTx, type CambioDeDisponibilidadValidado } from "./actualizar-disponibilidad-producto";

/**
 * Caso de uso «Hoy» de la carta (CARTA-MANT F2; ADR-034): dejar disponibles o sin stock HOY varios productos de la sucursal ACTIVA a la vez (una sección entera, un producto, o el «Deshacer» de lo
 * anterior), TODO O NADA. No inventa un estado nuevo: es la disponibilidad por producto y sucursal de siempre (`DisponibilidadProducto`), con EXACTAMENTE las reglas de
 * `actualizar-disponibilidad-producto.ts` (`validarCambioDeDisponibilidadEnTx` y `escribirCambioDeDisponibilidadEnTx`, compartidas): existe, el ancla de un adicional no se pone a la venta, D4
 * (activar un PV a $0 exige la clave fina) y, al apagar, las dependencias en esta sucursal. Escribe SOLO en `actor.sucursalId` (el guard ya comparó el eco).
 *
 * En UNA transacción (READ COMMITTED, como el caso de uso de un producto):
 *  1. toma la fila de CADA producto (`FOR UPDATE`) en orden de id: dos lotes que se cruzan esperan en el mismo orden (sin abrazo mortal) y un cambio de precio o de disponibilidad de un producto
 *     suelto espera a que este termine (o este a aquél);
 *  2. valida TODOS antes de escribir el primero: si uno no se puede, devuelve ese fracaso y no se escribe ninguno (el mensaje nombra el producto y el motivo);
 *  3. escribe solo los que cambian, cada uno con su fila de auditoría (`DisponibilidadProducto`, `disponible`, el antes leído con la fila tomada); los que ya estaban así no se tocan ni se auditan.
 *
 * @contract Deja cada producto pedido disponible o sin stock en la sucursal activa, con su auditoría, si TODOS se pueden; si uno no, no cambia ninguno.
 * @idempotency Por estado — repetir el pedido no escribe ni audita nada (todos ya están así); el «Deshacer» es el mismo pedido con los estados anteriores.
 * @transaction `actor.transaccion` (READ COMMITTED) con las filas de los productos tomadas (`FOR UPDATE`, en orden de id): validación, escrituras y auditoría, juntas.
 * @sideEffects registrarCambioAuditado (DisponibilidadProducto.disponible, `entidadId` sucursal:producto), en la misma transacción, por el paso compartido. La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=producto_disponibilidad transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarDisponibilidadDeHoyCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoFijarDisponibilidadDeHoy,
): Promise<ResultadoFijarDisponibilidadDeHoy> {
  const cambios = [...comando.cambios].sort((a, b) => (a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0));
  if (cambios.length === 0) return fracaso("PRODUCTO_NO_ENCONTRADO", "No hay ningún producto para cambiar.");
  return actor.transaccion(async (tx): Promise<ResultadoFijarDisponibilidadDeHoy> => {
    for (const c of cambios) await tomarFilaDeProducto(tx, c.productoId);
    const validados: { validado: CambioDeDisponibilidadValidado; disponible: boolean }[] = [];
    for (const c of cambios) {
      const v = await validarCambioDeDisponibilidadEnTx(tx, actor, { productoId: c.productoId, disponible: c.disponible, puedeEditarCamposSensibles: comando.puedeEditarCamposSensibles });
      if (!v.ok) return cambios.length > 1 ? fracaso(v.codigo, `No se cambió ninguno: ${v.mensaje}`) : v;
      validados.push({ validado: v.datos, disponible: c.disponible });
    }
    const queCambian = validados.filter((x) => x.validado.anterior !== x.disponible);
    for (const x of queCambian) await escribirCambioDeDisponibilidadEnTx(tx, actor, x.validado, x.disponible);
    return exito(mensajeDeHoy(validados, queCambian.length, actor.sucursalNombre), { cambiados: queCambian.length });
  });
}

/** «Flan: sin stock hoy», «4 productos sin stock hoy en «Sur»», «3 productos de nuevo en carta», «2 productos vuelven a como estaban». */
function mensajeDeHoy(validados: { validado: CambioDeDisponibilidadValidado; disponible: boolean }[], cambiados: number, sucursal: string): string {
  const estado = (disponible: boolean) => (disponible ? "de nuevo en carta" : "sin stock hoy");
  if (validados.length === 1) {
    const [{ validado, disponible }] = validados as [(typeof validados)[number]];
    return cambiados ? `«${validado.nombre}»: ${estado(disponible)} en «${sucursal}».` : `«${validado.nombre}» ya estaba ${disponible ? "en carta" : "sin stock hoy"} en «${sucursal}».`;
  }
  const todos = validados.every((x) => x.disponible === validados[0]!.disponible);
  if (!todos) return `${validados.length} productos vuelven a como estaban en «${sucursal}».`;
  return `${validados.length} productos ${estado(validados[0]!.disponible)} en «${sucursal}»${cambiados < validados.length ? ` (${validados.length - cambiados} ya estaba${validados.length - cambiados > 1 ? "n" : ""} así)` : ""}.`;
}
