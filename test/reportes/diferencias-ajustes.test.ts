import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarConteoFisico } from "../../src/server/actions/movimientos/conteo-fisico";
import { generarReporteDiferenciasAjustes } from "../../src/core/reportes/diferencias-ajustes";

describe("generarReporteDiferenciasAjustes", () => {
  let sucursalId: string;
  let seccionId: string;
  let unidadKgId: string;
  let insumoId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("clasifica en grupo a/b según si la MP participa de alguna receta, con estado distinto", async () => {
    const mpSinReceta = await prisma.producto.create({ data: { codigo: "MP_SIN", nombre: "Sin receta", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    const mpConReceta = await prisma.producto.create({ data: { codigo: "MP_CON", nombre: "Con receta", tipo: "MP", unidadStockId: unidadKgId } });
    const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
    await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mpConReceta.id, cantidad: 1, unidadId: unidadKgId }] } } });

    // Stock previo: un Ajuste negativo valida que haya suficiente para restar.
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpSinReceta.id, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mpConReceta.id, cantidad: 10 }] });

    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mpSinReceta.id, cantidad: -2 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mpConReceta.id, cantidad: -2 }] });

    const filas = await generarReporteDiferenciasAjustes(sucursalId);
    expect(filas.find((f) => f.productoId === mpSinReceta.id)).toMatchObject({ grupo: "a", estado: "REVISAR" });
    expect(filas.find((f) => f.productoId === mpConReceta.id)).toMatchObject({ grupo: "b", estado: "ESPERADO" });
  });

  it("separa la suma de Ajustes manuales de la de Conteos físicos (CONTROL), sin mezclarlas", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });

    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
    await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: -1 }] });
    await registrarConteoFisico({ productoId: mp.id, seccionId, conteoReal: 6, fechaConteo: new Date(), accion: "AJUSTAR" }); // saldoSistema=9, diferencia=-3

    const filas = await generarReporteDiferenciasAjustes(sucursalId);
    const fila = filas.find((f) => f.productoId === mp.id)!;
    expect(fila.sumaAjustesManuales).toBe(-1);
    expect(fila.sumaConteosFisicos).toBe(-3);
  });

  it("sin ninguna diferencia real, una MP sin receta queda OK", async () => {
    const mp = await prisma.producto.create({ data: { codigo: "MP_1", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
    await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });

    const filas = await generarReporteDiferenciasAjustes(sucursalId);
    expect(filas.find((f) => f.productoId === mp.id)).toMatchObject({ grupo: "a", estado: "OK" });
  });

  describe("recetasQueLoUsan / sugerenciaMerma (hallazgo: 'Solo receta' quedaba en ESPERADO sin linkear a la receta ni sugerir nada)", () => {
    async function armarMpConReceta(mermaPorcentaje: number) {
      const mp = await prisma.producto.create({ data: { codigo: "MP_REC", nombre: "Levadura", tipo: "MP", unidadStockId: unidadKgId } });
      const pv = await prisma.producto.create({ data: { codigo: "PV_1", nombre: "Pan", tipo: "PV", unidadStockId: unidadKgId, precioVenta: 100 } });
      await prisma.recetaVersion.create({
        data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: unidadKgId, mermaPorcentaje }] } },
      });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      return { mp, pv };
    }

    it("lista la receta que usa el insumo, con su merma % vigente", async () => {
      const { mp, pv } = await armarMpConReceta(5);

      const filas = await generarReporteDiferenciasAjustes(sucursalId);
      const fila = filas.find((f) => f.productoId === mp.id)!;
      expect(fila.recetasQueLoUsan).toEqual([{ productoVentaId: pv.id, productoVentaNombre: "Pan", mermaPorcentajeActual: 5 }]);
    });

    it("un neto de Ajustes+Conteos negativo sugiere aumentar la merma", async () => {
      const { mp } = await armarMpConReceta(5);
      await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: -2 }] });

      const filas = await generarReporteDiferenciasAjustes(sucursalId);
      expect(filas.find((f) => f.productoId === mp.id)?.sugerenciaMerma).toBe("aumentar");
    });

    it("un neto de Ajustes+Conteos positivo sugiere disminuir la merma", async () => {
      const { mp } = await armarMpConReceta(5);
      await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 2 }] });

      const filas = await generarReporteDiferenciasAjustes(sucursalId);
      expect(filas.find((f) => f.productoId === mp.id)?.sugerenciaMerma).toBe("disminuir");
    });

    it("sin ningún Ajuste/Conteo, no hay sugerencia (nada para recalibrar)", async () => {
      const { mp } = await armarMpConReceta(5);

      const filas = await generarReporteDiferenciasAjustes(sucursalId);
      expect(filas.find((f) => f.productoId === mp.id)?.sugerenciaMerma).toBeNull();
    });

    it("una MP sin receta (grupo a) nunca trae recetasQueLoUsan ni sugerenciaMerma", async () => {
      const mp = await prisma.producto.create({ data: { codigo: "MP_SIN", nombre: "Sal", tipo: "MP", unidadStockId: unidadKgId, insumoId } });
      await registrarMovimiento({ proceso: "COMPRA", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: 10 }] });
      await registrarMovimiento({ proceso: "AJUSTE", fecha: new Date(), seccionId, items: [{ productoId: mp.id, cantidad: -2 }] });

      const filas = await generarReporteDiferenciasAjustes(sucursalId);
      const fila = filas.find((f) => f.productoId === mp.id)!;
      expect(fila.recetasQueLoUsan).toEqual([]);
      expect(fila.sugerenciaMerma).toBeNull();
    });
  });
});
