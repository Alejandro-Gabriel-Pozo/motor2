import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { fijarModulosActivos, MODULOS_VENDIBLES } from "../setup/modulos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { confirmarRecepcionDeFacturaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura";
import { anularFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario, sumarDias } from "../../src/core/tiempo/zona-horaria";
import { MENSAJE_RECEPCION_YA_RECIBIDA } from "../../src/core/compras/public";
import type { ContextoDeAccion } from "../../src/server/actions/tipos";

/**
 * Compras N3-a, recepción separada — CONCURRENCIA, con Postgres real: confirmar la recepción de la misma parte a la vez no duplica el stock (una gana, las demás reciben «ya recibida»), y confirmar contra anular a la
 * vez termina en uno de los dos órdenes posibles, nunca en un estado a medias (stock vivo de una factura anulada, o una compra sin su parte). La garantía es el candado de la cabecera (`FOR UPDATE`), la guarda
 * `WHERE estadoRecepcion = 'PENDIENTE'`, el disparador de la base y el aislamiento SERIALIZABLE con reintento.
 *
 * Nota de mutación (comprobada a mano): sacar SOLO la guarda `WHERE estadoRecepcion = 'PENDIENTE'` deja verde este archivo, porque el estado se vuelve a leer bajo SERIALIZABLE (el perdedor reintenta y ve «ya recibida») y el
 * disparador de la base impide volver atrás; la guarda tiene su propia prueba en `test/casos-de-uso/confirmar-recepcion-de-factura.test.ts` («la guarda de la persistencia»).
 */
const E = EMPRESA_POR_DEFECTO_ID;
const mediodia = (dias: number) => mediodiaDelDia(sumarDias(diaDeCalendario(new Date(), ZONA_ARGENTINA), dias), ZONA_ARGENTINA);

let s3: string, sec3: string;
let admin: string;
let harina: string, aceite: string, proveedorId: string;

const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actor = () => ({ usuarioId: admin, empresaId: E, sucursalId: s3, sucursalNombre: "Central", ahora: new Date(), membresias: [{ sucursalId: s3 }] as never, ...baseDe(s3) }) as unknown as ContextoDeAccion;

async function cargarPendiente(nroFactura: string): Promise<string> {
  const r = await registrarFacturaProveedorCasoDeUso(actor(), {
    fecha: mediodia(-3),
    proveedorId,
    nroFactura,
    seccionId: sec3,
    items: [
      { productoId: harina, cantidad: 10, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
      { productoId: aceite, cantidad: 5, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA },
    ],
    reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: s3, valor: 100 }] },
    claveIdempotencia: randomUUID(),
  });
  expect(r.ok, r.mensaje).toBe(true);
  return (r.ok && r.datos.facturaId) as string;
}
const entradasEnteras = async (facturaId: string) =>
  (await prisma.facturaProveedorRenglon.findMany({ where: { facturaProveedorId: facturaId, productoId: { not: null } }, orderBy: { orden: "asc" } })).map((r) => ({ renglonId: r.id, seccionId: sec3, cantidad: Number(r.cantidadStock) }));
const confirmar = async (facturaId: string) => confirmarRecepcionDeFacturaCasoDeUso(actor(), { facturaId, entradas: await entradasEnteras(facturaId), fechaStock: mediodia(-2) });
const anular = (facturaId: string) => anularFacturaProveedorCasoDeUso(actor(), { facturaId, motivo: "Prueba de concurrencia", claveIdempotencia: randomUUID() });

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  s3 = base.sucursal.id;
  sec3 = (await sembrarSeccion(s3)).id;
  admin = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s3, rolId: base.admin.id })).id;
  const { kg, insumo } = await sembrarCatalogoBase();
  const litro = await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } });
  const aceiteInsumo = await prisma.insumo.create({ data: { nombre: "Aceite" } });
  harina = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } })).id;
  aceite = (await prisma.producto.create({ data: { codigo: "MP_ACEITE", nombre: "Aceite", tipo: "MP", unidadStockId: litro.id, insumoId: aceiteInsumo.id } })).id;
  await prisma.disponibilidadProducto.createMany({ data: [harina, aceite].map((productoId) => ({ sucursalId: s3, productoId, disponible: true })) });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await fijarModulosActivos(E, [...MODULOS_VENDIBLES, "recepcion_de_compras"]);
});

describe("dos o más confirmaciones de la MISMA parte a la vez", () => {
  it.each([2, 8])("%i confirmaciones simultáneas: UNA sola entrada de stock (una compra, dos movimientos, no el doble) y las demás reciben «ya recibida»", async (cuantas) => {
    const facturaId = await cargarPendiente("A-00001-00000200");

    const resultados = await Promise.all(Array.from({ length: cuantas }, () => confirmar(facturaId)));

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    const rechazadas = resultados.filter((r) => !r.ok);
    expect(rechazadas).toHaveLength(cuantas - 1);
    for (const r of rechazadas) expect(r).toMatchObject({ ok: false, codigo: "YA_RECIBIDA", mensaje: MENSAJE_RECEPCION_YA_RECIBIDA });
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect(await prisma.movimientoStock.count({ where: { proceso: "COMPRA" } })).toBe(2);
    expect([await calcularSaldoTotal(harina, sec3, prisma), await calcularSaldoTotal(aceite, sec3, prisma)]).toEqual([10, 5]);
    expect(await prisma.registroAuditoria.count({ where: { entidadId: facturaId, campo: "recepcion" } })).toBe(1);
    const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
    expect([parte.estadoRecepcion, Boolean(parte.operacionId)]).toEqual(["RECIBIDA", true]);
  });

  it("confirmaciones de partes DISTINTAS a la vez no se pisan: cada una entra una vez", async () => {
    const a = await cargarPendiente("A-00001-00000201");
    const b = await cargarPendiente("A-00001-00000202");

    const resultados = await Promise.all([confirmar(a), confirmar(b), confirmar(a), confirmar(b)]);

    expect(resultados.filter((r) => r.ok)).toHaveLength(2);
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(2);
    expect(await calcularSaldoTotal(harina, sec3, prisma)).toBe(20);
  });
});

describe("confirmar contra anular, a la vez", () => {
  // Se prueba lanzando primero la confirmación y primero la anulación: el orden de llegada al candado de la cabecera lo decide la base, y las dos formas tienen que terminar sin estados a medias.
  it.each([
    ["confirmar", 1], ["confirmar", 2], ["confirmar", 3],
    ["anular", 4], ["anular", 5], ["anular", 6],
  ] as const)("lanzando primero %s (ronda %i): o se confirma y se anula revirtiendo, o se anula y la confirmación falla; nunca queda stock vivo de una factura anulada ni una compra sin su parte", async (primero, ronda) => {
    const facturaId = await cargarPendiente(`A-00001-0000030${ronda}`);

    const [c, a] = primero === "confirmar" ? await Promise.all([confirmar(facturaId), anular(facturaId)]) : (await Promise.all([anular(facturaId), confirmar(facturaId)])).reverse() as [Awaited<ReturnType<typeof confirmar>>, Awaited<ReturnType<typeof anular>>];

    const factura = await prisma.facturaProveedor.findUniqueOrThrow({ where: { id: facturaId } });
    const parte = await prisma.facturaProveedorSucursal.findFirstOrThrow({ where: { facturaProveedorId: facturaId } });
    const saldo = await calcularSaldoTotal(harina, sec3, prisma);
    // La anulación siempre llega a anular (no hay nada que se lo impida: el stock entra intacto o no entra).
    expect(a.ok, a.mensaje).toBe(true);
    expect(factura.anuladaEn).not.toBeNull();
    // Sin estados a medias: el stock vivo es siempre cero (anulada), y una compra existe SOLO si la parte quedó RECIBIDA con ella.
    expect(saldo).toBe(0);
    if (c.ok) {
      // Orden 1: se confirmó y la anulación revirtió lo que entró.
      expect([parte.estadoRecepcion, Boolean(parte.operacionId)]).toEqual(["RECIBIDA", true]);
      expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(1);
    } else {
      // Orden 2: se anuló primero y la confirmación falló sin dejar nada.
      expect(c).toMatchObject({ codigo: "YA_ANULADA" });
      expect([parte.estadoRecepcion, parte.operacionId]).toEqual(["PENDIENTE", null]);
      expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(0);
      expect(await prisma.operacion.count({ where: { proceso: "AJUSTE" } })).toBe(0);
      expect(await prisma.movimientoStock.count()).toBe(0);
    }
  });
});
