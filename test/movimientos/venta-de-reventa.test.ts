import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta, anularVenta } from "../../src/server/actions/movimientos/venta";
import { registrarConteosFisicos } from "../../src/server/actions/movimientos/conteo-fisico";
import { crearEnvioDirectoTransferencia } from "../../src/server/actions/traspasos/traspasos";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { anularItemEnviado } from "../../src/server/actions/pos/cuenta-anulacion";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { calcularStockConsolidado } from "../../src/server/consultas/stock/consolidado";
import { calcularValuacionInventario } from "../../src/server/consultas/reportes/valuacion";
import { obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";
import { listarStockParaConteo } from "../../src/server/consultas/movimientos/stock-para-conteo";
import { cargarSelectorCartaPos } from "../../src/server/lecturas/pos/selector-carta";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * E4-3a de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7): el STOCK y la VENTA de una Reventa. Contra Postgres real: una REVENTA sembrada (tipo PV, clase REVENTA, no se produce) se compra (E4-2), se
 * VENDE descontando SU PROPIO stock (FEFO, mismo plan que un PV que se produce), SIN receta y sin aviso de «falta receta», por el registro de venta y por el POS; la anulación devuelve el saldo con un
 * movimiento nuevo; el conteo físico y el traspaso la admiten. Nadie crea Reventas todavía (E4-5): en producción no cambia nada.
 *
 * POLÍTICA DE STOCK INSUFICIENTE (verificada en el código y por prueba contra un PV que se produce; fijada acá, NO cambiada): la validación de faltantes de la venta (`faltantesDe`, en
 * `registrarVentaEnTx`) mira solo los insumos que consume una receta; el stock PROPIO (un PV que se produce, y ahora una Reventa) se descuenta SIN validar el saldo, ni en el mostrador ni en el POS: vender
 * sin stock deja el saldo en negativo, sin rechazo y sin aviso, y dos ventas a la vez del último saldo se hacen las dos. Es lo que hoy hace un PV que se produce y la Reventa lo hereda; si el dueño quiere que
 * una Reventa sin stock se rechace, es una decisión aparte (ver el informe de E4-3a).
 *
 * Mutaciones: volver `armarLinea` a `producto.seProduce` (sin `seVendeDeSuStockPropio`) pone en rojo las ventas (piden receta); volver el cargador de origen de stock del POS a `p.seProduce` pone en rojo
 * «POS»; volver `tieneStockReal` a `(tipo, seProduce)` pone en rojo conteo y traspaso; sacar `stockPropio` de `esAnclaVerificada` o del rechazo de opciones pone en rojo «con opciones».
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let reventaId: string, pvSinRecetaId: string;

const compra = async (productoId: string, cantidad: number, seccionId = s.seccion.id) =>
  registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId, items: [{ productoId, cantidad, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });
const saldo = (productoId: string, seccionId = s.seccion.id) => calcularSaldoTotal(productoId, seccionId, prisma);
const FECHA = new Date("2026-11-17T15:00:00Z"); // fija: la clave de idempotencia se ata al payload
const venta = (productoId: string, cantidadVendida: number, extra: { claveIdempotencia?: string } = {}) => registrarVenta({ fecha: FECHA, seccionId: s.seccion.id, ventas: [{ productoId, cantidadVendida }], ...extra });
const filas = (productoId: string, proceso: string) => prisma.movimientoStock.findMany({ where: { productoId, proceso: proceso as never }, orderBy: { creadoEn: "asc" } });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  // La Reventa se siembra con el cliente administrador (nadie la crea desde la app hasta E4-5); la disponibilidad, como siempre. Sin receta.
  const reventa = await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo: "PV_GASEOSA_R", nombre: "Gaseosa lata", tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precioVenta: 1500, alicuotaIvaVenta: "IVA_21", unidadStockId: s.unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: reventa.id, disponible: true } });
  reventaId = reventa.id;
  pvSinRecetaId = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", precioVenta: 100, unidadStockId: s.unidad.id }, s.sucursalId)).id;
});

describe("VENTA de una Reventa por el registro de venta", () => {
  it("se vende sin receta descontando SU stock: el saldo baja y la única fila de la venta es la de la propia Reventa", async () => {
    expect((await compra(reventaId, 5)).ok).toBe(true);
    expect(await saldo(reventaId)).toBe(5);
    const r = await venta(reventaId, 2);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await saldo(reventaId)).toBe(3);
    const ventas = await filas(reventaId, "VENTA");
    expect(ventas.map((m) => Number(m.cantidad))).toEqual([-2]);
    // Nada más se movió: ni consumo de receta de otro producto ni aviso.
    expect(await prisma.movimientoStock.count({ where: { proceso: "VENTA", productoId: { not: reventaId } } })).toBe(0);
  });

  it("FEFO: la venta toma primero del lote que vence antes y se parte en una fila por lote (el mismo plan de un PV que se produce)", async () => {
    const lote = async (cantidad: number, loteVencimiento: Date) =>
      registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId: s.seccion.id, items: [{ productoId: reventaId, cantidad, loteVencimiento, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });
    await lote(4, new Date("2027-02-01"));
    await lote(2, new Date("2027-01-01"));
    expect((await venta(reventaId, 3)).ok).toBe(true);
    const ventas = (await filas(reventaId, "VENTA")).map((m) => [m.loteVencimiento?.toISOString().slice(0, 10) ?? null, Number(m.cantidad)]);
    expect(ventas.sort()).toEqual([["2027-01-01", -2], ["2027-02-01", -1]]);
    expect(await saldo(reventaId)).toBe(3);
  });

  it("una receta que no debería tener (la Reventa no la lleva) no se consume: se vende de su stock, no de la receta", async () => {
    await prisma.recetaVersion.create({ data: { productoId: reventaId, version: 1, ingredientes: { create: [{ insumoProductoId: s.muzzarella.id, cantidad: 0.25, unidadId: s.kg.id, mermaPorcentaje: 0 }] } } });
    await compra(reventaId, 5);
    await compra(s.muzzarella.id, 10);
    expect((await venta(reventaId, 2)).ok).toBe(true);
    expect([await saldo(reventaId), await saldo(s.muzzarella.id)]).toEqual([3, 10]);
  });

  it("POLÍTICA VIGENTE (igual que un PV que se produce): sin stock la venta se hace y el saldo queda en negativo, sin rechazo", async () => {
    const torta = await sembrarProductoDisponible({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: s.unidad.id, seProduce: true, precioVenta: 5000 }, s.sucursalId);
    const deTorta = await venta(torta.id, 1);
    const deReventa = await venta(reventaId, 1);
    expect([deTorta.ok, deReventa.ok]).toEqual([true, true]);
    expect([await saldo(torta.id), await saldo(reventaId)]).toEqual([-1, -1]);
  });

  it("CONCURRENCIA: dos ventas a la vez del último saldo se hacen las dos y se serializan sin romper (política vigente: el stock propio no se valida)", async () => {
    await compra(reventaId, 1);
    const rs = await Promise.all([venta(reventaId, 1), venta(reventaId, 1)]);
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
    expect(await saldo(reventaId)).toBe(-1); // 1 comprada - 2 vendidas: ninguna fila se pierde ni se duplica
  });

  it("IDEMPOTENCIA: la misma clave de venta repetida es UNA sola venta (el saldo baja una vez)", async () => {
    await compra(reventaId, 5);
    const clave = randomUUID();
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await venta(reventaId, 1, { claveIdempotencia: clave }));
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await filas(reventaId, "VENTA")).toHaveLength(1);
    expect(await saldo(reventaId)).toBe(4);
  });

  it("la anulación de la venta devuelve el saldo con un movimiento NUEVO (la venta original no se edita)", async () => {
    await compra(reventaId, 5);
    await venta(reventaId, 2);
    const [original] = await filas(reventaId, "VENTA");
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", movimientos: { some: { productoId: reventaId } } } });
    const r = await anularVenta(operacion.id, "Error de carga");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await saldo(reventaId)).toBe(5);
    const despues = await prisma.movimientoStock.findUniqueOrThrow({ where: { id: original.id } });
    expect(Number(despues.cantidad)).toBe(-2);
    expect((await prisma.movimientoStock.findMany({ where: { productoId: reventaId } })).map((m) => Number(m.cantidad)).sort((a, b) => a - b)).toEqual([-2, 2, 5]);
  });

  it("lo que no cambia: un PV común sin receta se sigue rechazando y una MP no se vende", async () => {
    const pan = await venta(pvSinRecetaId, 1);
    expect(pan.ok).toBe(false);
    if (!pan.ok) expect(pan.mensaje).toBe("«Pan» no tiene receta: armala en Catálogo → Recetas para poder venderla.");
    const mp = await venta(s.muzzarella.id, 1);
    expect(mp.ok).toBe(false);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
  });

  it("con OPCIONES elegidas una Reventa todavía no se vende (E4-3b): se rechaza cerrado, sin tocar el stock", async () => {
    await compra(reventaId, 5);
    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(
        tx,
        { usuarioId: s.admin.id, sucursalId: s.sucursalId, sucursalNombre: "Central" },
        { fecha: new Date(), origen: { tipo: "seccion", seccionId: s.seccion.id }, lineas: [{ productoId: reventaId, cantidadVendida: 1, configurada: { tipo: "PRODUCTO", opciones: [] } as never }] }
      )
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("todavía no se puede vender con opciones");
    expect(await saldo(reventaId)).toBe(5);
  });

  it("AISLAMIENTO por sucursal: vender acá no toca el stock de otra sucursal, y donde la Reventa no está disponible no se vende", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = await sembrarSeccion(norte.id, "Depósito Norte");
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte.id, productoId: reventaId, disponible: true } });
    // El stock de Norte se siembra directo (la compra por la acción es de la sucursal de quien la hace).
    const opNorte = await prisma.operacion.create({ data: { sucursalId: norte.id, proceso: "COMPRA", fecha: FECHA, usuarioId: s.admin.id } });
    await prisma.movimientoStock.create({ data: { operacionId: opNorte.id, productoId: reventaId, seccionId: seccionNorte.id, proceso: "COMPRA", cantidad: 5, detalle: "Stock de Norte (fixture)", precioTotal: 0, precioPorUnidadStock: 0 } });
    await compra(reventaId, 3);
    expect((await venta(reventaId, 2)).ok).toBe(true);
    expect([await saldo(reventaId), await saldo(reventaId, seccionNorte.id)]).toEqual([1, 5]);
    // No disponible en la otra sucursal: ahí no se vende (la disponibilidad manda, como con cualquier producto).
    await prisma.disponibilidadProducto.updateMany({ where: { sucursalId: norte.id, productoId: reventaId }, data: { disponible: false } });
    const r = await prisma.$transaction((tx) =>
      registrarVentaEnTx(tx, { usuarioId: s.admin.id, sucursalId: norte.id, sucursalNombre: "Norte" }, { fecha: FECHA, origen: { tipo: "seccion", seccionId: seccionNorte.id }, lineas: [{ productoId: reventaId, cantidadVendida: 1 }] })
    );
    expect(r.ok).toBe(false);
    expect(await saldo(reventaId, seccionNorte.id)).toBe(5);
  });
});

describe("VENTA de una Reventa por el POS", () => {
  it("se pide sin receta, se envía, se cobra al cerrar y el saldo baja; la anulación de la venta lo devuelve", async () => {
    await compra(reventaId, 5);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const agregado = await agregarItems(cuenta.id, [{ productoId: reventaId, cantidad: 2 }]);
    expect(agregado.ok, JSON.stringify(agregado)).toBe(true);
    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect((await enviarACocina(cuenta.id, items.map((i) => i.id))).ok).toBe(true);
    const cierre = await cerrarCuenta(cuenta.id);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await saldo(reventaId)).toBe(3);
    expect((await filas(reventaId, "VENTA")).map((m) => Number(m.cantidad))).toEqual([-2]);

    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", movimientos: { some: { productoId: reventaId } } } });
    expect((await anularVenta(operacion.id, "Cliente se arrepintió")).ok).toBe(true);
    expect(await saldo(reventaId)).toBe(5);
  });

  it("un ítem enviado se anula (la cuenta no cobra lo anulado) y el cierre descuenta solo lo que quedó", async () => {
    await compra(reventaId, 5);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: reventaId, cantidad: 3, precioUnitario: 1500, numeroEnvio: 1 }]);
    const [item] = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect((await anularItemEnviado(item.id, 1, "Pidió una menos", 3)).ok).toBe(true);
    expect((await cerrarCuenta(cuenta.id)).ok).toBe(true);
    expect(await saldo(reventaId)).toBe(3);
  });

  it("política vigente en el POS: sin stock se cobra igual y el saldo queda en negativo (como un PV que se produce)", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: reventaId, cantidad: 1, precioUnitario: 1500, numeroEnvio: 1 }]);
    const cierre = await cerrarCuenta(cuenta.id);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await saldo(reventaId)).toBe(-1);
  });

  it("un PV común sin receta se sigue rechazando al pedirlo", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const r = await agregarItems(cuenta.id, [{ productoId: pvSinRecetaId, cantidad: 1 }]);
    expect(r.ok).toBe(false);
  });
});

describe("conteo físico y traspaso de una Reventa", () => {
  it("el conteo físico la admite y ajusta su saldo", async () => {
    await compra(reventaId, 5);
    const r = await registrarConteosFisicos([{ productoId: reventaId, seccionId: s.seccion.id, conteoReal: 4, fechaConteo: new Date(), accion: "AJUSTAR" }]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.resultados[0].ok, JSON.stringify(r.resultados[0])).toBe(true);
    expect(await saldo(reventaId)).toBe(4);
  });

  it("el conteo físico sigue rechazando un PV común", async () => {
    const r = await registrarConteosFisicos([{ productoId: pvSinRecetaId, seccionId: s.seccion.id, conteoReal: 4, fechaConteo: new Date(), accion: "AJUSTAR" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resultados[0].ok).toBe(false);
  });

  it("el traspaso (envío directo) la admite y descuenta de la sección de origen", async () => {
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    await sembrarSeccion(norte.id, "Depósito Norte");
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte.id, productoId: reventaId, disponible: true } });
    await compra(reventaId, 5);
    const envio = await crearEnvioDirectoTransferencia({ destinoSucursalId: norte.id, productoId: reventaId, cantidad: 2, seccionOrigenId: s.seccion.id });
    expect(envio.ok, JSON.stringify(envio)).toBe(true);
    expect(await saldo(reventaId)).toBe(3);
  });
});

describe("lecturas de stock de una Reventa", () => {
  it("aparece en el stock consolidado, en la valuación, en la grilla de conteo, en el historial y en el selector del POS (con stock real); un PV común, no", async () => {
    await compra(reventaId, 5);
    const consolidado = await calcularStockConsolidado(s.sucursalId, prisma);
    expect(consolidado.some((f) => f.productoId === reventaId)).toBe(true);
    expect(consolidado.some((f) => f.productoId === pvSinRecetaId)).toBe(false);
    const valuacion = await calcularValuacionInventario(s.sucursalId, prisma);
    expect(valuacion.filas.find((f) => f.productoId === reventaId)?.saldo).toBe(5);
    expect(valuacion.filas.some((f) => f.productoId === pvSinRecetaId)).toBe(false);
    const grilla = await listarStockParaConteo(s.seccion.id, s.sucursalId, prisma);
    expect(grilla.some((f) => f.productoId === reventaId)).toBe(true);
    expect((await obtenerHistorialProducto(s.sucursalId, reventaId, undefined, undefined, undefined, prisma))?.tieneStockPropio).toBe(true);
    expect((await obtenerHistorialProducto(s.sucursalId, pvSinRecetaId, undefined, undefined, undefined, prisma))?.tieneStockPropio).toBe(false);
    const selector = await cargarSelectorCartaPos(s.sucursalId, prisma, new Date());
    const delSelector = selector.fueraDeCarta.find((p) => p.productoId === reventaId);
    expect(delSelector?.tieneStockReal).toBe(true);
    const deMilanesa = selector.fueraDeCarta.find((p) => p.productoId === s.milanesa.id);
    expect(deMilanesa?.tieneStockReal).toBe(false);
  });
});
