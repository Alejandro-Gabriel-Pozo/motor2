import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { EMPRESA_POR_DEFECTO_ID, baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, sembrarEscenarioDeOpciones, type CafeDelSalon, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";
import { cargarGrupoDelPanel, cargarOpcionesDelProducto } from "../../src/server/consultas/catalogo/opciones-de-venta";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { anularVenta } from "../../src/server/actions/movimientos/venta";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";
import { comprobanteDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * E4-3b de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7, regla R7 CONFIRMADA el 2026-11-17): una REVENTA (tipo PV, clase REVENTA, no se produce) SÍ la puede CONSUMIR una opción de venta, como una MP.
 * Contra Postgres real: (1) cargar el consumo de una opción que nombra una Reventa se acepta (y el selector de la pestaña Opciones la ofrece); un PV común, un producto inexistente y de otra empresa se siguen rechazando;
 * (2) vender por el POS un café con una opción que SUMA o REEMPLAZA con una Reventa descuenta el stock propio de la Reventa, una sola vez por cierre, y la anulación lo devuelve con un movimiento nuevo.
 * La venta con opciones de la propia Reventa (ella como base) sigue sin poder: `venta-de-reventa.test.ts`.
 *
 * Mutaciones: volver `insumosDeLosConsumos` (`opciones-de-venta-en-tx.ts`) a `p.tipo !== "MP"` pone en rojo guardar; volver `revisarMateriaPrima` (`linea-de-venta.ts`) a `tipo !== "MP"` pone en rojo las ventas;
 * volver `whereLoConsumeUnaOpcion` a `{ tipo: "MP" }` pone en rojo los selectores.
 */
describe("GUARDAR el consumo de una opción con una Reventa", () => {
  let e: EscenarioDeOpciones;
  let reventaId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const SUMA = (insumoProductoId: string, cantidad: number) => ({ efecto: "SUMA" as const, insumoProductoId, reemplazaAProductoId: null, cantidad, mermaPorcentaje: 0, escalaConLaMedida: false });
  const pedido = async (opcionId: string, consumos: Parameters<typeof agregarVersionDeOpcionCasoDeUso>[1]["version"]["consumos"]) => {
    const datos = await cargarOpcionesDelProducto(baseDeTest.db, e.cafeId, e.sucursalA);
    const vigente = datos!.admitidos.flatMap((g) => g.opciones).find((o) => o.opcionId === opcionId)!.vigente!;
    return { opcionId, numeroEsperado: vigente.numero, version: { diferencia: vigente.diferencia, factorEscala: vigente.factorEscala, consumos } };
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    reventaId = (await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo: "PV_GALLETITA_R", nombre: "Galletita", tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precioVenta: 500, alicuotaIvaVenta: "IVA_21", unidadStockId: e.unidadId } })).id;
  });

  it("una opción que SUMA una Reventa se guarda (con su unidad de stock); la que REEMPLAZA una MP por una Reventa también", async () => {
    const suma = await agregarVersionDeOpcionCasoDeUso(actor(), await pedido(e.vacaId, [SUMA(reventaId, 1)]));
    expect(suma).toMatchObject({ ok: true, datos: { numero: 2 } });
    const reemplaza = await agregarVersionDeOpcionCasoDeUso(actor(), await pedido(e.almendrasId, [{ ...SUMA(reventaId, 1), efecto: "REEMPLAZA" as const, reemplazaAProductoId: e.lecheId }]));
    expect(reemplaza).toMatchObject({ ok: true, datos: { numero: 2 } });
    const consumo = await prisma.consumoDeOpcion.findFirstOrThrow({ where: { insumoProductoId: reventaId, efecto: "SUMA" } });
    expect(consumo.unidadId).toBe(e.unidadId);
  });

  it("lo que se rechazaba se sigue rechazando: un PV común, un producto inexistente, y un PV común como producto REEMPLAZADO", async () => {
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "100.00" } });
    for (const id of [pan.id, randomUUID()]) {
      const r = await agregarVersionDeOpcionCasoDeUso(actor(), await pedido(e.vacaId, [SUMA(id, 1)]));
      expect(r.ok, id).toBe(false);
    }
    const reemplazaPan = await agregarVersionDeOpcionCasoDeUso(actor(), await pedido(e.almendrasId, [{ ...SUMA(e.lecheId, 1), efecto: "REEMPLAZA" as const, reemplazaAProductoId: pan.id }]));
    expect(reemplazaPan.ok).toBe(false);
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.vacaId } })).toBe(1);
  });

  it("las listas del editor de opciones (la pestaña del producto y la biblioteca) la ofrecen junto con las MP, y no ofrecen un PV común", async () => {
    const pan = await prisma.producto.create({ data: { codigo: "PV_PAN2", nombre: "Pan", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "100.00" } });
    const delProducto = (await cargarOpcionesDelProducto(baseDeTest.db, e.cafeId, e.sucursalA))!.insumos.map((i) => i.id);
    expect(delProducto).toEqual(expect.arrayContaining([reventaId, e.lecheId]));
    expect(delProducto).not.toContain(pan.id);
    const panel = await cargarGrupoDelPanel(baseDeTest.db, e.grupoVarianteId, e.sucursalA, false);
    const delPanel = panel!.insumos.map((i) => i.id);
    expect(delPanel).toEqual(expect.arrayContaining([reventaId, e.lecheId]));
    expect(delPanel).not.toContain(pan.id);
  });
});

describe("VENTA por el POS con una opción que consume una Reventa", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let c: CafeDelSalon;
  let reventaId: string;
  const saldo = (productoId: string) => calcularSaldoTotal(productoId, s.seccion.id, prisma);
  const compra = async (productoId: string, cantidad: number) =>
    registrarMovimiento({ proceso: "COMPRA", ...(await comprobanteDePrueba()), fecha: new Date(), seccionId: s.seccion.id, items: [{ productoId, cantidad, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID() });

  async function cobrar(items: Parameters<typeof agregarItems>[1], numero: number) {
    const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero } });
    const cuentaId = (await sembrarCuenta(mesa.id, s.admin.id)).id;
    const agregado = await agregarItems(cuentaId, items);
    expect(agregado.ok, JSON.stringify(agregado)).toBe(true);
    const sinEnviar = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect((await enviarACocina(cuentaId, sinEnviar.map((i) => i.id))).ok).toBe(true);
    return cerrarCuenta(cuentaId);
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    await entrarComo(s.admin);
    c = await sembrarCafeDelSalon(s);
    // La Reventa que consume la opción, en kg (la unidad de las opciones del café), con su disponibilidad.
    reventaId = (await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_POR_DEFECTO_ID, codigo: "PV_GALLETITA_R", nombre: "Galletita", tipo: "PV", seProduce: false, claseDeUso: "REVENTA", precioVenta: 500, alicuotaIvaVenta: "IVA_21", unidadStockId: s.kg.id } })).id;
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: reventaId, disponible: true } });
    await compra(c.lecheId, 10);
    await compra(reventaId, 10);
  });

  it("una opción que SUMA una Reventa (el tamaño «Chico») descuenta su stock propio al cobrar, y la anulación lo devuelve con un movimiento nuevo", async () => {
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: c.versionDe[c.chicoId]!, efecto: "SUMA", insumoProductoId: reventaId, cantidad: "0.1000", unidadId: s.kg.id } });
    const cierre = await cobrar([{ productoId: c.cafeId, cantidad: 2, opciones: [elegida(c, c.chicoId)] }], 10);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await saldo(reventaId)).toBeCloseTo(10 - 2 * 0.1, 6);
    const consumos = await prisma.movimientoStock.findMany({ where: { productoId: reventaId, proceso: "CONSUMO" } });
    expect(consumos.map((m) => Number(m.cantidad))).toEqual([-0.2]);
    const operacion = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", movimientos: { some: { productoId: reventaId } } } });
    expect((await anularVenta(operacion.id, "Se arrepintió")).ok).toBe(true);
    expect(await saldo(reventaId)).toBeCloseTo(10, 6);
    expect((await prisma.movimientoStock.findMany({ where: { productoId: reventaId } })).map((m) => Number(m.cantidad)).sort((a, b) => a - b)).toEqual([-0.2, 0.2, 10]);
  });

  it("una opción que REEMPLAZA la leche por una Reventa descuenta la Reventa y no la leche", async () => {
    await prisma.consumoDeOpcion.updateMany({ where: { versionDeOpcionId: c.versionDe[c.almendrasId]! }, data: { insumoProductoId: reventaId } });
    const cierre = await cobrar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }], 11);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await saldo(reventaId)).toBeCloseTo(10 - 0.2, 6);
    expect(await saldo(c.lecheId)).toBe(10); // la leche de la receta base la reemplazó la Reventa
  });

  it("IDEMPOTENCIA y CONCURRENCIA: cerrar dos veces la misma cuenta cobra una vez; dos cuentas a la vez descuentan las dos", async () => {
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: c.versionDe[c.chicoId]!, efecto: "SUMA", insumoProductoId: reventaId, cantidad: "0.1000", unidadId: s.kg.id } });
    const preparar = async (numero: number) => {
      const mesa = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero } });
      const cuentaId = (await sembrarCuenta(mesa.id, s.admin.id)).id;
      expect((await agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] }])).ok).toBe(true);
      const items = await prisma.cuentaItem.findMany({ where: { cuentaId } });
      expect((await enviarACocina(cuentaId, items.map((i) => i.id))).ok).toBe(true);
      return cuentaId;
    };
    const [a, b] = [await preparar(20), await preparar(21)];
    const rs = await Promise.all([cerrarCuenta(a), cerrarCuenta(b)]);
    expect(rs.every((r) => r.ok), JSON.stringify(rs)).toBe(true);
    expect(await saldo(reventaId)).toBeCloseTo(10 - 0.2, 6);
    await cerrarCuenta(a); // la cuenta ya cerrada no vuelve a descontar
    expect(await saldo(reventaId)).toBeCloseTo(10 - 0.2, 6);
    expect(await prisma.movimientoStock.count({ where: { productoId: reventaId, proceso: "CONSUMO" } })).toBe(2);
  });

  it("AISLAMIENTO: una Reventa no disponible en la sucursal que vende hace que la opción no se cobre y no toca el stock", async () => {
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: c.versionDe[c.chicoId]!, efecto: "SUMA", insumoProductoId: reventaId, cantidad: "0.1000", unidadId: s.kg.id } });
    await prisma.disponibilidadProducto.updateMany({ where: { productoId: reventaId }, data: { disponible: false } });
    const cierre = await cobrar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] }], 12);
    expect(cierre.ok).toBe(false);
    expect(await saldo(reventaId)).toBe(10);
  });

  it("lo que no cambia: el café con una opción de MP (Almendras) descuenta la MP, como siempre", async () => {
    await compra(c.almendrasInsumoId, 10);
    const cierre = await cobrar([{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }], 13);
    expect(cierre.ok, JSON.stringify(cierre)).toBe(true);
    expect(await saldo(c.almendrasInsumoId)).toBeCloseTo(10 - 0.2, 6);
  });
});
