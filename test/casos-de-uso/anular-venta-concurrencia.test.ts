import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { anularVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/anular-venta";

/**
 * CARACTERIZACIÓN de la concurrencia de HOY en `anularVentaCasoDeUso` (paso S2 del plan de M2; no cambia código de producción). `anularVenta` NO tiene clave de
 * idempotencia I3: es idempotente solo por ESTADO. Lo arbitra el aislamiento SERIALIZABLE (+ reintento) y la guarda `anuladaEn` de `evaluarAnulacionDeVenta`
 * (src/core/movimientos/anulaciones.ts): el que pierde la carrera, al reintentar, ve la venta ya anulada y responde `YA_ANULADA`.
 *
 * Postgres real, sin mocks. El actor lleva el alcance de sucursal que tiene en producción (su sucursal activa, lectura y escritura) y `empresaId`.
 * Lo que fija este archivo (y que la migración M2-1 no debe romper):
 *  1. dos anulaciones a la vez de la MISMA venta: 1 `exito`, 1 `fracaso("YA_ANULADA")`, exactamente 1 AJUSTE, 1 fila de auditoría y el stock neto igual al de antes de la venta;
 *  2. lo mismo para una promo: dos anulaciones a la vez de componentes distintos de la misma `PromoCuenta` dan UN solo juego de reversiones (una por componente).
 * La carrera "doble anulación" también la cubre test/movimientos/caracterizacion/venta-concurrencia-mixta.test.ts, pero por la Server Action y sin promo.
 */
describe("anularVentaCasoDeUso: concurrencia (caracterización de hoy, sin I3)", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let harinaId: string;

  const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
  const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, ahora: new Date(), ...baseDe(sucursalId) });

  const STOCK_INICIAL = 10;
  const saldoDeHarina = async () => Number((await prisma.movimientoStock.aggregate({ where: { productoId: harinaId, seccionId }, _sum: { cantidad: true } }))._sum.cantidad ?? 0);

  /** Una Operación (fecha fija) con una línea de Kardex de Harina, armada directo por Prisma. */
  async function operacion(proceso: "COMPRA" | "VENTA", cantidad: number, fecha: Date, promoCuentaId?: string) {
    const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha, usuarioId: adminId, ...(promoCuentaId !== undefined && { promoCuentaId }) } });
    await prisma.movimientoStock.create({
      data: { operacionId: op.id, productoId: harinaId, seccionId, proceso, cantidad, detalle: `${proceso} de Harina`, precioTotal: Math.abs(cantidad) * 100, precioPorUnidadStock: 100 },
    });
    return op;
  }

  async function promoCuenta() {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: adminId } });
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId } }, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 1000 } });
    return prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 1000, titulo: "Menú del día", creadoPorId: adminId } });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: catalogo.kg.id, insumoId: catalogo.insumo.id } })).id;
    await operacion("COMPRA", STOCK_INICIAL, new Date("2026-08-01T12:00:00Z"));
  });

  it("dos anulaciones a la vez de la MISMA venta: 1 éxito, 1 YA_ANULADA, 1 AJUSTE, 1 auditoría y el stock neto igual al de antes de la venta", async () => {
    const venta = await operacion("VENTA", -2, new Date("2026-08-06T12:00:00Z"));
    expect(await saldoDeHarina()).toBe(STOCK_INICIAL - 2);

    const resultados = await Promise.all([anularVentaCasoDeUso(actor(), { operacionId: venta.id }), anularVentaCasoDeUso(actor(), { operacionId: venta.id })]);

    const exitos = resultados.filter((r) => r.ok);
    const fracasos = resultados.filter((r) => !r.ok);
    expect(exitos, JSON.stringify(resultados)).toHaveLength(1);
    expect(fracasos).toEqual([{ ok: false, codigo: "YA_ANULADA", mensaje: "Esta venta ya está anulada." }]);

    const ajustes = await prisma.operacion.findMany({ where: { proceso: "AJUSTE", sucursalId }, include: { movimientos: true } });
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0].movimientos).toHaveLength(1);
    const exito = exitos[0];
    if (!exito.ok) return;
    expect(exito.datos).toMatchObject({ ventaId: venta.id, operacionesAnuladas: [venta.id], reversionIds: [ajustes[0].id], movimientosRevertidos: 1 });

    expect(await prisma.registroAuditoria.count({ where: { entidad: "Operacion", entidadId: venta.id } })).toBe(1);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } })).anuladaPorId).toBe(adminId);
    // El stock vuelve UNA sola vez: igual al de antes de la venta.
    expect(await saldoDeHarina()).toBe(STOCK_INICIAL);
  }, 60_000);

  it("promo: dos anulaciones a la vez de componentes distintos de la misma promo dan un solo juego de reversiones (una por componente) y una auditoría por componente", async () => {
    const promo = await promoCuenta();
    const componenteA = await operacion("VENTA", -2, new Date("2026-08-06T12:00:00Z"), promo.id);
    const componenteB = await operacion("VENTA", -3, new Date("2026-08-06T12:00:00Z"), promo.id);
    expect(await saldoDeHarina()).toBe(STOCK_INICIAL - 5);

    const resultados = await Promise.all([anularVentaCasoDeUso(actor(), { operacionId: componenteA.id }), anularVentaCasoDeUso(actor(), { operacionId: componenteB.id })]);

    const exitos = resultados.filter((r) => r.ok);
    const fracasos = resultados.filter((r) => !r.ok);
    expect(exitos, JSON.stringify(resultados)).toHaveLength(1);
    expect(fracasos).toEqual([{ ok: false, codigo: "YA_ANULADA", mensaje: "Esta venta ya está anulada." }]);
    const exito = exitos[0];
    if (!exito.ok) return;
    expect([...exito.datos.operacionesAnuladas].sort()).toEqual([componenteA.id, componenteB.id].sort());

    // Un solo juego: exactamente una AJUSTE por componente (2 en total, no 3 ni 4), con una línea cada una.
    const ajustes = await prisma.operacion.findMany({ where: { proceso: "AJUSTE", sucursalId }, include: { movimientos: true } });
    expect(ajustes).toHaveLength(2);
    expect(ajustes.map((a) => a.id).sort()).toEqual([...exito.datos.reversionIds].sort());
    expect(ajustes.every((a) => a.movimientos.length === 1)).toBe(true);

    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: "Operacion" } });
    expect(auditoria.map((f) => f.entidadId).sort()).toEqual([componenteA.id, componenteB.id].sort());

    for (const c of [componenteA, componenteB]) expect((await prisma.operacion.findUniqueOrThrow({ where: { id: c.id } })).anuladaEn).not.toBeNull();
    // El stock vuelve exactamente al de antes de la promo, una sola vez.
    expect(await saldoDeHarina()).toBe(STOCK_INICIAL);
  }, 60_000);
});
