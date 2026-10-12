import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

// Carrera perdida de verdad: el perdedor de dos pedidos con la MISMA clave no siempre recibe el 40001, a veces recibe directo el 23505 del índice único. `choque.pendientes` hace que el
// PRIMER intento de la próxima transacción serializable falle así, sin llegar a correr (mismo molde que `test/auditoria/idempotencia-i3-mecanismo.test.ts`). Con 0 (lo normal) todo pasa derecho.
const choque = vi.hoisted(() => ({ pendientes: 0 }));
vi.mock("../../src/lib/transaccion-serializable", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/transaccion-serializable")>();
  return {
    ...real,
    conTransaccionSerializable: ((transaccion: Parameters<typeof real.conTransaccionSerializable>[0], ...resto: unknown[]) =>
      (real.conTransaccionSerializable as (...args: unknown[]) => unknown)(
        (async (fn: unknown, opciones: unknown) => {
          if (choque.pendientes > 0) {
            choque.pendientes--;
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.10.0" });
          }
          return (transaccion as (f: unknown, o: unknown) => unknown)(fn, opciones);
        }) as unknown,
        ...resto
      )) as typeof real.conTransaccionSerializable,
  };
});

import { EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems, enviarACocina, quitarItemSinEnviar } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { guardComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.guard";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "../../src/core/movimientos/public-servidor";

/**
 * P3 (Paquete 1) — idempotencia I3 de `agregarItems` (pedido del salón). La pantalla manda una clave (UUID) y el servidor guarda UN comprobante por pedido agregado
 * (`AgregadoDeCuenta`: clave, huella del pedido y mensaje devuelto) en la MISMA transacción que los ítems. Un reintento con la misma clave y la misma huella devuelve el mensaje
 * original sin escribir nada; con otra huella, el conflicto de idempotencia. La clave es OPCIONAL (igual que compras, mermas y ventas): sin ella el comportamiento es el de siempre.
 *
 * Qué protege: el reintento del MISMO envío (corte de red, doble envío). Qué NO protege: dos pestañas con dos pedidos distintos (dos claves = dos intenciones).
 */
const CLAVE = "11111111-1111-4111-8111-111111111111";
const CLAVE_B = "22222222-2222-4222-8222-222222222222";
const MENSAJE_UN_ITEM = "Se agregó 1 ítem a la mesa 4.";

describe("agregarItems con clave de idempotencia (P3, I3)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuentaId: string;

  beforeEach(async () => {
    choque.pendientes = 0;
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
  });

  const itemsDeLaCuenta = () => prisma.cuentaItem.findMany({ where: { cuentaId }, orderBy: { creadoEn: "asc" } });

  describe("el mismo envío dos veces", () => {
    it("la segunda devuelve el mensaje original y no agrega nada: un ítem y un comprobante con la clave, la huella, el mensaje y quién lo pidió", async () => {
      const una = await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE);
      const otra = await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE);
      expect(una).toEqual({ ok: true, mensaje: MENSAJE_UN_ITEM });
      expect(otra).toEqual({ ok: true, mensaje: MENSAJE_UN_ITEM });
      expect((await itemsDeLaCuenta()).map((i) => [i.productoId, Number(i.cantidad)])).toEqual([[s.milanesa.id, 1]]);
      const comprobantes = await prisma.agregadoDeCuenta.findMany();
      expect(comprobantes).toHaveLength(1);
      expect(comprobantes[0]).toMatchObject({ cuentaId, claveIdempotencia: CLAVE, resultadoMensaje: MENSAJE_UN_ITEM, creadoPorId: s.admin.id });
      expect(comprobantes[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("con una promo: el reintento no repite la promo ni sus componentes y devuelve el mensaje con el título", async () => {
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
      const menu = [
        {
          promoCartaId: promo.id,
          elecciones: [
            { seccionCartaId: platos.id, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] },
            { seccionCartaId: postres.id, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] },
          ],
        },
      ];
      const una = await agregarItems(cuentaId, [], menu, CLAVE);
      const otra = await agregarItems(cuentaId, [], menu, CLAVE);
      expect(una).toEqual({ ok: true, mensaje: "Se agregaron 2 ítems a la mesa 4. Incluye «Menú del día»." });
      expect(otra).toEqual(una);
      expect(await itemsDeLaCuenta()).toHaveLength(2);
      expect(await prisma.promoCuenta.count({ where: { cuentaId } })).toBe(1);
      expect(await prisma.agregadoDeCuenta.count()).toBe(1);
    });

    it("quitar el ítem y reintentar NO lo vuelve a agregar (el comprobante vive aparte de las filas, por eso es una tabla propia)", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      const [item] = await itemsDeLaCuenta();
      expect((await quitarItemSinEnviar(item.id)).ok).toBe(true);
      expect(await itemsDeLaCuenta()).toEqual([]);

      expect(await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).toEqual({ ok: true, mensaje: MENSAJE_UN_ITEM });
      expect(await itemsDeLaCuenta()).toEqual([]);
    });

    it("con la mesa YA CERRADA el reintento devuelve el mensaje original (no «ya está cerrada»); sin clave sí rechaza", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      const [item] = await itemsDeLaCuenta();
      expect((await enviarACocina(cuentaId, [item.id])).ok).toBe(true);
      expect((await cerrarCuenta(cuentaId)).ok).toBe(true);

      expect(await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).toEqual({ ok: true, mensaje: MENSAJE_UN_ITEM });
      expect(await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }])).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });
      expect(await itemsDeLaCuenta()).toHaveLength(1);
    });
  });

  describe("la misma clave con otro pedido: conflicto", () => {
    it("otro producto: MENSAJE_CONFLICTO_IDEMPOTENCIA y nada se agrega", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      expect(await agregarItems(cuentaId, [{ productoId: s.flan.id, cantidad: 1 }], [], CLAVE)).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
      expect(await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 2 }], [], CLAVE)).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
      expect((await itemsDeLaCuenta()).map((i) => i.productoId)).toEqual([s.milanesa.id]);
      expect(await prisma.agregadoDeCuenta.count()).toBe(1);
    });

    it("la misma clave sobre OTRA cuenta de la sucursal también es un conflicto (la huella lleva la cuenta)", async () => {
      const otraMesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
      const otraCuenta = await sembrarCuenta(otraMesa.id, s.admin.id);
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      expect(await agregarItems(otraCuenta.id, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
      expect(await prisma.cuentaItem.count({ where: { cuentaId: otraCuenta.id } })).toBe(0);
    });
  });

  describe("sin clave (opcional): el comportamiento de siempre", () => {
    it("no escribe ningún comprobante, no lee la tabla y dos llamadas iguales siguen duplicando (no hay forma de saber que son el mismo envío)", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }])).ok).toBe(true);
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [])).ok).toBe(true);
      expect(await itemsDeLaCuenta()).toHaveLength(2);
      expect(await prisma.agregadoDeCuenta.count()).toBe(0);
    });

    it("dos claves distintas con el mismo contenido son dos intenciones: se agregan los dos (lo que NO protege la clave: dos pestañas)", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE_B)).ok).toBe(true);
      expect(await itemsDeLaCuenta()).toHaveLength(2);
      expect(await prisma.agregadoDeCuenta.count()).toBe(2);
    });
  });

  describe("un rechazo no deja comprobante", () => {
    it("un producto inválido con clave: rechaza, no agrega nada y NO consume la clave (se puede corregir y reenviar con la misma)", async () => {
      const r = await agregarItems(cuentaId, [{ productoId: s.muzzarella.id, cantidad: 1 }], [], CLAVE);
      expect(r).toEqual({ ok: false, mensaje: "«Muzzarella» no se puede pedir: solo se piden productos de venta (PV)." });
      expect(await prisma.agregadoDeCuenta.count()).toBe(0);
      expect(await itemsDeLaCuenta()).toEqual([]);
      expect(await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).toEqual({ ok: true, mensaje: MENSAJE_UN_ITEM });
    });
  });

  describe("aislamiento: una clave ajena nunca filtra datos ni deja escribir a medias", () => {
    /** Un comprobante con `CLAVE` en OTRA empresa (con su sucursal, mesa y cuenta): la unicidad de la clave es global, la política de empresa lo oculta. */
    async function comprobanteDeOtraEmpresa(mensaje: string) {
      const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Sucursal ajena" } });
      const mesaAjena = await prismaAdmin.mesa.create({ data: { empresaId: EMPRESA_TESTIGO_ID, sucursalId: sucursalAjena.id, numero: 1 } });
      const cuentaAjena = await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA_TESTIGO_ID, mesaId: mesaAjena.id, abiertaPorId: s.admin.id } });
      await prismaAdmin.agregadoDeCuenta.create({
        data: { empresaId: EMPRESA_TESTIGO_ID, cuentaId: cuentaAjena.id, claveIdempotencia: CLAVE, payloadHash: "huella-ajena", resultadoMensaje: mensaje, creadoPorId: s.admin.id },
      });
    }

    it("la clave de OTRA empresa: el pedido propio no se escribe (todo o nada), la respuesta es el conflicto y no aparece el mensaje ajeno", async () => {
      await comprobanteDeOtraEmpresa("MENSAJE-SECRETO-DE-OTRA-EMPRESA");
      const r = await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE);
      expect(r).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
      expect(JSON.stringify(r)).not.toContain("SECRETO");
      expect(await itemsDeLaCuenta(), "el comprobante falló al final y se deshizo todo: ni siquiera los ítems").toEqual([]);
      expect(await prisma.agregadoDeCuenta.count(), "la política de empresa oculta el comprobante ajeno").toBe(0);
    });

    it("la clave de OTRA sucursal de la misma empresa: conflicto, sin mostrar su mensaje ni escribir en esta cuenta", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 9 } });
      const cuentaNorte = await sembrarCuenta(mesaNorte.id, s.admin.id);
      await prisma.agregadoDeCuenta.create({ data: { cuentaId: cuentaNorte.id, claveIdempotencia: CLAVE, payloadHash: "huella-de-norte", resultadoMensaje: "MENSAJE-DE-NORTE", creadoPorId: s.admin.id } });

      const r = await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE);
      expect(r).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
      expect(await itemsDeLaCuenta()).toEqual([]);
    });
  });

  describe("el perdedor de la carrera recibe el choque de unicidad (23505)", () => {
    it("con la MISMA huella: devuelve el mensaje del ganador (no un error genérico) y no escribe nada", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      choque.pendientes = 1;
      const r = await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE);
      expect(choque.pendientes, "el choque se consumió").toBe(0);
      expect(r).toEqual({ ok: true, mensaje: MENSAJE_UN_ITEM });
      expect(await itemsDeLaCuenta()).toHaveLength(1);
    });

    it("con OTRA huella: el conflicto de idempotencia", async () => {
      expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
      choque.pendientes = 1;
      expect(await agregarItems(cuentaId, [{ productoId: s.flan.id, cantidad: 1 }], [], CLAVE)).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
      expect(await itemsDeLaCuenta()).toHaveLength(1);
    });

    it("con un ganador INVISIBLE (otra empresa): el conflicto, nunca su mensaje ni un error crudo", async () => {
      const sucursalAjena = await prismaAdmin.sucursal.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "Sucursal ajena" } });
      const mesaAjena = await prismaAdmin.mesa.create({ data: { empresaId: EMPRESA_TESTIGO_ID, sucursalId: sucursalAjena.id, numero: 1 } });
      const cuentaAjena = await prismaAdmin.cuenta.create({ data: { empresaId: EMPRESA_TESTIGO_ID, mesaId: mesaAjena.id, abiertaPorId: s.admin.id } });
      await prismaAdmin.agregadoDeCuenta.create({
        data: { empresaId: EMPRESA_TESTIGO_ID, cuentaId: cuentaAjena.id, claveIdempotencia: CLAVE, payloadHash: "huella-ajena", resultadoMensaje: "MENSAJE-SECRETO", creadoPorId: s.admin.id },
      });
      choque.pendientes = 1;
      const r = await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE);
      expect(r).toEqual({ ok: false, mensaje: MENSAJE_CONFLICTO_IDEMPOTENCIA });
    });

    it("sin clave un choque de unicidad NO se disfraza: se relanza (falla cerrado)", async () => {
      choque.pendientes = 1;
      await expect(agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }])).rejects.toThrow();
    });
  });
});

describe("guardComandoAgregarItems con clave de idempotencia", () => {
  const base = { cuentaId: "c1", items: [{ productoId: "p1", cantidad: 1 }], promos: [] };

  it("sin clave: el comando no trae ninguna; con una clave válida: la trae tal cual", () => {
    const sin = guardComandoAgregarItems(base);
    expect(sin.ok && "claveIdempotencia" in sin.valor).toBe(false);
    const con = guardComandoAgregarItems({ ...base, claveIdempotencia: CLAVE });
    expect(con.ok && con.valor.claveIdempotencia).toBe(CLAVE);
  });

  it("una clave que no es un UUID se rechaza con el mensaje de las demás acciones", () => {
    for (const mala of ["abc", "", 7, null, {}]) {
      expect(guardComandoAgregarItems({ ...base, claveIdempotencia: mala }), String(mala)).toMatchObject({ ok: false, mensaje: "Clave de reintento inválida." });
    }
  });

  it("el chequeo de la clave va AL FINAL: con dos fallas gana el mensaje de siempre (lista vacía, tope, cuenta inválida)", () => {
    expect(guardComandoAgregarItems({ cuentaId: "c1", items: [], promos: [], claveIdempotencia: "mala" })).toMatchObject({ ok: false, mensaje: "Elegí al menos un producto." });
    expect(guardComandoAgregarItems({ cuentaId: 9, items: [{ productoId: "p1", cantidad: 1 }], promos: [], claveIdempotencia: "mala" })).toMatchObject({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });
  });
});
