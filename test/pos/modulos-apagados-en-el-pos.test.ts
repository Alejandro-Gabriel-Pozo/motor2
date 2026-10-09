import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { pediblesDeEntrada } from "../../src/core/pos/selector-carta";
import { cargarSelectorCartaDeLaMesa } from "../../src/server/consultas/pos/selector-carta";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import { agregarItems, enviarACocina, quitarPromoSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { anularPromoEnviada } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import type { Db } from "../../src/lib/db-tipos";

/**
 * S-22 (D2 del dueño, plan de endurecimiento de seguridad, tanda T10): LO CONTRATADO MANDA EN EL POS. Decisión textual: «el POS pertenece al módulo SALÓN.
 * Con Salón apagado no se puede vender, no se puede cerrar una cuenta, no se puede abrir una mesa, etcétera. Si Promociones está apagado, no se pueden
 * generar/agregar promociones para el POS. Si Carta está apagado, el POS puede funcionar solo con los ítems sueltos, sin carta».
 *
 * El ataque de la parte de PROMOCIONES: una empresa que NO contrató el módulo (o a la que la consola se lo apagó) seguía vendiendo promos por el POS. El
 * selector las ofrecía (`PromoCarta` ofrecida en la sucursal, sin mirar el registro de módulos) y `agregarItems` las aceptaba —una Server Action se puede
 * llamar a mano con un `promoCartaId` cualquiera—, porque el gate de `pos_tomar_pedido` solo mira que SALÓN esté prendido. Las promos que la cuenta YA tenía
 * se respetan: se pueden enviar a cocina, anular y cobrar (no se le rompe una mesa abierta a nadie por apagar un módulo).
 *
 * Registros usados (la clausura del catálogo manda): `["salon", "carta"]` = Promociones apagado y Carta prendida; con `["salon", "carta", "promociones"]` todo.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const SIN_PROMOCIONES = ["salon", "carta"];
const CON_PROMOCIONES = ["salon", "carta", "promociones"];

let s: Awaited<ReturnType<typeof sembrarSalon>>;
let cuentaId: string;
let promoCartaId: string;
let menuDelDia: { promoCartaId: string; elecciones: { seccionCartaId: string; elegidos: { productoId: string; cantidad: number }[] }[] }[];

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
  const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: postres.id } });
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: platos.id, titulo: "Menú del día", precio: 10000 } });
  await prisma.promoCartaCupo.createMany({
    data: [
      { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
      { promoCartaId: promo.id, seccionCartaId: postres.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
    ],
  });
  promoCartaId = promo.id;
  menuDelDia = [
    {
      promoCartaId: promo.id,
      elecciones: [
        { seccionCartaId: platos.id, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] },
        { seccionCartaId: postres.id, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] },
      ],
    },
  ];
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

/** Corre una lectura con un cliente que anota cada consulta (`modelo.operación`), para ver qué tablas toca. */
async function conConsultas<T>(f: (db: Db) => Promise<T>): Promise<{ resultado: T; consultas: string[] }> {
  const consultas: string[] = [];
  const db = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        consultas.push(model ? `${model.charAt(0).toLowerCase()}${model.slice(1)}.${operation}` : operation);
        return query(args);
      },
    },
  }) as unknown as Db;
  return { resultado: await f(db), consultas };
}

/** Todo lo que una promo agregada escribe: la promo de la cuenta y sus componentes. */
async function filasDelPedido() {
  return { promoCuenta: await prisma.promoCuenta.count(), cuentaItem: await prisma.cuentaItem.count() };
}

/** Las entradas de tipo promo que ofrece el selector (en cualquier sección). */
function promosOfrecidas(selector: Awaited<ReturnType<typeof cargarSelectorCartaDeLaMesa>>) {
  return selector.seccionesCarta.flatMap((sec) => sec.entradas.filter((e) => e.tipo === "promo"));
}

describe("S-22 · Promociones apagado: el POS no ofrece ni acepta promos", () => {
  it("agregarItems con una promo la RECHAZA con un mensaje claro y no escribe nada (el ataque: llamar a mano la Server Action)", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    const antes = await filasDelPedido();
    const r = await agregarItems(cuentaId, [], menuDelDia);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/Promociones/);
    expect(await filasDelPedido()).toEqual(antes);
  });

  it("también la rechaza si viene junto con ítems sueltos válidos: todo o nada, nada se escribe", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    const antes = await filasDelPedido();
    const r = await agregarItems(cuentaId, [{ productoId: s.pizza.id, cantidad: 1 }], menuDelDia);
    expect(r.ok).toBe(false);
    expect(await filasDelPedido()).toEqual(antes);
  });

  it("el selector de la mesa no ofrece ninguna promo, y sigue ofreciendo las secciones de la carta (Carta está prendida)", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    const selector = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    expect(promosOfrecidas(selector)).toEqual([]);
    expect(selector.seccionesCarta.map((x) => x.nombre).sort()).toEqual(["Platos", "Postres"]);
  });

  it("la lectura que valida cada promo (la fuente única de agregarItems) tampoco la devuelve", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    expect(await cargarPromoCartaParaAgregar(s.sucursalId, promoCartaId, prisma, AHORA_DE_LA_CORRIDA)).toBeNull();
  });

  it("los ítems sueltos siguen entrando (se apaga la promo, no el POS)", async () => {
    await fijarModulosActivos(E, SIN_PROMOCIONES);
    const antes = await filasDelPedido();
    const r = await agregarItems(cuentaId, [{ productoId: s.pizza.id, cantidad: 2 }]);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await filasDelPedido()).toEqual({ promoCuenta: antes.promoCuenta, cuentaItem: antes.cuentaItem + 1 });
  });

  it("CONTROL: con Promociones prendido el selector la ofrece y agregarItems la acepta", async () => {
    await fijarModulosActivos(E, CON_PROMOCIONES);
    const selector = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    expect(promosOfrecidas(selector).map((p) => p.promoCartaId)).toEqual([promoCartaId]);
    const r = await agregarItems(cuentaId, [], menuDelDia);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await filasDelPedido()).toEqual({ promoCuenta: 1, cuentaItem: 2 });
  });

  describe("lo que la cuenta YA tenía se respeta cuando se apaga el módulo", () => {
    async function cuentaConPromoAgregadaCon(modulos: string[]) {
      await fijarModulosActivos(E, modulos);
      const a = await agregarItems(cuentaId, [], menuDelDia);
      expect(a.ok, a.mensaje).toBe(true);
      return prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId }, include: { items: true } });
    }

    it("se puede quitar una promo que todavía no salió", async () => {
      const promo = await cuentaConPromoAgregadaCon(CON_PROMOCIONES);
      await fijarModulosActivos(E, SIN_PROMOCIONES);
      const r = await quitarPromoSinEnviar(promo.id);
      expect(r.ok, r.mensaje).toBe(true);
      expect(await filasDelPedido()).toEqual({ promoCuenta: 0, cuentaItem: 0 });
    });

    it("se puede enviar a cocina y anular una promo enviada", async () => {
      const promo = await cuentaConPromoAgregadaCon(CON_PROMOCIONES);
      await fijarModulosActivos(E, SIN_PROMOCIONES);
      const envio = await enviarACocina(cuentaId, promo.items.map((i) => i.id));
      expect(envio.ok, envio.mensaje).toBe(true);
      const anulada = await anularPromoEnviada(promo.id, "Se cayó el pedido");
      expect(anulada.ok, anulada.mensaje).toBe(true);
    });

    it("se puede cerrar la cuenta que tiene la promo (se cobra al precio de la promo)", async () => {
      const promo = await cuentaConPromoAgregadaCon(CON_PROMOCIONES);
      await fijarModulosActivos(E, SIN_PROMOCIONES);
      const envio = await enviarACocina(cuentaId, promo.items.map((i) => i.id));
      expect(envio.ok, envio.mensaje).toBe(true);
      const cierre = await cerrarCuenta(cuentaId);
      expect(cierre.ok, cierre.mensaje).toBe(true);
    });
  });

  it("el selector que ofrece promos no repite pedibles: las promos no son productos (control del invariante con el módulo prendido)", async () => {
    await fijarModulosActivos(E, CON_PROMOCIONES);
    const selector = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const ids = [...selector.seccionesCarta.flatMap((x) => x.entradas.flatMap(pediblesDeEntrada)), ...selector.fueraDeCarta].map((p) => p.productoId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("S-22 · Carta apagada: el POS vende solo con los ítems sueltos, sin carta", () => {
  /** Los tres PV disponibles de Central, por nombre (el orden del «Fuera de carta»). */
  const PV_DE_CENTRAL = ["Flan", "Milanesa", "Pizza"];

  /** Sembramos también un género y un ítem agrupado: son estructura de la carta que, sin el módulo, no puede aparecer. */
  async function sembrarGeneroYAgrupado() {
    const genero = await prisma.generoCarta.create({ data: { sucursalId: s.sucursalId, nombre: "Minutas" } });
    await prisma.contenidoCartaProducto.update({ where: { sucursalId_productoId: { sucursalId: s.sucursalId, productoId: s.milanesa.id } }, data: { generoCartaId: genero.id } });
    const seccion = await prisma.seccionCarta.findFirstOrThrow({ where: { nombre: "Postres" } });
    const agrupado = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: s.sucursalId, nombre: "Postres del día", seccionCartaId: seccion.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: s.sucursalId, itemAgrupadoCartaId: agrupado.id, productoId: s.pizza.id } });
  }

  it("el selector es la lista plana de los PV disponibles: sin secciones, sin carpetas, sin agrupados, sin promos (el ataque: mostrar la carta que no se contrató)", async () => {
    await fijarModulosActivos(E, ["salon"]);
    await sembrarGeneroYAgrupado();
    const selector = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    expect(selector.seccionesCarta).toEqual([]);
    expect(selector.fueraDeCarta.map((p) => p.nombre)).toEqual(PV_DE_CENTRAL);
  });

  it("no lee NADA de la carta: ni secciones, ni contenido, ni géneros, ni ítems agrupados, ni promos", async () => {
    await fijarModulosActivos(E, ["salon"]);
    const { consultas } = await conConsultas((db) => cargarSelectorCartaDeLaMesa(s.sucursalId, db, AHORA_DE_LA_CORRIDA));
    const deCarta = consultas.filter((c) => /^(seccionCarta|contenidoCartaProducto|generoCarta|itemAgrupadoCarta|opcionItemAgrupadoCarta|promoCarta|promoCartaCupo|promoCartaSucursal)\./.test(c));
    expect(deCarta).toEqual([]);
  });

  it("la lista plana tiene a los mismos productos, con el mismo precio, que el selector con la carta prendida (no se pierde ni se cambia nada vendible)", async () => {
    await fijarModulosActivos(E, ["salon", "carta"]);
    const conCarta = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const todos = [...conCarta.seccionesCarta.flatMap((x) => x.entradas.flatMap(pediblesDeEntrada)), ...conCarta.fueraDeCarta];
    await fijarModulosActivos(E, ["salon"]);
    const plana = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    const porId = (lista: typeof todos) => Object.fromEntries(lista.map((p) => [p.productoId, p]).sort(([a], [b]) => String(a).localeCompare(String(b))));
    expect(porId(plana.fueraDeCarta)).toEqual(porId(todos));
    expect(plana.fueraDeCarta.find((p) => p.nombre === "Milanesa")?.precio).toBe(9000);
  });

  it("el POS sigue funcionando con puros ítems sueltos: se agrega, se envía a cocina y se cierra la cuenta", async () => {
    await fijarModulosActivos(E, ["salon"]);
    const a = await agregarItems(cuentaId, [
      { productoId: s.milanesa.id, cantidad: 1 },
      { productoId: s.pizza.id, cantidad: 2 },
    ]);
    expect(a.ok, a.mensaje).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId }, select: { id: true } });
    const envio = await enviarACocina(cuentaId, items.map((i) => i.id));
    expect(envio.ok, envio.mensaje).toBe(true);
    const cierre = await cerrarCuenta(cuentaId);
    expect(cierre.ok, cierre.mensaje).toBe(true);
  });

  it("sin Carta tampoco hay promos: agregarItems las rechaza aunque la fila de la promo siga cargada y prendida", async () => {
    await fijarModulosActivos(E, ["salon"]);
    const antes = await filasDelPedido();
    const r = await agregarItems(cuentaId, [], menuDelDia);
    expect(r.ok).toBe(false);
    expect(await filasDelPedido()).toEqual(antes);
  });

  it("CLAUSURA: con Promociones prendido la Carta también lo está (el catálogo la exige), así que el selector muestra la carta", async () => {
    await fijarModulosActivos(E, ["salon", "promociones"]);
    const selector = await cargarSelectorCartaDeLaMesa(s.sucursalId, prisma, AHORA_DE_LA_CORRIDA);
    expect(selector.seccionesCarta.length).toBeGreaterThan(0);
    expect(promosOfrecidas(selector).map((p) => p.promoCartaId)).toEqual([promoCartaId]);
  });
});
