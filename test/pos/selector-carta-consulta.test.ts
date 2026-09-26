import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { sembrarSalon } from "./salon-fixture";
import { cargarSelectorCartaPos } from "../../src/core/pos/selector-carta-consulta";
import { resolverPrecioVenta } from "../../src/core/movimientos/precio-venta";
import { pediblesDeEntrada, type SelectorCartaPos } from "../../src/core/pos/selector-carta";

/**
 * Lectura del selector por sección de carta del POS contra Postgres real (docs/plan-selector-carta-pos-2026-09-25.md, paso 2): la
 * estructura sale de la carta pública de la sucursal y todo PV pedible que la carta no muestra cae en «Fuera de carta». El precio
 * de cada producto es el mismo que congela `agregarItems` (paridad con `resolverPrecioVenta`).
 */
describe("cargarSelectorCartaPos", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let ids: Record<string, string>;
  let norte: string;
  let agrupadoGaseosa: string;
  let agrupadoJugos: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;

    let n = 0;
    const pv = (nombre: string, precioVenta: number, sucursalId: string | null = s.sucursalId) => {
      const data = { codigo: `PV_SEL_${++n}`, nombre, tipo: "PV" as const, unidadStockId: s.unidad.id, precioVenta };
      return (sucursalId ? sembrarProductoDisponible(data, sucursalId) : prisma.producto.create({ data })).then((p) => p.id);
    };
    ids = {
      coca: await pv("Coca-Cola 500cc", 5000),
      sprite: await pv("Sprite 500cc", 5000),
      fanta: await pv("Fanta 500cc", 5000, null),
      jugo: await pv("Jugo de naranja", 4000),
      fernet: await pv("Fernet con cola", 8000),
      soloNorte: await pv("Solo en Norte", 100, norte),
    };
    // La Fanta está en Norte pero NO en Central; la Milanesa está apagada en Norte (no importa para Central).
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: ids.fanta, disponible: true } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: s.milanesa.id, disponible: false } });

    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
    const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 2 } });
    const barra = await prisma.seccionCarta.create({ data: { nombre: "Barra", orden: 0, activa: false } });
    await prisma.contenidoCartaProducto.createMany({
      data: [
        { productoId: s.pizza.id, visibleEnCarta: true, seccionCartaId: platos.id, orden: 2 },
        { productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id, orden: 1 },
        // No visible: aunque tenga sección, va a «Fuera de carta».
        { productoId: s.flan.id, visibleEnCarta: false, seccionCartaId: platos.id },
        // Sección apagada: «Fuera de carta».
        { productoId: ids.fernet, visibleEnCarta: true, seccionCartaId: barra.id },
        // La MP nunca es pedible, aunque tenga contenido visible.
        { productoId: s.muzzarella.id, visibleEnCarta: true, seccionCartaId: platos.id },
      ],
    });
    agrupadoGaseosa = (await prisma.itemAgrupadoCarta.create({ data: { nombre: "Gaseosa 500cc", seccionCartaId: bebidas.id } })).id;
    await prisma.opcionItemAgrupadoCarta.createMany({
      data: [
        { itemAgrupadoCartaId: agrupadoGaseosa, productoId: ids.sprite, orden: 2 },
        { itemAgrupadoCartaId: agrupadoGaseosa, productoId: ids.coca, orden: 1 },
        { itemAgrupadoCartaId: agrupadoGaseosa, productoId: ids.fanta, orden: 3 },
      ],
    });
    // Un agrupado APAGADO: su opción no sale en la carta, así que va suelta a «Fuera de carta».
    agrupadoJugos = (await prisma.itemAgrupadoCarta.create({ data: { nombre: "Jugos", seccionCartaId: bebidas.id, activo: false } })).id;
    await prisma.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: agrupadoJugos, productoId: ids.jugo } });

    // Precio Local: habilitado en la Milanesa y en la Sprite; deshabilitado en la Pizza (se cobra el global).
    await prisma.precioLocalProducto.createMany({
      data: [
        { sucursalId: s.sucursalId, productoId: s.milanesa.id, precio: 9500, habilitado: true },
        { sucursalId: s.sucursalId, productoId: ids.sprite, precio: 5200, habilitado: true },
        { sucursalId: s.sucursalId, productoId: s.pizza.id, precio: 20000, habilitado: false },
        // Un precio local de OTRA sucursal no cuenta acá.
        { sucursalId: norte, productoId: s.flan.id, precio: 1, habilitado: true },
      ],
    });
  });

  const nombresFuera = (sel: SelectorCartaPos) => sel.fueraDeCarta.map((p) => p.nombre);

  it("las secciones de carta activas, en su orden, con los sueltos en el suyo y el agrupado con sus opciones disponibles", async () => {
    const sel = await cargarSelectorCartaPos(s.sucursalId);
    expect(sel.seccionesCarta).toEqual([
      {
        seccionCartaId: expect.any(String),
        nombre: "Platos",
        entradas: [
          { tipo: "producto", producto: { productoId: s.milanesa.id, codigo: "PV_MILA", nombre: "Milanesa", precio: 9500 } },
          { tipo: "producto", producto: { productoId: s.pizza.id, codigo: "PV_PIZZA", nombre: "Pizza", precio: 12000 } },
        ],
      },
      {
        seccionCartaId: expect.any(String),
        nombre: "Bebidas",
        entradas: [
          {
            tipo: "agrupado",
            itemAgrupadoCartaId: agrupadoGaseosa,
            nombre: "Gaseosa 500cc",
            precioMinimo: 5000,
            precioMaximo: 5200,
            // Tres opciones, una no disponible en Central (Fanta) → dos, en su orden y con SU precio.
            opciones: [
              { productoId: ids.coca, codigo: "PV_SEL_1", nombre: "Coca-Cola 500cc", precio: 5000 },
              { productoId: ids.sprite, codigo: "PV_SEL_2", nombre: "Sprite 500cc", precio: 5200 },
            ],
          },
        ],
      },
    ]);
  });

  it("«Fuera de carta»: no visible, sección apagada y agrupado apagado; nunca una MP ni un PV no disponible acá", async () => {
    const sel = await cargarSelectorCartaPos(s.sucursalId);
    expect(nombresFuera(sel)).toEqual(["Fernet con cola", "Flan", "Jugo de naranja"]);
    const todos = [...sel.seccionesCarta.flatMap((sc) => sc.entradas.flatMap(pediblesDeEntrada).map((p) => p.productoId)), ...sel.fueraDeCarta.map((p) => p.productoId)];
    for (const noPedible of [s.muzzarella.id, ids.fanta, ids.soloNorte]) expect(todos).not.toContain(noPedible);
    for (const idAgrupado of [agrupadoGaseosa, agrupadoJugos]) expect(todos).not.toContain(idAgrupado);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("la disponibilidad y los precios de OTRA sucursal no se mezclan", async () => {
    const central = await cargarSelectorCartaPos(s.sucursalId);
    // La Milanesa está apagada en Norte pero en Central se pide; el precio local de Norte del Flan no cuenta en Central.
    expect(central.seccionesCarta[0].entradas[0]).toMatchObject({ producto: { productoId: s.milanesa.id } });
    expect(central.fueraDeCarta.find((p) => p.productoId === s.flan.id)?.precio).toBe(3000);

    const enNorte = await cargarSelectorCartaPos(norte);
    const idsNorte = [...enNorte.seccionesCarta.flatMap((sc) => sc.entradas.flatMap(pediblesDeEntrada).map((p) => p.productoId)), ...enNorte.fueraDeCarta.map((p) => p.productoId)];
    expect(idsNorte.sort()).toEqual([ids.fanta, ids.soloNorte].sort());
    // En Norte la Fanta es la única opción disponible del agrupado.
    expect(enNorte.seccionesCarta).toEqual([
      { seccionCartaId: expect.any(String), nombre: "Bebidas", entradas: [expect.objectContaining({ tipo: "agrupado", itemAgrupadoCartaId: agrupadoGaseosa, opciones: [expect.objectContaining({ productoId: ids.fanta })] })] },
    ]);
  });

  it("una sucursal inactiva no tiene carta: todo lo pedible va a «Fuera de carta»", async () => {
    await prisma.sucursal.update({ where: { id: s.sucursalId }, data: { activo: false } });
    const sel = await cargarSelectorCartaPos(s.sucursalId);
    expect(sel.seccionesCarta).toEqual([]);
    expect(nombresFuera(sel)).toEqual(["Coca-Cola 500cc", "Fernet con cola", "Flan", "Jugo de naranja", "Milanesa", "Pizza", "Sprite 500cc"]);
  });

  it("paridad: el precio de cada pedible es el que congela agregarItems (resolverPrecioVenta)", async () => {
    const sel = await cargarSelectorCartaPos(s.sucursalId);
    const pedibles = [...sel.seccionesCarta.flatMap((sc) => sc.entradas.flatMap(pediblesDeEntrada)), ...sel.fueraDeCarta];
    expect(pedibles).toHaveLength(7);
    for (const p of pedibles) {
      const producto = await prisma.producto.findUniqueOrThrow({ where: { id: p.productoId } });
      expect(p.precio, p.nombre).toBe(await resolverPrecioVenta(s.sucursalId, p.productoId, Number(producto.precioVenta)));
    }
  });
});
