import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
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
    const mp = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20, precioTotal: 200 }] }); // $10/kg

    await registrarMovimiento({ proceso: "DEVOLUCION_CLIENTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 2 }] });
    await registrarMovimiento({ proceso: "DEVOLUCION_PROVEEDOR", fecha: new Date(), seccionId, proveedorId: proveedor.id, items: [{ productoId: mp.id, cantidad: 3, precioTotal: 30 }] });

    const rep = await generarReporteDevoluciones(sucursalId, 30, prisma);
    expect(rep.clientes.find((c) => c.producto === "Harina")?.cantidad).toBe(2);
    expect(rep.clientes.find((c) => c.producto === "Harina")?.valor).toBe(20); // valorizado al costo de reposición, no al precio de la propia devolución

    const filaProveedor = rep.proveedores.find((p) => p.proveedor === "Molino SA")!;
    expect(filaProveedor.cantidad).toBe(3);
    expect(filaProveedor.valor).toBe(30);
  });

  it("sin costo de reposición: sugiere cargar una compra, o revisar la receta si el insumo 'Se produce' (§7.1)", async () => {
    const comprado = await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Sin compra", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const producido = await sembrarProductoDisponible(
      { codigo: "MP_2", nombre: "Prepizza masa", tipo: "MP", unidadStockId: unidadKgId, insumoId, seProduce: true },
      sucursalId
    );
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: comprado.id, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: producido.id, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "DEVOLUCION_CLIENTE", fecha: new Date(), seccionId, items: [{ productoId: comprado.id, cantidad: 1 }] });
    await registrarMovimiento({ proceso: "DEVOLUCION_CLIENTE", fecha: new Date(), seccionId, items: [{ productoId: producido.id, cantidad: 1 }] });

    const rep = await generarReporteDevoluciones(sucursalId, 30, prisma);
    const filaComprado = rep.clientes.find((c) => c.productoId === comprado.id)!;
    expect(filaComprado.sinPrecio).toBe(true);
    expect(filaComprado.accionFaltante).toEqual({ href: `/movimientos/compra?productoId=${comprado.id}`, etiqueta: "Sin costo de reposición — cargar compra" });

    const filaProducido = rep.clientes.find((c) => c.productoId === producido.id)!;
    expect(filaProducido.accionFaltante).toEqual({ href: `/catalogo/recetas/${producido.id}`, etiqueta: "Sin costo de reposición — revisar receta" });
  });
});
