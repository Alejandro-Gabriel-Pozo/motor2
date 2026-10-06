import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import {
  limpiarBaseDeTest,
  sembrarBase,
  sembrarSeccion,
  sembrarProductoDisponible,
  crearUsuarioConMembresia,
  prisma,
} from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { sembrarCuenta } from "../pos/salon-fixture";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";

/**
 * Task #27 (docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): sin el arrastre de redondeo, dos ventas separadas de media pizza
 * (paso de venta 0,5) sobre una MP de unidad ENTERA (0 decimales) consumían 2 bollos en el Kardex, no 1 — cada parte se redondeaba
 * por separado (`Math.round(0,5)` redondea el medio hacia arriba). Con paso 0,25, el bug era al revés: cuatro cuartos consumían 0
 * bollos (`Math.round(0,25)` redondea hacia abajo). Este archivo prueba el arreglo (Paso 4 del plan): un arrastre de deuda por
 * (sucursal, producto) que hace que el TOTAL converja al consumo exacto.
 */
describe("Consumo de MP en venta fraccionada: sin error de redondeo acumulado (Task #27)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadBolloId: string;
  let admin: { id: string; email: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const unidadBollo = await prisma.unidad.create({ data: { nombre: "bollo", magnitud: "CANTIDAD", decimales: 0 } });
    unidadBolloId = unidadBollo.id;
    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Un PV con receta de 1 bollo (sin merma) por unidad vendida, con el `pasoVenta` pedido. */
  async function crearPizzaConBollo(pasoVenta: number, sufijo: string) {
    const mp = await sembrarProductoDisponible({ codigo: `MP_BOLLO_${sufijo}`, nombre: `Bollo ${sufijo}`, tipo: "MP", unidadStockId: unidadBolloId }, sucursalId);
    const pv = await sembrarProductoDisponible(
      { codigo: `PV_PIZZA_${sufijo}`, nombre: `Pizza ${sufijo}`, tipo: "PV", unidadStockId: unidadBolloId, precioVenta: 12000, pasoVenta },
      sucursalId
    );
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadBolloId, mermaPorcentaje: 0 }] } },
    });
    return { mp, pv };
  }

  const consumosDe = (productoId: string) => prisma.movimientoStock.findMany({ where: { productoId, proceso: "CONSUMO" }, orderBy: { creadoEn: "asc" } });
  const sumaCantidad = (filas: { cantidad: unknown }[]) => filas.reduce((s, f) => s + Number(f.cantidad), 0);

  it("mostrador: dos ventas separadas de 0,5 (dos Operaciones) consumen 1 bollo en total, no 2 — filas [-1, 0], enteras", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "A");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const r1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r1.ok, r1.mensaje).toBe(true);
    const r2 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r2.ok, r2.mensaje).toBe(true);

    const filas = await consumosDe(mp.id);
    expect(filas).toHaveLength(2);
    // Dos Operaciones distintas (una por venta), cada CONSUMO es un ENTERO (Pivote 4) y el total es -1, no -2.
    expect(new Set(filas.map((f) => f.operacionId)).size).toBe(2);
    for (const f of filas) expect(Number.isInteger(Number(f.cantidad))).toBe(true);
    expect(filas.map((f) => Number(f.cantidad))).toEqual([-1, 0]);
    expect(sumaCantidad(filas)).toBe(-1);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9);
  });

  it("POS: dos mesas distintas, cada una con 0,5, cerradas con cerrarCuenta en momentos DISTINTOS — total -1", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "B");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const mesa1 = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const mesa2 = await prisma.mesa.create({ data: { sucursalId, numero: 2 } });

    const cuenta1 = await sembrarCuenta(mesa1.id, admin.id, [{ productoId: pv.id, cantidad: 0.5, precioUnitario: 12000, numeroEnvio: 1 }]);
    const cierre1 = await cerrarCuenta(cuenta1.id);
    expect(cierre1.ok, cierre1.mensaje).toBe(true);

    // Cierre en un momento DISTINTO (no simultáneo): confirma que el arrastre persiste entre transacciones separadas, no solo dentro
    // de la misma.
    const cuenta2 = await sembrarCuenta(mesa2.id, admin.id, [{ productoId: pv.id, cantidad: 0.5, precioUnitario: 12000, numeroEnvio: 1 }]);
    const cierre2 = await cerrarCuenta(cuenta2.id);
    expect(cierre2.ok, cierre2.mensaje).toBe(true);

    const filas = await consumosDe(mp.id);
    expect(filas.map((f) => Number(f.cantidad))).toEqual([-1, 0]);
    expect(sumaCantidad(filas)).toBe(-1);
  });

  it("una sola cuenta con 0,5 de una pizza + 0,5 de otra, mismo bollo (mismo insumo compartido) — total -1 en UNA venta", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_BOLLO_C", nombre: "Bollo C", tipo: "MP", unidadStockId: unidadBolloId }, sucursalId);
    const napolitana = await sembrarProductoDisponible(
      { codigo: "PV_NAPO", nombre: "Napolitana", tipo: "PV", unidadStockId: unidadBolloId, precioVenta: 12000, pasoVenta: 0.5 },
      sucursalId
    );
    const muzzarella = await sembrarProductoDisponible(
      { codigo: "PV_MUZZA", nombre: "Muzzarella", tipo: "PV", unidadStockId: unidadBolloId, precioVenta: 11000, pasoVenta: 0.5 },
      sucursalId
    );
    for (const pv of [napolitana, muzzarella]) {
      await prisma.recetaVersion.create({
        data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadBolloId, mermaPorcentaje: 0 }] } },
      });
    }
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const r = await registrarVenta({
      fecha: new Date(),
      seccionId,
      ventas: [
        { productoId: napolitana.id, cantidadVendida: 0.5 },
        { productoId: muzzarella.id, cantidadVendida: 0.5 },
      ],
    });
    expect(r.ok, r.mensaje).toBe(true);

    const filas = await consumosDe(mp.id);
    expect(filas).toHaveLength(2);
    // Ambas líneas son la MISMA Operacion? No — registrarVentaEnTx crea una Operacion por línea, pero es UNA sola llamada a
    // registrarVenta (una sola venta desde la perspectiva del mostrador/cuenta).
    expect(sumaCantidad(filas)).toBe(-1);
    for (const f of filas) expect(Number.isInteger(Number(f.cantidad))).toBe(true);
  });

  it("paso 0,25 × 4: total -1 (no 0 — Math.round(0,25) redondea hacia abajo sin el arrastre)", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.25, "D");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    for (let i = 0; i < 4; i++) {
      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.25 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }

    const filas = await consumosDe(mp.id);
    expect(filas.map((f) => Number(f.cantidad))).toEqual([0, -1, 0, 0]);
    expect(sumaCantidad(filas)).toBe(-1);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9);
  });

  it("anulación: vender 0,5, vender 0,5, anular la primera, vender 0,5 — saldo final 8 (2 medias vigentes = 1 bollo) y D vuelve a 0", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "E");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 9 }] });

    const v1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(v1.ok, v1.mensaje).toBe(true);
    if (!v1.ok) return;
    const v2 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(v2.ok, v2.mensaje).toBe(true);

    // La primera Operacion de proceso VENTA es la de v1 (una Operacion por línea; acá una sola línea por llamada).
    const operacionV1 = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" }, orderBy: { creadoEn: "asc" } });
    const anulacion = await anularVenta(operacionV1.id);
    expect(anulacion.ok, anulacion.mensaje).toBe(true);

    const v3 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(v3.ok, v3.mensaje).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(8);

    // D = Σcantidad − ΣcantidadExacta sobre TODAS las filas con cantidadExacta no nulo (CONSUMO + su reversión AJUSTE) — tiene que
    // volver a 0: las dos ventas vigentes (v2, v3) consumieron exactamente 1 bollo entre las dos, sin resto pendiente.
    const conArrastre = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, cantidadExacta: { not: null } } });
    const deudaFinal = conArrastre.reduce((d, f) => d + Number(f.cantidad) - Number(f.cantidadExacta), 0);
    expect(deudaFinal).toBe(0);
  });

  it("dos sucursales: la deuda de redondeo es independiente entre ellas (mismo producto, misma unidad, ninguna se contamina)", async () => {
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Sucursal 2" } });
    const seccion2 = await sembrarSeccion(sucursal2.id, "Depósito 2");
    const admin2 = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: sucursal2.id, rolId: (await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } })).id });

    const { mp, pv } = await crearPizzaConBollo(0.5, "F");
    // El mismo producto tiene que estar disponible (y comprado) en las DOS sucursales.
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal2.id, productoId: mp.id, disponible: true } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal2.id, productoId: pv.id, disponible: true } });
    // La compra de la Sucursal 1 corre con `admin` (ya activo desde el beforeEach); la de la Sucursal 2 necesita a `admin2` — el
    // permiso de `registrarMovimiento` exige que la sección pedida sea de LA SUCURSAL del usuario logueado (Fase 6, seguridad).
    const compra1 = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    expect(compra1.ok, compra1.mensaje).toBe(true);
    await mockearUsuarioActual({ id: admin2.id, email: admin2.email, nombre: null });
    const compra2 = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: seccion2.id, items: [{ productoId: mp.id, cantidad: 10 }] });
    expect(compra2.ok, compra2.mensaje).toBe(true);

    // Sucursal 1: una sola venta de 0,5 — escribe -1 (deuda queda en -0,5, sin nadie que la retire en este test). Vuelve a `admin`.
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const r1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r1.ok, r1.mensaje).toBe(true);

    // Sucursal 2: si compartiera la deuda de la Sucursal 1 (D=-0,5), esta venta de 0,5 escribiría 0 — la prueba real es que
    // escribe -1, exactamente como si fuera la PRIMERA venta de este producto en cualquier sucursal (D=0 propio).
    await mockearUsuarioActual({ id: admin2.id, email: admin2.email, nombre: null });
    const r2 = await registrarVenta({ fecha: new Date(), seccionId: seccion2.id, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r2.ok, r2.mensaje).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9);
    expect(await calcularSaldoTotal(mp.id, seccion2.id, prisma)).toBe(9);
    const consumoSucursal1 = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, seccionId, proceso: "CONSUMO" } });
    const consumoSucursal2 = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, seccionId: seccion2.id, proceso: "CONSUMO" } });
    expect(Number(consumoSucursal1.cantidad)).toBe(-1);
    expect(Number(consumoSucursal2.cantidad)).toBe(-1);
  });

  it("compatibilidad: la primera venta de 7 × 0,3 × 1,07 (caso existente «Contraste») sigue dando -2, sin cambios", async () => {
    const unidadEntera = await prisma.unidad.create({ data: { nombre: "unidad_entera_compat", magnitud: "CANTIDAD", decimales: 0 } });
    const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_HUEVOS_COMPAT", nombre: "Huevos", tipo: "MP", unidadStockId: unidadEntera.id }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_BUDIN_COMPAT", nombre: "Budín", tipo: "PV", unidadStockId: unidadEntera.id, precioVenta: 10 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.3, unidadId: unidadEntera.id, mermaPorcentaje: 7 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 1000 }] });

    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 7 }] });
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mpInsumo.id, proceso: "CONSUMO" } });
    expect(Number.isInteger(Number(mov.cantidad))).toBe(true);
    expect(Number(mov.cantidad)).toBe(-2); // redondearACantidadDeUnidad(2.247, 0) === 2 — SIN deuda previa, idéntico a hoy (invariante "Contraste").
    // cantidadExacta SÍ se llena (columna nueva, sin invariante previo que romper): 2,247 ≠ 2 escrito, así que la deuda de esta MP
    // queda en +0,247 (Σcantidad − ΣcantidadExacta = −2 − (−2,247) = 0,247), lista para la PRÓXIMA venta de este insumo.
    expect(mov.cantidadExacta).not.toBeNull();
    expect(Number(mov.cantidadExacta)).toBeCloseTo(-2.247, 8);
  });
});
