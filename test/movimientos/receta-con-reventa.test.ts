import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta, anularVenta } from "../../src/server/actions/movimientos/venta";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { agregarIngredienteAReceta, obtenerRecetaVigente } from "../../src/server/actions/catalogo/recetas";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";
import { listarMpDisponiblesEnAlguna } from "../../src/server/consultas/catalogo/recetas";
import { buscarProductosSelector } from "../../src/server/actions/catalogo/productos";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * E4-3b de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7, regla R7 CONFIRMADA el 2026-11-17): una REVENTA (tipo PV, clase REVENTA, no se produce) SÍ puede ser INGREDIENTE de la receta de otro producto.
 * Contra Postgres real: la receta que la nombra se guarda (por el guardado en bloque y por el editor de a un ingrediente) y el selector del editor la ofrece; vender el plato descuenta el stock PROPIO de la Reventa
 * (la misma cuenta que una MP: cantidad × receta, con merma; por el registro de venta y por el POS), una vez por clave de venta, sin perder filas con dos ventas a la vez, y la anulación lo devuelve con un movimiento
 * nuevo. Lo que se rechazaba hoy se sigue rechazando (un PV común, un producto inexistente, una unidad distinta de la de stock, una Reventa no disponible en la sucursal).
 *
 * FAMILIAS Y SUSTITUTOS (decisión de E4-3b, todo nace cerrado): una Reventa NO tiene Insumo (el alta del Insumo es solo de MP: `asignarInsumoAProducto`), así que su «familia» es ella sola y consume su propio stock;
 * no participa de las familias de insumo ni de la sustitución automática de otras MP (no se probó que deba y el dueño no lo pidió).
 *
 * Mutaciones: volver el validador de la receta (`receta-validacion.ts`) a `mp.tipo !== "MP"` pone en rojo guardar; volver `revisarMateriaPrima` (`linea-de-venta.ts`) a `tipo !== "MP"` pone en rojo las ventas;
 * volver `whereEsIngredienteDeReceta` a `{ tipo: "MP" }` pone en rojo los selectores; sacar `claseDeUso` del `select` de `cargarDatosParaValidarReceta` pone en rojo guardar (la clase llega vacía).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let reventaId: string, reventaKgId: string, comboId: string, pvSinRecetaId: string;

const compra = async (productoId: string, cantidad: number, seccionId = s.seccion.id) =>
  registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId, cantidad, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });
const saldo = (productoId: string, seccionId = s.seccion.id) => calcularSaldoTotal(productoId, seccionId, prisma);
const FECHA = new Date("2026-11-17T15:00:00Z"); // fija: la clave de idempotencia se ata al payload
const venta = (productoId: string, cantidadVendida: number, extra: { claveIdempotencia?: string } = {}) => registrarVenta({ fecha: FECHA, seccionId: s.seccion.id, ventas: [{ productoId, cantidadVendida }], ...extra });
const filas = (productoId: string, proceso: string) => prisma.movimientoStock.findMany({ where: { productoId, proceso: proceso as never }, orderBy: { creadoEn: "asc" } });
/** El plato «Combo»: 1 Gaseosa lata (Reventa, en unidades) + 0,5 kg de Queso rallado (Reventa, en kg) con 10 % de merma. */
const RECETA_DEL_COMBO = () => [
  { insumoProductoId: reventaId, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 },
  { insumoProductoId: reventaKgId, cantidad: 0.5, unidadId: s.kg.id, mermaPorcentaje: 10 },
];

async function sembrarReventa(codigo: string, nombre: string, unidadStockId: string, sucursalId = s.sucursalId) {
  const r = await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo, nombre, tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precioVenta: 1500, alicuotaIvaVenta: "IVA_21", unidadStockId } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: r.id, disponible: true } });
  return r.id;
}

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  reventaId = await sembrarReventa("PV_GASEOSA_R", "Gaseosa lata", s.unidad.id);
  reventaKgId = await sembrarReventa("PV_QUESO_R", "Queso rallado", s.kg.id);
  comboId = (await sembrarProductoDisponible({ codigo: "PV_COMBO", nombre: "Combo", tipo: "PV", precioVenta: 4000, unidadStockId: s.unidad.id }, s.sucursalId)).id;
  pvSinRecetaId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", precioVenta: 100, unidadStockId: s.unidad.id }, s.sucursalId)).id;
});

describe("GUARDAR la receta con una Reventa de ingrediente", () => {
  it("el guardado en bloque la acepta y la receta queda con sus ingredientes", async () => {
    const r = await guardarRecetaACiegas(comboId, RECETA_DEL_COMBO());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const guardada = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: comboId }, include: { ingredientes: true } });
    expect(guardada.ingredientes.map((i) => i.insumoProductoId).sort()).toEqual([reventaId, reventaKgId].sort());
  });

  it("el editor de a un ingrediente («Agregar ingrediente») la acepta", async () => {
    expect((await guardarRecetaACiegas(comboId, [{ insumoProductoId: s.muzzarella.id, cantidad: 0.2, unidadId: s.kg.id, mermaPorcentaje: 0 }])).ok).toBe(true);
    const vigente = await obtenerRecetaVigente(comboId);
    const r = await agregarIngredienteAReceta(comboId, { insumoProductoId: reventaId, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }, vigente!.version);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("la receta de una MP y la mezcla de MP con Reventa siguen guardándose como siempre", async () => {
    const r = await guardarRecetaACiegas(comboId, [{ insumoProductoId: s.muzzarella.id, cantidad: 0.2, unidadId: s.kg.id, mermaPorcentaje: 0 }, ...RECETA_DEL_COMBO().slice(0, 1)]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("lo que se rechazaba se sigue rechazando, con el texto de siempre: un PV común, un PV que se produce, un producto inexistente", async () => {
    const torta = await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: s.unidad.id, seProduce: true, precioVenta: 5000 }, s.sucursalId);
    for (const id of [pvSinRecetaId, torta.id, randomUUID()]) {
      const r = await guardarRecetaACiegas(comboId, [{ insumoProductoId: id, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }]);
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.mensaje, id).toContain("Cada ingrediente tiene que ser una materia prima (MP)");
    }
    expect(await prisma.recetaVersion.count({ where: { productoId: comboId } })).toBe(0);
  });

  it("la Reventa lleva su cantidad en la unidad de su stock (como una MP): otra unidad se rechaza y no guarda nada", async () => {
    const r = await guardarRecetaACiegas(comboId, [{ insumoProductoId: reventaId, cantidad: 1, unidadId: s.kg.id, mermaPorcentaje: 0 }]);
    expect(r.ok).toBe(false);
    expect(await prisma.recetaVersion.count({ where: { productoId: comboId } })).toBe(0);
  });

  it("una Reventa que no está disponible en NINGUNA sucursal no se acepta como ingrediente", async () => {
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: reventaId }, data: { disponible: false } });
    const r = await guardarRecetaACiegas(comboId, RECETA_DEL_COMBO().slice(0, 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("disponible en alguna sucursal");
  });

  it("los selectores del editor la ofrecen (junto con las MP) y siguen sin ofrecer un PV común", async () => {
    const del = (await listarMpDisponiblesEnAlguna(prisma)).map((p) => p.id);
    expect(del).toEqual(expect.arrayContaining([reventaId, reventaKgId, s.muzzarella.id]));
    expect(del).not.toContain(pvSinRecetaId);
    const buscador = await buscarProductosSelector("", { soloIngredienteDeReceta: true, soloDisponiblesEnAlguna: true });
    const ids = buscador.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([reventaId, reventaKgId, s.muzzarella.id]));
    expect(ids).not.toContain(pvSinRecetaId);
    expect(ids).not.toContain(comboId);
  });
});

describe("VENTA de un plato cuyo ingrediente es una Reventa (registro de venta)", () => {
  beforeEach(async () => {
    expect((await guardarRecetaACiegas(comboId, RECETA_DEL_COMBO())).ok).toBe(true);
    await compra(reventaId, 10);
    await compra(reventaKgId, 10);
  });

  it("descuenta el stock PROPIO de cada Reventa: cantidad × receta, con la merma y en la unidad de cada una", async () => {
    const r = await venta(comboId, 2);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await saldo(reventaId)).toBe(8); // 2 combos × 1 unidad
    expect(await saldo(reventaKgId)).toBeCloseTo(10 - 2 * 0.5 * 1.1, 6); // 2 combos × 0,5 kg × (1 + 10 % de merma)
    expect((await filas(reventaId, "CONSUMO")).map((m) => Number(m.cantidad))).toEqual([-2]);
    // Lo que se consume es solo lo que nombra la receta: las dos Reventas, nada del plato.
    const consumidos = await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO" }, select: { productoId: true } });
    expect([...new Set(consumidos.map((m) => m.productoId))].sort()).toEqual([reventaId, reventaKgId].sort());
  });

  it("IDEMPOTENCIA: la misma clave de venta repetida es UNA sola venta (el saldo de la Reventa baja una vez)", async () => {
    const clave = randomUUID();
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await venta(comboId, 1, { claveIdempotencia: clave }));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await filas(reventaId, "CONSUMO")).toHaveLength(1);
    expect(await saldo(reventaId)).toBe(9);
  });

  it("CONCURRENCIA: dos ventas a la vez con stock suficiente descuentan las dos y no se pierde ninguna fila", async () => {
    const rs = await Promise.all([venta(comboId, 1), venta(comboId, 2)]);
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
    expect(await saldo(reventaId)).toBe(7);
    expect(await filas(reventaId, "CONSUMO")).toHaveLength(2);
  });

  it("la anulación devuelve el stock de la Reventa con un movimiento NUEVO (la venta original no se edita)", async () => {
    await venta(comboId, 2);
    const [original] = await filas(reventaId, "CONSUMO");
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", movimientos: { some: { productoId: reventaId } } } });
    const r = await anularVenta(operacion.id, "Error de carga");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await saldo(reventaId)).toBe(10);
    expect(Number((await prisma.movimientoStock.findUniqueOrThrow({ where: { id: original.id } })).cantidad)).toBe(-2);
    expect((await prisma.movimientoStock.findMany({ where: { productoId: reventaId } })).map((m) => Number(m.cantidad)).sort((a, b) => a - b)).toEqual([-2, 2, 10]);
  });

  it("sin stock de la Reventa la venta del mostrador se rechaza igual que con una MP (la receta valida el faltante) y no escribe nada", async () => {
    await prismaAdmin.movimientoStock.deleteMany({ where: { productoId: reventaId } });
    const r = await venta(comboId, 1);
    expect(r.ok).toBe(false);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
    expect(await saldo(reventaKgId)).toBe(10);
  });

  it("AISLAMIENTO por sucursal: vender acá no toca el stock de otra sucursal, y donde la Reventa no está disponible el plato no se vende", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = await sembrarSeccion(norte.id, "Depósito Norte");
    const opNorte = await prisma.operacion.create({ data: { sucursalId: norte.id, proceso: "COMPRA", fecha: FECHA, usuarioId: s.admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: opNorte.id, productoId: reventaId, seccionId: seccionNorte.id, proceso: "COMPRA", cantidad: 5, detalle: "Stock de Norte (fixture)", precioTotal: 0, precioPorUnidadStock: 0 } });
    expect((await venta(comboId, 1)).ok).toBe(true);
    expect([await saldo(reventaId), await saldo(reventaId, seccionNorte.id)]).toEqual([9, 5]);
    // En Norte el plato está disponible pero la Reventa no: se rechaza nombrando la sucursal y el stock queda igual.
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte.id, productoId: comboId, disponible: true } });
    const rechazada = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, { usuarioId: s.admin.id, sucursalId: norte.id, sucursalNombre: "Norte" }, { fecha: FECHA, origen: { tipo: "seccion", seccionId: seccionNorte.id }, lineas: [{ productoId: comboId, cantidadVendida: 1 }] })
    );
    expect(rechazada.ok).toBe(false);
    if (!rechazada.ok) expect(rechazada.mensaje).toContain("no está disponible en «Norte»");
    expect(await saldo(reventaId, seccionNorte.id)).toBe(5);
  });
});

describe("VENTA de un plato cuyo ingrediente es una Reventa (POS)", () => {
  it("se pide, se envía, se cobra al cerrar y el saldo de la Reventa baja; la anulación de la venta lo devuelve", async () => {
    expect((await guardarRecetaACiegas(comboId, RECETA_DEL_COMBO().slice(0, 1))).ok).toBe(true);
    await compra(reventaId, 5);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const agregado = await agregarItems(cuenta.id, [{ productoId: comboId, cantidad: 2 }]);
    expect(agregado.ok, JSON.stringify(agregado)).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect((await enviarACocina(cuenta.id, items.map((i) => i.id))).ok).toBe(true);
    const cierre = await cerrarCuenta(cuenta.id);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await saldo(reventaId)).toBe(3);
    expect((await filas(reventaId, "CONSUMO")).map((m) => Number(m.cantidad))).toEqual([-2]);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", movimientos: { some: { productoId: reventaId } } } });
    expect((await anularVenta(operacion.id, "Cliente se arrepintió")).ok).toBe(true);
    expect(await saldo(reventaId)).toBe(5);
  });

  it("un plato sin receta sigue rechazándose al pedirlo", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    expect((await agregarItems(cuenta.id, [{ productoId: comboId, cantidad: 1 }])).ok).toBe(false);
  });
});

describe("lo que no cambia", () => {
  it("un plato con receta de MP se vende y descuenta la MP, como siempre", async () => {
    await compra(s.muzzarella.id, 10);
    const r = await venta(s.pizza.id, 2);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await saldo(s.muzzarella.id)).toBe(9.5);
  });
});
