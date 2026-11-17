import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

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
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { sumaExacta } from "../setup/suma-exacta";

/**
 * Task #27 (docs/plan-redondeo-consumo-fraccionado-2026-09-26.md): sin el arrastre de redondeo, dos ventas separadas de media pizza
 * (paso de venta 0,5) sobre una MP de unidad ENTERA (0 decimales) consumían 2 bollos en el Kardex, no 1 — cada parte se redondeaba
 * por separado (`Math.round(0,5)` redondea el medio hacia arriba). Con paso 0,25, el bug era al revés: cuatro cuartos consumían 0
 * bollos (`Math.round(0,25)` redondea hacia abajo). Este archivo prueba el arreglo (Paso 4 del plan): un arrastre de deuda por
 * (sucursal, producto) que hace que el TOTAL converja al consumo exacto.
 *
 * A1b 2026-11-16 («Pasar a cuenta exacta como Pedernal» y «4 decimales fijos como Pedernal»): el stock se guarda a 4 decimales fijos
 * (ya no a los decimales de la unidad, bollo: 0) y el redondeo es en decimal exacto con el empate alejándose del cero. Con eso 0,5 de
 * bollo se escribe exacto (−0,5), sin deuda: el arrastre solo actúa con consumos de MÁS de 4 decimales. Estas pruebas conservan su
 * intención (el total converge al consumo exacto: no se pierde ni se duplica) con una receta de `CONSUMO_CHICO` = 0,0001 de bollo por
 * unidad vendida: media pizza consume 0,00005 (5 decimales), que a 4 decimales es 0,0001 con resto 0,00005. El comportamiento nuevo
 * (0,5 exacto, sin deuda) se prueba aparte, con la receta de 1 bollo de siempre.
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

  // A1b 2026-11-16: consumo por unidad vendida de las pruebas del ARRASTRE (antes 1 bollo): con media pizza da 0,00005, que necesita 5 decimales.
  const CONSUMO_CHICO = 0.0001;

  /** Un PV con receta de `cantidadReceta` bollos (1 por defecto; sin merma) por unidad vendida, con el `pasoVenta` pedido. */
  async function crearPizzaConBollo(pasoVenta: number, sufijo: string, cantidadReceta = 1) {
    const mp = await sembrarProductoDisponible({ codigo: `MP_BOLLO_${sufijo}`, nombre: `Bollo ${sufijo}`, tipo: "MP", unidadStockId: unidadBolloId }, sucursalId);
    const pv = await sembrarProductoDisponible(
      { codigo: `PV_PIZZA_${sufijo}`, nombre: `Pizza ${sufijo}`, tipo: "PV", unidadStockId: unidadBolloId, precioVenta: 12000, pasoVenta },
      sucursalId
    );
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: cantidadReceta, unidadId: unidadBolloId, mermaPorcentaje: 0 }] } },
    });
    return { mp, pv };
  }

  const consumosDe = (productoId: string) => prisma.movimientoStock.findMany({ where: { productoId, proceso: "CONSUMO" }, orderBy: { creadoEn: "asc" } });
  const sumaCantidad = (filas: { cantidad: unknown }[]) => sumaExacta(filas.map((f) => Number(f.cantidad)));

  // A1b 2026-11-16 (prueba nueva): el comportamiento que cambió de verdad. Con bollo de 0 decimales, dos ventas de 0,5 escribían −1 y 0 (el
  // arrastre); ahora cada una escribe −0,5 exacto, el total es −1 sin ninguna deuda (cantidadExacta nula) y no hay filas que redondear.
  it("mostrador: dos ventas separadas de 0,5 de un bollo de 0 decimales escriben −0,5 y −0,5 exactos, sin deuda (4 decimales fijos)", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "A0");
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });
    for (let i = 0; i < 2; i++) {
      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }
    const filas = await consumosDe(mp.id);
    expect(filas.map((f) => Number(f.cantidad))).toEqual([-0.5, -0.5]);
    expect(filas.map((f) => f.cantidadExacta)).toEqual([null, null]);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9);
  });

  it("mostrador: dos ventas separadas de 0,00005 de consumo (dos Operaciones) consumen 0,0001 en total, no 0,0002 — filas [-0,0001, 0]", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "A", CONSUMO_CHICO);
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });

    const r1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r1.ok, r1.mensaje).toBe(true);
    const r2 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r2.ok, r2.mensaje).toBe(true);

    const filas = await consumosDe(mp.id);
    expect(filas).toHaveLength(2);
    // Dos Operaciones distintas (una por venta), cada CONSUMO tiene como máximo 4 decimales y el total es -0,0001, no -0,0002.
    expect(new Set(filas.map((f) => f.operacionId)).size).toBe(2);
    expect(filas.map((f) => Number(f.cantidad))).toEqual([-0.0001, 0]);
    expect(sumaCantidad(filas)).toBe(-0.0001);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9.9999);
  });

  it("POS: dos mesas distintas, cada una con 0,5, cerradas con cerrarCuenta en momentos DISTINTOS — total -0,0001 (A1b: receta de 0,0001)", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "B", CONSUMO_CHICO);
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });

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
    expect(filas.map((f) => Number(f.cantidad))).toEqual([-0.0001, 0]); // A1b 2026-11-16: antes [-1, 0] con receta de 1 bollo y unidad entera
    expect(sumaCantidad(filas)).toBe(-0.0001);
  });

  it("una sola cuenta con 0,5 de una pizza + 0,5 de otra, mismo bollo (mismo insumo compartido) — total -0,0001 en UNA venta (A1b: receta de 0,0001)", async () => {
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
        data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: CONSUMO_CHICO, unidadId: unidadBolloId, mermaPorcentaje: 0 }] } },
      });
    }
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });

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
    expect(sumaCantidad(filas)).toBe(-0.0001);
    for (const f of filas) expect(Math.round(Number(f.cantidad) * 1e4) / 1e4).toBe(Number(f.cantidad)); // A1b: antes enteras; ahora máximo 4 decimales
  });

  // A1b 2026-11-16: con receta de 0,0003 cada cuarto consume 0,000075 (5 decimales); redondeado por separado daría 4 × 0,0001 = 0,0004 (de más);
  // con el arrastre el total converge al exacto, 0,0003. (No se usa 0,0001 como en las otras: un consumo menor a 0,00005 ni llega a
  // asignarse al lote, `origen-venta.ts` descarta lo que a 4 decimales es 0; ver el informe.)
  it("paso 0,25 × 4: total -0,0003 (no -0,0004: cada parte de 0,000075 redondea a 0,0001 sin el arrastre)", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.25, "D", 0.0003);
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });

    for (let i = 0; i < 4; i++) {
      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.25 }] });
      expect(r.ok, r.mensaje).toBe(true);
    }

    const filas = await consumosDe(mp.id);
    expect(filas.map((f) => Number(f.cantidad))).toEqual([-0.0001, -0.0001, 0, -0.0001]); // A1b 2026-11-16: antes [0, -1, 0, 0] con receta de 1 bollo y unidad entera
    expect(sumaCantidad(filas)).toBe(-0.0003);
    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9.9997);
  });

  it("anulación: vender 0,5, vender 0,5, anular la primera, vender 0,5 — saldo final 8,9999 (2 medias vigentes = 0,0001) y D vuelve a 0 (A1b: receta de 0,0001)", async () => {
    const { mp, pv } = await crearPizzaConBollo(0.5, "E", CONSUMO_CHICO);
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 9, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });

    const v1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(v1.ok, v1.mensaje).toBe(true);
    if (!v1.ok) return;
    const v2 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(v2.ok, v2.mensaje).toBe(true);

    // La primera Operacion de proceso VENTA es la de v1 (una Operacion por línea; acá una sola línea por llamada).
    const operacionV1 = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" }, orderBy: { creadoEn: "asc" } });
    const anulacion = await anularVenta(operacionV1.id, "Error de carga");
    expect(anulacion.ok, anulacion.mensaje).toBe(true);

    const v3 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(v3.ok, v3.mensaje).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(8.9999); // A1b 2026-11-16: antes 8 (2 medias de 1 bollo = 1 bollo)

    // D = Σcantidad − ΣcantidadExacta sobre TODAS las filas con cantidadExacta no nulo (CONSUMO + su reversión AJUSTE) — tiene que
    // volver a 0: las dos ventas vigentes (v2, v3) consumieron exactamente 0,0001 entre las dos, sin resto pendiente.
    const conArrastre = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, cantidadExacta: { not: null } } });
    const deudaFinal = sumaExacta(conArrastre.flatMap((f) => [Number(f.cantidad), -Number(f.cantidadExacta)]));
    expect(deudaFinal).toBe(0);
  });

  it("dos sucursales: la deuda de redondeo es independiente entre ellas (mismo producto, misma unidad, ninguna se contamina)", async () => {
    const sucursal2 = await prisma.sucursal.create({ data: { nombre: "Sucursal 2" } });
    const seccion2 = await sembrarSeccion(sucursal2.id, "Depósito 2");
    const admin2 = await crearUsuarioConMembresia({ email: "admin2@test.com", sucursalId: sucursal2.id, rolId: (await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } })).id });

    const { mp, pv } = await crearPizzaConBollo(0.5, "F", CONSUMO_CHICO);
    // El mismo producto tiene que estar disponible (y comprado) en las DOS sucursales.
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal2.id, productoId: mp.id, disponible: true } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal2.id, productoId: pv.id, disponible: true } });
    // La compra de la Sucursal 1 corre con `admin` (ya activo desde el beforeEach); la de la Sucursal 2 necesita a `admin2` — el
    // permiso de `registrarMovimiento` exige que la sección pedida sea de LA SUCURSAL del usuario logueado (Fase 6, seguridad).
    const compra1 = await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });
    expect(compra1.ok, compra1.mensaje).toBe(true);
    await mockearUsuarioActual({ id: admin2.id, email: admin2.email, nombre: null });
    const compra2 = await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId: seccion2.id, items: [{ productoId: mp.id, cantidad: 10, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });
    expect(compra2.ok, compra2.mensaje).toBe(true);

    // Sucursal 1: una sola venta de 0,5 — escribe -0,0001 (deuda queda en -0,00005, sin nadie que la retire en este test). Vuelve a `admin`.
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const r1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r1.ok, r1.mensaje).toBe(true);

    // Sucursal 2: si compartiera la deuda de la Sucursal 1 (D=-0,00005), esta venta de 0,5 escribiría 0 — la prueba real es que
    // escribe -0,0001, exactamente como si fuera la PRIMERA venta de este producto en cualquier sucursal (D=0 propio).
    await mockearUsuarioActual({ id: admin2.id, email: admin2.email, nombre: null });
    const r2 = await registrarVenta({ fecha: new Date(), seccionId: seccion2.id, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] });
    expect(r2.ok, r2.mensaje).toBe(true);

    expect(await calcularSaldoTotal(mp.id, seccionId, prisma)).toBe(9.9999); // A1b 2026-11-16: antes 9 (receta de 1 bollo, unidad entera)
    expect(await calcularSaldoTotal(mp.id, seccion2.id, prisma)).toBe(9.9999);
    const consumoSucursal1 = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, seccionId, proceso: "CONSUMO" } });
    const consumoSucursal2 = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mp.id, seccionId: seccion2.id, proceso: "CONSUMO" } });
    expect(Number(consumoSucursal1.cantidad)).toBe(-0.0001);
    expect(Number(consumoSucursal2.cantidad)).toBe(-0.0001);
  });

  // A1b 2026-11-16: stock con 4 decimales fijos; antes 7 × 0,3 × 1,07 = 2,247 se redondeaba a −2 (unidad entera) con deuda de 0,247.
  // Ahora 2,247 cabe en 4 decimales: se escribe −2,247 exacto, sin deuda (cantidadExacta nula).
  it("compatibilidad: la primera venta de 7 × 0,3 × 1,07 (caso existente «Contraste») escribe -2,247 exacto, sin deuda (A1b)", async () => {
    const unidadEntera = await prisma.unidad.create({ data: { nombre: "unidad_entera_compat", magnitud: "CANTIDAD", decimales: 0 } });
    const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_HUEVOS_COMPAT", nombre: "Huevos", tipo: "MP", unidadStockId: unidadEntera.id }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_BUDIN_COMPAT", nombre: "Budín", tipo: "PV", unidadStockId: unidadEntera.id, precioVenta: 10 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.3, unidadId: unidadEntera.id, mermaPorcentaje: 7 }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: crypto.randomUUID() });

    const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 7 }] });
    expect(resultado.ok, resultado.mensaje).toBe(true);

    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: mpInsumo.id, proceso: "CONSUMO" } });
    expect(Number(mov.cantidad)).toBe(-2.247); // A1b: antes -2 (redondearACantidadDeUnidad(2.247, 0)), con deuda de +0,247
    // A1b: lo escrito ES lo exacto, así que no hay deuda y cantidadExacta queda nula (antes se llenaba con -2,247).
    expect(mov.cantidadExacta).toBeNull();
  });
});
