import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos";
import { reclasificarStock } from "../../src/server/actions/reclasificacion";
import { calcularSaldoPorLote, calcularSaldoTotal } from "../../src/core/movimientos/stock";

describe("reclasificarStock", () => {
  let sucursalId: string;
  let origenId: string;
  let destinoAId: string;
  let destinoBId: string;
  let unidadKgId: string;
  let insumoId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    origenId = (await sembrarSeccion(sucursalId, "Origen")).id;
    destinoAId = (await sembrarSeccion(sucursalId, "Destino A")).id;
    destinoBId = (await sembrarSeccion(sucursalId, "Destino B")).id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Arroz", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    mpId = mp.id;
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 10 }] });
  });

  it("reparte EXACTO el disponible entre 2 destinos, el origen queda en 0 y el total global no cambia", async () => {
    const resultado = await reclasificarStock({
      productoId: mpId,
      seccionOrigenId: origenId,
      destinos: [
        { seccionId: destinoAId, cantidad: 6 },
        { seccionId: destinoBId, cantidad: 4 },
      ],
      fecha: new Date(),
    });
    expect(resultado.ok).toBe(true);

    expect(await calcularSaldoTotal(mpId, origenId)).toBe(0);
    expect(await calcularSaldoTotal(mpId, destinoAId)).toBe(6);
    expect(await calcularSaldoTotal(mpId, destinoBId)).toBe(4);
  });

  it("rechaza si la suma de los destinos no coincide exacto con el disponible (ni de más ni de menos)", async () => {
    const deMenos = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 5 }], fecha: new Date(),
    });
    expect(deMenos.ok).toBe(false);

    const deMas = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, destinos: [{ seccionId: destinoAId, cantidad: 15 }], fecha: new Date(),
    });
    expect(deMas.ok).toBe(false);

    // Nada se escribió: el saldo del origen sigue intacto.
    expect(await calcularSaldoTotal(mpId, origenId)).toBe(10);
  });

  it("rechaza si no hay saldo disponible en el origen", async () => {
    const resultado = await reclasificarStock({
      productoId: mpId, seccionOrigenId: destinoAId, destinos: [{ seccionId: destinoBId, cantidad: 1 }], fecha: new Date(),
    });
    expect(resultado.ok).toBe(false);
  });

  it("reclasifica por lote puntual sin tocar otros lotes del mismo producto+sección", async () => {
    const lote1 = new Date("2027-01-01");
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId: origenId, items: [{ productoId: mpId, cantidad: 5, loteVencimiento: lote1 }] });

    const resultado = await reclasificarStock({
      productoId: mpId, seccionOrigenId: origenId, loteOrigen: lote1,
      destinos: [{ seccionId: destinoAId, cantidad: 5 }], fecha: new Date(),
    });
    expect(resultado.ok).toBe(true);

    expect(await calcularSaldoPorLote(mpId, origenId, lote1)).toBe(0);
    expect(await calcularSaldoPorLote(mpId, origenId, null)).toBe(10); // el lote "sin fecha" original, intacto
    expect(await calcularSaldoTotal(mpId, destinoAId)).toBe(5);
  });
});
