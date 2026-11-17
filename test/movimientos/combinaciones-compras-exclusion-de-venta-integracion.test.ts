import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { dimensionesDeExclusionDeVenta, productoCartesiano, tablaDeExclusionDeVenta } from "../setup/oraculo-compras-exclusion-de-venta";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { MENSAJE_SECCION_NO_SIRVE_PARA_VENDER } from "../../src/core/compras/public";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * Compras, etapa (ii-a) — el ORÁCULO DE COMBINACIONES contra la base real (regla «Combinaciones» del dueño). `docs/oraculo-combinaciones-compras-exclusion-de-venta-2026-11-17.md` es la tabla de reglas esperadas, escrita aparte del código y antes de él. Acá se recorre
 * TODA su tabla (origen × uso de los depósitos × saldo normal, y los dos usos especiales) con las acciones reales: el cierre de cuenta del POS (automático y con sección habitual) y la venta de mostrador (`registrarVenta`). La pizza lleva 0,25 kg de muzzarella
 * por unidad y se venden 2 (0,5 kg). El depósito especial se llama «Alfa especial» a propósito: ordena ANTES que «Salón», así que si la venta lo mirara por nombre lo elegiría. En toda fila armable el stock del depósito especial queda intacto.
 */
const FILAS = tablaDeExclusionDeVenta("Resultado de la venta").filas.map((f) => ({ O: f["O"]!, U: f["U"]!, S: f["S"]!, resultado: f["Resultado"]! }));
const ESPECIALES = ["CUARENTENA", "RECHAZO"] as const;

let s: Awaited<ReturnType<typeof sembrarSalon>>;

const sembrarStock = async (seccionId: string, cantidad: number) => {
  if (cantidad === 0) return;
  const operacion = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "COMPRA", fecha: new Date("2026-01-01T12:00:00Z"), usuarioId: s.admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: operacion.id, productoId: s.muzzarella.id, seccionId, proceso: "COMPRA", cantidad, detalle: "Stock de prueba", precioTotal: 0, precioPorUnidadStock: 0 } });
};

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

describe("oráculo: la venta no usa depósitos de cuarentena ni de rechazo (recorrido completo contra la base real)", () => {
  it("la tabla del oráculo cubre TODAS las combinaciones de las dimensiones declaradas, una sola vez", () => {
    const dims = dimensionesDeExclusionDeVenta();
    expect(FILAS.map((f) => `${f.O}|${f.U}|${f.S}`).sort()).toEqual(productoCartesiano({ O: dims["O"]!, U: dims["U"]!, S: dims["S"]! }).map((f) => `${f["O"]}|${f["U"]}|${f["S"]}`).sort());
  });

  for (const uso of ESPECIALES) {
    for (const fila of FILAS.filter((f) => f.resultado !== "NO_APLICA")) {
      it(`[${uso}] ${fila.O} · ${fila.U} · ${fila.S} → ${fila.resultado}`, async () => {
        const especial = await prisma.seccion.create({ data: { sucursalId: s.sucursalId, nombre: "Alfa especial", uso } });
        const normal = s.seccion;
        // El mundo: el saldo normal según S (en UNICA_CON_STOCK_ESPECIAL los normales tienen 0) y el stock del depósito especial (10 kg) salvo que la sucursal no lo tenga con stock.
        await sembrarStock(normal.id, fila.U === "UNICA_CON_STOCK_ESPECIAL" ? 0 : fila.S === "ALCANZA" ? 1 : 0.2);
        if (fila.U !== "SOLO_NORMAL") await sembrarStock(especial.id, 10);
        const stockEspecialAntes = await calcularSaldoTotal(s.muzzarella.id, especial.id, prisma);
        const stockNormalAntes = await calcularSaldoTotal(s.muzzarella.id, normal.id, prisma);

        let r: { ok: boolean; mensaje: string };
        if (fila.O === "MOSTRADOR") {
          r = await registrarVenta({ fecha: new Date(), seccionId: fila.U === "ELEGIDA_ESPECIAL" ? especial.id : normal.id, ventas: [{ productoId: s.pizza.id, cantidadVendida: 2 }] });
        } else {
          if (fila.O === "HABITUAL") await prisma.seccionHabitualProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.pizza.id, seccionId: fila.U === "ELEGIDA_ESPECIAL" ? especial.id : normal.id } });
          const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.pizza.id, cantidad: 2, precioUnitario: 12000, numeroEnvio: 1 }]);
          r = await cerrarCuenta(cuenta.id);
        }

        const consumosEnNormal = (await calcularSaldoTotal(s.muzzarella.id, normal.id, prisma)) - stockNormalAntes;
        // En toda fila armable el depósito especial queda intacto, sin ningún movimiento de venta ni de consumo.
        expect(await calcularSaldoTotal(s.muzzarella.id, especial.id, prisma)).toBe(stockEspecialAntes);
        expect(await prisma.movimientoStock.count({ where: { seccionId: especial.id, proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);

        switch (fila.resultado) {
          case "VENDE_DE_NORMAL":
            expect(r.ok, r.mensaje).toBe(true);
            expect(r.mensaje).not.toContain("⚠");
            expect(consumosEnNormal).toBeCloseTo(-0.5, 6);
            break;
          case "VENDE_CON_FALTANTE_AVISADO":
            expect(r.ok, r.mensaje).toBe(true);
            expect(r.mensaje).toContain("⚠ Quedó stock negativo");
            expect(r.mensaje).toContain("«Salón»");
            expect(r.mensaje).not.toContain("Alfa especial");
            expect(consumosEnNormal).toBeCloseTo(-0.5, 6);
            break;
          case "RECHAZA_STOCK_INSUFICIENTE":
            expect(r.ok).toBe(false);
            expect(r.mensaje).toContain("Stock insuficiente");
            expect(r.mensaje).not.toContain("Alfa especial");
            expect(consumosEnNormal).toBe(0);
            expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
            break;
          case "RECHAZA_DEPOSITO_ESPECIAL":
            expect(r).toEqual({ ok: false, mensaje: MENSAJE_SECCION_NO_SIRVE_PARA_VENDER });
            expect(consumosEnNormal).toBe(0);
            expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
            break;
          default:
            throw new Error(`Resultado del oráculo sin declarar en el test: ${fila.resultado}`);
        }
      });
    }
  }
});
