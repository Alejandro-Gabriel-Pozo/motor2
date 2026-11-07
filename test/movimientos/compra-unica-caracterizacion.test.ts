import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import { cargarLineasDelPeriodo } from "../../src/server/consultas/reportes/periodo";
import { calcularComprasDelPeriodo } from "../../src/core/reportes/public";
import { DIA_MS, enElFuturo } from "../setup/tiempo";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import type { ItemMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * U0.1 de «una sola compra» (docs/diseno-una-sola-compra-2026-11-06.md §11 y §12.2): LÍNEA DE BASE Y CARACTERIZACIÓN, antes de tocar nada.
 *
 * Una compra de UNA sucursal, pagada ahora, se puede cargar por dos caminos: el viejo (`registrarMovimiento` COMPRA → `Operacion` suelta) y la factura de UNA parte al 100 % en la sucursal que carga
 * (`registrarFacturaProveedor`, `CONTADO_PAGADA`). La unificación (U0/U1) manda todo por el segundo; este test demuestra, con Postgres real, que para el mismo pedido los dos dejan LO MISMO en lo que
 * importa al negocio — las filas de Kardex, el saldo, el costo vigente (V-T1) y el gasto del período — y enumera, aparte, las únicas diferencias permitidas.
 *
 * Cada caso se corre en dos bases limpias y sembradas igual (una por camino) y se comparan las fotos normalizadas (por código de producto y nombre de sección, no por id).
 *
 * DIFERENCIAS PERMITIDAS (las únicas; cada una tiene su afirmación abajo):
 *  D1. `MovimientoStock.facturaProveedorRenglonId`: la factura ata cada fila a su renglón; la compra simple, no.
 *  D2. Unidad y cantidad comprada: en la compra simple viven en `MovimientoStock.unidadCompraId/cantidadCompra`; en la factura, en el renglón (la fila queda en NULL).
 *  D3. La clave de reintento (y la huella): en la compra simple están en `Operacion`; en la factura, en la cabecera (la `Operacion` de la parte queda en NULL).
 *  D4. La factura crea además cabecera, renglones y parte RECIBIDA (la compra simple no crea nada de eso) y la cabecera nace `CONTADO_PAGADA`.
 *  D5. El mensaje: «Se guardaron N movimiento(s)…» vs «Factura cargada: N movimiento(s) entraron al stock de esta sucursal.» (U0.2 lo iguala).
 *
 * REDONDEO del precio por unidad (la duda del diseño, §1): los dos caminos parten de la MISMA `LineaCalculada` (`armarLineaMovimiento` → `precioPorUnidad`, ya a 4 decimales con ROUND_HALF_UP exacto); la
 * factura vuelve a pasarla por `Number(x.toFixed(4))`, que sobre un número que ya tiene ≤ 4 decimales es la identidad. Los casos de abajo (tercios, centésimos, medio centavo) lo comprueban en la base.
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);
const mediodiaHaceDias = (dias: number) => mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), -dias), ZONA_ARGENTINA);

interface Entorno {
  adminId: string;
  sucursalId: string;
  seccionId: string;
  otraSeccionId: string;
  proveedorId: string;
  productos: Record<string, string>;
}

let e: Entorno;

const actor = () => ({ usuarioId: e.adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: e.sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [e.sucursalId], escritura: [e.sucursalId] }) });

async function sembrarEntorno(): Promise<void> {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const { kg, insumo } = await sembrarCatalogoBase();
  const sucursalId = base.sucursal.id;
  const seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
  const otraSeccionId = (await sembrarSeccion(sucursalId, "Cámara")).id;
  const adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
  const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
  const mp = async (codigo: string, extra: Record<string, unknown> = {}) =>
    (await sembrarProductoDisponible({ codigo, nombre: codigo, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id, ...extra }, sucursalId)).id;
  const productos = {
    MP_A: await mp("MP_A"),
    MP_B: await mp("MP_B"),
    MP_CAJA: await mp("MP_CAJA", { unidadCompraId: caja.id, factorConversion: "25" }),
  };
  const proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  e = { adminId, sucursalId, seccionId, otraSeccionId, proveedorId, productos };
}

interface CasoDeCaracterizacion {
  nombre: string;
  /** Hace cuántos días es la compra (el costo vigente ordena por fecha). */
  diasAtras?: number;
  /** `true` = la carga entra a la sección «Cámara» en vez de «Depósito». */
  enOtraSeccion?: boolean;
  items: (p: Record<string, string>) => ItemMovimientoInput[];
  detalleLibre?: string;
}

const LOTE = enElFuturo(120 * DIA_MS);
const CASOS: CasoDeCaracterizacion[] = [
  { nombre: "una línea con cifras redondas", items: (p) => [{ productoId: p.MP_A!, cantidad: 10, precioTotal: 123.45, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "tercios: 10 ÷ 3 = 3,3333 por unidad (el redondeo a 4 decimales)", items: (p) => [{ productoId: p.MP_A!, cantidad: 3, precioTotal: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "centésimos: 0,01 ÷ 3 = 0,0033", items: (p) => [{ productoId: p.MP_A!, cantidad: 3, precioTotal: 0.01, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "empate de medio: 1 ÷ 8 = 0,125 y 0,01 ÷ 8 = 0,00125 → 0,0013", items: (p) => [{ productoId: p.MP_A!, cantidad: 8, precioTotal: 1, referenciaProveedor: REFERENCIA_DE_PRUEBA }, { productoId: p.MP_B!, cantidad: 8, precioTotal: 0.01, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "cantidad con decimales de la unidad: 2,5 kg por 7,77", items: (p) => [{ productoId: p.MP_A!, cantidad: 2.5, precioTotal: 7.77, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "sin precio (el campo es opcional): precio 0 y no tuerce nada", items: (p) => [{ productoId: p.MP_A!, cantidad: 4, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "tres renglones, uno repetido (mismo producto dos veces)", items: (p) => [
    { productoId: p.MP_A!, cantidad: 6, precioTotal: 100.1, referenciaProveedor: REFERENCIA_DE_PRUEBA },
    { productoId: p.MP_B!, cantidad: 7, precioTotal: 33.33, referenciaProveedor: REFERENCIA_DE_PRUEBA },
    { productoId: p.MP_A!, cantidad: 1, precioTotal: 17.77, referenciaProveedor: REFERENCIA_DE_PRUEBA },
  ] },
  { nombre: "con lote de vencimiento", items: (p) => [{ productoId: p.MP_A!, cantidad: 5, precioTotal: 50, loteVencimiento: LOTE, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "con detalle libre de la compra y de la línea", detalleLibre: "Entrega de la mañana", items: (p) => [{ productoId: p.MP_A!, cantidad: 5, precioTotal: 50, detalle: "bolsas de 25", referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "unidad de compra distinta de la de stock: 3 cajas × 25 = 75 kg", items: (p) => [{ productoId: p.MP_CAJA!, cantidad: 3, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
  { nombre: "entra a otra sección, con fecha de hace 9 días", diasAtras: 9, enOtraSeccion: true, items: (p) => [{ productoId: p.MP_B!, cantidad: 12, precioTotal: 480, referenciaProveedor: REFERENCIA_DE_PRUEBA }] },
];

type Camino = "VIEJO" | "FACTURA_DE_UNA_PARTE";

async function cargar(camino: Camino, caso: CasoDeCaracterizacion, claveIdempotencia: string) {
  const fecha = caso.diasAtras ? mediodiaHaceDias(caso.diasAtras) : mediodiaDeHoy();
  const seccionId = caso.enOtraSeccion ? e.otraSeccionId : e.seccionId;
  const items = caso.items(e.productos);
  const nroFactura = "A-00001-00000123";
  if (camino === "VIEJO") {
    return registrarMovimientoCasoDeUso(actor(), { proceso: "COMPRA", fecha, seccionId, proveedorId: e.proveedorId, nroFactura, items, detalleLibre: caso.detalleLibre, claveIdempotencia });
  }
  return registrarFacturaProveedorCasoDeUso(actor(), {
    fecha, seccionId, proveedorId: e.proveedorId, nroFactura, items, detalleLibre: caso.detalleLibre, claveIdempotencia,
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: e.sucursalId, valor: 100 }] }, condicionPago: "CONTADO_PAGADA",
  });
}

/** Lo que el negocio ve de una compra, normalizado (sin ids) para poder comparar dos bases distintas. */
async function foto() {
  const nombreDeProducto = new Map((await prisma.producto.findMany({ select: { id: true, codigo: true } })).map((p) => [p.id, p.codigo]));
  const nombreDeSeccion = new Map((await prisma.seccion.findMany({ select: { id: true, nombre: true } })).map((s) => [s.id, s.nombre]));
  const movimientos = await prisma.movimientoStock.findMany({ where: { proceso: "COMPRA" }, orderBy: [{ productoId: "asc" }, { precioTotal: "asc" }, { cantidad: "asc" }] });
  const kardex = movimientos
    .map((m) => ({
      producto: nombreDeProducto.get(m.productoId),
      seccion: nombreDeSeccion.get(m.seccionId),
      proceso: m.proceso,
      cantidad: m.cantidad.toFixed(4),
      precioTotal: m.precioTotal.toFixed(2),
      precioPorUnidadStock: m.precioPorUnidadStock.toFixed(4),
      lote: m.loteVencimiento?.toISOString() ?? null,
      detalle: m.detalle,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const operaciones = (await prisma.operacion.findMany({ where: { proceso: "COMPRA" } })).map((o) => ({
    proceso: o.proceso,
    fecha: o.fecha.toISOString(),
    nroFactura: o.nroFactura,
    detalleLibre: o.detalleLibre,
    anulada: Boolean(o.anuladaEn),
    seccionDestinoId: o.seccionDestinoId,
  }));
  const saldos: Record<string, number> = {};
  for (const [codigo, id] of Object.entries(e.productos)) {
    for (const [seccion, seccionId] of [["Depósito", e.seccionId], ["Cámara", e.otraSeccionId]] as const) saldos[`${codigo}@${seccion}`] = await calcularSaldoTotal(id, seccionId, prisma);
  }
  const costo = [...(await obtenerCostoActualPorMP(e.sucursalId, prisma)).entries()]
    .map(([productoId, c]) => [nombreDeProducto.get(productoId), JSON.parse(JSON.stringify(c))] as const)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const desde = sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), -30);
  const periodo = await cargarLineasDelPeriodo(e.sucursalId, mediodiaDelDia(desde, ZONA_ARGENTINA), new Date(Date.now() + 86_400_000), {}, prisma);
  const gasto = calcularComprasDelPeriodo(periodo.items, periodo.productos);
  return { kardex, operaciones, saldos, costo, gasto: { totalGastado: gasto.totalGastado, porProveedor: gasto.porProveedor.map((f) => ({ proveedor: f.proveedor, importe: f.importe, cantidadProductos: f.cantidadProductos, cantidadCompras: f.cantidadCompras, productos: f.productos })), hayComprasSinPrecio: gasto.hayComprasSinPrecio } };
}

describe("U0.1 caracterización: la misma compra por el camino viejo y por la factura de una parte deja lo mismo", () => {
  for (const caso of CASOS) {
    it(caso.nombre, async () => {
      await sembrarEntorno();
      const viejo = await cargar("VIEJO", caso, randomUUID());
      expect(viejo.ok, viejo.mensaje).toBe(true);
      const fotoViejo = await foto();

      await sembrarEntorno();
      const nueva = await cargar("FACTURA_DE_UNA_PARTE", caso, randomUUID());
      expect(nueva.ok, nueva.mensaje).toBe(true);
      const fotoNueva = await foto();

      expect(fotoNueva.kardex, "mismas filas de Kardex: producto, sección, cantidad, precioTotal, precioPorUnidadStock, lote y detalle").toEqual(fotoViejo.kardex);
      expect(fotoNueva.operaciones, "misma Operacion COMPRA: fecha, número, detalle, no anulada").toEqual(fotoViejo.operaciones);
      expect(fotoNueva.saldos, "mismo saldo por producto y sección").toEqual(fotoViejo.saldos);
      expect(fotoNueva.costo, "mismo costo vigente (V-T1)").toEqual(fotoViejo.costo);
      expect(fotoNueva.gasto, "mismo gasto del período").toEqual(fotoViejo.gasto);
      expect(fotoViejo.kardex.length).toBeGreaterThan(0);
    }, 30_000);
  }
});

describe("U0.1 diferencias permitidas, enumeradas (D1 a D4): lo único que cambia entre los dos caminos", () => {
  it("D1 a D4 sobre una compra con unidad de compra distinta de la de stock", async () => {
    const caso = CASOS.find((c) => c.nombre.startsWith("unidad de compra"))!;
    const claveViejo = randomUUID();
    const claveNueva = randomUUID();

    await sembrarEntorno();
    expect((await cargar("VIEJO", caso, claveViejo)).ok).toBe(true);
    const movViejo = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    const opViejo = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    expect(movViejo.facturaProveedorRenglonId, "D1 viejo: sin renglón").toBeNull();
    expect([movViejo.unidadCompraId !== null, movViejo.cantidadCompra?.toFixed(4)], "D2 viejo: la unidad y la cantidad comprada viven en la fila de Kardex").toEqual([true, "3.0000"]);
    expect([opViejo.claveIdempotencia, opViejo.payloadHash !== null], "D3 viejo: la clave vive en la Operacion").toEqual([claveViejo, true]);
    expect(await prisma.facturaProveedor.count(), "D4 viejo: no hay factura").toBe(0);

    await sembrarEntorno();
    expect((await cargar("FACTURA_DE_UNA_PARTE", caso, claveNueva)).ok).toBe(true);
    const movNuevo = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    const opNueva = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA" } });
    const cabecera = await prisma.facturaProveedor.findFirstOrThrow({ include: { renglones: true, partes: true } });
    expect(movNuevo.facturaProveedorRenglonId, "D1 nuevo: la fila apunta a su renglón").toBe(cabecera.renglones[0]!.id);
    expect([movNuevo.unidadCompraId, movNuevo.cantidadCompra], "D2 nuevo: la fila queda en NULL").toEqual([null, null]);
    expect([cabecera.renglones[0]!.unidadCompraId !== null, cabecera.renglones[0]!.cantidadCompra?.toFixed(4)], "D2 nuevo: lo comprado vive en el renglón").toEqual([true, "3.0000"]);
    expect([opNueva.claveIdempotencia, opNueva.payloadHash], "D3 nuevo: la Operacion no lleva la clave").toEqual([null, null]);
    expect(cabecera.claveIdempotencia, "D3 nuevo: la clave vive en la cabecera").toBe(claveNueva);
    expect([cabecera.estado, cabecera.condicionPago, cabecera.partes.map((p) => [p.sucursalId, p.estadoRecepcion, p.operacionId === opNueva.id, p.porcentajeDeclaradoBp])], "D4 nuevo: cabecera CONFIRMADA, contado, una parte RECIBIDA al 100 % atada a la compra")
      .toEqual(["CONFIRMADA", "CONTADO_PAGADA", [[e.sucursalId, "RECIBIDA", true, 10000]]]);
    // El mismo número de factura y el mismo proveedor en la compra de la parte y en la cabecera (base de I-NUM).
    expect([opNueva.nroFactura, opNueva.proveedorId]).toEqual([cabecera.nroFactura, cabecera.proveedorId]);
  });

  it("D5 el mensaje hoy difiere (U0.2 lo iguala): documenta los dos textos actuales", async () => {
    const caso = CASOS[0]!;
    await sembrarEntorno();
    const viejo = await cargar("VIEJO", caso, randomUUID());
    await sembrarEntorno();
    const nueva = await cargar("FACTURA_DE_UNA_PARTE", caso, randomUUID());
    expect(viejo.mensaje).toBe("Se guardaron 1 movimiento(s).");
    expect(nueva.mensaje).toBe("Factura cargada: 1 movimiento(s) entraron al stock de esta sucursal.");
  });
});

describe("U0.1 el precio por unidad, redondeo exacto en la base (la duda de §1)", () => {
  // (precioTotal, cantidad) → precioPorUnidadStock esperado a 4 decimales, ROUND_HALF_UP exacto.
  const tabla: [number, number, string][] = [
    [10, 3, "3.3333"],
    [20, 3, "6.6667"],
    [0.01, 3, "0.0033"],
    [0.01, 8, "0.0013"],
    [1, 8, "0.1250"],
    [1000, 75, "13.3333"],
    [123.45, 10, "12.3450"],
    [7.77, 2.5, "3.1080"],
  ];
  for (const [precioTotal, cantidad, esperado] of tabla) {
    it(`${precioTotal} ÷ ${cantidad} = ${esperado} por los dos caminos`, async () => {
      for (const camino of ["VIEJO", "FACTURA_DE_UNA_PARTE"] as const) {
        await sembrarEntorno();
        const r = await cargar(camino, { nombre: "x", items: (p) => [{ productoId: p.MP_A!, cantidad, precioTotal, referenciaProveedor: REFERENCIA_DE_PRUEBA }] }, randomUUID());
        expect(r.ok, r.mensaje).toBe(true);
        const m = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "COMPRA" } });
        expect(m.precioPorUnidadStock.toFixed(4), camino).toBe(esperado);
        expect(m.precioTotal.toFixed(2), camino).toBe(precioTotal.toFixed(2));
      }
    }, 30_000);
  }
});
