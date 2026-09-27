"use server";

import type { Prisma } from "@prisma/client";
import { texto, validarLargoTexto, LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";
import { obtenerSeccionPropia } from "@/core/movimientos/stock";
import { conTransaccionSerializable } from "@/core/movimientos/con-reintento";
import { calcularPayloadHash, chequearIdempotencia, esClaveIdempotenciaValida, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/idempotencia";
import { registrarVentaEnTx } from "@/core/movimientos/registrar-venta";
import { detalleReversionDeVenta } from "@/core/movimientos/anulaciones";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion } from "../tipos";

export interface ItemVentaInput {
  productoId: string;
  cantidadVendida: number;
}

export interface DatosVentaInput {
  fecha: Date;
  seccionId: string;
  proveedorId?: string; // "a quién se vende" — null/undefined = mostrador (Movimientos.js:1769, 'Mostrador' como texto libre por defecto)
  nroFactura?: string;
  detalle?: string;
  ventas: ItemVentaInput[];
  /** I3 — UUID generado por el cliente al abrir el formulario, reenviado tal cual en reintentos. Opcional durante el rollout (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.3). */
  claveIdempotencia?: string;
}

/**
 * Port de confirmarRegistrarVenta_ConLock_ (Movimientos.js:1154-1332): la validación y la escritura viven en el núcleo
 * `registrarVentaEnTx` (src/core/movimientos/registrar-venta.ts, compartido con el cierre de cuenta del salón); acá quedan el
 * permiso, las validaciones de entrada, la idempotencia (I3) y la transacción serializable.
 *
 * Cada línea se mapea A MANO a `{ productoId, cantidadVendida }`: el núcleo acepta además un `precioUnitario` interno (override de
 * precio, solo para `cerrarCuenta`) que un POST crudo a esta Server Action NUNCA tiene que poder fijar
 * (test/movimientos/venta-en-tx.test.ts, «un precioUnitario colado en el payload se ignora»). Tampoco se pasa `permitirStockNegativo`: la
 * venta de mostrador sigue rechazando por stock insuficiente.
 */
export async function registrarVenta(datos: DatosVentaInput): Promise<ResultadoAccion> {
  return conPermiso("proceso_venta", async (ctx) => {
    if (!datos.ventas.length) return error("Cargá al menos un producto con cantidad.");
    if (!texto(datos.seccionId)) return error("Elegí una sección.");
    if (datos.claveIdempotencia !== undefined && !esClaveIdempotenciaValida(datos.claveIdempotencia)) {
      return error("Clave de reintento inválida.");
    }
    // Fase 6 (auditoría de seguridad/contratos): ver el mismo chequeo en
    // registrarMovimiento — conPermiso no valida que la sección sea de
    // ESTA sucursal, solo el permiso de quien llama.
    if (!(await obtenerSeccionPropia(datos.seccionId, ctx.sucursalId))) return error("No se encontró la sección.");
    const errorLargoFactura = validarLargoTexto(datos.nroFactura, "El número de factura", LARGO_MAXIMO_NRO_FACTURA);
    if (errorLargoFactura) return error(errorLargoFactura);

    const resultado = await conTransaccionSerializable(async (tx): Promise<ResultadoAccion> => {
      // I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
      // A diferencia de registrarMovimiento, este lote escribe UNA
      // Operacion por venta individual (ver el docstring de la función) —
      // la clave/hash/resultado del intento completo se guardan solo en la
      // PRIMERA Operacion del lote, no en cada una (docs/auditoria-motor2-
      // plan-i3-idempotencia-2026-09-17.md §11.5).
      const payloadHash = datos.claveIdempotencia
        ? calcularPayloadHash("VENTA", ctx.sucursalId, { ...datos, claveIdempotencia: undefined })
        : "";
      const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
      if (chequeo.estado === "duplicado") return ok(chequeo.mensaje);
      if (chequeo.estado === "conflicto") return error(MENSAJE_CONFLICTO_IDEMPOTENCIA);

      const venta = await registrarVentaEnTx(
        tx,
        { usuarioId: ctx.usuarioId, sucursalId: ctx.sucursalId, sucursalNombre: ctx.sucursalNombre },
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
      return venta.ok ? ok(venta.mensaje) : error(venta.mensaje);
    });

    return resultado;
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
    return conTransaccionSerializable(async (tx) => {
      const operacion = await tx.operacion.findFirst({
        where: { id: operacionId, sucursalId: ctx.sucursalId },
        include: { movimientos: { include: { producto: true } } },
      });
      if (!operacion) return error("No se encontró esa operación en esta sucursal.");
      if (operacion.proceso !== "VENTA") return error(`La operación "${operacionId}" no es una Venta — es "${operacion.proceso}".`);
      if (operacion.anuladaEn) return error("Esta venta ya está anulada.");

      const hermanas = operacion.promoCuentaId
        ? await tx.operacion.findMany({
            where: { promoCuentaId: operacion.promoCuentaId, anuladaEn: null, id: { not: operacion.id } },
            include: { movimientos: { include: { producto: true } } },
          })
        : [];
      const aAnular = [operacion, ...hermanas];

      const ahora = new Date();
      let totalMovimientos = 0;
      let huboLiquidacion = false;
      for (const op of aAnular) {
        const reversion = await tx.operacion.create({
          data: {
            sucursalId: ctx.sucursalId,
            proceso: "AJUSTE",
            fecha: ahora,
            detalleLibre: detalleReversionDeVenta(op.id, op.fecha),
            usuarioId: ctx.usuarioId,
          },
        });

        const filas: Prisma.MovimientoStockCreateManyInput[] = op.movimientos.map((m) => ({
          operacionId: reversion.id,
          productoId: m.productoId,
          seccionId: m.seccionId,
          proceso: m.proceso === "LIQUIDACION_CONSIGNACION" ? "LIQUIDACION_CONSIGNACION" : "AJUSTE",
          cantidad: -Number(m.cantidad),
          // Arrastre de redondeo (Task #27, docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): invertida igual que `cantidad`, para
          // que la deuda de redondeo del producto (`D = Σcantidad − ΣcantidadExacta`, MovimientoStock.cantidadExacta) vuelva EXACTAMENTE
          // al estado que corresponde a las ventas que siguen vigentes — hoy esta columna siempre es `null` (se llena recién en el paso
          // 4 de la Task #27), así que este cambio, por sí solo, no altera ningún comportamiento observable todavía.
          cantidadExacta: m.cantidadExacta === null ? null : -Number(m.cantidadExacta),
          loteVencimiento: m.loteVencimiento,
          detalle: `Anulación de venta: revierte "${m.detalle}".`,
          precioTotal: -Number(m.precioTotal),
          precioPorUnidadStock: Number(m.precioPorUnidadStock),
        }));
        await tx.movimientoStock.createMany({ data: filas });
        totalMovimientos += filas.length;
        if (filas.some((f) => f.proceso === "LIQUIDACION_CONSIGNACION")) huboLiquidacion = true;

        await tx.operacion.update({ where: { id: op.id }, data: { anuladaEn: ahora, anuladaPorId: ctx.usuarioId } });

        // Auditoría administrativa (igual que `anularCompra`): anular una venta mueve stock e ingreso, así que queda quién, cuándo y de cuál.
        await registrarCambioAuditado(tx, {
          entidad: "Operacion",
          entidadId: op.id,
          descripcion: `Venta del ${op.fecha.toISOString().slice(0, 10)}${op.nroFactura ? ` (factura ${op.nroFactura})` : ""}: anulación${hermanas.length ? " (promo, junto con sus otros componentes)" : ""}`,
          campo: "anuladaEn",
          valorAnterior: null,
          valorNuevo: ahora.toISOString(),
          actorId: ctx.usuarioId,
          sucursalId: ctx.sucursalId,
        });
      }

      const mensajePromo = hermanas.length ? ` Era una promo con ${aAnular.length} componentes: se anularon todos juntos.` : "";
      return ok(`Venta anulada. Se revirtieron ${totalMovimientos} movimiento(s) de stock${huboLiquidacion ? " y la liquidación de consignación" : ""}.${mensajePromo}`);
    });
  });
}
