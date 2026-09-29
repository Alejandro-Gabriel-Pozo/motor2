import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { listarStockParaConteo } from "../../src/core/movimientos/stock";

describe("listarStockParaConteo", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    mpId = (await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: mpId, disponible: true } });
  });

  it("sin ningún movimiento en la sección, da vacío", async () => {
    expect(await listarStockParaConteo(seccionId, prisma)).toEqual([]);
  });

  it("trae el producto con su saldo actual", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });

    const filas = await listarStockParaConteo(seccionId, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ productoId: mpId, productoCodigo: "MP_1", saldoSistema: 10, loteVencimiento: null });
  });

  it("una fila por (producto, lote) — no mezcla lotes distintos en una sola fila", async () => {
    const lote1 = new Date("2026-01-01");
    const lote2 = new Date("2026-02-01");
    await registrarMovimiento({
      proceso: "COMPRA",
      fecha: new Date(),
      seccionId,
      items: [
        { productoId: mpId, cantidad: 4, loteVencimiento: lote1 },
        { productoId: mpId, cantidad: 6, loteVencimiento: lote2 },
      ],
    });

    const filas = await listarStockParaConteo(seccionId, prisma);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.saldoSistema).sort()).toEqual([4, 6]);
  });

  it("excluye combinaciones (producto, lote) en saldo 0 — nada que verificar ahí", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });

    expect(await listarStockParaConteo(seccionId, prisma)).toEqual([]);
  });

  it("excluye PV comunes (no tienen stock real) aunque tengan movimientos", async () => {
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    // Un PV común no pasa por COMPRA (no es materia prima) — se simula el único
    // camino real por el que podría tener saldo: producción de otro producto
    // "Se produce" no aplica acá, así que se inserta el movimiento directo
    // para probar el filtro en el peor caso (dato inconsistente/legacy).
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "AJUSTE", fecha: new Date(), usuarioId: (await prisma.user.findFirstOrThrow()).id } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId: pv.id, seccionId, proceso: "AJUSTE", cantidad: 5, detalle: "AJUSTE", precioTotal: 0, precioPorUnidadStock: 0 },
    });

    expect(await listarStockParaConteo(seccionId, prisma)).toEqual([]);
  });

  it("no mezcla stock de otra sección", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    const otraSeccion = await sembrarSeccion(sucursalId, "Barra");

    expect(await listarStockParaConteo(otraSeccion.id, prisma)).toEqual([]);
  });
});
