import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { ResultadoCancelarConteo } from "@/core/features/movimientos/cancelar-conteo.schema";
import { cargarConteoFisico } from "@/server/persistencia/movimientos/cargar-conteo-fisico";
import { actualizarEstadoDeConteo } from "@/server/persistencia/movimientos/escribir-conteo-fisico";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/**
 * Caso de uso «cancelar un conteo físico» — port de `cancelarConteoFisico` (Stock.js:2097-2141, Task #41, Fase M, M13e2 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Revierte un conteo YA APLICADO (estado "Resuelto" — le ajustó el stock de verdad).
 * Nunca se edita ni se borra la fila original del Kardex — se escribe una fila de REVERSIÓN nueva con la MISMA magnitud y signo
 * contrario, enlazada al mismo ConteoFisico (FK real — en Apps Script era el mismo "ID Operación" que la fila original, correlación
 * por string).
 *
 * `import "server-only"` y SIN `"use server"`, mismo criterio que `resolver-conteo-pendiente.ts`: no chequea permisos (ya lo hizo
 * `conPermiso("cancelar_conteo")` en el adaptador) ni ningún formato de entrada (sin `.guard.ts` propio, ver `cancelar-conteo.schema.ts`).
 *
 * Orden, igual que antes:
 *  1. `cargarConteoFisico` (M13e2) — si no existe o es de otra sucursal, ni sigue;
 *  2. no puede estar ya CANCELADO, y tiene que estar RESUELTO (si está PENDIENTE/DESCARTADO nunca ajustó nada, no hay nada que
 *     cancelar);
 *  3. si `diferenciaOriginal !== 0`, escribe la reversión vía `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock` (M13b, un
 *     array de una sola fila) con `conteoFisicoId: conteo.id`;
 *  4. cierra el conteo como CANCELADO (`actualizarEstadoDeConteo`, M13e2).
 *
 * @contract Revierte un conteo YA RESUELTO con una fila de Kardex de reversión y lo marca CANCELADO — nunca edita/borra la fila original.
 * @idempotency Por estado — un conteo ya CANCELADO se rechaza explícitamente; sin claveIdempotencia/I3.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno además de la reversión de Kardex (fila conteoFisicoId) y el cambio de estado del ConteoFisico.
 * @ficha permiso=cancelar_conteo transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function cancelarConteoFisicoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  conteoId: string
): Promise<ResultadoCancelarConteo> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCancelarConteo> => {
    const conteo = await cargarConteoFisico(tx, conteoId);
    if (!conteo || conteo.sucursalId !== actor.sucursalId) return fracaso("CONTEO_NO_ENCONTRADO", "No se encontró ese conteo.");
    if (conteo.estado === "CANCELADO") return fracaso("CONTEO_YA_CANCELADO", "Ese conteo ya está cancelado.");
    if (conteo.estado !== "RESUELTO") {
      return fracaso(
        "CONTEO_NO_RESUELTO",
        `Este conteo está "${conteo.estado}", no aplicó ningún ajuste al stock — no hay nada que cancelar. Si es un conteo pendiente, resolvelo en vez de cancelarlo.`
      );
    }

    const diferenciaOriginal = Number(conteo.diferencia);
    if (diferenciaOriginal !== 0) {
      const operacion = await escribirOperacionDeStock(tx, {
        sucursalId: actor.sucursalId,
        proceso: "CONTROL",
        fecha: actor.ahora,
        proveedorId: null,
        nroFactura: null,
        seccionDestinoId: null,
        motivoId: null,
        destinoId: null,
        detalleLibre: null,
        usuarioId: actor.usuarioId,
        claveIdempotencia: null,
        payloadHash: null,
      });
      await escribirLineasDeMovimientoStock(tx, [
        {
          operacionId: operacion.id,
          productoId: conteo.productoId,
          seccionId: conteo.seccionId,
          proceso: "CONTROL",
          cantidad: -diferenciaOriginal,
          loteVencimiento: conteo.loteVencimiento,
          detalle: `Conteo físico cancelado: se revierte el ajuste de ${diferenciaOriginal > 0 ? "+" : ""}${diferenciaOriginal}.`,
          precioTotal: 0,
          precioPorUnidadStock: 0,
          conteoFisicoId: conteo.id,
        },
      ]);
    }

    await actualizarEstadoDeConteo(tx, conteoId, {
      estado: "CANCELADO",
      detalle: `${conteo.detalle ?? ""} — cancelado, se revirtió el ajuste de ${diferenciaOriginal > 0 ? "+" : ""}${diferenciaOriginal}`.trim(),
    });

    return exito(`Conteo cancelado. Se revirtió el ajuste de ${diferenciaOriginal > 0 ? "+" : ""}${diferenciaOriginal}.`, { diferenciaOriginal });
  });
}
