import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta, anularVenta } from "../../src/server/actions/movimientos/venta";
import { type ActorVenta } from "../../src/core/movimientos/registrar-venta";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * La venta consume el insumo sustituto declarado cuando el principal (y sus hermanos) se agotan (docs/plan-sustitucion-insumos-
 * receta-2026-09-26.md, paso 8): integración de punta a punta contra Postgres, sobre el núcleo puro ya probado en
 * test/core/origen-venta-sustitutos.test.ts.
 */
describe("venta: consumo de un insumo sustituto declarado en la línea de receta", () => {
  let sucursalId: string;
  let seccionId: string;
  let actor: ActorVenta;
  let kgId: string;
  let gId: string;
  let bifeId: string;
  let ojoId: string;
  let insumoBifeId: string;
  let insumoOjoId: string;
  let milanesaId: string;
  let bifeALaParrillaId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    actor = { usuarioId: admin.id, sucursalId, sucursalNombre: "Central" };

    kgId = (await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } })).id;
    gId = (await prisma.unidad.create({ data: { nombre: "g", magnitud: "PESO", decimales: 0 } })).id;
    const insumoBife = await prisma.insumo.create({ data: { nombre: "Bife de chorizo" } });
    const insumoOjo = await prisma.insumo.create({ data: { nombre: "Ojo de bife" } });
    insumoBifeId = insumoBife.id;
    insumoOjoId = insumoOjo.id;

    bifeId = (await sembrarProductoDisponible({ codigo: "MP_BIFE", nombre: "Bife de chorizo", tipo: "MP", unidadStockId: kgId, insumoId: insumoBifeId }, sucursalId)).id;
    ojoId = (await sembrarProductoDisponible({ codigo: "MP_OJO", nombre: "Ojo de bife", tipo: "MP", unidadStockId: kgId, insumoId: insumoOjoId }, sucursalId)).id;
    milanesaId = (await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: kgId, precioVenta: 5000 }, sucursalId)).id;
    bifeALaParrillaId = (await sembrarProductoDisponible({ codigo: "PV_BIFE", nombre: "Bife a la parrilla", tipo: "PV", unidadStockId: kgId, precioVenta: 8000 }, sucursalId)).id;

    // Milanesa: 0,3 kg de Bife, con Ojo declarado como sustituto. "Bife a la parrilla": 0,2 kg de Bife, SIN sustitutos.
    await prisma.recetaVersion.create({
      data: { productoId: milanesaId, version: 1, ingredientes: { create: [{ insumoProductoId: bifeId, cantidad: 0.3, unidadId: kgId, sustitutos: { create: [{ insumoSustitutoId: insumoOjoId, orden: 1 }] } }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: bifeALaParrillaId, version: 1, ingredientes: { create: [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId }] } },
    });
  });

  const filaConsumo = (productoId: string) => prisma.movimientoStock.findFirst({ where: { productoId, proceso: "CONSUMO" } });

  it("mostrador con Bife=0 y Ojo=1: la venta sale, la fila CONSUMO de Ojo lleva sustituyeAProductoId=Bife y el detalle de D6", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });

    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
    expect(r).toEqual({ ok: true, mensaje: "Se registraron 1 venta(s) correctamente." });

    const fila = await filaConsumo(ojoId);
    expect(fila).toMatchObject({
      productoId: ojoId,
      seccionId,
      sustituyeAProductoId: bifeId,
      detalle: 'Consumo por venta de "Milanesa" — SUSTITUTO de "Bife de chorizo" (no había stock).',
    });
    expect(Number(fila!.cantidad)).toBe(-0.3);
    expect(await calcularSaldoTotal(bifeId, seccionId, prisma)).toBe(0);
    expect(await calcularSaldoTotal(ojoId, seccionId, prisma)).toBe(0.7);
  });

  it('"Bife a la parrilla" (sin sustitutos declarados): mismo rechazo de siempre cuando Bife no alcanza', async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });

    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: bifeALaParrillaId, cantidadVendida: 1 }] });
    expect(r).toEqual({ ok: false, mensaje: 'Stock insuficiente para "Bife de chorizo". Actual: 0, requerido: 0.2.' });
    expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);
  });

  it("POS (secciones automáticas): un hermano en el respaldo se consume ANTES que el sustituto en la habitual", async () => {
    const bifeB = await sembrarProductoDisponible({ codigo: "MP_BIFE_B", nombre: "Bife de chorizo B", tipo: "MP", unidadStockId: kgId, insumoId: insumoBifeId }, sucursalId);
    const cocina = await sembrarSeccion(sucursalId, "Cocina");
    await prisma.seccionHabitualProducto.create({ data: { sucursalId, productoId: milanesaId, seccionId: cocina.id } });
    // Hermano de Bife, en el RESPALDO (Depósito): alcanza justo.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: bifeB.id, cantidad: 0.3 }] });
    // Sustituto, en la HABITUAL (Cocina): de sobra, pero no tendría que usarse.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: cocina.id, items: [{ productoId: ojoId, cantidad: 1 }] });

    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "automatico" }, lineas: [{ productoId: milanesaId, cantidadVendida: 1 }] })
    );
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

    expect(await calcularSaldoTotal(bifeB.id, seccionId, prisma)).toBe(0);
    expect(await calcularSaldoTotal(ojoId, cocina.id, prisma)).toBe(1); // sin tocar
    const fila = await filaConsumo(bifeB.id);
    expect(fila).not.toBeNull();
    expect(fila!.sustituyeAProductoId).toBeNull();
  });

  it("todo o nada (D4): sustituto insuficiente da el MISMO aviso de stock negativo que sin sustituto", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 0.1 }] });

    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, actor, { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: milanesaId, cantidadVendida: 1 }] }, { permitirStockNegativo: true })
    );
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    if (!r.ok) return;
    expect(r.avisosStockNegativo).toEqual([{ productoId: bifeId, nombre: "Bife de chorizo", seccionId, seccionNombre: "Depósito", actual: 0, requerido: 0.3, resultante: -0.3 }]);
    // El sustituto no se tocó (todo o nada): sigue con su 0,1 completo.
    expect(await calcularSaldoTotal(ojoId, seccionId, prisma)).toBe(0.1);
    const filaBife = await filaConsumo(bifeId);
    expect(filaBife!.sustituyeAProductoId).toBeNull();
  });

  describe("defensas al vender (D8): un sustituto inválido no se usa, la venta se comporta como si no lo tuviera declarado", () => {
    const mensajeEsperado = 'Stock insuficiente para "Bife de chorizo". Actual: 0, requerido: 0.3.';

    it("Insumo sustituto con una MP de otra unidad de stock", async () => {
      // El Insumo del sustituto solo tiene una MP en gramos — no comparte unidad con Bife (kg).
      await prisma.producto.update({ where: { id: ojoId }, data: { unidadStockId: gId } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1000 }] });

      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
      expect(r).toEqual({ ok: false, mensaje: mensajeEsperado });
    });

    it("MP del sustituto no disponible en la sucursal", async () => {
      await prisma.disponibilidadProducto.updateMany({ where: { productoId: ojoId, sucursalId }, data: { disponible: false } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });

      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
      expect(r).toEqual({ ok: false, mensaje: mensajeEsperado });
    });

    it("Insumo sustituto inactivo", async () => {
      await prisma.insumo.update({ where: { id: insumoOjoId }, data: { activo: false } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });

      const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
      expect(r).toEqual({ ok: false, mensaje: mensajeEsperado });
    });
  });

  it("D7: costoUnitarioVenta es el mismo con o sin sustitución (anclado al costo de reposición de Bife)", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-01"), seccionId, items: [{ productoId: bifeId, cantidad: 1, precioTotal: 1000 }] });

    // Con Bife de sobra: sin sustitución.
    const r1 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
    expect(r1.ok, r1.ok ? "" : r1.mensaje).toBe(true);
    const ventaSinSustitucion = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: milanesaId, proceso: "VENTA" } });

    // Ahora Bife se agota y hay que sustituir con Ojo.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });
    const r2 = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
    expect(r2.ok, r2.ok ? "" : r2.mensaje).toBe(true);
    const ventasConSustitucion = await prisma.movimientoStock.findMany({ where: { productoId: milanesaId, proceso: "VENTA" }, orderBy: { creadoEn: "asc" } });
    const ventaConSustitucion = ventasConSustitucion[ventasConSustitucion.length - 1];

    expect(Number(ventaSinSustitucion.costoUnitarioVenta)).toBe(300); // 0,3 kg × 1000/kg
    expect(Number(ventaConSustitucion.costoUnitarioVenta)).toBe(Number(ventaSinSustitucion.costoUnitarioVenta));
  });

  it("anularVenta devuelve el saldo del sustituto (Ojo), leyendo cada fila por su productoId real", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
    expect(r.ok).toBe(true);
    expect(await calcularSaldoTotal(ojoId, seccionId, prisma)).toBe(0.7);

    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    const anulacion = await anularVenta(venta.id);
    expect(anulacion.ok, anulacion.mensaje).toBe(true);
    expect(await calcularSaldoTotal(ojoId, seccionId, prisma)).toBe(1);
    expect(await calcularSaldoTotal(bifeId, seccionId, prisma)).toBe(0);
  });

  it("sustituto en consignación: la fila LIQUIDACION_CONSIGNACION se genera sobre el sustituto, no sobre el principal", async () => {
    const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Bodega" } });
    await prisma.producto.update({ where: { id: ojoId }, data: { esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 200 } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 1 }] });

    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: milanesaId, cantidadVendida: 1 }] });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

    const liquidacion = await prisma.movimientoStock.findFirst({ where: { proceso: "LIQUIDACION_CONSIGNACION" } });
    expect(liquidacion).toMatchObject({ productoId: ojoId, precioPorUnidadStock: expect.anything() });
    expect(Number(liquidacion!.precioTotal)).toBe(60); // 0,3 kg × 200
    const liquidacionDeBife = await prisma.movimientoStock.findFirst({ where: { proceso: "LIQUIDACION_CONSIGNACION", productoId: bifeId } });
    expect(liquidacionDeBife).toBeNull();
  });

  it("equidad entre líneas de punta a punta (D5): Ojo alcanza justo para su propia línea, la sustitución de Milanesa no se lo saca", async () => {
    const ojoALaParrillaId = (await sembrarProductoDisponible({ codigo: "PV_OJO", nombre: "Ojo a la parrilla", tipo: "PV", unidadStockId: kgId, precioVenta: 9000 }, sucursalId)).id;
    await prisma.recetaVersion.create({ data: { productoId: ojoALaParrillaId, version: 1, ingredientes: { create: [{ insumoProductoId: ojoId, cantidad: 0.5, unidadId: kgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: ojoId, cantidad: 0.5 }] });

    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(
        tx,
        actor,
        { fecha: new Date(), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: milanesaId, cantidadVendida: 1 }, { productoId: ojoALaParrillaId, cantidadVendida: 1 }] },
        { permitirStockNegativo: true }
      )
    );
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    if (!r.ok) return;
    // "Ojo a la parrilla" sale completo, sin aviso.
    expect(r.avisosStockNegativo).toEqual([{ productoId: bifeId, nombre: "Bife de chorizo", seccionId, seccionNombre: "Depósito", actual: 0, requerido: 0.3, resultante: -0.3 }]);
    expect(await calcularSaldoTotal(ojoId, seccionId, prisma)).toBe(0);
    const filaOjoConsumida = await prisma.movimientoStock.findFirst({ where: { productoId: ojoId, proceso: "CONSUMO" } });
    expect(filaOjoConsumida!.sustituyeAProductoId).toBeNull(); // fue el consumo DIRECTO de "Ojo a la parrilla", no una sustitución
  });

  it("sin ninguna línea con sustitutos declarados: TODAS las filas de una venta mixta quedan con sustituyeAProductoId === null (caracterización del paso 1, sin tocar ese archivo)", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: bifeId, cantidad: 1 }] });
    const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: bifeALaParrillaId, cantidadVendida: 1 }] });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

    const filas = await prisma.movimientoStock.findMany({ where: { proceso: { in: ["VENTA", "CONSUMO", "LIQUIDACION_CONSIGNACION"] } } });
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.sustituyeAProductoId === null)).toBe(true);
  });
});
