import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { DIA_MS, enElPasado } from "../setup/tiempo";

/**
 * P17 (decisión del dueño, 2026-10-11) CON base de datos: una sección dada de baja solo admite sacar mercadería hasta vaciarla. La tabla de procesos con los mensajes exactos está
 * en `seccion-desactivada.test.ts` (sin base); acá, lo que necesita la base real: vaciar la sección por su saldo exacto y la idempotencia I3 después de la baja.
 */
describe("P17: sección dada de baja, contra la base", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDestinoId: string;
  let productoId: string;
  let motivoId: string;
  // Un día de calendario ya pasado (la fecha de una operación no puede ser de hace más de 400 días: una fecha absoluta se vencería sola, ver test/setup/tiempo.ts).
  const FECHA = enElPasado(2 * DIA_MS);
  const MENSAJE = 'La sección «Depósito A» está desactivada: solo se puede sacar mercadería de ella (transferir, mermar o consumir) hasta vaciarla. Elegí otra sección o activala.';

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    const { motivos } = await sembrarMotivosYDestinos();
    motivoId = motivos.get("Vencido")!;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito A")).id;
    seccionDestinoId = (await sembrarSeccion(sucursalId, "Depósito B")).id;
    productoId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id }, sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  const darDeBaja = () => prisma.seccion.update({ where: { id: seccionId }, data: { activa: false } });

  it("vaciar: la merma por el saldo EXACTO de la sección dada de baja da ok y deja saldo 0; una salida más da el «Stock insuficiente» de siempre", async () => {
    expect((await registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId, cantidad: 10 }], claveIdempotencia: crypto.randomUUID() })).ok).toBe(true);
    await darDeBaja();

    const vaciar = await registrarMovimiento({ proceso: "MERMA", fecha: FECHA, seccionId, motivoId, items: [{ productoId, cantidad: 10 }], claveIdempotencia: crypto.randomUUID() });
    expect(vaciar.ok, vaciar.mensaje).toBe(true);
    expect(await calcularSaldoTotal(productoId, seccionId, prisma)).toBe(0);

    const deMas = await registrarMovimiento({ proceso: "MERMA", fecha: FECHA, seccionId, motivoId, items: [{ productoId, cantidad: 1 }], claveIdempotencia: crypto.randomUUID() });
    expect(deMas).toMatchObject({ ok: false });
    expect(deMas.mensaje).toContain('Stock insuficiente para "Harina". Actual: 0, requerido: 1.');
  });

  it("sacar por transferencia a una sección activa se permite; ingresar a la dada de baja (compra o transferencia) se rechaza con el texto único y no escribe nada", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId, cantidad: 10 }], claveIdempotencia: crypto.randomUUID() });
    await darDeBaja();

    const sacar = await registrarMovimiento({ proceso: "TRANSFERENCIA", fecha: FECHA, seccionId, seccionDestinoId, items: [{ productoId, cantidad: 4 }], claveIdempotencia: crypto.randomUUID() });
    expect(sacar.ok, sacar.mensaje).toBe(true);
    expect(await calcularSaldoTotal(productoId, seccionId, prisma)).toBe(6);
    expect(await calcularSaldoTotal(productoId, seccionDestinoId, prisma)).toBe(4);

    const operaciones = await prisma.operacion.count();
    const compra = await registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId, cantidad: 5 }], claveIdempotencia: crypto.randomUUID() });
    expect(compra).toEqual({ ok: false, mensaje: MENSAJE });
    const devolver = await registrarMovimiento({ proceso: "TRANSFERENCIA", fecha: FECHA, seccionId: seccionDestinoId, seccionDestinoId: seccionId, items: [{ productoId, cantidad: 1 }], claveIdempotencia: crypto.randomUUID() });
    expect(devolver).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await prisma.operacion.count()).toBe(operaciones);
    expect(await calcularSaldoTotal(productoId, seccionId, prisma)).toBe(6);
  });

  it("I3 después de la baja: reintentar con la MISMA clave una compra ya escrita da la respuesta original (no un rechazo), sin una segunda operación ni saldo duplicado", async () => {
    const clave = "9b2e7c1a-5f3d-4a6e-8c0b-1d2e3f4a5b6c";
    const original = await registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId, cantidad: 10 }], claveIdempotencia: clave });
    expect(original.ok, original.mensaje).toBe(true);
    await darDeBaja();

    const reintento = await registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId, cantidad: 10 }], claveIdempotencia: clave });
    expect(reintento).toEqual({ ok: true, mensaje: original.mensaje });
    expect(await prisma.operacion.count({ where: { proceso: "COMPRA" } })).toBe(1);
    expect(await calcularSaldoTotal(productoId, seccionId, prisma)).toBe(10);

    // Una compra NUEVA (otra clave) sí se rechaza.
    const otra = await registrarMovimiento({ proceso: "COMPRA", fecha: FECHA, seccionId, items: [{ productoId, cantidad: 10 }], claveIdempotencia: "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d" });
    expect(otra).toEqual({ ok: false, mensaje: MENSAJE });
  });
});
