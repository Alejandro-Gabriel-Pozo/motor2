import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerResumenConsolidado } from "../../src/core/reportes/resumen-consolidado";
import { crearMembresia } from "../setup/membresia";

describe("obtenerResumenConsolidado", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    __setCookieDeTestParaSucursal(undefined);
  });

  it("junta una fila por sucursal, cada una con su propio financiero — sin mezclar entre ellas", async () => {
    const base = await sembrarBase();
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const catalogo = await sembrarCatalogoBase();
    const seccion1 = await sembrarSeccion(base.sucursal.id);
    const seccion2 = await sembrarSeccion(sucursal2.id);
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: sucursal2.id, rolId: base.admin.id, activo: true });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const pv1 = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Pan Central", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 100 }, base.sucursal.id);
    const pv2 = await sembrarProductoDisponible({ codigo: "PV_2", nombre: "Pan Norte", tipo: "PV", unidadStockId: catalogo.kg.id, precioVenta: 50 }, sucursal2.id);
    // El admin tiene membresía en las dos sucursales — cada venta se
    // registra con esa sucursal como "activa" (mismo mecanismo que
    // cambiarSucursalActiva en producción real), no solo pasando el
    // seccionId: registrarVenta valida que la sección sea de la sucursal
    // activa de quien llama (Fase 6, auditoría de seguridad/contratos).
    __setCookieDeTestParaSucursal(base.sucursal.id);
    await registrarVenta({ fecha: new Date(), seccionId: seccion1.id, ventas: [{ productoId: pv1.id, cantidadVendida: 2 }] });
    __setCookieDeTestParaSucursal(sucursal2.id);
    await registrarVenta({ fecha: new Date(), seccionId: seccion2.id, ventas: [{ productoId: pv2.id, cantidadVendida: 3 }] });

    const filas = await obtenerResumenConsolidado([
      { id: base.sucursal.id, nombre: base.sucursal.nombre },
      { id: sucursal2.id, nombre: sucursal2.nombre },
    ], prisma);

    expect(filas).toHaveLength(2);
    const central = filas.find((f) => f.sucursalId === base.sucursal.id)!;
    const norte = filas.find((f) => f.sucursalId === sucursal2.id)!;
    expect(central.ventasTotal).toBe(200); // 2 × 100, no se mezcla con Norte
    expect(norte.ventasTotal).toBe(150); // 3 × 50
  });

  it("sin ninguna venta/compra, da filas en 0 en vez de romper", async () => {
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const filas = await obtenerResumenConsolidado([{ id: base.sucursal.id, nombre: base.sucursal.nombre }], prisma);
    expect(filas).toEqual([
      expect.objectContaining({ sucursalId: base.sucursal.id, ventasTotal: 0, margenTotal: 0, gastadoTotal: 0, alertasCriticas: 0, alertasBajas: 0 }),
    ]);
  });
});
