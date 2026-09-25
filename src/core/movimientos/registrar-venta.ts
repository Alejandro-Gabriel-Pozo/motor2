import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { redondearACantidadDeUnidad, redondearMoneda } from "@/core/movimientos/transiciones";
import { importeDeLinea } from "@/core/moneda";
import { obtenerLoteMasProximoAVencer, obtenerSeccionPropia, resolverConsumoPorFamilia, seccionesConStock, validarStockSuficiente } from "@/core/movimientos/stock";
import { productoDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { resolverPrecioVenta } from "@/core/movimientos/precio-venta";
import { calcularCostosYMargenes } from "@/core/reportes/costos";
import { crearCacheProducto } from "@/core/movimientos/producto-cache";

/**
 * Núcleo de la Venta, SIN permisos ni transacción propia (no es una Server Action: sin "use server"). Extraído tal cual de
 * `registrarVenta` (src/server/actions/movimientos/venta.ts) para que el cierre de una cuenta del salón (`cerrarCuenta`,
 * src/server/actions/pos/cuenta.ts) registre la venta con EXACTAMENTE la misma validación y escritura, dentro de SU transacción
 * (docs/plan-tomar-pedido-2026-09-25.md, B6). Quien llama es responsable de: el permiso, la transacción serializable
 * (`conTransaccionSerializable`) y — si aplica — el chequeo de idempotencia previo.
 *
 * Dos extensiones internas, que la Server Action pública NUNCA expone (mapea cada línea a `{ productoId, cantidadVendida }` a mano):
 * - `precioUnitario` por línea: reemplaza a `resolverPrecioVenta`. Lo usa `cerrarCuenta` para cobrar el precio CONGELADO al tomar
 *   el pedido, no el de hoy.
 * - `opciones.permitirStockNegativo` (B6bis, decisión del dueño): con `true`, un insumo sin stock suficiente NO aborta la venta; el
 *   movimiento se escribe igual (el Kardex es un ledger por suma: el saldo queda negativo) y se devuelve en `avisosStockNegativo`.
 *   Ausente o `false` (el caso de `registrarVenta`): rechaza igual que siempre.
 */

export interface ActorVenta {
  usuarioId: string;
  sucursalId: string;
  sucursalNombre: string;
}

export interface LineaVentaEnTx {
  productoId: string;
  cantidadVendida: number;
  /** Override INTERNO del precio de venta (ver el docstring del módulo). Ausente = Precio Local o global de hoy. */
  precioUnitario?: number;
}

export interface DatosVentaEnTx {
  fecha: Date;
  seccionId: string;
  proveedorId?: string | null;
  nroFactura?: string;
  detalle?: string;
  lineas: LineaVentaEnTx[];
}

export interface OpcionesVentaEnTx {
  permitirStockNegativo?: boolean;
  /** I3: clave y hash del intento, que se guardan en la PRIMERA Operacion del lote junto con el mensaje devuelto (ver registrarVenta). */
  idempotencia?: { clave: string; payloadHash: string };
}

export interface AvisoStockNegativo {
  productoId: string;
  nombre: string;
  /** Saldo del insumo en la sección ANTES de esta venta. */
  actual: number;
  /** Lo que la venta consumió de ese insumo. */
  requerido: number;
  /** Saldo con el que quedó después de la venta (negativo). */
  resultante: number;
}

export type ResultadoVentaEnTx =
  | { ok: true; mensaje: string; operacionIds: string[]; avisosStockNegativo: AvisoStockNegativo[] }
  | { ok: false; mensaje: string };

interface ConsumoCalculado {
  productoId: string;
  cantidad: number;
  loteVencimiento: Date | null;
}

interface VentaCalculada {
  productoId: string;
  cantidadVendida: number;
  loteVencimiento: Date | null;
  precioVenta: number;
  /** Costo de receta resuelto AL MOMENTO de esta venta (docstring en schema.prisma, MovimientoStock.costoUnitarioVenta) — null si el costeo estaba incompleto ese día. */
  costoUnitarioAlVender: number | null;
  consumos: ConsumoCalculado[];
}

function fallo(mensaje: string): { ok: false; mensaje: string } {
  return { ok: false, mensaje };
}

/**
 * Port de armarPreviaVentaDesdeItems_ (Movimientos.js:1682-1775) para UNA
 * línea. Sesión "eliminar COMPRA+VENTA": lo único vendible es un PV
 * (vinculado por receta a la MP que consume, aunque sea una receta 1:1 sin
 * merma) — ya no existe la venta directa de una MP.
 */
async function armarVentaCalculada(
  item: LineaVentaEnTx,
  seccionId: string,
  sucursalId: string,
  sucursalNombre: string,
  tx: Prisma.TransactionClient,
  obtenerProducto: ReturnType<typeof crearCacheProducto>,
  costoUnitarioPorProducto: Map<string, number | null>
): Promise<{ ok: true; venta: VentaCalculada | null } | { ok: false; mensaje: string }> {
  const cantidad = Number(item.cantidadVendida || 0);
  if (!(cantidad > 0)) return { ok: true, venta: null };
  if (!esNumeroFinito(cantidad)) return { ok: false, mensaje: "La cantidad vendida no es un número válido." };

  const producto = await obtenerProducto(item.productoId);
  if (!producto) return { ok: false, mensaje: `El producto no existe.` };
  if (!(await productoDisponibleEn(sucursalId, producto.id, tx))) {
    return { ok: false, mensaje: `«${producto.nombre}» no está disponible en «${sucursalNombre}».` };
  }
  if (producto.tipo !== "PV") {
    return { ok: false, mensaje: `"${producto.nombre}" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).` };
  }

  const consumos: ConsumoCalculado[] = [];
  if (!producto.seProduce) {
    // Un PV que se produce por lote ya consumió su receta al producirse — la venta solo lo resta (ver registrarMovimiento, PRODUCCION).
    const receta = await tx.recetaVersion.findFirst({ where: { productoId: producto.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
    for (const ing of receta?.ingredientes ?? []) {
      const mp = await obtenerProducto(ing.insumoProductoId);
      if (!mp || mp.tipo !== "MP") {
        return { ok: false, mensaje: `La materia prima de la receta de "${producto.nombre}" no está marcada como MP.` };
      }
      if (!(await productoDisponibleEn(sucursalId, mp.id, tx))) {
        return { ok: false, mensaje: `La receta de «${producto.nombre}» usa «${mp.nombre}», que no está disponible en «${sucursalNombre}»: activala acá o cambiá la receta.` };
      }
      const cantidadSalida = cantidad * Number(ing.cantidad) * (1 + Number(ing.mermaPorcentaje) / 100);
      const reparto = await resolverConsumoPorFamilia(ing.insumoProductoId, cantidadSalida, seccionId, tx, obtenerProducto);
      consumos.push(...reparto);
    }
  }

  // El PV vendido también puede tener lotes propios si está marcado "Se
  // produce" — siempre el que vence antes (FEFO), nunca a elección manual:
  // mismo criterio que ya usa el consumo de MP vía receta (resolverConsumoPorFamilia),
  // y el dato ya está en el Kardex desde que se produjo, no hace falta pedírselo a quien vende.
  const loteVencimiento = producto.seProduce ? await obtenerLoteMasProximoAVencer(producto.id, seccionId, tx) : null;

  const precioVenta = item.precioUnitario ?? (await resolverPrecioVenta(sucursalId, producto.id, Number(producto.precioVenta), tx));
  const costoUnitarioAlVender = costoUnitarioPorProducto.get(producto.id) ?? null;

  return {
    ok: true,
    venta: { productoId: producto.id, cantidadVendida: cantidad, loteVencimiento, precioVenta, costoUnitarioAlVender, consumos },
  };
}

/**
 * Port de confirmarRegistrarVenta_ConLock_ (Movimientos.js:1154-1332).
 * A diferencia del resto de los procesos, cada venta individual del lote
 * es su propia Operacion (idOperacionVenta propio en Apps Script) — para
 * poder reconstruir "qué consumió esta venta puntual" (con su Liquidación
 * de consignación si aplica) sin mezclarse con las demás ventas
 * confirmadas en el mismo lote. La validación de stock, en cambio, se hace
 * UNA vez sobre TODO el payload junto (mismo bugfix C-1 que registrarMovimiento).
 *
 * Toda la validación ocurre ANTES de la primera escritura: un `ok: false` no deja nada escrito en la transacción de quien llama.
 * `operacionIds` sale en el orden de las líneas con cantidad válida (una Operacion por línea).
 */
export async function registrarVentaEnTx(
  tx: Prisma.TransactionClient,
  actor: ActorVenta,
  datos: DatosVentaEnTx,
  opciones: OpcionesVentaEnTx = {}
): Promise<ResultadoVentaEnTx> {
  // Fase 6 (auditoría de seguridad/contratos): conPermiso no valida que la sección sea de ESTA sucursal, solo el permiso de quien llama.
  if (!(await obtenerSeccionPropia(datos.seccionId, actor.sucursalId, tx))) return fallo("No se encontró la sección.");

  const obtenerProducto = crearCacheProducto(tx);
  // Una sola resolución de costos para todo el lote (no por línea) —
  // calcularCostosYMargenes ya recorre el catálogo entero, repetirla
  // por ítem sería trabajo redundante dentro de la misma transacción.
  const costosDeHoy = await calcularCostosYMargenes(actor.sucursalId, tx);
  const costoUnitarioPorProducto = new Map(costosDeHoy.map((c) => [c.productoId, c.costoIncompleto ? null : c.costo]));
  const ventas: VentaCalculada[] = [];
  for (const item of datos.lineas) {
    const armado = await armarVentaCalculada(item, datos.seccionId, actor.sucursalId, actor.sucursalNombre, tx, obtenerProducto, costoUnitarioPorProducto);
    if (!armado.ok) return fallo(armado.mensaje);
    if (armado.venta) ventas.push(armado.venta);
  }
  if (!ventas.length) return fallo("Ninguna línea tiene una cantidad válida.");

  // Validación de stock agregada: cada consumo de receta descuenta
  // stock real — el producto vendido en sí nunca descuenta su propio
  // stock (solo lo que consume su receta), mismo criterio que Apps
  // Script desde "eliminar COMPRA+VENTA".
  const requeridoPorClave = new Map<string, { productoId: string; cantidad: number }>();
  for (const venta of ventas) {
    for (const c of venta.consumos) {
      const key = c.productoId;
      const previo = requeridoPorClave.get(key);
      requeridoPorClave.set(key, { productoId: c.productoId, cantidad: (previo?.cantidad ?? 0) + c.cantidad });
    }
  }
  const avisosStockNegativo: AvisoStockNegativo[] = [];
  for (const { productoId, cantidad } of requeridoPorClave.values()) {
    const chequeo = await validarStockSuficiente(productoId, datos.seccionId, cantidad, tx);
    if (!chequeo.ok) {
      const producto = await obtenerProducto(productoId);
      if (opciones.permitirStockNegativo) {
        const decimales = producto?.unidadStock.decimales ?? 2;
        avisosStockNegativo.push({
          productoId,
          nombre: producto?.nombre ?? productoId,
          actual: chequeo.actual,
          requerido: redondearACantidadDeUnidad(chequeo.requerido, decimales),
          resultante: redondearACantidadDeUnidad(chequeo.actual - chequeo.requerido, decimales),
        });
        continue;
      }
      const pista = await seccionesConStock(productoId, actor.sucursalId, tx);
      const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
      return fallo(`Stock insuficiente para "${producto?.nombre ?? productoId}". Actual: ${chequeo.actual}, requerido: ${chequeo.requerido}.${detallePista}`);
    }
  }

  const filas: Prisma.MovimientoStockCreateManyInput[] = [];
  const operacionIds: string[] = [];
  for (const venta of ventas) {
    const producto = await obtenerProducto(venta.productoId);
    const esPrimera = operacionIds.length === 0;
    const operacion: { id: string } = await tx.operacion.create({
      data: {
        sucursalId: actor.sucursalId,
        proceso: "VENTA",
        fecha: datos.fecha,
        proveedorId: datos.proveedorId ?? null,
        nroFactura: texto(datos.nroFactura) || null,
        detalleLibre: texto(datos.detalle) || null,
        usuarioId: actor.usuarioId,
        claveIdempotencia: esPrimera && opciones.idempotencia ? opciones.idempotencia.clave : null,
        payloadHash: esPrimera && opciones.idempotencia ? opciones.idempotencia.payloadHash : null,
      },
    });
    operacionIds.push(operacion.id);

    for (const c of venta.consumos) {
      const consumido = await obtenerProducto(c.productoId);
      const cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, consumido?.unidadStock.decimales ?? 2);
      filas.push({
        operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "CONSUMO",
        cantidad: -cantidadRedondeada, loteVencimiento: c.loteVencimiento,
        detalle: `Consumo por venta de "${producto?.nombre ?? venta.productoId}".`, precioTotal: 0, precioPorUnidadStock: 0,
      });

      if (consumido?.esConsignacion) {
        filas.push({
          operacionId: operacion.id, productoId: c.productoId, seccionId: datos.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
          cantidad: 0, loteVencimiento: null,
          detalle: `Liquidación consignación por venta de "${producto?.nombre ?? venta.productoId}".`,
          precioTotal: importeDeLinea(cantidadRedondeada, Number(consumido.precioConsignacion ?? 0)),
          precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
        });
      }
    }

    // El PV vendido en sí: signoStock -1 (Movimientos.js:190-205) — si
    // no tiene stock real (no "Se produce"), este saldo negativo es un
    // artefacto contable de las ventas, mismo criterio que hoy.
    const importeVenta = redondearMoneda(venta.cantidadVendida * venta.precioVenta);
    filas.push({
      operacionId: operacion.id, productoId: venta.productoId, seccionId: datos.seccionId, proceso: "VENTA",
      cantidad: -venta.cantidadVendida, loteVencimiento: venta.loteVencimiento,
      detalle: texto(datos.detalle) || "Venta", precioTotal: importeVenta, precioPorUnidadStock: redondearMoneda(venta.precioVenta),
      costoUnitarioVenta: venta.costoUnitarioAlVender !== null ? redondearMoneda(venta.costoUnitarioAlVender) : null,
    });
  }

  await tx.movimientoStock.createMany({ data: filas });
  const mensaje = `Se registraron ${ventas.length} venta(s) correctamente.`;

  if (opciones.idempotencia) {
    await tx.operacion.update({ where: { id: operacionIds[0] }, data: { resultadoMensaje: mensaje } });
  }

  return { ok: true, mensaje, operacionIds, avisosStockNegativo };
}
