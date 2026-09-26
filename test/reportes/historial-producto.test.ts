import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { anularCompra } from "../../src/server/actions/movimientos/compras";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerHistorialProducto, obtenerIngredientesRecetaVigente, buscarProductoParaHistorial } from "../../src/core/reportes/historial-producto";

describe("obtenerHistorialProducto", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;

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
    mpId = (await sembrarProductoDisponible({ codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId)).id;
  });

  it("calcula el saldo corriente acumulado y mergea los conteos físicos en la misma línea de tiempo", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date("2026-01-02"), seccionId, items: [{ productoId: mpId, cantidad: -2 }] });
    // DESCARTAR con diferencia != 0: queda registrado como bitácora, sin generar ningún movimiento de Kardex.
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 20, fechaConteo: new Date("2026-01-03"), accion: "DESCARTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-04"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, undefined);
    expect(historial?.saldoActual).toBe(10 - 2 + 5);
    expect(historial?.totalMovimientos).toBe(3);
    expect(historial?.totalConteos).toBe(1);

    const eventoConteo = historial?.eventos.find((e) => e.tipo === "conteo");
    expect(eventoConteo?.conteoReal).toBe(20);

    // El saldo corriente de la última compra tiene que reflejar TODO lo anterior, sin resetear por el conteo descartado.
    const ultimaCompra = historial?.eventos.filter((e) => e.tipo === "movimiento").at(-1);
    expect(ultimaCompra?.saldoCorriente).toBe(13);
  });

  it("desde/hasta solo recorta qué se MUESTRA — el saldo corriente sigue arrancando del primer movimiento real", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, new Date("2026-01-10"), new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(1); // solo la segunda compra queda visible
    expect(historial?.eventos[0].saldoCorriente).toBe(15); // pero ya arrastra la primera compra
    expect(historial?.saldoActual).toBe(15);
  });

  it("REGRESIÓN (Plan R2): totalMovimientos/totalConteos siguen siendo el total DE SIEMPRE, incluso con un filtro `desde` que oculta movimientos anteriores", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date("2026-01-02"), seccionId, items: [{ productoId: mpId, cantidad: -2 }] });
    await registrarConteoFisico({ productoId: mpId, seccionId, conteoReal: 20, fechaConteo: new Date("2026-01-03"), accion: "DESCARTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    // Filtro que deja fuera del rango visible a los 2 primeros movimientos
    // y al conteo — igual deben contarse en el total.
    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, new Date("2026-01-10"), new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(1); // solo la compra del 15 es visible
    expect(historial?.totalMovimientos).toBe(3); // pero el total sigue contando los 3 movimientos reales
    expect(historial?.totalConteos).toBe(1); // y el conteo, aunque quedó fuera del rango visible
  });

  it("REGRESIÓN (Plan R2): con solo `hasta` (sin `desde`), se sigue viendo TODO desde el principio hasta esa fecha — sin necesidad de un saldo inicial separado", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-02-01"), seccionId, items: [{ productoId: mpId, cantidad: 3 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(2); // las dos compras de enero, no la de febrero
    expect(historial?.eventos[0].saldoCorriente).toBe(10);
    expect(historial?.eventos[1].saldoCorriente).toBe(15);
    expect(historial?.saldoActual).toBe(18); // el saldo REAL de hoy incluye la de febrero también
  });

  it("REGRESIÓN (Plan R2): con seccionId + rango de fechas combinados, el saldo inicial y el detalle respetan AMBOS filtros a la vez", async () => {
    const seccionB = (await sembrarSeccion(sucursalId, "Depósito B")).id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId: seccionB, items: [{ productoId: mpId, cantidad: 100 }] }); // otra sección, no debe contaminar
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-15"), seccionId, items: [{ productoId: mpId, cantidad: 5 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, seccionId, new Date("2026-01-10"), new Date("2026-01-31"));
    expect(historial?.eventos.length).toBe(1);
    expect(historial?.eventos[0].saldoCorriente).toBe(15); // 10 (saldo inicial de ESTA sección) + 5, sin la seccionB
    expect(historial?.totalMovimientos).toBe(2); // solo los 2 de seccionId, no el de seccionB
  });

  // --- Paso 2 del plan (docs/plan-historial-producto-mp-pv-2026-09-22.md): campos nuevos para "Cómo se compró"/"Cómo se vendió". ---

  it("precioPorUnidadStock llega desde una COMPRA real", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10, precioTotal: 1000 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, undefined);
    const compra = historial?.eventos.find((e) => e.tipo === "movimiento");
    expect(compra?.precioTotal).toBe(1000);
    expect(compra?.precioPorUnidadStock).toBe(100); // 1000 / 10kg
  });

  it("una línea sin hecho financiero propio (AJUSTE) trae precioTotal/precioPorUnidadStock en 0, no undefined", async () => {
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10, precioTotal: 1000 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date("2026-01-02"), seccionId, items: [{ productoId: mpId, cantidad: -2 }] });

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, undefined);
    const ajuste = historial?.eventos.find((e) => e.proceso === "AJUSTE");
    expect(ajuste?.precioTotal).toBe(0);
    expect(ajuste?.precioPorUnidadStock).toBe(0);
  });

  it("después de anularCompra: la compra original queda anulada:true, y el contra-asiento AJUSTE aparece como su propia fila (anulada:false)", async () => {
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: mpId, cantidad: 10, precioTotal: 1000 }] });
    expect(r.ok, r.mensaje).toBe(true);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId } });

    const anulacion = await anularCompra(compra.id);
    expect(anulacion.ok, anulacion.mensaje).toBe(true);

    const historial = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, undefined);
    expect(historial?.eventos).toHaveLength(2); // la compra original + el contra-asiento, append-only

    const original = historial?.eventos.find((e) => e.idOperacion === compra.id);
    expect(original?.anulada).toBe(true);
    expect(original?.cantidadConSigno).toBe(10); // append-only: la línea original NO se edita

    const contraAsiento = historial?.eventos.find((e) => e.idOperacion !== compra.id);
    expect(contraAsiento?.proceso).toBe("AJUSTE");
    expect(contraAsiento?.anulada).toBe(false); // el contra-asiento en sí no está anulado
    expect(contraAsiento?.cantidadConSigno).toBe(-10); // reversión

    // Con ambas líneas, el saldo neto vuelve a 0 — la anulación no queda "flotando".
    expect(historial?.saldoActual).toBe(0);
  });

  it("tieneStockPropio: true para una MP, false para un PV que no se produce, true para un PV que sí se produce", async () => {
    const pvSinProducir = await sembrarProductoDisponible({ codigo: "PV_REVENTA", nombre: "Agua", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    const pvConReceta = await sembrarProductoDisponible({ codigo: "PV_PLATO", nombre: "Pizza", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 1000, seProduce: true }, sucursalId);

    const historialMp = await obtenerHistorialProducto(sucursalId, mpId, undefined, undefined, undefined);
    expect(historialMp?.tieneStockPropio).toBe(true);

    const historialPvReventa = await obtenerHistorialProducto(sucursalId, pvSinProducir.id, undefined, undefined, undefined);
    expect(historialPvReventa?.tieneStockPropio).toBe(false);

    const historialPvProducido = await obtenerHistorialProducto(sucursalId, pvConReceta.id, undefined, undefined, undefined);
    expect(historialPvProducido?.tieneStockPropio).toBe(true);
  });

  it("D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): el historial del SUSTITUTO trae sustituyeANombre en su CONSUMO", async () => {
    const insumoOjo = await prisma.insumo.create({ data: { nombre: "Ojo de bife" } });
    const bife = await sembrarProductoDisponible({ codigo: "MP_BIFE", nombre: "Bife de chorizo", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
    const ojo = await sembrarProductoDisponible({ codigo: "MP_OJO", nombre: "Ojo de bife", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoOjo.id }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 5000 }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: bife.id, cantidad: 0.3, unidadId: unidadKgId, sustitutos: { create: [{ insumoSustitutoId: insumoOjo.id, orden: 1 }] } }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId, items: [{ productoId: ojo.id, cantidad: 1 }] });

    const r = await registrarVenta({ fecha: new Date("2026-01-02"), seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 1 }] });
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

    const historialOjo = await obtenerHistorialProducto(sucursalId, ojo.id, undefined, undefined, undefined);
    const consumo = historialOjo!.eventos.find((ev) => ev.proceso === "CONSUMO")!;
    expect(consumo.sustituyeANombre).toBe("Bife de chorizo");

    // El historial de Bife (el principal) no tiene ningún CONSUMO propio — nunca se tocó.
    const historialBife = await obtenerHistorialProducto(sucursalId, bife.id, undefined, undefined, undefined);
    expect(historialBife!.eventos.some((ev) => ev.proceso === "CONSUMO")).toBe(false);
  });
});

describe("obtenerIngredientesRecetaVigente", () => {
  let sucursalId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;
  let pvId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    mpId = (await sembrarProductoDisponible({ codigo: "MP_AGUA", nombre: "Agua mineral caja x12", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId)).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_AGUA", nombre: "Agua mineral 500ml", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 1500 }, sucursalId)).id;
  });

  it("devuelve los ingredientes de la versión MÁS RECIENTE de la receta", async () => {
    await prisma.recetaVersion.create({ data: { productoId: pvId, version: 1, ingredientes: { create: [{ insumoProductoId: mpId, cantidad: 1, unidadId: unidadKgId }] } } });
    await prisma.recetaVersion.create({ data: { productoId: pvId, version: 2, ingredientes: { create: [{ insumoProductoId: mpId, cantidad: 2, unidadId: unidadKgId }] } } });

    const ingredientes = await obtenerIngredientesRecetaVigente(pvId);
    expect(ingredientes).toEqual([{ nombre: "Agua mineral caja x12", cantidad: 2, unidad: "kg" }]); // versión 2, no la 1
  });

  it("producto sin ninguna receta: lista vacía, sin tirar error", async () => {
    expect(await obtenerIngredientesRecetaVigente(pvId)).toEqual([]);
  });
});

describe("buscarProductoParaHistorial", () => {
  it("incluye productos no disponibles en la sucursal a propósito", async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    // Sin fila DisponibilidadProducto para esta sucursal: "fila ausente = no disponible" (disponibilidad-producto.ts).
    const noDisponible = await prisma.producto.create({ data: { codigo: "MP_VIEJA", nombre: "Descontinuada", tipo: "MP", unidadStockId: catalogo.kg.id } });

    const filas = await buscarProductoParaHistorial(base.sucursal.id, "Descontinuada");
    expect(filas.map((f) => f.productoId)).toContain(noDisponible.id);
    expect(filas.find((f) => f.productoId === noDisponible.id)?.disponible).toBe(false);
  });
});
