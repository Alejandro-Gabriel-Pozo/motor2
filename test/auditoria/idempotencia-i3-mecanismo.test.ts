import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan I3 (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md) —
 * pruebas de caracterización del mecanismo de idempotencia YA IMPLEMENTADO
 * (§10.2/§11.7): por proceso, los 4 casos acordados (clave nueva; misma
 * clave + mismo payload → resultado original silencioso; misma clave +
 * payload distinto → conflicto; concurrencia real con la misma clave →
 * exactamente 1 efecto). `registrarMovimiento` comparte una única función
 * para 7 de los 10 procesos (MERMA/COMPRA/CONSUMO/PRODUCCIÓN/DEVOLUCIÓN×3)
 * — probar el mecanismo una vez alcanza para esos 7, porque el chequeo de
 * idempotencia corre ANTES de la rama por `proceso`, no una vez por
 * proceso (§11.5). Se prueban por separado los otros 4 puntos de entrada
 * (registrarVenta, reclasificarStock, aceptarTransferencia,
 * confirmarReingresoTransferencia) por ser funciones de código distintas.
 * `rechazarTransferencia` no usa este mecanismo (§6.2) — su regresión
 * propia vive en traspasos-en-transito.test.ts.
 *
 * `test/auditoria/idempotencia-resto-de-procesos.test.ts` queda intacto:
 * sigue documentando correctamente el comportamiento SIN clave (rollout
 * gradual, §9.3) — no cambia con esta implementación.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { reclasificarStock } from "../../src/server/actions/stock/reclasificacion";
import { crearEnvioDirectoTransferencia, aceptarTransferencia, rechazarTransferencia, confirmarReingresoTransferencia } from "../../src/server/actions/traspasos/traspasos";
import type { ResultadoConId } from "../../src/server/actions/tipos";

function idDe(r: ResultadoConId): string {
  if (!r.ok) throw new Error(r.mensaje);
  return r.id;
}

describe("Plan I3 — mecanismo de idempotencia", () => {
  let sucursalId: string;
  let seccionId: string;
  let seccionDestinoId: string;
  let unidadKgId: string;
  let insumoId: string;
  let adminRolId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminRolId = base.admin.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    seccionDestinoId = (await sembrarSeccion(sucursalId, "Cocina")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function crearMP(nombre: string) {
    return prisma.producto.create({ data: { codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId } });
  }

  describe("registrarMovimiento (comparte código con 7 de los 10 procesos)", () => {
    it("clave nueva: se ejecuta una sola vez, comportamiento normal", async () => {
      const mp = await crearMP("Harina1");
      const clave = crypto.randomUUID();
      const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: clave });
      expect(r.ok, r.mensaje).toBe(true);
      const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "COMPRA" } });
      expect(operaciones).toBe(1);
    });

    it("misma clave + mismo payload (reintento secuencial): 1 sola Operacion, ambas respuestas ok:true con el mismo mensaje", async () => {
      const mp = await crearMP("Harina2");
      const clave = crypto.randomUUID();
      const payload = { proceso: "COMPRA" as const, fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: clave };
      const r1 = await registrarMovimiento(payload);
      const r2 = await registrarMovimiento(payload);
      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.ok, r2.mensaje).toBe(true);
      expect(r2.mensaje).toBe(r1.mensaje);

      const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "COMPRA" } });
      expect(operaciones).toBe(1);
      const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id } });
      expect(movimientos).toBe(1); // no se duplicó el efecto de stock
    });

    it("misma clave + payload distinto: se rechaza por conflicto, cero Operacion/MovimientoStock nuevos", async () => {
      const mp = await crearMP("Harina3");
      const clave = crypto.randomUUID();
      const r1 = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: clave });
      expect(r1.ok, r1.mensaje).toBe(true);

      const r2 = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 999 }], claveIdempotencia: clave });
      expect(r2.ok).toBe(false);
      expect(r2.mensaje).toMatch(/ya se había enviado con datos distintos/);

      const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "COMPRA" } });
      expect(operaciones).toBe(1); // solo la primera
    });

    it("clave con formato inválido (no UUID): error de validación, nunca llega a la transacción", async () => {
      const mp = await crearMP("Harina4");
      const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: "no-es-un-uuid" });
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/Clave de reintento inválida/);
      const operaciones = await prisma.operacion.count({ where: { sucursalId } });
      expect(operaciones).toBe(0);
    });

    it("concurrencia real (misma clave, 2 requests simultáneos): exactamente 1 efecto en Kardex, ambas respuestas coherentes", async () => {
      for (let intento = 0; intento < 5; intento++) {
        const mp = await crearMP(`HarinaC${intento}`);
        const clave = crypto.randomUUID();
        const payload = { proceso: "COMPRA" as const, fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }], claveIdempotencia: clave };

        const settled = await Promise.allSettled([registrarMovimiento(payload), registrarMovimiento(payload)]);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
        expect(resultados.every((r) => r?.ok)).toBe(true);
        expect(resultados[0]?.mensaje).toBe(resultados[1]?.mensaje);

        const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id } });
        expect(movimientos).toBe(1);
      }
    });

    it("sin clave (compatibilidad, rollout gradual): comportamiento sin cambios — un reenvío sin clave sigue duplicando, mismo criterio que idempotencia-resto-de-procesos.test.ts", async () => {
      const mp = await crearMP("HarinaSinClave");
      const payload = { proceso: "COMPRA" as const, fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] };
      const r1 = await registrarMovimiento(payload);
      const r2 = await registrarMovimiento(payload);
      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.ok, r2.mensaje).toBe(true);
      const operaciones = await prisma.operacion.count({ where: { sucursalId, proceso: "COMPRA" } });
      expect(operaciones).toBe(2); // sin clave, el mecanismo queda deshabilitado — comportamiento previo intacto
    });
  });

  describe("registrarVenta (crea 1 Operacion POR VENTA — la clave/hash/resultado viven solo en la primera del lote)", () => {
    async function sembrarPvConReceta(sufijo: string) {
      const mpInsumo = await prisma.producto.create({ data: { codigo: `MP_V${sufijo}`, nombre: `HarinaV${sufijo}`, tipo: "MP", unidadStockId: unidadKgId, insumoId } });
      const pv = await prisma.producto.create({ data: { codigo: `PV_V${sufijo}`, nombre: `PanV${sufijo}`, tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 1, unidadId: unidadKgId }] } } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 20 }] });
      return pv;
    }

    it("misma clave + mismo payload (lote de 2 ventas): 1 solo intento, la clave queda solo en la primera Operacion del lote", async () => {
      const pv1 = await sembrarPvConReceta("A");
      const pv2 = await sembrarPvConReceta("B");
      const clave = crypto.randomUUID();
      const payload = { fecha: new Date(), seccionId, ventas: [{ productoId: pv1.id, cantidadVendida: 2 }, { productoId: pv2.id, cantidadVendida: 3 }], claveIdempotencia: clave };

      const r1 = await registrarVenta(payload);
      const r2 = await registrarVenta(payload);
      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.mensaje).toBe(r1.mensaje);

      const operacionesVenta = await prisma.operacion.count({ where: { sucursalId, proceso: "VENTA" } });
      expect(operacionesVenta).toBe(2); // 1 por línea vendida, del ÚNICO intento que se ejecutó

      const conClave = await prisma.operacion.count({ where: { sucursalId, claveIdempotencia: clave } });
      expect(conClave).toBe(1); // la clave vive en una sola de las 2 Operacion del lote
    });

    it("misma clave + payload distinto: conflicto, sin ejecutar nada del segundo intento", async () => {
      const pv = await sembrarPvConReceta("C");
      const clave = crypto.randomUUID();
      const r1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }], claveIdempotencia: clave });
      expect(r1.ok, r1.mensaje).toBe(true);

      const r2 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 5 }], claveIdempotencia: clave });
      expect(r2.ok).toBe(false);
      expect(r2.mensaje).toMatch(/ya se había enviado con datos distintos/);

      const operacionesVenta = await prisma.operacion.count({ where: { sucursalId, proceso: "VENTA" } });
      expect(operacionesVenta).toBe(1);
    });

    it("concurrencia real: exactamente 1 intento se ejecuta", async () => {
      const pv = await sembrarPvConReceta("D");
      const clave = crypto.randomUUID();
      const payload = { fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2 }], claveIdempotencia: clave };

      const settled = await Promise.allSettled([registrarVenta(payload), registrarVenta(payload)]);
      const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
      expect(resultados.every((r) => r?.ok)).toBe(true);
      expect(resultados[0]?.mensaje).toBe(resultados[1]?.mensaje);

      const operacionesVenta = await prisma.operacion.count({ where: { sucursalId, proceso: "VENTA" } });
      expect(operacionesVenta).toBe(1);
    });
  });

  describe("reclasificarStock", () => {
    it("misma clave + mismo payload: 1 sola ejecución, mismo mensaje persistido", async () => {
      const mp = await crearMP("Sal1");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      const clave = crypto.randomUUID();
      const payload = { productoId: mp.id, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 10 }], claveIdempotencia: clave };

      const r1 = await reclasificarStock(payload);
      const r2 = await reclasificarStock(payload);
      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.mensaje).toBe(r1.mensaje);

      const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id, proceso: "RECLASIFICACION" } });
      expect(movimientos).toBe(2); // 1 reclasificación × (1 salida + 1 entrada), NO 4
    });

    it("misma clave + payload distinto: conflicto", async () => {
      const mp = await crearMP("Sal2");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      const clave = crypto.randomUUID();
      const r1 = await reclasificarStock({ productoId: mp.id, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 10 }], claveIdempotencia: clave });
      expect(r1.ok, r1.mensaje).toBe(true);

      const r2 = await reclasificarStock({ productoId: mp.id, seccionOrigenId: seccionId, fecha: new Date(), destinos: [{ seccionId: seccionDestinoId, cantidad: 999 }], claveIdempotencia: clave });
      expect(r2.ok).toBe(false);
      expect(r2.mensaje).toMatch(/ya se había enviado con datos distintos/);
    });
  });

  describe("aceptarTransferencia / confirmarReingresoTransferencia", () => {
    let sucursalBId: string;
    let seccionBId: string;
    let usuarioAId: string;
    let usuarioBId: string;

    beforeEach(async () => {
      const sucursalB = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
      sucursalBId = sucursalB.id;
      seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
      const usuarioA = await crearUsuarioConMembresia({ email: "a@test.com", sucursalId, rolId: adminRolId });
      const usuarioB = await crearUsuarioConMembresia({ email: "b@test.com", sucursalId: sucursalBId, rolId: adminRolId });
      usuarioAId = usuarioA.id;
      usuarioBId = usuarioB.id;
    });

    async function comoA() {
      await mockearUsuarioActual({ id: usuarioAId, email: "a@test.com", nombre: null });
    }
    async function comoB() {
      await mockearUsuarioActual({ id: usuarioBId, email: "b@test.com", nombre: null });
    }

    it("aceptarTransferencia: misma clave + mismo payload (secuencial) → 1 sola aceptación, mismo mensaje", async () => {
      const mp = await crearMP("HarinaT1");
      await comoA();
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionId });
      expect(envio.ok, envio.mensaje).toBe(true);

      await comoB();
      const clave = crypto.randomUUID();
      const r1 = await aceptarTransferencia(idDe(envio), seccionBId, clave);
      const r2 = await aceptarTransferencia(idDe(envio), seccionBId, clave);
      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.mensaje).toBe(r1.mensaje);

      const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id, proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } });
      expect(movimientos).toBe(1);
    });

    it("aceptarTransferencia: misma clave + payload distinto (otra sección destino) → conflicto", async () => {
      const mp = await crearMP("HarinaT2");
      const seccionB2 = await sembrarSeccion(sucursalBId, "Depósito B2");
      await comoA();
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionId });

      await comoB();
      const clave = crypto.randomUUID();
      const r1 = await aceptarTransferencia(idDe(envio), seccionBId, clave);
      expect(r1.ok, r1.mensaje).toBe(true);

      const r2 = await aceptarTransferencia(idDe(envio), seccionB2.id, clave);
      expect(r2.ok).toBe(false);
      expect(r2.mensaje).toMatch(/ya se había enviado con datos distintos|no se puede aceptar/);
    });

    it("confirmarReingresoTransferencia: misma clave + mismo payload (secuencial) → 1 sola confirmación, mismo mensaje", async () => {
      const mp = await crearMP("HarinaT3");
      await comoA();
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionId });

      await comoB();
      await rechazarTransferencia(idDe(envio), "no lo pedimos");

      await comoA();
      const clave = crypto.randomUUID();
      const r1 = await confirmarReingresoTransferencia(idDe(envio), clave);
      const r2 = await confirmarReingresoTransferencia(idDe(envio), clave);
      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.mensaje).toBe(r1.mensaje);

      const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id, proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" } });
      expect(movimientos).toBe(1);
    });

    // Los dos tests de arriba llaman r1 y r2 en secuencia (`await` uno, después el otro) — no ejercitan una carrera
    // real. Estos dos sí: Promise.allSettled con la MISMA clave, en un loop (el timing de qué transacción llega
    // primero al INSERT no es determinístico) — el 4º caso que el Plan I3 (§10.2/§11.7) había dejado pendiente
    // para las dos funciones de traspaso. Ninguna de las dos llamadas debe rechazar (si una lo hace, el
    // conflicto de escritura escapó del reintento de conTransaccionSerializable en vez de resolverse como
    // idempotencia) y nunca debe quedar más de un efecto real.
    it("aceptarTransferencia: misma clave, CONCURRENTE de verdad (Promise.allSettled) → nunca dos efectos, ninguna llamada rechaza", async () => {
      for (let i = 0; i < 12; i++) {
        const mp = await crearMP(`HarinaConc${i}`);
        await comoA();
        await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
        const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionId });
        expect(envio.ok, envio.mensaje).toBe(true);

        await comoB();
        const clave = crypto.randomUUID();
        const settled = await Promise.allSettled([aceptarTransferencia(idDe(envio), seccionBId, clave), aceptarTransferencia(idDe(envio), seccionBId, clave)]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
        expect(resultados.every((r) => r.ok), `iteración ${i}: las dos deben terminar ok (semántica de idempotencia): ${JSON.stringify(resultados)}`).toBe(true);
        expect(resultados[0].mensaje).toBe(resultados[1].mensaje);

        const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id, proceso: "TRANSFERENCIA_ENTRADA_SUCURSAL" } });
        expect(movimientos, `iteración ${i}: nunca dos entradas de stock`).toBe(1);

        const operacionesConEsaClave = await prisma.operacion.count({ where: { claveIdempotencia: clave } });
        expect(operacionesConEsaClave, `iteración ${i}: la clave de idempotencia identifica una sola Operacion`).toBe(1);
      }
    });

    it("confirmarReingresoTransferencia: misma clave, CONCURRENTE de verdad (Promise.allSettled) → nunca dos efectos, ninguna llamada rechaza", async () => {
      for (let i = 0; i < 12; i++) {
        const mp = await crearMP(`HarinaConcReingreso${i}`);
        await comoA();
        await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
        const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: sucursalBId, productoId: mp.id, cantidad: 4, seccionOrigenId: seccionId });
        expect(envio.ok, envio.mensaje).toBe(true);

        await comoB();
        const rechazo = await rechazarTransferencia(idDe(envio), "no lo pedimos");
        expect(rechazo.ok, rechazo.mensaje).toBe(true);

        await comoA();
        const clave = crypto.randomUUID();
        const settled = await Promise.allSettled([confirmarReingresoTransferencia(idDe(envio), clave), confirmarReingresoTransferencia(idDe(envio), clave)]);

        expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
        const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
        expect(resultados.every((r) => r.ok), `iteración ${i}: las dos deben terminar ok (semántica de idempotencia): ${JSON.stringify(resultados)}`).toBe(true);
        expect(resultados[0].mensaje).toBe(resultados[1].mensaje);

        const movimientos = await prisma.movimientoStock.count({ where: { productoId: mp.id, proceso: "REINGRESO_TRANSFERENCIA_SUCURSAL" } });
        expect(movimientos, `iteración ${i}: nunca dos reingresos`).toBe(1);

        const operacionesConEsaClave = await prisma.operacion.count({ where: { claveIdempotencia: clave } });
        expect(operacionesConEsaClave, `iteración ${i}: la clave de idempotencia identifica una sola Operacion`).toBe(1);
      }
    });
  });
});
