import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cargarCuentaParaCerrar, cargarOperacionDelConsumo, cargarUltimoNumeroDeBoleta } from "../../src/server/persistencia/pos/cargar-cuenta-para-cerrar";
import { enlazarItemsConOperaciones, escribirEjemplarOriginalDeBoleta, marcarCuentaCerrada } from "../../src/server/persistencia/pos/cerrar-cuenta";

/**
 * `src/server/persistencia/pos/` (Task #41, Fase M12a) contra Postgres real. Cada función recibe el `tx` de quien la llama: acá se la
 * llama dentro de un `prisma.$transaction` propio del test, como lo hace el caso de uso con `conTransaccionSerializable`.
 */
describe("persistencia del cierre de cuenta", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  describe("cargarCuentaParaCerrar", () => {
    it("devuelve tipos de dominio: Decimal ya convertido a number, mesa, cliente y snapshot del descuento", async () => {
      const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 50 } });
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
        { productoId: s.flan.id, cantidad: 1.5, precioUnitario: 3000.5, numeroEnvio: 1 },
        { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000 },
      ]);
      await prisma.cuenta.update({ where: { id: cuenta.id }, data: { clienteId: cliente.id, descuentoPorcentaje: 12.5 } });

      const c = await prisma.$transaction((tx) => cargarCuentaParaCerrar(tx, { cuentaId: cuenta.id, sucursalId: s.sucursalId }));

      expect(c).toEqual({
        id: cuenta.id,
        mesaNumero: 4,
        cerradaEn: null,
        clienteId: cliente.id,
        clienteNombre: "Fulano",
        descuentoPorcentaje: 12.5,
        items: expect.arrayContaining([
          { productoId: s.flan.id, cantidad: 1.5, precioUnitario: 3000.5, promoCuentaId: null, numeroEnvio: 1 },
          { productoId: s.milanesa.id, cantidad: 1, precioUnitario: 9000, promoCuentaId: null, numeroEnvio: null },
        ]),
      });
      expect(c!.items).toHaveLength(2);
    });

    it("sin cliente: clienteNombre y descuentoPorcentaje null", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
      const c = await prisma.$transaction((tx) => cargarCuentaParaCerrar(tx, { cuentaId: cuenta.id, sucursalId: s.sucursalId }));
      expect(c).toMatchObject({ clienteId: null, clienteNombre: null, descuentoPorcentaje: null, items: [] });
    });

    it("null si el id no existe o la mesa es de OTRA sucursal", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
      expect(await prisma.$transaction((tx) => cargarCuentaParaCerrar(tx, { cuentaId: "no-existe", sucursalId: s.sucursalId }))).toBeNull();
      expect(await prisma.$transaction((tx) => cargarCuentaParaCerrar(tx, { cuentaId: cuenta.id, sucursalId: norte.id }))).toBeNull();
    });
  });

  it("cargarUltimoNumeroDeBoleta: null sin boletas; el máximo de ESTA sucursal (no el de otra)", async () => {
    expect(await prisma.$transaction((tx) => cargarUltimoNumeroDeBoleta(tx, s.sucursalId))).toBeNull();

    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const mesaNorte = await prisma.mesa.create({ data: { sucursalId: norte.id, numero: 1 } });
    const cuentaNorte = await sembrarCuenta(mesaNorte.id, s.admin.id);
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    await prisma.$transaction(async (tx) => {
      await escribirEjemplarOriginalDeBoleta(tx, { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: 7, emitidoEn: new Date(), emitidoPorId: s.admin.id });
      await escribirEjemplarOriginalDeBoleta(tx, { sucursalId: norte.id, cuentaId: cuentaNorte.id, numero: 99, emitidoEn: new Date(), emitidoPorId: s.admin.id });
    });

    expect(await prisma.$transaction((tx) => cargarUltimoNumeroDeBoleta(tx, s.sucursalId))).toBe(7);
  });

  it("escribirEjemplarOriginalDeBoleta: el ejemplar A (1), sin corrección ni motivo", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const emitidoEn = new Date("2026-09-27T20:00:00.000Z");
    await prisma.$transaction((tx) => escribirEjemplarOriginalDeBoleta(tx, { sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: 3, emitidoEn, emitidoPorId: s.admin.id }));
    expect(await prisma.ejemplarBoleta.findMany()).toEqual([
      expect.objectContaining({ sucursalId: s.sucursalId, cuentaId: cuenta.id, numero: 3, ejemplar: 1, emitidoEn, emitidoPorId: s.admin.id, corrigeAId: null, motivo: null }),
    ]);
  });

  it("enlazarItemsConOperaciones: enlaza por (producto, precio de lista) y solo los ítems de ESA cuenta", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: 1, precioUnitario: 3500, numeroEnvio: 1 },
      { productoId: s.flan.id, cantidad: -1, precioUnitario: 3000, numeroEnvio: 1 },
    ]);
    const mesa5 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
    const otra = await sembrarCuenta(mesa5.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
    const [op1, op2] = await Promise.all([1, 2].map(() => prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } })));

    await prisma.$transaction((tx) =>
      enlazarItemsConOperaciones(tx, cuenta.id, [
        { productoId: s.flan.id, precioUnitario: 3000, operacionId: op1.id },
        { productoId: s.flan.id, precioUnitario: 3500, promoCuentaId: null, operacionId: op2.id },
      ])
    );

    const items = await prisma.cuentaItem.findMany({ where: { cuentaId: cuenta.id } });
    expect(items.filter((i) => Number(i.precioUnitario) === 3000).map((i) => i.operacionId)).toEqual([op1.id, op1.id]);
    expect(items.filter((i) => Number(i.precioUnitario) === 3500).map((i) => i.operacionId)).toEqual([op2.id]);
    expect((await prisma.cuentaItem.findFirstOrThrow({ where: { cuentaId: otra.id } })).operacionId).toBeNull();
  });

  it("marcarCuentaCerrada: cerradaEn y cerradaPorId", async () => {
    const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const cerradaEn = new Date("2026-09-27T21:00:00.000Z");
    await prisma.$transaction((tx) => marcarCuentaCerrada(tx, { cuentaId: cuenta.id, cerradaEn, cerradaPorId: s.admin.id }));
    expect(await prisma.cuenta.findUniqueOrThrow({ where: { id: cuenta.id } })).toMatchObject({ cerradaEn, cerradaPorId: s.admin.id });
  });

  it("cargarOperacionDelConsumo: la Operacion con el CONSUMO de ese insumo en esa sección; null si no hay", async () => {
    const [venta1, venta2] = await Promise.all([1, 2].map(() => prisma.operacion.create({ data: { sucursalId: s.sucursalId, proceso: "VENTA", fecha: new Date(), usuarioId: s.admin.id } })));
    await prisma.movimientoStock.create({
      data: { operacionId: venta2.id, productoId: s.muzzarella.id, seccionId: s.seccion.id, proceso: "CONSUMO", cantidad: -0.5, detalle: "Consumo", precioTotal: 0, precioPorUnidadStock: 0 },
    });
    const buscar = (productoId: string) =>
      prisma.$transaction((tx) => cargarOperacionDelConsumo(tx, { operacionIds: [venta1.id, venta2.id], productoId, seccionId: s.seccion.id }));
    expect(await buscar(s.muzzarella.id)).toBe(venta2.id);
    expect(await buscar(s.flan.id)).toBeNull();
  });
});
