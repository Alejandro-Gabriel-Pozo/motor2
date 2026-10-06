import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularRendimientoRecetasSimples, calcularRendimientoRecetasCompartidas } from "../../src/core/reportes/rendimiento-recetas";
import { anularCompra } from "../../src/server/actions/movimientos/compras";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";

describe("calcularRendimientoRecetasSimples", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-01-31");
  const dentroDelRango = new Date("2026-01-15");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("caso simple: un solo PV consume un producto puntual — estima compras/ventas y calcula el desvío", async () => {
    const panRallado = await sembrarProductoDisponible({ codigo: "MP_PAN", nombre: "Pan rallado", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: panRallado.id, cantidad: 0.4, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: panRallado.id, cantidad: 10 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 20 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].productoVentaNombre).toBe("Milanesa");
    expect(filas[0].cantidadActual).toBe(0.4);
    expect(filas[0].cantidadEstimada).toBe(0.5); // 10 comprado / 20 vendido
    expect(filas[0].desviacionPorcentaje).toBe(25); // (0.5 - 0.4) / 0.4 * 100
    expect(filas[0].confianza).toBe("baja"); // un solo movimiento dentro del rango = 1 semana con datos
    expect(filas[0].rotulo).toBeNull(); // cantidad != 1, no aplica ningún rótulo
  });

  it("rotula 'PRODUCTO_DE_REVENTA' cuando la receta es venta directa 1:1 sin merma (ej. una bebida envasada)", async () => {
    const casoBebida = await sembrarProductoDisponible({ codigo: "MX_BEBIDA", nombre: "Bebida caja x12", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const bebida = await sembrarProductoDisponible({ codigo: "PV_BEBIDA", nombre: "Bebida 500ml", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: bebida.id, version: 1, ingredientes: { create: [{ insumoProductoId: casoBebida.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: casoBebida.id, cantidad: 12 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: bebida.id, cantidadVendida: 10 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].rotulo).toBe("PRODUCTO_DE_REVENTA");
  });

  it("rotula 'SUBRECETA_PRODUCIDA' cuando el insumo tiene seProduce=true — nunca 'PRODUCTO_DE_REVENTA', aunque la receta sea 1:1", async () => {
    const salsaBase = await sembrarProductoDisponible({ codigo: "MP_SALSA_ROT", nombre: "Salsa base rótulo", tipo: "MP", unidadStockId: unidadKgId, seProduce: true }, sucursalId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA_ROT", nombre: "Pizza rótulo", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: salsaBase.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
    });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Pizza rótulo")!;
    expect(fila.rotulo).toBe("SUBRECETA_PRODUCIDA");
  });

  it("rotula 'PACKAGING_NO_COMESTIBLE' cuando el insumo está en el grupo No comestibles", async () => {
    const grupoNoComestibles = await prisma.grupo.create({ data: { nombre: "No comestibles" } });
    const insumoCaja = await prisma.insumo.create({ data: { nombre: "Caja de cartón", grupoId: grupoNoComestibles.id } });
    const caja = await sembrarProductoDisponible({ codigo: "MP_CAJA_ROT", nombre: "Caja de pizza", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCaja.id }, sucursalId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA_CAJA", nombre: "Pizza con caja", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: caja.id, cantidad: 1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
    });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Pizza con caja")!;
    expect(fila.rotulo).toBe("PACKAGING_NO_COMESTIBLE");
  });

  it("agrupa por Insumo: compras de TODOS los hermanos activos, no solo la MP anclada en la receta", async () => {
    const insumoCarne = await prisma.insumo.create({ data: { nombre: "Carne vacuna" } });
    const nalga = await sembrarProductoDisponible({ codigo: "MP_NALGA", nombre: "Nalga", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    const lomo = await sembrarProductoDisponible({ codigo: "MP_LOMO", nombre: "Lomo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    const bife = await sembrarProductoDisponible({ codigo: "PV_BIFE", nombre: "Bife", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    // La receta ancla en nalga — solo nalga tiene una línea de receta.
    await prisma.recetaVersion.create({
      data: { productoId: bife.id, version: 1, ingredientes: { create: [{ insumoProductoId: nalga.id, cantidad: 0.2, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: nalga.id, cantidad: 5 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: lomo.id, cantidad: 3 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: 10 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].totalComprado).toBe(8); // 5 (nalga) + 3 (lomo) — el pool entero
    expect(filas[0].cantidadEstimada).toBe(0.8); // 8 / 10
    expect(filas[0].insumoONombre).toBe("Carne vacuna"); // el nombre del Insumo, no el de la MP ancla (nalga)
  });

  it("caso compartido (2+ PVs consumen del mismo insumo/producto) se omite — Fase 2 no implementada todavía", async () => {
    const huevo = await sembrarProductoDisponible({ codigo: "MP_HUEVO", nombre: "Huevo", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    const pastel = await sembrarProductoDisponible({ codigo: "PV_PASTEL", nombre: "Pastel", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: huevo.id, cantidad: 0.1, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: pastel.id, version: 1, ingredientes: { create: [{ insumoProductoId: huevo.id, cantidad: 0.3, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: huevo.id, cantidad: 10 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 5 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toEqual([]);
  });

  it("sin movimientos en el período — devuelve la línea con estimado null y confianza 'sin_datos'", async () => {
    const sal = await sembrarProductoDisponible({ codigo: "MP_SAL", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const papas = await sembrarProductoDisponible({ codigo: "PV_PAPAS", nombre: "Papas fritas", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: papas.id, version: 1, ingredientes: { create: [{ insumoProductoId: sal.id, cantidad: 0.05, unidadId: unidadKgId }] } },
    });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidadEstimada).toBeNull();
    expect(filas[0].desviacionPorcentaje).toBeNull();
    expect(filas[0].confianza).toBe("sin_datos");
  });

  it("nunca mezcla sucursales — los movimientos de otra sucursal no cuentan", async () => {
    const otraSucursal = await prisma.sucursal.create({ data: { nombre: "Sucursal B" } });
    const otraSeccion = await sembrarSeccion(otraSucursal.id, "Depósito B");

    const queso = await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: queso.id, cantidad: 0.2, unidadId: unidadKgId }] } },
    });

    // Toda la actividad real pasa en la OTRA sucursal.
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId: otraSeccion.id, items: [{ productoId: queso.id, cantidad: 100 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId: otraSeccion.id, ventas: [{ productoId: pizza.id, cantidadVendida: 50 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidadEstimada).toBeNull(); // nada de la sucursal B se filtró acá
  });

  it("respeta el rango de fechas — movimientos fuera del rango no cuentan", async () => {
    const azucar = await sembrarProductoDisponible({ codigo: "MP_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const torta = await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: torta.id, version: 1, ingredientes: { create: [{ insumoProductoId: azucar.id, cantidad: 0.3, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2025-12-01"), seccionId, items: [{ productoId: azucar.id, cantidad: 999 }] });
    await registrarVenta({ fecha: new Date("2025-12-01"), seccionId, ventas: [{ productoId: torta.id, cantidadVendida: 999 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas[0].cantidadEstimada).toBeNull();
  });

  // --- P2 del plan (docs/plan-rendimiento-recetas-2026-09-22.md): teórico con merma + estimado neto + motivoSinEstimacion. ---

  it("con merma: el desvío se calcula contra la receta CON merma, y cantidadEstimada viaja en NETO (no en bruto)", async () => {
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA_M", nombre: "Harina con merma", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA_M", nombre: "Pizza con merma", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 1, mermaPorcentaje: 20, unidadId: unidadKgId }] } },
    });

    // Teórico bruto = 1 * 1.2 = 1.2. Comprado 13.2, vendido 10 → estimado bruto 1.32 → desvío (1.32-1.2)/1.2*100 = 10%. Estimado neto = 1.32/1.2 = 1.1.
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: harina.id, cantidad: 13.2 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: pizza.id, cantidadVendida: 10 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].cantidadEstimada).toBe(1.1); // NETO — antes del fix hubiera comparado 1.32 (bruto) contra 1 (neto): 32%, no 10%
    expect(filas[0].desviacionPorcentaje).toBe(10);
    expect(filas[0].motivoSinEstimacion).toBeNull();
  });

  it("sin compras pero CON ventas: motivoSinEstimacion explica en vez de dar -100% (antes de que PRODUCCION cuente en P3)", async () => {
    const sal = await sembrarProductoDisponible({ codigo: "MP_SAL_2", nombre: "Sal sin comprar", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const papas = await sembrarProductoDisponible({ codigo: "PV_PAPAS_2", nombre: "Papas sin compra", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: papas.id, version: 1, ingredientes: { create: [{ insumoProductoId: sal.id, cantidad: 0.05, unidadId: unidadKgId }] } },
    });
    // Solo venta — sin ninguna compra de sal en el rango (la sal ya estaba en stock de antes, fuera de este test).
    await prisma.movimientoStock.create({
      data: {
        operacionId: (await prisma.operacion.create({ data: { sucursalId, proceso: "AJUSTE", fecha: dentroDelRango, usuarioId: (await prisma.user.findFirstOrThrow()).id } })).id,
        productoId: sal.id,
        seccionId,
        proceso: "AJUSTE",
        cantidad: 10,
        detalle: "stock inicial de prueba",
        precioTotal: 0,
        precioPorUnidadStock: 0,
      },
    });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: papas.id, cantidadVendida: 5 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(1);
    expect(filas[0].totalComprado).toBe(0);
    expect(filas[0].totalVendido).toBe(5);
    expect(filas[0].cantidadEstimada).toBeNull(); // no -100%
    expect(filas[0].desviacionPorcentaje).toBeNull();
    expect(filas[0].motivoSinEstimacion).toMatch(/no hubo compras ni producción/i);
  });

  // --- P3 del plan: PRODUCCION cuenta como entrada (defecto 1 de §3 — antes un insumo producido, nunca comprado, siempre daba -100%). ---

  it("un insumo con seProduce=true (sub-receta) entra por PRODUCCION, no por compra — deja de dar -100%/null", async () => {
    const tomate = await sembrarProductoDisponible({ codigo: "MP_TOMATE", nombre: "Tomate", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const salsaBase = await sembrarProductoDisponible({ codigo: "MP_SALSA", nombre: "Salsa base", tipo: "MP", unidadStockId: unidadKgId, seProduce: true }, sucursalId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA_S", nombre: "Pizza con salsa", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: salsaBase.id, version: 1, ingredientes: { create: [{ insumoProductoId: tomate.id, cantidad: 2, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: salsaBase.id, cantidad: 0.5, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: tomate.id, cantidad: 40 }] });
    const produccion = await registrarMovimiento({ proceso: "PRODUCCION", fecha: dentroDelRango, seccionId, items: [{ productoId: salsaBase.id, cantidad: 20 }] });
    expect(produccion.ok, produccion.mensaje).toBe(true);
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: pizza.id, cantidadVendida: 10 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Pizza con salsa")!;
    expect(fila.totalComprado).toBe(0); // la salsa base nunca se COMPRA
    expect(fila.totalProducido).toBe(20);
    expect(fila.totalEntradas).toBe(20);
    expect(fila.cantidadEstimada).not.toBeNull(); // antes de P3: null (sin compras, motivoSinEstimacion) — ahora hay una estimación real
    expect(fila.motivoSinEstimacion).toBeNull();
  });

  // --- P4 del plan: Δ de stock — CONTEXTO, nunca entra en ninguna fórmula. ---

  it("reproduce el caso real del Agua: 72 comprados, 63 vendidos, el stock del insumo sube 9 dentro de la ventana", async () => {
    const aguaCaja = await sembrarProductoDisponible({ codigo: "MX_AGUA", nombre: "Agua caja x12", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const aguaBotella = await sembrarProductoDisponible({ codigo: "PV_AGUA", nombre: "Agua botella", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: aguaBotella.id, version: 1, ingredientes: { create: [{ insumoProductoId: aguaCaja.id, cantidad: 1, unidadId: unidadKgId }] } },
    });

    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: aguaCaja.id, cantidad: 72 }] });
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: aguaBotella.id, cantidadVendida: 63 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Agua botella")!;
    expect(fila.stockApertura).toBe(0); // nada antes de `desde`
    expect(fila.stockCierre).toBe(9); // 72 comprados - 63 consumidos por la venta = quedaron 9 en el depósito
    expect(fila.desviacionPorcentaje).toBeCloseTo(14.3, 1); // el % "crudo" sigue dando +14,3% — el Δstock es contexto, no corrige la fórmula
    expect(fila.bandaRuidoPct).toBeCloseTo(114.3, 1); // una sola compra de 72 (un solo lote) sobre 63 vendidos: mediana([72])/63/1*100
  });

  it("una compra anulada no mueve los saldos: el contra-asiento (AJUSTE) cancela el efecto de la compra original en el Δ de stock", async () => {
    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA_AN", nombre: "Harina anulable", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN_AN", nombre: "Pan anulable", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.4, unidadId: unidadKgId }] } },
    });

    const hoy = new Date();
    const r = await registrarMovimiento({ proceso: "COMPRA", fecha: hoy, seccionId, items: [{ productoId: harina.id, cantidad: 50 }] });
    expect(r.ok, r.mensaje).toBe(true);
    const compra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId, movimientos: { some: { productoId: harina.id } } } });
    const anulacion = await anularCompra(compra.id);
    expect(anulacion.ok, anulacion.mensaje).toBe(true);

    // El contra-asiento (AJUSTE) se escribe a la fecha REAL de la anulación (ahora), no a la fecha de la compra original — el rango tiene que cubrir las dos.
    const filas = await calcularRendimientoRecetasSimples(sucursalId, new Date(hoy.getTime() - 86_400_000), new Date(hoy.getTime() + 86_400_000), prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Pan anulable")!;
    // Si el Δstock filtrara anuladaEn: null (mal, ver §B4), solo se vería el contra-asiento (AJUSTE, -50) y el saldo daría -50, no 0.
    expect(fila.stockCierre).toBe(0);
    expect(fila.totalComprado).toBe(0); // esto SÍ filtra anuladas — una compra anulada no cuenta como entrada real
  });

  // --- P6 del plan: impacto en $ + orden del ranking (decisión 5 de §3 — no por %). ---

  it("ordena por impacto en $: un desvío grande CON costo conocido va antes que uno SIN costo conocido, aunque el % sea menor", async () => {
    const insumoA = await sembrarProductoDisponible({ codigo: "MP_IMPACTO_A", nombre: "Insumo con impacto", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const platoA = await sembrarProductoDisponible({ codigo: "PV_IMPACTO_A", nombre: "Plato con impacto", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: platoA.id, version: 1, ingredientes: { create: [{ insumoProductoId: insumoA.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: insumoA.id, cantidad: 20, precioTotal: 100 }] }); // $5/unidad
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: platoA.id, cantidadVendida: 10 }] });
    // desvío 100% (20 comprado / 10 vendido vs. receta 1); impacto = (20 - 1*10) * 5 = $50.

    const insumoB = await sembrarProductoDisponible({ codigo: "MP_IMPACTO_B", nombre: "Insumo sin costo", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const platoB = await sembrarProductoDisponible({ codigo: "PV_IMPACTO_B", nombre: "Plato sin costo", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: platoB.id, version: 1, ingredientes: { create: [{ insumoProductoId: insumoB.id, cantidad: 1, unidadId: unidadKgId }] } } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: dentroDelRango, seccionId, items: [{ productoId: insumoB.id, cantidad: 11 }] }); // sin precio — nunca se inventa un costo
    await registrarVenta({ fecha: dentroDelRango, seccionId, ventas: [{ productoId: platoB.id, cantidadVendida: 10 }] });

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const filaA = filas.find((f) => f.productoVentaNombre === "Plato con impacto")!;
    const filaB = filas.find((f) => f.productoVentaNombre === "Plato sin costo")!;
    expect(filaA.impactoPesos).toBe(50);
    expect(filaA.sinCosto).toBe(false);
    expect(filaB.impactoPesos).toBeNull();
    expect(filaB.sinCosto).toBe(true);
    expect(filas.indexOf(filaA)).toBeLessThan(filas.indexOf(filaB)); // impacto real ANTES que null, sin importar el %
  });
});

// ---------------------------------------------------------------------------
// Task #26, Diseño B: método CONTEO — dos anclas de Conteo Físico RESUELTO
// que cubren el pool entero reemplazan la estimación por compras (D1-D4).
// Escenarios A-G del plan, con las acciones reales (registrarMovimiento/
// registrarVenta/registrarConteoFisico) en orden cronológico — importante:
// `saldoSistema` de un conteo se calcula al MOMENTO de registrarlo.
// ---------------------------------------------------------------------------
describe("calcularRendimientoRecetasSimples — método CONTEO (Task #26, Diseño B)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let admin: { id: string; email: string };

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-01-31");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Agua 1:1 — MP aguaCaja / PV aguaBotella, receta cantidad 1 sin merma (el mismo caso real que el resto del archivo). */
  async function sembrarAgua() {
    const aguaCaja = await sembrarProductoDisponible({ codigo: "MP_AGUA_CONTEO", nombre: "Agua caja x12", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const aguaBotella = await sembrarProductoDisponible({ codigo: "PV_AGUA_CONTEO", nombre: "Agua botella", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: aguaBotella.id, version: 1, ingredientes: { create: [{ insumoProductoId: aguaCaja.id, cantidad: 1, unidadId: unidadKgId }] } },
    });
    return { aguaCaja, aguaBotella };
  }

  it("escenario A — acopio real (conteo del 28/01 confirma 9): 0% de desvío, método CONTEO", async () => {
    const { aguaCaja, aguaBotella } = await sembrarAgua();
    const anclaDesde = await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    expect(anclaDesde.ok, anclaDesde.mensaje).toBe(true);
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-05"), seccionId, items: [{ productoId: aguaCaja.id, cantidad: 72 }] });
    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: aguaBotella.id, cantidadVendida: 63 }] });
    const anclaHasta = await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 9, fechaConteo: new Date("2026-01-28"), accion: "AJUSTAR" });
    expect(anclaHasta.ok, anclaHasta.mensaje).toBe(true);

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Agua botella")!;
    expect(fila.metodo).toBe("CONTEO");
    expect(fila.anclaDesde?.toISOString().slice(0, 10)).toBe("2026-01-02");
    expect(fila.anclaHasta?.toISOString().slice(0, 10)).toBe("2026-01-28");
    expect(fila.consumoReal).toBe(63); // solo la venta — ningún CONTROL, el conteo confirmó que coincidía
    expect(fila.desviacionPorcentaje).toBe(0);
    expect(fila.cantidadEstimada).toBe(1); // receta 1:1 sin merma
  });

  it("escenario B — faltan 9 (conteo del 28/01 da 0, un CONTROL de -9 los corrige): +14,3%, método CONTEO", async () => {
    const { aguaCaja, aguaBotella } = await sembrarAgua();
    await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-05"), seccionId, items: [{ productoId: aguaCaja.id, cantidad: 72 }] });
    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: aguaBotella.id, cantidadVendida: 63 }] });
    const cierre = await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-28"), accion: "AJUSTAR" });
    expect(cierre.ok, cierre.mensaje).toBe(true);

    const control = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: aguaCaja.id, proceso: "CONTROL" } });
    expect(Number(control.cantidad)).toBe(-9); // 72 comprado - 63 consumido = 9 en el sistema; contado 0 → diferencia -9

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Agua botella")!;
    expect(fila.metodo).toBe("CONTEO");
    expect(fila.consumoReal).toBe(72); // 63 (venta) + 9 (lo que corrigió el CONTROL)
    expect(fila.desviacionPorcentaje).toBeCloseTo(14.3, 1);
  });

  it("escenarios C y D — SIN conteo del 28/01: +14,3%, método COMPRAS con Δstock=+9 — MISMO resultado tenga o no acopio real (el Kardex es idéntico sin un segundo conteo que lo distinga)", async () => {
    // "C" (faltan 9) y "D" (acopio real) son, a propósito, EL MISMO escenario acá: sin la segunda ancla no hay
    // forma de distinguir un caso del otro — el punto del test es justamente demostrar que ambos dan la fila
    // idéntica (D4 del plan), no que haya dos setups distintos.
    const { aguaCaja, aguaBotella } = await sembrarAgua();
    await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-05"), seccionId, items: [{ productoId: aguaCaja.id, cantidad: 72 }] });
    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: aguaBotella.id, cantidadVendida: 63 }] });
    // Sin conteo del 28/01 — solo UNA ancla (02/01): no alcanza (D4).

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Agua botella")!;
    expect(fila.metodo).toBe("COMPRAS");
    expect(fila.anclaDesde).toBeNull();
    expect(fila.anclaHasta).toBeNull();
    expect(fila.consumoReal).toBeNull();
    expect(fila.desviacionPorcentaje).toBeCloseTo(14.3, 1);
    expect(fila.stockCierre - fila.stockApertura).toBe(9); // Δstock, mostrado como advertencia de sesgo — no corrige nada
  });

  it("escenario E — traspaso saliente de 40 entre las dos anclas: 0% (NO +80%, que daría la fórmula sin filtrar la transferencia)", async () => {
    const mp = await sembrarProductoDisponible({ codigo: "MP_TRASPASO_CONTEO", nombre: "Vino en caja", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const pv = await sembrarProductoDisponible({ codigo: "PV_TRASPASO_CONTEO", nombre: "Copa de vino", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId }] } } });

    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-05"), seccionId, items: [{ productoId: mp.id, cantidad: 100 }] });
    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 60 }] });

    // Traspaso saliente hacia otra sucursal — movimiento real de Kardex, pero NUNCA es "consumo de receta" (D2).
    // Directo por prisma (mismo patrón que el resto del archivo para procesos que no expone registrarMovimiento —
    // ver "sin compras pero CON ventas" más arriba): TRANSFERENCIA_SALIDA_SUCURSAL siempre va por traspasos.ts.
    const traspaso = await prisma.operacion.create({ data: { sucursalId, proceso: "TRANSFERENCIA_SALIDA_SUCURSAL", fecha: new Date("2026-01-20"), usuarioId: admin.id } });
    await prisma.movimientoStock.create({
      data: { operacionId: traspaso.id, productoId: mp.id, seccionId, proceso: "TRANSFERENCIA_SALIDA_SUCURSAL", cantidad: -40, detalle: "Traspaso saliente de prueba", precioTotal: 0, precioPorUnidadStock: 0 },
    });

    // 100 - 60 (consumo) - 40 (traspaso) = 0 — el conteo confirma que coincide.
    const cierre = await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-28"), accion: "AJUSTAR" });
    expect(cierre.ok, cierre.mensaje).toBe(true);

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Copa de vino")!;
    expect(fila.metodo).toBe("CONTEO");
    expect(fila.consumoReal).toBe(60); // el traspaso NUNCA suma — sin filtrarlo hubiera dado 100 (consumoReal) → +66,7%, no 0%
    expect(fila.desviacionPorcentaje).toBe(0);
  });

  it("escenario F — una compra de la ventana se anula DESPUÉS de `hasta`: el resultado de B no cambia", async () => {
    const { aguaCaja, aguaBotella } = await sembrarAgua();
    await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-05"), seccionId, items: [{ productoId: aguaCaja.id, cantidad: 72 }] });

    // Una compra EXTRA dentro de la ventana, anulada YA (mismo turno del test) — `anularCompra` fecha la reversión
    // a `new Date()` (el reloj real, hoy) sin importar la fecha de la compra original: como el test corre mucho
    // después de enero de 2026, la reversión SIEMPRE cae después de `hasta`, quede fuera del tramo medido.
    const compraExtra = await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-06"), seccionId, items: [{ productoId: aguaCaja.id, cantidad: 10 }] });
    expect(compraExtra.ok, compraExtra.mensaje).toBe(true);
    const operacionExtra = await prisma.operacion.findFirstOrThrow({ where: { proceso: "COMPRA", sucursalId, fecha: new Date("2026-01-06") } });
    const anulacion = await anularCompra(operacionExtra.id);
    expect(anulacion.ok, anulacion.mensaje).toBe(true);

    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: aguaBotella.id, cantidadVendida: 63 }] });
    const cierre = await registrarConteoFisico({ productoId: aguaCaja.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-28"), accion: "AJUSTAR" });
    expect(cierre.ok, cierre.mensaje).toBe(true);

    const control = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: aguaCaja.id, proceso: "CONTROL" } });
    expect(Number(control.cantidad)).toBe(-9); // igual que B — la compra extra se cancela contra su propia reversión antes del conteo

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Agua botella")!;
    expect(fila.metodo).toBe("CONTEO");
    expect(fila.consumoReal).toBe(72); // idéntico al escenario B
    expect(fila.desviacionPorcentaje).toBeCloseTo(14.3, 1);
  });

  it("escenario G — 'salsa producida' (hoy da +300% sin conciliar): con dos anclas que cubren la producción, 0%", async () => {
    const tomate = await sembrarProductoDisponible({ codigo: "MP_TOMATE_CONTEO", nombre: "Tomate conteo", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const salsaBase = await sembrarProductoDisponible({ codigo: "MP_SALSA_CONTEO", nombre: "Salsa base conteo", tipo: "MP", unidadStockId: unidadKgId, seProduce: true }, sucursalId);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA_CONTEO", nombre: "Pizza con salsa conteo", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: salsaBase.id, version: 1, ingredientes: { create: [{ insumoProductoId: tomate.id, cantidad: 2, unidadId: unidadKgId }] } } });
    await prisma.recetaVersion.create({ data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: salsaBase.id, cantidad: 0.5, unidadId: unidadKgId }] } } });

    await registrarConteoFisico({ productoId: salsaBase.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-05"), seccionId, items: [{ productoId: tomate.id, cantidad: 40 }] });
    const produccion = await registrarMovimiento({ proceso: "PRODUCCION", fecha: new Date("2026-01-10"), seccionId, items: [{ productoId: salsaBase.id, cantidad: 20 }] });
    expect(produccion.ok, produccion.mensaje).toBe(true);
    await registrarVenta({ fecha: new Date("2026-01-15"), seccionId, ventas: [{ productoId: pizza.id, cantidadVendida: 10 }] });
    // 20 producido - 5 consumido (0.5 × 10) = 15 en depósito — el conteo confirma que coincide (0% real, no +300%).
    const cierre = await registrarConteoFisico({ productoId: salsaBase.id, seccionId, conteoReal: 15, fechaConteo: new Date("2026-01-28"), accion: "AJUSTAR" });
    expect(cierre.ok, cierre.mensaje).toBe(true);

    const filas = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    const fila = filas.find((f) => f.productoVentaNombre === "Pizza con salsa conteo")!;
    expect(fila.metodo).toBe("CONTEO");
    expect(fila.consumoReal).toBe(5); // solo lo que consumió la venta — nunca lo producido de más
    expect(fila.desviacionPorcentaje).toBe(0);
  });
});

describe("calcularRendimientoRecetasCompartidas", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-03-15");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /** Arma un pool nalga/lomo (mismo Insumo) usado por Milanesa (ancla=nalga) y Bife (ancla=lomo). */
  async function armarPoolCompartido() {
    const insumoCarne = await prisma.insumo.create({ data: { nombre: "Carne vacuna" } });
    const nalga = await sembrarProductoDisponible({ codigo: "MP_NALGA", nombre: "Nalga", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    const lomo = await sembrarProductoDisponible({ codigo: "MP_LOMO", nombre: "Lomo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    const bife = await sembrarProductoDisponible({ codigo: "PV_BIFE", nombre: "Bife", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: nalga.id, cantidad: 0.1, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: bife.id, version: 1, ingredientes: { create: [{ insumoProductoId: lomo.id, cantidad: 0.1, unidadId: unidadKgId }] } },
    });
    return { milanesa, bife };
  }

  it("resuelve un coeficiente por plato cuando hay suficiente historial y variación en la mezcla de ventas", async () => {
    const { milanesa, bife } = await armarPoolCompartido();

    // Datos generados EXACTAMENTE con Milanesa=0.15kg, Bife=0.25kg — sin
    // ruido, para poder afirmar que la regresión los recupera.
    const semanas = [
      { fecha: new Date("2026-01-05"), milanesa: 10, bife: 4 },
      { fecha: new Date("2026-01-15"), milanesa: 6, bife: 12 },
      { fecha: new Date("2026-01-25"), milanesa: 15, bife: 2 },
      { fecha: new Date("2026-02-04"), milanesa: 3, bife: 9 },
      { fecha: new Date("2026-02-14"), milanesa: 8, bife: 8 },
    ];
    for (const s of semanas) {
      const comprado = 0.15 * s.milanesa + 0.25 * s.bife;
      await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId: (await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } })).id, cantidad: comprado }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: s.milanesa }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: s.bife }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.resoluble)).toBe(true);
    expect(filas[0].r2).toBeCloseTo(1, 3);

    const filaMilanesa = filas.find((f) => f.productoVentaNombre === "Milanesa")!;
    const filaBife = filas.find((f) => f.productoVentaNombre === "Bife")!;
    expect(filaMilanesa.cantidadEstimada).toBeCloseTo(0.15, 2);
    expect(filaBife.cantidadEstimada).toBeCloseTo(0.25, 2);
    expect(filaMilanesa.cantidadPlatosEnPool).toBe(2);
    expect(filaMilanesa.rotulo).toBeNull(); // cantidad 0.1 != 1, no aplica ningún rótulo
  });

  it("no resoluble si hay pocas semanas de historial (menos que platos+1)", async () => {
    const { milanesa, bife } = await armarPoolCompartido();
    const nalga = await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } });

    // Solo 2 semanas para 2 incógnitas — no alcanza.
    for (const fecha of [new Date("2026-01-05"), new Date("2026-01-15")]) {
      await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, items: [{ productoId: nalga.id, cantidad: 5 }] });
      await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 10 }] });
      await registrarVenta({ fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: 4 }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    expect(filas.every((f) => !f.resoluble)).toBe(true);
    expect(filas.every((f) => f.cantidadEstimada === null)).toBe(true);
    expect(filas[0].motivoNoResoluble).toMatch(/semanas/i);
  });

  it("no resoluble si la mezcla de ventas nunca varía entre semanas (colineal)", async () => {
    const { milanesa, bife } = await armarPoolCompartido();
    const nalga = await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } });

    // Bife siempre es exactamente el doble de Milanesa — proporción fija, sin variación real.
    const semanas = [
      { fecha: new Date("2026-01-05"), milanesa: 5, bife: 10 },
      { fecha: new Date("2026-01-15"), milanesa: 8, bife: 16 },
      { fecha: new Date("2026-01-25"), milanesa: 3, bife: 6 },
      { fecha: new Date("2026-02-04"), milanesa: 6, bife: 12 },
    ];
    for (const s of semanas) {
      await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId: nalga.id, cantidad: 2 }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: s.milanesa }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: s.bife }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    expect(filas.every((f) => !f.resoluble)).toBe(true);
    expect(filas[0].motivoNoResoluble).toMatch(/mezcla de ventas/i);
  });

  it("un pool con un solo plato no aparece acá — es el caso simple, no el compartido", async () => {
    const panRallado = await sembrarProductoDisponible({ codigo: "MP_PAN", nombre: "Pan rallado", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA_SOLO", nombre: "Milanesa sola", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: panRallado.id, cantidad: 0.04, unidadId: unidadKgId }] } },
    });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-10"), seccionId, items: [{ productoId: panRallado.id, cantidad: 10 }] });
    await registrarVenta({ fecha: new Date("2026-01-10"), seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 20 }] });

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    expect(filas).toEqual([]);
  });

  // --- P6 del plan: totalVendido y el impacto en $ son por PLATO, no por pool. ---

  it("totalVendido en cada fila es el del PLATO (no el del pool, que es distinto para cada uno)", async () => {
    const { milanesa, bife } = await armarPoolCompartido();
    const nalga = await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } });

    const semanas = [
      { fecha: new Date("2026-01-05"), milanesa: 10, bife: 4 },
      { fecha: new Date("2026-01-15"), milanesa: 6, bife: 12 },
      { fecha: new Date("2026-01-25"), milanesa: 15, bife: 2 },
      { fecha: new Date("2026-02-04"), milanesa: 3, bife: 9 },
      { fecha: new Date("2026-02-14"), milanesa: 8, bife: 8 },
    ];
    for (const s of semanas) {
      const comprado = 0.15 * s.milanesa + 0.25 * s.bife;
      await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId: nalga.id, cantidad: comprado, precioTotal: comprado * 10 }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: s.milanesa }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: s.bife }] });
    }
    const totalMilanesa = semanas.reduce((acc, s) => acc + s.milanesa, 0); // 42
    const totalBife = semanas.reduce((acc, s) => acc + s.bife, 0); // 35

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    const filaMilanesa = filas.find((f) => f.productoVentaNombre === "Milanesa")!;
    const filaBife = filas.find((f) => f.productoVentaNombre === "Bife")!;
    expect(filaMilanesa.totalVendido).toBe(totalMilanesa);
    expect(filaBife.totalVendido).toBe(totalBife);
    expect(filaMilanesa.totalVendido).not.toBe(filaBife.totalVendido); // confirma que NO es el mismo valor repetido (el del pool)
    expect(filaMilanesa.sinCosto).toBe(false);
    expect(filaMilanesa.impactoPesos).not.toBeNull();
  });

  // --- Task #26 §6 (Diseño B): caso compartido/regresión con intervalos entre anclas de Conteo Físico. ---

  it("método CONTEO (§6): con anclas que cubren el pool entero, cada intervalo mide el consumo real — 0% de desvío (la receta real es 0.1 para ambos), no lo que sugerirían compras artificiales", async () => {
    const insumoCarne = await prisma.insumo.create({ data: { nombre: "Carne vacuna conteo" } });
    const nalga = await sembrarProductoDisponible({ codigo: "MP_NALGA_CONTEO", nombre: "Nalga conteo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    const lomo = await sembrarProductoDisponible({ codigo: "MP_LOMO_CONTEO", nombre: "Lomo conteo", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    const milanesa = await sembrarProductoDisponible({ codigo: "PV_MILA_CONTEO", nombre: "Milanesa conteo", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    const bife = await sembrarProductoDisponible({ codigo: "PV_BIFE_CONTEO", nombre: "Bife conteo", tipo: "PV", unidadStockId: unidadKgId }, sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: nalga.id, cantidad: 0.1, unidadId: unidadKgId }] } } });
    await prisma.recetaVersion.create({ data: { productoId: bife.id, version: 1, ingredientes: { create: [{ insumoProductoId: lomo.id, cantidad: 0.1, unidadId: unidadKgId }] } } });

    // Stock inicial, ANTES de la primera ancla — grande, para no quedarse sin stock durante las ventas.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2025-12-01"), seccionId, items: [{ productoId: nalga.id, cantidad: 1000 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2025-12-01"), seccionId, items: [{ productoId: lomo.id, cantidad: 1000 }] });
    await registrarConteoFisico({ productoId: nalga.id, seccionId, conteoReal: 1000, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });
    await registrarConteoFisico({ productoId: lomo.id, seccionId, conteoReal: 1000, fechaConteo: new Date("2026-01-02"), accion: "AJUSTAR" });

    // 3 intervalos entre 4 anclas (hacen falta más que los 2 platos del pool) — mismos pares (m, b) que el test
    // de la regresión semanal de arriba, pero acá NINGUNA compra artificial: el consumo real es exactamente la
    // receta (0.1 c/u), y cada ancla lo confirma sin diferencia.
    const intervalos = [
      { fecha: new Date("2026-01-10"), m: 10, b: 4, cierre: new Date("2026-01-16") },
      { fecha: new Date("2026-01-24"), m: 6, b: 12, cierre: new Date("2026-01-30") },
      { fecha: new Date("2026-02-07"), m: 15, b: 2, cierre: new Date("2026-02-13") },
    ];
    let saldoNalga = 1000;
    let saldoLomo = 1000;
    for (const t of intervalos) {
      await registrarVenta({ fecha: t.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: t.m }] });
      await registrarVenta({ fecha: t.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: t.b }] });
      saldoNalga = Math.round((saldoNalga - 0.1 * t.m) * 100) / 100;
      saldoLomo = Math.round((saldoLomo - 0.1 * t.b) * 100) / 100;
      const cierreNalga = await registrarConteoFisico({ productoId: nalga.id, seccionId, conteoReal: saldoNalga, fechaConteo: t.cierre, accion: "AJUSTAR" });
      const cierreLomo = await registrarConteoFisico({ productoId: lomo.id, seccionId, conteoReal: saldoLomo, fechaConteo: t.cierre, accion: "AJUSTAR" });
      expect(cierreNalga.ok, cierreNalga.mensaje).toBe(true);
      expect(cierreLomo.ok, cierreLomo.mensaje).toBe(true);
    }

    expect(await prisma.movimientoStock.count({ where: { proceso: "CONTROL" } })).toBe(0); // ningún conteo dio diferencia — nunca hizo falta ajustar

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    const filaMilanesa = filas.find((f) => f.productoVentaNombre === "Milanesa conteo")!;
    const filaBife = filas.find((f) => f.productoVentaNombre === "Bife conteo")!;
    expect(filaMilanesa.metodo).toBe("CONTEO");
    expect(filaBife.metodo).toBe("CONTEO");
    expect(filaMilanesa.resoluble).toBe(true);
    expect(filaMilanesa.semanasConDatos).toBe(3); // 3 intervalos entre las 4 anclas, no semanas de compras
    expect(filaMilanesa.cantidadEstimada).toBeCloseTo(0.1, 2);
    expect(filaBife.cantidadEstimada).toBeCloseTo(0.1, 2);
    expect(filaMilanesa.desviacionPorcentaje).toBeCloseTo(0, 0);
    expect(filaBife.desviacionPorcentaje).toBeCloseTo(0, 0);
    expect(filaMilanesa.bandaRuidoPct).toBeNull(); // método CONTEO: sin banda de ruido de lote (D4)
  });

  it("sin suficientes anclas (o si el intento por CONTEO no es resoluble) cae al método COMPRAS de siempre, sin dejar la fila sin estimar", async () => {
    const { milanesa, bife } = await armarPoolCompartido();
    const nalga = await prisma.producto.findFirstOrThrow({ where: { codigo: "MP_NALGA" } });

    // Un solo Conteo Físico (ninguna segunda ancla) — no alcanza para el método CONTEO, cae al de compras/semanas de siempre.
    await registrarConteoFisico({ productoId: nalga.id, seccionId, conteoReal: 0, fechaConteo: new Date("2026-01-01"), accion: "AJUSTAR" });

    const semanas = [
      { fecha: new Date("2026-01-05"), milanesa: 10, bife: 4 },
      { fecha: new Date("2026-01-15"), milanesa: 6, bife: 12 },
      { fecha: new Date("2026-01-25"), milanesa: 15, bife: 2 },
    ];
    for (const s of semanas) {
      const comprado = 0.15 * s.milanesa + 0.25 * s.bife;
      await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId: nalga.id, cantidad: comprado }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: s.milanesa }] });
      await registrarVenta({ fecha: s.fecha, seccionId, ventas: [{ productoId: bife.id, cantidadVendida: s.bife }] });
    }

    const filas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    const filaMilanesa = filas.find((f) => f.productoVentaNombre === "Milanesa")!;
    expect(filaMilanesa.metodo).toBe("COMPRAS");
    expect(filaMilanesa.resoluble).toBe(true); // la regresión semanal de siempre sigue funcionando
    expect(filaMilanesa.cantidadEstimada).toBeCloseTo(0.15, 2);
  });
});

describe("escenario realista: 6 insumos × 4 platos, superpuestos entre sí", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;

  const desde = new Date("2026-01-01");
  const hasta = new Date("2026-03-15");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  /**
   * Cada insumo es un pool distinto (sin agrupar por Insumo — el mismo
   * producto puntual referenciado directo desde varias recetas ya alcanza
   * para "compartido", no hace falta que además sean cortes hermanos).
   * Ningún plato usa el mismo conjunto de insumos que otro:
   *   Milanesa → Carne, Pan rallado, Huevo
   *   Bife     → Carne, Aceite, Queso
   *   Pollo    → Huevo, Aceite
   *   Ensalada → Aceite, Lechuga, Queso
   * Carne/Huevo/Queso: 2 platos. Aceite: 3 platos. Pan rallado/Lechuga: 1
   * plato (caso simple). Prueba que cada pool se resuelve de forma
   * independiente con el subconjunto correcto de platos, sin que insumos o
   * platos no relacionados se crucen entre sí.
   */
  it("resuelve cada pool de forma independiente, sin que se crucen platos ni insumos no relacionados", async () => {
    const [carne, panRallado, huevo, aceite, lechuga, queso] = await Promise.all(
      ["Carne", "Pan rallado", "Huevo", "Aceite", "Lechuga", "Queso"].map((nombre, i) =>
        sembrarProductoDisponible({ codigo: `MP_${i}`, nombre, tipo: "MP", unidadStockId: unidadKgId }, sucursalId)
      )
    );
    const [milanesa, bife, pollo, ensalada] = await Promise.all(
      ["Milanesa", "Bife", "Pollo", "Ensalada"].map((nombre, i) =>
        sembrarProductoDisponible({ codigo: `PV_${i}`, nombre, tipo: "PV", unidadStockId: unidadKgId }, sucursalId)
      )
    );

    const COEF = {
      carneM: 0.1, carneB: 0.2,
      panM: 0.03,
      huevoM: 0.05, huevoP: 0.08,
      aceiteB: 0.02, aceiteP: 0.015, aceiteE: 0.04,
      lechugaE: 0.15,
      quesoB: 0.03, quesoE: 0.06,
    };

    await prisma.recetaVersion.create({
      data: {
        productoId: milanesa.id, version: 1,
        ingredientes: {
          create: [
            { insumoProductoId: carne.id, cantidad: COEF.carneM, unidadId: unidadKgId },
            { insumoProductoId: panRallado.id, cantidad: COEF.panM, unidadId: unidadKgId },
            { insumoProductoId: huevo.id, cantidad: COEF.huevoM, unidadId: unidadKgId },
          ],
        },
      },
    });
    await prisma.recetaVersion.create({
      data: {
        productoId: bife.id, version: 1,
        ingredientes: {
          create: [
            { insumoProductoId: carne.id, cantidad: COEF.carneB, unidadId: unidadKgId },
            { insumoProductoId: aceite.id, cantidad: COEF.aceiteB, unidadId: unidadKgId },
            { insumoProductoId: queso.id, cantidad: COEF.quesoB, unidadId: unidadKgId },
          ],
        },
      },
    });
    await prisma.recetaVersion.create({
      data: {
        productoId: pollo.id, version: 1,
        ingredientes: {
          create: [
            { insumoProductoId: huevo.id, cantidad: COEF.huevoP, unidadId: unidadKgId },
            { insumoProductoId: aceite.id, cantidad: COEF.aceiteP, unidadId: unidadKgId },
          ],
        },
      },
    });
    await prisma.recetaVersion.create({
      data: {
        productoId: ensalada.id, version: 1,
        ingredientes: {
          create: [
            { insumoProductoId: aceite.id, cantidad: COEF.aceiteE, unidadId: unidadKgId },
            { insumoProductoId: lechuga.id, cantidad: COEF.lechugaE, unidadId: unidadKgId },
            { insumoProductoId: queso.id, cantidad: COEF.quesoE, unidadId: unidadKgId },
          ],
        },
      },
    });

    // 6 semanas de ventas reales (M/B/P/E), con mezcla variable — y las
    // compras de cada insumo se derivan EXACTO de esos coeficientes, para
    // poder afirmar que la regresión los recupera.
    const semanas = [
      { fecha: new Date("2026-01-05"), M: 10, B: 4, P: 6, E: 3 },
      { fecha: new Date("2026-01-15"), M: 6, B: 12, P: 2, E: 9 },
      { fecha: new Date("2026-01-25"), M: 15, B: 2, P: 10, E: 5 },
      { fecha: new Date("2026-02-04"), M: 3, B: 9, P: 4, E: 12 },
      { fecha: new Date("2026-02-14"), M: 8, B: 8, P: 7, E: 6 },
      { fecha: new Date("2026-02-24"), M: 12, B: 5, P: 3, E: 8 },
    ];

    for (const s of semanas) {
      // Compra primero, venta después — una venta consume stock vía receta
      // (Milanesa/Bife/Pollo/Ensalada generan CONSUMO de sus ingredientes),
      // así que vender antes de tener stock comprado hace fallar la venta.
      const compras: Array<[string, number]> = [
        [carne.id, COEF.carneM * s.M + COEF.carneB * s.B],
        [panRallado.id, COEF.panM * s.M],
        [huevo.id, COEF.huevoM * s.M + COEF.huevoP * s.P],
        [aceite.id, COEF.aceiteB * s.B + COEF.aceiteP * s.P + COEF.aceiteE * s.E],
        [lechuga.id, COEF.lechugaE * s.E],
        [queso.id, COEF.quesoB * s.B + COEF.quesoE * s.E],
      ];
      for (const [productoId, cantidad] of compras) {
        // La unidad "kg" solo guarda 2 decimales (redondearCantidadDeUnidad)
        // — un buffer de menos de 0.01 se pierde en ese redondeo y el saldo
        // guardado queda por debajo del "requerido" en punto flotante crudo
        // (ej. 3.00 < 3.0000000000000004). Redondear hacia arriba a 2
        // decimales y sumar otro 0.01 asegura stock real de sobra, muy por
        // debajo de la tolerancia de los asserts de más abajo. La suma se hace en centésimos ENTEROS: `x / 100 + 0.01` deja ruido de
        // punto flotante (3.0000000000000004), que la Compra ya no redondea en silencio sino que rechaza por tener más de 2 decimales
        // (docs/plan-validacion-de-datos-2026-09-25.md).
        const compra = await registrarMovimiento({ proceso: "COMPRA", fecha: s.fecha, seccionId, items: [{ productoId, cantidad: (Math.ceil(cantidad * 100) + 1) / 100 }] });
        expect(compra.ok, compra.mensaje).toBe(true);
      }

      const resultadoVenta = await registrarVenta({
        fecha: s.fecha, seccionId,
        ventas: [
          { productoId: milanesa.id, cantidadVendida: s.M },
          { productoId: bife.id, cantidadVendida: s.B },
          { productoId: pollo.id, cantidadVendida: s.P },
          { productoId: ensalada.id, cantidadVendida: s.E },
        ],
      });
      expect(resultadoVenta.ok, resultadoVenta.mensaje).toBe(true);
    }

    const [simples, compartidas] = await Promise.all([
      calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma),
      calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma),
    ]);

    // Pan rallado y Lechuga: caso simple, un solo plato cada uno.
    expect(simples).toHaveLength(2);
    const filaPan = simples.find((f) => f.insumoONombre === "Pan rallado")!;
    expect(filaPan.cantidadEstimada).toBeCloseTo(COEF.panM, 2);
    const filaLechuga = simples.find((f) => f.insumoONombre === "Lechuga")!;
    expect(filaLechuga.cantidadEstimada).toBeCloseTo(COEF.lechugaE, 2);

    // Carne, Huevo, Queso (2 platos) y Aceite (3 platos): caso compartido, 4 pools, 10 filas.
    expect(compartidas).toHaveLength(2 + 2 + 3 + 2); // Carne(2) + Huevo(2) + Aceite(3) + Queso(2)
    expect(compartidas.every((f) => f.resoluble)).toBe(true);

    const porInsumoYPlato = (insumo: string, plato: string) => compartidas.find((f) => f.insumoONombre === insumo && f.productoVentaNombre === plato)!;
    expect(porInsumoYPlato("Carne", "Milanesa").cantidadEstimada).toBeCloseTo(COEF.carneM, 2);
    expect(porInsumoYPlato("Carne", "Bife").cantidadEstimada).toBeCloseTo(COEF.carneB, 2);
    expect(porInsumoYPlato("Huevo", "Milanesa").cantidadEstimada).toBeCloseTo(COEF.huevoM, 2);
    expect(porInsumoYPlato("Huevo", "Pollo").cantidadEstimada).toBeCloseTo(COEF.huevoP, 2);
    expect(porInsumoYPlato("Aceite", "Bife").cantidadEstimada).toBeCloseTo(COEF.aceiteB, 2);
    expect(porInsumoYPlato("Aceite", "Pollo").cantidadEstimada).toBeCloseTo(COEF.aceiteP, 2);
    expect(porInsumoYPlato("Aceite", "Ensalada").cantidadEstimada).toBeCloseTo(COEF.aceiteE, 2);
    expect(porInsumoYPlato("Queso", "Bife").cantidadEstimada).toBeCloseTo(COEF.quesoB, 2);
    expect(porInsumoYPlato("Queso", "Ensalada").cantidadEstimada).toBeCloseTo(COEF.quesoE, 2);

    // Ningún plato/insumo no relacionado se cruzó: Pollo nunca usó Carne/Pan rallado/Lechuga/Queso.
    expect(compartidas.some((f) => f.productoVentaNombre === "Pollo" && f.insumoONombre === "Carne")).toBe(false);
    expect(compartidas.some((f) => f.productoVentaNombre === "Milanesa" && f.insumoONombre === "Aceite")).toBe(false);
  });
});
