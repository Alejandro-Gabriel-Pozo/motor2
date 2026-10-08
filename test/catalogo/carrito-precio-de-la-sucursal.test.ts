import { beforeEach, describe, expect, it } from "vitest";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { cargarOfertasDeProveedores, cargarProductosDeProveedorParaElCarrito } from "../../src/server/lecturas/catalogo/ofertas-de-proveedor";

/**
 * O.5 (Hito 4, paso A4): el precio de la sucursal del carrito sale de la MISMA consulta que las ofertas de la empresa (`cargarOfertasDeProveedores` con `precioDeLaSucursal`), con
 * la semántica exacta de antes (cuando eran dos lecturas): el precio es «propio» si y solo si la sucursal tiene ALGUNA compra vigente del par; su precio es el de su última compra
 * con precio, o 0 si ninguna lo tiene (aunque la empresa tenga uno); su fecha, la de su última compra. Sin compras propias: el precio y la fecha de la empresa, rotulados. Los
 * bordes que `proveedor-por-producto.test.ts` no mira (una sucursal que solo compró a $0, una compra propia anulada) y que la opción no cambia lo de la empresa.
 */
describe("carrito: el precio de la sucursal en la misma consulta (O.5)", () => {
  let central: string;
  let seccionCentral: string;
  let norte: string;
  let seccionNorte: string;
  let usuarioId: string;
  let productoId: string;
  let proveedorId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    central = base.sucursal.id;
    seccionCentral = (await sembrarSeccion(central)).id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    seccionNorte = (await sembrarSeccion(norte, "Depósito Norte")).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
    const kg = (await sembrarCatalogoBase()).kg.id;
    productoId = (await sembrarProductoDisponible({ codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: kg }, central)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino" } })).id;
  });

  const enCentral = (fecha: string, precio: number, anulada = false) =>
    sembrarCompraDeKardex({ sucursalId: central, seccionId: seccionCentral, usuarioId, productoId, proveedorId, fecha, precioPorUnidadStock: precio, anulada });
  const enNorte = (fecha: string, precio: number) => sembrarCompraDeKardex({ sucursalId: norte, seccionId: seccionNorte, usuarioId, productoId, proveedorId, fecha, precioPorUnidadStock: precio });
  const carrito = () => cargarProductosDeProveedorParaElCarrito(prisma, proveedorId, central);
  const dia = (d: Date) => d.toISOString().slice(0, 10);

  it("una sucursal que solo le compró a $0 tiene precio PROPIO en 0 (no toma el de la empresa) y su fecha", async () => {
    await enNorte("2026-09-20", 130);
    await enCentral("2026-09-05", 0);
    const [fila] = await carrito();
    expect(fila).toMatchObject({ origenDelPrecio: "SUCURSAL", ultimoPrecioPorUnidadStock: 0 });
    expect(dia(fila.ultimaCompra)).toBe("2026-09-05");
  });

  it("propio: el último precio > 0 de la sucursal y la fecha de su última compra (aunque sea a $0)", async () => {
    await enCentral("2026-09-01", 90);
    await enCentral("2026-09-10", 0);
    await enNorte("2026-09-20", 130);
    const [fila] = await carrito();
    expect(fila).toMatchObject({ origenDelPrecio: "SUCURSAL", ultimoPrecioPorUnidadStock: 90 });
    expect(dia(fila.ultimaCompra)).toBe("2026-09-10");
  });

  it("sin compras vigentes de la sucursal (la única, anulada): el precio y la fecha de la empresa, rotulados", async () => {
    await enCentral("2026-09-25", 50, true);
    await enNorte("2026-09-20", 130);
    const [fila] = await carrito();
    expect(fila).toMatchObject({ origenDelPrecio: "EMPRESA", ultimoPrecioPorUnidadStock: 130 });
    expect(dia(fila.ultimaCompra)).toBe("2026-09-20");
  });

  it("la opción solo SUMA los dos campos de la sucursal: lo de la empresa es idéntico a leer sin ella", async () => {
    await enCentral("2026-09-01", 90);
    await enNorte("2026-09-20", 130);
    const sin = await cargarOfertasDeProveedores(prisma, { proveedorId });
    const con = await cargarOfertasDeProveedores(prisma, { proveedorId, precioDeLaSucursal: central });
    const deLaEmpresa = (o: (typeof con)[number]) => {
      const copia: Partial<typeof o> = { ...o };
      delete copia.ultimaCompraEnLaSucursal;
      delete copia.precioEnLaSucursal;
      return copia;
    };
    expect(con.map(deLaEmpresa)).toEqual(sin);
    expect(con.map((o) => [o.precioEnLaSucursal, o.ultimaCompraEnLaSucursal && dia(o.ultimaCompraEnLaSucursal)])).toEqual([[90, "2026-09-01"]]);
    expect((await cargarOfertasDeProveedores(prisma, { proveedorId, precioDeLaSucursal: "cnoexiste000000000000000" })).map((o) => [o.precioEnLaSucursal, o.ultimaCompraEnLaSucursal])).toEqual([
      [null, null],
    ]);
  });
});
