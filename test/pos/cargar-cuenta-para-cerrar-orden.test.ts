import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { sembrarSalon } from "./salon-fixture";
import { cargarCuentaParaCerrar } from "../../src/server/persistencia/pos/cargar-cuenta-para-cerrar";

/**
 * Hallazgo O.40 (3) del Hito 2: `cargarCuentaParaCerrar` leía los ítems de la cuenta SIN `orderBy`, y de ese orden depende el de las Operaciones que escribe el cierre (una por línea neta).
 * Ahora los ítems salen por hora de carga y, a igualdad, por id, sin importar el orden en que la base los entregue (acá se insertan DESORDENADOS respecto de su hora).
 */
describe("cargarCuentaParaCerrar: los ítems salen en el orden en que se cargaron", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
  });

  it("por hora de carga, aunque se hayan insertado en otro orden", async () => {
    const cuenta = await prisma.cuenta.create({ data: { mesaId: s.mesa.id, abiertaPorId: s.admin.id } });
    const horas = [
      { productoId: s.flan.id, cantidad: 3, creadoEn: new Date("2026-03-01T12:30:00Z") },
      { productoId: s.milanesa.id, cantidad: 1, creadoEn: new Date("2026-03-01T12:10:00Z") },
      { productoId: s.pizza.id, cantidad: 2, creadoEn: new Date("2026-03-01T12:20:00Z") },
    ];
    for (const h of horas) await prisma.cuentaItem.create({ data: { ...h, cuentaId: cuenta.id, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: s.admin.id } });

    const cargada = await prisma.$transaction((tx) => cargarCuentaParaCerrar(tx, { cuentaId: cuenta.id, sucursalId: s.sucursalId }));

    expect(cargada?.items.map((i) => i.productoId)).toEqual([s.milanesa.id, s.pizza.id, s.flan.id]);
  });
});
