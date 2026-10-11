import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { obtenerReportePorPeriodo } from "../../src/server/consultas/reportes/periodo";

/**
 * Caracterización (Etapa A, punto 4b): clasificar un insumo como «No comestibles» cambia el ratio Compras/Ventas de un período YA CERRADO.
 *
 * La clasificación no se congela en el Kardex: se lee del catálogo cada vez que se arma el reporte (`esNoComestible` sale de `construirMapaProductos`
 * con el grupo ACTUAL del insumo del producto). Entonces, mover el insumo de la caja de un grupo a «No comestibles» no toca ni una fila del Kardex,
 * pero el reporte de agosto —y el «período anterior» que ve septiembre— pasan de 150 % a 50 %. Es lo que hace hoy el sistema; el test lo fija
 * tal cual, sin juzgar si es lo deseable.
 *
 * Es lectura: idempotencia y concurrencia no aplican. El reloj es una constante fija.
 */
const AHORA = new Date("2026-09-15T12:00:00Z");

describe("Mover un insumo a «No comestibles» cambia el ratio de un período pasado", () => {
  let sucursalId: string;
  let seccionId: string;
  let harinaId: string;
  let cajaId: string;
  let panId: string;
  let grupoDescartablesId: string;
  let grupoPackagingId: string;
  let insumoCajasId: string;

  const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prisma.insumo.deleteMany();
    await prisma.grupo.deleteMany();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const { kg } = await sembrarCatalogoBase();
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    harinaId = (await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId)).id;
    cajaId = (await sembrarProductoDisponible({ codigo: "MP_CAJA", nombre: "Caja de pizza", tipo: "MP", unidadStockId: kg.id }, sucursalId)).id;
    panId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, sucursalId)).id;

    // El grupo «No comestibles» ya existe (con «Packaging» adentro); la caja arranca en un grupo común, fuera de ese árbol.
    const noComestibles = await prisma.grupo.create({ data: { nombre: "No comestibles" } });
    grupoPackagingId = (await prisma.grupo.create({ data: { nombre: "Packaging", grupoPadreId: noComestibles.id } })).id;
    grupoDescartablesId = (await prisma.grupo.create({ data: { nombre: "Descartables" } })).id;
    insumoCajasId = (await prisma.insumo.create({ data: { nombre: "Cajas", grupoId: grupoDescartablesId } })).id;
    await prisma.producto.update({ where: { id: cajaId }, data: { insumoId: insumoCajasId } });

    // Agosto, por los casos de uso: $50 de harina, $100 de cajas, y un pan vendido a $100.
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-05"), seccionId, items: [{ productoId: harinaId, cantidad: 10, precioTotal: 50 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: d("2026-08-05"), seccionId, items: [{ productoId: cajaId, cantidad: 10, precioTotal: 100 }] });
    const v = await registrarVenta({ fecha: d("2026-08-06"), seccionId, ventas: [{ productoId: panId, cantidadVendida: 1 }] });
    expect(v.ok, v.mensaje).toBe(true);
  });

  const reporteDe = (desde: string, hasta: string) => obtenerReportePorPeriodo(sucursalId, d(desde), d(hasta), undefined, prisma, AHORA);

  async function fotoDelKardex() {
    const filas = await prisma.movimientoStock.count();
    const compras = await prisma.movimientoStock.aggregate({ where: { proceso: "COMPRA" }, _sum: { precioTotal: true } });
    return { filas, sumaPrecioTotalCompra: Number(compras._sum.precioTotal ?? 0) };
  }

  it("agosto pasa de 150 % a 50 % sin que el Kardex cambie, y septiembre ve el mismo cambio en su «período anterior»", async () => {
    const kardexAntes = await fotoDelKardex();
    expect(kardexAntes.sumaPrecioTotalCompra).toBe(150);

    const agostoAntes = await reporteDe("2026-08-01", "2026-08-31");
    const septiembreAntes = await reporteDe("2026-09-01", "2026-09-30");
    expect(agostoAntes.ratioGastoVentas.porcentaje).toBe(150);
    expect(agostoAntes.compras.totalNoComestibles).toBe(0);
    expect(agostoAntes.compras.totalGastado).toBe(150);
    expect(septiembreAntes.ratioGastoVentas.porcentajePeriodoAnterior).toBe(150);

    // Se MUEVE el insumo de la caja al grupo «Packaging», hijo de «No comestibles». Ninguna fila del Kardex se toca.
    await prisma.insumo.update({ where: { id: insumoCajasId }, data: { grupoId: grupoPackagingId } });

    const agostoDespues = await reporteDe("2026-08-01", "2026-08-31");
    const septiembreDespues = await reporteDe("2026-09-01", "2026-09-30");
    expect(agostoDespues.ratioGastoVentas.porcentaje).toBe(50);
    expect(agostoDespues.compras.totalNoComestibles).toBe(100);
    expect(agostoDespues.ratioGastoVentas.gastoNoComestibles).toBe(100);
    expect(agostoDespues.compras.totalGastado).toBe(150); // el gasto total no cambia: solo cambia cuánto de eso cuenta para el ratio
    expect(septiembreDespues.ratioGastoVentas.porcentajePeriodoAnterior).toBe(50);

    expect(await fotoDelKardex()).toEqual(kardexAntes);
  });
});
