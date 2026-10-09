import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pruebas de investigación de la auditoría 2026-09-16 (Fase 4, autorizada
 * tras revisión del informe docs/auditoria-motor2-fase0-fase1-2026-09-16.md).
 * Objetivo: producir evidencia reproducible sobre concurrencia real,
 * idempotencia y atomicidad transaccional — NO se modifica código de
 * producción a partir de estos resultados sin autorización explícita.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

describe("Auditoría — Fase 4: concurrencia, idempotencia, atomicidad", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  async function crearMP(nombre: string) {
    return sembrarProductoDisponible(
      { codigo: `MP_${nombre.toUpperCase()}`, nombre, tipo: "MP", unidadStockId: unidadKgId, insumoId },
      sucursalId
    );
  }

  describe("Escenario 1: dos CONSUMO simultáneos sobre el mismo producto+sección", () => {
    it("con stock exacto para UNO solo de los dos, Postgres serializa: uno gana, el otro pierde con error, el saldo final nunca queda negativo ni se pierde una unidad", async () => {
      const mp = await crearMP("Harina");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

      // Dos consumos de 6 c/u simultáneos sobre un saldo de 10: la suma (12)
      // excede el disponible, pero cada uno aislado (6 ≤ 10) pasaría si no
      // hubiera serialización real. Si el aislamiento SERIALIZABLE + reintento
      // funciona como está documentado, exactamente UNO debe tener éxito.
      const [r1, r2] = await Promise.all([
        registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }] }),
        registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }] }),
      ]);

      const resultados = [r1, r2];
      const exitosos = resultados.filter((r) => r.ok);
      const fallidos = resultados.filter((r) => !r.ok);

      console.log("[auditoria] Escenario 1 resultados:", resultados.map((r) => ({ ok: r.ok, mensaje: r.mensaje })));

      expect(exitosos.length).toBe(1);
      expect(fallidos.length).toBe(1);
      expect(fallidos[0]!.mensaje).toMatch(/stock insuficiente/i);

      const saldoFinal = await calcularSaldoTotal(mp.id, seccionId, prisma);
      expect(saldoFinal).toBe(4); // 10 - 6, nunca 10-12=-2 ni 10-6-6 si ambos hubiesen "ganado" mal
    });

    it("REGRESIÓN (Plan C2): con dos operaciones concurrentes que SÍ deberían poder convivir (stock de sobra), conTransaccionSerializable debe reintentar SIEMPRE — nunca un rechazo crudo del driver, 15/15 corridas", async () => {
      // Antes de C2: esto fallaba de forma intermitente (~1-2 de cada 5-6
      // corridas) con una promesa RECHAZADA (DriverAdapterError, no un
      // ResultadoAccion {ok:false,...}) — ver el hallazgo original en
      // docs/auditoria-motor2-fase0-fase1-2026-09-16.md §8. Correr en loop
      // acá adentro (no manualmente desde la terminal) para que la
      // regresión sea parte de la suite normal, no un chequeo manual.
      for (let intento = 0; intento < 15; intento++) {
        const mp = await crearMP(`HarinaC2_${intento}`);
        await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20 }] });

        const settled = await Promise.allSettled([
          registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }] }),
          registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 6 }] }),
        ]);

        const rechazados = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
        if (rechazados.length > 0) {
          const reason = rechazados[0]!.reason as Error & { code?: string; meta?: unknown; cause?: unknown };
          console.log(`[auditoria] Intento ${intento}: promesa rechazada —`, reason?.constructor?.name, String(reason?.message).slice(0, 200));
          console.log("[auditoria][DIAGNOSTICO] code=", reason?.code, "meta=", JSON.stringify(reason?.meta), "cause=", reason?.cause, "mensajeCompleto=", reason?.message);
        }
        expect(rechazados.length, `intento ${intento}: no debe haber ninguna promesa rechazada`).toBe(0);

        const cumplidos = settled as PromiseFulfilledResult<Awaited<ReturnType<typeof registrarMovimiento>>>[];
        expect(cumplidos.every((c) => c.value.ok), `intento ${intento}: ambas operaciones deben tener éxito`).toBe(true);
        expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(8); // 20 - 6 - 6, siempre
      }
    });
  });

  describe("Escenario 2: dos COMPRA simultáneas con la MISMA factura+proveedor (hipótesis del informe: el chequeo anti-duplicado corre FUERA de la transacción serializable) — RESUELTO", () => {
    it("el índice único parcial Operacion_factura_unica_key ya arbitra esta carrera (regresión completa en test/auditoria/factura-unica-concurrencia.test.ts)", async () => {
      const mp = await crearMP("HarinaFactura");
      const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_TEST01", nombre: "Proveedor Test" } });

      const payload = {
        proceso: "COMPRA" as const,
        fecha: new Date(),
        seccionId,
        proveedorId: proveedor.id,
        nroFactura: "A-0001",
        items: [{ productoId: mp.id, cantidad: 10 }],
      };

      const settled = await Promise.allSettled([registrarMovimiento(payload), registrarMovimiento(payload)]);

      const operacionesConEsaFactura = await prisma.operacion.count({
        where: { sucursalId, proceso: "COMPRA", proveedorId: proveedor.id, nroFactura: "A-0001" },
      });

      console.log(
        "[auditoria] Escenario 2:",
        settled.map((s) => (s.status === "fulfilled" ? { ok: s.value.ok, mensaje: s.value.mensaje } : { rejected: true, message: String((s.reason as Error)?.message).slice(0, 200) })),
        { operacionesConEsaFactura }
      );

      // Hasta 2026-09-20 esto NO afirmaba un resultado esperado a priori
      // (era evidencia de una carrera real sin arbitrar, `>= 1`). Con el
      // índice único parcial Operacion_factura_unica_key ya aplicado
      // (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.2) y
      // el catch de esChoqueDeFacturaUnica en registrarMovimiento, pasa a
      // ser una regresión real: nunca más de una Operacion con esa factura.
      expect(operacionesConEsaFactura).toBe(1);
      expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    });
  });

  describe("Escenario 3: doble-submit secuencial (click doble de usuario) — sin concurrencia real, mismo payload dos veces seguidas", () => {
    it("confirma que NO existe protección de idempotencia: un CONSUMO repetido crea dos Operaciones y descuenta el doble", async () => {
      const mp = await crearMP("HarinaDobleSubmit");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

      const payload = { proceso: "CONSUMO" as const, fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 3 }] };
      const r1 = await registrarMovimiento(payload);
      const r2 = await registrarMovimiento(payload); // mismo payload exacto, sin ninguna referencia/idempotency-key

      expect(r1.ok, r1.mensaje).toBe(true);
      expect(r2.ok, r2.mensaje).toBe(true); // CONFIRMADO: ambos tienen éxito, no hay guard

      const operacionesConsumo = await prisma.operacion.count({ where: { sucursalId, proceso: "CONSUMO" } });
      expect(operacionesConsumo).toBe(2); // dos Operaciones distintas del mismo submit repetido

      expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(4); // 10 - 3 - 3, se descontó dos veces
    });
  });

  describe("Escenario 4: atomicidad — fallo a mitad de un payload con varias líneas", () => {
    it("si una línea del payload es inválida (producto inexistente), NINGUNA línea válida del mismo payload queda persistida", async () => {
      const mpValida = await crearMP("HarinaValida");
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpValida.id, cantidad: 10 }] });

      const resultado = await registrarMovimiento({
        proceso: "CONSUMO",
        fecha: new Date(),
        seccionId,
        items: [
          { productoId: mpValida.id, cantidad: 2 }, // válida, se procesaría primero
          { productoId: "00000000-0000-0000-0000-000000000000", cantidad: 1 }, // producto inexistente
        ],
      });

      expect(resultado.ok).toBe(false);
      // El saldo debe seguir en 10: ninguna línea se persistió pese a que la primera era válida.
      expect(await calcularSaldoTotal(mpValida.id, seccionId, prisma)).toBe(10);
      const totalMovimientos = await prisma.movimientoStock.count({ where: { productoId: mpValida.id } });
      expect(totalMovimientos).toBe(1); // solo el movimiento de la COMPRA inicial, ningún CONSUMO parcial
    });
  });
});
