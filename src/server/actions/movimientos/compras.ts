"use server";

import { guardComandoAnularCompra, guardComandoCorregirCompra } from "@/core/features/compras/compra.guard";
import type { CabeceraVista as CabeceraVistaSchema, CorreccionCompraInput as CorreccionCompraInputSchema } from "@/core/features/compras/compra.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { anularCompraCasoDeUso } from "./casos-de-uso/anular-compra";
import { corregirCompraCasoDeUso } from "./casos-de-uso/corregir-compra";

/**
 * Anula una compra ya confirmada (K1c, docs/planes-implementacion-pendientes-2026-09-21.md §5). Las reglas viven en
 * `src/core/compras/anulacion.ts` (puras y con sus propios tests). Desde la Task #41 (Fase M, docs/arquitectura-casos-de-uso-2026-09-27.md)
 * esta Server Action es un adaptador fino: permiso (`conPermiso`) → formato (`guardComandoAnularCompra`) → caso de uso
 * (`casos-de-uso/anular-compra.ts`: transacción, idempotencia, carga, reglas, escritura y auditoría) → `aResultadoAccion`.
 *
 * Mismo criterio append-only que `anularVenta`: la compra original y sus líneas nunca se editan ni se borran. Se escribe una Operación AJUSTE nueva
 * con una línea inversa por cada línea comprada (mismo producto, sección y lote; cantidad y precio total con el signo invertido) y la compra se marca
 * `anuladaEn`/`anuladaPorId`. La reversión lleva el precio de la propia compra, así que se valúa sola al costo original.
 *
 * Se bloquea si lo comprado ya no está en stock (consumido o movido): se compara POR LOTE, no contra el total del producto. La salida en ese caso es una
 * Devolución a proveedor, no anular.
 *
 * Al quedar marcada como anulada, la compra deja de contar en todos los reportes de dinero y su N.º de factura queda libre (índice único parcial de la
 * base y chequeo rápido de `registrarMovimiento`), para poder cargarla de nuevo con el mismo número.
 *
 * Idempotencia (I3): `claveIdempotencia` opcional, un UUID que genera el cliente al abrir la confirmación y reenvía tal cual en un reintento. Cubre el caso
 * «se perdió la respuesta y se reenvió»: devuelve el mensaje original en vez de «ya está anulada». La reversión es una `Operacion` nueva, así que lleva la
 * clave, el hash y el resultado sin ningún cambio de esquema. El doble clic simultáneo lo arbitra el aislamiento SERIALIZABLE.
 *
 * Gate: `anular_compra`, solo admin en la semilla (más restrictivo que `proceso_compra`, que es el permiso para CARGARLA). La sucursal se toma de la
 * sesión: nunca se puede anular la compra de otra sucursal solo adivinando su id.
 *
 * La acción no refresca la vista (`refrescarVistaSiHaceFalta`): quien la llama es un componente de cliente con `useRouter` y pide el `router.refresh()`
 * él mismo (ver `src/server/actions/refrescar.ts`).
 */
export async function anularCompra(operacionId: string, claveIdempotencia?: string): Promise<ResultadoAccion> {
  return conPermiso("anular_compra", async (ctx) => {
    const comando = guardComandoAnularCompra({ operacionId, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularCompraCasoDeUso(ctx, comando.valor));
  });
}

/** Lo que se puede corregir de una compra ya confirmada: solo la cabecera. Vive en `compra.schema.ts` (lo usa también el caso de uso). */
export type CorreccionCompraInput = CorreccionCompraInputSchema;

/** Lo que la persona vio al abrir el formulario: la guarda optimista. Vive en `compra.schema.ts` (lo usa también el caso de uso). */
export type CabeceraVista = CabeceraVistaSchema;

/**
 * Corrige la CABECERA de una compra ya confirmada —proveedor, N.º de factura y detalle libre— sin tocar su Kardex (K1b). Las reglas viven en
 * `src/core/compras/correccion.ts`. Desde la Task #41 (Fase M) esta Server Action es un adaptador fino: permiso (`conPermiso`) → formato
 * (`guardComandoCorregirCompra`) → caso de uso (`casos-de-uso/corregir-compra.ts`: transacción, guardas, escritura y auditoría) →
 * `aResultadoAccion`.
 *
 * Nunca toca las líneas (ni precios ni cantidades): editarlas contradice el Kardex append-only y cambiaría en forma retroactiva el costo de reposición y el
 * margen real de períodos cerrados. Un precio mal cargado se arregla anulando la compra (`anularCompra`) y volviéndola a cargar.
 *
 * Guardas: es una Compra de ESTA sucursal (la sesión manda, no se puede corregir la de otra solo conociendo su id); no está anulada; el proveedor nuevo
 * existe y está activo; el par proveedor + N.º de factura no lo usa OTRA compra vigente (mismo criterio que la carga; la base lo arbitra bajo concurrencia
 * con su índice único); y lo que la persona vio (`esperado`) es lo que hoy está guardado, para no pisar en silencio la corrección de otra persona.
 *
 * Es naturalmente idempotente: si la compra ya tiene exactamente lo pedido (por ejemplo, un reenvío tras perderse la respuesta), responde que no hay nada
 * que corregir en vez de un conflicto.
 *
 * El vínculo proveedor ↔ producto (comparativa, ficha del proveedor, precarga del carrito) se LEE del Kardex vigente, así que corregir el proveedor lo mueve solo: no hay nada que recalcular.
 *
 * Auditoría: una fila por campo que cambió (entidad `Operacion`), con el nombre del proveedor y no su id. Gate: `corregir_compra`, solo admin en la semilla.
 */
export async function corregirCompra(operacionId: string, nueva: CorreccionCompraInput, esperado: CabeceraVista): Promise<ResultadoAccion> {
  return conPermiso("corregir_compra", async (ctx) => {
    const comando = guardComandoCorregirCompra({ operacionId, nueva, esperado });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await corregirCompraCasoDeUso(ctx, comando.valor));
  });
}
