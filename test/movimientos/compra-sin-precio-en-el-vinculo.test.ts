import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { cargarOfertasDeProveedores } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";
import { obtenerCostoActualPorMP } from "../../src/server/lecturas/reportes/comun";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";

/**
 * Poda (decisión del dueño, 2026-11-06): la compra deja de escribir el PRECIO en `ProveedorPorProducto` (`precioUnitario`, `precioPorUnidadStock`) y su auditoría: ningún lector los usa
 * (la ficha, la comparativa y la precarga salen del Kardex vigente) y el costo vive en el Kardex. Se sigue escribiendo lo que SÍ se lee: la unidad de compra, la referencia del proveedor y
 * `ultimaCompra` (ordena la fila más reciente del par). Las columnas NO se borran.
 * Lo que NO puede cambiar: stock, Kardex y costo vigente de una compra con varias líneas (valores esperados escritos a mano, un «golden»), la idempotencia y la concurrencia.
 */
describe("la compra ya no escribe el precio en el vínculo proveedor↔producto", () => {
  let sucursalId: string;
  let seccionId: string;
  let proveedorId: string;
  let productos: { id: string }[];

  const lineas = (referencias = ["ACE-5L", "HAR-25", "AZU-1"]) => [
    { productoId: productos[0]!.id, cantidad: 10, precioTotal: 1000, referenciaProveedor: referencias[0] }, // 100 por kg
    { productoId: productos[1]!.id, cantidad: 4, precioTotal: 1000, referenciaProveedor: referencias[1] }, // 250 por kg
    { productoId: productos[2]!.id, cantidad: 3, precioTotal: 90, referenciaProveedor: referencias[2] }, // 30 por kg
  ];
  const comprar = (fecha: string, items = lineas(), clave: string = crypto.randomUUID(), nroFactura = nroFacturaDePrueba()) =>
    registrarMovimiento({ proceso: "COMPRA", nroFactura, fecha: new Date(fecha), seccionId, proveedorId, items, claveIdempotencia: clave });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    await sembrarMotivosYDestinos();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    productos = [];
    for (const [codigo, nombre] of [["MP_ACEITE", "Aceite"], ["MP_HARINA", "Harina"], ["MP_AZUCAR", "Azúcar"]] as const) {
      productos.push(await sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: catalogo.kg.id, unidadCompraId: catalogo.kg.id }, sucursalId));
    }
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Distribuidora" } })).id;
  });

  it("GOLDEN: una compra de tres líneas deja el mismo stock, el mismo Kardex y el mismo costo vigente de siempre", async () => {
    const r = await comprar("2026-09-10");
    expect(r.ok, r.mensaje).toBe(true);

    const kardex = await prisma.movimientoStock.findMany({ where: { proceso: "COMPRA" }, orderBy: { productoId: "asc" } });
    const porProducto = new Map(kardex.map((m) => [m.productoId, m]));
    const esperado: [string, number, number, number][] = [
      [productos[0]!.id, 10, 1000, 100],
      [productos[1]!.id, 4, 1000, 250],
      [productos[2]!.id, 3, 90, 30],
    ];
    expect(kardex).toHaveLength(3);
    for (const [id, cantidad, total, porUnidad] of esperado) {
      const m = porProducto.get(id)!;
      expect([Number(m.cantidad), Number(m.precioTotal), Number(m.precioPorUnidadStock)]).toEqual([cantidad, total, porUnidad]);
    }
    const costo = await obtenerCostoActualPorMP(sucursalId, prisma);
    for (const [id, , , porUnidad] of esperado) expect(costo.get(id)?.precioPorUnidadStock).toBe(porUnidad);
  });

  it("el vínculo guarda la unidad, la referencia y la fecha, pero ya no el precio, y la compra no deja auditoría del vínculo", async () => {
    expect((await comprar("2026-09-10")).ok).toBe(true);
    const vinculos = await prisma.proveedorPorProducto.findMany({ where: { proveedorId }, orderBy: { referenciaProveedor: "asc" } });
    expect(vinculos.map((v) => v.referenciaProveedor)).toEqual(["ACE-5L", "AZU-1", "HAR-25"]);
    for (const v of vinculos) {
      expect(Number(v.precioUnitario)).toBe(0);
      expect(Number(v.precioPorUnidadStock)).toBe(0);
      expect(v.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-10");
    }
    expect(await prisma.registroAuditoria.count({ where: { entidad: "ProveedorPorProducto" } })).toBe(0);
  });

  it("la ficha de oferta del proveedor muestra lo mismo (precio y fecha salen del Kardex), y una compra más nueva mueve la fecha de la fila (ultimaCompra) pero una más vieja no", async () => {
    await comprar("2026-09-10");
    await comprar("2026-09-20", [{ productoId: productos[0]!.id, cantidad: 10, precioTotal: 1200, referenciaProveedor: "ACE-5L" }]);
    await comprar("2026-08-01", [{ productoId: productos[0]!.id, cantidad: 10, precioTotal: 500, referenciaProveedor: "ACE-5L" }]);

    const ofertas = await cargarOfertasDeProveedores(prisma, { proveedorId });
    const aceite = ofertas.find((o) => o.productoId === productos[0]!.id)!;
    expect(aceite.precioPorUnidadStock).toBe(120);
    expect(aceite.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(aceite.referenciaProveedor).toBe("ACE-5L");
    expect(ofertas.find((o) => o.productoId === productos[1]!.id)!.precioPorUnidadStock).toBe(250);

    const fila = await prisma.proveedorPorProducto.findFirstOrThrow({ where: { proveedorId, productoId: productos[0]!.id } });
    expect(fila.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("IDEMPOTENCIA: la misma compra reenviada con la misma clave entra una sola vez (stock, vínculos)", async () => {
    const clave = crypto.randomUUID();
    const factura = nroFacturaDePrueba();
    const primera = await comprar("2026-09-10", lineas(), clave, factura);
    const repetida = await comprar("2026-09-10", lineas(), clave, factura);
    expect(primera.ok).toBe(true);
    expect(repetida.ok).toBe(true);
    expect(await prisma.movimientoStock.count({ where: { proceso: "COMPRA" } })).toBe(3);
    expect(await prisma.proveedorPorProducto.count({ where: { proveedorId } })).toBe(3);
  });

  it("CONCURRENCIA: dos compras simultáneas del mismo par terminan sin error, con una sola fila de vínculo y la fecha más reciente", async () => {
    const item = (precioTotal: number) => [{ productoId: productos[0]!.id, cantidad: 10, precioTotal, referenciaProveedor: "ACE-5L" }];
    const resultados = await Promise.all([comprar("2026-09-20", item(1000)), comprar("2026-09-21", item(1500))]);
    expect(resultados.every((r) => r.ok), JSON.stringify(resultados)).toBe(true);
    const filas = await prisma.proveedorPorProducto.findMany({ where: { proveedorId, productoId: productos[0]!.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-21");
    expect(await prisma.movimientoStock.count({ where: { proceso: "COMPRA", productoId: productos[0]!.id } })).toBe(2);
  });
});
