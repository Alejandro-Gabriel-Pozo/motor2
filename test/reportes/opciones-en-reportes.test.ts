import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { cargarLineasDelPeriodo } from "../../src/server/consultas/reportes/periodo";
import { calcularMargenRealDelPeriodo } from "../../src/server/consultas/reportes/margen-real";
import { calcularRendimientoRecetasSimples } from "../../src/server/consultas/reportes/rendimiento-recetas";

/**
 * GO-2b (ADR-030), contra Postgres real, con un escenario propio (no toca `reportes-c0`): los reportes con ventas CON OPCIONES.
 *  - El Período marca la VENTA de una línea configurada o de un adicional (`lineaConfigurada`), y SOLO esas.
 *  - El margen real: una línea configurada SIN costo congelado se reconstruye con los CONSUMO de su propia operación por el costo del día, nunca con la receta del
 *    producto base.
 *  - El rendimiento de recetas: lo vendido con opciones no entra en lo vendido del plato y su consumo (lo escribió la venta) se resta de lo que entró: el estimado
 *    de la receta sale de lo vendido sin opciones.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
const db = () => baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).db;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
});

async function venderEnLaMesa(numero: number, items: Parameters<typeof agregarItems>[1]) {
  const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero } });
  const cuentaId = (await sembrarCuenta(mesa.id, s.admin.id)).id;
  expect((await agregarItems(cuentaId, items)).ok).toBe(true);
  const sinEnviar = await prisma.cuentaItem.findMany({ where: { cuentaId } });
  expect((await enviarACocina(cuentaId, sinEnviar.map((i) => i.id))).ok).toBe(true);
  expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
}

/** Una compra de `cantidad` del insumo a `precio` por unidad de stock, con fecha `fecha`. */
async function comprar(productoId: string, cantidad: number, precio: number, fecha: Date) {
  const op = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "COMPRA", fecha, usuarioId: s.admin.id } });
  await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId, seccionId: s.seccion.id, proceso: "COMPRA", cantidad, detalle: "Compra", precioTotal: cantidad * precio, precioPorUnidadStock: precio } });
}

describe("reportes con ventas con opciones (GO-2b)", () => {
  it("el Período marca solo las VENTA con opciones; el margen real reconstruye la configurada con SUS consumos (no con la receta base)", async () => {
    // Al vender no hay costo de la bebida de almendras: el café grande con almendras queda SIN costo congelado.
    await comprar(c.lecheId, 1, 1500, new Date(Date.now() - 3_600_000));
    await venderEnLaMesa(10, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId)] }]);
    await venderEnLaMesa(11, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId)] }]);
    const configurada = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA", precioTotal: 1250 } });
    expect(configurada.costoUnitarioVenta).toBeNull();
    // La compra de la bebida de almendras llega después, pero fechada ANTES de la venta: el costo del día la ve.
    await comprar(c.almendrasInsumoId, 1, 2000, new Date(Date.now() - 1_800_000));

    const desde = new Date(Date.now() - 86_400_000);
    const hasta = new Date(Date.now() + 86_400_000);
    const { items, productos } = await cargarLineasDelPeriodo(s.sucursalId, desde, hasta, {}, db());
    const ventas = items.filter((i) => i.proceso === "VENTA");
    expect(ventas.map((v) => [v.precioTotal, v.lineaConfigurada ?? false]).sort()).toEqual([
      [1000, true],
      [1250, true],
    ]);
    expect(items.filter((i) => i.proceso !== "VENTA").every((i) => i.lineaConfigurada === undefined)).toBe(true);

    const { costoPorItem } = await calcularMargenRealDelPeriodo(s.sucursalId, items, db(), productos);
    const costoDe = (precio: number) => costoPorItem[items.findIndex((i) => i.proceso === "VENTA" && i.precioTotal === precio)];
    // 0,2 kg de bebida de almendras × 2000 (su consumo), no 0,2 × 1,5 kg de leche × 1500 (la receta base escalada) ni 0,2 × 1500.
    expect(costoDe(1250)).toBe(400);
    // El mediano tenía costo congelado: 0,2 kg de leche × 1500.
    expect(costoDe(1000)).toBe(300);
  });

  it("rendimiento de recetas (método compras): lo vendido con opciones no cuenta como vendido del plato y su consumo se resta de lo que entró", async () => {
    // Dos cafés sin opciones del tamaño obligatorio no se pueden vender: se apaga el tamaño para este escenario.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoMedidaId }, data: { activo: false } });
    await prisma.versionDeOpcion.create({ data: { opcionId: c.vacaId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    const v2 = await prisma.versionDeOpcion.findFirstOrThrow({ where: { opcionId: c.vacaId, numero: 2 } });
    // «De vaca» v2 suma 0,1 kg de leche: el café configurado consume 0,3 kg (0,2 de la receta + 0,1 de la opción).
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: v2.id, efecto: "SUMA", insumoProductoId: c.lecheId, cantidad: "0.1000", unidadId: s.kg.id } });
    // Entró exactamente lo que se consumió: 0,4 kg (dos cafés sin opciones) + 0,3 kg (el configurado).
    await comprar(c.lecheId, 0.7, 1500, new Date(Date.now() - 3_600_000));
    await venderEnLaMesa(20, [{ productoId: c.cafeId, cantidad: 2 }]);
    await venderEnLaMesa(21, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.vacaId, 1, v2.id)] }]);

    const filas = await calcularRendimientoRecetasSimples(s.sucursalId, new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000), db());
    const cafe = filas.find((f) => f.productoVentaId === c.cafeId && f.insumoProductoId === c.lecheId)!;
    expect(cafe.metodo).toBe("COMPRAS");
    expect(cafe.totalVendido).toBe(2);
    expect(cafe.totalEntradas).toBe(0.7);
    // (0,7 − 0,3) / 2 = 0,2: la receta se cumple (sin restar lo configurado daría 0,7 / 3 ≈ 0,2333, un desvío inventado).
    expect(cafe.cantidadEstimada).toBe(0.2);
    expect(cafe.desviacionPorcentaje).toBe(0);
  });
});
