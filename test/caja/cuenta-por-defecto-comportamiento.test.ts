import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { calcularPayloadHash } from "../../src/core/movimientos/public-servidor";
import { azarDelProceso } from "../../src/lib/azar";
import { cerrarSesionCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cerrar-sesion";
import { desactivarCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/cambiar-estado-de-cuenta-de-cobro";
import { crearCuentaDeCobroCasoDeUso } from "../../src/server/actions/caja/casos-de-uso/crear-cuenta-de-cobro";
import { iniciarCierreDeSesion } from "../../src/server/actions/caja/casos-de-uso/iniciar-cierre";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { c, crearApoyo, cuentasEscritas, type Salon } from "./apoyo-cuenta-por-defecto";
import { quitarIndiceDeUnaActiva, restituirIndiceDeUnaActiva } from "./indice-una-activa";

/**
 * Etapa P-C3 contra Postgres real: lo que el oráculo exhaustivo (`cuenta-por-defecto-oraculo.test.ts`) no dice. (c) NO SE PIERDE EL COBRO: con 2 o más compatibles el rechazo no escribe nada y el reintento con la MISMA clave y una
 * cuenta elegida lo registra; (d) concurrencia con carreras de verdad; (e) idempotencia: misma clave → `yaExistia` con la MISMA cuenta aunque cambien las cuentas activas; (f) la auditoría cuenta las asignadas; (g) los
 * cobros anteriores sin cuenta no se tocan; y el arqueo agrupa por la cuenta asignada.
 *
 * MUTACIONES (rojo/verde, hechas a mano sobre el código, ver la sección «Construido» del diseño):
 *   - hacer que la HUELLA incluya la cuenta resuelta → rojo «(e) la repetición con la misma clave…» (la segunda vez ve otra huella: `CLAVE_REUTILIZADA` en vez de `yaExistia`);
 *   - hacer que el rechazo `CUENTA_DE_COBRO_A_ELEGIR` deje escrita la cobranza con su clave → rojo «(c) con dos compatibles…» (cobranzas ≠ 0 y el reintento devuelve `CLAVE_REUTILIZADA`/`yaExistia` sin cuenta);
 *   - quitar el filtro de compatibilidad / quitar el filtro «activa» / asignar con 2 o más → rojo el oráculo (ver su encabezado).
 */
let s: Salon;
let ap: ReturnType<typeof crearApoyo>;

beforeAll(restituirIndiceDeUnaActiva);
afterAll(restituirIndiceDeUnaActiva);

beforeEach(async () => {
  await restituirIndiceDeUnaActiva();
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  ap = crearApoyo(s);
});

const renglonSinCuenta = (medioDePagoId: string, importe = 3000_00) => ({ medioDePagoId, importeEnCentavos: c(importe) });

describe("(c) no se pierde el cobro", () => {
  it("con dos compatibles el rechazo no escribe nada y el reintento con la MISMA clave y una cuenta elegida registra el cobro", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    await quitarIndiceDeUnaActiva();
    try {
      const posnet1 = await ap.cuentaDirecta("TERMINAL");
      const posnet2 = await ap.cuentaDirecta("TERMINAL");
      const cuenta = await ap.cuentaCerrada();
      const clave = randomUUID();
      const antes = { cobranzas: await prismaAdmin.cobranza.count(), movimientos: await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } }), cobros: await prismaAdmin.cobro.count(), auditoria: await prismaAdmin.registroAuditoria.count() };

      expect(await ap.cobrar(cuenta.id, [renglonSinCuenta(debito)], 3000_00, clave)).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_A_ELEGIR", mensaje: "Hay más de una cuenta de cobro activa para este medio: elegí una." });
      expect({ cobranzas: await prismaAdmin.cobranza.count(), movimientos: await prismaAdmin.movimientoCaja.count({ where: { clase: "COBRO" } }), cobros: await prismaAdmin.cobro.count(), auditoria: await prismaAdmin.registroAuditoria.count() }).toEqual(antes);
      // La clave de reintento NO quedó guardada: ninguna cobranza la tiene.
      expect(await prismaAdmin.cobranza.count({ where: { claveIdempotencia: clave } })).toBe(0);

      // El cajero elige una cuenta y reintenta con la MISMA clave: se registra (ni CLAVE_REUTILIZADA ni yaExistia).
      const reintento = await ap.cobrar(cuenta.id, [{ ...renglonSinCuenta(debito), cuentaDeCobroId: posnet2 }], 3000_00, clave);
      expect(reintento).toMatchObject({ ok: true, datos: { yaExistia: false } });
      expect(await cuentasEscritas(cuenta.id)).toEqual({ enCobro: [posnet2], enMovimiento: [posnet2] });
      expect(await prismaAdmin.cobranza.count({ where: { claveIdempotencia: clave } })).toBe(1);
      expect(posnet1).not.toBe(posnet2);
    } finally {
      await restituirIndiceDeUnaActiva();
    }
  });

  it("con dos compatibles y UN renglón con cuenta y otro sin: rechaza el que no trae y no escribe nada", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const credito = await ap.medio("TARJETA_CREDITO");
    await quitarIndiceDeUnaActiva();
    try {
      const posnet1 = await ap.cuentaDirecta("TERMINAL");
      await ap.cuentaDirecta("TERMINAL");
      const cuenta = await ap.cuentaCerrada();
      const r = await ap.cobrar(cuenta.id, [{ ...renglonSinCuenta(debito, 1000_00), cuentaDeCobroId: posnet1 }, renglonSinCuenta(credito, 2000_00)]);
      expect(r).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_A_ELEGIR" });
      expect(await prismaAdmin.cobranza.count()).toBe(0);
    } finally {
      await restituirIndiceDeUnaActiva();
    }
  });
});

describe("la cuenta única activa se asigna", () => {
  it("un cobro sin cuenta con una sola activa compatible queda en esa cuenta (movimiento, cobro y arqueo) y el efectivo sin cuenta", async () => {
    const a = await ap.abrirCaja();
    if (!a.ok) throw new Error("no abrió");
    const debito = await ap.medio("TARJETA_DEBITO");
    const efectivo = await ap.medio("EFECTIVO");
    const posnet = await ap.cuentaDirecta("TERMINAL");
    const cuenta = await ap.cuentaCerrada();
    const r = await ap.cobrar(cuenta.id, [renglonSinCuenta(debito, 2000_00), renglonSinCuenta(efectivo, 1000_00)]);
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    const cobros = await prismaAdmin.cobro.findMany({ orderBy: { orden: "asc" } });
    expect(cobros).toHaveLength(2);
    expect(cobros.find((x) => x.medioDePagoId === debito)?.cuentaDeCobroId).toBe(posnet);
    expect(cobros.find((x) => x.medioDePagoId === efectivo)?.cuentaDeCobroId).toBeNull();
    const movimientos = await prismaAdmin.movimientoCaja.findMany({ where: { clase: "COBRO" } });
    expect(movimientos.find((m) => m.medioDePagoId === debito)?.cuentaDeCobroId).toBe(posnet);
    expect(movimientos.find((m) => m.medioDePagoId === efectivo)?.cuentaDeCobroId).toBeNull();
    // El arqueo agrupa por la cuenta asignada, igual que si la hubiera elegido el cajero.
    expect((await iniciarCierreDeSesion(ap.actor(), { sesionId: a.datos.sesionId })).ok).toBe(true);
    const cerrado = await cerrarSesionCasoDeUso(ap.actor(), { sesionId: a.datos.sesionId, conteo: { billetes: {}, monedasEnCentavos: c(1000_00) }, conformeDeLosDemasMedios: true, observacion: null }, azarDelProceso);
    expect(cerrado.ok).toBe(true);
    const lineas = await prismaAdmin.arqueoCaja.findMany({ where: { sesionId: a.datos.sesionId, medioDePagoId: debito } });
    expect(lineas.map((l) => [l.cuentaDeCobroId, Number(l.esperado)])).toEqual([[posnet, 2000]]);
  });
});

describe("(e) idempotencia", () => {
  it("la repetición con la misma clave devuelve yaExistia con la MISMA cuenta aunque cambien las cuentas activas", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const posnet = await ap.cuentaDirecta("TERMINAL");
    const cuenta = await ap.cuentaCerrada();
    const clave = randomUUID();
    const primero = await ap.cobrar(cuenta.id, [renglonSinCuenta(debito)], 3000_00, clave);
    expect(primero).toMatchObject({ ok: true, datos: { yaExistia: false } });
    // Entretanto: se desactiva la cuenta y aparecen dos nuevas (con el índice quitado).
    await prismaAdmin.cuentaDeCobro.update({ where: { id: posnet }, data: { activa: false } });
    await quitarIndiceDeUnaActiva();
    try {
      await ap.cuentaDirecta("TERMINAL");
      await ap.cuentaDirecta("TERMINAL");
      const segundo = await ap.cobrar(cuenta.id, [renglonSinCuenta(debito)], 3000_00, clave);
      expect(segundo).toMatchObject({ ok: true, datos: { yaExistia: true, cobranzaId: primero.ok ? primero.datos.cobranzaId : "?" } });
      expect(await cuentasEscritas(cuenta.id)).toEqual({ enCobro: [posnet], enMovimiento: [posnet] });
      expect(await prismaAdmin.cobranza.count()).toBe(1);
    } finally {
      await restituirIndiceDeUnaActiva();
    }
  });

  it("la huella del pedido es la de siempre: no incluye la cuenta resuelta", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    await ap.cuentaDirecta("TERMINAL");
    const cuenta = await ap.cuentaCerrada();
    expect((await ap.cobrar(cuenta.id, [renglonSinCuenta(debito)])).ok).toBe(true);
    // Un renglón sin cuenta ni datos conserva la forma de C1 `[medio, importe]`: la cuenta resuelta no entra a la huella.
    const cobranza = await prismaAdmin.cobranza.findFirstOrThrow();
    expect(cobranza.huella).toBe(calcularPayloadHash("COBRAR_CUENTA", cobranza.empresaId, { cuentaId: cuenta.id, total: "3000.00", renglones: [[debito, "3000.00"]] }));
  });
});

describe("(f) auditoría y (g) lo anterior no se toca", () => {
  it("la auditoría cuenta las cuentas asignadas", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    await ap.cuentaDirecta("TERMINAL");
    const cuenta = await ap.cuentaCerrada();
    expect((await ap.cobrar(cuenta.id, [renglonSinCuenta(debito)])).ok).toBe(true);
    expect(JSON.stringify(await prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Cobranza" } }))).toContain("con cuenta de cobro: 1");
  });

  it("un cobro anterior «sin cuenta» sigue sin cuenta cuando después hay una cuenta activa", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const anterior = await ap.cuentaCerrada();
    expect((await ap.cobrar(anterior.id, [renglonSinCuenta(debito)])).ok).toBe(true);
    expect(await cuentasEscritas(anterior.id)).toEqual({ enCobro: [null], enMovimiento: [null] });
    await ap.cuentaDirecta("TERMINAL");
    const nueva = await ap.cuentaCerrada();
    expect((await ap.cobrar(nueva.id, [renglonSinCuenta(debito)])).ok).toBe(true);
    expect(await cuentasEscritas(anterior.id)).toEqual({ enCobro: [null], enMovimiento: [null] });
    expect((await cuentasEscritas(nueva.id)).enCobro[0]).not.toBeNull();
  });
});

describe("(d) concurrencia (Postgres real, varias vueltas)", () => {
  const VUELTAS = 6;

  it("cobro vs. desactivar la única cuenta: o entra con la cuenta o queda sin cuenta; nunca una inactiva ni un error crudo", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const resultados = new Set<string>();
    for (let i = 0; i < VUELTAS; i++) {
      const posnet = await ap.cuentaDirecta("TERMINAL");
      const cuenta = await ap.cuentaCerrada();
      const [cobro, baja] = await Promise.allSettled([
        ap.cobrar(cuenta.id, [renglonSinCuenta(debito)]),
        desactivarCuentaDeCobroCasoDeUso(ap.actor(), { cuentaDeCobroId: posnet }),
      ]);
      expect(cobro.status, `vuelta ${i}: error crudo en el cobro: ${cobro.status === "rejected" ? String(cobro.reason) : ""}`).toBe("fulfilled");
      expect(baja.status, `vuelta ${i}: error crudo en la baja`).toBe("fulfilled");
      if (cobro.status !== "fulfilled") continue;
      expect(cobro.value, `vuelta ${i}`).toMatchObject({ ok: true });
      const escritas = await cuentasEscritas(cuenta.id);
      expect(escritas.enCobro).toEqual(escritas.enMovimiento);
      const asignada = escritas.enCobro[0] ?? null;
      resultados.add(asignada === null ? "sin cuenta" : "con cuenta");
      // Si quedó asignada, la cuenta era activa en el momento del cobro (la base lo exige: CuentaDeCobro_validar_par); y la baja terminó bien.
      if (asignada !== null) expect(asignada).toBe(posnet);
      expect((await prismaAdmin.cuentaDeCobro.findUniqueOrThrow({ where: { id: posnet } })).activa).toBe(false);
    }
    expect([...resultados].every((x) => x === "sin cuenta" || x === "con cuenta")).toBe(true);
  }, 120_000);

  it("cobro vs. crear otra cuenta: con la regla C3b la creación se rechaza; el cobro siempre sale bien con la cuenta única", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const posnet = await ap.cuentaDirecta("TERMINAL");
    for (let i = 0; i < VUELTAS; i++) {
      const cuenta = await ap.cuentaCerrada();
      const [cobro, alta] = await Promise.allSettled([
        ap.cobrar(cuenta.id, [renglonSinCuenta(debito)]),
        crearCuentaDeCobroCasoDeUso(ap.actor(), { tipo: "TERMINAL", nombre: `Otra ${i}`, identificadorExterno: null, sucursalId: s.sucursalId }, azarDelProceso),
      ]);
      expect(cobro.status, `vuelta ${i}: error crudo en el cobro`).toBe("fulfilled");
      expect(alta.status, `vuelta ${i}: error crudo en el alta`).toBe("fulfilled");
      if (cobro.status === "fulfilled") expect(cobro.value, `vuelta ${i}`).toMatchObject({ ok: true });
      if (alta.status === "fulfilled") expect(alta.value, `vuelta ${i}`).toMatchObject({ ok: false, codigo: "SUCURSAL_YA_TIENE_CUENTA_ACTIVA" });
      expect((await cuentasEscritas(cuenta.id)).enCobro).toEqual([posnet]);
    }
  }, 120_000);

  it("cobro vs. activar una segunda cuenta (sin el índice): con dos compatibles pide elegir; con una asigna; nunca error crudo ni cobro a medias", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    await quitarIndiceDeUnaActiva();
    try {
      const posnet = await ap.cuentaDirecta("TERMINAL");
      for (let i = 0; i < VUELTAS; i++) {
        const otra = await ap.cuentaDirecta("TERMINAL", { activa: false });
        const cuenta = await ap.cuentaCerrada();
        const [cobro] = await Promise.allSettled([ap.cobrar(cuenta.id, [renglonSinCuenta(debito)]), prismaAdmin.cuentaDeCobro.update({ where: { id: otra }, data: { activa: true } })]);
        expect(cobro.status, `vuelta ${i}: error crudo`).toBe("fulfilled");
        if (cobro.status !== "fulfilled") continue;
        const escritas = await cuentasEscritas(cuenta.id);
        if (cobro.value.ok) expect(escritas.enCobro, `vuelta ${i}`).toEqual([posnet]);
        else {
          expect(cobro.value, `vuelta ${i}`).toMatchObject({ ok: false, codigo: "CUENTA_DE_COBRO_A_ELEGIR" });
          expect(escritas.enCobro).toEqual([]);
        }
        // Se vuelve a una sola activa para la vuelta siguiente.
        await prismaAdmin.cuentaDeCobro.update({ where: { id: otra }, data: { activa: false } });
      }
    } finally {
      await restituirIndiceDeUnaActiva();
    }
  }, 120_000);

  it("dos cobros a la vez de cuentas distintas con una sola cuenta activa: los dos entran con ella", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const posnet = await ap.cuentaDirecta("TERMINAL");
    for (let i = 0; i < VUELTAS; i++) {
      const a = await ap.cuentaCerrada();
      const b = await ap.cuentaCerrada();
      const rs = await Promise.allSettled([ap.cobrar(a.id, [renglonSinCuenta(debito)]), ap.cobrar(b.id, [renglonSinCuenta(debito)])]);
      for (const r of rs) {
        expect(r.status, `vuelta ${i}: error crudo`).toBe("fulfilled");
        if (r.status === "fulfilled") expect(r.value, `vuelta ${i}`).toMatchObject({ ok: true });
      }
      expect((await cuentasEscritas(a.id)).enCobro).toEqual([posnet]);
      expect((await cuentasEscritas(b.id)).enCobro).toEqual([posnet]);
    }
  }, 120_000);

  it("dos cobros iguales a la vez con la misma clave: uno solo se escribe y el otro ve yaExistia (misma cuenta)", async () => {
    expect((await ap.abrirCaja()).ok).toBe(true);
    const debito = await ap.medio("TARJETA_DEBITO");
    const posnet = await ap.cuentaDirecta("TERMINAL");
    const cuenta = await ap.cuentaCerrada();
    const clave = randomUUID();
    const rs = await Promise.allSettled([1, 2, 3].map(() => ap.cobrar(cuenta.id, [renglonSinCuenta(debito)], 3000_00, clave)));
    for (const r of rs) expect(r.status).toBe("fulfilled");
    const ok = rs.flatMap((r) => (r.status === "fulfilled" && r.value.ok ? [r.value] : []));
    expect(ok.length).toBe(3);
    expect(ok.filter((x) => x.ok && !x.datos.yaExistia)).toHaveLength(1);
    expect(await prismaAdmin.cobranza.count()).toBe(1);
    expect(await cuentasEscritas(cuenta.id)).toEqual({ enCobro: [posnet], enMovimiento: [posnet] });
  }, 120_000);
});
