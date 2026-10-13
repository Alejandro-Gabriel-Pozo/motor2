import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { elegida, sembrarCafeDelSalon, type CafeDelSalon } from "../setup/opciones";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems, enviarACocina } from "../../src/server/actions/pos/cuenta-pedido";
import { cerrarCuenta } from "../../src/server/actions/pos/cuenta-cierre";

/**
 * GO-2b (ADR-030), contra Postgres real: CERRAR una cuenta con líneas configuradas y adicionales. Fija: dos configuraciones son dos Operaciones y la misma dos veces
 * una de ×2 (con su adicional ×2 colgado); un café sin opciones y uno configurado AL MISMO PRECIO no se cruzan al enlazar (con el filtro de antes, sí: mutación
 * demostrada); el descuento de cliente no toca al adicional; el total del mensaje es la suma de lo registrado; y las carreras (dos cierres a la vez; dos cuentas que
 * consumen el mismo insumo fraccionado, con su arrastre de redondeo).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let c: CafeDelSalon;
let cuentaId: string;
const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  c = await sembrarCafeDelSalon(s);
  await entrarComo(s.admin);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});

async function pedirYEnviar(cuenta: string, items: Parameters<typeof agregarItems>[1]) {
  const r = await agregarItems(cuenta, items);
  expect(r.ok, r.mensaje).toBe(true);
  const sinEnviar = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta, numeroEnvio: null }, select: { id: true } });
  expect((await enviarACocina(cuenta, sinEnviar.map((i) => i.id))).ok).toBe(true);
}

async function ventasDe(cuenta: string) {
  const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  const opIds = [...new Set(items.map((i) => i.operacionId).filter((id): id is string => id !== null))];
  const ops = await prisma.operacion.findMany({ where: { id: { in: opIds } }, include: { movimientos: { where: { proceso: "VENTA" } } }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
  return { items, ops };
}

const grande = () => [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)];

describe("cerrar una cuenta con opciones (GO-2b)", () => {
  it("dos configuraciones son dos Operaciones; la misma dos veces, UNA de ×2 con su adicional ×2 colgado de ella", async () => {
    await pedirYEnviar(cuentaId, [
      { productoId: c.cafeId, cantidad: 1, opciones: grande() },
      { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.chicoId)] },
      { productoId: c.cafeId, cantidad: 1, opciones: grande() },
    ]);
    const r = await cerrarCuenta(cuentaId);
    expect(r.ok, r.mensaje).toBe(true);
    const { items, ops } = await ventasDe(cuentaId);
    const vendido = ops.map((o) => [o.movimientos[0]!.productoId, -Number(o.movimientos[0]!.cantidad), Number(o.movimientos[0]!.precioTotal), o.operacionPadreId === null ? null : ops.findIndex((p) => p.id === o.operacionPadreId)]);
    expect(vendido).toEqual([
      [c.cafeId, 2, 2500, null], // grande con almendras ×2
      [c.anclaDelShotId, 2, 400, 0], // sus dos shots, colgados del café
      [c.cafeId, 1, 950, null], // el chico
    ]);
    // Cada ítem quedó enlazado con la Operacion de SU línea.
    const opDe = (productoId: string, precio: number) => ops.find((o) => o.movimientos[0]!.productoId === productoId && Number(o.movimientos[0]!.precioTotal) === precio)!.id;
    expect(items.map((i) => i.operacionId)).toEqual(items.map((i) => (i.productoId === c.anclaDelShotId ? opDe(c.anclaDelShotId, 400) : Number(i.precioUnitario) === 1250 ? opDe(c.cafeId, 2500) : opDe(c.cafeId, 950))));
    // (sin stock cargado el cierre avisa el negativo después del total: B6bis)
    expect(r.mensaje.startsWith(`Cuenta de la mesa 4 cerrada: se registró la venta por ${MONEDA.format(3850)}.`), r.mensaje).toBe(true);
  });

  it("un café configurado y uno SIN opciones al mismo precio no se cruzan al enlazar (aunque el configurado se haya pedido primero)", async () => {
    // Sin el tamaño (obligatorio) el café se puede pedir sin opciones; «De vaca» no cambia el precio: los dos a 1000.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: c.cafeId, grupoId: c.grupoMedidaId }, data: { activo: false } });
    await pedirYEnviar(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.vacaId)] }]);
    await pedirYEnviar(cuentaId, [{ productoId: c.cafeId, cantidad: 1 }]);
    expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
    const { items, ops } = await ventasDe(cuentaId);
    expect(ops).toHaveLength(2);
    const configurado = items.find((i) => i.huellaOpciones !== null)!;
    const suelto = items.find((i) => i.huellaOpciones === null)!;
    expect(configurado.operacionId).not.toBe(suelto.operacionId);
    expect(new Set(items.map((i) => i.operacionId))).toEqual(new Set(ops.map((o) => o.id)));
  });

  it("el descuento de CLIENTE va al café (sobre su lista compuesta) y NO al adicional, que tampoco guarda precio de lista", async () => {
    const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
    await prisma.cuenta.update({ where: { id: cuentaId }, data: { clienteId: cliente.id, descuentoPorcentaje: 10 } });
    await pedirYEnviar(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: grande() }]);
    const r = await cerrarCuenta(cuentaId);
    expect(r.ok, r.mensaje).toBe(true);
    const ventas = await prisma.movimientoStock.findMany({ where: { proceso: "VENTA" }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    expect(ventas.map((v) => [v.productoId, Number(v.precioTotal), v.precioListaUnitario === null ? null : Number(v.precioListaUnitario)])).toEqual([
      [c.cafeId, 1125, 1250],
      [c.anclaDelShotId, 200, null],
    ]);
    expect(r.mensaje.startsWith(`Cuenta de la mesa 4 cerrada: se registró la venta por ${MONEDA.format(1325)} (con 10% de descuento a «Fulano»).`), r.mensaje).toBe(true);
  });

  it("el consumo de la línea sale de la foto (la versión que se vendió), aunque después se cargue una versión nueva de la opción", async () => {
    await pedirYEnviar(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.almendrasId)] }]);
    const v2 = await prisma.versionDeOpcion.create({ data: { opcionId: c.almendrasId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "150.00", creadoPorId: s.admin.id } });
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: v2.id, efecto: "REEMPLAZA", insumoProductoId: c.almendrasInsumoId, reemplazaAProductoId: c.lecheId, cantidad: "0.5000", unidadId: s.kg.id } });
    expect((await cerrarCuenta(cuentaId)).ok).toBe(true);
    const consumo = await prisma.movimientoStock.findFirstOrThrow({ where: { proceso: "CONSUMO", productoId: c.almendrasInsumoId } });
    expect(Number(consumo.cantidad)).toBe(-0.2);
  });
});

describe("cerrar con opciones: concurrencia (GO-2b)", () => {
  it("dos cierres a la vez: un solo juego de Operaciones (con su padre), de filas del Kardex y un ticket", async () => {
    await pedirYEnviar(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: grande() }]);
    const resultados = await Promise.all([cerrarCuenta(cuentaId), cerrarCuenta(cuentaId)]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.mensaje === "La cuenta de la mesa 4 ya estaba cerrada.")).toHaveLength(1);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(2);
    expect(await prisma.operacion.count({ where: { proceso: "VENTA", operacionPadreId: { not: null } } })).toBe(1);
    expect(await prisma.movimientoStock.count({ where: { proceso: "VENTA" } })).toBe(2);
    expect(await prisma.movimientoStock.count({ where: { proceso: "CONSUMO" } })).toBe(2);
    expect(await prisma.ejemplarTicket.count()).toBe(1);
  });

  it("dos cuentas que consumen el MISMO insumo fraccionado, cerradas a la vez: el arrastre de redondeo no se pierde ni se duplica", async () => {
    await prismaAdmin.consumoDeOpcion.updateMany({ where: { versionDeOpcionId: c.versionDe[c.shotId] }, data: { cantidad: "0.0050" } });
    const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    const otraCuenta = (await sembrarCuenta(mesa2.id, s.admin.id)).id;
    await pedirYEnviar(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.shotId)] }]);
    await pedirYEnviar(otraCuenta, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId), elegida(c, c.shotId)] }]);
    const resultados = await Promise.all([cerrarCuenta(cuentaId), cerrarCuenta(otraCuenta)]);
    expect(resultados.map((r) => r.ok), resultados.map((r) => r.mensaje).join(" / ")).toEqual([true, true]);
    const grano = await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO", productoId: c.granoId } });
    expect(grano.map((g) => Number(g.cantidadExacta))).toEqual([-0.005, -0.005]);
    expect(Math.round(grano.reduce((suma, g) => suma + Number(g.cantidad), 0) * 100) / 100).toBe(-0.01);
  });
});
