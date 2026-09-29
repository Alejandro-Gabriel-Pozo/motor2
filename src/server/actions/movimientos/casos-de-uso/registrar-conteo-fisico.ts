import "server-only";
import type { AccionConteo, EstadoConteo } from "@prisma/client";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { texto } from "@/core/texto";
import { validarCantidad } from "@/core/datos/cantidad";
import { redondearACantidadDeUnidad, tieneStockReal } from "@/core/movimientos/public";
import { calcularSaldoPorLote, calcularSaldoTotal, obtenerSeccionPropia, conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { productoDisponibleEn } from "@/core/catalogo/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { ComandoConteoFisico, ResultadoConteoFisico } from "@/core/features/movimientos/conteo-fisico.schema";
import { cargarProductoConUnidadDeStock } from "@/server/persistencia/movimientos/cargar-producto-con-unidad-de-stock";
import { escribirConteoFisico } from "@/server/persistencia/movimientos/escribir-conteo-fisico";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/**
 * Port de ACCIONES_CONTEO_FISICO (Stock.js:1066-1088): qué hacer con la
 * diferencia encontrada. AJUSTAR escribe el movimiento de corrección;
 * FALTA_MOVIMIENTO deja el conteo pendiente SIN tocar stock (evita el
 * doble conteo cuando lo que falta es cargar una compra/venta real);
 * DESCARTAR no ajusta y no cuenta como conteo válido.
 */
const ACCIONES_CONTEO: Record<AccionConteo, { ajusta: boolean; estado: EstadoConteo }> = {
  AJUSTAR: { ajusta: true, estado: "RESUELTO" },
  FALTA_MOVIMIENTO: { ajusta: false, estado: "PENDIENTE" },
  DESCARTAR: { ajusta: false, estado: "DESCARTADO" },
};

/**
 * Caso de uso «registrar un conteo físico» — port de `_registrarConteoFisicoSinRecalculo_` (Stock.js:1523-1649, Task #41, Fase M,
 * M13e1 — docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que antes vivía en `registrarConteoConContexto`
 * (`src/server/actions/movimientos/conteo-fisico.ts`), en el MISMO orden y con los MISMOS textos; esa función quedó como el motor
 * compartido de dos adaptadores finos (`registrarConteoFisico` y, por fila, `registrarConteosFisicos`): permiso (`conPermiso`, una vez
 * por llamada) → guard de comando (`guardComandoConteoFisico`, `core/features/movimientos/conteo-fisico.guard.ts`) → este caso de uso →
 * `aResultadoAccion`.
 *
 * Migración PARCIAL a propósito en M13e1 (como P1 con `recetas.ts`): `resolverConteoPendiente`/`cancelarConteoFisico` NO pasan por acá
 * — tienen sus propios casos de uso (`resolver-conteo-pendiente.ts`/`cancelar-conteo-fisico.ts`, M13e2) — y
 * `obtenerHistorialConteosFisicos` se mudó a `lecturas-conteo-fisico.ts` (M13e2).
 *
 * Camino PROPIO, no pasa por `registrarMovimientoCasoDeUso` (Movimientos.js nunca hace pasar Control por
 * `armarRegistroMovimiento_` tampoco): Control es un proceso distinto de Ajuste, con su propia bitácora (`ConteoFisico`) además del
 * Kardex. `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo
 * `conPermiso("proceso_control")`) ni el formato del comando (sección en blanco, `guardComandoConteoFisico`): recibe `comando` ya
 * pasado por esa.
 *
 * Orden, igual que antes:
 *  1. sección propia (fuera de la transacción, con el cliente global) — Fase 6 (auditoría de seguridad/contratos): `conPermiso` ya
 *     validó el permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó el cliente sea realmente de esa sucursal;
 *  2. `conTransaccionSerializable`: producto (`cargarProductoConUnidadDeStock`, M13d), disponibilidad en la sucursal, `tieneStockReal`
 *     (Control es sobre MP/"se produce", no sobre PV comunes), `validarCantidad` del conteo tecleado (se RECHAZA el exceso de
 *     decimales, no se redondea en silencio — mismo criterio que Compra/Mesa), cálculo del saldo del sistema (por lote o total, LEÍDO
 *     DENTRO de la transacción: Serializable aborta si otra escritura concurrente lo cambia mientras tanto), diferencia redondeada,
 *     `ACCIONES_CONTEO` (qué hacer según la acción elegida), escritura del `ConteoFisico` (`escribirConteoFisico`, M13e1) y, si
 *     corresponde (diferencia != 0 y la acción ajusta), el ajuste de Kardex vía `escribirOperacionDeStock`/`escribirLineasDeMovimientoStock`
 *     (M13b) con `conteoFisicoId: conteo.id` en la fila — un array de una sola fila es funcionalmente idéntico al
 *     `tx.movimientoStock.create` de una fila que hacía antes en línea.
 *
 * @contract Registra un conteo físico y, según la acción elegida, ajusta el Kardex a la diferencia contra el saldo leído dentro de la transacción.
 * @idempotency No aplica — el schema (conteo-fisico.guard.ts) no tiene claveIdempotencia; un doble clic real crea dos ConteoFisico distintos (limitación conocida, no resuelta acá).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Escritura del Kardex (Operacion + MovimientoStock) SOLO si la diferencia es != 0 y la acción ajusta; sin auditoría de permisos propia.
 */
export async function registrarConteoFisicoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion">,
  comando: ComandoConteoFisico
): Promise<ResultadoConteoFisico> {
  // Fase 6 (auditoría de seguridad/contratos): conPermiso no valida que la
  // sección sea de ESTA sucursal, solo el permiso de quien llama — ver el
  // mismo chequeo en registrarMovimientoCasoDeUso/reclasificarStockCasoDeUso.
  if (!(await obtenerSeccionPropia(comando.seccionId, actor.sucursalId))) {
    return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
  }

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoConteoFisico> => {
    const producto = await cargarProductoConUnidadDeStock(tx, comando.productoId);
    if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "El producto no existe.");
    if (!(await productoDisponibleEn(actor.sucursalId, producto.id, tx))) {
      return fracaso("PRODUCTO_NO_DISPONIBLE", `«${producto.nombre}» no está disponible en «${actor.sucursalNombre}».`);
    }
    if (!tieneStockReal(producto.tipo, producto.seProduce)) {
      return fracaso("SIN_STOCK_REAL", `El conteo físico es sobre materias primas (MP) o productos "Se produce", no sobre PV comunes.`);
    }

    // Cantidad de ENTRADA (lo que se tecleó): se rechaza el exceso de decimales, no se redondea en silencio — mismo criterio que
    // Compra/Mesa (src/core/datos/cantidad.ts). `diferencia`, más abajo, es lo CALCULADO (conteoReal - saldoSistema): eso sigue
    // redondeándose con `redondearACantidadDeUnidad`, el mismo criterio que la conversión de unidades en Compra.
    const resConteoReal = validarCantidad(comando.conteoReal, producto.unidadStock, {
      etiqueta: `El conteo real de "${producto.nombre}"`,
      obligatorio: true,
      permitirCero: true,
    });
    if (!resConteoReal.ok) return fracaso("CANTIDAD_INVALIDA", resConteoReal.mensaje);
    const conteoReal = resConteoReal.valor!;
    const loteVencimiento = comando.loteVencimiento ?? null;
    const saldoSistema = loteVencimiento
      ? await calcularSaldoPorLote(producto.id, comando.seccionId, loteVencimiento, tx)
      : await calcularSaldoTotal(producto.id, comando.seccionId, tx);
    const diferencia = redondearACantidadDeUnidad(conteoReal - saldoSistema, producto.unidadStock.decimales);

    const accionInfo = ACCIONES_CONTEO[comando.accion];
    const estado: EstadoConteo = diferencia === 0 ? "RESUELTO" : accionInfo.estado;

    const conteo = await escribirConteoFisico(tx, {
      sucursalId: actor.sucursalId,
      fecha: comando.fechaConteo,
      productoId: producto.id,
      seccionId: comando.seccionId,
      loteVencimiento,
      saldoSistema,
      conteoReal,
      diferencia,
      accion: comando.accion,
      estado,
      detalle: texto(comando.detalle) || null,
      usuarioId: actor.usuarioId,
    });

    const ajustado = diferencia !== 0 && accionInfo.ajusta;
    if (ajustado) {
      const operacion = await escribirOperacionDeStock(tx, {
        sucursalId: actor.sucursalId,
        proceso: "CONTROL",
        fecha: comando.fechaConteo,
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
          productoId: producto.id,
          seccionId: comando.seccionId,
          proceso: "CONTROL",
          cantidad: diferencia,
          loteVencimiento,
          detalle: `Conteo físico: contado ${conteoReal}, sistema calculaba ${saldoSistema}, diferencia ${diferencia > 0 ? "+" : ""}${diferencia}.`,
          precioTotal: 0,
          precioPorUnidadStock: 0,
          conteoFisicoId: conteo.id,
        },
      ]);
    }

    const mensaje =
      diferencia === 0
        ? "Conteo registrado. El stock ya coincidía."
        : `Conteo registrado. Diferencia: ${diferencia > 0 ? "+" : ""}${diferencia}${accionInfo.ajusta ? " (ajustada)" : ""}.`;
    return exito(mensaje, { conteoId: conteo.id, diferencia, ajustado });
  });
}
