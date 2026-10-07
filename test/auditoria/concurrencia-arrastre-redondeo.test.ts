import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task #27 (docs/plan-redondeo-consumo-fraccionado-2026-09-26.md), Paso 5: el arrastre de redondeo (`cargarDeudaDeRedondeo` +
 * `crearArrastreDeRedondeo`) lee y escribe la deuda de un producto DENTRO de la misma transacción SERIALIZABLE que ya arbitra
 * cualquier otro conflicto de escritura de esta porción (`con-reintento.ts`, mismo criterio que `concurrencia-casos-2-3.test.ts` para
 * el resto de `registrarVenta`) — dos ventas de 0,5 simultáneas sobre la MISMA MP tienen que comportarse como si una ocurriera
 * después de la otra (nunca las dos leyendo D=0 a la vez y escribiendo 1+1), sin perder ninguna unidad de stock.
 */

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { calcularSaldoTotal } from "../../src/server/lecturas/movimientos/saldos";

const RONDAS = 10;

describe("Auditoría — concurrencia del arrastre de redondeo (Task #27)", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadBolloId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    unidadBolloId = (await prisma.unidad.create({ data: { nombre: "bollo_concurrencia", magnitud: "CANTIDAD", decimales: 0 } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it(`${RONDAS} rondas de dos ventas de 0,5 EN PARALELO sobre la misma MP fresca: las dos tienen éxito SIEMPRE, Σ CONSUMO = -1 por ronda, y D vuelve a 0 al final de cada una`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      // Producto fresco por ronda (mismo criterio que concurrencia-casos-2-3.test.ts, Plan C2): con un insumo compartido entre
      // rondas, `asignarConsumosDeVenta` trataría los productos de rondas distintas como "hermanos" y podría repartir el consumo
      // entre ellos, contaminando el aislamiento de cada ronda.
      const mp = await sembrarProductoDisponible({ codigo: `MP_BOLLO_CONC_${ronda}`, nombre: `Bollo${ronda}`, tipo: "MP", unidadStockId: unidadBolloId }, sucursalId);
      const pv = await sembrarProductoDisponible(
        { codigo: `PV_PIZZA_CONC_${ronda}`, nombre: `Pizza${ronda}`, tipo: "PV", unidadStockId: unidadBolloId, precioVenta: 12000, pasoVenta: 0.5 },
        sucursalId
      );
      await prisma.recetaVersion.create({
        data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadBolloId, mermaPorcentaje: 0 }] } },
      });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 20 }] });

      const settled = await Promise.allSettled([
        registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] }),
        registrarVenta({ fecha: new Date(), seccionId, ventas: [{ productoId: pv.id, cantidadVendida: 0.5 }] }),
      ]);
      if (settled.some((s) => s.status === "rejected" || (s.status === "fulfilled" && !s.value.ok))) {
        console.log(
          `[auditoria] ronda ${ronda} (arrastre de redondeo):`,
          settled.map((s) => (s.status === "fulfilled" ? { ok: s.value.ok, mensaje: s.value.mensaje } : { rejected: true, message: String((s.reason as Error)?.message).slice(0, 150) }))
        );
      }
      expect(settled.every((s) => s.status === "fulfilled" && s.value.ok), `ronda ${ronda}: las dos ventas de 0,5 deben tener éxito`).toBe(true);

      const filas = await prisma.movimientoStock.findMany({ where: { productoId: mp.id, proceso: "CONSUMO" }, orderBy: { creadoEn: "asc" } });
      expect(filas, `ronda ${ronda}`).toHaveLength(2);
      for (const f of filas) expect(Number.isInteger(Number(f.cantidad)), `ronda ${ronda}`).toBe(true);

      const sumaEscrito = filas.reduce((s, f) => s + Number(f.cantidad), 0);
      expect(sumaEscrito, `ronda ${ronda}: total consumido debe ser -1 (un bollo), nunca -2 ni 0`).toBe(-1);
      expect(await calcularSaldoTotal(mp.id, seccionId, prisma), `ronda ${ronda}`).toBe(19); // 20 comprados - 1 bollo (2 medias)

      // Invariante D = Σcantidad − ΣcantidadExacta (schema.prisma, docstring de MovimientoStock.cantidadExacta), sumando solo las
      // filas con cantidadExacta no nulo — acá las DOS filas de la ronda difieren de su exacto (0,5 ≠ 1 y 0,5 ≠ 0), así que las dos
      // cuentan. Con ambas medias ya escritas, la deuda de este producto vuelve exactamente a 0: no queda ningún resto pendiente.
      const conArrastre = filas.filter((f) => f.cantidadExacta !== null);
      expect(conArrastre, `ronda ${ronda}: las dos partes de 0,5 debían diferir de lo escrito`).toHaveLength(2);
      const sumaExacto = conArrastre.reduce((s, f) => s + Number(f.cantidadExacta), 0);
      const deuda = sumaEscrito - sumaExacto;
      expect(deuda, `ronda ${ronda}: D final`).toBe(0);
      // Σescrito + D = Σexacto (despejando la fórmula de arriba) — Σexacto de esta ronda es -1 (dos partes de -0,5 cada una).
      expect(sumaEscrito + deuda, `ronda ${ronda}`).toBe(sumaExacto);
      expect(sumaExacto, `ronda ${ronda}`).toBe(-1);
    }
  });
});
