import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { calcularSaldoTotal } from "../../src/server/lecturas/movimientos/saldos";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * E4-2 de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7): la COMPRA decide «se puede comprar» con `capacidadesDelProducto`. Contra Postgres real: una REVENTA sembrada (tipo PV, clase REVENTA, no se produce; la
 * base de prueba ya tiene la migración E4-1) SE COMPRA y entra stock propio; repetir la compra con la misma clave no duplica; dos compras simultáneas suman las dos; un PV común y una MP sin cambios.
 * Nadie crea Reventas todavía (E4-5): el comportamiento en producción no cambia.
 *
 * Mutaciones: volver `productoValidoParaProceso` a `producto.tipo !== "MP"` pone en rojo «se compra» y «dos compras»; sacar `claseDeUso` de `capacidadesDelProducto` (tratar REVENTA como PV) también.
 */
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string, seccionId: string, adminId: string, proveedorId: string, reventaId: string, pvId: string, mpId: string;

const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: central, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [central], escritura: [central] }) });
const compra = (productoId: string, nroFactura: string, claveIdempotencia: string, cantidad = 6): DatosMovimientoInput =>
  ({ proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura, items: [{ productoId, cantidad, precioTotal: 1200, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia }) as DatosMovimientoInput;
const saldo = (productoId: string) => calcularSaldoTotal(productoId, seccionId, central, baseDeTest({ lectura: [central], escritura: [central] }).db);
const compras = (productoId: string) => prisma.movimientoStock.findMany({ where: { productoId, proceso: "COMPRA" }, select: { cantidad: true } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  seccionId = (await sembrarSeccion(central)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Distribuidora" } })).id;
  // La Reventa se siembra con el cliente administrador (nadie la crea desde la app hasta E4-5); la disponibilidad, como siempre.
  const reventa = await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo: "PV_GASEOSA", nombre: "Gaseosa lata", tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precioVenta: 1500, unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: central, productoId: reventa.id, disponible: true } });
  reventaId = reventa.id;
  pvId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", precioVenta: 100, unidadStockId: kg.id }, central)).id;
  mpId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, central)).id;
});

describe("COMPRA de una Reventa", () => {
  it("se compra y entra stock propio (el saldo sube por lo comprado)", async () => {
    expect(await saldo(reventaId)).toBe(0);
    const r = await registrarMovimientoCasoDeUso(actor(), compra(reventaId, "A-1-700001", randomUUID()));
    expect(r.ok, r.mensaje).toBe(true);
    expect((await compras(reventaId)).map((m) => Number(m.cantidad))).toEqual([6]);
    expect(await saldo(reventaId)).toBe(6);
  });

  it("IDEMPOTENCIA: la misma clave repetida es UNA compra (el stock no se duplica)", async () => {
    const clave = randomUUID();
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await registrarMovimientoCasoDeUso(actor(), compra(reventaId, "A-1-700002", clave)));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(rs.filter((r) => r.ok && r.datos.repetida)).toHaveLength(3);
    expect(await compras(reventaId)).toHaveLength(1);
    expect(await saldo(reventaId)).toBe(6);
  });

  it("CONCURRENCIA: dos compras simultáneas (comprobantes distintos) suman las dos", async () => {
    const rs = await Promise.all([registrarMovimientoCasoDeUso(actor(), compra(reventaId, "A-1-700003", randomUUID(), 6)), registrarMovimientoCasoDeUso(actor(), compra(reventaId, "A-1-700004", randomUUID(), 4))]);
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await compras(reventaId)).toHaveLength(2);
    expect(await saldo(reventaId)).toBe(10);
  });

  it("CONCURRENCIA, misma clave: tres envíos a la vez escriben UNA sola compra", async () => {
    const clave = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => registrarMovimientoCasoDeUso(actor(), compra(reventaId, "A-1-700005", clave))));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await compras(reventaId)).toHaveLength(1);
    expect(await saldo(reventaId)).toBe(6);
  });
});

describe("lo que no cambia", () => {
  it("un PV común se sigue rechazando, sin dejar filas", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra(pvId, "A-1-700010", randomUUID()));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(`"Pan" no está habilitado para el proceso "COMPRA" (revisá Tipo/"Se produce"/Consignación).`);
    expect(await prisma.operacion.count()).toBe(0);
    expect(await prisma.movimientoStock.count()).toBe(0);
  });

  it("una MP se sigue comprando", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), compra(mpId, "A-1-700011", randomUUID()));
    expect(r.ok, r.mensaje).toBe(true);
    expect(await saldo(mpId)).toBe(6);
  });
});
