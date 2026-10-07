import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { asignarClienteACuenta } from "../../src/server/actions/pos/cuenta-apertura";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { obtenerReporteDescuentosClientes } from "../../src/server/consultas/reportes/descuentos-clientes";
import { obtenerReporteMargenPromociones } from "../../src/server/consultas/reportes/margen-promociones";

/**
 * Hallazgo de la auditoría de O.37–O.40: un PV que se produce y sale de más de un lote deja VARIAS filas VENTA en la MISMA operación (O.40 (1), `registrar-venta-en-tx`). Los contadores de los
 * reportes que contaban filas (`cantidadVentas` de descuentos por cliente, `cantidadComponentes` de margen de promos) tienen que contar OPERACIONES: la misma venta no puede contar dos veces por
 * haber salido de dos lotes. La venta se cierra con las acciones reales y después la fila VENTA de un producto se parte en dos en la base (con la mitad del importe cada una), que es la forma
 * que deja el reparto por lote. Importes, unidades y márgenes no cambian: suman por fila.
 */
describe("reportes con una venta partida en dos filas por lote", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  const desde = new Date("2000-01-01");
  const hasta = new Date("2100-01-01");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
  });

  /** Parte la fila VENTA de `productoId` de la operación en dos mitades (cantidad e importe), cada una en su lote. */
  async function partirEnDosLotes(operacionId: string, productoId: string) {
    const fila = await prisma.movimientoStock.findFirstOrThrow({ where: { operacionId, productoId, proceso: "VENTA" } });
    const mitadCantidad = Number(fila.cantidad) / 2;
    const mitadImporte = Number(fila.precioTotal) / 2;
    await prisma.movimientoStock.update({ where: { id: fila.id }, data: { cantidad: mitadCantidad, precioTotal: mitadImporte, loteVencimiento: new Date("2026-10-02") } });
    await prisma.movimientoStock.create({
      data: {
        operacionId,
        productoId,
        seccionId: fila.seccionId,
        proceso: "VENTA",
        cantidad: mitadCantidad,
        detalle: fila.detalle,
        precioTotal: mitadImporte,
        precioPorUnidadStock: fila.precioPorUnidadStock,
        costoUnitarioVenta: fila.costoUnitarioVenta,
        precioListaUnitario: fila.precioListaUnitario,
        loteVencimiento: new Date("2026-10-04"),
      },
    });
  }

  it("descuentos por cliente: una venta de 2 unidades salida de dos lotes cuenta UNA venta (y las unidades y los importes son los mismos)", async () => {
    const alta = await altaCliente("Ana", 10);
    if (!alta.ok) throw new Error(alta.mensaje);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 2, precioUnitario: 3000, numeroEnvio: 1 }]);
    await asignarClienteACuenta(cuenta.id, alta.id);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const antes = (await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta, prisma)).clientes[0]!;
    expect(antes.cantidadVentas).toBe(1);

    const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA" } });
    await partirEnDosLotes(venta.id, s.flan.id);

    const despues = (await obtenerReporteDescuentosClientes(s.sucursalId, desde, hasta, prisma)).clientes[0]!;
    expect(despues.cantidadVentas).toBe(1);
    expect(despues).toMatchObject({ unidadesVendidas: antes.unidadesVendidas, ingresoALista: antes.ingresoALista, ingresoCobrado: antes.ingresoCobrado, totalDescontado: antes.totalDescontado });
  });

  it("margen de promos: un componente salido de dos lotes cuenta UN componente (y los ingresos son los mismos)", async () => {
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccionCarta.id, titulo: "Combo", precio: 1, activa: true } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id } });
    const promoCuenta = await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promo.id, precio: 12000, titulo: "Combo", creadoPorId: s.admin.id } });
    for (const c of [
      { productoId: s.milanesa.id, cantidad: 2, precioUnitario: 4800, precioCartaUnitario: 9000 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 2400, precioCartaUnitario: 3000 },
    ]) {
      await prisma.cuentaItem.create({ data: { ...c, cuentaId: cuenta.id, numeroEnvio: 1, creadoPorId: s.admin.id, promoCuentaId: promoCuenta.id } });
    }
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    const antes = (await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma)).promos[0]!;
    expect(antes.cantidadComponentes).toBe(2);

    const filaMilanesa = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA", productoId: s.milanesa.id } });
    await partirEnDosLotes(filaMilanesa.operacionId, s.milanesa.id);

    const despues = (await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, prisma)).promos[0]!;
    expect(despues.cantidadComponentes).toBe(2);
    expect(despues).toMatchObject({ ingresoALista: antes.ingresoALista, ingresoCobrado: antes.ingresoCobrado, cantidadInstancias: antes.cantidadInstancias });
  });
});
