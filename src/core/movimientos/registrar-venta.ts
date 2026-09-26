import type { Prisma } from "@prisma/client";
import { texto } from "@/core/texto";
import { esNumeroFinito } from "@/core/numero";
import { redondearACantidadDeUnidad, redondearMoneda } from "@/core/movimientos/transiciones";
import { importeDeLinea } from "@/core/moneda";
import { seccionesConStock } from "@/core/movimientos/stock";
import { asignarConsumo, elegirSeccionDeStockPropio, faltantesDe, type ParteAsignada } from "@/core/movimientos/origen-venta";
import { cargarDatosDeOrigen, prepararOrigen, type OrigenVenta } from "@/core/movimientos/origen-venta-datos";
import { productoDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { resolverPrecioVenta } from "@/core/movimientos/precio-venta";
import { calcularCostosYMargenes } from "@/core/reportes/costos";
import { crearCacheProducto } from "@/core/movimientos/producto-cache";
import { rendimientoEfectivo } from "@/core/catalogo/rendimiento-local";

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
 *
 * DE QUÉ SECCIÓN SALE cada consumo lo decide `origen` (docs/plan-seccion-habitual-stock-2026-09-25.md, C5): `{ tipo: "seccion" }` (la
 * elegida por una persona: mostrador) o `{ tipo: "automatico" }` (el cierre del POS). En los dos casos los consumos se asignan con el
 * LIBRO de `origen-venta.ts`, que lleva la cuenta de lo ya asignado entre las líneas de la misma venta (arregla H9).
 */

export type { OrigenVenta };

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
  origen: OrigenVenta;
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
  /** Sección en la que quedó en negativo. */
  seccionId: string;
  seccionNombre: string;
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

/** Una línea validada, todavía SIN sección: lo que pide su receta (o su stock propio, si se produce) se asigna después, con el libro. */
interface LineaArmada {
  productoId: string;
  nombre: string;
  seProduce: boolean;
  cantidadVendida: number;
  precioVenta: number;
  /** Costo de receta resuelto AL MOMENTO de esta venta (docstring en schema.prisma, MovimientoStock.costoUnitarioVenta) — null si el costeo estaba incompleto ese día. */
  costoUnitarioAlVender: number | null;
  /** Consumo de receta por ingrediente, en el orden de los ingredientes (id ascendente: determinístico para el libro). */
  pedidos: { productoId: string; cantidad: number }[];
}

interface VentaCalculada extends LineaArmada {
  seccionId: string;
  loteVencimiento: Date | null;
  consumos: ParteAsignada[];
}

function fallo(mensaje: string): { ok: false; mensaje: string } {
  return { ok: false, mensaje };
}

/**
 * Port de armarPreviaVentaDesdeItems_ (Movimientos.js:1682-1775) para UNA
 * línea. Sesión "eliminar COMPRA+VENTA": lo único vendible es un PV
 * (vinculado por receta a la MP que consume, aunque sea una receta 1:1 sin
 * merma) — ya no existe la venta directa de una MP. Valida y devuelve lo que
 * pide la receta; NO decide secciones ni lotes (eso lo hace el libro, con
 * todas las líneas a la vista).
 */
async function armarLinea(
  item: LineaVentaEnTx,
  sucursalId: string,
  sucursalNombre: string,
  tx: Prisma.TransactionClient,
  obtenerProducto: ReturnType<typeof crearCacheProducto>,
  costoUnitarioPorProducto: Map<string, number | null>
): Promise<{ ok: true; linea: LineaArmada | null } | { ok: false; mensaje: string }> {
  const cantidad = Number(item.cantidadVendida || 0);
  if (!(cantidad > 0)) return { ok: true, linea: null };
  if (!esNumeroFinito(cantidad)) return { ok: false, mensaje: "La cantidad vendida no es un número válido." };

  const producto = await obtenerProducto(item.productoId);
  if (!producto) return { ok: false, mensaje: `El producto no existe.` };
  if (!(await productoDisponibleEn(sucursalId, producto.id, tx))) {
    return { ok: false, mensaje: `«${producto.nombre}» no está disponible en «${sucursalNombre}».` };
  }
  if (producto.tipo !== "PV") {
    return { ok: false, mensaje: `"${producto.nombre}" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).` };
  }

  const pedidos: LineaArmada["pedidos"] = [];
  if (!producto.seProduce) {
    // Un PV que se produce por lote ya consumió su receta al producirse — la venta solo lo resta (ver registrarMovimiento, PRODUCCION).
    const receta = await tx.recetaVersion.findFirst({
      where: { productoId: producto.id },
      orderBy: { version: "desc" },
      include: { ingredientes: { orderBy: { id: "asc" }, include: { rendimientosLocales: { where: { sucursalId } } } } },
    });
    for (const ing of receta?.ingredientes ?? []) {
      const mp = await obtenerProducto(ing.insumoProductoId);
      if (!mp || mp.tipo !== "MP") {
        return { ok: false, mensaje: `La materia prima de la receta de "${producto.nombre}" no está marcada como MP.` };
      }
      if (!(await productoDisponibleEn(sucursalId, mp.id, tx))) {
        return { ok: false, mensaje: `La receta de «${producto.nombre}» usa «${mp.nombre}», que no está disponible en «${sucursalNombre}»: activala acá o cambiá la receta.` };
      }
      // rendimientoEfectivo (D2, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md): la fórmula queda TEXTUALMENTE
      // igual, solo cambia de dónde salen los dos operandos — sin ninguna calibración de ESTA sucursal, ef.* es
      // exactamente ing.cantidad/ing.mermaPorcentaje (Object.is), así que el cálculo de siempre no se mueve un bit.
      const ef = rendimientoEfectivo(
        { cantidad: Number(ing.cantidad), mermaPorcentaje: Number(ing.mermaPorcentaje) },
        ing.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null })),
        sucursalId
      );
      pedidos.push({ productoId: ing.insumoProductoId, cantidad: cantidad * ef.cantidad * (1 + ef.mermaPorcentaje / 100) });
    }
  }

  const precioVenta = item.precioUnitario ?? (await resolverPrecioVenta(sucursalId, producto.id, Number(producto.precioVenta), tx));
  const costoUnitarioAlVender = costoUnitarioPorProducto.get(producto.id) ?? null;

  return {
    ok: true,
    linea: { productoId: producto.id, nombre: producto.nombre, seProduce: producto.seProduce, cantidadVendida: cantidad, precioVenta, costoUnitarioAlVender, pedidos },
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
  const origen = await prepararOrigen(tx, actor.sucursalId, datos.origen);
  if (!origen.ok) return fallo(origen.mensaje);

  const obtenerProducto = crearCacheProducto(tx);
  // Una sola resolución de costos para todo el lote (no por línea) —
  // calcularCostosYMargenes ya recorre el catálogo entero, repetirla
  // por ítem sería trabajo redundante dentro de la misma transacción.
  const costosDeHoy = await calcularCostosYMargenes(actor.sucursalId, tx);
  const costoUnitarioPorProducto = new Map(costosDeHoy.map((c) => [c.productoId, c.costoIncompleto ? null : c.costo]));
  const lineas: LineaArmada[] = [];
  for (const item of datos.lineas) {
    const armado = await armarLinea(item, actor.sucursalId, actor.sucursalNombre, tx, obtenerProducto, costoUnitarioPorProducto);
    if (!armado.ok) return fallo(armado.mensaje);
    if (armado.linea) lineas.push(armado.linea);
  }
  if (!lineas.length) return fallo("Ninguna línea tiene una cantidad válida.");

  // De qué sección y lote sale cada cosa: todo con UN libro para la venta entera, en el orden de las líneas y de sus ingredientes.
  const mpIds = Array.from(new Set(lineas.flatMap((l) => l.pedidos.map((p) => p.productoId))));
  const pvQueSeProducenIds = Array.from(new Set(lineas.filter((l) => l.seProduce).map((l) => l.productoId)));
  const pvIds = Array.from(new Set(lineas.map((l) => l.productoId)));
  const origenDatos = await cargarDatosDeOrigen(tx, actor.sucursalId, origen, { pvIds, mpIds, pvQueSeProducenIds });
  const { libro, respaldos, seccionPorDefectoId } = origenDatos;
  // Sin ninguna sección de respaldo (todas excluidas con `sirveDeRespaldoEnVentas`), un PV sin habitual no tiene de dónde salir: se
  // rechaza ANTES de escribir nada, con la salida concreta (distinto de «sin secciones activas»: la solución es otra).
  if (!respaldos.length) {
    const sinHabitual = lineas.find((l) => !origenDatos.habitualDe(l.productoId));
    if (sinHabitual) {
      return fallo(
        `Ninguna sección de «${actor.sucursalNombre}» sirve de respaldo automático en ventas y «${sinHabitual.nombre}» no tiene sección habitual: ` +
          "configurá su sección habitual (Stock → Sección habitual) o marcá una sección como respaldo (Movimientos → Secciones)."
      );
    }
  }
  const ventas: VentaCalculada[] = lineas.map((linea) => {
    const habitual = origenDatos.habitualDe(linea.productoId);
    if (linea.seProduce) {
      // El PV vendido también puede tener lotes propios si está marcado "Se produce" — siempre el que vence antes (FEFO), nunca a
      // elección manual; el dato ya está en el Kardex desde que se produjo, no hace falta pedírselo a quien vende.
      const propia = elegirSeccionDeStockPropio(libro, {
        productoId: linea.productoId,
        cantidad: linea.cantidadVendida,
        seccionHabitual: habitual,
        respaldos,
        seccionSiNingunaAlcanzaId: habitual?.id ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId,
      });
      return { ...linea, seccionId: propia.seccionId, loteVencimiento: propia.loteVencimiento, consumos: [] };
    }
    const consumos = linea.pedidos.flatMap((p) =>
      asignarConsumo(libro, {
        productoId: p.productoId,
        familia: origenDatos.familiaDe(p.productoId),
        cantidad: p.cantidad,
        seccionHabitual: habitual,
        respaldos,
        seccionParaFaltanteId: habitual?.id ?? origenDatos.referenciaDe(p.productoId) ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId,
      })
    );
    const seccionId = habitual?.id ?? consumos[0]?.seccionId ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId;
    return { ...linea, seccionId, loteVencimiento: null, consumos };
  });

  // Validación de stock agregada: cada consumo de receta descuenta
  // stock real — el producto vendido en sí nunca descuenta su propio
  // stock (solo lo que consume su receta), mismo criterio que Apps
  // Script desde "eliminar COMPRA+VENTA". El libro ya sumó todas las líneas.
  const familiasIds = new Set(mpIds.flatMap((id) => origenDatos.familiaDe(id)));
  const avisosStockNegativo: AvisoStockNegativo[] = [];
  for (const faltante of faltantesDe(libro, familiasIds)) {
    const producto = await obtenerProducto(faltante.productoId);
    if (opciones.permitirStockNegativo) {
      const decimales = producto?.unidadStock.decimales ?? 2;
      avisosStockNegativo.push({
        productoId: faltante.productoId,
        nombre: producto?.nombre ?? faltante.productoId,
        seccionId: faltante.seccionId,
        seccionNombre: origenDatos.nombreDeSeccion(faltante.seccionId),
        actual: faltante.actual,
        requerido: redondearACantidadDeUnidad(faltante.requerido, decimales),
        resultante: redondearACantidadDeUnidad(faltante.actual - faltante.requerido, decimales),
      });
      continue;
    }
    const pista = await seccionesConStock(faltante.productoId, actor.sucursalId, tx);
    const detallePista = pista.length ? ` Tiene stock en: ${pista.join(", ")}.` : "";
    return fallo(`Stock insuficiente para "${producto?.nombre ?? faltante.productoId}". Actual: ${faltante.actual}, requerido: ${faltante.requerido}.${detallePista}`);
  }

  const filas: Prisma.MovimientoStockCreateManyInput[] = [];
  const operacionIds: string[] = [];
  for (const venta of ventas) {
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
        operacionId: operacion.id, productoId: c.productoId, seccionId: c.seccionId, proceso: "CONSUMO",
        cantidad: -cantidadRedondeada, loteVencimiento: c.loteVencimiento,
        detalle: `Consumo por venta de "${venta.nombre}".`, precioTotal: 0, precioPorUnidadStock: 0,
      });

      if (consumido?.esConsignacion) {
        filas.push({
          operacionId: operacion.id, productoId: c.productoId, seccionId: c.seccionId, proceso: "LIQUIDACION_CONSIGNACION",
          cantidad: 0, loteVencimiento: null,
          detalle: `Liquidación consignación por venta de "${venta.nombre}".`,
          precioTotal: importeDeLinea(cantidadRedondeada, Number(consumido.precioConsignacion ?? 0)),
          precioPorUnidadStock: redondearMoneda(Number(consumido.precioConsignacion ?? 0)),
        });
      }
    }

    // El PV vendido en sí: signoStock -1 (Movimientos.js:190-205) — si
    // no tiene stock real (no "Se produce"), este saldo negativo es un
    // artefacto contable de las ventas, mismo criterio que hoy.
    const importeVenta = importeDeLinea(venta.cantidadVendida, venta.precioVenta);
    filas.push({
      operacionId: operacion.id, productoId: venta.productoId, seccionId: venta.seccionId, proceso: "VENTA",
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
