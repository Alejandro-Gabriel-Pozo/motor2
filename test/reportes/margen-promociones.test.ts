import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarSalon } from "../pos/salon-fixture";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { obtenerReporteMargenPromociones } from "../../src/server/consultas/reportes/margen-promociones";

/**
 * Reporte de margen real de promos armables (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 12): contra Postgres real,
 * cerrando cuentas con las acciones reales (mismo molde que descuentos-clientes.test.ts) — los componentes de la promo se
 * siembran directo (mismo criterio que test/pos/promo-cuenta-esquema.test.ts), ya prorrateados, para fijar exactamente el
 * precio cobrado y el de carta de cada uno sin depender del algoritmo de prorrateo (ya cubierto por test/pos/promo-combo.test.ts).
 */
describe("obtenerReporteMargenPromociones", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let seccionCarta: { id: string };
  const desde = new Date("2000-01-01");
  const hasta = new Date("2100-01-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
  });

  const crearPromoCarta = (titulo: string, activa = true) => prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccionCarta.id, titulo, precio: 1, activa } });

  /** Una cuenta con UNA promo ya armada y enviada (numeroEnvio 1), lista para cerrar — componentes ya prorrateados, sembrados
   *  directo (sin pasar por `agregarItems`: el prorrateo en sí ya lo cubre test/pos/promo-combo.test.ts). */
  async function sembrarCuentaConPromo(
    mesaId: string,
    promoCartaId: string,
    tituloSnapshot: string,
    precioPromo: number,
    componentes: { productoId: string; cantidad: number; precioUnitario: number; precioCartaUnitario: number | null }[]
  ) {
    const cuenta = await prisma.cuenta.create({ data: { mesaId, abiertaPorId: s.admin.id } });
    const promoCuenta = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId, precio: precioPromo, titulo: tituloSnapshot, creadoPorId: s.admin.id } });
    for (const c of componentes) {
      await prisma.cuentaItem.create({
        data: {
          cuentaId: cuenta.id,
          productoId: c.productoId,
          cantidad: c.cantidad,
          precioUnitario: c.precioUnitario,
          numeroEnvio: 1,
          creadoPorId: s.admin.id,
          promoCuentaId: promoCuenta.id,
          precioCartaUnitario: c.precioCartaUnitario,
        },
      });
    }
    return cuenta;
  }

  it("sin ninguna venta de promo: reporte vacío", async () => {
    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep).toEqual({ desde, hasta, cantidadInstancias: 0, ingresoALista: 0, ingresoCobrado: 0, ahorroCliente: 0, promos: [], aviso: rep.aviso });
  });

  it("una promo con un componente sin receta: ingreso a lista vs. cobrado, ahorro del cliente y margen Real PARCIAL (D3)", async () => {
    // Muzzarella comprada a $400/kg: la Pizza (0,25 kg) cuesta $100 de verdad; el Flan no tiene receta, sin costo real.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-01-01"), seccionId: s.seccion.id, items: [{ productoId: s.muzzarella.id, cantidad: 10, precioTotal: 4000 }] });
    const promo = await crearPromoCarta("Combo Test");
    // Precio de carta: Pizza $12.000 + Flan $3.000 = $15.000. La promo cobra $12.000, prorrateado 9.600/2.400 (D3).
    const cuenta = await sembrarCuentaConPromo(s.mesa.id, promo.id, "Combo Test", 12000, [
      { productoId: s.pizza.id, cantidad: 1, precioUnitario: 9600, precioCartaUnitario: 12000 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 2400, precioCartaUnitario: 3000 },
    ]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep.cantidadInstancias).toBe(1);
    expect(rep.ingresoALista).toBe(15000);
    expect(rep.ingresoCobrado).toBe(12000);
    expect(rep.ahorroCliente).toBe(3000);
    expect(rep.promos).toHaveLength(1);

    const [fila] = rep.promos;
    expect(fila).toMatchObject({
      promoCartaId: promo.id,
      titulo: "Combo Test",
      activa: true,
      cantidadInstancias: 1,
      cantidadComponentes: 2,
      ingresoALista: 15000,
      ingresoCobrado: 12000,
      ahorroCliente: 3000,
      ahorroClientePct: 20,
      margenRealReconstruido: false, // costoUnitarioVenta se guardó al vender (la compra ya estaba al cerrar)
      margenRealCompleto: false, // el Flan sin receta queda afuera del costeo: el número no cubre el 100%
    });
    // Costo real: solo la Pizza se pudo costear (0,25 kg × $400 = $100) — el MISMO costo en las dos cuentas (D3: la promo no
    // cambia lo que cuesta hacerla, solo lo que se cobra).
    expect(fila.margenReal).toBe(9500); // 9.600 (cobrado de la Pizza) − 100
    expect(fila.margenRealSueltoEquivalente).toBe(11900); // 12.000 (a lista de la Pizza) − 100
  });

  it("dos instancias de la MISMA promo se suman en una sola fila", async () => {
    const promo = await crearPromoCarta("Combo Test");
    await sembrarCuentaConPromo(s.mesa.id, promo.id, "Combo Test", 3000, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, precioCartaUnitario: 3000 }]);
    const cuenta1 = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id } });
    expect((await cerrarCuenta(cuenta1.id)).ok).toBe(true);

    const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    await sembrarCuentaConPromo(mesa2.id, promo.id, "Combo Test", 3000, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, precioCartaUnitario: 3000 }]);
    const cuenta2 = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: mesa2.id } });
    expect((await cerrarCuenta(cuenta2.id)).ok).toBe(true);

    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep.promos).toHaveLength(1);
    expect(rep.promos[0]).toMatchObject({ cantidadInstancias: 2, cantidadComponentes: 2, ingresoCobrado: 6000, ingresoALista: 6000, ahorroCliente: 0 });
  });

  it("una promo dada de baja después de vender sigue apareciendo, marcada `activa: false` (no se pierde el historial)", async () => {
    const promo = await crearPromoCarta("Se dio de baja");
    const cuenta = await sembrarCuentaConPromo(s.mesa.id, promo.id, "Se dio de baja", 3000, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, precioCartaUnitario: 3000 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    await prisma.promoCarta.update({ where: { id: promo.id }, data: { activa: false } });

    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep.promos).toEqual([expect.objectContaining({ titulo: "Se dio de baja", activa: false })]);
  });

  it("una venta anulada no cuenta", async () => {
    const promo = await crearPromoCarta("Combo Test");
    const cuenta = await sembrarCuentaConPromo(s.mesa.id, promo.id, "Combo Test", 3000, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, precioCartaUnitario: 3000 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", promoCuentaId: { not: null } } });
    expect((await anularVenta(venta.id)).ok).toBe(true);

    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep.promos).toEqual([]);
  });

  it("fuera del rango de fechas: no aparece; una promo de OTRA sucursal tampoco se mezcla", async () => {
    const promo = await crearPromoCarta("Combo Test");
    const cuenta = await sembrarCuentaConPromo(s.mesa.id, promo.id, "Combo Test", 3000, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, precioCartaUnitario: 3000 }]);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    expect((await obtenerReporteMargenPromociones(s.sucursalId, new Date("1999-01-01"), new Date("1999-06-01"), prisma)).promos).toEqual([]);
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    expect((await obtenerReporteMargenPromociones(norte.id, desde, hasta, prisma)).promos).toEqual([]);
  });

  it("una venta suelta de siempre (sin promoCuentaId) no aparece acá", async () => {
    const cuenta = await prisma.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id } });
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1, creadoPorId: s.admin.id } });
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);

    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep.promos).toEqual([]);
  });

  it("dos promos distintas: ordenadas por ingreso cobrado descendente", async () => {
    const chica = await crearPromoCarta("Chica");
    const grande = await crearPromoCarta("Grande");
    await sembrarCuentaConPromo(s.mesa.id, chica.id, "Chica", 3000, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, precioCartaUnitario: 3000 }]);
    const c1 = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: s.mesa.id } });
    expect((await cerrarCuenta(c1.id)).ok).toBe(true);

    const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    await sembrarCuentaConPromo(mesa2.id, grande.id, "Grande", 9000, [{ productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, precioCartaUnitario: 9000 }]);
    const c2 = await prisma.cuenta.findFirstOrThrow({ where: { mesaId: mesa2.id } });
    expect((await cerrarCuenta(c2.id)).ok).toBe(true);

    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma);
    expect(rep.promos.map((p) => p.titulo)).toEqual(["Grande", "Chica"]);
  });
});
