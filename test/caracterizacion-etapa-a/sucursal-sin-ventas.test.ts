import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { requierePermiso } from "../../src/server/acceso/gate";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";

/**
 * Caracterización (Etapa A, punto 4d): una sucursal «que no vende» —la Central apagó `proceso_venta` en su matriz de capacidades—. Qué pasa HOY:
 *
 *  (i)   `registrarVenta` (la venta de mostrador) se rechaza con el texto de la denegación por capacidad, aun para el admin: la capacidad de la sucursal se evalúa ANTES que el
 *        rol (`server/acceso/gate.ts`: módulo → capacidad → rol), y `proceso_venta` no es de las «siempre habilitadas».
 *  (ii)  En esa sucursal una compra pasa (`proceso_compra` no está apagado) y el reporte del período muestra lo gastado pero NO un porcentaje de gasto sobre ventas: sin ventas no hay
 *        con qué dividir, y el ratio vale `null` (`calcular` de `server/consultas/reportes/periodo-ratio.ts`), no 0.
 *  (iii) FOTO DE HOY, NO ES UNA DECISIÓN: con SOLO `proceso_venta` apagado, `cerrarCuenta` del salón igual registra la VENTA. Es así porque `cerrarCuenta` pide `pos_cerrar_cuenta`
 *        (`server/actions/pos/cuenta-cierre.ts`) y `proceso_venta` solo frena el mostrador (`server/actions/movimientos/venta.ts`). Si el dueño decide que «no vende» también bloquee el
 *        cierre de cuenta, ESTE caso se edita a propósito (es un cambio de comportamiento y de diseño de la Administración central, no un arreglo). Con `pos_cerrar_cuenta` también
 *        apagado, el cierre sí se rechaza.
 *
 * Con base de datos: no medido localmente (sin Postgres); lo corre el CI. Las fechas son fijas y pasadas; la compra de (ii) va por el caso de uso con un actor inyectado
 * (la Server Action validaría la fecha contra el reloj real), y el único «ahora» que se le pasa al reporte es `AHORA`.
 */
const AHORA = new Date("2026-09-15T12:00:00Z");
const FECHA_VENTA = new Date("2026-08-05T12:00:00Z");
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("sucursal sin ventas (proceso_venta apagado)", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  const apagar = (accionClave: string) => prisma.capacidadSucursal.create({ data: { accionClave, sucursalId: s.sucursalId, habilitado: false } });
  const ventas = () => prisma.operacion.count({ where: { proceso: "VENTA" } });

  it("(i) registrarVenta se rechaza con el texto de la denegación, aun para el admin, y no registra ninguna venta", async () => {
    await apagar("proceso_venta");

    const r = await registrarVenta({ fecha: FECHA_VENTA, seccionId: s.seccion.id, ventas: [{ productoId: s.flan.id, cantidadVendida: 1 }] });

    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('La Central no habilitó "proceso_venta" para esta sucursal.');
    expect(await ventas()).toBe(0);
  });

  it("(ii) una compra pasa; el reporte muestra lo gastado y el ratio gasto/ventas es null (no 0)", async () => {
    await apagar("proceso_venta");
    // El actor lleva el alcance que tiene en producción: SOLO su sucursal activa (ADR-028).
    const actor = { usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, sucursalNombre: "Central", ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) };

    // El gate de la compra no se ve afectado por apagar la venta.
    expect(await requierePermiso(s.admin.id, s.sucursalId, "proceso_compra", prisma)).toEqual({ ok: true });
    const compra = await registrarMovimientoCasoDeUso(actor, { proceso: "COMPRA", fecha: d("2026-08-05"), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 10, precioTotal: 500 }], claveIdempotencia: crypto.randomUUID() });
    expect(compra.ok, compra.mensaje).toBe(true);

    const rep = await obtenerReportePorPeriodo(s.sucursalId, d("2026-08-01"), d("2026-08-31"), undefined, prisma, AHORA);

    expect(rep.compras.totalGastado).toBe(500);
    expect(rep.ratioGastoVentas.porcentaje).toBeNull();
    expect(await ventas()).toBe(0);
  });

  it("(iii) FOTO DE HOY: con solo proceso_venta apagado, cerrarCuenta igual registra la VENTA (pide pos_cerrar_cuenta, no proceso_venta)", async () => {
    await apagar("proceso_venta");
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);

    const r = await cerrarCuenta(cuenta.id);

    expect(r.ok, r.mensaje).toBe(true);
    expect(await ventas()).toBe(1);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).not.toBeNull();
  });

  it("(iii) con pos_cerrar_cuenta también apagado, cerrarCuenta se rechaza y la cuenta sigue abierta", async () => {
    await apagar("proceso_venta");
    await apagar("pos_cerrar_cuenta");
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);

    const r = await cerrarCuenta(cuenta.id);

    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('La Central no habilitó "pos_cerrar_cuenta" para esta sucursal.');
    expect(await ventas()).toBe(0);
    expect((await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).cerradaEn).toBeNull();
  });
});
