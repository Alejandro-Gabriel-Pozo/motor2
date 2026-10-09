import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { pediblesDeEntrada } from "../../src/core/pos/selector-carta";
import { cargarSelectorCartaDeLaMesa } from "../../src/server/consultas/pos/selector-carta";
import { cargarPromoCartaParaAgregar } from "../../src/server/lecturas/pos/promo-para-agregar";
import { actualizarMaxMesasAbiertas, crearMesa } from "../../src/server/actions/pos/mesas";
import { abrirCuenta, asignarClienteACuenta, corregirComensales, liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina, quitarItemSinEnviar, quitarPromoSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado, anularPromoEnviada } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta, emitirTicketCorregido } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta, registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerMiNivelPermiso, requierePermisoVer } from "../../src/server/acceso/gate";
import { ACCIONES, moduloDeAccion, type AccionClave, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import { textoDeDenegacion } from "../../src/core/permisos/motivos";
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

/**
 * La parte de D2 que YA se cumplía (todas las claves `pos_*` y `proceso_venta` son del módulo Salón y el guard rechaza por módulo): este bloque la FIJA, puerta por
 * puerta, para que ningún cambio (una clave de otro módulo, un envoltorio que se cae) la rompa sin que un test lo vea. Las 17 llamadas: las 14 mutaciones del POS
 * (`pos-rechaza-sin-permiso.test.ts`), `agregarItems` también con una promo, la venta de mostrador y su anulación; más la lectura del mapa de mesas (la pantalla del POS).
 */
describe("S-22 · Salón apagado: ninguna puerta del POS responde (se fija lo que ya se cumplía)", () => {
  const SIN_SALON = ["stock", "carta", "promociones"];
  const RECHAZO = { ok: false, mensaje: textoDeDenegacion({ motivo: "MODULO_NO_ACTIVO", modulo: "salon" }) };

  interface Escenario {
    mesaLibre: string;
    cuentaAbierta: string;
    cuentaVacia: string;
    cuentaLista: string;
    cuentaConTicket: string;
    cuentaConVenta: string;
    operacionDeVenta: string;
    itemSinEnviar: string;
    itemEnviado: string;
    promoSinEnviar: string;
    promoEnviada: string;
    clienteId: string;
  }
  let e: Escenario;

  /** Foto completa de lo que tocan las puertas del POS (salón, venta y auditoría), por id. */
  async function foto() {
    const porId = { orderBy: { id: "asc" as const } };
    return {
      sucursal: await prismaAdmin.sucursal.findMany(porId),
      mesa: await prismaAdmin.mesa.findMany(porId),
      cuenta: await prismaAdmin.cuenta.findMany(porId),
      cuentaItem: await prismaAdmin.cuentaItem.findMany(porId),
      promoCuenta: await prismaAdmin.promoCuenta.findMany(porId),
      ejemplarTicket: await prismaAdmin.ejemplarTicket.findMany(porId),
      operacion: await prismaAdmin.operacion.findMany(porId),
      movimientoStock: await prismaAdmin.movimientoStock.findMany(porId),
      registroAuditoria: await prismaAdmin.registroAuditoria.findMany(porId),
    };
  }

  /** Las 17 llamadas. `clave`: la acción que el guard evalúa. */
  const PUERTAS: { nombre: string; clave: AccionClave; llamar: (e: Escenario) => Promise<unknown> }[] = [
    { nombre: "crearMesa", clave: "pos_alta_mesa", llamar: () => crearMesa(50) },
    { nombre: "actualizarMaxMesasAbiertas", clave: "pos_limite_mesas_abiertas", llamar: () => actualizarMaxMesasAbiertas(5) },
    { nombre: "abrirCuenta", clave: "pos_abrir_cuenta", llamar: (x) => abrirCuenta(x.mesaLibre, 2) },
    { nombre: "corregirComensales", clave: "pos_abrir_cuenta", llamar: (x) => corregirComensales(x.cuentaAbierta, 3) },
    { nombre: "asignarClienteACuenta", clave: "pos_asignar_cliente", llamar: (x) => asignarClienteACuenta(x.cuentaAbierta, x.clienteId) },
    { nombre: "liberarMesa", clave: "pos_liberar_mesa", llamar: (x) => liberarMesa(x.cuentaVacia) },
    { nombre: "agregarItems", clave: "pos_tomar_pedido", llamar: (x) => agregarItems(x.cuentaAbierta, [{ productoId: s.flan.id, cantidad: 1 }]) },
    { nombre: "agregarItems con una promo", clave: "pos_tomar_pedido", llamar: (x) => agregarItems(x.cuentaAbierta, [], menuDelDia) },
    { nombre: "quitarPromoSinEnviar", clave: "pos_tomar_pedido", llamar: (x) => quitarPromoSinEnviar(x.promoSinEnviar) },
    { nombre: "quitarItemSinEnviar", clave: "pos_tomar_pedido", llamar: (x) => quitarItemSinEnviar(x.itemSinEnviar) },
    { nombre: "enviarACocina", clave: "pos_enviar_a_cocina", llamar: (x) => enviarACocina(x.cuentaAbierta, [x.itemSinEnviar]) },
    { nombre: "anularItemEnviado", clave: "pos_anular_item", llamar: (x) => anularItemEnviado(x.itemEnviado, 1, "Se cayó", 1) },
    { nombre: "anularPromoEnviada", clave: "pos_anular_item", llamar: (x) => anularPromoEnviada(x.promoEnviada, "Se cayó") },
    { nombre: "cerrarCuenta", clave: "pos_cerrar_cuenta", llamar: (x) => cerrarCuenta(x.cuentaLista) },
    { nombre: "emitirTicketCorregido", clave: "pos_emitir_ticket_corregido", llamar: (x) => emitirTicketCorregido(x.cuentaConTicket, "Se anuló el flan") },
    { nombre: "registrarVenta (venta de mostrador)", clave: "proceso_venta", llamar: () => registrarVenta({ fecha: AHORA_DE_LA_CORRIDA, seccionId: s.seccion.id, ventas: [{ productoId: s.flan.id, cantidadVendida: 1 }] }) },
    { nombre: "anularVenta", clave: "anular_venta", llamar: (x) => anularVenta(x.operacionDeVenta) },
  ];

  beforeEach(async () => {
    const sucursalId = s.sucursalId;
    const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 15 } });
    const mesaLibre = (await prisma.mesa.create({ data: { sucursalId, numero: 7 } })).id;

    // La cuenta abierta de la mesa 4 (la del escenario de arriba, vacía): una Milanesa enviada, un Flan sin enviar, una promo sin enviar y una promo ya enviada.
    const itemEnviado = await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1, creadoPorId: s.admin.id } });
    const itemSinEnviar = await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: null, creadoPorId: s.admin.id } });
    const promo = async (numeroEnvio: number | null) => {
      const p = await prisma.promoCuenta.create({ data: { cuentaId, promoCartaId, precio: 10000, titulo: "Menú del día", creadoPorId: s.admin.id } });
      await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 7500, numeroEnvio, promoCuentaId: p.id, creadoPorId: s.admin.id } });
      await prisma.cuentaItem.create({ data: { cuentaId, productoId: s.flan.id, cantidad: 1, precioUnitario: 2500, numeroEnvio, promoCuentaId: p.id, creadoPorId: s.admin.id } });
      return p.id;
    };
    const promoSinEnviar = await promo(null);
    const promoEnviada = await promo(1);

    const vacia = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 6 } })).id, s.admin.id);
    const lista = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 8 } })).id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);

    // Una cuenta cerrada con su ticket 1-A y la venta del Flan anulada después: el ticket quedó desactualizado (emitir el B escribiría).
    const conTicket = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 9 } })).id, s.admin.id, [
      { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    const cierre = await cerrarCuenta(conTicket.id);
    if (!cierre.ok) throw new Error(cierre.mensaje);
    const flanVendido = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: conTicket.id, productoId: s.flan.id } });
    const anulacion = await anularVenta(flanVendido.operacionId!);
    if (!anulacion.ok) throw new Error(anulacion.mensaje);

    // Otra cuenta cerrada, con su venta VIGENTE: es la que `anularVenta` anularía.
    const conVenta = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 10 } })).id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 1, precioUnitario: 12000, numeroEnvio: 1 }]);
    const cierreDos = await cerrarCuenta(conVenta.id);
    if (!cierreDos.ok) throw new Error(cierreDos.mensaje);
    const pizzaVendida = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: conVenta.id } });

    e = {
      mesaLibre,
      cuentaAbierta: cuentaId,
      cuentaVacia: vacia.id,
      cuentaLista: lista.id,
      cuentaConTicket: conTicket.id,
      cuentaConVenta: conVenta.id,
      operacionDeVenta: pizzaVendida.operacionId!,
      itemSinEnviar: itemSinEnviar.id,
      itemEnviado: itemEnviado.id,
      promoSinEnviar,
      promoEnviada,
      clienteId: cliente.id,
    };
  });

  it("son 17 puertas, sin repetir, y todas son del módulo Salón", () => {
    expect(PUERTAS).toHaveLength(17);
    expect(new Set(PUERTAS.map((p) => p.nombre)).size).toBe(17);
    for (const p of PUERTAS) expect(moduloDeAccion(p.clave), p.nombre).toBe("salon");
  });

  it("toda clave `pos_*` del catálogo es del módulo Salón (una nueva de otro módulo dejaría una puerta del POS abierta con Salón apagado)", () => {
    const delPos = ACCIONES.filter((a) => a.clave.startsWith("pos_"));
    expect(delPos.length).toBeGreaterThanOrEqual(11);
    expect(delPos.filter((a) => a.modulo !== "salon").map((a) => a.clave)).toEqual([]);
  });

  it.each(PUERTAS.map((p) => [p.nombre, p] as const))("con Salón apagado, %s responde que el módulo no está activo y no cambia ninguna tabla", async (_n, puerta) => {
    await fijarModulosActivos(E, SIN_SALON);
    const antes = await foto();
    expect(await puerta.llamar(e)).toMatchObject(RECHAZO);
    expect(await foto()).toEqual(antes);
  });

  it("la pantalla del POS (la lectura del mapa de mesas) tampoco: el guard de ver niega por módulo y no hay nivel de ver ni de editar en ninguna clave del salón", async () => {
    await fijarModulosActivos(E, SIN_SALON);
    expect(await requierePermisoVer(s.admin.id, s.sucursalId, "pos_mesas", prisma)).toMatchObject({ ok: false, motivo: "MODULO_NO_ACTIVO", modulo: "salon" });
    for (const clave of new Set(PUERTAS.map((p) => p.clave))) {
      expect(await obtenerMiNivelPermiso(s.admin.id, s.sucursalId, clave as AccionDeSucursal, prisma), clave).toEqual({ ver: false, editar: false });
    }
  });

  it("CONTROL: con Salón prendido las mismas puertas NO responden «módulo no activo» (el rechazo de arriba es por el módulo y no por otra cosa)", async () => {
    await fijarModulosActivos(E, ["stock", "salon"]);
    const respuestas = [await agregarItems(e.cuentaAbierta, [{ productoId: s.flan.id, cantidad: 1 }]), await crearMesa(50), await abrirCuenta(e.mesaLibre, 2)];
    for (const r of respuestas) expect((r as { mensaje: string }).mensaje).not.toBe(RECHAZO.mensaje);
    expect(respuestas.every((r) => (r as { ok: boolean }).ok)).toBe(true);
  });
});
