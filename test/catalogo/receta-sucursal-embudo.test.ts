import { beforeEach, describe, expect, it } from "vitest";
import { ALCANCE_CENTRAL, alcanceDeSucursal, incluirRecetaVigente, whereConReceta } from "../../src/core/catalogo/public";
import { cargarHistorialDeVersiones, cargarRecetasPropiasHabilitadas, cargarRecetasVigentes, cargarRecetaVigente, versionVigentePorProducto } from "../../src/server/lecturas/catalogo/recetas-vigentes";
import { dependenciasParaDesactivar } from "../../src/server/lecturas/catalogo/dependencias-para-desactivar";
import { compararRendimientosPorSucursal } from "../../src/server/consultas/reportes/rendimiento-por-sucursal";
import { limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { dbDeEmpresa } from "../../src/core/auth/base";

/**
 * ADR-009 (familia override), R3: el embudo de recetas con ALCANCE. La receta de una sucursal es la propia si la tiene habilitada
 * (`RecetaSucursal.habilitada`) y con versiones; si no, la central (`sucursalId` NULL). Contra Postgres real, sin acciones de por medio.
 */
describe("recetas con alcance: la receta efectiva de una sucursal (ADR-009, override)", () => {
  let centralId: string;
  let norteId: string;
  let surId: string;
  let kgId: string;
  let pizza: { id: string };
  let empanada: { id: string };
  let harina: { id: string };
  let queso: { id: string };

  async function version(productoId: string, v: number, sucursalId: string | null, insumoId: string, cantidad: number) {
    return prisma.recetaVersion.create({
      data: { productoId, version: v, sucursalId, ingredientes: { create: [{ insumoProductoId: insumoId, cantidad, mermaPorcentaje: 0, unidadId: kgId }] } },
      include: { ingredientes: true },
    });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    surId = (await prisma.sucursal.create({ data: { nombre: "Sur" } })).id;
    const { kg } = await sembrarCatalogoBase();
    kgId = kg.id;
    harina = await sembrarProductoDisponible({ codigo: "MP_H", nombre: "Harina", tipo: "MP", unidadStockId: kgId }, centralId);
    queso = await sembrarProductoDisponible({ codigo: "MP_Q", nombre: "Queso", tipo: "MP", unidadStockId: kgId }, centralId);
    pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: kgId, precioVenta: 100 }, centralId);
    empanada = await sembrarProductoDisponible({ codigo: "PV_EMP", nombre: "Empanada", tipo: "PV", unidadStockId: kgId, precioVenta: 50 }, centralId);
  });

  describe("cargarRecetaVigente / cargarRecetasVigentes / cargarHistorialDeVersiones", () => {
    beforeEach(async () => {
      await version(pizza.id, 1, null, harina.id, 1);
      await version(pizza.id, 2, null, harina.id, 2); // central vigente: v2
      await version(pizza.id, 1, norteId, queso.id, 7); // propia de Norte (numerada por su cuenta)
      await prisma.recetaSucursal.create({ data: { sucursalId: norteId, productoId: pizza.id, habilitada: true } });
    });

    it("sin propia habilitada rige la central; con ella, la propia — y cada sucursal ve la suya", async () => {
      const deCentral = await cargarRecetaVigente(prisma, alcanceDeSucursal(centralId), pizza.id, {});
      expect(deCentral).toMatchObject({ version: 2, sucursalId: null });
      const deSur = await cargarRecetaVigente(prisma, alcanceDeSucursal(surId), pizza.id, {});
      expect(deSur).toMatchObject({ version: 2, sucursalId: null });
      const deNorte = await cargarRecetaVigente(prisma, alcanceDeSucursal(norteId), pizza.id, { include: { ingredientes: true } });
      expect(deNorte).toMatchObject({ version: 1, sucursalId: norteId });
      expect(deNorte?.ingredientes.map((i) => i.insumoProductoId)).toEqual([queso.id]);
    });

    it("ALCANCE_CENTRAL lee solo la central, aunque haya propias (y 'sin sucursal' es la central)", async () => {
      expect(await cargarRecetaVigente(prisma, ALCANCE_CENTRAL, pizza.id, {})).toMatchObject({ version: 2, sucursalId: null });
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(null), pizza.id, {})).toMatchObject({ version: 2, sucursalId: null });
    });

    it("deshabilitar la propia devuelve la central, y la propia queda como historial", async () => {
      await prisma.recetaSucursal.update({ where: { sucursalId_productoId: { sucursalId: norteId, productoId: pizza.id } }, data: { habilitada: false } });
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(norteId), pizza.id, {})).toMatchObject({ version: 2, sucursalId: null });
      const historial = await cargarHistorialDeVersiones(prisma, alcanceDeSucursal(norteId), pizza.id, {});
      expect(historial.map((v) => [v.version, v.sucursalId])).toEqual([[1, norteId]]);
    });

    it("una propia habilitada pero sin versiones cae a la central (no hay receta vacía que gane)", async () => {
      await prisma.recetaSucursal.create({ data: { sucursalId: surId, productoId: pizza.id, habilitada: true } });
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(surId), pizza.id, {})).toMatchObject({ version: 2, sucursalId: null });
    });

    it("el historial es de UNA serie, la más reciente primero: la central no mezcla las propias ni al revés", async () => {
      expect((await cargarHistorialDeVersiones(prisma, ALCANCE_CENTRAL, pizza.id, {})).map((v) => [v.version, v.sucursalId])).toEqual([
        [2, null],
        [1, null],
      ]);
      expect((await cargarHistorialDeVersiones(prisma, alcanceDeSucursal(norteId), pizza.id, {})).map((v) => [v.version, v.sucursalId])).toEqual([[1, norteId]]);
      expect(await cargarHistorialDeVersiones(prisma, alcanceDeSucursal(surId), pizza.id, {})).toEqual([]);
    });

    it("la propia habilitada de UN plato no toca al otro: la efectiva se resuelve plato por plato", async () => {
      await version(empanada.id, 1, null, harina.id, 3);
      const deNorte = await cargarRecetasVigentes(prisma, alcanceDeSucursal(norteId), { include: {} });
      expect(deNorte.get(pizza.id)).toMatchObject({ version: 1, sucursalId: norteId });
      expect(deNorte.get(empanada.id)).toMatchObject({ version: 1, sucursalId: null });
      const deSur = await cargarRecetasVigentes(prisma, alcanceDeSucursal(surId), { include: {} });
      expect(deSur.get(pizza.id)).toMatchObject({ version: 2, sucursalId: null });
      const central = await cargarRecetasVigentes(prisma, ALCANCE_CENTRAL, { include: {} });
      expect(central.get(pizza.id)).toMatchObject({ version: 2, sucursalId: null });
    });

    it("un plato que SOLO tiene receta propia no tiene receta central: la central no lo ve, la sucursal sí", async () => {
      await version(empanada.id, 1, norteId, harina.id, 4);
      await prisma.recetaSucursal.create({ data: { sucursalId: norteId, productoId: empanada.id, habilitada: true } });
      expect(await cargarRecetaVigente(prisma, ALCANCE_CENTRAL, empanada.id, {})).toBeNull();
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(surId), empanada.id, {})).toBeNull();
      expect(await cargarRecetaVigente(prisma, alcanceDeSucursal(norteId), empanada.id, {})).toMatchObject({ version: 1, sucursalId: norteId });

      expect((await versionVigentePorProducto(prisma, ALCANCE_CENTRAL, [pizza.id, empanada.id])).get(empanada.id) ?? null).toBeNull();
      const conReceta = await prisma.producto.findMany({ where: { ...whereConReceta(ALCANCE_CENTRAL), tipo: "PV" }, select: { id: true } });
      expect(conReceta.map((p) => p.id)).toEqual([pizza.id]);
      const conVigente = await prisma.producto.findMany({ where: { id: { in: [pizza.id, empanada.id] } }, include: incluirRecetaVigente(ALCANCE_CENTRAL, {}) });
      expect(conVigente.find((p) => p.id === pizza.id)?.recetaVersiones.map((v) => v.version)).toEqual([2]);
      expect(conVigente.find((p) => p.id === empanada.id)?.recetaVersiones).toEqual([]);
    });

    it("cargarRecetasPropiasHabilitadas devuelve los pares sucursal:producto con la propia habilitada, y solo esos", async () => {
      await prisma.recetaSucursal.create({ data: { sucursalId: surId, productoId: pizza.id, habilitada: false } });
      expect(await cargarRecetasPropiasHabilitadas(prisma, [centralId, norteId, surId])).toEqual(new Set([`${norteId}:${pizza.id}`]));
      expect(await cargarRecetasPropiasHabilitadas(prisma, [norteId], [empanada.id])).toEqual(new Set());
      expect(await cargarRecetasPropiasHabilitadas(prisma, [])).toEqual(new Set());
    });
  });

  describe("lectores que dependen de la receta efectiva", () => {
    it("desactivar un insumo: bloquea según la receta que RIGE en esa sucursal (la propia donde la hay, la central en las demás)", async () => {
      await version(pizza.id, 1, null, harina.id, 1); // la central usa harina
      await version(pizza.id, 1, norteId, queso.id, 1); // la propia de Norte usa queso
      await prisma.recetaSucursal.create({ data: { sucursalId: norteId, productoId: pizza.id, habilitada: true } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId: norteId, productoId: pizza.id, disponible: true } });
      await prisma.disponibilidadProducto.create({ data: { sucursalId: surId, productoId: pizza.id, disponible: true } });

      expect((await dependenciasParaDesactivar(harina.id, centralId, prisma)).recetasVigentes.map((r) => r.nombre)).toEqual(["Pizza"]);
      expect((await dependenciasParaDesactivar(harina.id, surId, prisma)).recetasVigentes.map((r) => r.nombre)).toEqual(["Pizza"]);
      // En Norte la pizza ya no usa harina, usa queso.
      expect((await dependenciasParaDesactivar(harina.id, norteId, prisma)).recetasVigentes).toEqual([]);
      expect((await dependenciasParaDesactivar(queso.id, norteId, prisma)).recetasVigentes.map((r) => r.nombre)).toEqual(["Pizza"]);
      expect((await dependenciasParaDesactivar(queso.id, surId, prisma)).recetasVigentes).toEqual([]);
    });

    it("comparar rendimientos: la celda de una sucursal con receta propia se marca `recetaPropia` y no mezcla calibraciones de la central", async () => {
      const central = await version(pizza.id, 1, null, harina.id, 1);
      await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: central.ingredientes[0].id, sucursalId: norteId, cantidad: 3, mermaPorcentaje: 10 } });
      await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: central.ingredientes[0].id, sucursalId: surId, cantidad: 2, mermaPorcentaje: 0 } });
      const comparar = async () =>
        (await compararRendimientosPorSucursal([{ id: norteId, nombre: "Norte" }, { id: surId, nombre: "Sur" }], { todas: true }, prisma))[0].porSucursal;

      let celdas = await comparar();
      expect(celdas.get(norteId)).toMatchObject({ recetaPropia: false, calibrado: true, cantidad: 3 });
      expect(celdas.get(surId)).toMatchObject({ recetaPropia: false, calibrado: true, cantidad: 2 });

      // Norte pasa a tener receta propia: la calibración se conserva en la base pero no se aplica, y la celda lo dice.
      await version(pizza.id, 1, norteId, queso.id, 9);
      await prisma.recetaSucursal.create({ data: { sucursalId: norteId, productoId: pizza.id, habilitada: true } });
      celdas = await comparar();
      expect(celdas.get(norteId)).toMatchObject({ recetaPropia: true, calibrado: false, cantidad: 1 });
      expect(celdas.get(surId)).toMatchObject({ recetaPropia: false, calibrado: true, cantidad: 2 });
      expect(await prisma.rendimientoLocalIngrediente.count({ where: { sucursalId: norteId } })).toBe(1);

      // Volver a la central: las calibraciones rigen de nuevo, tal como estaban.
      await prisma.recetaSucursal.update({ where: { sucursalId_productoId: { sucursalId: norteId, productoId: pizza.id } }, data: { habilitada: false } });
      celdas = await comparar();
      expect(celdas.get(norteId)).toMatchObject({ recetaPropia: false, calibrado: true, cantidad: 3 });
    });
  });

  describe("restricciones de la base (migración 20261002130000)", () => {
    it("la numeración es por serie: la v1 central y la v1 de cada sucursal conviven, pero una misma serie no repite versión", async () => {
      await version(pizza.id, 1, null, harina.id, 1);
      await version(pizza.id, 1, norteId, harina.id, 1);
      await version(pizza.id, 1, surId, harina.id, 1);
      await expect(version(pizza.id, 1, null, harina.id, 2)).rejects.toThrow();
      await expect(version(pizza.id, 1, norteId, harina.id, 2)).rejects.toThrow();
      await version(pizza.id, 2, norteId, harina.id, 2);
      expect(await prisma.recetaVersion.count({ where: { productoId: pizza.id } })).toBe(4);
    });

    it("una sola fila RecetaSucursal por (sucursal, producto)", async () => {
      await prisma.recetaSucursal.create({ data: { sucursalId: norteId, productoId: pizza.id, habilitada: true } });
      await expect(prisma.recetaSucursal.create({ data: { sucursalId: norteId, productoId: pizza.id, habilitada: false } })).rejects.toThrow();
    });

    it("una versión propia no puede apuntar a una sucursal de otra empresa (FK compuesta [empresaId, sucursalId])", async () => {
      await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      const ajena = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: "otra" } });
      await expect(
        prismaAdmin.recetaVersion.create({ data: { empresaId: "empresa_principal", productoId: pizza.id, version: 1, sucursalId: ajena.id } })
      ).rejects.toThrow();
      await expect(prismaAdmin.recetaSucursal.create({ data: { empresaId: "empresa_principal", sucursalId: ajena.id, productoId: pizza.id, habilitada: true } })).rejects.toThrow();
    });

    it("el RLS aísla RecetaSucursal por empresa (una empresa no ve ni puede escribir filas de la otra)", async () => {
      await prismaAdmin.empresa.create({ data: { id: "otra", nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
      const unidadOtra = await prismaAdmin.unidad.create({ data: { empresaId: "otra", nombre: "kg-otra", magnitud: "PESO" } });
      const sucursalOtra = await prismaAdmin.sucursal.create({ data: { nombre: "Ajena", empresaId: "otra" } });
      const productoOtro = await prismaAdmin.producto.create({ data: { empresaId: "otra", codigo: "PV_OTRA", nombre: "De otra", tipo: "PV", unidadStockId: unidadOtra.id, precioVenta: 1 } });
      await prismaAdmin.recetaSucursal.create({ data: { empresaId: "otra", sucursalId: sucursalOtra.id, productoId: productoOtro.id, habilitada: true } });
      await prismaAdmin.recetaSucursal.create({ data: { empresaId: "empresa_principal", sucursalId: norteId, productoId: pizza.id, habilitada: true } });

      expect((await dbDeEmpresa("empresa_principal").recetaSucursal.findMany()).map((r) => r.sucursalId)).toEqual([norteId]);
      expect((await dbDeEmpresa("otra").recetaSucursal.findMany()).map((r) => r.sucursalId)).toEqual([sucursalOtra.id]);
      await expect(
        dbDeEmpresa("empresa_principal").recetaSucursal.create({ data: { empresaId: "otra", sucursalId: sucursalOtra.id, productoId: productoOtro.id, habilitada: false } })
      ).rejects.toThrow();
      expect((await dbDeEmpresa("empresa_principal").recetaSucursal.updateMany({ data: { habilitada: false }, where: { sucursalId: sucursalOtra.id } })).count).toBe(0);
    });
  });
});
