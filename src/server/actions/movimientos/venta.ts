"use server";

import { guardComandoAnularVenta, guardComandoRegistrarVenta } from "@/core/features/ventas/venta.guard";
import type { DatosVentaInput as DatosVentaInputSchema, ItemVentaInput as ItemVentaInputSchema } from "@/core/features/ventas/venta.schema";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";
import { anularVentaCasoDeUso } from "./casos-de-uso/anular-venta";
import { registrarVentaCasoDeUso } from "./casos-de-uso/registrar-venta";

/** Una línea de la venta de mostrador. Vive en `venta.schema.ts` (lo usa también el caso de uso). */
export type ItemVentaInput = ItemVentaInputSchema;

/** Lo que recibe `registrarVenta`. Vive en `venta.schema.ts` (lo usa también el caso de uso). */
export type DatosVentaInput = DatosVentaInputSchema;

/**
 * Port de confirmarRegistrarVenta_ConLock_ (Movimientos.js:1154-1332): la validación y la escritura viven en el núcleo
 * `registrarVentaEnTx` (src/core/movimientos/registrar-venta.ts, compartido con el cierre de cuenta del salón); acá quedan el
 * permiso y las validaciones de entrada. La idempotencia (I3) y la transacción serializable viven, desde la Task #41 (Fase M), en
 * `casos-de-uso/registrar-venta.ts`: `venta.ts` está en `ACCIONES_CON_CASO_DE_USO` (por `anularVenta`) y esa regla vale para todo el archivo.
 *
 * Cada línea se mapea A MANO a `{ productoId, cantidadVendida }` (en el caso de uso): el núcleo acepta además un `precioUnitario` interno
 * (override de precio, solo para `cerrarCuenta`) que un POST crudo a esta Server Action NUNCA tiene que poder fijar
 * (test/movimientos/venta-en-tx.test.ts, «un precioUnitario colado en el payload se ignora»). Tampoco se pasa `permitirStockNegativo`: la
 * venta de mostrador sigue rechazando por stock insuficiente.
 *
 * Fase 6 (auditoría de seguridad/contratos): `conPermiso` no valida que la sección sea de ESTA sucursal, solo el permiso de quien
 * llama — pero acá NO hace falta un chequeo aparte (a diferencia de `registrarMovimiento`): `registrarVentaEnTx` ya lo hace como
 * su primerísimo paso (`prepararOrigen`, `core/movimientos/origen-venta-datos.ts`), con el MISMO mensaje «No se encontró la
 * sección.», antes de escribir nada. Duplicarlo acá solo evitaría abrir la transacción para el caso raro de una sección ajena;
 * Task #41 (Fase E1) sacó ese chequeo redundante para que esta Server Action no necesite ningún import directo de
 * `core/movimientos/` (las otras 4 acciones ya migradas — `compras.ts`, `cuenta-cierre.ts`, `cuenta-anulacion.ts`,
 * `traspasos.ts` — tampoco lo necesitan).
 */
export async function registrarVenta(datos: DatosVentaInput): Promise<ResultadoAccion> {
  return conPermiso("proceso_venta", async (ctx) => {
    const comando = guardComandoRegistrarVenta(datos, ctx.ahora);
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await registrarVentaCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Anula una Venta ya confirmada — hueco real señalado en la auditoría
 * amplia de motor2 (2026-09-16): a diferencia de Conteo Físico
 * (resolverConteoPendiente/cancelarConteoFisico), no existía ningún camino
 * para corregir un error de carga en el proceso más frecuente del sistema.
 * "Devolución de cliente" es un concepto de negocio distinto (mercadería
 * que vuelve, revendible) y no sirve para esto.
 *
 * Desde la Task #41 (Fase M, docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso`) → formato (`guardComandoAnularVenta`) → caso de uso (`casos-de-uso/anular-venta.ts`: transacción, carga, guardas,
 * hermanas de promo, escritura y auditoría) → `aResultadoAccion`. Las reglas puras (guardas, contra-asiento, textos) viven en
 * `src/core/movimientos/anulaciones.ts`.
 *
 * Mismo criterio append-only que cancelarConteoFisico
 * (src/server/actions/conteo-fisico.ts): la Operacion/MovimientoStock
 * original de la venta nunca se edita ni se borra — se escribe una
 * Operacion AJUSTE nueva que revierte cada línea (mismo producto/sección/
 * lote, cantidad con el signo invertido), y la venta original se marca
 * `anuladaEn`/`anuladaPorId` para no poder anularla dos veces.
 *
 * Por qué AJUSTE y no un Proceso "ANULACION_VENTA" nuevo: AJUSTE ya es
 * "delta ya firmado" (esSignoFijo=false, TRANSICIONES.AJUSTE) y ya está
 * excluido de los reportes de venta/margen que suman por magnitud — reusa
 * infraestructura ya probada en vez de tener que rewirear esSignoFijo y
 * cada reporte de período para un Proceso nuevo. La línea
 * LIQUIDACION_CONSIGNACION (si la venta consumió una MP en consignación)
 * se revierte con el mismo Proceso, cantidad en 0 igual que el original,
 * precioTotal/precioPorUnidadStock en negativo — así el reporte de
 * Consignación (que suma esas líneas tal cual) neta solo automáticamente.
 *
 * Auditoría: deja una fila en el registro de auditoría administrativa (entidad `Operacion`, campo `anuladaEn`), como `anularCompra`.
 *
 * Reportes: la venta anulada deja de contar en todos los reportes de dinero y de consumo (`operacion.anuladaEn`, ver `ItemPeriodo.anulada` en
 * `src/core/reportes/periodo.ts`), y esta Operación AJUSTE no aparece como un ajuste manual en «Diferencias de ajuste» (`src/core/movimientos/anulaciones.ts`).
 *
 * Gate: 'anular_venta', admin-only en la semilla — mismo criterio que
 * 'cancelar_conteo' (más restrictivo que el permiso para CARGAR el proceso
 * original, a propósito).
 *
 * Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, D4, paso 9): si la Operacion tiene `promoCuentaId`, ES un
 * componente de una promo — se anulan TODAS las Operaciones VENTA hermanas (misma `PromoCuenta`, todavía vigentes) en la
 * MISMA transacción, cada una con su propia Operacion AJUSTE de reversión: una promo nunca queda anulada a medias, se elija
 * la que se elija de sus componentes para anular.
 */
export async function anularVenta(operacionId: string): Promise<ResultadoAccion> {
  return conPermiso("anular_venta", async (ctx) => {
    const comando = guardComandoAnularVenta({ operacionId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await anularVentaCasoDeUso(ctx, comando.valor));
  });
}
