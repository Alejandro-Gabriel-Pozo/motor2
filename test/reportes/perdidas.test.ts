import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { generarReportePerdidas } from "../../src/server/consultas/reportes/perdidas";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

describe("generarReportePerdidas", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let motivoVencidoId: string;
  let motivoRotoId: string;
  let motivoOtroId: string;
  let destinoDegustacionId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const { motivos, destinos } = await sembrarMotivosYDestinos();
    motivoVencidoId = motivos.get("Vencido")!;
    motivoRotoId = motivos.get("Roto o caído")!;
    motivoOtroId = motivos.get("Otro")!;
    destinoDegustacionId = destinos.get("Degustación / cortesía")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("una fila por evento (no agrupado), con fecha y producto, valorizada con el costo de reposición", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 100 }] }); // $10/kg
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId: motivoVencidoId, items: [{ productoId: mp.id, cantidad: 2 }] });
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId: motivoRotoId, items: [{ productoId: mp.id, cantidad: 1 }] });

    const rep = await generarReportePerdidas(sucursalId, 30, prisma, AHORA_DE_LA_CORRIDA);
    expect(rep.mermas).toHaveLength(2);
    // motivo ya viene resuelto a su nombre legible (perdidas.ts, plan "motivos de Consumo/Merma como catálogo administrable", P4) — no el código crudo del enum.
    const vencido = rep.mermas.find((m) => m.motivo === "Vencido")!;
    expect(vencido.valor).toBe(20);
    expect(vencido.producto).toBe("Harina");
    expect(vencido.fecha).toBeInstanceOf(Date);
    expect(vencido.idOperacion).toBeTruthy();
    expect(rep.mermas.find((m) => m.motivo === "Roto o caído")?.valor).toBe(10);
    expect(rep.totalMerma).toBe(30);
  });

  it("no inventa el costo cuando no hay compra registrada: marca sinPrecio y no suma al total", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Sin compra", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] }); // stock sin costo de compra
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId: motivoOtroId, items: [{ productoId: mp.id, cantidad: 2 }] });

    const rep = await generarReportePerdidas(sucursalId, 30, prisma, AHORA_DE_LA_CORRIDA);
    const fila = rep.mermas.find((m) => m.motivo === "Otro")!;
    expect(fila.sinPrecio).toBe(true);
    expect(fila.valor).toBe(0);
    expect(rep.hayCostoIncompleto).toBe(true);
  });

  it("consumo manual queda con su destino tipado; el consumo automático por receta (Venta) cae en su propia fila, cada venta la suya", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20, precioTotal: 200 }] }); // $10/kg

    await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, destinoId: destinoDegustacionId, items: [{ productoId: mp.id, cantidad: 3 }] });
    await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }] }); // genera Consumo automático de la receta

    const rep = await generarReportePerdidas(sucursalId, 30, prisma, AHORA_DE_LA_CORRIDA);
    expect(rep.consumos.find((c) => c.motivo === "Degustación / cortesía")?.cantidad).toBe(3);
    expect(rep.consumos.find((c) => c.motivo === "(automático por receta)")?.cantidad).toBe(2);
  });
});
