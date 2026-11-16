import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
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
import { diaDeCalendario, mediodiaDelDia, sumarDias, ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Compras, orden de compra (etapa OC) — CONCURRENCIA, con Postgres real: dos pedidos de la misma orden dan un solo número; órdenes distintas pedidas a la vez reciben números DISTINTOS y sin repetir; pedir contra anular, anular contra anular y cargar una
 * compra contra cerrar o anular terminan en uno de los órdenes posibles, nunca a medias; y el tope del saldo (`recepcion_excede_la_orden` en BLOQUEAR) se respeta aunque varias recepciones se confirmen a la vez. La garantía es el `FOR UPDATE` de la cabecera,
 * el candado de numeración por empresa, el `UPDATE … WHERE recibida + n <= pedida` del disparador de la base y el aislamiento SERIALIZABLE con reintento.
 */
const E = EMPRESA_POR_DEFECTO_ID;
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), dias), ZONA_ARGENTINA);

let s3: string, sec3: string;
let admin: string;
let harina: string, proveedorId: string;

const actor = () => ({ usuarioId: admin, empresaId: E, sucursalId: s3, sucursalNombre: "Central", ahora: new Date(), membresias: [{ sucursalId: s3 }] as never, ...baseDeTest({ lectura: [s3], escritura: [s3] }) }) as unknown as ContextoDeAccion;

async function crear(cantidad = 10): Promise<string> {
  const r = await crearOrdenDeCompraCasoDeUso(actor(), { proveedorId, lineas: [{ productoId: harina, cantidad }], claveIdempotencia: randomUUID() }, azarDelProceso);
  expect(r.ok, r.mensaje).toBe(true);
  return (r.ok && r.datos.ordenId) as string;
}
async function crearYPedir(): Promise<string> {
  const id = await crear();
  const r = await pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: id });
  expect(r.ok, r.mensaje).toBe(true);
  return id;
}
const cargarContra = (ordenId: string, cantidad: number) =>
  registrarFacturaProveedorCasoDeUso(
    actor(),
    {
      fecha: mediodia(-1),
      proveedorId,
      nroFactura: `A-00001-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      items: [{ productoId: harina, cantidad, precioTotal: cantidad * 100, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
      ordenDeCompra: { ordenId, renglones: [{ itemIndex: 0, lineaDeOrden: 1 }] },
      claveIdempotencia: randomUUID(),
    },
    azarDelProceso
  );
const confirmar = async (facturaId: string) => {
  const entradas = (await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } } })).map((r) => ({ renglonId: r.id, seccionId: sec3, cantidad: Number(r.cantidadStock) }));
  return confirmarRecepcionDeFacturaCasoDeUso(actor(), { facturaId, entradas, fechaStock: mediodia(0) });
};

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  sec3 = (await sembrarSeccion(s3)).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s3, productoId: harina, disponible: true } });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "ordenes_de_compra"]);
});

describe("pedir a la vez", () => {
  it.each([2, 6])("%i pedidos simultáneos de la MISMA orden: uno solo gana (número 1) y los demás reciben «ya pedida»", async (cuantos) => {
    const id = await crear();

    const rs = await Promise.all(Array.from({ length: cuantos }, () => pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: id })));

    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    for (const r of rs.filter((x) => !x.ok)) expect(r).toMatchObject({ ok: false, codigo: "YA_PEDIDA" });
    const o = await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } });
    expect([o.estado, o.numero]).toEqual(["PEDIDA", 1]);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "OrdenDeCompra", entidadId: id, valorNuevo: "PEDIDA" } })).toBe(1);
  });

  it("5 órdenes DISTINTAS pedidas a la vez: números 1 a 5, sin repetir ni dejar huecos", async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => crear()));

    const rs = await Promise.all(ids.map((ordenId) => pedirOrdenDeCompraCasoDeUso(actor(), { ordenId })));

    for (const r of rs) expect(r.ok, r.mensaje).toBe(true);
    const numeros = (await prisma.ordenDeCompra.findMany({ select: { numero: true } })).map((o) => o.numero).sort();
    expect(numeros).toEqual([1, 2, 3, 4, 5]);
  });

  it("pedir contra anular a la vez: la orden termina ANULADA, y tiene número solo si el pedido ganó primero", async () => {
    const id = await crear();

    const [pedir, anular] = await Promise.all([pedirOrdenDeCompraCasoDeUso(actor(), { ordenId: id }), anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Prueba de concurrencia" })]);

    expect(anular.ok, anular.mensaje).toBe(true);
    const o = await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } });
    expect(o.estado).toBe("ANULADA");
    if (pedir.ok) expect(o.numero).toBe(1);
    else expect([pedir.codigo, o.numero]).toEqual(["ORDEN_ANULADA", null]);
  });
});

describe("anular y cerrar a la vez", () => {
  it("dos anulaciones simultáneas: una gana, la otra recibe «ya anulada», una sola auditoría", async () => {
    const id = await crearYPedir();

    const rs = await Promise.all([1, 2, 3].map(() => anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Prueba" })));

    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    for (const r of rs.filter((x) => !x.ok)) expect(r).toMatchObject({ ok: false, codigo: "ORDEN_ANULADA" });
    expect(await prisma.registroAuditoria.count({ where: { entidad: "OrdenDeCompra", entidadId: id, valorNuevo: "ANULADA" } })).toBe(1);
  });

  it("cerrar contra anular a la vez: uno solo gana y la orden queda en el estado del ganador", async () => {
    const id = await crearYPedir();

    const [cerrar, anular] = await Promise.all([cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id }), anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Prueba" })]);

    expect([cerrar.ok, anular.ok].filter(Boolean)).toHaveLength(1);
    expect((await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).estado).toBe(cerrar.ok ? "CERRADA" : "ANULADA");
  });

  it.each(["anular", "cerrar"] as const)("cargar una compra contra la orden y %s la orden a la vez: nunca quedan las dos cosas (compra vinculada a una orden %s)", async (que) => {
    const id = await crearYPedir();

    const [compra, otra] = await Promise.all([
      cargarContra(id, 4),
      que === "anular" ? anularOrdenDeCompraCasoDeUso(actor(), { ordenId: id, motivo: "Prueba" }) : cerrarOrdenDeCompraCasoDeUso(actor(), { ordenId: id }),
    ]);

    const vinculos = await prisma.vinculoDeRenglonConOrden.count({ where: { ordenId: id } });
    const estado = (await prisma.ordenDeCompra.findUniqueOrThrow({ where: { id } })).estado;
    if (compra.ok) {
      // La compra ganó: la orden NO se pudo anular ni cerrar (tiene una compra pendiente de recibir contra ella).
      expect([otra.ok, vinculos, estado]).toEqual([false, 1, "PEDIDA"]);
    } else {
      expect([otra.ok, vinculos, estado]).toEqual([true, 0, que === "anular" ? "ANULADA" : "CERRADA"]);
      expect(compra).toMatchObject({ ok: false, codigo: "ORDEN_NO_PEDIDA" });
    }
  });
});

describe("el tope del saldo con el control en BLOQUEAR", () => {
  it("tres recepciones de 4 contra una línea de 10 confirmadas a la vez: entran exactamente dos (8), la tercera se frena y no deja stock ni compra", async () => {
    const id = await crearYPedir();
    await configurarControlDeExcesoCasoDeUso(actor(), { nivel: "BLOQUEAR" }, azarDelProceso);
    const cargadas = [];
    for (let i = 0; i < 3; i++) {
      const c = await cargarContra(id, 4);
      expect(c.ok, c.mensaje).toBe(true);
      cargadas.push((c.ok && c.datos.facturaId) as string);
    }

    const rs = await Promise.all(cargadas.map((f) => confirmar(f)));

    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    expect(rs.filter((r) => !r.ok)).toEqual([expect.objectContaining({ codigo: "EXCEDE_LA_ORDEN_BLOQUEADA" })]);
    expect(Number((await prisma.saldoDeLineaDeOrden.findFirstOrThrow({ where: { ordenId: id } })).cantidadRecibida)).toBe(8);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(2);
    expect(await prisma.facturaProveedorSucursal.count({ where: { estadoRecepcion: "PENDIENTE" } })).toBe(1);
  });

  it("la misma recepción confirmada varias veces a la vez suma UNA sola vez al saldo", async () => {
    const id = await crearYPedir();
    const c = await cargarContra(id, 4);
    const facturaId = (c.ok && c.datos.facturaId) as string;

    const rs = await Promise.all([1, 2, 3, 4].map(() => confirmar(facturaId)));

    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(Number((await prisma.saldoDeLineaDeOrden.findFirstOrThrow({ where: { ordenId: id } })).cantidadRecibida)).toBe(4);
  });
});
