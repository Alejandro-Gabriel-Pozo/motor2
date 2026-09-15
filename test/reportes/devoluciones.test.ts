import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { generarReporteDevoluciones } from "../../src/core/reportes/devoluciones";

describe("generarReporteDevoluciones", () => {
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

  it("agrupa devoluciones de clientes por producto y devoluciones a proveedores por proveedor", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20, precioTotal: 200 }] }); // $10/kg

    await registrarMovimiento({ proceso: "DEVOLUCION_CLIENTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 2 }] });
    await registrarMovimiento({ proceso: "DEVOLUCION_PROVEEDOR", fecha: new Date(), seccionId, proveedorId: proveedor.id, items: [{ productoId: mp.id, cantidad: 3, precioTotal: 30 }] });

    const rep = await generarReporteDevoluciones(sucursalId, 30);
    expect(rep.clientes.find((c) => c.producto === "Harina")?.cantidad).toBe(2);
    expect(rep.clientes.find((c) => c.producto === "Harina")?.valor).toBe(20); // valorizado al costo de reposición, no al precio de la propia devolución

    const filaProveedor = rep.proveedores.find((p) => p.proveedor === "Molino SA")!;
    expect(filaProveedor.cantidad).toBe(3);
    expect(filaProveedor.valor).toBe(30);
  });
});
