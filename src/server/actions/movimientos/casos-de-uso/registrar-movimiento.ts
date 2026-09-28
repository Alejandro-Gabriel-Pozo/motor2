import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { texto } from "@/core/texto";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { guardNroFacturaCompra } from "@/core/features/compras/compra.guard";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { TRANSICIONES, redondearACantidadDeUnidad } from "@/core/movimientos/public";
import {
  obtenerSeccionPropia,
  seccionesConStock,
  validarStockSuficiente,
  conTransaccionSerializable,
  calcularPayloadHash,
  chequearIdempotencia,
  MENSAJE_CONFLICTO_IDEMPOTENCIA,
  crearCacheProducto,
  esChoqueDeFacturaUnica,
  MENSAJE_FACTURA_DUPLICADA,
  registrarResultadoIdempotente,
} from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import type { DatosMovimientoInput, ResultadoRegistrarMovimiento } from "@/core/features/movimientos/movimiento.schema";
import { cargarDestinoConsumo, cargarMotivoMerma, existeCompraVigenteConFactura } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { upsertProveedorPorProducto } from "../../catalogo/upsert-proveedor-por-producto";
import { armarLineaMovimiento, type LineaCalculada } from "./armar-linea-de-movimiento";

/** Lo que necesita `registrarProveedoresDeLaCompra` (paso 6, más abajo) de cada línea ya armada. */
interface LineaParaProveedor {
  productoId: string;
  unidadCompraId: string | null;
  precioUnitario: number;
  precioPorUnidadStock: number;
  referenciaProveedor: string | undefined;
}

/**
 * Paso 6 (Compra) de `registrarMovimientoCasoDeUso`: engancha `upsertProveedorPorProducto` (Catálogo, sin usar todavía) — FUERA de la
 * transacción principal y sin bloquear su resultado si falla, mismo criterio "best effort" que actualizarProveedoresDesdeCompra_
 * (Catalogo.js:3617-3657, envuelta en try/catch en confirmarRegistrarMovimientos): el Kardex ya quedó bien escrito, esto solo
 * alimenta la comparativa de precios. Se registra la relación en TODOS los casos con unidad de compra conocida (incluso sin precio,
 * mismo bugfix que Catalogo.js:3635-3644: si se cortara acá por falta de precio, ese proveedor nunca acumularía historial).
 */
async function registrarProveedoresDeLaCompra(proveedorId: string, fecha: Date, lineas: LineaParaProveedor[]): Promise<void> {
  for (const l of lineas) {
    if (!l.unidadCompraId) continue;
    try {
      await upsertProveedorPorProducto({
        productoId: l.productoId,
        proveedorId,
        unidadCompraId: l.unidadCompraId,
        precioUnitario: l.precioUnitario,
        precioPorUnidadStock: l.precioPorUnidadStock,
        fechaCompra: fecha,
        referenciaProveedor: l.referenciaProveedor,
      });
    } catch (e) {
      // e instanceof Error ? e.message : String(e) (backlog post-cierre de Task #41, 2026-09-28,
      // docs/pendientes-sesion-2026-09-27.md §5): el cast (e as Error).message revienta con TypeError si algo
      // no-Error (ej. null/undefined) se lanza acá adentro — mismo criterio que core/reportes/cotizacion-dolar.ts.
      console.error(`upsertProveedorPorProducto falló para producto ${l.productoId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Caso de uso «registrar un movimiento» — el motor genérico de los 9 procesos que lo comparten (Compra, Producción, Consumo, Ajuste,
 * Transferencia, Merma, Devolución×3; Task #41, Fase M, M13a-c — docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que
 * antes vivía en línea en la Server Action `registrarMovimiento` (src/server/actions/movimientos/movimientos.ts), en el MISMO orden y
 * con los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard de comando → este caso de uso →
 * `aResultadoAccion`). Port de confirmarRegistrarMovimientos (Movimientos.js:876-1136).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso`) ni el formato del
 * comando (`guardComandoRegistrarMovimiento`, core/features/movimientos/movimiento.guard.ts: proceso genérico, items vacío, sección en
 * blanco, formato de la clave I3, Transferencia con destino vacío/igual al origen): recibe `datos` ya pasado por esas.
 *
 * Orden, igual que antes:
 *  1. sección propia (origen y, si Transferencia, destino) — Fase 6 (auditoría de seguridad/contratos): `conPermiso` ya validó el
 *     permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó el cliente sea realmente de esa sucursal;
 *  2. motivo/destino (catálogos GLOBALES, solo activos) — cliente global `prisma`, fuera de la transacción;
 *  3. `guardNroFacturaCompra` — DESPUÉS de sección/motivo/destino a propósito (mismo orden que antes: cambiarlo cambiaría qué mensaje
 *     sale primero cuando hay más de un dato inválido a la vez);
 *  4. camino rápido de factura duplicada (`existeCompraVigenteConFactura`, cliente global) — el árbitro real es el índice único
 *     parcial, ver el catch de más abajo;
 *  5. `conTransaccionSerializable`, con `.catch(esChoqueDeFacturaUnica)` tal cual: I3, armado de cada línea
 *     (`armarLineaMovimiento`), validación de stock agregada, escritura de `Operacion` + `MovimientoStock[]`;
 *  6. `registrarProveedoresDeLaCompra` (Compra), fuera de la transacción, best-effort: un `upsertProveedorPorProducto` por línea con
 *     unidad de compra conocida.
 *
 * M13b ya extrajo a `server/persistencia/movimientos/escribir-movimiento-de-stock.ts` las dos escrituras Prisma de la Operacion y sus
 * líneas (el armado de las filas, que SÍ es lógica de negocio, se queda acá). M13c entró `movimientos.ts` en `ACCIONES_CON_CASO_DE_USO`
 * (su guard, `core/features/movimientos/movimiento.guard.ts`, valida además que `proceso` sea uno de los 9 `ProcesoGenerico` — segunda
 * barrera DENTRO de `conPermiso`, ver su docstring) y nombró el paso 6 de acá arriba (antes, un bloque sin nombre en línea).
 */
export async function registrarMovimientoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre">,
  datos: DatosMovimientoInput
): Promise<ResultadoRegistrarMovimiento> {
  // Fase 6 (auditoría de seguridad/contratos): conPermiso ya validó el
  // permiso en LA SUCURSAL DEL QUE LLAMA, nunca que la sección que mandó
  // el cliente sea realmente de esa sucursal — sin esto, cualquier
  // seccionId ajeno (de otra sucursal) se aceptaba igual.
  if (!(await obtenerSeccionPropia(datos.seccionId, actor.sucursalId))) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
  if (datos.proceso === "TRANSFERENCIA" && !(await obtenerSeccionPropia(datos.seccionDestinoId!, actor.sucursalId))) {
    return fracaso("SECCION_DESTINO_NO_ENCONTRADA", "No se encontró la sección destino.");
  }

  // Motivo/Destino: catálogos GLOBALES (no por sucursal, a diferencia de Sección) — solo hace falta que la fila
  // exista y siga activa (un motivo desactivado no puede ELEGIRSE de nuevo, pero las Operacion viejas que ya lo
  // usaban lo conservan, mismo criterio "nunca DELETE" que el resto de los catálogos).
  if (datos.motivoId) {
    const motivo = await cargarMotivoMerma(prisma, datos.motivoId);
    if (!motivo?.activo) return fracaso("MOTIVO_NO_DISPONIBLE", "El motivo elegido ya no está disponible.");
  }
  if (datos.destinoId) {
    const destino = await cargarDestinoConsumo(prisma, datos.destinoId);
    if (!destino?.activo) return fracaso("DESTINO_NO_DISPONIBLE", "El destino elegido ya no está disponible.");
  }

  // El N.º de factura solo se carga en Compra y Devolución a proveedor (los procesos con proveedor): mismo validador que la corrección.
  const factura = guardNroFacturaCompra(datos.nroFactura);
  if (!factura.ok) return fracaso("FACTURA_INVALIDA", factura.mensaje);
  const nroFactura = factura.valor;

  // Chequeo de factura duplicada (Movimientos.js:402-416): mismo
  // proveedor + mismo número de factura ya cargados como Compra en esta
  // sucursal — una factura sin número no se puede comparar, no bloquea.
  // Camino RÁPIDO para el caso secuencial (el 99,99%): rechaza antes de
  // abrir la transacción, con un mensaje inmediato. Bajo concurrencia
  // real (dos requests simultáneos con la misma factura) este `findFirst`
  // no alcanza — ninguno de los dos ve todavía la Operacion del otro
  // (TOCTOU clásico). El árbitro real es el índice único parcial
  // `Operacion_factura_unica_vigente_key` (docs/auditoria-motor2-plan-i3-
  // idempotencia-2026-09-17.md §9.2): su violación se atrapa más abajo,
  // fuera de la transacción (ya hizo rollback para cuando el `.catch`
  // la recibe).
  if (datos.proceso === "COMPRA" && datos.proveedorId && nroFactura) {
    const yaExiste = await existeCompraVigenteConFactura(prisma, { sucursalId: actor.sucursalId, proveedorId: datos.proveedorId, nroFactura });
    if (yaExiste) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
  }

  // Solo se usa para el hookup de Compra, fuera de la transacción — ver más abajo. La forma de ResultadoCaso no tiene
  // lugar para un dato lateral como este (a diferencia del `{ ok, mensaje, lineasParaProveedor }` ad-hoc de antes), así
  // que se captura en una variable del cierre, reasignada SOLO en el intento que efectivamente devuelve éxito.
  let lineasParaProveedor: LineaParaProveedor[] = [];

  const resultado = await conTransaccionSerializable(async (tx): Promise<ResultadoRegistrarMovimiento> => {
    // 0) I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
    const payloadHash = datos.claveIdempotencia
      ? calcularPayloadHash(datos.proceso, actor.sucursalId, { ...datos, claveIdempotencia: undefined })
      : "";
    const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { operacionId: null, movimientos: null, repetida: true });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const obtenerProducto = crearCacheProducto(tx);
    // 1) Armar cada línea (validación de producto/proceso, conversión, receta).
    const lineas: LineaCalculada[] = [];
    for (const item of datos.items) {
      const armado = await armarLineaMovimiento(item, datos, tx, obtenerProducto, actor.sucursalId, actor.sucursalNombre);
      if (!armado.ok) return fracaso("LINEA_INVALIDA", armado.mensaje);
      if (armado.linea) lineas.push(armado.linea);
    }
    if (!lineas.length) return fracaso("SIN_LINEAS_VALIDAS", "Ninguna línea tiene una cantidad válida.");

    // 2) Validación de stock AGREGADA por clave producto+sección dentro
    // de TODO el payload, antes de escribir nada (bugfix C-1,
    // Movimientos.js:910-961): dos líneas pidiendo el mismo
    // producto+sección se suman antes de comparar contra el saldo —
    // nunca se valida cada una aislada.
    const transicion = TRANSICIONES[datos.proceso];
    const requeridoPorClave = new Map<string, { productoId: string; seccionId: string; cantidad: number }>();
    const acumular = (productoId: string, seccionId: string, cantidad: number) => {
      if (!(cantidad > 0)) return;
      const key = `${productoId}||${seccionId}`;
      const previo = requeridoPorClave.get(key);
      requeridoPorClave.set(key, { productoId, seccionId, cantidad: (previo?.cantidad ?? 0) + cantidad });
    };
    for (const l of lineas) {
      if (datos.proceso === "TRANSFERENCIA") acumular(l.productoId, datos.seccionId, l.cantidadIngresada);
      else if (transicion.signoStock < 0) acumular(l.productoId, datos.seccionId, l.cantidadIngresada);
      else if (transicion.signoStock === 0 && l.cantidadFirmada < 0) acumular(l.productoId, datos.seccionId, -l.cantidadFirmada);

      // Canonizado ANTES de validar (hallazgo post-cierre de Task #41, 2026-09-28): `c.cantidad` sale de
      // resolverConsumoPorFamilia/calcularConsumosProduccion sin redondear — el paso 3, más abajo, la ajusta a los
      // decimales de la unidad de stock del insumo ANTES de persistir. Antes de este fix, acá se validaba contra la
      // cantidad CRUDA y se persistía la REDONDEADA — dos valores distintos decidiendo y escribiendo. Mismo cálculo
      // exacto que el paso 3 (misma función, mismos argumentos): al ser puro y determinístico, da el mismo resultado.
      for (const c of l.consumosReceta) {
        const consumido = await obtenerProducto(c.productoId);
        const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, consumido?.unidadStock.decimales ?? 2);
        acumular(c.productoId, datos.seccionId, cantidadRedondeada);
      }
    }
    for (const { productoId, seccionId, cantidad } of requeridoPorClave.values()) {
      const chequeoStock = await validarStockSuficiente(productoId, seccionId, cantidad, tx);
      if (!chequeoStock.ok) {
        const producto = await obtenerProducto(productoId);
        const pista = await seccionesConStock(productoId, actor.sucursalId, tx);
        const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
        return fracaso(
          "STOCK_INSUFICIENTE",
          `Stock insuficiente para "${producto?.nombre ?? productoId}". Actual: ${chequeoStock.actual}, requerido: ${chequeoStock.requerido}.${detallePista}`
        );
      }
    }

    // 3) Escribir Operacion (encabezado) + MovimientoStock[] (líneas).
    const operacion = await escribirOperacionDeStock(tx, {
      sucursalId: actor.sucursalId,
      proceso: datos.proceso,
      fecha: datos.fecha,
      proveedorId: datos.proveedorId ?? null,
      nroFactura,
      seccionDestinoId: datos.proceso === "TRANSFERENCIA" ? (datos.seccionDestinoId ?? null) : null,
      motivoId: datos.motivoId ?? null,
      destinoId: datos.destinoId ?? null,
      detalleLibre: texto(datos.detalleLibre) || null,
      usuarioId: actor.usuarioId,
      claveIdempotencia: datos.claveIdempotencia ?? null,
      payloadHash: datos.claveIdempotencia ? payloadHash : null,
    });

    const filas: Prisma.MovimientoStockCreateManyInput[] = [];

    if (datos.proceso === "TRANSFERENCIA") {
      for (const l of lineas) {
        filas.push({
          operacionId: operacion.id, productoId: l.productoId, seccionId: datos.seccionId, proceso: "TRANSFERENCIA",
          cantidad: -l.cantidadIngresada, loteVencimiento: l.loteVencimiento,
          detalle: `Transferencia: sale hacia la sección destino (${l.cantidadIngresada}).`, precioTotal: 0, precioPorUnidadStock: 0,
        });
        filas.push({
          operacionId: operacion.id, productoId: l.productoId, seccionId: datos.seccionDestinoId!, proceso: "TRANSFERENCIA",
          cantidad: l.cantidadIngresada, loteVencimiento: l.loteVencimiento,
          detalle: `Transferencia: entra desde la sección origen (${l.cantidadIngresada}).`, precioTotal: 0, precioPorUnidadStock: 0,
        });
      }
    } else {
      for (const l of lineas) {
        filas.push({
          operacionId: operacion.id, productoId: l.productoId, seccionId: datos.seccionId, proceso: datos.proceso,
          cantidad: l.cantidadFirmada, loteVencimiento: l.loteVencimiento,
          detalle: l.detalle, precioTotal: l.precioTotal, precioPorUnidadStock: l.precioPorUnidadStock,
        });

        for (const c of l.consumosReceta) {
          // La cantidad que sale de resolverConsumoPorFamilia/calcularConsumosProduccion
          // todavía no pasó por ningún redondeo — recién acá, antes de
          // persistir, se ajusta a los decimales que admite la unidad de
          // stock de ESTE insumo (mismo criterio que ya aplica venta.ts
          // para el consumo de receta generado por una venta).
          const consumido = await obtenerProducto(c.productoId);
          const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, consumido?.unidadStock.decimales ?? 2);

          filas.push({
            operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "CONSUMO",
            cantidad: -cantidadRedondeada, loteVencimiento: c.loteVencimiento,
            detalle: "Consumo por producción.", precioTotal: 0, precioPorUnidadStock: 0,
          });

          // Sesión "consignación": si el insumo consumido está marcado
          // esConsignacion, ACÁ (al producir) es cuando se lo consume de
          // verdad — cantidad SIEMPRE 0 (el stock ya lo movió la Compra
          // de recepción), fila puramente financiera. Quién es el
          // consignante se lee vía FK (producto.proveedorConsignacion),
          // no hace falta duplicarlo en la fila (a diferencia de Apps
          // Script, que no podía hacer ese join).
          if (consumido?.esConsignacion) {
            filas.push({
              operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
              cantidad: 0, loteVencimiento: null,
              detalle: "Liquidación consignación por producción.",
              precioTotal: importeDeLinea(cantidadRedondeada, Number(consumido.precioConsignacion ?? 0)),
              precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
            });
          }
        }
      }
    }

    await escribirLineasDeMovimientoStock(tx, filas);

    const avisoConversion = lineas.some((l) => l.huboConversion)
      ? " Algunas cantidades se convirtieron automáticamente de unidad de compra a unidad de stock."
      : "";
    const mensaje = `Se guardaron ${filas.length} movimiento(s).${avisoConversion}`;

    // I3 — Opción B (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md
    // §4.5): se persiste el mensaje ya formateado, no se reconstruye.
    if (datos.claveIdempotencia) {
      await registrarResultadoIdempotente(tx, operacion.id, mensaje);
    }

    lineasParaProveedor = lineas.map((l) => ({
      productoId: l.productoId,
      unidadCompraId: l.unidadCompraId,
      precioUnitario: l.precioUnitario,
      precioPorUnidadStock: l.precioPorUnidadStock,
      referenciaProveedor: l.referenciaProveedor,
    }));

    return exito(mensaje, { operacionId: operacion.id, movimientos: filas.length, repetida: false });
  }).catch((e) => {
    // La transacción ya hizo rollback para cuando este catch la recibe — nunca se intenta seguir operando
    // sobre ella. Choque de la carrera de factura duplicada (dos requests simultáneos, ver el comentario del
    // chequeo previo más arriba): mismo mensaje de negocio, no un error 500. Cualquier otro P2002 (ej. la
    // clave de idempotencia en carrera) NO lo reconoce esChoqueDeFacturaUnica — sigue de largo como error real.
    if (esChoqueDeFacturaUnica(e)) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
    throw e;
  });

  // Paso 6 (Compra): ver el docstring de `registrarProveedoresDeLaCompra` más arriba. `!resultado.datos.repetida`
  // explícito (backlog post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §4): en el camino
  // de idempotencia "duplicado" `lineasParaProveedor` queda en `[]` (el cierre nunca llega a reasignarla, el
  // `return` de I3 pasa antes del paso 1) — hoy este guard es un no-op porque el bucle de abajo no itera nada, no
  // porque el contrato lo garantice. Dejarlo explícito documenta la regla real ("un duplicado no vuelve a tocar
  // Catálogo") en vez de depender de que nadie cambie el orden de la inicialización de `lineasParaProveedor`.
  if (resultado.ok && !resultado.datos.repetida && datos.proceso === "COMPRA" && datos.proveedorId) {
    await registrarProveedoresDeLaCompra(datos.proveedorId, datos.fecha, lineasParaProveedor);
  }

  return resultado;
}
