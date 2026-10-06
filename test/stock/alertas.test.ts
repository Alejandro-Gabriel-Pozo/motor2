import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";
import { calcularAlertasStock, obtenerResumenAlertasStock } from "../../src/server/consultas/stock/alertas";
import { prisma } from "../setup/test-db";

describe("calcularAlertasStock", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionBId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;
  let motivoVencidoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito A")).id;
    seccionBId = (await sembrarSeccion(sucursalId, "Depósito B")).id;
    motivoVencidoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Tomate", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    mpId = mp.id;
  });

  it("sin Stock Mínimo configurado, nunca alerta aunque el saldo sea 0", async () => {
    const alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)).toBeUndefined();
  });

  it("saldo positivo pero por debajo o igual al mínimo: BAJO; por encima: no alerta", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await setStockMinimoProducto(mpId, 10);

    let alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)?.estado).toBe("BAJO");

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });
    alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)).toBeUndefined(); // 15 > 10: ya no alerta
  });

  it("Merma que deja el saldo en 0 dispara CRITICO", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await setStockMinimoProducto(mpId, 5);
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId: motivoVencidoId, items: [{ productoId: mpId, cantidad: 10 }] });

    const alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)?.estado).toBe("CRITICO");
  });

  it("mínimo configurado en 0 SÍ alerta si el saldo queda en 0 o negativo — distinto de 'sin mínimo cargado' (hallazgo de la auditoría)", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });
    await setStockMinimoProducto(mpId, 0); // "avisame si esto se termina del todo", no "sin mínimo"
    await registrarMovimiento({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId: motivoVencidoId, items: [{ productoId: mpId, cantidad: 5 }] });

    const alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)?.estado).toBe("CRITICO");
  });

  it("mínimo configurado en 0 con saldo positivo no alerta", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });
    await setStockMinimoProducto(mpId, 0);

    const alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)).toBeUndefined();
  });

  it("el mínimo por sección gana sobre el mínimo global de la sucursal", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 8 }] });
    await setStockMinimoProducto(mpId, 3); // global: 8 > 3, no alertaría
    await setStockMinimoProducto(mpId, 20, seccionId); // por sección: 8 <= 20, sí alerta

    const alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.productoId === mpId)?.estado).toBe("BAJO");
  });

  it("una sección sin mínimo propio usa el global de la sucursal", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccionBId, items: [{ productoId: mpId, cantidad: 2 }] });
    await setStockMinimoProducto(mpId, 10); // global, sin fila específica para seccionBId

    const alertas = await calcularAlertasStock(sucursalId, prisma);
    expect(alertas.find((a) => a.seccionId === seccionBId)?.estado).toBe("BAJO"); // 2 > 0 (no CRITICO) y 2 <= 10 (BAJO)
  });

  it("obtenerResumenAlertasStock cuenta críticos y bajos por separado", async () => {
    const otroMp = await sembrarProductoDisponible({ codigo: "MP_2", nombre: "Cebolla", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpId, cantidad: 3 }] });
    await setStockMinimoProducto(mpId, 10); // BAJO
    await setStockMinimoProducto(otroMp.id, 5); // sin compra: saldo 0 -> nunca alerta (groupBy no ve productos sin movimientos)

    const resumen = await obtenerResumenAlertasStock(sucursalId, prisma);
    expect(resumen.total).toBe(1);
    expect(resumen.bajos).toBe(1);
    expect(resumen.criticos).toBe(0);
  });
});
