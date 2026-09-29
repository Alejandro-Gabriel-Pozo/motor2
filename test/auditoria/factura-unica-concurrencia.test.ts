import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regresión de la condición de carrera de factura de compra duplicada
 * (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.2/§11): el
 * chequeo actual (`registrarMovimiento`, un `findFirst` fuera de la
 * transacción) es el camino rápido para el caso secuencial, pero no
 * arbitra una carrera real — dos requests simultáneos con la MISMA
 * factura+proveedor+sucursal y claves de idempotencia DISTINTAS (o
 * ninguna) pueden duplicar la Operacion. `test/auditoria/concurrencia-
 * idempotencia.test.ts` ("Escenario 2") ya documenta esto como hallazgo
 * sin afirmar un resultado esperado; este archivo SÍ lo afirma, una vez
 * que el índice único parcial de la migración lo arbitra.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";
import { MENSAJE_FACTURA_DUPLICADA } from "../../src/core/movimientos/factura-unica";

describe("Regresión: condición de carrera de factura de compra duplicada", () => {
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

  it("dos compras simultáneas con la MISMA factura+proveedor y SIN clave de idempotencia (o con claves distintas) — exactamente una tiene éxito, la otra recibe el mensaje de negocio, ninguna rechaza", async () => {
    for (let i = 0; i < 10; i++) {
      const mp = await sembrarProductoDisponible(
        { codigo: `MP_FACTURA_${i}`, nombre: `Harina Factura ${i}`, tipo: "MP", unidadStockId: unidadKgId, insumoId },
        sucursalId
      );
      const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_FACTURA_${i}`, nombre: `Proveedor ${i}` } });

      const payloadA = { proceso: "COMPRA" as const, fecha: new Date(), seccionId, proveedorId: proveedor.id, nroFactura: "A-0001", items: [{ productoId: mp.id, cantidad: 10 }] };
      const payloadB = { ...payloadA, items: [{ productoId: mp.id, cantidad: 10 }] };

      const settled = await Promise.allSettled([registrarMovimiento(payloadA), registrarMovimiento(payloadB)]);

      expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar: ${JSON.stringify(settled)}`).toBe(true);
      const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
      const exitosos = resultados.filter((r) => r.ok);
      const fallidos = resultados.filter((r) => !r.ok);

      expect(exitosos.length, `iteración ${i}: exactamente una compra exitosa`).toBe(1);
      expect(fallidos.length, `iteración ${i}: exactamente un rechazo`).toBe(1);
      expect(fallidos[0].mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);

      const operacionesConEsaFactura = await prisma.operacion.count({
        where: { sucursalId, proceso: "COMPRA", proveedorId: proveedor.id, nroFactura: "A-0001" },
      });
      expect(operacionesConEsaFactura, `iteración ${i}: una sola Operacion con esa factura, nunca dos`).toBe(1);

      expect(await calcularSaldoTotal(mp.id, seccionId, prisma), `iteración ${i}: el saldo refleja UNA sola compra, no dos`).toBe(10);
    }
  });

  /** Marca una compra ya cargada como anulada, directo en la base (la acción de anular se prueba aparte; acá solo importa el estado). */
  async function anular(operacionId: string) {
    const admin = await prisma.user.findFirstOrThrow();
    await prisma.operacion.update({ where: { id: operacionId }, data: { anuladaEn: new Date(), anuladaPorId: admin.id } });
  }

  it("K1c: la factura de una compra ANULADA se puede volver a usar («anular y recargar» con el mismo número)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_RECARGA", nombre: "Harina Recarga", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_RECARGA", nombre: "Proveedor Recarga" } });
    const payload = { proceso: "COMPRA" as const, fecha: new Date(), seccionId, proveedorId: proveedor.id, nroFactura: "R-0001", items: [{ productoId: mp.id, cantidad: 10 }] };

    const primera = await registrarMovimiento(payload);
    expect(primera.ok).toBe(true);
    // Vigente: el número está ocupado.
    const repetida = await registrarMovimiento(payload);
    expect(repetida.ok).toBe(false);
    expect(repetida.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);

    // Anulada: el número queda libre, tanto para el chequeo rápido de la aplicación como para el índice único de la base.
    await anular((await prisma.operacion.findFirstOrThrow({ where: { proveedorId: proveedor.id, nroFactura: "R-0001" } })).id);
    const recarga = await registrarMovimiento(payload);
    expect(recarga.ok, recarga.mensaje).toBe(true);

    // Y la recarga, ahora vigente, vuelve a ocupar el número.
    const otraVez = await registrarMovimiento(payload);
    expect(otraVez.ok).toBe(false);
    expect(otraVez.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);

    expect(await prisma.operacion.count({ where: { proveedorId: proveedor.id, nroFactura: "R-0001" } }), "la anulada y la recarga conviven").toBe(2);
    expect(await prisma.operacion.count({ where: { proveedorId: proveedor.id, nroFactura: "R-0001", anuladaEn: null } }), "pero vigente hay una sola").toBe(1);
  });

  it("K1c: dos recargas simultáneas de una factura anulada — exactamente una gana (el índice sigue arbitrando la carrera)", async () => {
    for (let i = 0; i < 5; i++) {
      const mp = await sembrarProductoDisponible({ codigo: `MP_RECARGA_C${i}`, nombre: `Harina Recarga Carrera ${i}`, tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_RECARGA_C${i}`, nombre: `Proveedor Recarga Carrera ${i}` } });
      const payload = { proceso: "COMPRA" as const, fecha: new Date(), seccionId, proveedorId: proveedor.id, nroFactura: "R-0002", items: [{ productoId: mp.id, cantidad: 10 }] };

      expect((await registrarMovimiento(payload)).ok).toBe(true);
      await anular((await prisma.operacion.findFirstOrThrow({ where: { proveedorId: proveedor.id, nroFactura: "R-0002" } })).id);

      const settled = await Promise.allSettled([registrarMovimiento(payload), registrarMovimiento({ ...payload })]);
      expect(settled.every((s) => s.status === "fulfilled"), `iteración ${i}: ninguna llamada debe rechazar`).toBe(true);
      const resultados = settled.map((s) => (s.status === "fulfilled" ? s.value : { ok: false as const, mensaje: "rejected" }));
      expect(resultados.filter((r) => r.ok).length, `iteración ${i}: exactamente una recarga exitosa`).toBe(1);
      expect(resultados.find((r) => !r.ok)?.mensaje).toBe(MENSAJE_FACTURA_DUPLICADA);
      expect(await prisma.operacion.count({ where: { proveedorId: proveedor.id, nroFactura: "R-0002", anuladaEn: null } }), `iteración ${i}: una sola vigente`).toBe(1);
    }
  });
});
