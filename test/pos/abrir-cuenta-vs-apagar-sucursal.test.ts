import { beforeEach, describe, expect, it } from "vitest";
import type { Transaccion } from "../../src/lib/db-tipos";
import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { abrirCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/abrir-cuenta";
import { actualizarActivoSucursalCasoDeUso } from "../../src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal";

/**
 * P15 (decisión del dueño, 2026-10-11): una sucursal con mesas abiertas no se apaga, y una sucursal apagada no abre mesas. El apagado (`actualizarActivoSucursalCasoDeUso`) LEE las cuentas sin cerrar de la sucursal y
 * ESCRIBE `Sucursal.activo`; la apertura (`abrirCuentaCasoDeUso`) LEE la fila de la sucursal (su `activo`) y ESCRIBE una cuenta. Las dos corren en una transacción SERIALIZABLE: cada una lee lo que la otra escribe, así que
 * Postgres ve el ciclo y aborta una de las dos; el reintento (`conTransaccionSerializable`) vuelve a leer y da el rechazo de negocio. Sin la lectura de `activo` en la apertura no hay ciclo (una sola dependencia)
 * y el orden «apagar y después abrir» dejaría una cuenta abierta en una sucursal apagada.
 *
 * Los dos órdenes se arman con DOS transacciones en conexiones distintas del pool y una BARRERA (mismo molde que `test/catalogo/campos-sensibles-concurrencia.test.ts`): la transacción de adentro corre COMPLETA y
 * confirma entre dos lecturas de la de afuera, cuya foto de la base ya está tomada.
 *  - Orden A: abrir lee la mesa y la sucursal (activa); en la barrera, el apagado corre entero y confirma; abrir sigue (ve la sucursal activa en su foto), choca por serialización, reintenta y recibe SUCURSAL_INACTIVA.
 *  - Orden B: el apagado lee las cuentas (ninguna); en la barrera, abrir corre entero y confirma; el apagado sigue (no ve la cuenta en su foto), choca por serialización, reintenta y recibe TIENE_PENDIENTES.
 *
 * Mutación: quitar el chequeo de `activo` de la apertura deja, en el orden A, una cuenta abierta en una sucursal apagada (rojo).
 */
describe("abrir una mesa contra apagar la sucursal (P15)", () => {
  let centralId: string; // la sucursal del que apaga
  let norteId: string; // la sucursal que se apaga y donde se abre la mesa
  let usuarioId: string;
  let mesaId: string;

  /** Un `Transaccion` que, tras la PRIMERA llamada a `tabla.metodo` dentro de la transacción, espera a `entre` (la barrera: la otra operación corre completa y confirma en otra conexión). */
  function transaccionConBarrera(tabla: "mesa" | "cuenta", metodo: "findFirst" | "findMany", entre: () => Promise<void>) {
    const estado = { disparada: false };
    const transaccion: Transaccion = (async (fn: Parameters<Transaccion>[0], opciones?: Parameters<Transaccion>[1]) =>
      baseDeTest.transaccion(async (tx) => {
        const delegado = (tx as unknown as Record<string, Record<string, unknown>>)[tabla]!;
        const delegadoConBarrera = new Proxy(delegado, {
          get(objetivo, propiedad) {
            const valor = objetivo[propiedad as string];
            if (propiedad === metodo && typeof valor === "function") {
              return async (...argumentos: unknown[]) => {
                const leido = await (valor as (...a: unknown[]) => Promise<unknown>).apply(objetivo, argumentos);
                if (!estado.disparada) {
                  estado.disparada = true;
                  await entre();
                }
                return leido;
              };
            }
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        const txConBarrera = new Proxy(tx, {
          get(objetivo, propiedad) {
            if (propiedad === tabla) return delegadoConBarrera;
            const valor = (objetivo as unknown as Record<string | symbol, unknown>)[propiedad];
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        return fn(txConBarrera);
      }, opciones)) as Transaccion;
    return { transaccion, estado };
  }

  const abrir = (transaccion: Transaccion) => abrirCuentaCasoDeUso({ usuarioId, sucursalId: norteId, transaccion }, { mesaId, comensales: 2 });
  const apagar = (transaccion: Transaccion) => actualizarActivoSucursalCasoDeUso({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: centralId, transaccion }, { sucursalId: norteId, activo: false });
  const activo = async () => (await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: norteId } })).activo;
  const cuentasAbiertas = () => prismaAdmin.cuenta.count({ where: { cerradaEn: null, mesa: { sucursalId: norteId } } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: centralId, rolId: base.admin.id })).id;
    mesaId = (await prisma.mesa.create({ data: { sucursalId: norteId, numero: 1 } })).id;
  });

  describe("sin carrera", () => {
    it("abrir una mesa de una sucursal apagada: SUCURSAL_INACTIVA con el mensaje exacto, y no queda ninguna cuenta", async () => {
      await prisma.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      expect(await abrir(baseDeTest.transaccion)).toEqual({ ok: false, codigo: "SUCURSAL_INACTIVA", mensaje: "La sucursal «Norte» está desactivada: no se pueden abrir mesas." });
      expect(await prismaAdmin.cuenta.count({ where: { mesaId } })).toBe(0);
    });

    it("reabrir una mesa que YA tenía su cuenta abierta sigue siendo ok aunque la sucursal esté apagada (idempotencia por estado, primero)", async () => {
      const cuenta = await prisma.cuenta.create({ data: { mesaId, abiertaPorId: usuarioId, comensales: 2 } });
      await prisma.sucursal.update({ where: { id: norteId }, data: { activo: false } });
      expect(await abrir(baseDeTest.transaccion)).toMatchObject({ ok: true, mensaje: "La mesa 1 ya tenía una cuenta abierta." });
      expect(await prismaAdmin.cuenta.count({ where: { mesaId } })).toBe(1);
      expect((await prismaAdmin.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
    });

    it("control: con la sucursal activa la mesa se abre", async () => {
      expect(await abrir(baseDeTest.transaccion)).toMatchObject({ ok: true, mensaje: "Cuenta de la mesa 1 abierta." });
      expect(await cuentasAbiertas()).toBe(1);
    });
  });

  describe("con carrera (dos transacciones y una barrera)", () => {
    it("orden A: el apagado confirma entre la lectura y la escritura de abrir → abrir reintenta y recibe SUCURSAL_INACTIVA; la sucursal queda apagada y sin cuentas abiertas", async () => {
      let apagado: Awaited<ReturnType<typeof apagar>> | undefined;
      const { transaccion, estado } = transaccionConBarrera("mesa", "findFirst", async () => {
        apagado = await apagar(baseDeTest.transaccion);
      });

      const apertura = await abrir(transaccion);

      expect(estado.disparada).toBe(true);
      expect(apagado, "el apagado corrió entero dentro de la barrera").toMatchObject({ ok: true });
      expect(apertura).toMatchObject({ ok: false, codigo: "SUCURSAL_INACTIVA" });
      expect(await activo()).toBe(false);
      expect(await cuentasAbiertas()).toBe(0);
    });

    it("orden B: abrir confirma entre la lectura y la escritura del apagado → el apagado reintenta y recibe TIENE_PENDIENTES; la sucursal queda activa con su cuenta abierta", async () => {
      let apertura: Awaited<ReturnType<typeof abrir>> | undefined;
      const { transaccion, estado } = transaccionConBarrera("cuenta", "findMany", async () => {
        apertura = await abrir(baseDeTest.transaccion);
      });

      const apagado = await apagar(transaccion);

      expect(estado.disparada).toBe(true);
      expect(apertura, "la apertura corrió entera dentro de la barrera").toMatchObject({ ok: true });
      expect(apagado).toMatchObject({ ok: false, codigo: "TIENE_PENDIENTES" });
      expect(apagado.mensaje).toContain("cerrá o liberá la mesa 1");
      expect(await activo()).toBe(true);
      expect(await cuentasAbiertas()).toBe(1);
    });
  });
});
