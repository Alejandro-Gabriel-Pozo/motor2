import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { anularPromoEnviadaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/anular-promo-enviada";
import { lineasDeVenta } from "../../src/core/pos/cuenta";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";
import type { ComandoAgregarItems } from "../../src/core/features/cuentas/cuenta-pedido.schema";
import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";

/**
 * GO-3b (ADR-032, frente B, F5 paso I3), contra Postgres real: CERRAR una cuenta con una línea que cayó en una combinación con RECETA PROPIA. Fija:
 *  - el consumo es el de la receta propia CONGELADA al agregar (no la base × la medida): una fila CONSUMO por insumo, con el envase de la medida que no escala aplicado encima, y el costo
 *    congelado de la venta sale de esos insumos;
 *  - cambiar la receta propia después de agregar el ítem no cambia lo que ya está en la mesa; dos ítems de la misma configuración con versiones distintas son dos Operaciones;
 *  - un combo con una entrada configurada (el café de la promo) consume sus opciones al cerrar;
 *  - `lineasDeVenta`: la versión de la receta separa la línea (y un espejo la hereda de su original), sin tocar lo que no la tiene.
 *
 *  - anular una promo con un componente configurado: el espejo repite la huella y netea (antes no la copiaba: el café se habría cobrado igual).
 *
 * Mutaciones demostradas (rojo y revertidas): no pasar la excepción a la venta en `cerrar-cuenta.ts` (3 en rojo) ni al consumo en `registrar-venta-en-tx.ts` (3 en rojo); sacar la versión de la
 * clave de `lineasDeVenta` (rojo: «dos Operaciones»); no copiar la huella al espejo de la promo (rojo: «anular»).
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
  // El TAMAÑO es el eje; el grande tiene su combinación con receta propia: 40 g de grano, 250 g de leche y el vaso chico (que el envase cambia por el grande).
  await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: c.cafeId, grupoId: c.grupoMedidaId } }, data: { ejeDeCombinacion: 1 } });
});

async function recetaPropiaDelGrande(numero: number, grano: number, leche: number) {
  const combinacion = (await prisma.combinacionDeProducto.findFirst({ where: { productoId: c.cafeId, opcionEje1Id: c.grandeId } })) ?? (await prisma.combinacionDeProducto.create({ data: { productoId: c.cafeId, opcionEje1Id: c.grandeId } }));
  return prisma.recetaDeCombinacionVersion.create({
    data: {
      combinacionId: combinacion.id,
      numero,
      creadoPorId: s.admin.id,
      ingredientes: {
        create: [
          { insumoProductoId: c.granoId, cantidad: grano, unidadId: s.kg.id, orden: 0 },
          { insumoProductoId: c.lecheId, cantidad: leche, unidadId: s.kg.id, orden: 1 },
          { insumoProductoId: vasoChicoId, cantidad: 1, unidadId: s.kg.id, orden: 2 },
        ],
      },
    },
  });
}

describe("cerrar una línea con receta propia de la combinación (GO-3b, I3)", () => {
  it("consume la receta propia congelada (no la base × 1,5), con el envase del tamaño encima; una fila por insumo; el costo sale de esos insumos", async () => {
    const v1 = await recetaPropiaDelGrande(1, 0.04, 0.25);
    // Costos: grano 20 000 el kg, leche 1 000 el kg, vasos 50 (la última compra de cada uno).
    const compra = await prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "COMPRA", fecha: new Date("2000-01-01T12:00:00Z"), usuarioId: s.admin.id } });
    for (const [productoId, precio] of [[c.granoId, 20000], [c.lecheId, 1000], [vasoChicoId, 50], [vasoGrandeId, 50]] as const) {
      await prisma.movimientoStock.create({ data: { operacionId: compra.id, productoId, seccionId: s.seccion.id, proceso: "COMPRA", cantidad: 100, detalle: "costo", precioTotal: 100 * precio, precioPorUnidadStock: precio } });
    }
    await pedirYEnviar([{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.grandeId)] }]);
    const foto = await prisma.combinacionEnLinea.findFirstOrThrow({});
    expect(foto.recetaDeCombinacionVersionId).toBe(v1.id);
    await cerrar();
    // Sin la receta propia serían 0,6 de leche (0,2 × 1,5 × 2) y nada de grano.
    expect(await consumos()).toEqual(esperados([[c.granoId, 0.08], [c.lecheId, 0.5], [vasoGrandeId, 2]]));
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA" } });
    // Costo por café: 0,04 × 20 000 + 0,25 × 1 000 + 1 × 50 = 800 + 250 + 50 = 1 100.
    expect(Number(venta.costoUnitarioVenta)).toBe(1100);
  });

  it("cambiar la receta propia después de agregar no cambia lo que está en la mesa; con dos versiones en la cuenta, dos Operaciones", async () => {
    await recetaPropiaDelGrande(1, 0.04, 0.25);
    await pedirYEnviar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }]);
    await recetaPropiaDelGrande(2, 0.05, 0.3);
    await pedirYEnviar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }]);
    await cerrar();
    const operaciones = await prisma.operacion.findMany({ where: { proceso: "VENTA" } });
    expect(operaciones).toHaveLength(2);
    expect(await consumos()).toEqual(esperados([[c.granoId, 0.09], [c.lecheId, 0.55], [vasoGrandeId, 2]]));
  });

  it("una versión sin ingredientes vuelve a la regla general: la base × la medida", async () => {
    const combinacion = await prisma.combinacionDeProducto.create({ data: { productoId: c.cafeId, opcionEje1Id: c.grandeId } });
    await prisma.recetaDeCombinacionVersion.create({ data: { combinacionId: combinacion.id, numero: 1, creadoPorId: s.admin.id } });
    await pedirYEnviar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId)] }]);
    await cerrar();
    expect(await consumos()).toEqual(esperados([[c.lecheId, 0.3], [vasoGrandeId, 1]]));
  });

  it("un combo con el café CONFIGURADO (grande, con su receta propia) consume la receta propia al cerrar", async () => {
    await recetaPropiaDelGrande(1, 0.04, 0.25);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Combos" } });
    const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Desayuno", precio: "1500.00" } })).id;
    const cupo = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Café", cantidadMinima: 1, cantidadMaxima: 1 } });
    const opciones = [{ opcionId: c.grandeId, cantidad: 1 }];
    await prisma.entradaDeCupo.create({ data: { cupoId: cupo.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });
    await pedirYEnviar([], [{ promoCartaId, elecciones: [] }]);
    await cerrar();
    expect(await consumos()).toEqual(esperados([[c.granoId, 0.04], [c.lecheId, 0.25], [vasoGrandeId, 1]]));
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "VENTA" } });
    expect(Number(venta.precioTotal)).toBe(1500);
  });

  it("anular la promo con el componente configurado: los espejos repiten la huella, netean y al cerrar no se cobra ni se consume nada de la promo", async () => {
    await recetaPropiaDelGrande(1, 0.04, 0.25);
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Combos" } });
    const promoCartaId = (await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: seccion.id, titulo: "Desayuno", precio: "1500.00" } })).id;
    const cafes = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Café", cantidadMinima: 1, cantidadMaxima: 1, orden: 0 } });
    const dulce = await prisma.promoCartaCupo.create({ data: { promoCartaId, tipo: "LISTA", nombre: "Dulce", cantidadMinima: 1, cantidadMaxima: 1, orden: 1 } });
    const opciones = [{ opcionId: c.grandeId, cantidad: 1 }];
    await prisma.entradaDeCupo.create({ data: { cupoId: cafes.id, productoId: c.cafeId, claveConfiguracion: claveDeConfiguracion(opciones)!, opciones: { create: opciones } } });
    await prisma.entradaDeCupo.create({ data: { cupoId: dulce.id, productoId: s.flan.id } });
    await pedirYEnviar([{ productoId: s.milanesa.id, cantidad: 1 }], [{ promoCartaId, elecciones: [] }]);
    const promoCuenta = await prisma.promoCuenta.findFirstOrThrow({ where: { cuentaId } });
    const r = await anularPromoEnviadaCasoDeUso(actor(), { promoCuentaId: promoCuenta.id, motivo: "Se equivocó de mesa" });
    expect(r.ok, r.mensaje).toBe(true);
    const espejoDelCafe = await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId, productoId: c.cafeId, anulaAItemId: { not: null } } });
    const original = await prisma.cuentaItem.findFirstOrThrow({ where: { id: espejoDelCafe.anulaAItemId! } });
    expect(espejoDelCafe.huellaOpciones).toBe(original.huellaOpciones);
    await cerrar();
    // Solo la milanesa se vendió (su reventa consume su propia MP); nada del café ni del flan.
    const vendidos = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA" } });
    expect(vendidos.map((v) => v.productoId)).toEqual([s.milanesa.id]);
    expect((await consumos()).filter(([id]) => [c.granoId, c.lecheId, vasoGrandeId].includes(id))).toEqual([]);
  });

  it("lineasDeVenta: la versión de la receta separa la línea y un espejo la hereda; sin ella, igual que siempre", () => {
    const base = { productoId: "cafe", precioUnitario: 1100, huellaOpciones: "a".repeat(64) };
    const items = [
      { ...base, id: "a", cantidad: 1, recetaDeCombinacion: "r1" },
      { ...base, id: "b", cantidad: 1, recetaDeCombinacion: "r2" },
      { ...base, id: "c", cantidad: -1, anulaAItemId: "a" },
    ];
    // El espejo de «a» hereda su versión (r1): esa línea queda en 0 y no se vende; «b» (r2) es otra línea.
    expect(lineasDeVenta(items).map((l) => [l.cantidad, l.itemIds])).toEqual([[1, ["b"]]]);
    // Con las dos versiones iguales (o sin receta), una sola línea de ×2, como siempre.
    expect(lineasDeVenta([{ ...base, id: "a", cantidad: 1, recetaDeCombinacion: "r1" }, { ...base, id: "b", cantidad: 1, recetaDeCombinacion: "r1" }]).map((l) => l.cantidad)).toEqual([2]);
    expect(lineasDeVenta([{ ...base, id: "a", cantidad: 1 }, { ...base, id: "b", cantidad: 1 }]).map((l) => l.cantidad)).toEqual([2]);
  });
});
