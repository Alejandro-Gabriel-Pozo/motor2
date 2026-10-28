import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * E1 del circuito de abastecimiento (docs/diseno-idempotencia-obligatoria-movimientos-2026-10-27.md): la clave de reintento de
 * `registrarMovimiento` es OBLIGATORIA. Sin clave ⇒ rechazo y cero filas; la misma clave enviada 8 veces a la vez ⇒ una sola
 * `Operacion` (compra sin proveedor, consumo, merma y ajuste); misma clave con otro contenido ⇒ conflicto explícito; una clave que ya
 * usó OTRA empresa ⇒ conflicto, sin filas nuevas y sin su mensaje; reintento después de un éxito ⇒ el mensaje original, sin duplicar.
 * Cada caso se probó con una mutación del código (ver el documento de diseño, §11).
 */

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento, type DatosMovimientoInput } from "../../src/server/actions/movimientos/movimientos";
import { guardComandoRegistrarMovimiento } from "../../src/core/features/movimientos/movimiento.guard";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/public-servidor";

const MENSAJE_SIN_CLAVE = "Falta la clave de reintento: recargá la pantalla.";

describe("guardComandoRegistrarMovimiento — la clave de reintento es obligatoria", () => {
  const base = { proceso: "COMPRA", fecha: new Date(), seccionId: "s1", items: [{ productoId: "p1", cantidad: 1 }] };
  const ahora = new Date();

  it("ausente, nula o vacía: rechazo «vacio» con el texto del pago al consignante", () => {
    for (const entrada of [base, { ...base, claveIdempotencia: undefined }, { ...base, claveIdempotencia: null }, { ...base, claveIdempotencia: "" }]) {
      expect(guardComandoRegistrarMovimiento(entrada, ahora)).toEqual({ ok: false, codigo: "vacio", mensaje: MENSAJE_SIN_CLAVE });
    }
  });

  it("presente pero no es un UUID: rechazo «formato»; con un UUID pasa", () => {
    for (const mala of ["abc", 7, {}, "   "]) {
      expect(guardComandoRegistrarMovimiento({ ...base, claveIdempotencia: mala }, ahora)).toEqual({ ok: false, codigo: "formato", mensaje: "Clave de reintento inválida." });
    }
    expect(guardComandoRegistrarMovimiento({ ...base, claveIdempotencia: crypto.randomUUID() }, ahora).ok).toBe(true);
  });
});

describe("registrarMovimiento — clave de reintento obligatoria (con base)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let usuarioId: string;
  let motivoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const sembrada = await sembrarBase();
    sucursalId = sembrada.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    motivoId = (await sembrarMotivosYDestinos()).motivos.get("Vencido")!;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: sembrada.admin.id });
    usuarioId = admin.id;
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function crearMP(nombre: string) {
    const mp = await prisma.producto.create({ data: { codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: mp.id, disponible: true } });
    return mp;
  }

  async function comprar(productoId: string, cantidad: number) {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId, cantidad }], claveIdempotencia: crypto.randomUUID() });
    expect(r.ok, r.mensaje).toBe(true);
  }

  async function saldo(productoId: string) {
    const suma = await prisma.movimientoStock.aggregate({ where: { productoId, seccionId }, _sum: { cantidad: true } });
    return Number(suma._sum.cantidad ?? 0);
  }

  it("sin clave (ausente, nula o vacía): rechazo con mensaje claro y CERO filas en Operacion y MovimientoStock, en los 4 procesos", async () => {
    const mp = await crearMP("SinClave");
    const pedidos = [
      { proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 1000 }] },
      { proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 1 }] },
      { proceso: "MERMA", fecha: new Date(), seccionId, motivoId, items: [{ productoId: mp.id, cantidad: 1 }] },
      { proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }] },
    ];
    for (const pedido of pedidos) {
      for (const clave of [{}, { claveIdempotencia: null }, { claveIdempotencia: "" }]) {
        const r = await registrarMovimiento({ ...pedido, ...clave } as unknown as DatosMovimientoInput);
        expect(r, `${pedido.proceso} ${JSON.stringify(clave)}`).toEqual({ ok: false, mensaje: MENSAJE_SIN_CLAVE });
      }
    }
    expect(await prisma.operacion.count()).toBe(0);
    expect(await prisma.movimientoStock.count()).toBe(0);
  });

  describe("8 envíos simultáneos con la MISMA clave ⇒ una sola Operacion", () => {
    async function ochoALaVez(datos: DatosMovimientoInput) {
      const settled = await Promise.allSettled(Array.from({ length: 8 }, () => registrarMovimiento(datos)));
      const rechazados = settled.filter((s) => s.status === "rejected");
      expect(rechazados, "ningún envío termina en un error crudo").toEqual([]);
      const resultados = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof registrarMovimiento>>>).value);
      for (const r of resultados) expect(r.ok, r.mensaje).toBe(true);
      expect(new Set(resultados.map((r) => r.mensaje)).size, "todos reciben el mismo mensaje (el original)").toBe(1);
      expect(await prisma.operacion.count({ where: { claveIdempotencia: datos.claveIdempotencia } })).toBe(1);
      expect(await prisma.operacion.count({ where: { sucursalId, proceso: datos.proceso } }), `una sola ${datos.proceso}`).toBe(1);
    }

    it("compra sin proveedor", async () => {
      const mp = await crearMP("CompraSimultanea");
      await ochoALaVez({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 1500 }], claveIdempotencia: crypto.randomUUID() });
      expect(await saldo(mp.id)).toBe(10);
    });

    it("consumo", async () => {
      const mp = await crearMP("ConsumoSimultaneo");
      await comprar(mp.id, 100);
      await ochoALaVez({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 7 }], claveIdempotencia: crypto.randomUUID() });
      expect(await saldo(mp.id)).toBe(93);
    });

    it("merma", async () => {
      const mp = await crearMP("MermaSimultanea");
      await comprar(mp.id, 100);
      await ochoALaVez({ proceso: "MERMA", fecha: new Date(), seccionId, motivoId, items: [{ productoId: mp.id, cantidad: 3 }], claveIdempotencia: crypto.randomUUID() });
      expect(await saldo(mp.id)).toBe(97);
    });

    it("ajuste", async () => {
      const mp = await crearMP("AjusteSimultaneo");
      await comprar(mp.id, 100);
      await ochoALaVez({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: -4 }], claveIdempotencia: crypto.randomUUID() });
      expect(await saldo(mp.id)).toBe(96);
    });
  });

  it("misma clave con contenido distinto: rechazo explícito (conflicto), nunca el resultado del otro pedido; nada nuevo en la base", async () => {
    const mp = await crearMP("Conflicto");
    const clave = crypto.randomUUID();
    const r1 = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 1000 }], claveIdempotencia: clave });
    expect(r1.ok, r1.mensaje).toBe(true);

    const otroContenido: DatosMovimientoInput[] = [
      { proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, precioTotal: 9999 }], claveIdempotencia: clave },
      { proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 11, precioTotal: 1000 }], claveIdempotencia: clave },
      { proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: clave },
    ];
    for (const datos of otroContenido) {
      expect(await registrarMovimiento(datos)).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    }
    expect(await prisma.operacion.count()).toBe(1);
    expect(await saldo(mp.id)).toBe(10);
  });

  it("una clave que ya usó OTRA empresa: conflicto, ninguna fila nueva, sin el mensaje ajeno ni un error crudo; la operación ajena queda intacta", async () => {
    const mp = await crearMP("ClaveAjena");
    const clave = crypto.randomUUID();
    const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Sucursal ajena" } });
    const ajena = await prismaAdmin.operacion.create({
      data: { empresaId: EMPRESA_TESTIGO_ID, sucursalId: sucursalAjena.id, proceso: "COMPRA", fecha: new Date(), usuarioId, claveIdempotencia: clave, payloadHash: "huella-ajena", resultadoMensaje: "MENSAJE-SECRETO-DE-OTRA-EMPRESA" },
    });

    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: clave });
    expect(r).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });

    expect(await prisma.operacion.count({ where: { sucursalId } })).toBe(0);
    expect(await prisma.movimientoStock.count({ where: { productoId: mp.id } })).toBe(0);
    expect(await prismaAdmin.operacion.findUniqueOrThrow({ where: { id: ajena.id }, select: { sucursalId: true, payloadHash: true, resultadoMensaje: true } })).toEqual({
      sucursalId: sucursalAjena.id,
      payloadHash: "huella-ajena",
      resultadoMensaje: "MENSAJE-SECRETO-DE-OTRA-EMPRESA",
    });
  });

  it("reintento después de un éxito (la respuesta se perdió): devuelve el mensaje original y no duplica stock", async () => {
    const mp = await crearMP("Reintento");
    await comprar(mp.id, 50);
    const datos: DatosMovimientoInput = { proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 5 }], claveIdempotencia: crypto.randomUUID() };
    const primero = await registrarMovimiento(datos);
    expect(primero.ok, primero.mensaje).toBe(true);
    for (let i = 0; i < 3; i++) {
      const otra = await registrarMovimiento(datos);
      expect(otra).toEqual(primero);
    }
    expect(await prisma.operacion.count({ where: { sucursalId, proceso: "CONSUMO" } })).toBe(1);
    expect(await saldo(mp.id)).toBe(45);
  });
});
