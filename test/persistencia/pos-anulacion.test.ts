import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cargarItemParaAnular } from "../../src/server/persistencia/pos/cargar-item-para-anular";
import { escribirEspejoDeItem } from "../../src/server/persistencia/pos/escribir-espejo-de-item";

/**
 * `src/server/persistencia/pos/` — anulación de un ítem ya enviado (Task #41, Fase M12c) contra Postgres real. Cada función recibe el
 * `tx` de quien la llama: acá se la llama dentro de un `prisma.$transaction` propio del test, como lo hace el caso de uso con
 * `conTransaccionSerializable`.
 */
describe("persistencia de la anulación de un ítem enviado", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  describe("cargarItemParaAnular", () => {
    it("devuelve tipos de dominio: Decimal ya convertido a number, mesa, estado de la cuenta, producto, anulaciones y promo", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.muzzarella.id, cantidad: 1.5, precioUnitario: 3000.5, numeroEnvio: 3 }]);
      const [item] = cuenta.items;
      await prisma.producto.update({ where: { id: s.muzzarella.id }, data: { pasoVenta: 0.25 } });
      await prisma.cuentaItem.create({
        data: { cuentaId: cuenta.id, productoId: s.muzzarella.id, cantidad: -0.5, precioUnitario: 3000.5, numeroEnvio: 3, anulaAItemId: item.id, motivoAnulacion: "x", creadoPorId: s.admin.id },
      });

      const c = await prisma.$transaction((tx) => cargarItemParaAnular(tx, { cuentaItemId: item.id, sucursalId: s.sucursalId }));

      expect(c).toEqual({
        id: item.id,
        cuentaId: cuenta.id,
        productoId: s.muzzarella.id,
        cantidad: 1.5,
        precioUnitario: 3000.5,
        precioCartaUnitario: null,
        numeroEnvio: 3,
        anulaAItemId: null,
        mesaNumero: 4,
        cuentaCerradaEn: null,
        producto: { nombre: "Muzzarella", tipo: "MP", seProduce: false, pasoVenta: 0.25, decimales: 2 },
        anulaciones: [{ cantidad: -0.5 }],
        promoCuenta: null,
      });
    });

    it("null si el id no existe o la mesa es de OTRA sucursal", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.flan.id, cantidad: 1, precioUnitario: 3000, numeroEnvio: 1 }]);
      expect(await prisma.$transaction((tx) => cargarItemParaAnular(tx, { cuentaItemId: "no-existe", sucursalId: s.sucursalId }))).toBeNull();
      expect(await prisma.$transaction((tx) => cargarItemParaAnular(tx, { cuentaItemId: cuenta.items[0].id, sucursalId: norte.id }))).toBeNull();
    });
  });

  describe("escribirEspejoDeItem", () => {
    it("escribe la fila espejo con la cantidad en NEGATIVO y no toca el original", async () => {
      const cuenta = await sembrarCuenta(s.mesa.id, s.admin.id, [{ productoId: s.milanesa.id, cantidad: 3, precioUnitario: 9000.25, numeroEnvio: 2 }]);
      const [item] = cuenta.items;

      const espejoId = await prisma.$transaction((tx) =>
        escribirEspejoDeItem(tx, {
          original: { id: item.id, cuentaId: cuenta.id, productoId: s.milanesa.id, precioUnitario: 9000.25, precioCartaUnitario: null, numeroEnvio: 2 },
          cantidadAnulada: 2,
          motivo: "Salió frío",
          creadoPorId: s.admin.id,
        })
      );

      const espejo = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: espejoId } });
      expect({ ...espejo, cantidad: Number(espejo.cantidad), precioUnitario: Number(espejo.precioUnitario) }).toMatchObject({
        cuentaId: cuenta.id,
        productoId: s.milanesa.id,
        cantidad: -2,
        precioUnitario: 9000.25,
        numeroEnvio: 2,
        anulaAItemId: item.id,
        motivoAnulacion: "Salió frío",
        creadoPorId: s.admin.id,
        promoCuentaId: null,
        operacionId: null,
      });
      const original = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: item.id } });
      expect([Number(original.cantidad), original.anulaAItemId, original.motivoAnulacion]).toEqual([3, null, null]);
    });
  });
});
