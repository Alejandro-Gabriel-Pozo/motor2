import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularCostosYMargenes } from "../../src/core/reportes/costos";
import { calcularRendimientoRecetasSimples, calcularRendimientoRecetasCompartidas } from "../../src/server/consultas/reportes/rendimiento-recetas";
import { generarReporteDiferenciasAjustes } from "../../src/server/consultas/reportes/diferencias-ajustes";
import { claveCostoHistorico } from "../../src/core/reportes/costo-historico";
import { reconstruirCostosDeVenta } from "../../src/server/consultas/reportes/costo-historico";

/**
 * Test de caracterización (plan docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 1) — capturado EXACTO del
 * comportamiento de HOY, ANTES de tocar nada de código de producción. Este archivo NO se modifica en ningún paso posterior:
 * es la prueba de que, para quien nunca calibra un rendimiento por sucursal, nada cambia ni un centavo ni un gramo.
 *
 * Fixture única, reusada por todos los `it`: un Insumo ("Carne") con dos hermanos (CarneA/CarneB) y lotes con vencimiento
 * distinto (ejercita el reparto FEFO por familia, H9, en dos hermanos a la vez); una subreceta producida (SalsaBase, MP
 * `seProduce`, con su propia receta sobre Tomate); un PV `seProduce` (Pizza, que consume su receta al PRODUCIRSE, no al
 * venderse). Cantidades/mermas de receta: 0.3333/12.5 (Milanesa-CarneA), 0.1/0 (BifeCaballo-CarneB y Pizza-SalsaBase),
 * 2.5/33.33 (SalsaBase-Tomate).
 *
 * Los valores de los `expect` son literales, capturados de una corrida real contra el código de HOY (sin ninguna calibración
 * por sucursal, que todavía no existe) — no se derivaron a mano.
 */
describe("Caracterización: consumo y costo ANTES del rendimiento por sucursal (no modificar)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let carneA: { id: string }, carneB: { id: string }, tomate: { id: string }, salsaBase: { id: string };
  let milanesa: { id: string }, bifeCaballo: { id: string }, pizza: { id: string };

  const fecha = new Date("2026-03-10T12:00:00Z");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    unidadKgId = kg.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const insumoCarne = await prisma.insumo.create({ data: { nombre: "Carne (familia)" } });

    // precioVenta en $80 aunque sea MP: obtenerReportePromociones lee Producto.precioVenta de cada insumo tal cual (construirMapaProductos), sin
    // importar tipo — es el "valor a la carta" que usa el caso (g) de abajo.
    carneA = await sembrarProductoDisponible({ codigo: "MP_CARNE_A", nombre: "Carne A", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id, precioVenta: 80 }, sucursalId);
    carneB = await sembrarProductoDisponible({ codigo: "MP_CARNE_B", nombre: "Carne B", tipo: "MP", unidadStockId: unidadKgId, insumoId: insumoCarne.id }, sucursalId);
    tomate = await sembrarProductoDisponible({ codigo: "MP_TOMATE", nombre: "Tomate", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
    salsaBase = await sembrarProductoDisponible({ codigo: "MP_SALSA_BASE", nombre: "Salsa base", tipo: "MP", unidadStockId: unidadKgId, seProduce: true }, sucursalId);
    milanesa = await sembrarProductoDisponible({ codigo: "PV_MILANESA", nombre: "Milanesa", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 }, sucursalId);
    bifeCaballo = await sembrarProductoDisponible({ codigo: "PV_BIFE_CABALLO", nombre: "Bife a caballo", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 120 }, sucursalId);
    pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: unidadKgId, seProduce: true, precioVenta: 150 }, sucursalId);

    await prisma.recetaVersion.create({
      data: { productoId: salsaBase.id, version: 1, ingredientes: { create: [{ insumoProductoId: tomate.id, cantidad: 2.5, mermaPorcentaje: 33.33, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: carneA.id, cantidad: 0.3333, mermaPorcentaje: 12.5, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: bifeCaballo.id, version: 1, ingredientes: { create: [{ insumoProductoId: carneB.id, cantidad: 0.1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
    });
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: salsaBase.id, cantidad: 0.1, mermaPorcentaje: 0, unidadId: unidadKgId }] } },
    });

    // Compras — fijan el costo de reposición de cada MP comprada.
    await registrarMovimiento({
      proceso: "COMPRA", fecha, seccionId,
      items: [{ productoId: tomate.id, cantidad: 100, precioTotal: 500 }], // $5/kg
    });
    // Dos lotes de la MISMA familia (Carne), vencimientos distintos — CarneB vence antes: FEFO la consume primero.
    await registrarMovimiento({
      proceso: "COMPRA", fecha, seccionId,
      items: [{ productoId: carneB.id, cantidad: 0.6, precioTotal: 30, loteVencimiento: new Date("2026-03-15T00:00:00Z") }], // $50/kg
    });
    await registrarMovimiento({
      proceso: "COMPRA", fecha, seccionId,
      items: [{ productoId: carneA.id, cantidad: 5, precioTotal: 250, loteVencimiento: new Date("2026-04-01T00:00:00Z") }], // $50/kg
    });

    // Subreceta producida: 2 kg de SalsaBase consumen Tomate según su propia receta.
    const produccionSalsa = await registrarMovimiento({ proceso: "PRODUCCION", fecha, seccionId, items: [{ productoId: salsaBase.id, cantidad: 2 }] });
    expect(produccionSalsa.ok, produccionSalsa.mensaje).toBe(true);

    // Pizza (PV `seProduce`) también se produce ANTES de venderse: consume SalsaBase acá, no al venderse.
    const produccionPizza = await registrarMovimiento({ proceso: "PRODUCCION", fecha, seccionId, items: [{ productoId: pizza.id, cantidad: 3 }] });
    expect(produccionPizza.ok, produccionPizza.mensaje).toBe(true);

    // Ventas: Milanesa consume CarneA (ancla) con reparto de familia (H9) — parte de CarneB (vence antes, se agota) + parte de
    // CarneA. Bife a caballo consume CarneB (ancla) directo. Pizza no vuelve a consumir su receta (ya se produjo arriba).
    const ventaMilanesa = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: milanesa.id, cantidadVendida: 3 }] });
    expect(ventaMilanesa.ok, ventaMilanesa.mensaje).toBe(true);
    const ventaBife = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: bifeCaballo.id, cantidadVendida: 5 }] });
    expect(ventaBife.ok, ventaBife.mensaje).toBe(true);
    const ventaPizza = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: pizza.id, cantidadVendida: 2 }] });
    expect(ventaPizza.ok, ventaPizza.mensaje).toBe(true);
  });

  it("(a) registrarVenta: filas de MovimientoStock exactas, con reparto FEFO por familia entre los dos hermanos", async () => {
    const filas = await prisma.movimientoStock.findMany({
      where: { operacion: { proceso: "VENTA" } },
      include: { producto: { select: { nombre: true } } },
      orderBy: [{ operacionId: "asc" }, { productoId: "asc" }],
    });
    const resumen = filas.map((f) => ({ producto: f.producto.nombre, proceso: f.proceso, cantidad: Number(f.cantidad) }));

    // Milanesa: cantidadSalida = 3 × 0.3333 × 1.125 = 1.1248875 — repartido FEFO: CarneB (vence 03-15, agota su lote de 0.6)
    // primero, el resto de CarneA (vence 04-01).
    expect(resumen).toContainEqual({ producto: "Carne B", proceso: "CONSUMO", cantidad: -0.6 });
    expect(resumen).toContainEqual({ producto: "Carne A", proceso: "CONSUMO", cantidad: -0.52 });
    expect(resumen).toContainEqual({ producto: "Milanesa", proceso: "VENTA", cantidad: -3 });

    // Bife a caballo: 5 × 0.1 × 1 = 0.5 — CarneB ya está agotada por la venta de Milanesa, sale todo de CarneA.
    expect(resumen).toContainEqual({ producto: "Carne A", proceso: "CONSUMO", cantidad: -0.5 });
    expect(resumen).toContainEqual({ producto: "Bife a caballo", proceso: "VENTA", cantidad: -5 });

    // Pizza (`seProduce`): la venta NO vuelve a consumir SalsaBase — solo resta su propio stock.
    expect(resumen.filter((f) => f.producto === "Pizza")).toEqual([{ producto: "Pizza", proceso: "VENTA", cantidad: -2 }]);
    expect(resumen.some((f) => f.producto === "Salsa base" && f.proceso === "CONSUMO")).toBe(false);

    expect(filas).toHaveLength(6);
  });

  it("(b) registrarMovimiento PRODUCCION: filas de consumo de la subreceta y de la producción de Pizza", async () => {
    const filas = await prisma.movimientoStock.findMany({
      where: { operacion: { proceso: "PRODUCCION" } },
      include: { producto: { select: { nombre: true } } },
      orderBy: [{ operacionId: "asc" }, { proceso: "asc" }, { productoId: "asc" }],
    });
    const resumen = filas.map((f) => ({ producto: f.producto.nombre, proceso: f.proceso, cantidad: Number(f.cantidad) }));

    // Producir 2 kg de SalsaBase: consume Tomate 2 × 2.5 × 1.3333 = 6.6665 → redondeado a 2 decimales (kg) = 6.67.
    expect(resumen).toContainEqual({ producto: "Salsa base", proceso: "PRODUCCION", cantidad: 2 });
    expect(resumen).toContainEqual({ producto: "Tomate", proceso: "CONSUMO", cantidad: -6.67 });

    // Producir 3 kg (unidades) de Pizza: consume SalsaBase 3 × 0.1 × 1 = 0.3.
    expect(resumen).toContainEqual({ producto: "Pizza", proceso: "PRODUCCION", cantidad: 3 });
    expect(resumen).toContainEqual({ producto: "Salsa base", proceso: "CONSUMO", cantidad: -0.3 });

    expect(filas).toHaveLength(4);
  });

  it("(c) calcularCostosYMargenes: costo unitario y margen de cada PV, incluida la recursión sobre la subreceta", async () => {
    const filas = await calcularCostosYMargenes(sucursalId, prisma);
    const porNombre = new Map(filas.map((f) => [f.productoNombre, f]));

    // Milanesa: costoCarneA=$50/kg (250/5) × (0.3333 × 1.125) = 50 × 0.37496...
    const milanesaFila = porNombre.get("Milanesa")!;
    expect(milanesaFila.costo).not.toBeNull();
    expect(milanesaFila.costo).toBe(18.75);
    expect(milanesaFila.margen).toBe(81.25);
    expect(milanesaFila.estado).toBe("OK");

    // Bife a caballo: costoCarneB=$50/kg (30/0.6) × 0.1 = 5.
    const bifeFila = porNombre.get("Bife a caballo")!;
    expect(bifeFila.costo).toBe(5);
    expect(bifeFila.margen).toBe(115);

    // Pizza: costoSalsaBase = 2.5 × 1.3333 × $5/kg (Tomate) = 16.66625; costoPizza = 0.1 × 16.66625 = 1.666625 → $1.67.
    const pizzaFila = porNombre.get("Pizza")!;
    expect(pizzaFila.costo).not.toBeNull();
    expect(pizzaFila.costo).toBe(1.67);
    expect(pizzaFila.componentes[0].insumoSeProduce).toBe(true);
  });

  it("(d) calcularRendimientoRecetasSimples/Compartidas: Milanesa cae en 'Simples', CarneA+CarneB comparten pool en 'Compartidas'", async () => {
    const desde = new Date("2026-03-01T00:00:00Z");
    const hasta = new Date("2026-03-31T23:59:59Z");

    const simples = await calcularRendimientoRecetasSimples(sucursalId, desde, hasta, prisma);
    // El insumo "Carne" lo usan DOS platos (Milanesa vía CarneA, Bife a caballo vía CarneB) → cae en Compartidas, no en Simples.
    expect(simples.find((f) => f.insumoONombre === "Carne (familia)")).toBeUndefined();
    const pizzaSimple = simples.find((f) => f.productoVentaNombre === "Pizza");
    expect(pizzaSimple).toBeDefined();
    expect(pizzaSimple!.rotulo).toBe("SUBRECETA_PRODUCIDA");
    expect(pizzaSimple!.totalProducido).toBe(2);
    expect(pizzaSimple!.totalComprado).toBe(0);

    const compartidas = await calcularRendimientoRecetasCompartidas(sucursalId, desde, hasta, prisma);
    const filasCarne = compartidas.filter((f) => f.insumoONombre === "Carne (familia)");
    expect(filasCarne).toHaveLength(2);
    expect(filasCarne.map((f) => f.productoVentaNombre).sort()).toEqual(["Bife a caballo", "Milanesa"]);
    expect(filasCarne[0].cantidadPlatosEnPool).toBe(2);
  });

  it("(e) generarReporteDiferenciasAjustes: SalsaBase/Tomate/Carne quedan en 'Solo receta' (grupo b), sin diferencia", async () => {
    const filas = await generarReporteDiferenciasAjustes(sucursalId, prisma);
    const porNombre = new Map(filas.map((f) => [f.producto, f]));

    expect(porNombre.get("Tomate")!.grupo).toBe("b");
    expect(porNombre.get("Tomate")!.estado).toBe("ESPERADO");
    expect(porNombre.get("Carne A")!.grupo).toBe("b");
    expect(porNombre.get("Carne B")!.grupo).toBe("b");
    // SalsaBase es MP con receta propia (subreceta) Y también es insumo de la receta de Pizza — sigue siendo "b" (solo receta),
    // nunca "a": nada la ajustó a mano en este fixture.
    expect(porNombre.get("Salsa base")!.grupo).toBe("b");
    expect(porNombre.get("Salsa base")!.estado).toBe("ESPERADO");
  });

  it("(f) reconstruirCostosDeVenta: costo histórico de cada venta al día en que ocurrió", async () => {
    const costos = await reconstruirCostosDeVenta(sucursalId, [
      { productoId: milanesa.id, fecha },
      { productoId: bifeCaballo.id, fecha },
      { productoId: pizza.id, fecha },
    ], prisma);
    expect(costos.get(claveCostoHistorico(milanesa.id, "2026-03-10"))).toBe(18.748124999999998);
    expect(costos.get(claveCostoHistorico(bifeCaballo.id, "2026-03-10"))).toBe(5);
    expect(costos.get(claveCostoHistorico(pizza.id, "2026-03-10"))).toBe(1.6666249999999998);
  });
});
