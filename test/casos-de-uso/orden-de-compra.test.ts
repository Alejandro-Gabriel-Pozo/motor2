import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { azarDelProceso } from "../../src/lib/azar";
import { crearOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/crear-orden-de-compra";
import { pedirOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/pedir-orden-de-compra";
import { anularOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-orden-de-compra";
import { cerrarOrdenDeCompraCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/cerrar-orden-de-compra";
import { configurarControlDeExcesoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/configurar-control-de-exceso";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { registrarControlDeRecepcionCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-control-de-recepcion";
import { anularFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor";
import { diaDeCalendario, mediodiaDelDia, sumarDias, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/idempotencia";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";
import type { DatosFacturaProveedorInput } from "../../src/core/features/compras/factura-proveedor.schema";
import type { ComandoCrearOrdenDeCompra } from "../../src/core/features/compras/orden-de-compra.schema";

/**
 * Compras, orden de compra (etapa OC), con Postgres real: crear, pedir, anular, cerrar y configurar el control de exceso, y cargar una compra CONTRA una orden y confirmar su recepción (saldo por línea, control de exceso, anular la compra).
 * Los permisos los piden las Server Actions (`test/permisos/orden-de-compra-permisos.test.ts`); acá se prueba el caso de uso con el actor ya resuelto. La concurrencia está en `test/movimientos/orden-de-compra-concurrencia.test.ts` y el
 * recorrido de las combinaciones contra el oráculo en `test/movimientos/combinaciones-compras-orden-integracion.test.ts`.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const hoy = () => diaDeCalendario(new Date(), ZONA_ARGENTINA);
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(hoy(), dias), ZONA_ARGENTINA);

let s3: string, s4: string, sec3: string;
let admin: string;
let harina: string, aceite: string, proveedorId: string, otroProveedorId: string;

const actor = (ahora = new Date()) =>
  ({ usuarioId: admin, empresaId: E, sucursalId: s3, sucursalNombre: "Central", ahora, membresias: [{ sucursalId: s3 }, { sucursalId: s4 }] as never, ...baseDeTest({ lectura: [s3, s4], escritura: [s3, s4] }) }) as unknown as ContextoDeAccion;

const encender = () => fijarModulosActivos(E, [...MODULOS_VENDIBLES, "ordenes_de_compra"]);

const comandoDeOrden = (extra: Partial<ComandoCrearOrdenDeCompra> = {}): ComandoCrearOrdenDeCompra => ({
  proveedorId,
  lineas: [
    { productoId: harina, cantidad: 10, precio: 100 },
    { productoId: aceite, cantidad: 5, precio: null },
  ],
  claveIdempotencia: randomUUID(),
  ...extra,
});
async function crear(extra: Partial<ComandoCrearOrdenDeCompra> = {}): Promise<string> {
  const r = await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden(extra), azarDelProceso);
  expect(r.ok, r.mensaje).toBe(true);
  return (r.ok && r.datos.ordenId) as string;
}
async function crearYPedir(extra: Partial<ComandoCrearOrdenDeCompra> = {}): Promise<string> {
  const id = await crear(extra);
  const r = await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: id });
  expect(r.ok, r.mensaje).toBe(true);
  return id;
}
const ordenDe = (id: string) => prisma.ordenDeCompra.findUniqueOrThrow({ where: { id }, include: { lineas: { orderBy: { numero: "asc" }, include: { saldo: true } } } });
const nivel = (n: "PERMITIR" | "AVISAR" | "BLOQUEAR") => configurarControlDeExcesoCasoDeUso(actor(), { nivel: n }, azarDelProceso);

const datosDeCompra = (extra: Partial<DatosFacturaProveedorInput> = {}): DatosFacturaProveedorInput => ({
  fecha: mediodia(-1),
  proveedorId,
  nroFactura: `A-00001-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
  items: [{ productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
  reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
  claveIdempotencia: randomUUID(),
  ...extra,
});
/** Carga una compra pendiente de recibir contra la orden (renglón 0 → línea 1 de la orden). */
const cargarContra = (ordenId: string, extra: Partial<DatosFacturaProveedorInput> = {}, v: { itemIndex?: number; lineaDeOrden?: number; confirmoExceso?: boolean } = {}) =>
  registrarFacturaProveedorCasoDeUso(actor(), datosDeCompra({ ordenDeCompra: { ordenId, renglones: [{ itemIndex: v.itemIndex ?? 0, lineaDeOrden: v.lineaDeOrden ?? 1, confirmoExceso: v.confirmoExceso }] }, ...extra }), azarDelProceso);
const confirmar = async (facturaId: string) => {
  const entradas = (await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } }, orderBy: { orden: "asc" } })).map((r) => ({ renglonId: r.id, seccionId: sec3, cantidad: Number(r.cantidadStock) }));
  return confirmarRecepcionDeFacturaCasoDeUso(actor(), { facturaId, entradas, fechaStock: mediodia(0) });
};
const recibidaDe = async (ordenId: string, linea = 1) => Number((await prisma.saldoDeLineaDeOrden.findFirstOrThrow({ where: { ordenId, linea } })).cantidadRecibida);

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  s4 = (await prisma.sucursal.create({ data: { nombre: "Sucursal 4" } })).id;
  sec3 = (await sembrarSeccion(s3)).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  const litro = await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } });
  const aceiteInsumo = await prisma.insumo.create({ data: { nombre: "Aceite" } });
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  aceite = (await prisma.producto.create({ data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: litro.id, insumoId: aceiteInsumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [s3, s4].flatMap((sucursalId) => [harina, aceite].map((productoId) => ({ sucursalId, productoId, disponible: true }))) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  otroProveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_2", nombre: "Otro SA" } })).id;
  await encender();
});

describe("crear la orden", () => {
  it("nace BORRADOR, sin número, con sus líneas (precio vacío = sin precio; la sucursal destino es opcional) y la auditoría", async () => {
    const id = await crear();

    const o = await ordenDe(id);
    expect([o.estado, o.numero, o.sucursalId, o.creadoPorId, o.pedidaEn]).toEqual(["BORRADOR", null, null, admin, null]);
    expect(o.lineas.map((l) => [l.numero, l.productoId, Number(l.cantidadPedida), l.precioPorUnidadStock === null ? null : Number(l.precioPorUnidadStock), l.retirada, l.saldo])).toEqual([
      [1, harina, 10, 100, false, null],
      [2, aceite, 5, null, false, null],
    ]);
    const a = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "OrdenDeCompra", entidadId: id } });
    expect([a.campo, a.valorAnterior, a.valorNuevo, a.actorId]).toEqual(["estado", null, "BORRADOR", admin]);
  });

  it("con sucursal destino y entrega prevista de hoy", async () => {
    const id = await crear({ sucursalId: s4, fechaDeEntregaPrevista: hoy() });
    const o = await ordenDe(id);
    expect([o.sucursalId, o.fechaDeEntregaPrevista?.toISOString().slice(0, 10)]).toEqual([s4, hoy()]);
  });

  it("un precio cero es un precio (como Pedernal): se guarda cero, no «sin precio»", async () => {
    const id = await crear({ lineas: [{ productoId: harina, cantidad: 1, precio: 0 }] });
    expect(Number((await ordenDe(id)).lineas[0]!.precioPorUnidadStock)).toBe(0);
  });

  it("idempotente por clave: la misma clave y los mismos datos devuelven la MISMA orden; con otros datos, conflicto", async () => {
    const clave = randomUUID();
    const a = await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ claveIdempotencia: clave }), azarDelProceso);
    const b = await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ claveIdempotencia: clave }), azarDelProceso);
    const c = await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ claveIdempotencia: clave, lineas: [{ productoId: harina, cantidad: 99 }] }), azarDelProceso);

    expect(a).toMatchObject({ ok: true, datos: { repetida: false } });
    expect(b).toMatchObject({ ok: true, datos: { repetida: true, ordenId: a.ok && a.datos.ordenId } });
    expect(c).toMatchObject({ ok: false, codigo: "CONFLICTO_IDEMPOTENCIA", mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    expect(await prisma.ordenDeCompra.count()).toBe(1);
  });

  it.each([
    ["sin proveedor", { proveedorId: "" }, "SIN_PROVEEDOR"],
    ["sin líneas", { lineas: [] }, "SIN_LINEAS"],
    ["cantidad cero", { lineas: [{ productoId: "x", cantidad: 0 }] }, "CANTIDAD_INVALIDA"],
    ["precio negativo", { lineas: [{ productoId: "x", cantidad: 1, precio: -1 }] }, "PRECIO_INVALIDO"],
    ["entrega anterior a hoy", { fechaDeEntregaPrevista: sumarDias(hoy(), -1) }, "ENTREGA_ANTERIOR_A_HOY"],
  ] as const)("rechaza: %s, y no escribe nada", async (_n, extra, codigo) => {
    const r = await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden(extra as Partial<ComandoCrearOrdenDeCompra>), azarDelProceso);
    expect(r).toMatchObject({ ok: false, codigo });
    expect(await prisma.ordenDeCompra.count()).toBe(0);
  });

  it("rechaza un proveedor inexistente o inactivo, una sucursal inexistente y un producto inexistente (nada queda escrito)", async () => {
    expect(await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ proveedorId: randomUUID() }), azarDelProceso)).toMatchObject({ ok: false, codigo: "PROVEEDOR_NO_DISPONIBLE" });
    await prisma.proveedor.update({ where: { id: otroProveedorId }, data: { activo: false } });
    expect(await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ proveedorId: otroProveedorId }), azarDelProceso)).toMatchObject({ ok: false, codigo: "PROVEEDOR_NO_DISPONIBLE" });
    expect(await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ sucursalId: randomUUID() }), azarDelProceso)).toMatchObject({ ok: false, codigo: "SUCURSAL_NO_DISPONIBLE" });
    expect(await crearOrdenDeCompraCasoDeUso(actor(), comandoDeOrden({ lineas: [{ productoId: randomUUID(), cantidad: 1 }] }), azarDelProceso)).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_DISPONIBLE" });
    expect(await prisma.ordenDeCompra.count()).toBe(0);
  });
});

describe("pedir la orden", () => {
  it("BORRADOR a PEDIDA: número correlativo por empresa (1, 2), quién y cuándo, el saldo de cada línea en cero y la auditoría con el número", async () => {
    const a = await crear();
    const b = await crear();

    const ra = await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: a });
    const rb = await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: b });

    expect(ra).toMatchObject({ ok: true, mensaje: "Orden pedida: es la número 1.", datos: { ordenId: a, numero: 1 } });
    expect(rb).toMatchObject({ ok: true, datos: { numero: 2 } });
    const o = await ordenDe(a);
    expect([o.estado, o.numero, o.pedidaPorId, Boolean(o.pedidaEn), Boolean(o.fechaDeNegocio)]).toEqual(["PEDIDA", 1, admin, true, true]);
    expect(o.lineas.map((l) => [Number(l.saldo?.cantidadPedida), Number(l.saldo?.cantidadRecibida)])).toEqual([[10, 0], [5, 0]]);
    const aud = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "OrdenDeCompra", entidadId: a, valorNuevo: "PEDIDA" } });
    expect([aud.valorAnterior, aud.descripcion]).toEqual(["BORRADOR", "Orden de compra pedida con el número 1"]);
  });

  it("pedir dos veces: «ya pedida», sin otro número; una anulada o cerrada tampoco se pide; una inexistente: no se encontró", async () => {
    const id = await crearYPedir();
    expect(await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: id })).toMatchObject({ ok: false, codigo: "YA_PEDIDA", mensaje: "Esta orden ya fue pedida." });
    expect((await ordenDe(id)).numero).toBe(1);

    const borrador = await crear();
    await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: borrador, motivo: "Ya no hace falta" });
    expect(await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: borrador })).toMatchObject({ ok: false, codigo: "ORDEN_ANULADA" });

    await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id });
    expect(await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: id })).toMatchObject({ ok: false, codigo: "ORDEN_CERRADA" });
    expect(await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: randomUUID() })).toMatchObject({ ok: false, codigo: "NO_ENCONTRADA", mensaje: "No se encontró esa orden de compra." });
  });

  it("la entrega prevista que ya pasó al momento de pedir se rechaza (el borrador se creó cuando todavía valía)", async () => {
    const id = await crear({ fechaDeEntregaPrevista: hoy() });
    const manana = new Date(mediodia(2));
    expect(await pedirOrdenDeCompraCasoDeUso(actor(manana), { ordenId: id })).toMatchObject({ ok: false, codigo: "ENTREGA_ANTERIOR_AL_PEDIDO" });
    expect((await ordenDe(id)).estado).toBe("BORRADOR");
  });

  it("la numeración es por empresa: otra empresa empieza de nuevo en 1", async () => {
    const id = await crearYPedir();
    expect((await ordenDe(id)).numero).toBe(1);
    // El número es único por EMPRESA (no global): la base lo declara así, y otra empresa tiene su propia serie.
    const unico = await prismaAdmin.$queryRaw<{ def: string }[]>`SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indrelid = 'public."OrdenDeCompra"'::regclass AND indisunique`;
    expect(unico.map((u) => u.def).some((d) => /\("empresaId", numero\)|\("empresaId", "numero"\)/.test(d))).toBe(true);
  });
});

describe("anular la orden", () => {
  it("un borrador y una pedida se anulan con motivo (quién, cuándo, motivo y auditoría); anular dos veces: «ya anulada»", async () => {
    const borrador = await crear();
    const pedida = await crearYPedir();

    const r1 = await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: borrador, motivo: "Se cargó mal" });
    const r2 = await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: pedida, motivo: "El proveedor no entrega" });

    expect(r1).toMatchObject({ ok: true, mensaje: "Orden anulada." });
    expect(r2.ok).toBe(true);
    const o = await ordenDe(pedida);
    expect([o.estado, o.anuladaPorId, Boolean(o.anuladaEn), o.motivoDeAnulacion]).toEqual(["ANULADA", admin, true, "El proveedor no entrega"]);
    const aud = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "OrdenDeCompra", entidadId: pedida, valorNuevo: "ANULADA" } });
    expect([aud.valorAnterior, aud.descripcion]).toEqual(["PEDIDA", "Orden de compra 1 anulada. Motivo: El proveedor no entrega"]);
    expect(await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: pedida, motivo: "Otra vez" })).toMatchObject({ ok: false, codigo: "ORDEN_ANULADA" });
  });

  it("el motivo es obligatorio y de caracteres permitidos; una cerrada no se anula", async () => {
    const id = await crearYPedir();
    expect(await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "  " })).toMatchObject({ ok: false, codigo: "MOTIVO_OBLIGATORIO" });
    expect(await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Motivo <b>" })).toMatchObject({ ok: false, codigo: "MOTIVO_INVALIDO" });
    expect((await ordenDe(id)).estado).toBe("PEDIDA");
    await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id });
    expect(await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Tarde" })).toMatchObject({ ok: false, codigo: "ORDEN_CERRADA" });
  });

  it("con una compra vigente cargada contra ella no se anula; anulada la compra, sí", async () => {
    const id = await crearYPedir();
    const c = await cargarContra(id);
    expect(c.ok, c.mensaje).toBe(true);

    expect(await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Quiero anularla" })).toMatchObject({ ok: false, codigo: "CON_RECEPCIONES" });

    const facturaId = (c.ok && c.datos.facturaId) as string;
    const an = await anularFacturaProveedorCasoDeUso(actor(), { facturaId, motivo: "Se cargó mal", claveIdempotencia: randomUUID() });
    expect(an.ok, an.mensaje).toBe(true);
    expect((await anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Ahora sí" })).ok).toBe(true);
  });
});

describe("cerrar la orden (siempre a mano)", () => {
  it("una pedida sin recibir se cierra «con saldo»; recibida entera, «completa»; no hay cierre automático al recibir todo", async () => {
    const conSaldo = await crearYPedir();
    expect(await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: conSaldo })).toMatchObject({ ok: true, mensaje: "Orden cerrada con saldo: quedó mercadería sin recibir.", datos: { cierreMotivo: "CON_SALDO" } });
    const o = await ordenDe(conSaldo);
    expect([o.estado, o.cierreMotivo, o.cerradaPorId, Boolean(o.cerradaEn)]).toEqual(["CERRADA", "CON_SALDO", admin, true]);

    const completa = await crearYPedir({ lineas: [{ productoId: harina, cantidad: 10 }] });
    const c = await cargarContra(completa);
    await confirmar((c.ok && c.datos.facturaId) as string);
    expect((await ordenDe(completa)).estado).toBe("PEDIDA");
    expect(await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: completa })).toMatchObject({ ok: true, mensaje: "Orden cerrada: se recibió todo lo pedido.", datos: { cierreMotivo: "COMPLETA" } });
    const aud = await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "OrdenDeCompra", entidadId: completa, valorNuevo: "CERRADA" } });
    expect(aud.descripcion).toBe("Orden de compra 2 cerrada (completa)");
  });

  it("un borrador no se cierra; cerrar dos veces: «ya cerrada»; con una compra pendiente de recibir no se cierra", async () => {
    expect(await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: await crear() })).toMatchObject({ ok: false, codigo: "NO_ESTA_PEDIDA" });
    const id = await crearYPedir();
    const c = await cargarContra(id);
    expect(await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id })).toMatchObject({ ok: false, codigo: "CON_RECEPCIONES_PENDIENTES" });
    await confirmar((c.ok && c.datos.facturaId) as string);
    expect((await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id })).ok).toBe(true);
    expect(await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id })).toMatchObject({ ok: false, codigo: "ORDEN_CERRADA" });
  });
});

describe("cargar una compra contra la orden y confirmar su recepción", () => {
  it("el vínculo se escribe con la compra; el saldo NO se mueve hasta confirmar la recepción; al confirmar suma lo recibido", async () => {
    const id = await crearYPedir();
    const c = await cargarContra(id);
    expect(c.ok, c.mensaje).toBe(true);
    expect(await prisma.vinculoDeRenglonConOrden.count({ where: { ordenId: id } })).toBe(1);
    expect(await recibidaDe(id)).toBe(0);

    const r = await confirmar((c.ok && c.datos.facturaId) as string);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await recibidaDe(id)).toBe(10);
    expect(await recibidaDe(id, 2)).toBe(0);
  });

  it("una compra SIN orden sigue como siempre y no toca ningún saldo", async () => {
    const id = await crearYPedir();
    const c = await registrarFacturaProveedorCasoDeUso(actor(), datosDeCompra(), azarDelProceso);
    expect(c.ok, c.mensaje).toBe(true);
    await confirmar((c.ok && c.datos.facturaId) as string);
    expect(await recibidaDe(id)).toBe(0);
    expect(await prisma.vinculoDeRenglonConOrden.count()).toBe(0);
  });

  it("rechaza: orden en borrador, anulada o cerrada, proveedor distinto, producto distinto, línea inexistente y módulo apagado (nada queda escrito)", async () => {
    const borrador = await crear();
    expect(await cargarContra(borrador)).toMatchObject({ ok: false, codigo: "ORDEN_NO_PEDIDA" });
    const id = await crearYPedir();
    expect(await cargarContra(id, { proveedorId: otroProveedorId })).toMatchObject({ ok: false, codigo: "PROVEEDOR_DISTINTO" });
    expect(await cargarContra(id, { items: [{ productoId: aceite, cantidad: 1, precioTotal: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }] })).toMatchObject({ ok: false, codigo: "PRODUCTO_DISTINTO" });
    expect(await cargarContra(id, {}, { lineaDeOrden: 9 })).toMatchObject({ ok: false, codigo: "LINEA_DE_ORDEN_NO_ENCONTRADA" });
    expect(await cargarContra(randomUUID())).toMatchObject({ ok: false, codigo: "ORDEN_NO_ENCONTRADA" });
    await cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id });
    expect(await cargarContra(id)).toMatchObject({ ok: false, codigo: "ORDEN_NO_PEDIDA" });

    await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
    expect(await cargarContra(id)).toMatchObject({ ok: false, codigo: "MODULO_APAGADO" });
    expect(await prisma.facturaProveedor.count()).toBe(0);
    expect(await prisma.vinculoDeRenglonConOrden.count()).toBe(0);
  });

  it("una compra que no se recibe por separado (reparto con otra sucursal) no se carga contra una orden", async () => {
    const id = await crearYPedir();
    const r = await cargarContra(id, { reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 50 }, { sucursalId: s4, valor: 50 }] } });
    expect(r).toMatchObject({ ok: false, codigo: "ORDEN_NO_APLICA" });
  });

  it("anular la compra recibida devuelve lo recibido al saldo de la línea", async () => {
    const id = await crearYPedir();
    const c = await cargarContra(id);
    const facturaId = (c.ok && c.datos.facturaId) as string;
    await confirmar(facturaId);
    expect(await recibidaDe(id)).toBe(10);

    const an = await anularFacturaProveedorCasoDeUso(actor(), { facturaId, motivo: "Se cargó mal", claveIdempotencia: randomUUID() });
    expect(an.ok, an.mensaje).toBe(true);
    expect(await recibidaDe(id)).toBe(0);
  });

  it("un renglón RECHAZADO por el control de la recepción no cuenta contra la orden", async () => {
    const id = await crearYPedir();
    await nivel("BLOQUEAR");
    const c = await cargarContra(id, {}, { });
    const facturaId = (c.ok && c.datos.facturaId) as string;
    const renglon = await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
    const ctl = await registrarControlDeRecepcionCasoDeUso(actor(), { facturaId, controles: [{ renglonId: renglon.id, condicion: "RECHAZADA", observacion: "Llegó vencida" }] }, azarDelProceso);
    expect(ctl.ok, ctl.mensaje).toBe(true);

    const r = await confirmar(facturaId);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await recibidaDe(id)).toBe(0);
  });
});

describe("control de exceso (compras.recepcion_excede_la_orden)", () => {
  const conExceso = (ordenId: string, confirmoExceso = false) => cargarContra(ordenId, { items: [{ productoId: harina, cantidad: 12, precioTotal: 1200, referenciaProveedor: REFERENCIA_DE_PRUEBA }] }, { confirmoExceso });

  it("sin fila es PERMITIR: el exceso pasa y el saldo queda por encima de lo pedido", async () => {
    const id = await crearYPedir();
    const c = await conExceso(id);
    expect(c.ok, c.mensaje).toBe(true);
    const r = await confirmar((c.ok && c.datos.facturaId) as string);
    expect(r.ok, r.mensaje).toBe(true);
    expect(await recibidaDe(id)).toBe(12);
  });

  it("BLOQUEAR frena el exceso al cargar y, si el nivel cambió después de cargar, al confirmar (se deshace todo: ni stock ni compra)", async () => {
    const id = await crearYPedir();
    await nivel("BLOQUEAR");
    expect(await conExceso(id, true)).toMatchObject({ ok: false, codigo: "EXCEDE_LA_ORDEN_BLOQUEADA", mensaje: "Lo que recibís supera lo pedido en la orden y el control no lo permite." });

    await nivel("PERMITIR");
    const c = await conExceso(id);
    expect(c.ok, c.mensaje).toBe(true);
    await nivel("BLOQUEAR");
    const r = await confirmar((c.ok && c.datos.facturaId) as string);
    expect(r).toMatchObject({ ok: false, codigo: "EXCEDE_LA_ORDEN_BLOQUEADA" });
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(0);
    expect((await prisma.facturaProveedorSucursal.findFirstOrThrow()).estadoRecepcion).toBe("PENDIENTE");
    expect(await recibidaDe(id)).toBe(0);
  });

  it("AVISAR frena el exceso salvo que se confirme (confirmoExceso)", async () => {
    const id = await crearYPedir();
    await nivel("AVISAR");
    expect(await conExceso(id)).toMatchObject({ ok: false, codigo: "EXCEDE_LA_ORDEN_SIN_CONFIRMAR" });
    const c = await conExceso(id, true);
    expect(c.ok, c.mensaje).toBe(true);
    expect((await confirmar((c.ok && c.datos.facturaId) as string)).ok).toBe(true);
    expect(await recibidaDe(id)).toBe(12);
  });

  it("el tope es acumulado: dos compras que juntas pasan lo pedido, la segunda se frena en BLOQUEAR", async () => {
    const id = await crearYPedir();
    await nivel("BLOQUEAR");
    const a = await cargarContra(id, { items: [{ productoId: harina, cantidad: 6, precioTotal: 600, referenciaProveedor: REFERENCIA_DE_PRUEBA }] });
    expect((await confirmar((a.ok && a.datos.facturaId) as string)).ok).toBe(true);
    expect(await cargarContra(id, { items: [{ productoId: harina, cantidad: 6, precioTotal: 600, referenciaProveedor: REFERENCIA_DE_PRUEBA }] })).toMatchObject({ ok: false, codigo: "EXCEDE_LA_ORDEN_BLOQUEADA" });
    const b = await cargarContra(id, { items: [{ productoId: harina, cantidad: 4, precioTotal: 400, referenciaProveedor: REFERENCIA_DE_PRUEBA }] });
    expect(b.ok, b.mensaje).toBe(true);
    expect((await confirmar((b.ok && b.datos.facturaId) as string)).ok).toBe(true);
    expect(await recibidaDe(id)).toBe(10);
  });
});

describe("configurar el nivel del control", () => {
  it("cambia el nivel (una sola fila por empresa y control), audita de qué a qué y rechaza «sin cambios» (sin fila = PERMITIR)", async () => {
    expect(await nivel("PERMITIR")).toMatchObject({ ok: false, codigo: "SIN_CAMBIOS" });
    expect(await nivel("AVISAR")).toMatchObject({ ok: true, mensaje: "Control configurado: ahora está en «Avisar»." });
    expect(await nivel("AVISAR")).toMatchObject({ ok: false, codigo: "SIN_CAMBIOS" });
    expect(await nivel("BLOQUEAR")).toMatchObject({ ok: true });

    const filas = await prisma.nivelDeControl.findMany();
    expect(filas.map((f) => [f.control, f.nivel, f.actualizadoPorId])).toEqual([["compras.recepcion_excede_la_orden", "BLOQUEAR", admin]]);
    const aud = await prisma.registroAuditoria.findMany({ where: { entidad: "NivelDeControl" }, orderBy: { creadoEn: "asc" } });
    expect(aud.map((a) => [a.valorAnterior, a.valorNuevo])).toEqual([["PERMITIR", "AVISAR"], ["AVISAR", "BLOQUEAR"]]);
  });
});
