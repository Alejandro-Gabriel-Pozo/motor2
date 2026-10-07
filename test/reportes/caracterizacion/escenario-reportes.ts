import { prisma } from "../../setup/test-db";

/**
 * El escenario de la caracterización de los reportes (`reportes-c0.test.ts`): UNA secuencia de datos, sembrada directo por Prisma (sin acciones ni sesión), con fechas
 * FIJAS en febrero-marzo de 2026 y el reloj del test congelado en 2026-03-15 15:00 UTC.
 *
 * Por qué todo a mano y con ids FIJOS (y no `sembrarSalon`/`sembrarBase`, que generan cuids al azar):
 *  - Varios reportes devuelven filas en el orden en que las entrega la base sin `ORDER BY` (un `groupBy` con agregado por hash, un `include` sin orden) o
 *    desempatan por `id` (`ORDER BY fecha, id`, `DISTINCT ON`). Con cuids al azar ese orden cambiaría de una corrida a la otra y el golden flaquearía. Con ids
 *    deterministas (`c` + 24 dígitos, en orden de creación) la base queda IDÉNTICA en cada corrida, y el plan de la base también.
 *  - `creadoEn` se fija a mano en cada fila que lo tiene (`fecha + n ms`, `n` creciente): dos filas de la misma transacción comparten `now()` y los reportes que
 *    ordenan por `creadoEn` (renglones de una compra, ítems de un ticket, conteos del mismo día) desempatarían al azar.
 *  - Cada operación tiene su propia hora (aunque sean del mismo cierre de cuenta): los reportes ordenan por `Operacion.fecha` y un empate entre operaciones
 *    distintas también dependería del plan.
 *
 * Lo que se siembra (Central = S1, Norte = S2), pensado para que CADA reporte tenga algo que mostrar:
 *  - Catálogo: kg/unidad/litro; grupo «No comestibles» > «Packaging» (la caja de pizza es no comestible) y «Lácteos»; categorías Pizzas/Bebidas/Postres;
 *    food cost objetivo de la empresa (35 %) y de Pizzas (30 %); insumos Queso (dos MP: Muzzarella A y B, el pool COMPARTIDO de rendimiento), Harina (dos MP en
 *    unidades distintas: unidad mezclada), Vino (en consignación), Caja y Aceite; Tomate sin insumo; Salsa casera «Se produce» con lotes; PV Pizza, Napolitana,
 *    Copa de vino, Flan (vendido SIN receta) y Empanada (nunca vendida, sin categoría).
 *  - Kardex: compras antes y dentro del período (con y sin proveedor, una consignación sin precio, una ANULADA con su contra-asiento), ventas de mostrador
 *    con costo congelado y sin él (se reconstruye), ventas con cliente con descuento (Ana 10 %, Beto 20 %), una venta anulada, producción de Salsa con lotes,
 *    merma con motivo, consumo con destino, ajuste manual, devolución a proveedor y de cliente, conteos físicos (con y sin diferencia, por lote), pago al
 *    consignante, y una compra/venta en la segunda sucursal.
 *  - POS: dos cuentas cerradas el 2026-03-14 (una con cliente y ticket CORREGIDO, otra con una promo y un ítem con descuento de producto) y una abierta.
 *  - Global: cotización del dólar (BNA y BCRA), serie del IPC (dic-2025 a feb-2026), registro de auditoría de dos cambios de precio de carta.
 */

let contadorDeIds = 0;
let contadorDeMarcas = 0;

/** Un id con forma de cuid (`c` + 24 caracteres) que crece con el orden de creación: la base queda igual en cada corrida. */
function nuevoId(): string {
  contadorDeIds += 1;
  return `c${String(contadorDeIds).padStart(24, "0")}`;
}

/** `creadoEn` de una fila: la fecha de su operación más un milisegundo creciente, para que ningún orden por `creadoEn` empate. */
function marca(fecha: Date): Date {
  contadorDeMarcas += 1;
  return new Date(fecha.getTime() + contadorDeMarcas);
}

const f = (iso: string) => new Date(iso);

type Linea = {
  productoId: string;
  seccionId: string;
  proceso: string;
  cantidad: number;
  precioTotal?: number;
  precioPorUnidadStock?: number;
  costoUnitarioVenta?: number | null;
  precioListaUnitario?: number | null;
  loteVencimiento?: string | null;
  detalle: string;
  conteoFisicoId?: string;
};

type DatosOperacion = {
  proceso: string;
  fecha: string;
  sucursalId: string;
  usuarioId: string;
  proveedorId?: string | null;
  clienteId?: string | null;
  promoCuentaId?: string | null;
  nroFactura?: string | null;
  detalleLibre?: string | null;
  motivoId?: string | null;
  destinoId?: string | null;
};

/** Una Operación y sus líneas de Kardex, cada una con su id y su `creadoEn` fijos (en el orden dado). Devuelve el id de la operación. */
async function operacion(datos: DatosOperacion, lineas: Linea[]): Promise<string> {
  const id = nuevoId();
  const fecha = f(datos.fecha);
  await prisma.operacion.create({
    data: {
      id,
      sucursalId: datos.sucursalId,
      proceso: datos.proceso as never,
      fecha,
      usuarioId: datos.usuarioId,
      proveedorId: datos.proveedorId ?? null,
      clienteId: datos.clienteId ?? null,
      promoCuentaId: datos.promoCuentaId ?? null,
      nroFactura: datos.nroFactura ?? null,
      detalleLibre: datos.detalleLibre ?? null,
      motivoId: datos.motivoId ?? null,
      destinoId: datos.destinoId ?? null,
      creadoEn: marca(fecha),
    },
  });
  for (const l of lineas) {
    await prisma.movimientoStock.create({
      data: {
        id: nuevoId(),
        operacionId: id,
        productoId: l.productoId,
        seccionId: l.seccionId,
        proceso: l.proceso as never,
        cantidad: l.cantidad,
        loteVencimiento: l.loteVencimiento ? f(l.loteVencimiento) : null,
        detalle: l.detalle,
        precioTotal: l.precioTotal ?? 0,
        precioPorUnidadStock: l.precioPorUnidadStock ?? 0,
        costoUnitarioVenta: l.costoUnitarioVenta ?? null,
        precioListaUnitario: l.precioListaUnitario ?? null,
        conteoFisicoId: l.conteoFisicoId ?? null,
        creadoEn: marca(fecha),
      },
    });
  }
  return id;
}

/** Redondeo a 4 decimales (la escala de `MovimientoStock.cantidad`): evita escribir 0.30000000000000004. */
const q4 = (n: number) => Number(n.toFixed(4));

export async function sembrarEscenarioDeReportes() {
  contadorDeIds = 0;
  contadorDeMarcas = 0;

  // ── Estructura ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const S1 = nuevoId();
  const S2 = nuevoId();
  await prisma.sucursal.create({ data: { id: S1, nombre: "Central", creadoEn: f("2025-12-01T00:00:00Z") } });
  await prisma.sucursal.create({ data: { id: S2, nombre: "Norte", creadoEn: f("2025-12-01T00:00:01Z") } });
  const DEP = nuevoId();
  const SALON = nuevoId();
  const DEP2 = nuevoId();
  await prisma.seccion.create({ data: { id: DEP, sucursalId: S1, nombre: "Depósito" } });
  await prisma.seccion.create({ data: { id: SALON, sucursalId: S1, nombre: "Salón" } });
  await prisma.seccion.create({ data: { id: DEP2, sucursalId: S2, nombre: "Depósito Norte" } });
  const ADMIN = nuevoId();
  const MOZO = nuevoId();
  await prisma.user.create({ data: { id: ADMIN, email: "admin@test.com", name: "Admin", creadoEn: f("2025-12-01T00:00:00Z") } });
  await prisma.user.create({ data: { id: MOZO, email: "mozo@test.com", name: "Mozo Uno", creadoEn: f("2025-12-01T00:00:00Z") } });

  // ── Catálogo ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const KG = nuevoId();
  const UN = nuevoId();
  const LT = nuevoId();
  await prisma.unidad.create({ data: { id: KG, nombre: "kg", magnitud: "PESO", decimales: 2 } });
  await prisma.unidad.create({ data: { id: UN, nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
  await prisma.unidad.create({ data: { id: LT, nombre: "litro", magnitud: "VOLUMEN", decimales: 2 } });

  const G_NOCOM = nuevoId();
  const G_PACK = nuevoId();
  const G_LACT = nuevoId();
  await prisma.grupo.create({ data: { id: G_NOCOM, nombre: "No comestibles" } });
  await prisma.grupo.create({ data: { id: G_PACK, nombre: "Packaging", grupoPadreId: G_NOCOM } });
  await prisma.grupo.create({ data: { id: G_LACT, nombre: "Lácteos" } });

  const CAT_PIZZAS = nuevoId();
  const CAT_BEBIDAS = nuevoId();
  const CAT_POSTRES = nuevoId();
  await prisma.categoriaProducto.create({ data: { id: CAT_PIZZAS, nombre: "Pizzas" } });
  await prisma.categoriaProducto.create({ data: { id: CAT_BEBIDAS, nombre: "Bebidas" } });
  await prisma.categoriaProducto.create({ data: { id: CAT_POSTRES, nombre: "Postres" } });
  await prisma.margenObjetivo.create({ data: { id: nuevoId(), categoriaId: null, foodCostObjetivoPct: 35 } });
  await prisma.margenObjetivo.create({ data: { id: nuevoId(), categoriaId: CAT_PIZZAS, foodCostObjetivoPct: 30 } });

  const I_QUESO = nuevoId();
  const I_HARINA = nuevoId();
  const I_VINO = nuevoId();
  const I_CAJA = nuevoId();
  const I_ACEITE = nuevoId();
  await prisma.insumo.create({ data: { id: I_QUESO, nombre: "Queso", grupoId: G_LACT } });
  await prisma.insumo.create({ data: { id: I_HARINA, nombre: "Harina" } });
  await prisma.insumo.create({ data: { id: I_VINO, nombre: "Vino" } });
  await prisma.insumo.create({ data: { id: I_CAJA, nombre: "Caja de pizza", grupoId: G_PACK } });
  await prisma.insumo.create({ data: { id: I_ACEITE, nombre: "Aceite" } });

  const P_LACT = nuevoId();
  const P_MOLINO = nuevoId();
  const P_BODEGA = nuevoId();
  const P_ENVASES = nuevoId();
  await prisma.proveedor.create({ data: { id: P_LACT, codigo: "PRV_LACT", nombre: "Lácteos del Sur" } });
  await prisma.proveedor.create({ data: { id: P_MOLINO, codigo: "PRV_MOLINO", nombre: "Molino Norte" } });
  await prisma.proveedor.create({ data: { id: P_BODEGA, codigo: "PRV_BODEGA", nombre: "Bodega Andina" } });
  await prisma.proveedor.create({ data: { id: P_ENVASES, codigo: "PRV_ENVASES", nombre: "Envases SA" } });

  const ANA = nuevoId();
  const BETO = nuevoId();
  await prisma.cliente.create({ data: { id: ANA, nombre: "Ana", descuentoPorcentaje: 10, creadoEn: f("2026-01-01T00:00:00Z") } });
  await prisma.cliente.create({ data: { id: BETO, nombre: "Beto", descuentoPorcentaje: 20, creadoEn: f("2026-01-01T00:00:00Z") } });

  const VENCIDO = nuevoId();
  const PERSONAL = nuevoId();
  await prisma.motivoMerma.create({ data: { id: VENCIDO, nombre: "Vencido" } });
  await prisma.destinoConsumo.create({ data: { id: PERSONAL, nombre: "Comida del personal" } });

  /** Un producto, disponible en las sucursales dadas (la fila ausente = no disponible). */
  async function producto(datos: { codigo: string; nombre: string; tipo: "MP" | "PV"; unidadStockId: string; [k: string]: unknown }, sucursales: string[] = [S1]): Promise<string> {
    const id = nuevoId();
    await prisma.producto.create({ data: { id, ...datos, creadoEn: f("2026-01-01T00:00:00Z") } as never });
    for (const sucursalId of sucursales) await prisma.disponibilidadProducto.create({ data: { id: nuevoId(), sucursalId, productoId: id, disponible: true } });
    return id;
  }

  const MUZZA_A = await producto({ codigo: "MP_MUZZA_A", nombre: "Muzzarella A", tipo: "MP", unidadStockId: KG, insumoId: I_QUESO }, [S1, S2]);
  const MUZZA_B = await producto({ codigo: "MP_MUZZA_B", nombre: "Muzzarella B", tipo: "MP", unidadStockId: KG, insumoId: I_QUESO });
  const HARINA = await producto({ codigo: "MP_HARINA", nombre: "Harina 000", tipo: "MP", unidadStockId: KG, insumoId: I_HARINA }, [S1, S2]);
  // Nunca se mueve: hermana de la Harina en OTRA unidad (unidad mezclada), sin receta (insumos sin receta) y parte del pool de rendimiento de la Harina.
  await producto({ codigo: "MP_HARINA_BOLSA", nombre: "Harina en bolsa", tipo: "MP", unidadStockId: UN, insumoId: I_HARINA });
  const VINO = await producto({ codigo: "MP_VINO", nombre: "Vino tinto", tipo: "MP", unidadStockId: LT, insumoId: I_VINO, esConsignacion: true, proveedorConsignacionId: P_BODEGA, precioConsignacion: 800 });
  const CAJA = await producto({ codigo: "MP_CAJA", nombre: "Caja pizza", tipo: "MP", unidadStockId: UN, insumoId: I_CAJA }, [S1, S2]);
  const TOMATE = await producto({ codigo: "MP_TOMATE", nombre: "Tomate", tipo: "MP", unidadStockId: KG });
  const ACEITE = await producto({ codigo: "MP_ACEITE", nombre: "Aceite de oliva", tipo: "MP", unidadStockId: LT, insumoId: I_ACEITE });
  const SALSA = await producto({ codigo: "MP_SALSA", nombre: "Salsa casera", tipo: "MP", unidadStockId: KG, seProduce: true });
  const PIZZA = await producto({ codigo: "PV_PIZZA", nombre: "Pizza muzzarella", tipo: "PV", unidadStockId: UN, categoriaId: CAT_PIZZAS, precioVenta: 12000 }, [S1, S2]);
  const NAPOLITANA = await producto({ codigo: "PV_NAPOLITANA", nombre: "Pizza napolitana", tipo: "PV", unidadStockId: UN, categoriaId: CAT_PIZZAS, precioVenta: 14000 });
  const COPA = await producto({ codigo: "PV_COPA", nombre: "Copa de vino", tipo: "PV", unidadStockId: UN, categoriaId: CAT_BEBIDAS, precioVenta: 3000 });
  const FLAN = await producto({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: UN, categoriaId: CAT_POSTRES, precioVenta: 4000 });
  // Nunca se vende y no tiene categoría: PV sin venta nunca (huecos de catálogo) y PV sin categoría (ventas por categoría).
  await producto({ codigo: "PV_EMPANADA", nombre: "Empanada", tipo: "PV", unidadStockId: UN, precioVenta: 1500 });

  // Recetas (versión 1, central). La Pizza tiene una calibración local en Norte (0,28 kg de muzzarella en vez de 0,25).
  const RECETA: Record<string, Array<{ insumoProductoId: string; cantidad: number; unidadId: string; mermaPorcentaje: number }>> = {
    [PIZZA]: [
      { insumoProductoId: MUZZA_A, cantidad: 0.25, unidadId: KG, mermaPorcentaje: 0 },
      { insumoProductoId: HARINA, cantidad: 0.2, unidadId: KG, mermaPorcentaje: 5 },
      { insumoProductoId: CAJA, cantidad: 1, unidadId: UN, mermaPorcentaje: 0 },
    ],
    [NAPOLITANA]: [
      { insumoProductoId: MUZZA_B, cantidad: 0.3, unidadId: KG, mermaPorcentaje: 0 },
      { insumoProductoId: TOMATE, cantidad: 0.1, unidadId: KG, mermaPorcentaje: 0 },
      { insumoProductoId: SALSA, cantidad: 0.05, unidadId: KG, mermaPorcentaje: 0 },
    ],
    [COPA]: [{ insumoProductoId: VINO, cantidad: 0.15, unidadId: LT, mermaPorcentaje: 0 }],
  };
  const ingredienteId = new Map<string, string>();
  for (const [productoId, ingredientes] of Object.entries(RECETA)) {
    const recetaVersionId = nuevoId();
    await prisma.recetaVersion.create({ data: { id: recetaVersionId, productoId, version: 1, creadoEn: f("2026-01-01T00:00:00Z") } });
    for (const ing of ingredientes) {
      const id = nuevoId();
      await prisma.recetaIngrediente.create({ data: { id, recetaVersionId, ...ing } });
      ingredienteId.set(`${productoId}:${ing.insumoProductoId}`, id);
    }
  }
  await prisma.rendimientoLocalIngrediente.create({ data: { id: nuevoId(), recetaIngredienteId: ingredienteId.get(`${PIZZA}:${MUZZA_A}`)!, sucursalId: S2, cantidad: 0.28, mermaPorcentaje: null } });

  await prisma.stockMinimoProducto.create({ data: { id: nuevoId(), sucursalId: S1, productoId: MUZZA_A, seccionId: DEP, minimo: 5 } });
  await prisma.frecuenciaConteoProducto.create({ data: { id: nuevoId(), sucursalId: S1, productoId: ACEITE, frecuenciaDias: 7 } });
  await prisma.frecuenciaConteoProducto.create({ data: { id: nuevoId(), sucursalId: S1, productoId: HARINA, frecuenciaDias: 14 } });
  await prisma.descuentoProductoSucursal.create({ data: { id: nuevoId(), productoId: FLAN, sucursalId: S1, porcentaje: 15 } });

  // ── Global: dólar, IPC, auditoría de precios de carta ─────────────────────────────────────────────────────────────────────────────────────────────────
  await prisma.cotizacionDolar.create({ data: { id: nuevoId(), fecha: f("2026-03-12"), fuente: "BNA", compra: 1040, venta: 1090, creadoEn: f("2026-03-12T20:00:00Z") } });
  await prisma.cotizacionDolar.create({ data: { id: nuevoId(), fecha: f("2026-03-13"), fuente: "BCRA", compra: null, venta: 1080, creadoEn: f("2026-03-13T20:00:00Z") } });
  await prisma.cotizacionDolar.create({ data: { id: nuevoId(), fecha: f("2026-03-13"), fuente: "BNA", compra: 1050, venta: 1100, creadoEn: f("2026-03-13T20:00:01Z") } });
  for (const [mes, valor] of [["2025-12-01", 100], ["2026-01-01", 102.5], ["2026-02-01", 105.1]] as const) {
    await prisma.indicePrecio.create({ data: { id: nuevoId(), mes: f(mes), valor, creadoEn: f("2026-03-14T00:00:00Z") } });
  }
  await prisma.registroAuditoria.create({
    data: { id: nuevoId(), entidad: "Producto", entidadId: PIZZA, descripcion: "Cambio de precio de venta", campo: "precioVenta", valorAnterior: "11000", valorNuevo: "12000", actorId: ADMIN, creadoEn: f("2026-02-17T09:00:00Z") },
  });
  await prisma.registroAuditoria.create({
    data: { id: nuevoId(), entidad: "Producto", entidadId: COPA, descripcion: "Cambio de precio de venta", campo: "precioVenta", valorAnterior: "2800", valorNuevo: "3000", actorId: ADMIN, creadoEn: f("2026-02-28T09:00:00Z") },
  });

  // ── Kardex ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const base = { sucursalId: S1, usuarioId: ADMIN };

  const compra = (fecha: string, proveedorId: string | null, nroFactura: string | null, renglones: Array<{ productoId: string; cantidad: number; precioTotal: number; lote?: string }>, sucursalId = S1, seccionId = DEP) =>
    operacion(
      { ...base, sucursalId, proceso: "COMPRA", fecha, proveedorId, nroFactura },
      renglones.map((r) => ({
        productoId: r.productoId,
        seccionId,
        proceso: "COMPRA",
        cantidad: r.cantidad,
        precioTotal: r.precioTotal,
        precioPorUnidadStock: r.cantidad > 0 ? q4(r.precioTotal / r.cantidad) : 0,
        loteVencimiento: r.lote ?? null,
        detalle: "Compra",
      }))
    );

  /** Una venta como la escribe `registrarVentaEnTx`: los consumos de la receta (y la liquidación del vino en consignación) y después la línea VENTA. */
  const venta = (v: {
    fecha: string;
    productoId: string;
    cantidad: number;
    precioUnitario: number;
    costoUnitarioVenta?: number | null;
    precioListaUnitario?: number | null;
    clienteId?: string;
    promoCuentaId?: string;
    detalle?: string;
    sucursalId?: string;
    seccionVenta?: string;
    seccionConsumo?: string;
    loteSalsa?: string;
  }) => {
    const seccionConsumo = v.seccionConsumo ?? DEP;
    const lineas: Linea[] = [];
    for (const ing of RECETA[v.productoId] ?? []) {
      const cantidad = q4(ing.cantidad * (1 + ing.mermaPorcentaje / 100) * v.cantidad);
      lineas.push({ productoId: ing.insumoProductoId, seccionId: seccionConsumo, proceso: "CONSUMO", cantidad: -cantidad, detalle: "Consumo por venta", loteVencimiento: ing.insumoProductoId === SALSA ? (v.loteSalsa ?? null) : null });
      if (ing.insumoProductoId === VINO) {
        lineas.push({ productoId: VINO, seccionId: seccionConsumo, proceso: "LIQUIDACION_CONSIGNACION", cantidad: 0, precioTotal: q4(cantidad * 800), precioPorUnidadStock: 800, detalle: "Liquidación consignación por venta" });
      }
    }
    lineas.push({
      productoId: v.productoId,
      seccionId: v.seccionVenta ?? DEP,
      proceso: "VENTA",
      cantidad: -v.cantidad,
      precioTotal: v.precioUnitario * v.cantidad,
      precioPorUnidadStock: v.precioUnitario,
      costoUnitarioVenta: v.costoUnitarioVenta ?? null,
      precioListaUnitario: v.precioListaUnitario ?? null,
      detalle: v.detalle ?? "Venta",
    });
    return operacion({ ...base, sucursalId: v.sucursalId ?? S1, proceso: "VENTA", fecha: v.fecha, clienteId: v.clienteId ?? null, promoCuentaId: v.promoCuentaId ?? null, detalleLibre: v.detalle ?? null }, lineas);
  };

  /** Anula una operación (venta o compra) como `anularVenta`/`anularCompra`: la marca y escribe el contra-asiento AJUSTE con el prefijo que la identifica. */
  async function anular(operacionId: string, tipo: "venta" | "compra", fecha: string) {
    await prisma.operacion.update({ where: { id: operacionId }, data: { anuladaEn: f(fecha), anuladaPorId: ADMIN } });
    const movimientos = await prisma.movimientoStock.findMany({ where: { operacionId, proceso: { not: "LIQUIDACION_CONSIGNACION" } }, orderBy: { id: "asc" } });
    await operacion(
      { ...base, proceso: "AJUSTE", fecha, detalleLibre: `Anulación de la ${tipo} ${operacionId}` },
      movimientos.map((m) => ({ productoId: m.productoId, seccionId: m.seccionId, proceso: "AJUSTE", cantidad: -Number(m.cantidad), detalle: `Reversión por anulación de la ${tipo}` }))
    );
  }

  /** Un conteo físico RESUELTO (el saldo del sistema se lee de la base, como lo hace la pantalla); con diferencia escribe su CONTROL. */
  async function conteo(fecha: string, productoId: string, conteoReal: number, lote: string | null = null) {
    const agregado = await prisma.movimientoStock.aggregate({
      where: { productoId, seccionId: DEP, ...(lote ? { loteVencimiento: f(lote) } : {}), operacion: { fecha: { lte: f(fecha) } } },
      _sum: { cantidad: true },
    });
    const saldoSistema = q4(Number(agregado._sum.cantidad ?? 0));
    const diferencia = q4(conteoReal - saldoSistema);
    const id = nuevoId();
    await prisma.conteoFisico.create({
      data: {
        id,
        sucursalId: S1,
        fecha: f(fecha),
        productoId,
        seccionId: DEP,
        loteVencimiento: lote ? f(lote) : null,
        saldoSistema,
        conteoReal,
        diferencia,
        accion: "AJUSTAR",
        estado: "RESUELTO",
        detalle: diferencia === 0 ? null : "Diferencia ajustada",
        usuarioId: ADMIN,
        creadoEn: marca(f(fecha)),
      },
    });
    if (diferencia !== 0) {
      await operacion({ ...base, proceso: "CONTROL", fecha }, [{ productoId, seccionId: DEP, proceso: "CONTROL", cantidad: diferencia, loteVencimiento: lote, detalle: "Conteo físico", conteoFisicoId: id }]);
    }
    return id;
  }

  // Antes del período (el período de los reportes es 2026-02-16 → 2026-03-15; el anterior, para el ratio, termina el 2026-02-15).
  const COMPRA_LACTEOS_1 = await compra("2026-01-20T10:00:00Z", P_LACT, "A-0001", [
    { productoId: MUZZA_A, cantidad: 4, precioTotal: 32000, lote: "2026-03-20" },
    { productoId: MUZZA_B, cantidad: 4, precioTotal: 34000 },
  ]);
  await compra("2026-01-22T10:00:00Z", P_MOLINO, "M-100", [{ productoId: HARINA, cantidad: 10, precioTotal: 10000 }]);
  await compra("2026-01-25T10:00:00Z", P_ENVASES, "E-7", [{ productoId: CAJA, cantidad: 50, precioTotal: 10000 }]);
  await compra("2026-01-28T10:00:00Z", P_LACT, "A-0002", [{ productoId: ACEITE, cantidad: 5, precioTotal: 30000 }]);
  await compra("2026-01-30T10:00:00Z", null, null, [{ productoId: TOMATE, cantidad: 3, precioTotal: 4500 }]);
  await venta({ fecha: "2026-02-01T13:00:00Z", productoId: PIZZA, cantidad: 2, precioUnitario: 12000, costoUnitarioVenta: 2410 });
  await venta({ fecha: "2026-02-03T13:00:00Z", productoId: FLAN, cantidad: 1, precioUnitario: 4000 });

  // Dentro del período. Semanas (claveSemana arranca los jueves): W2 = 19-25 feb, W3 = 26 feb-4 mar, W4 = 5-11 mar — las ventas de Pizza y Napolitana
  // y las compras de Queso caen SOLO en esas tres, con mezclas distintas, para que el pool compartido de Queso se resuelva por mínimos cuadrados.
  await compra("2026-02-16T10:00:00Z", P_BODEGA, "B-1", [{ productoId: VINO, cantidad: 10, precioTotal: 0 }]);
  await conteo("2026-02-18T18:00:00Z", HARINA, 9.68);
  await compra("2026-02-19T10:00:00Z", P_LACT, "A-0003", [
    { productoId: MUZZA_A, cantidad: 1, precioTotal: 9000 },
    { productoId: MUZZA_B, cantidad: 0.6, precioTotal: 5700 },
  ]);
  await venta({ fecha: "2026-02-20T13:00:00Z", productoId: PIZZA, cantidad: 2, precioUnitario: 12000, costoUnitarioVenta: 2410 });
  await venta({ fecha: "2026-02-21T13:00:00Z", productoId: PIZZA, cantidad: 2, precioUnitario: 10800, precioListaUnitario: 12000, clienteId: ANA });
  // Una liquidación de consignación en febrero: la consignación filtrada desde el 1 de marzo tiene que dar distinto que la de siempre.
  await venta({ fecha: "2026-02-22T13:00:00Z", productoId: COPA, cantidad: 2, precioUnitario: 3000, costoUnitarioVenta: 120 });
  await venta({ fecha: "2026-02-23T13:00:00Z", productoId: NAPOLITANA, cantidad: 2, precioUnitario: 14000 });
  await compra("2026-02-24T10:00:00Z", P_MOLINO, "M-101", [{ productoId: HARINA, cantidad: 5, precioTotal: 6000 }]);
  await venta({ fecha: "2026-02-25T13:00:00Z", productoId: FLAN, cantidad: 2, precioUnitario: 4000 });
  await compra("2026-02-26T10:00:00Z", P_LACT, "A-0004", [
    { productoId: MUZZA_A, cantidad: 0.5, precioTotal: 4500 },
    { productoId: MUZZA_B, cantidad: 1.2, precioTotal: 11400 },
  ]);
  await venta({ fecha: "2026-02-27T13:00:00Z", productoId: PIZZA, cantidad: 2, precioUnitario: 12000, costoUnitarioVenta: 2650 });
  await venta({ fecha: "2026-03-01T13:00:00Z", productoId: COPA, cantidad: 3, precioUnitario: 3000, costoUnitarioVenta: 120 });
  await operacion({ ...base, proceso: "PRODUCCION", fecha: "2026-03-01T16:00:00Z" }, [{ productoId: SALSA, seccionId: DEP, proceso: "PRODUCCION", cantidad: 1, loteVencimiento: "2026-03-30", detalle: "Producción" }]);
  await venta({ fecha: "2026-03-02T13:00:00Z", productoId: NAPOLITANA, cantidad: 4, precioUnitario: 11200, precioListaUnitario: 14000, clienteId: BETO, loteSalsa: "2026-03-30" });
  await compra("2026-03-03T10:00:00Z", P_ENVASES, "E-8", [{ productoId: CAJA, cantidad: 20, precioTotal: 5000 }]);
  await operacion({ ...base, proceso: "MERMA", fecha: "2026-03-03T11:00:00Z", motivoId: VENCIDO, detalleLibre: "Botella abierta vencida" }, [
    { productoId: ACEITE, seccionId: DEP, proceso: "MERMA", cantidad: -0.5, detalle: "Merma" },
  ]);
  const VENTA_ANULADA = await venta({ fecha: "2026-03-03T19:00:00Z", productoId: PIZZA, cantidad: 1, precioUnitario: 12000, costoUnitarioVenta: 2650 });
  await anular(VENTA_ANULADA, "venta", "2026-03-03T19:30:00Z");
  const COMPRA_ANULADA = await compra("2026-03-04T10:00:00Z", P_MOLINO, "M-102", [{ productoId: HARINA, cantidad: 1, precioTotal: 5000 }]);
  await anular(COMPRA_ANULADA, "compra", "2026-03-04T12:00:00Z");
  await operacion({ ...base, proceso: "AJUSTE", fecha: "2026-03-04T15:00:00Z", detalleLibre: "Ajuste manual: botella rota" }, [{ productoId: ACEITE, seccionId: DEP, proceso: "AJUSTE", cantidad: -0.2, detalle: "Ajuste" }]);
  await compra("2026-03-05T10:00:00Z", P_LACT, "A-0005", [
    { productoId: MUZZA_A, cantidad: 0.75, precioTotal: 6900 },
    { productoId: MUZZA_B, cantidad: 0.3, precioTotal: 2880 },
  ]);
  await operacion({ ...base, proceso: "PRODUCCION", fecha: "2026-03-05T16:00:00Z" }, [{ productoId: SALSA, seccionId: DEP, proceso: "PRODUCCION", cantidad: 1, loteVencimiento: "2026-03-16", detalle: "Producción" }]);
  await prisma.pagoConsignante.create({ data: { id: nuevoId(), sucursalId: S1, proveedorId: P_BODEGA, importe: 200, fecha: f("2026-03-05T17:00:00Z"), notas: "Pago parcial", usuarioId: ADMIN, creadoEn: f("2026-03-05T17:00:00Z") } });
  await venta({ fecha: "2026-03-06T13:00:00Z", productoId: PIZZA, cantidad: 3, precioUnitario: 12000, costoUnitarioVenta: 2700 });
  await conteo("2026-03-06T18:00:00Z", SALSA, 1, "2026-03-16");
  await conteo("2026-03-06T18:01:00Z", SALSA, 0.8, "2026-03-30");
  await operacion({ ...base, proceso: "CONSUMO", fecha: "2026-03-07T11:00:00Z", destinoId: PERSONAL }, [{ productoId: ACEITE, seccionId: DEP, proceso: "CONSUMO", cantidad: -0.3, detalle: "Consumo" }]);
  await operacion({ ...base, proceso: "PRODUCCION", fecha: "2026-03-08T16:00:00Z" }, [{ productoId: SALSA, seccionId: DEP, proceso: "PRODUCCION", cantidad: 2, loteVencimiento: "2026-03-18", detalle: "Producción" }]);
  await venta({ fecha: "2026-03-09T13:00:00Z", productoId: NAPOLITANA, cantidad: 1, precioUnitario: 14000, loteSalsa: "2026-03-16" });
  await operacion({ ...base, proceso: "DEVOLUCION_PROVEEDOR", fecha: "2026-03-10T10:00:00Z", proveedorId: P_LACT }, [{ productoId: ACEITE, seccionId: DEP, proceso: "DEVOLUCION_PROVEEDOR", cantidad: -1, detalle: "Devolución" }]);
  await conteo("2026-03-10T18:00:00Z", HARINA, 12.9);
  await operacion({ ...base, proceso: "DEVOLUCION_CLIENTE", fecha: "2026-03-11T12:00:00Z" }, [{ productoId: PIZZA, seccionId: DEP, proceso: "DEVOLUCION_CLIENTE", cantidad: 1, detalle: "Devolución de cliente" }]);
  await conteo("2026-03-12T18:00:00Z", SALSA, 0.7, "2026-03-30");
  await conteo("2026-03-12T18:01:00Z", SALSA, 2, "2026-03-18");

  // Norte: una compra y una venta (consumo de su propio depósito).
  await compra("2026-03-02T10:00:00Z", P_LACT, "N-0001", [{ productoId: MUZZA_A, cantidad: 3, precioTotal: 28500 }], S2, DEP2);
  await venta({ fecha: "2026-03-08T13:00:00Z", productoId: PIZZA, cantidad: 1, precioUnitario: 13000, costoUnitarioVenta: 2800, sucursalId: S2, seccionVenta: DEP2, seccionConsumo: DEP2 });

  // ── POS (Central, 2026-03-14) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const MESA_4 = nuevoId();
  const MESA_7 = nuevoId();
  await prisma.mesa.create({ data: { id: MESA_4, sucursalId: S1, numero: 4, creadoEn: f("2026-01-01T00:00:00Z") } });
  await prisma.mesa.create({ data: { id: MESA_7, sucursalId: S1, numero: 7, creadoEn: f("2026-01-01T00:00:00Z") } });
  const SECCION_CARTA = nuevoId();
  const PROMO = nuevoId();
  await prisma.seccionCarta.create({ data: { id: SECCION_CARTA, nombre: "Promos" } });
  await prisma.promoCarta.create({ data: { id: PROMO, seccionCartaId: SECCION_CARTA, titulo: "Combo postre", precio: 6000, activa: true, creadoEn: f("2026-01-01T00:00:00Z") } });
  await prisma.promoCartaSucursal.create({ data: { id: nuevoId(), promoCartaId: PROMO, sucursalId: S1 } });

  const item = (cuentaId: string, d: { productoId: string; cantidad: number; precioUnitario: number; creadoEn: string; numeroEnvio?: number | null; operacionId?: string; promoCuentaId?: string; precioCartaUnitario?: number }) =>
    prisma.cuentaItem.create({
      data: {
        id: nuevoId(),
        cuentaId,
        productoId: d.productoId,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario,
        numeroEnvio: d.numeroEnvio === undefined ? 1 : d.numeroEnvio,
        creadoEn: f(d.creadoEn),
        creadoPorId: MOZO,
        operacionId: d.operacionId ?? null,
        promoCuentaId: d.promoCuentaId ?? null,
        precioCartaUnitario: d.precioCartaUnitario ?? null,
      },
    });

  // Cuenta 1 (mesa 4): cliente Ana con 10 %, ticket 1 y su corrección (ejemplar 2).
  const CUENTA_1 = nuevoId();
  await prisma.cuenta.create({
    data: { id: CUENTA_1, mesaId: MESA_4, abiertaPorId: MOZO, abiertaEn: f("2026-03-14T12:00:00Z"), cerradaEn: f("2026-03-14T13:10:00Z"), cerradaPorId: ADMIN, comensales: 2, clienteId: ANA, descuentoPorcentaje: 10 },
  });
  const opFlan1 = await venta({ fecha: "2026-03-14T13:10:00Z", productoId: FLAN, cantidad: 2, precioUnitario: 3600, precioListaUnitario: 4000, clienteId: ANA, detalle: "Mesa 4", seccionVenta: SALON });
  const opCopa1 = await venta({ fecha: "2026-03-14T13:10:01Z", productoId: COPA, cantidad: 1, precioUnitario: 2700, precioListaUnitario: 3000, costoUnitarioVenta: 120, clienteId: ANA, detalle: "Mesa 4", seccionVenta: SALON });
  await item(CUENTA_1, { productoId: FLAN, cantidad: 2, precioUnitario: 4000, creadoEn: "2026-03-14T12:05:00Z", operacionId: opFlan1 });
  await item(CUENTA_1, { productoId: COPA, cantidad: 1, precioUnitario: 3000, creadoEn: "2026-03-14T12:06:00Z", operacionId: opCopa1 });
  const TICKET_1A = nuevoId();
  await prisma.ejemplarTicket.create({ data: { id: TICKET_1A, sucursalId: S1, cuentaId: CUENTA_1, numero: 1, ejemplar: 1, emitidoEn: f("2026-03-14T13:10:00Z"), emitidoPorId: ADMIN } });
  await prisma.ejemplarTicket.create({
    data: { id: nuevoId(), sucursalId: S1, cuentaId: CUENTA_1, numero: 1, ejemplar: 2, emitidoEn: f("2026-03-14T13:30:00Z"), emitidoPorId: ADMIN, corrigeAId: TICKET_1A, motivo: "Faltaba el nombre del cliente" },
  });

  // Cuenta 2 (mesa 7): una promo «Combo postre» (Copa + Flan prorrateados) y un Flan suelto con descuento de producto (15 %).
  const CUENTA_2 = nuevoId();
  await prisma.cuenta.create({ data: { id: CUENTA_2, mesaId: MESA_7, abiertaPorId: MOZO, abiertaEn: f("2026-03-14T20:00:00Z"), cerradaEn: f("2026-03-14T21:30:00Z"), cerradaPorId: ADMIN, comensales: 4 } });
  const PROMO_CUENTA = nuevoId();
  await prisma.promoCuenta.create({ data: { id: PROMO_CUENTA, cuentaId: CUENTA_2, promoCartaId: PROMO, precio: 6000, titulo: "Combo postre", creadoPorId: MOZO, creadoEn: f("2026-03-14T20:10:00Z") } });
  const opCopa2 = await venta({ fecha: "2026-03-14T21:30:00Z", productoId: COPA, cantidad: 1, precioUnitario: 2400, costoUnitarioVenta: 120, promoCuentaId: PROMO_CUENTA, detalle: "Mesa 7", seccionVenta: SALON });
  const opFlan2 = await venta({ fecha: "2026-03-14T21:30:01Z", productoId: FLAN, cantidad: 1, precioUnitario: 3600, promoCuentaId: PROMO_CUENTA, detalle: "Mesa 7", seccionVenta: SALON });
  const opFlan3 = await venta({ fecha: "2026-03-14T21:30:02Z", productoId: FLAN, cantidad: 1, precioUnitario: 3400, detalle: "Mesa 7", seccionVenta: SALON });
  await item(CUENTA_2, { productoId: COPA, cantidad: 1, precioUnitario: 2400, creadoEn: "2026-03-14T20:10:00Z", operacionId: opCopa2, promoCuentaId: PROMO_CUENTA, precioCartaUnitario: 3000 });
  await item(CUENTA_2, { productoId: FLAN, cantidad: 1, precioUnitario: 3600, creadoEn: "2026-03-14T20:10:01Z", operacionId: opFlan2, promoCuentaId: PROMO_CUENTA, precioCartaUnitario: 4000 });
  await item(CUENTA_2, { productoId: FLAN, cantidad: 1, precioUnitario: 3400, creadoEn: "2026-03-14T20:15:00Z", operacionId: opFlan3, precioCartaUnitario: 4000 });
  await prisma.ejemplarTicket.create({ data: { id: nuevoId(), sucursalId: S1, cuentaId: CUENTA_2, numero: 2, ejemplar: 1, emitidoEn: f("2026-03-14T21:30:00Z"), emitidoPorId: ADMIN } });

  // Cuenta 3 (mesa 4): abierta el 15, con un ítem sin enviar (sin venta ni ticket).
  const CUENTA_3 = nuevoId();
  await prisma.cuenta.create({ data: { id: CUENTA_3, mesaId: MESA_4, abiertaPorId: MOZO, abiertaEn: f("2026-03-15T11:00:00Z"), comensales: 3 } });
  await item(CUENTA_3, { productoId: PIZZA, cantidad: 1, precioUnitario: 12000, creadoEn: "2026-03-15T11:05:00Z", numeroEnvio: null });

  return {
    S1,
    S2,
    DEP,
    MESA_4,
    PIZZA,
    HARINA,
    COMPRA_LACTEOS_1,
    sucursales: [
      { id: S1, nombre: "Central" },
      { id: S2, nombre: "Norte" },
    ],
  };
}
