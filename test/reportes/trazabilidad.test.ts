import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerOperacionPorId, buscarOperacionesPorProducto } from "../../src/server/consultas/reportes/trazabilidad";

describe("Trazabilidad", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

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
  });

  it("obtenerOperacionPorId trae los movimientos de la operación, y nunca la de otra sucursal", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const resultado = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });
    expect(resultado.ok).toBe(true);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { sucursalId } });

    const traida = await obtenerOperacionPorId(sucursalId, operacion.id, prisma);
    expect(traida?.items.length).toBe(1);
    expect(traida?.items[0].productoNombre).toBe("Harina");

    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Otra" } });
    const noEncontrada = await obtenerOperacionPorId(otraSucursal.id, operacion.id, prisma);
    expect(noEncontrada).toBeNull();
  });

  it("D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): un CONSUMO por sustitución trae sustituyeANombre; el resto queda en null", async () => {
    const insumoOjo = await prisma.insumo.create({ data: { nombre: "Ojo de bife" } });
    const bife = await sembrarProductoDisponible({ codigo: "MP_BIFE", nombre: "Bife de chorizo", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const ojo = await sembrarProductoDisponible({ codigo: "MP_OJO", nombre: "Ojo de bife", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoOjo.id }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 5000 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: bife.id, cantidad: 0.3, unidadId: unidadKgId, sustitutos: { create: [{ insumoSustitutoId: insumoOjo.id, orden: 1 }] } }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojo.id, cantidad: 1 }] });

    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 1 }] });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });

    const traida = await obtenerOperacionPorId(sucursalId, venta.id, prisma);
    const consumo = traida!.items.find((it) => it.proceso === "CONSUMO")!;
    const filaVenta = traida!.items.find((it) => it.proceso === "VENTA")!;
    expect(consumo.productoNombre).toBe("Ojo de bife");
    expect(consumo.sustituyeANombre).toBe("Bife de chorizo");
    expect(filaVenta.sustituyeANombre).toBeNull();
  });

  it("buscarOperacionesPorProducto encuentra por nombre o código, sin duplicar operación", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_ESPECIAL", nombre: "Harina 000", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] });

    const porNombre = await buscarOperacionesPorProducto(sucursalId, "harina 000", prisma);
    expect(porNombre.length).toBe(1);

    const porCodigo = await buscarOperacionesPorProducto(sucursalId, "MP_ESPECIAL", prisma);
    expect(porCodigo.length).toBe(1);
    expect(porCodigo[0].idOperacion).toBe(porNombre[0].idOperacion);
  });

  it("buscarOperacionesPorProducto busca el texto TAL CUAL: `%` y `_` no son comodines y una barra invertida no escapa nada", async () => {
    const salsa = await sembrarProductoDisponible({ codigo: "MP_SALSA", nombre: "Salsa 100% tomate", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pan = await sembrarProductoDisponible({ codigo: "MP_PAN", nombre: "Pan_integral", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const panBlanco = await sembrarProductoDisponible({ codigo: "MP_PANB", nombre: "Pan integral", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    for (const p of [salsa, pan, panBlanco]) await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: p.id, cantidad: 5 }] });
    const cuantas = async (q: string) => (await buscarOperacionesPorProducto(sucursalId, q, prisma)).length;

    expect(await cuantas("%")).toBe(1); // antes: las 3
    expect(await cuantas("100%")).toBe(1);
    expect(await cuantas("pan_i")).toBe(1); // antes: 2 (el «_» comodín también encontraba «Pan integral»)
    expect(await cuantas("MP_PAN")).toBe(2); // el código con guion bajo sigue encontrándose (y MP_PANB, que empieza igual)
    expect(await cuantas("\\")).toBe(0); // antes: 1 (la barra escapaba el comodín final y encontraba «Salsa 100% tomate»)
  });
});
