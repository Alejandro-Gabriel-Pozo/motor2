import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { DIA_MS, enElPasado } from "../setup/tiempo";
import { preciosLocalesVigentes } from "../../src/server/lecturas/catalogo/precio-local";
import { cargarCatalogoDeProductos } from "../../src/server/lecturas/reportes/comun";
import { disponibilidadDeProductosEnSucursales } from "../../src/server/lecturas/catalogo/disponibilidad";
import { cargarLineasDelPeriodo, cargarLineasDelPeriodoDeSucursales } from "../../src/server/consultas/reportes/periodo";

/**
 * O.38b (D1 y D3 de docs/plan-hito-4-pureza.md §4): `cargarLineasDelPeriodoDeSucursales` con varias sucursales da, para CADA una, exactamente lo mismo que
 * `cargarLineasDelPeriodo` de esa sucursal sola —las mismas líneas, en el mismo orden, y el mismo catálogo—, también cuando quien llama le pasa lo ya leído
 * POR sucursal (su Precio Local y su disponibilidad, como hace el Consolidado). El Consolidado solo muestra totales: un reparto cruzado de la disponibilidad
 * (la de una sucursal en el mapa de otra) no cambia ninguno de sus números, así que esto lo fija acá. Las sucursales difieren en lo que se reparte: líneas
 * propias, un plato disponible solo en una, y un Precio Local solo en la otra.
 */
describe("cargarLineasDelPeriodoDeSucursales: cada sucursal, igual que sola (O.38b)", () => {
  let central: string;
  let norte: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const { kg } = await sembrarCatalogoBase();
    central = base.sucursal.id;
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
    const seccionCentral = (await sembrarSeccion(central)).id;
    const seccionNorte = (await sembrarSeccion(norte)).id;

    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, central);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: harina.id, disponible: true } });
    // El Pan: disponible en Central, APAGADO en Norte. El Agua: disponible en las dos, con Precio Local solo en Norte.
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, central);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: pan.id, disponible: false } });
    const agua = await sembrarProductoDisponible({ codigo: "PV_AGUA", nombre: "Agua", tipo: "PV", unidadStockId: kg.id, precioVenta: 50 }, central);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: agua.id, disponible: true } });
    await prisma.precioLocalProducto.create({ data: { sucursalId: norte, productoId: agua.id, precio: 70 } });

    const compra = (sucursalId: string, seccionId: string, dias: number, precio: number) =>
      sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: harina.id, proveedorId: null, fecha: enElPasado(dias * DIA_MS).toISOString(), precioPorUnidadStock: precio });
    await compra(central, seccionCentral, 5, 20);
    await compra(norte, seccionNorte, 5, 30);
    await compra(central, seccionCentral, 3, 21);
    await compra(norte, seccionNorte, 2, 31);
    await compra(norte, seccionNorte, 1, 32);
  });

  it("con lo ya leído por sucursal (como el Consolidado) y sin nada: las líneas y el catálogo de cada una, iguales a los de la de una sucursal", async () => {
    const desde = enElPasado(10 * DIA_MS);
    const hasta = enElPasado(0);
    const ids = [central, norte];
    const catalogo = await cargarCatalogoDeProductos(prisma);
    const disponibilidad = await disponibilidadDeProductosEnSucursales(
      ids,
      catalogo.map((p) => p.id),
      prisma
    );
    const precios = new Map(await Promise.all(ids.map(async (id) => [id, await preciosLocalesVigentes(id, prisma)] as const)));

    const conLoLeido = await cargarLineasDelPeriodoDeSucursales(ids, desde, hasta, {}, prisma, { catalogo, disponibilidad, preciosLocales: precios });
    const sinNada = await cargarLineasDelPeriodoDeSucursales(ids, desde, hasta, {}, prisma);
    for (const id of ids) {
      const sola = await cargarLineasDelPeriodo(id, desde, hasta, {}, prisma);
      for (const n of [conLoLeido, sinNada]) {
        expect(n.porSucursal.get(id)!.items, id).toEqual(sola.items);
        expect(n.porSucursal.get(id)!.productos, id).toEqual(sola.productos);
      }
    }

    // El escenario no es trivial: cada sucursal tiene sus líneas, y el catálogo difiere en la disponibilidad del Pan y el precio del Agua.
    const de = (id: string) => conLoLeido.porSucursal.get(id)!;
    expect(de(central).items.map((i) => i.precioPorUnidadStock)).toEqual([20, 21]);
    expect(de(norte).items.map((i) => i.precioPorUnidadStock)).toEqual([30, 31, 32]);
    const producto = (id: string, codigo: string) => [...de(id).productos.values()].find((p) => p.codigo === codigo)!;
    expect([producto(central, "PV_PAN").disponible, producto(norte, "PV_PAN").disponible]).toEqual([true, false]);
    expect([producto(central, "PV_AGUA").precioVenta, producto(norte, "PV_AGUA").precioVenta]).toEqual([50, 70]);
  });
});
