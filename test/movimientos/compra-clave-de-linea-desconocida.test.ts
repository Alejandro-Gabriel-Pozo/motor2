import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { guardClavesDeLineaDeCompra } from "../../src/core/features/compras/compra.guard";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput, ItemMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Oráculo de compras, C5 (docs/oraculo-de-compras-y-presentaciones-contra-motor2-2026-11-17.md): una línea de Compra/Devolución a proveedor acepta SOLO las claves declaradas (lista de permitidos).
 * Una clave de precio que el sistema no conoce (`precioUnitario`) antes se ignoraba: la línea entraba con precio total 0 y costo 0, sin aviso. Ahora rechaza la operación entera, sin escribir nada.
 *
 * Mutación comprobada (anotada en el commit): sacar la llamada a `guardClavesDeLineaDeCompra` de `armar-linea-de-movimiento.ts` → rojo en todo lo marcado «RECHAZA».
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string, seccionId: string, adminId: string, proveedorId: string, productoId: string;
let contador = 0;

const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: central, sucursalNombre: "Central", ...baseDeTest({ lectura: [central], escritura: [central] }), ahora: new Date() });
const valida = (): ItemMovimientoInput => ({ productoId, cantidad: 2, precioTotal: 3600, referenciaProveedor: REFERENCIA_DE_PRUEBA });
const conClaveDesconocida = (): ItemMovimientoInput => ({ productoId, cantidad: 2, precioUnitario: 1800, referenciaProveedor: REFERENCIA_DE_PRUEBA }) as unknown as ItemMovimientoInput;
const compra = (items: ItemMovimientoInput[], clave = randomUUID(), proceso: "COMPRA" | "DEVOLUCION_PROVEEDOR" = "COMPRA"): DatosMovimientoInput =>
  ({ proceso, fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura: `A-1-${700000 + ++contador}`, items, claveIdempotencia: clave }) as DatosMovimientoInput;

const huella = async () => ({
  operaciones: await prisma.operacion.count(),
  movimientos: await prisma.movimientoStock.count(),
  facturas: await prisma.facturaProveedor.count(),
  renglones: await prisma.facturaProveedorRenglon.count(),
});
const SIN_EFECTOS = { operaciones: 0, movimientos: 0, facturas: 0, renglones: 0 };

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  seccionId = (await sembrarSeccion(central)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  productoId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, central)).id;
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

describe("guardClavesDeLineaDeCompra (lista de permitidos)", () => {
  it("acepta exactamente las claves declaradas, con o sin valor", () => {
    expect(guardClavesDeLineaDeCompra({ productoId: "a", cantidad: 1, loteVencimiento: null, precioTotal: 1, pesoReal: null, unidadCompraId: undefined, referenciaProveedor: "x" }).ok).toBe(true);
    expect(guardClavesDeLineaDeCompra({}).ok).toBe(true);
  });
  it("rechaza cualquier otra clave, también las que parecen inofensivas o heredadas del prototipo", () => {
    for (const clave of ["precioUnitario", "precio", "importe", "costo", "PrecioTotal", "toString", "__proto__", "constructor", ""]) {
      const linea = JSON.parse(`{${JSON.stringify(clave)}: 1}`) as object;
      expect(guardClavesDeLineaDeCompra(linea).ok, clave).toBe(false);
    }
  });
});

describe("RECHAZA una línea con clave de precio desconocida, sin escribir nada", () => {
  it("compra simple (C5): precioUnitario 1800 ya no entra con precio 0", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([conClaveDesconocida()]));
    expect(r).toMatchObject({ ok: false, codigo: "LINEA_INVALIDA", mensaje: "Valor inválido." });
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("factura repartida", async () => {
    const r = await registrarFacturaProveedorCasoDeUso(actor(), {
      fecha: mediodiaDeHoy(), proveedorId, nroFactura: "A-1-700500", seccionId, items: [conClaveDesconocida()],
      reparto: { modo: "IMPORTE", partes: [{ sucursalId: central, valor: 1800 }] }, claveIdempotencia: randomUUID(),
    });
    expect(r).toMatchObject({ ok: false, codigo: "LINEA_INVALIDA" });
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("devolución a proveedor: se rechaza aunque haya stock para devolver", async () => {
    expect((await registrarMovimientoCasoDeUso(actor(), compra([valida()]))).ok).toBe(true);
    const antes = await huella();
    const r = await registrarMovimientoCasoDeUso(actor(), compra([conClaveDesconocida()], randomUUID(), "DEVOLUCION_PROVEEDOR"));
    expect(r).toMatchObject({ ok: false, codigo: "LINEA_INVALIDA" });
    expect(await huella()).toEqual(antes);
  });

  it("ATOMICIDAD: compra de 3 líneas con la 2ª con clave desconocida no deja ninguna", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([valida(), conClaveDesconocida(), valida()]));
    expect(r).toMatchObject({ ok: false, codigo: "LINEA_INVALIDA" });
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("REPETICIÓN: la misma compra inválida dos veces da dos rechazos iguales y cero efectos", async () => {
    const datos = compra([conClaveDesconocida()]);
    const a = await registrarMovimientoCasoDeUso(actor(), datos);
    const b = await registrarMovimientoCasoDeUso(actor(), datos);
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
    expect(await huella()).toEqual(SIN_EFECTOS);
  });

  it("CONCURRENCIA: la válida (misma clave, 3 envíos) entra una sola vez y la inválida a la vez no entra", async () => {
    const datos = compra([valida()]);
    const rs = await Promise.all([registrarMovimientoCasoDeUso(actor(), datos), registrarMovimientoCasoDeUso(actor(), datos), registrarMovimientoCasoDeUso(actor(), datos), registrarMovimientoCasoDeUso(actor(), compra([conClaveDesconocida()]))]);
    expect(rs.slice(0, 3).every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(rs[3]!.ok).toBe(false);
    expect(await prisma.operacion.count()).toBe(1);
    expect(await prisma.movimientoStock.count()).toBe(1);
  });
});

describe("la misma compra válida sigue entrando", () => {
  it("con precioTotal declarado: stock 2 y costo 1.800 por unidad", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra([valida()]));
    expect(r.ok, r.mensaje).toBe(true);
    const m = await prisma.movimientoStock.findMany({ where: { productoId }, select: { cantidad: true, precioTotal: true, precioPorUnidadStock: true } });
    expect(m.map((x) => [x.cantidad.toFixed(4), x.precioTotal.toFixed(2), x.precioPorUnidadStock.toFixed(4)])).toEqual([["2.0000", "3600.00", "1800.0000"]]);
  });
});
