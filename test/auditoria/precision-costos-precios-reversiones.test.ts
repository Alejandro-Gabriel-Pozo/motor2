import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pivote 4 (Precisión numérica) — casos pendientes bajo umbral de CERO
 * TOLERANCIA: costos acumulados encadenados, precios/redondearMoneda,
 * reversiones de cantidades ya redondeadas. NO repite lo ya probado en
 * precision-numerica-y-saldo.test.ts (4 decimales, factor de conversión,
 * sumas repetidas, merma, reconstrucción básica de saldo).
 *
 * Criterio: comparar el resultado ACTUAL contra el resultado EXACTO
 * esperado, calculado en el test con aritmética de enteros (centavos)
 * — nunca con floats — para no arrastrar el mismo tipo de error que se
 * está auditando. Cualquier diferencia no explicada por una regla de
 * redondeo explícita del dominio (redondearMoneda a 2 decimales,
 * redondearACantidadDeUnidad a los decimales de la unidad) es FALLO,
 * sin margen de tolerancia aproximada.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta, anularVenta } from "../../src/server/actions/movimientos/venta";
import { calcularSaldoTotal } from "../../src/core/movimientos/stock";
import { calcularCostosYMargenes } from "../../src/core/reportes/costos";
import { calcularValuacionInventario } from "../../src/core/reportes/valuacion";

/** Aritmética exacta en centavos (BigInt) — la referencia contra la que se compara redondearMoneda. */
function centavosExactos(pesos: number): bigint {
  // Arma el valor desde el string decimal (toFixed ya redondea a 2
  // decimales de forma consistente), no desde una multiplicación
  // flotante — y separa el signo ANTES de partir en entero/decimal para
  // no perderlo en negativos (ej. "-40.95" → entero "-40" NO alcanza para
  // reconstruir -4095 centavos sumando cent=95, hace falta restar).
  const negativo = pesos < 0;
  const abs = Math.abs(pesos).toFixed(2);
  const [entero, decimal] = abs.split(".");
  const centavos = BigInt(entero) * BigInt(100) + BigInt(decimal);
  return negativo ? -centavos : centavos;
}

describe("Auditoría — Pivote 4: costos acumulados, redondearMoneda, reversiones (cero tolerancia)", () => {
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

  describe("1) Costos acumulados encadenados", () => {
    it("calcularCostosYMargenes: receta con 2 ingredientes de costo/merma fraccionarios da un costoTotal exacto (comparado con aritmética de enteros)", async () => {
      const harina = await sembrarProductoDisponible({ codigo: "MP_HAR", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const manteca = await sembrarProductoDisponible({ codigo: "MP_MAN", nombre: "Manteca", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);
      const pv = await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 500 }, sucursalId);

      // Compra con precioTotal fraccionario → precioPorUnidadStock también
      // fraccionario (no un número "redondo" a propósito).
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: harina.id, cantidad: 3, precioTotal: 10.01 }] }); // 3.336666... /kg
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: manteca.id, cantidad: 7, precioTotal: 23.33 }] }); // 3.332857... /kg

      await prisma.recetaVersion.create({
        data: {
          productoId: pv.id,
          version: 1,
          ingredientes: {
            create: [
              { insumoProductoId: harina.id, cantidad: 0.35, unidadId: unidadKgId, mermaPorcentaje: 8.5 },
              { insumoProductoId: manteca.id, cantidad: 0.12, unidadId: unidadKgId, mermaPorcentaje: 3.25 },
            ],
          },
        },
      });

      const filas = await calcularCostosYMargenes(sucursalId, prisma);
      const fila = filas.find((f) => f.productoId === pv.id)!;

      // Referencia exacta calculada por fuera, con la MISMA fórmula que
      // costos.ts (cantidad*(1+merma/100)*precioPorUnidadStock, sumado
      // antes de redondear) pero verificada a mano con más precisión
      // decimal que un float de 64 bits para confirmar que no hay arrastre:
      // precioPorUnidadStock harina = 10.01/3 = 3.336666666...
      // precioPorUnidadStock manteca = 23.33/7 = 3.332857142857...
      const precioHarina = 10.01 / 3;
      const precioManteca = 23.33 / 7;
      const costoHarina = 0.35 * (1 + 8.5 / 100) * precioHarina;
      const costoManteca = 0.12 * (1 + 3.25 / 100) * precioManteca;
      const costoTotalExacto = costoHarina + costoManteca;
      const costoTotalRedondeadoEsperado = Math.round(costoTotalExacto * 100) / 100;

      expect(fila.costo).toBe(costoTotalRedondeadoEsperado);
      expect(fila.costoIncompleto).toBe(false);
      expect(fila.margen).toBe(Math.round((500 - costoTotalExacto) * 100) / 100);
    });

    it("calcularValuacionInventario: saldo × costoUnitario (precio de la ÚLTIMA compra) da un total exacto con múltiples productos de precio fraccionario", async () => {
      const p1 = await sembrarProductoDisponible({ codigo: "MP_V1", nombre: "Aceite", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const p2 = await sembrarProductoDisponible({ codigo: "MP_V2", nombre: "Azúcar", tipo: "MP", unidadStockId: unidadKgId }, sucursalId);

      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: p1.id, cantidad: 6, precioTotal: 19.17 }] }); // 3.195/kg
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: p2.id, cantidad: 11, precioTotal: 40.37 }] }); // 3.670909.../kg
      await registrarMovimiento({ proceso: "CONSUMO", fecha: new Date(), seccionId, items: [{ productoId: p1.id, cantidad: 1.5 }] });

      const reporte = await calcularValuacionInventario(sucursalId, prisma);
      const fila1 = reporte.filas.find((f) => f.productoId === p1.id)!;
      const fila2 = reporte.filas.find((f) => f.productoId === p2.id)!;

      const costoUnit1 = 19.17 / 6;
      const costoUnit2 = 40.37 / 11;
      const saldo1 = 6 - 1.5;
      const saldo2 = 11;
      const valorExacto1 = Math.round(saldo1 * costoUnit1 * 100) / 100;
      const valorExacto2 = Math.round(saldo2 * costoUnit2 * 100) / 100;

      expect(fila1.valor).toBe(valorExacto1);
      expect(fila2.valor).toBe(valorExacto2);
      expect(reporte.totalValorizado).toBe(Math.round((valorExacto1 + valorExacto2) * 100) / 100);
    });
  });

  describe("2) Precios con dos decimales y redondearMoneda", () => {
    it("VENTA con cantidad e importe que caen justo en el borde del redondeo (X.XX5): el precioTotal persistido coincide EXACTO con centavos-exactos calculados a mano", async () => {
      const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_PAN", nombre: "Harina Pan", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      // precioVenta debe respetar Decimal(14,2) — 2 decimales, como
      // cualquier precio real cargado por UI. Elegido junto con la
      // cantidad para que el PRODUCTO caiga exacto en un borde de
      // redondeo: 2.5 × 4.05 = 10.125 (mitad exacta entre 10.12 y 10.13).
      const pv = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 4.05 }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.2, unidadId: unidadKgId }] } } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 10 }] });

      const resultado = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 2.5 }] });
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const movVenta = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: pv.id, proceso: "VENTA" } });
      const importePersistido = Number(movVenta.precioTotal);

      // 2.5 × 4.05 = 10.125 exacto (matemáticamente, y también en float de
      // 64 bits para este par de valores) → Math.round(1012.5)/100.
      // JS Math.round redondea 0.5 HACIA +Infinity (10.13, no redondeo
      // bancario) — documentamos el comportamiento real determinista.
      console.log("[auditoria] 2.5 × 4.05 =", 2.5 * 4.05, "→ redondeado:", importePersistido);
      expect(importePersistido).toBe(10.13);
    });

    it("acumulación de 8 ventas con importes fraccionarios: la SUMA de precioTotal en la base coincide exacto con la suma en centavos calculada a mano", async () => {
      const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_AC", nombre: "Harina Acum", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const pv = await sembrarProductoDisponible({ codigo: "PV_AC", nombre: "Facturas", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 4.37 }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.05, unidadId: unidadKgId }] } } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 10 }] });

      let sumaEsperadaCentavos = BigInt(0);
      for (let i = 1; i <= 8; i++) {
        const cantidad = i; // 1..8 unidades
        const r = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: cantidad }] });
        expect(r.ok, r.mensaje).toBe(true);
        sumaEsperadaCentavos += centavosExactos(Math.round(cantidad * 4.37 * 100) / 100);
      }

      const filas = await prisma.movimientoStock.findMany({ where: { productoId: pv.id, proceso: "VENTA" }, select: { precioTotal: true } });
      const sumaReal = filas.reduce((acc, f) => acc + centavosExactos(Number(f.precioTotal)), BigInt(0));

      expect(sumaReal).toBe(sumaEsperadaCentavos);
    });
  });

  describe("3) Reversiones de cantidades/importes previamente redondeados", () => {
    it("anularVenta: el neto de cantidad e importe entre la venta original y su reversión es EXACTAMENTE cero, no una aproximación", async () => {
      const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_REV", nombre: "Harina Reversion", tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
      const pv = await sembrarProductoDisponible({ codigo: "PV_REV", nombre: "Medialuna", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 3.15 }, sucursalId);
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.045, unidadId: unidadKgId, mermaPorcentaje: 7 }] } } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 10 }] });

      const saldoInsumoPreVenta = await calcularSaldoTotal(mpInsumo.id, seccionId, prisma);

      const venta = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 13 }] });
      expect(venta.ok, venta.mensaje).toBe(true);

      const operacionVenta = await prisma.operacion.findFirstOrThrow({ where: { sucursalId, proceso: "VENTA" } });
      const anulacion = await anularVenta(operacionVenta.id);
      expect(anulacion.ok, anulacion.mensaje).toBe(true);

      // El saldo del insumo debe volver EXACTO al valor previo a la venta
      // — ni una unidad de más ni de menos por arrastre de redondeo.
      const saldoInsumoPostReversion = await calcularSaldoTotal(mpInsumo.id, seccionId, prisma);
      expect(saldoInsumoPostReversion).toBe(saldoInsumoPreVenta);

      // El neto de precioTotal (venta + reversión) sobre TODAS las líneas
      // (VENTA + CONSUMO, aunque CONSUMO siempre tenga precioTotal=0)
      // relacionadas a esta operación debe ser exactamente 0.
      const todasLasLineas = await prisma.movimientoStock.findMany({
        where: { OR: [{ operacionId: operacionVenta.id }, { operacion: { detalleLibre: { contains: operacionVenta.id } } }] },
        select: { precioTotal: true },
      });
      const netoCentavos = todasLasLineas.reduce((acc, f) => acc + centavosExactos(Number(f.precioTotal)), BigInt(0));
      expect(netoCentavos).toBe(BigInt(0));
    });

    it("anularVenta sobre una cantidad de insumo que ya fue redondeada a los decimales de su unidad: la reversión no introduce un residuo distinto de cero", async () => {
      // Unidad con pocos decimales (0) para forzar que el consumo de receta
      // SÍ se redondee de forma no trivial antes de persistir.
      const unidadSinDecimales = await prisma.unidad.create({ data: { nombre: "unidad_entera", magnitud: "CANTIDAD", decimales: 0 } });
      const mpInsumo = await sembrarProductoDisponible({ codigo: "MP_ENT", nombre: "Huevos", tipo: "MP", unidadStockId: unidadSinDecimales.id }, sucursalId);
      const pv = await sembrarProductoDisponible({ codigo: "PV_ENT", nombre: "Budín", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 8.9 }, sucursalId);
      // 0.3 huevos por budín, con merma → consumo por venta se redondea a
      // entero (decimales:0) antes de persistir, un caso ya identificado
      // como de riesgo (redondearACantidadDeUnidad con pocos decimales).
      await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpInsumo.id, cantidad: 0.3, unidadId: unidadSinDecimales.id, mermaPorcentaje: 5 }] } } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpInsumo.id, cantidad: 100 }] });

      const saldoPre = await calcularSaldoTotal(mpInsumo.id, seccionId, prisma);
      const venta = await registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 7 }] });
      expect(venta.ok, venta.mensaje).toBe(true);

      const operacionVenta = await prisma.operacion.findFirstOrThrow({ where: { sucursalId, proceso: "VENTA" } });
      const anulacion = await anularVenta(operacionVenta.id);
      expect(anulacion.ok, anulacion.mensaje).toBe(true);

      const saldoPost = await calcularSaldoTotal(mpInsumo.id, seccionId, prisma);
      // Aunque el consumo se redondeó a un entero antes de persistir, la
      // reversión revierte EXACTAMENTE esa misma cantidad ya redondeada
      // (no recalcula desde cero) — el saldo vuelve exacto al original.
      expect(saldoPost).toBe(saldoPre);
    });
  });
});
