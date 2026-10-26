import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { obtenerReporteMargenPromociones } from "../../src/server/consultas/reportes/margen-promociones";
import { cargarLineasDelPeriodo } from "../../src/server/consultas/reportes/periodo";
import { calcularMargenRealDelPeriodo } from "../../src/server/consultas/reportes/margen-real";
import { calcularRendimientoRecetasSimples } from "../../src/server/consultas/reportes/rendimiento-recetas";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3b (ADR-032, F5 paso I4), contra Postgres real y con un escenario propio (no toca `reportes-c0`): los REPORTES con lo que vende GO-3d — un combo con una entrada CONFIGURADA (el café grande).
 * Fija:
 *  - margen de promociones: el componente configurado pesa a lista con su lista compuesta (`precioCartaUnitario`) y su costo es el congelado al vender, que ya incluye las opciones (la medida);
 *  - margen real: sin costo congelado, la línea configurada se reconstruye con los CONSUMO de SU operación (la base × 1,5 del grande), nunca con la receta de la base sin escalar;
 *  - rendimiento de recetas: lo vendido con opciones (una línea configurada) no entra en lo vendido del plato ni su consumo en el de la receta.
 *
 * Fase 3 de la ola «precio y carta»: reescrito SIN la receta propia de una combinación (GO-3a se retira). El grande tiene factor 1,5, así que reconstruir con la receta de la base (sin escalar)
 * sigue dando otro costo (200 en vez de 300): la prueba sigue detectando ese error.
 *
 * Mutación demostrada (roja y revertida): reconstruir el margen real de una línea configurada con la receta de la base (rojo: «margen real»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
const db = () => baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;
const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  empresaZonaHoraria: ZONA_ARGENTINA,
  email: "admin@test.com",
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});

async function venderEnLaMesa(numero: number, items: ComandoAgregarItems["items"], promos: ComandoAgregarItems["promos"] = []) {
  const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero } });
  const cuentaId = (await sembrarCuenta(mesa.id, s.admin.id)).id;
  const r = await agregarItemsCasoDeUso(actor(), { cuentaId, items, promos });
  expect(r.ok, r.mensaje).toBe(true);
  await prisma.cuentaItem.updateMany({ where: { cuentaId }, data: { numeroEnvio: 1 } });
  const cierre = await cerrarCuentaCasoDeUso(actor(), { cuentaId });
  expect(cierre.ok, cierre.mensaje).toBe(true);
}
async function comprar(productoId: string, cantidad: number, precio: number) {
  const op = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "COMPRA", fecha: new Date(Date.now() - 3_600_000), usuarioId: s.admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId: s.seccion.id, proceso: "COMPRA", cantidad, detalle: "Compra", precioTotal: cantidad * precio, precioPorUnidadStock: precio } });
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  // Costos: leche 1 000 el kg → el café grande consume 0,2 × 1,5 = 0,3 kg = 300.
  await comprar(c.lecheId, 10, 1000);
});

async function desayuno() {
  const seccion = await prisma.seccionCarta.create({ data: { nombre: "Combos" } });
  const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Desayuno", precio: "1000.00" } })).id;
  const cupo = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Café", cantidadMinima: 1, cantidadMaxima: 1 } });
  const opciones = [{ opcionId: c.grandeId, cantidad: 1 }];
  await prisma.entradaDeCupo.create({ data: { cupoId: cupo.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });
  return promoCartaId;
}

const rango = () => ({ desde: new Date(Date.now() - 86_400_000), hasta: new Date(Date.now() + 86_400_000) });

describe("reportes con lo que vende GO-3d (I4)", () => {
  it("margen de promociones: el café configurado pesa a su lista compuesta (1 100) y cuesta lo congelado con sus opciones (300): margen 700 sobre lo cobrado", async () => {
    const promoCartaId = await desayuno();
    await venderEnLaMesa(30, [], [{ promoCartaId, elecciones: [] }]);
    const { desde, hasta } = rango();
    const rep = await obtenerReporteMargenPromociones(s.sucursalId, desde, hasta, db());
    const fila = rep.promos.find((p) => p.promoCartaId === promoCartaId)!;
    expect({ cobrado: fila.ingresoCobrado, aLista: fila.ingresoALista, ahorro: fila.ahorroCliente, margen: fila.margenReal, suelto: fila.margenRealSueltoEquivalente }).toEqual({
      cobrado: 1000,
      aLista: 1100,
      ahorro: 100,
      margen: 700,
      suelto: 800,
    });
  });

  it("margen real sin costo congelado: se reconstruye con los CONSUMO de su operación (la base × 1,5), no con la receta de la base", async () => {
    await venderEnLaMesa(31, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }]);
    await prismaAdmin.movimientoStock.updateMany({ where: { proceso: "VENTA" }, data: { costoUnitarioVenta: null } });
    const { desde, hasta } = rango();
    const { items, productos } = await cargarLineasDelPeriodo(s.sucursalId, desde, hasta, {}, db());
    const { costoPorItem } = await calcularMargenRealDelPeriodo(s.sucursalId, items, db(), productos);
    // Lo consumido por su operación: 0,2 × 1,5 kg de leche × 1 000 = 300; la receta de la base sin escalar daría 200.
    expect(costoPorItem[items.findIndex((i) => i.proceso === "VENTA")]).toBe(300);
  });

  it("rendimiento de recetas: lo vendido con opciones no cuenta como vendido del plato", async () => {
    await venderEnLaMesa(32, [{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId)] }]);
    const filas = await calcularRendimientoRecetasSimples(s.sucursalId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000), db());
    const leche = filas.find((f) => f.productoVentaId === c.cafeId && f.insumoProductoId === c.lecheId);
    // Sin ventas del plato sin opciones, lo vendido de la receta es 0 (las dos del grande, configuradas, van aparte).
    expect(leche === undefined || leche.totalVendido === 0).toBe(true);
  });
});
