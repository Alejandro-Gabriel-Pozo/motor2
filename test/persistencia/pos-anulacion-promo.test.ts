import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarCuenta, sembrarSalon } from "../pos/salon-fixture";
import { cargarPromoParaAnular } from "../../src/server/persistencia/pos/cargar-promo-para-anular";
import { escribirEspejoDeItem } from "../../src/server/persistencia/pos/escribir-espejo-de-item";

/**
 * `src/server/persistencia/pos/` — anulación de una promo ya enviada (Task #41, Fase M12d) contra Postgres real. Cada función recibe el
 * `tx` de quien la llama: acá se la llama dentro de un `prisma.$transaction` propio del test, como lo hace el caso de uso con
 * `conTransaccionSerializable`. El `escribirEspejoDeItem` SIN promo lo cubre test/persistencia/pos-anulacion.test.ts (M12c).
 */
describe("persistencia de la anulación de una promo enviada", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cuenta: Awaited<ReturnType<typeof sembrarCuenta>>;
  let promoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cuenta = await sembrarCuenta(s.mesa.id, s.admin.id);
    const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Menús M12d" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursalId: s.sucursalId, seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 12000 } });
    promoId = (await prisma.promoCuenta.create({ data: { cuentaId: cuenta.id, promoCartaId: promoCarta.id, precio: 12000, titulo: "Menú del día", creadoPorId: s.admin.id } })).id;
  });

  describe("cargarPromoParaAnular", () => {
    it("devuelve tipos de dominio: Decimal ya convertido a number, mesa, estado de la cuenta y TODOS los ítems (originales y espejos)", async () => {
      const mila = await prisma.cuentaItem.create({
        data: { cuentaId: cuenta.id, productoId: s.milanesa.id, cantidad: 1.5, precioUnitario: 8000.5, precioCartaUnitario: 9000.25, numeroEnvio: 2, promoCuentaId: promoId, creadoPorId: s.admin.id },
      });
      const espejo = await prisma.cuentaItem.create({
        data: { cuentaId: cuenta.id, productoId: s.milanesa.id, cantidad: -0.5, precioUnitario: 8000.5, numeroEnvio: 2, anulaAItemId: mila.id, motivoAnulacion: "x", promoCuentaId: promoId, creadoPorId: s.admin.id },
      });

      const p = await prisma.$transaction((tx) => cargarPromoParaAnular(tx, { promoCuentaId: promoId, sucursalId: s.sucursalId }));

      expect(p).toMatchObject({ id: promoId, titulo: "Menú del día", mesaNumero: 4, cuentaCerradaEn: null });
      expect([...p!.items].sort((a, b) => b.cantidad - a.cantidad)).toEqual([
        {
          id: mila.id,
          cuentaId: cuenta.id,
          productoId: s.milanesa.id,
          cantidad: 1.5,
          precioUnitario: 8000.5,
          precioCartaUnitario: 9000.25,
          numeroEnvio: 2,
          anulaAItemId: null,
          producto: { nombre: "Milanesa" },
          anulaciones: [{ cantidad: -0.5 }],
        },
        {
          id: espejo.id,
          cuentaId: cuenta.id,
          productoId: s.milanesa.id,
          cantidad: -0.5,
          precioUnitario: 8000.5,
          precioCartaUnitario: null,
          numeroEnvio: 2,
          anulaAItemId: mila.id,
          producto: { nombre: "Milanesa" },
          anulaciones: [],
        },
      ]);
    });

    it("null si el id no existe o la mesa es de OTRA sucursal", async () => {
      const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
      expect(await prisma.$transaction((tx) => cargarPromoParaAnular(tx, { promoCuentaId: "no-existe", sucursalId: s.sucursalId }))).toBeNull();
      expect(await prisma.$transaction((tx) => cargarPromoParaAnular(tx, { promoCuentaId: promoId, sucursalId: norte.id }))).toBeNull();
    });
  });

  describe("escribirEspejoDeItem con `promo`", () => {
    it("la fila espejo lleva el MISMO promoCuentaId y precioCartaUnitario que el componente, y no toca el original", async () => {
      const flan = await prisma.cuentaItem.create({
        data: { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: 2, precioUnitario: 2000, precioCartaUnitario: 2500.75, numeroEnvio: 3, promoCuentaId: promoId, creadoPorId: s.admin.id },
      });

      const espejoId = await prisma.$transaction((tx) =>
        escribirEspejoDeItem(tx, {
          original: { id: flan.id, cuentaId: cuenta.id, productoId: s.flan.id, precioUnitario: 2000, numeroEnvio: 3 },
          cantidadAnulada: 2,
          motivo: "Se cayó la mesa",
          creadoPorId: s.admin.id,
          promo: { promoCuentaId: promoId, precioCartaUnitario: 2500.75 },
        })
      );

      const espejo = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: espejoId } });
      expect({ ...espejo, cantidad: Number(espejo.cantidad), precioUnitario: Number(espejo.precioUnitario), precioCartaUnitario: Number(espejo.precioCartaUnitario) }).toMatchObject({
        cuentaId: cuenta.id,
        productoId: s.flan.id,
        cantidad: -2,
        precioUnitario: 2000,
        precioCartaUnitario: 2500.75,
        numeroEnvio: 3,
        anulaAItemId: flan.id,
        motivoAnulacion: "Se cayó la mesa",
        creadoPorId: s.admin.id,
        promoCuentaId: promoId,
      });
      const original = await prisma.cuentaItem.findUniqueOrThrow({ where: { id: flan.id } });
      expect([Number(original.cantidad), original.anulaAItemId, original.motivoAnulacion]).toEqual([2, null, null]);
    });

    it("un componente sin precio de carta: el espejo queda con precioCartaUnitario null", async () => {
      const flan = await prisma.cuentaItem.create({
        data: { cuentaId: cuenta.id, productoId: s.flan.id, cantidad: 1, precioUnitario: 2000, numeroEnvio: 1, promoCuentaId: promoId, creadoPorId: s.admin.id },
      });
      const espejoId = await prisma.$transaction((tx) =>
        escribirEspejoDeItem(tx, {
          original: { id: flan.id, cuentaId: cuenta.id, productoId: s.flan.id, precioUnitario: 2000, numeroEnvio: 1 },
          cantidadAnulada: 1,
          motivo: "x",
          creadoPorId: s.admin.id,
          promo: { promoCuentaId: promoId, precioCartaUnitario: null },
        })
      );
      expect(await prisma.cuentaItem.findUniqueOrThrow({ where: { id: espejoId } })).toMatchObject({ promoCuentaId: promoId, precioCartaUnitario: null });
    });
  });
});
