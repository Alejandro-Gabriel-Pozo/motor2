import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { resolverMenuCarta, resolverMenuCartaConDiagnostico } from "../../src/core/carta/menu-consulta";
import type { CartaV1 } from "../../src/core/carta/armar-menu";

/**
 * Ítems agrupados en `resolverMenuCarta`, contra Postgres real (docs/plan-agrupacion-items-carta-2026-09-24.md, M3): qué
 * opciones entran (disponibles en la sucursal, solo PV), que un producto agrupado nunca sale suelto (D3) y el precio por
 * sucursal. Desde docs/plan-carta-seccion-directa-2026-09-25.md el ítem agrupado y cada PV suelto eligen su sección directo.
 */
describe("resolverMenuCarta — ítems agrupados", () => {
  const AHORA = new Date("2026-09-24T10:00:00.000Z");
  let central: string;
  let otra: string;
  let bebidasId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const u = await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
    central = (await prisma.sucursal.create({ data: { nombre: "Central" } })).id;
    otra = (await prisma.sucursal.create({ data: { nombre: "Otra" } })).id;

    const cGas = (await prisma.categoriaProducto.create({ data: { nombre: "Gaseosa 500 CC" } })).id;
    const cBife = (await prisma.categoriaProducto.create({ data: { nombre: "Bife" } })).id;
    const bebidas = await prisma.seccionCarta.create({ data: { nombre: "Bebidas sin alcohol", orden: 1 } });
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos Principales", orden: 2 } });
    bebidasId = bebidas.id;

    let n = 0;
    const pv = async (nombre: string, categoriaId: string, precioVenta: number, sucursales: string[], tipo: "PV" | "MP" = "PV") => {
      const p = await prisma.producto.create({ data: { codigo: `AGR_${++n}`, nombre, tipo, categoriaId, precioVenta, unidadStockId: u.id } });
      if (sucursales.length) await prisma.disponibilidadProducto.createMany({ data: sucursales.map((sucursalId) => ({ sucursalId, productoId: p.id, disponible: true })) });
      return p.id;
    };
    ids = {
      bife: (await sembrarProductoDisponible({ codigo: "AGR_BIFE", nombre: "Bife de chorizo", tipo: "PV", categoriaId: cBife, precioVenta: 34000, unidadStockId: u.id }, central)).id,
      coca: await pv("Coca-Cola 500cc", cGas, 5000, [central, otra]),
      sprite: await pv("Sprite 500cc", cGas, 5000, [central, otra]),
      fanta: await pv("Fanta 500cc", cGas, 5000, [central]),
      pepsi: await pv("Pepsi 500cc", cGas, 5000, [otra]),
      mpGas: await pv("Jarabe de gaseosa", cGas, 1, [central], "MP"),
    };
    // El fixture "de hoy": el bife y Sprite (con contenido previo propio) salen sueltos.
    await prisma.contenidoCartaProducto.createMany({
      data: [
        { productoId: ids.bife, visibleEnCarta: true, seccionCartaId: platos.id },
        { productoId: ids.sprite, visibleEnCarta: true, seccionCartaId: bebidas.id, descripcion: "Lima-limón", tags: ["Sin azúcar"], orden: 3 },
      ],
    });
  });

  /** El ítem agrupado «Gaseosa 500 CC» con las opciones dadas (en ese orden). */
  async function crearGaseosa(opciones: string[], extra: { activo?: boolean } = {}) {
    const ag = await prisma.itemAgrupadoCarta.create({
      data: { nombre: "Gaseosa 500 CC", seccionCartaId: bebidasId, descripcion: "Bien fría", tags: ["Sin alcohol"], especial: true, ...extra },
    });
    await prisma.opcionItemAgrupadoCarta.createMany({ data: opciones.map((productoId, orden) => ({ itemAgrupadoCartaId: ag.id, productoId, orden })) });
    return ag.id;
  }

  const todos = (carta: CartaV1 | null) => carta!.secciones.flatMap((s) => s.items);

  it("1. regresión: un ítem agrupado sin opciones, o con opciones de otra sucursal, no cambia la carta", async () => {
    const antes = await resolverMenuCarta(central, undefined, AHORA);
    expect(todos(antes).map((i) => i.nombre).sort()).toEqual(["Bife de chorizo", "Sprite 500cc"]);

    await prisma.itemAgrupadoCarta.create({ data: { nombre: "Vacío", seccionCartaId: bebidasId } });
    await crearGaseosa([ids.pepsi]);
    const despues = await resolverMenuCarta(central, undefined, AHORA);
    expect(despues).toEqual(antes);
    expect(JSON.stringify(despues)).toBe(JSON.stringify(antes));
  });

  it("2. las opciones salen solo si están disponibles en la sucursal (y solo PV): cada sucursal ve las suyas", async () => {
    const agId = await crearGaseosa([ids.coca, ids.sprite, ids.fanta, ids.pepsi]);
    // Un MP asignado a mano (la acción lo rechaza; la consulta igual lo filtra).
    await prisma.opcionItemAgrupadoCarta.create({ data: { itemAgrupadoCartaId: agId, productoId: ids.mpGas, orden: 9 } });

    const enCentral = todos(await resolverMenuCarta(central)).find((i) => i.productoId === agId)!;
    expect(enCentral.opciones!.map((o) => o.nombre)).toEqual(["Coca-Cola 500cc", "Sprite 500cc", "Fanta 500cc"]);
    const enOtra = todos(await resolverMenuCarta(otra)).find((i) => i.productoId === agId)!;
    expect(enOtra.opciones!.map((o) => o.nombre)).toEqual(["Coca-Cola 500cc", "Sprite 500cc", "Pepsi 500cc"]);

    // Apagar la disponibilidad de una opción acá la saca del grupo acá.
    await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: central, productoId: ids.coca } }, data: { disponible: false } });
    expect(todos(await resolverMenuCarta(central)).find((i) => i.productoId === agId)!.opciones!.map((o) => o.nombre)).toEqual(["Sprite 500cc", "Fanta 500cc"]);
  });

  it("3. una opción con ContenidoCartaProducto visible sale SOLO dentro del grupo", async () => {
    const agId = await crearGaseosa([ids.coca, ids.sprite, ids.fanta]);
    const items = todos(await resolverMenuCarta(central));
    expect(items.map((i) => i.nombre)).toEqual(["Gaseosa 500 CC", "Bife de chorizo"]);
    expect(items.filter((i) => i.productoId === ids.sprite)).toEqual([]);
    expect(items.find((i) => i.productoId === agId)).toEqual({
      productoId: agId,
      nombre: "Gaseosa 500 CC",
      // Un ítem agrupado no tiene categoría: lleva el nombre de su sección.
      categoria: "Bebidas sin alcohol",
      descripcion: "Bien fría",
      precio: 5000,
      tags: ["Sin alcohol"],
      especial: true,
      imagenUrl: null,
      opciones: [
        { productoId: ids.coca, nombre: "Coca-Cola 500cc", precio: 5000 },
        { productoId: ids.sprite, nombre: "Sprite 500cc", precio: 5000 },
        { productoId: ids.fanta, nombre: "Fanta 500cc", precio: 5000 },
      ],
    });
    // El bife (sin agrupar) sigue sin la clave `opciones`.
    expect(items.find((i) => i.productoId === ids.bife)).not.toHaveProperty("opciones");
  });

  it("4. grupo apagado: no sale, y sus miembros tampoco salen sueltos", async () => {
    await crearGaseosa([ids.coca, ids.sprite, ids.fanta], { activo: false });
    const items = todos(await resolverMenuCarta(central));
    expect(items.map((i) => i.nombre)).toEqual(["Bife de chorizo"]);
  });

  it("5. reversibilidad: borrar la fila de opción hace que el PV vuelva a salir suelto con su contenido previo", async () => {
    await crearGaseosa([ids.coca, ids.sprite, ids.fanta]);
    await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { productoId: ids.sprite } });
    const items = todos(await resolverMenuCarta(central));
    expect(items.find((i) => i.productoId === ids.sprite)).toEqual({
      productoId: ids.sprite,
      nombre: "Sprite 500cc",
      categoria: "Gaseosa 500 CC",
      descripcion: "Lima-limón",
      precio: 5000,
      tags: ["Sin azúcar"],
      especial: false,
      imagenUrl: null,
    });
    expect(items.find((i) => i.nombre === "Gaseosa 500 CC")!.opciones!.map((o) => o.nombre)).toEqual(["Coca-Cola 500cc", "Fanta 500cc"]);
  });

  it("6. precio local por sucursal: Central $5000; Otra, con un local de $5500 en una opción, $5500 (el mayor)", async () => {
    const agId = await crearGaseosa([ids.coca, ids.sprite, ids.fanta, ids.pepsi]);
    await prisma.precioLocalProducto.create({ data: { sucursalId: otra, productoId: ids.coca, precio: 5500, habilitado: true } });

    const enCentral = await resolverMenuCartaConDiagnostico(central);
    expect(todos(enCentral!.carta).find((i) => i.productoId === agId)!.precio).toBe(5000);
    expect(enCentral!.diagnostico.agrupadosConPreciosDistintos).toEqual([]);

    const enOtra = await resolverMenuCartaConDiagnostico(otra);
    const item = todos(enOtra!.carta).find((i) => i.productoId === agId)!;
    expect(item.precio).toBe(5500);
    expect(item.opciones!.find((o) => o.productoId === ids.coca)!.precio).toBe(5500);
    expect(enOtra!.diagnostico.agrupadosConPreciosDistintos).toEqual([{ id: agId, nombre: "Gaseosa 500 CC", minimo: 5000, maximo: 5500 }]);
  });

  it("7. no escribe: las 7 tablas de carta, producto y disponibilidadProducto quedan igual", async () => {
    await crearGaseosa([ids.coca, ids.sprite, ids.fanta]);
    const contar = () =>
      Promise.all([
        prisma.seccionCarta.count(),
        prisma.contenidoCartaProducto.count(),
        prisma.promoCarta.count(),
        prisma.sucursalPublica.count(),
        prisma.temaCartaSucursal.count(),
        prisma.itemAgrupadoCarta.count(),
        prisma.opcionItemAgrupadoCarta.count(),
        prisma.producto.count(),
        prisma.disponibilidadProducto.count(),
      ]);
    const antes = await contar();
    await resolverMenuCarta(central);
    await resolverMenuCarta(otra);
    expect(await contar()).toEqual(antes);
  });
});
