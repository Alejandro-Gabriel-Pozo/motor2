import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { cargarAdminCarta, cargarAdminItemsAgrupados } from "../../src/core/carta/admin-consulta";

/**
 * Lectura del admin de los ítems agrupados (docs/plan-agrupacion-items-carta-2026-09-24.md, M6), contra Postgres real:
 * `/catalogo/carta` ya no avisa como "sin contenido" a un PV agrupado (sale a través del grupo), y `/catalogo/carta/agrupados`
 * recibe los avisos de D4 (opción en otra sección) y D5 (precios distintos acá: rango y el precio que se termina mostrando, el
 * mayor), más "sin opciones disponibles acá".
 */
describe("admin de ítems agrupados", () => {
  let central: string;
  let otra: string;
  let cGas: string;
  let ids: Record<string, string>;
  let agId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    cGas = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } })).id;
    const cAgua = (await prisma.categoriaProducto.create({ data: { nombre: "Aguas" } })).id;
    const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol" } });
    const otras = await prisma.seccionCarta.create({ data: { nombre: "Otras bebidas" } });
    await prisma.categoriaSeccionCarta.createMany({
      data: [
        { categoriaId: cGas, seccionCartaId: bebidas.id },
        { categoriaId: cAgua, seccionCartaId: otras.id },
      ],
    });
    let n = 0;
    const pv = async (nombre: string, precioVenta: number, categoriaId: string, sucursales: string[]) => {
      const p = await prisma.producto.create({ data: { codigo: `ADM_AGR_${++n}`, nombre, tipo: "PV", categoriaId, precioVenta, unidadStockId: u.id } });
      await prisma.disponibilidadProducto.createMany({ data: sucursales.map((sucursalId) => ({ sucursalId, productoId: p.id, disponible: true })) });
      return p.id;
    };
    ids = {
      coca: await pv("Coca-Cola 500cc", 5000, cGas, [central, otra]),
      sprite: await pv("Sprite 500cc", 5000, cGas, [central, otra]),
      agua: await pv("Agua saborizada 500cc", 5000, cAgua, [central]),
      suelta: await pv("Tónica 500cc", 5500, cGas, [central]),
    };
    agId = (await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa 500 CC", categoriaId: cGas, especial: true } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [
        { itemAgrupadoCartaId: agId, productoId: ids.coca, orden: 0 },
        { itemAgrupadoCartaId: agId, productoId: ids.sprite, orden: 1 },
      ],
    });
  });

  it("/catalogo/carta: un PV agrupado sin contenido NO está en sinContenido y tiene agrupadoEn", async () => {
    const datos = await cargarAdminCarta(central);
    const coca = datos.productos.find((p) => p.id === ids.coca)!;
    expect(coca.agrupadoEn).toBe("Gaseosa 500 CC");
    expect(coca.contenido).toBeNull();
    expect(datos.sinContenido.map((p) => p.nombre)).toEqual(["Agua saborizada 500cc", "Tónica 500cc"]);
    expect(datos.productos.find((p) => p.id === ids.suelta)!.agrupadoEn).toBeNull();
  });

  it("sin avisos cuando las opciones cuestan lo mismo y están en la sección del ítem", async () => {
    const datos = await cargarAdminItemsAgrupados(central);
    expect(datos.items).toHaveLength(1);
    const [item] = datos.items;
    expect(item).toMatchObject({
      nombre: "Gaseosa 500 CC",
      categoria: "Gaseosa 500 CC",
      seccionCarta: "Bebidas sin alcohol",
      especial: true,
      activo: true,
      disponiblesAca: 2,
      precio: { minimo: 5000, maximo: 5000 },
      avisos: { preciosDistintos: null, sinOpcionesAca: false, sinSeccion: false, opcionesEnOtraSeccion: false },
    });
    expect(item.opciones.map((o) => [o.nombre, o.disponibleAca, o.precioAca, o.otraSeccion])).toEqual([
      ["Coca-Cola 500cc", true, 5000, false],
      ["Sprite 500cc", true, 5000, false],
    ]);
    // El select "Agregar producto": PV disponibles acá que no están en ningún grupo, con su precio acá.
    expect(datos.productosSinGrupo).toEqual([
      { id: ids.agua, nombre: "Agua saborizada 500cc", precioAca: 5000 },
      { id: ids.suelta, nombre: "Tónica 500cc", precioAca: 5500 },
    ]);
    expect(datos.categorias.map((c) => c.nombre)).toEqual(["Aguas", "Gaseosa 500 CC"]);
    expect(datos.diagnostico).toEqual({ agrupadosSinSeccion: [], agrupadosSinOpciones: [], agrupadosConPreciosDistintos: [] });
  });

  it("aviso D5: precios distintos acá (un cambio posterior en Catálogo) → rango $X-$Y y se muestra el mayor", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: central, productoId: ids.sprite, precio: 5500, habilitado: true } });
    const [item] = (await cargarAdminItemsAgrupados(central)).items;
    expect(item.precio).toEqual({ minimo: 5000, maximo: 5500 });
    expect(item.avisos.preciosDistintos).toEqual({ minimo: 5000, maximo: 5500, mostrado: 5500 });
    expect(item.opciones.find((o) => o.productoId === ids.sprite)!.precioAca).toBe(5500);
    expect((await cargarAdminItemsAgrupados(central)).diagnostico.agrupadosConPreciosDistintos).toEqual([{ id: agId, nombre: "Gaseosa 500 CC", minimo: 5000, maximo: 5500 }]);
    // En la otra sucursal (sin ese precio local) no hay aviso.
    expect((await cargarAdminItemsAgrupados(otra)).items[0].avisos.preciosDistintos).toBeNull();
  });

  it("aviso D4: una opción cuya categoría cae en otra sección de carta", async () => {
    await prisma.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: agId, productoId: ids.agua, orden: 2 } });
    const [item] = (await cargarAdminItemsAgrupados(central)).items;
    expect(item.avisos.opcionesEnOtraSeccion).toBe(true);
    expect(item.opciones.find((o) => o.productoId === ids.agua)).toMatchObject({ categoria: "Aguas", seccionCarta: "Otras bebidas", otraSeccion: true });
  });

  it("aviso: sin opciones disponibles acá (y en el diagnóstico de la carta); sin sección de carta", async () => {
    await prisma.disponibilidadProducto.updateMany({ where: { sucursalId: central, productoId: { in: [ids.coca, ids.sprite] } }, data: { disponible: false } });
    const datos = await cargarAdminItemsAgrupados(central);
    expect(datos.items[0]).toMatchObject({ disponiblesAca: 0, precio: null, avisos: { sinOpcionesAca: true, preciosDistintos: null } });
    expect(datos.items[0].opciones.map((o) => o.disponibleAca)).toEqual([false, false]);
    expect(datos.diagnostico.agrupadosSinOpciones).toEqual([{ id: agId, nombre: "Gaseosa 500 CC" }]);

    await prisma.categoriaSeccionCarta.deleteMany({ where: { categoriaId: cGas } });
    const sinSeccion = await cargarAdminItemsAgrupados(otra);
    expect(sinSeccion.items[0]).toMatchObject({ seccionCarta: null, avisos: { sinSeccion: true } });
    expect(sinSeccion.diagnostico.agrupadosSinSeccion).toEqual([{ id: agId, nombre: "Gaseosa 500 CC", categoria: "Gaseosa 500 CC" }]);
  });

  it("orden: activos primero, después orden y nombre", async () => {
    await prisma.itemAgrupadoCarta.create({ data: { nombre: "Apagado", categoriaId: cGas, activo: false } });
    await prisma.itemAgrupadoCarta.create({ data: { nombre: "Agua 1,5L", categoriaId: cGas, orden: 0 } });
    await prisma.itemAgrupadoCarta.create({ data: { nombre: "Primero", categoriaId: cGas, orden: -1 } });
    expect((await cargarAdminItemsAgrupados(central)).items.map((i) => i.nombre)).toEqual(["Primero", "Agua 1,5L", "Gaseosa 500 CC", "Apagado"]);
  });
});
