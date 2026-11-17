import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput, ItemMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Oráculo de compras, C1 negativo, C2 y C6 negativo (docs/oraculo-de-compras-y-presentaciones-contra-motor2-2026-11-17.md): la unidad de compra TECLEADA en una línea de Compra se admite SOLO si es
 * (a) una presentación real y activa del producto, (b) la unidad de compra por defecto del producto, (c) la unidad de stock (factor 1) o (d) otra unidad de la MISMA dimensión con conversión exacta
 * (catálogo de unidades fijas, `Unidad.codigoFijo`). Cualquier otra RECHAZA la compra entera sin escribir nada (antes se ignoraba en silencio: entraban 2 g en vez de 2 kg).
 *
 * Mutación comprobada (anotada en el commit): sacar el chequeo `sePuedeConvertir` y la rama `unidadTecleada` de `armar-linea-de-movimiento.ts` → rojo en todo lo marcado «RECHAZA».
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string, seccionId: string, adminId: string, proveedorId: string;
const unidades: Record<string, string> = {};
const productos: Record<string, string> = {};
let contador = 0;

const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: central, sucursalNombre: "Central", ...baseDeTest({ lectura: [central], escritura: [central] }), ahora: new Date() });
const linea = (producto: string, cantidad: number, precioTotal: number, unidadCompraId?: string): ItemMovimientoInput => ({ productoId: productos[producto]!, cantidad, precioTotal, referenciaProveedor: REFERENCIA_DE_PRUEBA, ...(unidadCompraId ? { unidadCompraId } : {}) });
const compra = (items: ItemMovimientoInput[], clave = randomUUID(), nroFactura = `A-1-${600000 + ++contador}`): DatosMovimientoInput =>
  ({ proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura, items, claveIdempotencia: clave }) as DatosMovimientoInput;

const huella = async () => ({
  operaciones: await prisma.operacion.count(),
  movimientos: await prisma.movimientoStock.count(),
  facturas: await prisma.facturaProveedor.count(),
  renglones: await prisma.facturaProveedorRenglon.count(),
});
const SIN_EFECTOS = { operaciones: 0, movimientos: 0, facturas: 0, renglones: 0 };
const movimientosDe = (producto: string) => prisma.movimientoStock.findMany({ where: { productoId: productos[producto]!, proceso: "COMPRA" }, select: { cantidad: true, precioPorUnidadStock: true } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  seccionId = (await sembrarSeccion(central)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
  const { kg, g, insumo } = await sembrarCatalogoBase();
  await prisma.unidad.update({ where: { id: kg.id }, data: { codigoFijo: "KILOGRAMO", decimales: 4 } });
  await prisma.unidad.update({ where: { id: g.id }, data: { codigoFijo: "GRAMO", decimales: 4 } });
  const litro = await prisma.unidad.create({ data: { nombre: "litro", magnitud: "VOLUMEN", decimales: 2, codigoFijo: "LITRO" } });
  const tonelada = await prisma.unidad.create({ data: { nombre: "tonelada", magnitud: "PESO", decimales: 4, codigoFijo: "TONELADA" } });
  const u = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0, codigoFijo: "UNIDAD" } });
  const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
  const pack = await prisma.unidad.create({ data: { nombre: "pack", magnitud: "CANTIDAD", decimales: 0 } });
  const bolsa = await prisma.unidad.create({ data: { nombre: "bolsa", magnitud: "CANTIDAD", decimales: 0 } });
  Object.assign(unidades, { kg: kg.id, g: g.id, litro: litro.id, tonelada: tonelada.id, u: u.id, caja: caja.id, pack: pack.id, bolsa: bolsa.id });
  const mp = (codigo: string, extra: { unidadStockId: string; unidadCompraId?: string; factorConversion?: string }) =>
    sembrarProductoDisponible({ codigo, nombre: codigo, tipo: "MP", insumoId: insumo.id, ...extra }, central).then((p) => (productos[codigo] = p.id));
  await mp("EN_GRAMOS", { unidadStockId: g.id });
  await mp("EN_TONELADAS", { unidadStockId: tonelada.id });
  await mp("EN_UNIDADES", { unidadStockId: u.id, unidadCompraId: caja.id, factorConversion: "6" });
  await prisma.presentacion.create({ data: { productoId: productos.EN_UNIDADES!, unidadCompraId: pack.id, factorConversion: "12" } });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

describe("ramas permitidas: siguen entrando con stock y costo correctos", () => {
  it("(a) presentación real y activa: 2 packs ×12 = 24 u a $1.200 → $50/u", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([linea("EN_UNIDADES", 2, 1200, unidades.pack)]));
    expect(r.ok, r.mensaje).toBe(true);
    const m = await movimientosDe("EN_UNIDADES");
    expect(m.map((x) => x.cantidad.toFixed(4))).toEqual(["24.0000"]);
    expect(m[0]!.precioPorUnidadStock.toFixed(4)).toBe("50.0000");
  });

  it("(b) unidad de compra por defecto del producto: 2 cajas ×6 = 12 u a $24.000 → $2.000/u (C1)", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([linea("EN_UNIDADES", 2, 24000, unidades.caja)]));
    expect(r.ok, r.mensaje).toBe(true);
    const m = await movimientosDe("EN_UNIDADES");
    expect(m.map((x) => x.cantidad.toFixed(4))).toEqual(["12.0000"]);
    expect(m[0]!.precioPorUnidadStock.toFixed(4)).toBe("2000.0000");
  });

  it("(c) unidad de stock (factor 1), aunque el producto tenga otra por defecto: 5 u sueltas a $2.000 → $400/u, no 30 u (C2)", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([linea("EN_UNIDADES", 5, 2000, unidades.u)]));
    expect(r.ok, r.mensaje).toBe(true);
    const m = await movimientosDe("EN_UNIDADES");
    expect(m.map((x) => x.cantidad.toFixed(4))).toEqual(["5.0000"]);
    expect(m[0]!.precioPorUnidadStock.toFixed(4)).toBe("400.0000");
  });

  it("(d) conversión exacta de la misma dimensión: 2 kg tecleados en un producto en gramos entran 2.000 g a $1.800 → $0,90/g (C6)", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([linea("EN_GRAMOS", 2, 1800, unidades.kg)]));
    expect(r.ok, r.mensaje).toBe(true);
    const m = await movimientosDe("EN_GRAMOS");
    expect(m.map((x) => x.cantidad.toFixed(4))).toEqual(["2000.0000"]);
    expect(m[0]!.precioPorUnidadStock.toFixed(4)).toBe("0.9000");
  });

  it("(d) en la factura repartida también: 2 kg → 2.000 g", async () => {
    const r = await registrarFacturaProveedorCasoDeUso(actor(), {
      fecha: mediodiaDeHoy(), proveedorId, nroFactura: "A-1-600500", seccionId, items: [linea("EN_GRAMOS", 2, 1800, unidades.kg)],
      reparto: { modo: "IMPORTE", partes: [{ sucursalId: central, valor: 1800 }] }, claveIdempotencia: randomUUID(),
    });
    expect(r.ok, r.mensaje).toBe(true);
    expect((await movimientosDe("EN_GRAMOS")).map((x) => x.cantidad.toFixed(4))).toEqual(["2000.0000"]);
  });

  it("sin unidad tecleada, el comportamiento no cambia: se compra en la unidad por defecto", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([linea("EN_UNIDADES", 2, 24000)]));
    expect(r.ok, r.mensaje).toBe(true);
    expect((await movimientosDe("EN_UNIDADES")).map((x) => x.cantidad.toFixed(4))).toEqual(["12.0000"]);
  });
});

describe("RECHAZA sin escribir nada", () => {
  const casos: [string, string, number, string][] = [
    ["C1 negativo: «bolsa» no es presentación ni unidad del producto", "EN_UNIDADES", 2, "bolsa"],
    ["otra dimensión: litro para un producto en gramos", "EN_GRAMOS", 2, "litro"],
    ["conversión no exacta: 1 g en un producto en toneladas (0,000001 t no cabe)", "EN_TONELADAS", 1, "g"],
    ["unidad sin código fijo (pendiente de completar): no hay tabla de conversión", "EN_GRAMOS", 2, "bolsa"],
    ["una unidad que no existe", "EN_GRAMOS", 2, "NO_EXISTE"],
  ];
  casos.forEach(([titulo, producto, cantidad, unidad]) => {
    it(`${titulo}`, async () => {
      const unidadId = unidades[unidad] ?? "unidad-que-no-existe";
      const r = await registrarMovimientoCasoDeUso(actor(), compra([linea(producto, cantidad, 1000, unidadId)]));
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ codigo: "LINEA_INVALIDA", mensaje: "Valor inválido." });
      expect(await huella()).toEqual(SIN_EFECTOS);
    });
  });

  it("factura repartida: la misma unidad inválida rechaza la factura entera", async () => {
    const r = await registrarFacturaProveedorCasoDeUso(actor(), {
      fecha: mediodiaDeHoy(), proveedorId, nroFactura: "A-1-600501", seccionId, items: [linea("EN_GRAMOS", 2, 1800, unidades.litro)],
      reparto: { modo: "IMPORTE", partes: [{ sucursalId: central, valor: 1800 }] }, claveIdempotencia: randomUUID(),
    });
    expect(r.ok).toBe(false);
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("ATOMICIDAD: compra de 3 líneas con la 2ª inválida no deja ninguna línea ni operación", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([linea("EN_GRAMOS", 2, 1800, unidades.kg), linea("EN_GRAMOS", 2, 1800, unidades.litro), linea("EN_UNIDADES", 2, 24000, unidades.caja)]));
    expect(r).toMatchObject({ ok: false, codigo: "LINEA_INVALIDA" });
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("REPETICIÓN: la misma compra inválida dos veces da dos rechazos iguales y cero efectos", async () => {
    const clave = randomUUID();
    const datos = compra([linea("EN_GRAMOS", 2, 1800, unidades.litro)], clave, "A-1-600600");
    const a = await registrarMovimientoCasoDeUso(actor(), datos);
    const b = await registrarMovimientoCasoDeUso(actor(), datos);
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("CONCURRENCIA: dos compras simultáneas con la misma línea inválida se rechazan las dos y no escriben nada", async () => {
    const rs = await Promise.all([1, 2].map(() => registrarMovimientoCasoDeUso(actor(), compra([linea("EN_GRAMOS", 2, 1800, unidades.litro)]))));
    expect(rs.every((r) => !r.ok)).toBe(true);
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("CONCURRENCIA: la misma compra válida con su clave, enviada tres veces a la vez, entra una sola vez; la inválida a la vez no entra", async () => {
    const clave = randomUUID();
    const valida = compra([linea("EN_GRAMOS", 2, 1800, unidades.kg)], clave, "A-1-600700");
    const rs = await Promise.all([registrarMovimientoCasoDeUso(actor(), valida), registrarMovimientoCasoDeUso(actor(), valida), registrarMovimientoCasoDeUso(actor(), valida), registrarMovimientoCasoDeUso(actor(), compra([linea("EN_GRAMOS", 2, 1800, unidades.litro)]))]);
    expect(rs.slice(0, 3).every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(rs[3]!.ok).toBe(false);
    expect(await prisma.operacion.count()).toBe(1);
    expect((await movimientosDe("EN_GRAMOS")).map((x) => x.cantidad.toFixed(4))).toEqual(["2000.0000"]);
  });
});
