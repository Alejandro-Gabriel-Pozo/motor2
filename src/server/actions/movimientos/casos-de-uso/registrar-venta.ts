import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { DatosVentaInput, ResultadoRegistrarVenta } from "@/core/features/ventas/venta.schema";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { calcularPayloadHash, chequearIdempotencia, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/idempotencia";
import { registrarVentaEnTx } from "@/core/movimientos/registrar-venta";
import { exito, fracaso } from "@/core/resultado-caso";

/**
 * Caso de uso «registrar una venta de mostrador» — SOLO la parte transaccional (Task #41, Fase M; docs/arquitectura-casos-de-uso-2026-09-27.md).
 *
 * Por qué existe: `venta.ts` entró en `ACCIONES_CON_CASO_DE_USO` al migrar `anularVenta` (M8), y la regla `accion-migrada-sin-orquestacion`
 * se aplica a TODO el archivo, así que `registrarVenta` tampoco puede usar en runtime el reintento ni la idempotencia. Se movió acá,
 * TAL CUAL, el bloque `conTransaccionSerializable(…)` que tenía en línea; las validaciones de entrada (líneas, sección propia, clave I3,
 * largo del N.º de factura) siguen en la Server Action, sin cambios. Pasarlas a un guard de comando queda para la migración propia de
 * `registrarVenta`.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint; recibe `datos` ya validados por la Server Action.
 *
 * Dentro de UNA transacción SERIALIZABLE:
 *  1. hash de idempotencia I3 (tag "VENTA", payload = `datos` sin la clave, solo si hay clave) y `chequearIdempotencia`: un reenvío exacto
 *     devuelve el mensaje ORIGINAL (`repetida: true`); la misma clave con otro payload es conflicto. A diferencia de `registrarMovimiento`,
 *     el lote escribe UNA Operacion por venta individual: la clave/hash/resultado del intento se guardan solo en la PRIMERA Operacion del
 *     lote (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §11.5), lo hace `registrarVentaEnTx`;
 *  2. `registrarVentaEnTx` (src/core/movimientos/registrar-venta.ts), con cada línea mapeada A MANO a `{ productoId, cantidadVendida }`:
 *     un `precioUnitario` colado en el payload nunca llega al núcleo (test/movimientos/venta-en-tx.test.ts), y no se pasa
 *     `permitirStockNegativo` (la venta de mostrador sigue rechazando por stock insuficiente).
 */
export async function registrarVentaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre">,
  datos: DatosVentaInput
): Promise<ResultadoRegistrarVenta> {
  return conTransaccionSerializable(async (tx): Promise<ResultadoRegistrarVenta> => {
    const payloadHash = datos.claveIdempotencia ? calcularPayloadHash("VENTA", actor.sucursalId, { ...datos, claveIdempotencia: undefined }) : "";
    const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { operacionIds: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const venta = await registrarVentaEnTx(
      tx,
      { usuarioId: actor.usuarioId, sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre },
      {
        fecha: datos.fecha,
        origen: { tipo: "seccion", seccionId: datos.seccionId },
        proveedorId: datos.proveedorId,
        nroFactura: datos.nroFactura,
        detalle: datos.detalle,
        lineas: datos.ventas.map((item) => ({ productoId: item.productoId, cantidadVendida: item.cantidadVendida })),
      },
      datos.claveIdempotencia ? { idempotencia: { clave: datos.claveIdempotencia, payloadHash } } : {}
    );
    return venta.ok ? exito(venta.mensaje, { operacionIds: venta.operacionIds, repetida: false }) : fracaso("VENTA_RECHAZADA", venta.mensaje);
  });
}
