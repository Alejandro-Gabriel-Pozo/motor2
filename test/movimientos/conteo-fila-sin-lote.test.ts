import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { listarStockParaConteo } from "../../src/server/consultas/movimientos/stock-para-conteo";

/**
 * La grilla del conteo físico ofrece una fila por (producto, lote) y, si el producto TAMBIÉN tiene stock sin lote, una fila «Todos los lotes» con el saldo TOTAL: contar sin lote es contar el
 * total (`registrarConteoFisico` compara contra `calcularSaldoTotal`), y lo que la grilla muestra tiene que ser lo que se compara (decisión del dueño, opción 2). Antes esa fila mostraba el saldo
 * del grupo sin lote (4) pero se comparaba contra el total (14): contarla con 4 ajustaba −10 y el sistema quedaba con 4 teniendo 14 físicos. Caso mixto: 10 con lote y 4 sin lote.
 */
describe("conteo: la fila «sin lote» de un producto con lotes es el total y se compara contra el total", () => {
  let sucursalId: string;
  let seccionId: string;
  let mpId: string;
  const lote = new Date(Date.now() + 30 * 24 * 3_600_000);

  const filasDelProducto = async () => (await listarStockParaConteo(seccionId, sucursalId, prisma)).filter((f) => f.productoId === mpId);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10, loteVencimiento: lote }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 4 }] });
  });

  it("la grilla ofrece el lote con 10 y una fila «Todos los lotes» con el total (14)", async () => {
    const filas = await filasDelProducto();
    expect(filas.map((f) => [f.loteVencimiento ? "con lote" : "todos los lotes", f.saldoSistema, f.esTotalDeLotes]).sort()).toEqual([
      ["con lote", 10, false],
      ["todos los lotes", 14, true],
    ]);
  });

  it("EL DEFECTO: contar la fila «Todos los lotes» con los 14 que mostraba ya coincide (diferencia 0) y no escribe ningún ajuste (antes comparaba 4 de la fila contra 14 del total)", async () => {
    const fila = (await filasDelProducto()).find((f) => f.esTotalDeLotes)!;
    const movimientosAntes = await prisma.movimientoStock.count();

    const r = await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: fila.saldoSistema, fechaConteo: new Date(), accion: "AJUSTAR" });

    expect(r.ok, r.mensaje).toBe(true);
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(Number(conteo.saldoSistema)).toBe(fila.saldoSistema);
    expect(Number(conteo.diferencia)).toBe(0);
    expect(await prisma.movimientoStock.count()).toBe(movimientosAntes);
  });

  it("contar la fila del lote sigue comparando contra ese lote (10), sin mirar lo sin lote", async () => {
    const r = await registrarConteoFisico({ productoId: mpId, seccionId, loteVencimiento: lote, conteoReal: 10, fechaConteo: new Date(), accion: "AJUSTAR" });
    expect(r.ok, r.mensaje).toBe(true);
    const conteo = await prisma.conteoFisico.findFirstOrThrow({ where: { productoId: mpId } });
    expect(Number(conteo.saldoSistema)).toBe(10);
    expect(Number(conteo.diferencia)).toBe(0);
  });

  it("un producto SIN lotes con fecha conserva su fila «sin lote» con su saldo y sin rótulo de total", async () => {
    await prisma.movimientoStock.deleteMany({ where: { productoId: mpId, loteVencimiento: { not: null } } });
    const filas = await filasDelProducto();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ loteVencimiento: null, esTotalDeLotes: false });
  });
});
