import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { sembrarGaseosaPorOpcion } from "./gaseosa-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { anularPromoEnviadaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/anular-promo-enviada";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3d (ADR-032, combos): CERRAR una cuenta con un combo cuya entrada es un producto CONFIGURADO (el café grande de la promo), contra Postgres real. Fija:
 *  - el combo consume las opciones de su componente configurado al cerrar: la receta de la base × la medida (0,2 kg de leche × 1,5) y el ENVASE del tamaño encima (el vaso grande en lugar
 *    del chico, sin escalar); el precio cobrado es el de la promo;
 *  - anular una promo con un componente configurado: el espejo repite la huella del original, netea, y al cerrar no se cobra ni se consume nada de la promo.
 *
 * Rescatado de `cerrar-combinacion-go3.test.ts` (Fase 3 de la ola «precio y carta»): estos dos comportamientos son de los COMBOS (GO-3d, que se conserva) y allá solo se probaban con la
 * receta propia de una combinación (GO-3a, que se retira). Acá, sin combinación ni receta propia: el consumo es el de la regla general.
 *
 * Ventas con opciones, paso 3 (diseño 2026-10-29): una entrada con configuración fija sobre una base SIN receta («Gaseosa · Coca», la opción suma una botella) se vende en el combo y descuenta esa
 * botella; con una opción sin consumo («Gaseosa · Fanta») la entrada no se puede elegir (se descarta al leer las entradas de hoy) y el combo no se agrega.
 *
 * Mutaciones demostradas (rojas y revertidas): no copiar la huella al espejo en `anular-promo-enviada.ts` (rojo: «anular»); que el cierre no le pase al consumo las opciones del componente
 * configurado (rojo: «consume»).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;
let vasoChicoId: string;
let vasoGrandeId: string;

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
async function pedirYEnviar(items: ComandoAgregarItems["items"], promos: ComandoAgregarItems["promos"] = []) {
  const r = await agregarItemsCasoDeUso(actor(), { cuentaId, items, promos });
  expect(r.ok, r.mensaje).toBe(true);
  await prisma.cuentaItem.updateMany({ where: { cuentaId, numeroEnvio: null }, data: { numeroEnvio: 1 } });
}
const cerrar = async () => {
  const r = await cerrarCuentaCasoDeUso(actor(), { cuentaId });
  expect(r.ok, r.mensaje).toBe(true);
  return r;
};
/** Lo consumido por insumo (sumado entre las Operaciones de la cuenta), y que cada Operacion tiene una sola fila por insumo. */
const consumos = async () => {
  const filas = await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO" } });
  const porOperacion = new Set(filas.map((f) => `${f.operacionId}|${f.productoId}`));
  expect(porOperacion.size, "una fila CONSUMO por insumo y por Operacion").toBe(filas.length);
  const total = new Map<string, number>();
  for (const f of filas) total.set(f.productoId, Math.round(((total.get(f.productoId) ?? 0) - Number(f.cantidad)) * 10000) / 10000);
  return [...total].sort((a, b) => a[0].localeCompare(b[0]));
};
const esperados = (pares: [string, number][]) => pares.sort((a, b) => a[0].localeCompare(b[0]));

/** Una promo «Desayuno» de la sucursal con un cupo «Café» cuya única entrada es el café GRANDE (una configuración fija); `conDulce` le suma un cupo «Dulce» con el flan. */
async function desayuno(conDulce: boolean): Promise<string> {
  const seccion = await prisma.seccionCarta.create({ data: { nombre: "Combos" } });
  const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Desayuno", precio: "1500.00" } })).id;
  const cafes = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Café", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 } });
  const opciones = [{ opcionId: c.grandeId, cantidad: 1 }];
  await prisma.entradaDeCupo.create({ data: { cupoId: cafes.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });
  if (conDulce) {
    const dulce = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Dulce", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 } });
    await prisma.entradaDeCupo.create({ data: { cupoId: dulce.id, productoId: s.flan.id } });
  }
  return promoCartaId;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
  const mp = async (codigo: string, nombre: string) => {
    const p = await prisma.producto.create({ data: { codigo, nombre, tipo: "MP", unidadStockId: s.kg.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: p.id, disponible: true } });
    return p.id;
  };
  vasoChicoId = await mp("MP_VASO_CH", "Vaso chico");
  vasoGrandeId = await mp("MP_VASO_GR", "Vaso grande");
  // La receta de la base lleva el vaso chico; el ENVASE del grande lo reemplaza por el vaso grande (no escala con la medida).
  const receta = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: c.cafeId } });
  await prisma.recetaIngrediente.create({ data: { recetaVersionId: receta.id, insumoProductoId: vasoChicoId, cantidad: 1, unidadId: s.kg.id, mermaPorcentaje: 0 } });
  await prisma.consumoDeOpcion.create({
    data: { versionDeOpcionId: c.versionDe[c.grandeId]!, efecto: "REEMPLAZA", insumoProductoId: vasoGrandeId, reemplazaAProductoId: vasoChicoId, cantidad: "1.0000", unidadId: s.kg.id, escalaConLaMedida: false },
  });
});

describe("cerrar un combo con un componente configurado (GO-3d)", () => {
  it("el combo con el café GRANDE consume sus opciones al cerrar: la base × 1,5 y el vaso grande; se cobra el precio de la promo", async () => {
    const promoCartaId = await desayuno(false);
    await pedirYEnviar([], [{ promoCartaId, elecciones: [] }]);
    await cerrar();
    // 0,2 kg de leche × 1,5 (el grande) y el vaso grande en lugar del chico (sin escalar).
    expect(await consumos()).toEqual(esperados([[c.lecheId, 0.3], [vasoGrandeId, 1]]));
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA" } });
    expect(Number(venta.precioTotal)).toBe(1500);
  });

  it("anular la promo con el componente configurado: los espejos repiten la huella, netean y al cerrar no se cobra ni se consume nada de la promo", async () => {
    const promoCartaId = await desayuno(true);
    await pedirYEnviar([{ productoId: s.milanesa.id, cantidad: 1 }], [{ promoCartaId, elecciones: [] }]);
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
    const r = await anularPromoEnviadaCasoDeUso(actor(), { promoCuentaId: promoCuenta.id, motivo: "Se equivocó de mesa" });
    expect(r.ok, r.mensaje).toBe(true);
    const espejoDelCafe = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: c.cafeId, anulaAItemId: { not: null } } });
    const original = await prisma.cuentaItem.findFirstOrThrow({ where: { id: espejoDelCafe.anulaAItemId! } });
    expect(original.huellaOpciones).not.toBeNull();
    expect(espejoDelCafe.huellaOpciones).toBe(original.huellaOpciones);
    await cerrar();
    // Solo la milanesa se vendió (su reventa consume su propia MP); nada del café ni del flan.
    const vendidos = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA" } });
    expect(vendidos.map((v) => v.productoId)).toEqual([s.milanesa.id]);
    expect((await consumos()).filter(([id]) => [c.lecheId, vasoChicoId, vasoGrandeId].includes(id))).toEqual([]);
  });

  it("ventas con opciones: la entrada «Gaseosa · Coca» sobre una base SIN receta se vende en el combo y descuenta la botella de la opción; con «Gaseosa · Fanta» (sin consumo) el combo no se agrega", async () => {
    const g = await sembrarGaseosaPorOpcion(s);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Combos de bebida" } });
    const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Bebida del día", precio: "2000.00" } })).id;
    const cupo = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 } });
    const fanta = [{ opcionId: g.fantaId, cantidad: 1 }];
    const entradaFanta = await prisma.entradaDeCupo.create({ data: { cupoId: cupo.id, productoId: g.gaseosaId, claveConfiguracion: claveDeConfiguracion(fanta)!, opciones: { create: fanta } } });
    // Con la entrada «Gaseosa · Fanta» sola (la opción no descuenta nada y la base no tiene receta), el lugar queda sin nada que elegir: el combo no se agrega y no se escribe nada.
    const sinNada = await agregarItemsCasoDeUso(actor(), { cuentaId, items: [], promos: [{ promoCartaId, elecciones: [] }] });
    expect(sinNada.ok).toBe(false);
    expect(await prisma.cuentaItem.count({ where: { cuentaId } })).toBe(0);
    expect(await prisma.promoCuenta.count()).toBe(0);

    // Se reemplaza por «Gaseosa · Coca» (suma una botella): se agrega, se cobra el precio de la promo y se descuenta la botella.
    await prisma.entradaDeCupo.update({ where: { id: entradaFanta.id }, data: { activa: false } });
    const coca = [{ opcionId: g.cocaId, cantidad: 1 }];
    await prisma.entradaDeCupo.create({ data: { cupoId: cupo.id, productoId: g.gaseosaId, claveConfiguracion: claveDeConfiguracion(coca)!, opciones: { create: coca } } });
    await pedirYEnviar([], [{ promoCartaId, elecciones: [] }]);
    await cerrar();
    expect(await consumos()).toEqual(esperados([[g.botellaId, 1]]));
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA", productoId: g.gaseosaId } });
    expect(Number(venta.precioTotal)).toBe(2000);
  });
});
