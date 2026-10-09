import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { crearUsuarioConRol, entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { textoDeDenegacion } from "../../src/core/permisos/motivos";
import type { AccionClave } from "../../src/core/permisos/acciones";
import type { ResultadoAccion } from "../../src/server/actions/tipos";
import { actualizarMaxMesasAbiertas, crearMesa } from "../../src/server/actions/pos/mesas";
import { abrirCuenta, asignarClienteACuenta, corregirComensales, liberarMesa } from "../../src/server/actions/pos/cuenta-apertura";
import { agregarItems, enviarACocina, quitarItemSinEnviar, quitarPromoSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { anularItemEnviado, anularPromoEnviada } from "../../src/server/actions/pos/cuenta-anulacion";
import { cerrarCuenta, emitirTicketCorregido } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";

/**
 * Red del Hito 4 (paso 0.2 de `docs/plan-hito-4-pureza.md` §5), ANTES de mover las acciones del POS a casos de uso: cada una de las 14 mutaciones del POS
 * (las 10 sin caso de uso y las 4 ya migradas) rechaza a un rol que tiene TODAS las claves del circuito del salón MENOS la suya, con el texto exacto del guard
 * (`core/permisos/motivos.ts`), y al rechazar no cambia NINGUNA tabla del salón ni de la venta. Antes de este test, `corregirComensales` y
 * `quitarPromoSinEnviar` no tenían ningún test de rechazo, y `liberarMesa`, `agregarItems`, `quitarItemSinEnviar` y `enviarACocina` solo uno con
 * `/No tenés permiso/` genérico (que no ve un cambio de clave: con otra clave que el rol SÍ tiene, la acción pasaría).
 *
 * Los argumentos apuntan a filas REALES en el estado en que cada acción escribe (mesa libre, cuenta abierta, ítem y promo sin enviar, ítem y promo ya
 * enviados, cuenta vacía, cuenta lista para cerrar, ticket desactualizado): sin el guard, cada llamada escribiría (verificado al escribir el test: con
 * `conPermiso` sin la puerta y sin mirar el mensaje, las 14 cambian la foto). Por eso un envoltorio que se cae, o una clave cambiada por otra del circuito,
 * pone este test en rojo por dos lados: el mensaje deja de ser el del guard y la foto de las tablas cambia.
 */

/** Las claves del circuito del salón (todas las `pos_*` del catálogo). */
const CLAVES_DEL_SALON: readonly AccionClave[] = [
  "pos_mesas",
  "pos_alta_mesa",
  "pos_limite_mesas_abiertas",
  "pos_abrir_cuenta",
  "pos_asignar_cliente",
  "pos_liberar_mesa",
  "pos_tomar_pedido",
  "pos_enviar_a_cocina",
  "pos_anular_item",
  "pos_cerrar_cuenta",
  "pos_emitir_ticket_corregido",
];

interface Escenario {
  mesaLibre: string;
  cuentaAbierta: string;
  cuentaVacia: string;
  cuentaLista: string;
  cuentaConTicket: string;
  itemSinEnviar: string;
  itemEnviado: string;
  promoSinEnviar: string;
  promoEnviada: string;
  clienteId: string;
  flanId: string;
}

interface Mutacion {
  nombre: string;
  clave: AccionClave;
  llamar: (e: Escenario) => Promise<ResultadoAccion>;
}

const MUTACIONES: Mutacion[] = [
  { nombre: "crearMesa", clave: "pos_alta_mesa", llamar: () => crearMesa(50) },
  { nombre: "actualizarMaxMesasAbiertas", clave: "pos_limite_mesas_abiertas", llamar: () => actualizarMaxMesasAbiertas(5) },
  { nombre: "abrirCuenta", clave: "pos_abrir_cuenta", llamar: (e) => abrirCuenta(e.mesaLibre, 2) },
  { nombre: "corregirComensales", clave: "pos_abrir_cuenta", llamar: (e) => corregirComensales(e.cuentaAbierta, 3) },
  { nombre: "asignarClienteACuenta", clave: "pos_asignar_cliente", llamar: (e) => asignarClienteACuenta(e.cuentaAbierta, e.clienteId) },
  { nombre: "liberarMesa", clave: "pos_liberar_mesa", llamar: (e) => liberarMesa(e.cuentaVacia) },
  { nombre: "agregarItems", clave: "pos_tomar_pedido", llamar: (e) => agregarItems(e.cuentaAbierta, [{ productoId: e.flanId, cantidad: 1 }]) },
  { nombre: "quitarPromoSinEnviar", clave: "pos_tomar_pedido", llamar: (e) => quitarPromoSinEnviar(e.promoSinEnviar) },
  { nombre: "quitarItemSinEnviar", clave: "pos_tomar_pedido", llamar: (e) => quitarItemSinEnviar(e.itemSinEnviar) },
  { nombre: "enviarACocina", clave: "pos_enviar_a_cocina", llamar: (e) => enviarACocina(e.cuentaAbierta, [e.itemSinEnviar]) },
  { nombre: "anularItemEnviado", clave: "pos_anular_item", llamar: (e) => anularItemEnviado(e.itemEnviado, 1, "Se cayó", 1) },
  { nombre: "anularPromoEnviada", clave: "pos_anular_item", llamar: (e) => anularPromoEnviada(e.promoEnviada, "Se cayó") },
  { nombre: "cerrarCuenta", clave: "pos_cerrar_cuenta", llamar: (e) => cerrarCuenta(e.cuentaLista) },
  { nombre: "emitirTicketCorregido", clave: "pos_emitir_ticket_corregido", llamar: (e) => emitirTicketCorregido(e.cuentaConTicket, "Se anuló el flan") },
];

/** Foto completa de lo que tocan las 14 (salón, venta y auditoría), por id: una actualización que no cambia conteos también se ve. */
async function fotoDelSalon() {
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

let e: Escenario;
let sucursalId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const s = await sembrarSalon();
  sucursalId = s.sucursalId;
  await entrarComo(s.admin);

  const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
  const promoCarta = await prisma.promoCarta.create({ data: { seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 10000 } });
  const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 15 } });
  const mesaLibre = (await prisma.mesa.create({ data: { sucursalId, numero: 7 } })).id;

  // La cuenta abierta de la mesa 4: una Milanesa ya enviada, un Flan sin enviar, una promo sin enviar y una promo ya enviada.
  const abierta = await sembrarCuenta(s.mesa.id, s.admin.id, [
    { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1 },
    { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000 },
  ]);
  const promo = async (numeroEnvio: number | null) => {
    const p = await prisma.promoCuenta.create({ data: { cuentaId: abierta.id, promoCartaId: promoCarta.id, precio: 10000, titulo: "Menú del día", creadoPorId: s.admin.id } });
    await prisma.cuentaItem.create({ data: { cuentaId: abierta.id, productoId: s.milanesa.id, cantidad: 1, precioUnitario: 7500, numeroEnvio, promoCuentaId: p.id, creadoPorId: s.admin.id } });
    await prisma.cuentaItem.create({ data: { cuentaId: abierta.id, productoId: s.flan.id, cantidad: 1, precioUnitario: 2500, numeroEnvio, promoCuentaId: p.id, creadoPorId: s.admin.id } });
    return p.id;
  };
  const promoSinEnviar = await promo(null);
  const promoEnviada = await promo(1);

  const vacia = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 6 } })).id, s.admin.id);
  const lista = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 8 } })).id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);

  // Una cuenta cerrada con su ticket 1-A, y la venta del Flan anulada después: el ticket quedó desactualizado (emitir el B escribiría).
  const conTicket = await sembrarCuenta((await prisma.mesa.create({ data: { sucursalId, numero: 9 } })).id, s.admin.id, [
    { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, numeroEnvio: 1 },
    { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
  ]);
  const cierre = await cerrarCuenta(conTicket.id);
  if (!cierre.ok) throw new Error(cierre.mensaje);
  const flanVendido = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: conTicket.id, productoId: s.flan.id } });
  const anulacion = await anularVenta(flanVendido.operacionId!);
  if (!anulacion.ok) throw new Error(anulacion.mensaje);

  e = {
    mesaLibre,
    cuentaAbierta: abierta.id,
    cuentaVacia: vacia.id,
    cuentaLista: lista.id,
    cuentaConTicket: conTicket.id,
    itemEnviado: abierta.items[0].id,
    itemSinEnviar: abierta.items[1].id,
    promoSinEnviar,
    promoEnviada,
    clienteId: cliente.id,
    flanId: s.flan.id,
  };
});

describe("las 14 mutaciones del POS rechazan sin su clave y no cambian ninguna tabla", () => {
  it("la lista son las 14 (una por mutación del POS) y cubre todas las claves del circuito salvo la de ver el mapa", () => {
    expect(MUTACIONES).toHaveLength(14);
    expect(new Set(MUTACIONES.map((m) => m.nombre)).size).toBe(14);
    expect(new Set(MUTACIONES.map((m) => m.clave))).toEqual(new Set(CLAVES_DEL_SALON.filter((c) => c !== "pos_mesas")));
  });

  it.each(MUTACIONES.map((m) => [m.nombre, m] as const))("un rol con todas las claves del salón menos la suya: %s rechaza con el texto del guard", async (_n, m) => {
    const nombreDelRol = `sin-${m.clave}`;
    const usuario = await crearUsuarioConRol(
      sucursalId,
      nombreDelRol,
      CLAVES_DEL_SALON.filter((c) => c !== m.clave).map((clave) => ({ clave, ver: true, editar: true })),
    );
    await entrarComo(usuario);
    const antes = await fotoDelSalon();
    expect(await m.llamar(e)).toEqual({ ok: false, mensaje: textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", para: "editar", accion: m.clave, rol: nombreDelRol }) });
    expect(await fotoDelSalon()).toEqual(antes);
  });
});
