import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { cargarAdminCarta, cargarAdminItemsAgrupados } from "../../src/core/carta/admin-consulta";

/**
 * Lectura del admin de los ítems agrupados (docs/plan-agrupacion-items-carta-2026-09-24.md, M6), contra Postgres real:
 * `/carta` ya no avisa como "sin contenido" a un PV agrupado (sale a través del grupo), y `/carta/agrupados`
 * recibe el aviso D5 (precios distintos acá: rango y el precio que se termina mostrando, el mayor), más "sin opciones disponibles
 * acá" y "sección apagada". Desde docs/plan-carta-seccion-directa-2026-09-25.md el ítem elige su sección directo: ya no existe el
 * aviso D4 (opción de otra categoría en otra sección).
 */
describe("admin de ítems agrupados", () => {
  let central: string;
  let otra: string;
  let bebidasId: string;
  let ids: Record<string, string>;
  let agId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;
    const cGas = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } })).id;
    const cAgua = (await prisma.categoriaProducto.create({ data: { nombre: "Aguas" } })).id;
    bebidasId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol", orden: 1 } })).id;
    await prisma.seccionCarta.create({ data: { nombre: "Otras bebidas", orden: 2 } });
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
    agId = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Gaseosa 500 CC", seccionCartaId: bebidasId, especial: true } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [
        { sucursalId: central, itemAgrupadoCartaId: agId, productoId: ids.coca, orden: 0 },
        { sucursalId: central, itemAgrupadoCartaId: agId, productoId: ids.sprite, orden: 1 },
      ],
    });
  });

  /** La carta es propia de cada sucursal (ADR-009, C3): «Otra» arma su propio «Gaseosa 500 CC» con las mismas opciones. */
  async function crearGaseosaEnOtra() {
    const id = (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: otra, nombre: "Gaseosa 500 CC", seccionCartaId: bebidasId, especial: true } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [ids.coca, ids.sprite].map((productoId, orden) => ({ sucursalId: otra, itemAgrupadoCartaId: id, productoId, orden })),
    });
    return id;
  }

  it("/carta: un PV agrupado sin contenido NO está en sinContenido y tiene agrupadoEn", async () => {
    const datos = await cargarAdminCarta(central, prisma);
    const coca = datos.productos.find((p) => p.id === ids.coca)!;
    expect(coca.agrupadoEn).toBe("Gaseosa 500 CC");
    expect(coca.contenido).toBeNull();
    expect(datos.sinContenido.map((p) => p.nombre)).toEqual(["Agua saborizada 500cc", "Tónica 500cc"]);
    expect(datos.productos.find((p) => p.id === ids.suelta)!.agrupadoEn).toBeNull();
  });

  it("sin avisos cuando las opciones cuestan lo mismo y su sección está activa", async () => {
    const datos = await cargarAdminItemsAgrupados(central, prisma);
    expect(datos.items).toHaveLength(1);
    const [item] = datos.items;
    expect(item).toMatchObject({
      nombre: "Gaseosa 500 CC",
      seccionCartaId: bebidasId,
      seccionCarta: "Bebidas sin alcohol",
      especial: true,
      activo: true,
      disponiblesAca: 2,
      precio: { minimo: 5000, maximo: 5000 },
      avisos: { preciosDistintos: null, sinOpcionesAca: false, sinSeccion: false },
    });
    expect(item.opciones.map((o) => [o.nombre, o.disponibleAca, o.precioAca])).toEqual([
      ["Coca-Cola 500cc", true, 5000],
      ["Sprite 500cc", true, 5000],
    ]);
    // El select "Agregar producto": PV disponibles acá que no están en ningún grupo, con su precio acá.
    expect(datos.productosSinGrupo).toEqual([
      { id: ids.agua, nombre: "Agua saborizada 500cc", precioAca: 5000 },
      { id: ids.suelta, nombre: "Tónica 500cc", precioAca: 5500 },
    ]);
    // El select de sección del ítem: todas las secciones de carta (orden, nombre).
    expect(datos.secciones.map((s) => s.nombre)).toEqual(["Bebidas sin alcohol", "Otras bebidas"]);
    expect(datos.diagnostico).toEqual({ agrupadosSinSeccion: [], agrupadosSinOpciones: [], agrupadosConPreciosDistintos: [] });
  });

  it("aviso D5: precios distintos acá (un cambio posterior en Catálogo) → rango $X-$Y y se muestra el mayor", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: central, productoId: ids.sprite, precio: 5500, habilitado: true } });
    const [item] = (await cargarAdminItemsAgrupados(central, prisma)).items;
    expect(item.precio).toEqual({ minimo: 5000, maximo: 5500 });
    expect(item.avisos.preciosDistintos).toEqual({ minimo: 5000, maximo: 5500, mostrado: 5500 });
    expect(item.opciones.find((o) => o.productoId === ids.sprite)!.precioAca).toBe(5500);
    expect((await cargarAdminItemsAgrupados(central, prisma)).diagnostico.agrupadosConPreciosDistintos).toEqual([{ id: agId, nombre: "Gaseosa 500 CC", minimo: 5000, maximo: 5500 }]);
    // En la otra sucursal (con su carta propia y sin ese precio local) no hay aviso.
    await crearGaseosaEnOtra();
    expect((await cargarAdminItemsAgrupados(otra, prisma)).items[0].avisos.preciosDistintos).toBeNull();
  });

  it("sin aviso D4: una opción de otra categoría no genera ningún aviso (sale en la sección del ítem)", async () => {
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: central, itemAgrupadoCartaId: agId, productoId: ids.agua, orden: 2 } });
    const [item] = (await cargarAdminItemsAgrupados(central, prisma)).items;
    expect(item.avisos).toEqual({ preciosDistintos: null, sinOpcionesAca: false, sinSeccion: false });
    expect(item.opciones.find((o) => o.productoId === ids.agua)).toEqual({ id: expect.any(String), productoId: ids.agua, nombre: "Agua saborizada 500cc", orden: 2, disponibleAca: true, precioAca: 5000 });
  });

  it("aviso: sin opciones disponibles acá (y en el diagnóstico de la carta); sección de carta apagada", async () => {
    await prisma.disponibilidadProducto.updateMany({ where: { sucursalId: central, productoId: { in: [ids.coca, ids.sprite] } }, data: { disponible: false } });
    const datos = await cargarAdminItemsAgrupados(central, prisma);
    expect(datos.items[0]).toMatchObject({ disponiblesAca: 0, precio: null, avisos: { sinOpcionesAca: true, preciosDistintos: null } });
    expect(datos.items[0].opciones.map((o) => o.disponibleAca)).toEqual([false, false]);
    expect(datos.diagnostico.agrupadosSinOpciones).toEqual([{ id: agId, nombre: "Gaseosa 500 CC" }]);

    await prisma.seccionCarta.update({ where: { id: bebidasId }, data: { activa: false } });
    const agIdOtra = await crearGaseosaEnOtra();
    const sinSeccion = await cargarAdminItemsAgrupados(otra, prisma);
    expect(sinSeccion.items[0]).toMatchObject({ seccionCartaId: bebidasId, seccionCarta: null, avisos: { sinSeccion: true } });
    expect(sinSeccion.diagnostico.agrupadosSinSeccion).toEqual([{ id: agIdOtra, nombre: "Gaseosa 500 CC" }]);
  });

  it("cantidadItems por sección (base del orden sugerido, DA6): sueltos visibles sin agrupar + agrupados prendidos", async () => {
    const otras = await prisma.seccionCarta.findFirstOrThrow({ where: { nombre: "Otras bebidas" } });
    await prisma.contenidoCartaProducto.createMany({
      data: [
        { sucursalId: central, productoId: ids.agua, visibleEnCarta: true, seccionCartaId: bebidasId },
        // Oculto: no cuenta.
        { sucursalId: central, productoId: ids.suelta, visibleEnCarta: false, seccionCartaId: bebidasId },
        // Agrupado (sale dentro de «Gaseosa 500 CC», D3): no cuenta como suelto.
        { sucursalId: central, productoId: ids.coca, visibleEnCarta: true, seccionCartaId: otras.id },
      ],
    });
    // Un agrupado apagado no cuenta.
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Apagado", seccionCartaId: bebidasId, activo: false } });
    const cantidades = (secciones: { nombre: string; cantidadItems: number }[]) => Object.fromEntries(secciones.map((s) => [s.nombre, s.cantidadItems]));
    // Bebidas: el agua (suelta visible) + «Gaseosa 500 CC» (agrupado prendido).
    expect(cantidades((await cargarAdminItemsAgrupados(central, prisma)).secciones)).toEqual({ "Bebidas sin alcohol": 2, "Otras bebidas": 0 });
    expect(cantidades((await cargarAdminCarta(central, prisma)).secciones)).toEqual({ "Bebidas sin alcohol": 2, "Otras bebidas": 0 });
  });

  it("orden: activos primero, después orden y nombre", async () => {
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Apagado", seccionCartaId: bebidasId, activo: false } });
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Agua 1,5L", seccionCartaId: bebidasId, orden: 0 } });
    await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Primero", seccionCartaId: bebidasId, orden: -1 } });
    expect((await cargarAdminItemsAgrupados(central, prisma)).items.map((i) => i.nombre)).toEqual(["Primero", "Agua 1,5L", "Gaseosa 500 CC", "Apagado"]);
  });
});
