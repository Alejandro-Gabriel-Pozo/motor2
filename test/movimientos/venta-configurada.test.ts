import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma, sembrarCompraDeKardex } from "../setup/test-db";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarSalon } from "../pos/salon-fixture";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import type { LineaVentaEnTx } from "../../src/core/movimientos/registrar-venta";
import type { ConsumoDeOpcionParaVender, OpcionConConsumo } from "../../src/core/movimientos/consumo-de-linea-configurada";
import { alicuotaDeLineaDeVenta } from "../../src/core/fiscal/alicuota-de-linea-de-venta";
import type { AlicuotaIva } from "../../src/core/fiscal/iva";

/**
 * GO-2b (ADR-030), contra Postgres real: el NÚCLEO de la venta (`registrarVentaEnTx`) con una línea configurada y un adicional. Fija: la MEDIDA escala la receta
 * (×1,5); REEMPLAZA cambia el insumo con su cantidad absoluta («el vaso no escala»); el adicional SUMA lo suyo; la merma de la opción; el arrastre de redondeo entre
 * dos ventas fraccionadas; UNA fila CONSUMO por insumo; la fila VENTA del producto y la del ancla; la operación del adicional nace con `operacionPadreId` (misma
 * sucursal y mismo lote); el mostrador no puede vender el ancla; solo el ancla VERIFICADA saltea la disponibilidad; y la paridad del costo congelado.
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
});

const actor = () => ({ usuarioId: s.admin.id, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre });
const vender = (lineas: LineaVentaEnTx[]) =>
  baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }).transaccion((tx) =>
    registrarVentaEnTx(tx, actor(), { fecha: new Date(), origen: { tipo: "automatico" }, proveedorId: null, detalle: "Mesa 4", lineas }, { permitirStockNegativo: true })
  );

const consumo = (insumoProductoId: string, cantidad: number, extra: Partial<ConsumoDeOpcionParaVender> = {}): ConsumoDeOpcionParaVender => ({
  efecto: "SUMA",
  insumoProductoId,
  reemplazaAProductoId: null,
  cantidad,
  unidadStockId: s.kg.id,
  mermaPorcentaje: 0,
  escalaConLaMedida: false,
  ...extra,
});
const medida = (opcionId: string, factorEscala: number | null): OpcionConConsumo => ({ opcionId, nombre: "Medida", tipo: "MEDIDA", ordenDeGrupo: 0, ordenDeOpcion: 0, cantidad: 1, factorEscala, consumos: [] });
const variante = (opcionId: string, consumos: ConsumoDeOpcionParaVender[]): OpcionConConsumo => ({ opcionId, nombre: "Variante", tipo: "VARIANTE", ordenDeGrupo: 1, ordenDeOpcion: 0, cantidad: 1, factorEscala: null, consumos });
const almendras = () => variante(c.almendrasId, [consumo(c.almendrasInsumoId, 0.2, { efecto: "REEMPLAZA", reemplazaAProductoId: c.lecheId })]);
const shot = (indiceLineaPadre: number, extra: Partial<{ anclaVerificada: string }> = {}): LineaVentaEnTx["configurada"] => ({
  tipo: "ADICIONAL",
  opcionId: c.shotId,
  anclaVerificada: extra.anclaVerificada ?? c.anclaDelShotId,
  consumos: [consumo(c.granoId, 0.01)],
  indiceLineaPadre,
});

async function filasDe(operacionIds: string[]) {
  const filas = await prisma.movimientoStock.findMany({ where: { operacionId: { in: operacionIds } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  return filas.map((f) => ({ op: operacionIds.indexOf(f.operacionId), proceso: f.proceso, productoId: f.productoId, cantidad: Number(f.cantidad), exacta: f.cantidadExacta === null ? null : Number(f.cantidadExacta), costo: f.costoUnitarioVenta === null ? null : Number(f.costoUnitarioVenta) }));
}

describe("registrarVentaEnTx con una línea configurada (GO-2b)", () => {
  it("café GRANDE con almendras ×2 y un shot (×2): la medida escala la receta pero el reemplazo no, el shot suma lo suyo; una VENTA por línea y el adicional cuelga del padre", async () => {
    const r = await vender([
      { productoId: c.cafeId, cantidadVendida: 2, precioUnitario: 1250, configurada: { tipo: "PRODUCTO", opciones: [medida(c.grandeId, 1.5), almendras()] } },
      { productoId: c.anclaDelShotId, cantidadVendida: 2, precioUnitario: 200, configurada: shot(0) },
    ]);
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
    if (!r.ok) return;
    const [opCafe, opShot] = r.operacionIds;
    const filas = await filasDe(r.operacionIds);
    expect(filas.filter((f) => f.proceso === "CONSUMO").map((f) => [f.op, f.productoId, f.cantidad])).toEqual([
      [0, c.almendrasInsumoId, -0.4], // REEMPLAZA: 0,2 por café, NO × 1,5 («el vaso no se multiplica»)
      [1, c.granoId, -0.02], // el shot: 0,01 × 2
    ]);
    expect(filas.filter((f) => f.proceso === "VENTA").map((f) => [f.op, f.productoId, f.cantidad])).toEqual([
      [0, c.cafeId, -2],
      [1, c.anclaDelShotId, -2],
    ]);
    const ops = await prisma.operacion.findMany({ where: { id: { in: r.operacionIds } } });
    const hija = ops.find((o) => o.id === opShot)!;
    const padre = ops.find((o) => o.id === opCafe)!;
    expect([hija.operacionPadreId, padre.operacionPadreId, hija.sucursalId, hija.fecha.getTime()]).toEqual([opCafe, null, padre.sucursalId, padre.fecha.getTime()]);
  });

  it("la MEDIDA escala la receta base (×1,5) con decimal exacto y la merma de una opción multiplica su consumo", async () => {
    const r = await vender([
      {
        productoId: c.cafeId,
        cantidadVendida: 1,
        precioUnitario: 1100,
        configurada: { tipo: "PRODUCTO", opciones: [medida(c.grandeId, 1.5), variante(c.vacaId, [consumo(c.granoId, 0.1, { mermaPorcentaje: 10 })])] },
      },
    ]);
    if (!r.ok) throw new Error(r.mensaje);
    expect((await filasDe(r.operacionIds)).filter((f) => f.proceso === "CONSUMO").map((f) => [f.productoId, f.cantidad])).toEqual([
      [c.lecheId, -0.3],
      [c.granoId, -0.11],
    ]);
  });

  it("UNA fila CONSUMO por insumo: si una opción suma el mismo insumo de la base, se junta con el de la receta", async () => {
    const r = await vender([{ productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1), variante(c.vacaId, [consumo(c.lecheId, 0.05)])] } }]);
    if (!r.ok) throw new Error(r.mensaje);
    expect((await filasDe(r.operacionIds)).filter((f) => f.proceso === "CONSUMO").map((f) => [f.productoId, f.cantidad])).toEqual([[c.lecheId, -0.25]]);
  });

  it("arrastre de redondeo entre dos ventas fraccionadas (kg con 2 decimales): 0,005 + 0,005 deja 0,01 en total, nunca dos ceros ni dos centésimas", async () => {
    const venta = () => vender([{ productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1), variante(c.vacaId, [consumo(c.granoId, 0.005)])] } }]);
    const a = await venta();
    const b = await venta();
    if (!a.ok || !b.ok) throw new Error("deberían venderse");
    const grano = [...(await filasDe(a.operacionIds)), ...(await filasDe(b.operacionIds))].filter((f) => f.productoId === c.granoId);
    expect(grano.map((f) => f.exacta)).toEqual([-0.005, -0.005]); // la cantidad exacta lleva el signo del consumo
    expect(Math.round(grano.reduce((suma, f) => suma + f.cantidad, 0) * 100) / 100).toBe(-0.01);
  });

  it("el adicional sin su producto en la venta (o colgado de otro adicional) se rechaza antes de escribir nada", async () => {
    expect(await vender([{ productoId: c.anclaDelShotId, cantidadVendida: 1, precioUnitario: 200, configurada: shot(0) }])).toMatchObject({ ok: false });
    expect(
      await vender([
        { productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1)] } },
        { productoId: c.anclaDelShotId, cantidadVendida: 1, precioUnitario: 200, configurada: shot(0) },
        { productoId: c.anclaDelShotId, cantidadVendida: 1, precioUnitario: 200, configurada: shot(1) },
      ])
    ).toMatchObject({ ok: false, mensaje: "«Shot extra» es un adicional sin su producto en la venta." });
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
  });

  it("solo el ancla VERIFICADA saltea la disponibilidad: un producto no disponible no pasa aunque venga como adicional, y el mostrador no puede vender el ancla", async () => {
    const otro = await prisma.producto.create({ data: { codigo: "PV_OTRO", nombre: "Otro sin disponibilidad", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "10.00" } });
    const r = await vender([
      { productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1)] } },
      { productoId: otro.id, cantidadVendida: 1, precioUnitario: 200, configurada: shot(0) },
    ]);
    expect(r).toEqual({ ok: false, mensaje: `«Otro sin disponibilidad» no está disponible en «${s.sucursal.nombre}».` });

    const mostrador = await registrarVentaCasoDeUso(
      { ...actor(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) },
      { fecha: new Date(), seccionId: s.seccion.id, ventas: [{ productoId: c.anclaDelShotId, cantidadVendida: 1 }] }
    );
    expect(mostrador).toMatchObject({ ok: false, mensaje: `«Shot extra» no está disponible en «${s.sucursal.nombre}».` });
  });

  it("un insumo de una opción en otra unidad que la de su stock se rechaza", async () => {
    const r = await vender([{ productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1), variante(c.vacaId, [consumo(c.granoId, 1, { unidadStockId: s.unidad.id })])] } }]);
    expect(r).toMatchObject({ ok: false, mensaje: expect.stringMatching(/en otra unidad que la de su stock/) });
  });

  it("paridad del costo congelado: con una configuración NEUTRA (mediano ×1, sin consumo propio) es el mismo que el del café sin opciones; el adicional cuesta lo suyo", async () => {
    await sembrarCompraDeKardex({ sucursalId: s.sucursalId, seccionId: s.seccion.id, usuarioId: s.admin.id, productoId: c.lecheId, proveedorId: null, fecha: "2026-10-01T12:00:00Z", precioPorUnidadStock: 1500 });
    await sembrarCompraDeKardex({ sucursalId: s.sucursalId, seccionId: s.seccion.id, usuarioId: s.admin.id, productoId: c.granoId, proveedorId: null, fecha: "2026-10-01T12:00:00Z", precioPorUnidadStock: 20000 });
    const sinOpciones = await vender([{ productoId: c.cafeId, cantidadVendida: 3, precioUnitario: 1000 }]);
    const neutra = await vender([
      { productoId: c.cafeId, cantidadVendida: 3, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1), variante(c.vacaId, [])] } },
      { productoId: c.anclaDelShotId, cantidadVendida: 3, precioUnitario: 200, configurada: shot(0) },
    ]);
    if (!sinOpciones.ok || !neutra.ok) throw new Error("deberían venderse");
    const costoDe = async (ids: string[], productoId: string) => (await filasDe(ids)).find((f) => f.proceso === "VENTA" && f.productoId === productoId)!.costo;
    expect(await costoDe(sinOpciones.operacionIds, c.cafeId)).toBe(300); // 0,2 kg × 1500
    expect(await costoDe(neutra.operacionIds, c.cafeId)).toBe(300);
    expect(await costoDe(neutra.operacionIds, c.anclaDelShotId)).toBe(200); // 0,01 kg × 20000
    // Grande con almendras: el costo sale de SUS pedidos (sin precio de la bebida de almendras: costo incompleto = null), no de la receta base.
    const conAlmendras = await vender([{ productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1250, configurada: { tipo: "PRODUCTO", opciones: [medida(c.grandeId, 1.5), almendras()] } }]);
    if (!conAlmendras.ok) throw new Error(conAlmendras.mensaje);
    expect(await costoDe(conAlmendras.operacionIds, c.cafeId)).toBeNull();
  });

  it("IVA (fuera de alcance, solo derivable): la alícuota del adicional sale de la del producto PADRE, resuelto por `operacionPadreId`, nunca de la del ancla", async () => {
    await prisma.producto.update({ where: { id: c.cafeId }, data: { alicuotaIvaVenta: "IVA_21" } });
    await prisma.producto.update({ where: { id: c.anclaDelShotId }, data: { alicuotaIvaVenta: "IVA_10_5" } });
    const r = await vender([
      { productoId: c.cafeId, cantidadVendida: 1, precioUnitario: 1000, configurada: { tipo: "PRODUCTO", opciones: [medida(c.medianoId, 1)] } },
      { productoId: c.anclaDelShotId, cantidadVendida: 1, precioUnitario: 200, configurada: shot(0) },
    ]);
    if (!r.ok) throw new Error(r.mensaje);
    const hija = await prisma.operacion.findUniqueOrThrow({ where: { id: r.operacionIds[1]! }, include: { movimientos: { where: { proceso: "VENTA" }, include: { producto: true } } } });
    const padre = await prisma.operacion.findUniqueOrThrow({ where: { id: hija.operacionPadreId! }, include: { movimientos: { where: { proceso: "VENTA" }, include: { producto: true } } } });
    const alicuota = alicuotaDeLineaDeVenta({
      alicuotaDelProducto: hija.movimientos[0]!.producto.alicuotaIvaVenta as AlicuotaIva,
      padre: { alicuotaDelProducto: padre.movimientos[0]!.producto.alicuotaIvaVenta as AlicuotaIva },
    });
    expect(alicuota).toEqual({ declarada: true, alicuota: "IVA_21" });
  });
});
