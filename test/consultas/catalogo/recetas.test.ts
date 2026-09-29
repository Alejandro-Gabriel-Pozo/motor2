import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import {
  listarProductosConReceta,
  listarMpDisponiblesEnAlguna,
  listarOpcionesDeSustituto,
  listarCalibracionesDeIngredientes,
} from "../../../src/server/consultas/catalogo/recetas";

/**
 * `src/server/consultas/catalogo/recetas.ts` (Task #41, Fase D3/D4) contra Postgres real.
 *
 * `listarProductosConReceta` reemplaza, SIN cambiar su forma, la consulta que hacía en línea la lista de recetas
 * (`/catalogo/recetas`). Ningún spec de Playwright verifica el CONTENIDO de esa lista (solo la maquetación general la
 * visita), así que este archivo es la protección real del cambio: qué productos entran (disponibles en ALGUNA sucursal y con
 * al menos una versión de receta), en qué orden (nombre asc), y que cada uno traiga SOLO su última versión (la de `version`
 * más alta, no la última creada) con el conteo de ingredientes DE ESA versión. También fija las claves exactas de cada nivel
 * del `include`, porque es lo que la página usa (`p.recetaVersiones[0].version`, `._count.ingredientes`).
 *
 * `listarMpDisponiblesEnAlguna`, `listarOpcionesDeSustituto` y `listarCalibracionesDeIngredientes` (D4) reemplazan, SIN
 * cambiar su forma, las tres consultas en línea del editor de receta (`/catalogo/recetas/[productoId]`).
 */

const ESCALARES_PRODUCTO = Object.keys(Prisma.ProductoScalarFieldEnum).sort();
const ESCALARES_VERSION = Object.keys(Prisma.RecetaVersionScalarFieldEnum).sort();

describe("server/consultas/catalogo/recetas", () => {
  let sucursalA: string;
  let sucursalB: string;
  let kg: string;
  let harina: string;
  let queso: string;
  let tomate: string;
  let aceite: string;

  async function crearProducto(codigo: string, nombre: string, tipo: "MP" | "PV", disponibilidad: Record<string, boolean>, extra: Partial<Prisma.ProductoUncheckedCreateInput> = {}) {
    const p = await prisma.producto.create({ data: { codigo, nombre, tipo, unidadStockId: kg, ...extra } });
    const filas = Object.entries(disponibilidad).map(([sucursalId, disponible]) => ({ sucursalId, productoId: p.id, disponible }));
    if (filas.length > 0) await prisma.disponibilidadProducto.createMany({ data: filas });
    return p.id;
  }

  async function crearVersion(productoId: string, version: number, insumos: string[]) {
    return prisma.recetaVersion.create({
      data: {
        productoId,
        version,
        ingredientes: { create: insumos.map((insumoProductoId) => ({ insumoProductoId, cantidad: 0.1, unidadId: kg })) },
      },
    });
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalA = (await prisma.sucursal.create({ data: { nombre: "Sucursal A" } })).id;
    sucursalB = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    kg = (await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } })).id;

    // Materias primas disponibles SIN receta propia: son ingredientes, nunca deben aparecer en la lista.
    harina = await crearProducto("MP_HARINA", "Harina", "MP", { [sucursalA]: true, [sucursalB]: true });
    queso = await crearProducto("MP_QUESO", "Queso", "MP", { [sucursalA]: true });
    tomate = await crearProducto("MP_TOMATE", "Tomate", "MP", { [sucursalA]: true });
    aceite = await crearProducto("MP_ACEITE", "Aceite", "MP", { [sucursalB]: true });
  });

  describe("listarProductosConReceta", () => {
    it("con la base sin recetas devuelve []", async () => {
      await expect(listarProductosConReceta(prisma)).resolves.toEqual([]);
    });

    it("devuelve EXACTAMENTE los productos disponibles en alguna sucursal con receta, por nombre, con su última versión y el conteo de ingredientes de esa versión", async () => {
      // Se crean a propósito en orden NO alfabético, y las versiones de la pizza fuera de orden (v3 antes que v1/v2): el
      // resultado tiene que ordenar por nombre y elegir por número de versión, no por orden de creación.
      const salsa = await crearProducto("MP_SALSA", "Salsa base", "MP", { [sucursalA]: false, [sucursalB]: true }, { seProduce: true });
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true, [sucursalB]: true });
      const empanada = await crearProducto("PV_EMPANADA", "Empanada", "PV", { [sucursalB]: true });

      const pizzaV3 = await crearVersion(pizza, 3, [harina]);
      await crearVersion(pizza, 1, [harina, queso]);
      await crearVersion(pizza, 2, [harina, queso, tomate, aceite]);
      // Pasos en la versión vigente: el conteo es de INGREDIENTES, los pasos no suman.
      await prisma.recetaPaso.createMany({
        data: [
          { recetaVersionId: pizzaV3.id, orden: 1, instruccion: "Amasar" },
          { recetaVersionId: pizzaV3.id, orden: 2, instruccion: "Hornear" },
        ],
      });

      const salsaV1 = await crearVersion(salsa, 1, [tomate, aceite]);
      // Una versión sin ingredientes cuenta como receta (existe la versión): entra con _count 0.
      const empanadaV1 = await crearVersion(empanada, 1, []);

      // Con receta pero NO disponible en ninguna sucursal: fuera (todas sus filas en false, o sin ninguna fila).
      const calzone = await crearProducto("PV_CALZONE", "Calzone", "PV", { [sucursalA]: false, [sucursalB]: false });
      await crearVersion(calzone, 1, [harina, queso]);
      const fugazza = await crearProducto("PV_FUGAZZA", "Fugazza", "PV", {});
      await crearVersion(fugazza, 1, [harina]);

      // Disponible pero SIN receta: fuera.
      await crearProducto("PV_GASEOSA", "Gaseosa", "PV", { [sucursalA]: true });

      const lista = await listarProductosConReceta(prisma);

      // Sin duplicados aunque la pizza esté disponible en las dos sucursales.
      expect(lista.map((p) => p.nombre)).toEqual(["Empanada", "Pizza muzza", "Salsa base"]);
      expect(lista.map((p) => p.id)).toEqual([empanada, pizza, salsa]);

      const resumen = lista.map((p) => ({
        nombre: p.nombre,
        tipo: p.tipo,
        versiones: p.recetaVersiones.map((v) => ({ id: v.id, version: v.version, ingredientes: v._count.ingredientes })),
      }));
      expect(resumen).toEqual([
        { nombre: "Empanada", tipo: "PV", versiones: [{ id: empanadaV1.id, version: 1, ingredientes: 0 }] },
        { nombre: "Pizza muzza", tipo: "PV", versiones: [{ id: pizzaV3.id, version: 3, ingredientes: 1 }] },
        { nombre: "Salsa base", tipo: "MP", versiones: [{ id: salsaV1.id, version: 1, ingredientes: 2 }] },
      ]);
    });

    it("forma exacta: escalares del producto + recetaVersiones (UNA sola), cada versión con sus escalares + _count { ingredientes }", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true }, { precioVenta: 9000 });
      await crearVersion(pizza, 1, [harina]);
      const v2 = await prisma.recetaVersion.create({
        data: {
          productoId: pizza,
          version: 2,
          rendimientoCantidad: 1,
          rendimientoUnidadId: kg,
          racionesCantidad: 8,
          comentarios: "Masa de 48 h",
          ingredientes: { create: [{ insumoProductoId: harina, cantidad: 0.3, unidadId: kg }, { insumoProductoId: queso, cantidad: 0.2, unidadId: kg, mermaPorcentaje: 5 }] },
        },
      });

      const [p] = await listarProductosConReceta(prisma);
      expect(Object.keys(p).sort()).toEqual([...ESCALARES_PRODUCTO, "recetaVersiones"].sort());
      expect(p).toMatchObject({ id: pizza, codigo: "PV_PIZZA", nombre: "Pizza muzza", tipo: "PV", unidadStockId: kg });
      expect(Number(p.precioVenta)).toBe(9000);

      expect(p.recetaVersiones).toHaveLength(1);
      const [vigente] = p.recetaVersiones;
      // Nada de `ingredientes`/`pasos`/`producto`: solo los escalares de la versión y el conteo.
      expect(Object.keys(vigente).sort()).toEqual([...ESCALARES_VERSION, "_count"].sort());
      expect(vigente).toMatchObject({ id: v2.id, productoId: pizza, version: 2, racionesCantidad: 8, comentarios: "Masa de 48 h", rendimientoUnidadId: kg });
      expect(Number(vigente.rendimientoCantidad)).toBe(1);
      expect(vigente._count).toEqual({ ingredientes: 2 });
    });

    it("una versión nueva pasa a ser la vigente en la lista (y su conteo reemplaza al de la anterior)", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });
      await crearVersion(pizza, 1, [harina, queso, tomate]);

      let [p] = await listarProductosConReceta(prisma);
      expect(p.recetaVersiones.map((v) => [v.version, v._count.ingredientes])).toEqual([[1, 3]]);

      await crearVersion(pizza, 2, [harina]);
      [p] = await listarProductosConReceta(prisma);
      expect(p.recetaVersiones.map((v) => [v.version, v._count.ingredientes])).toEqual([[2, 1]]);
    });

    it("sigue la disponibilidad: deja de aparecer cuando se desactiva en la última sucursal donde estaba disponible", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true, [sucursalB]: true });
      await crearVersion(pizza, 1, [harina]);

      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: pizza } }, data: { disponible: false } });
      expect((await listarProductosConReceta(prisma)).map((p) => p.id)).toEqual([pizza]);

      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalB, productoId: pizza } }, data: { disponible: false } });
      await expect(listarProductosConReceta(prisma)).resolves.toEqual([]);
    });

    it("acepta el cliente de una transacción como `db` (ve lo escrito dentro de la misma transacción)", async () => {
      const lista = await prisma.$transaction(async (tx) => {
        const p = await tx.producto.create({ data: { codigo: "PV_TX", nombre: "Tarta", tipo: "PV", unidadStockId: kg } });
        await tx.disponibilidadProducto.create({ data: { sucursalId: sucursalA, productoId: p.id, disponible: true } });
        await tx.recetaVersion.create({ data: { productoId: p.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina, cantidad: 1, unidadId: kg }] } } });
        return listarProductosConReceta(tx);
      });
      expect(lista.map((p) => [p.nombre, p.recetaVersiones[0].version, p.recetaVersiones[0]._count.ingredientes])).toEqual([["Tarta", 1, 1]]);
    });
  });

  describe("listarMpDisponiblesEnAlguna", () => {
    it("devuelve solo las MP disponibles en alguna sucursal, por nombre — nunca un PV", async () => {
      await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });

      const lista = await listarMpDisponiblesEnAlguna(prisma);
      expect(lista.map((p) => p.nombre)).toEqual(["Aceite", "Harina", "Queso", "Tomate"]);
    });

    it("una MP sin ninguna fila de disponibilidad, o con todas en false, queda afuera", async () => {
      await crearProducto("MP_SAL", "Sal", "MP", {});
      await crearProducto("MP_PIMIENTA", "Pimienta", "MP", { [sucursalA]: false, [sucursalB]: false });

      expect((await listarMpDisponiblesEnAlguna(prisma)).map((p) => p.nombre)).toEqual(["Aceite", "Harina", "Queso", "Tomate"]);
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const nombres = await prisma.$transaction(async (tx) => {
        const p = await tx.producto.create({ data: { codigo: "MP_TX", nombre: "Manteca", tipo: "MP", unidadStockId: kg } });
        await tx.disponibilidadProducto.create({ data: { sucursalId: sucursalA, productoId: p.id, disponible: true } });
        return (await listarMpDisponiblesEnAlguna(tx)).map((mp) => mp.nombre);
      });
      expect(nombres).toContain("Manteca");
    });
  });

  describe("listarOpcionesDeSustituto", () => {
    let insumoHarina: string;
    let insumoQueso: string;
    let insumoTomate: string;
    let litro: string;

    beforeEach(async () => {
      litro = (await prisma.unidad.create({ data: { nombre: "litro", magnitud: "VOLUMEN", decimales: 2 } })).id;
      insumoHarina = (await prisma.insumo.create({ data: { nombre: "Harina (insumo)" } })).id;
      insumoQueso = (await prisma.insumo.create({ data: { nombre: "Queso (insumo)" } })).id;
      insumoTomate = (await prisma.insumo.create({ data: { nombre: "Tomate (insumo)" } })).id;
      await prisma.producto.update({ where: { id: harina }, data: { insumoId: insumoHarina } });
      await prisma.producto.update({ where: { id: queso }, data: { insumoId: insumoQueso } });
      await prisma.producto.update({ where: { id: tomate }, data: { insumoId: insumoTomate } });
    });

    it("devuelve solo id+nombre de los insumos activos con alguna MP de esa unidad de stock disponible en alguna sucursal, excluyendo el insumo indicado", async () => {
      const opciones = await listarOpcionesDeSustituto({ insumoIdExcluido: insumoHarina, unidadId: kg }, prisma);
      expect(opciones).toEqual(
        expect.arrayContaining([
          { id: insumoQueso, nombre: "Queso (insumo)" },
          { id: insumoTomate, nombre: "Tomate (insumo)" },
        ])
      );
      expect(opciones.map((o) => o.id)).not.toContain(insumoHarina);
      expect(Object.keys(opciones[0]).sort()).toEqual(["id", "nombre"]);
    });

    it("sin excluir ninguno (insumoIdExcluido null), los devuelve todos — la unidad de stock filtra, no el insumo", async () => {
      const opciones = await listarOpcionesDeSustituto({ insumoIdExcluido: null, unidadId: kg }, prisma);
      expect(opciones.map((o) => o.id).sort()).toEqual([insumoHarina, insumoQueso, insumoTomate].sort());
    });

    it("un insumo inactivo, o cuya MP no tiene esa unidad de stock o no está disponible en ninguna sucursal, queda afuera", async () => {
      await prisma.insumo.update({ where: { id: insumoQueso }, data: { activo: false } });
      await prisma.producto.update({ where: { id: tomate }, data: { unidadStockId: litro } });
      const soloTomateDisponible = await crearProducto("MP_TOMATE2", "Tomate en otra sucursal", "MP", {});
      const insumoNoDisponible = (await prisma.insumo.create({ data: { nombre: "Sin disponibilidad" } })).id;
      await prisma.producto.update({ where: { id: soloTomateDisponible }, data: { insumoId: insumoNoDisponible } });

      const opciones = await listarOpcionesDeSustituto({ insumoIdExcluido: null, unidadId: kg }, prisma);
      expect(opciones.map((o) => o.id)).toEqual([insumoHarina]);
    });
  });

  describe("listarCalibracionesDeIngredientes", () => {
    it("devuelve, para los recetaIngredienteId pedidos, solo las calibraciones con cantidad o merma no nulas, con el nombre de sucursal incluido", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });
      const version = await crearVersion(pizza, 1, [harina, queso]);
      const [ingHarina, ingQueso] = await prisma.recetaIngrediente.findMany({ where: { recetaVersionId: version.id }, orderBy: { insumoProductoId: "asc" } });

      await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: ingHarina.id, sucursalId: sucursalA, cantidad: 0.2 } });
      await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: ingQueso.id, sucursalId: sucursalA, mermaPorcentaje: 5 } });
      // Fila "vacía" (ni cantidad ni merma): no debería poder crearse con datos reales, pero si existiera no debe volver.

      const calibraciones = await listarCalibracionesDeIngredientes([ingHarina.id, ingQueso.id], prisma);
      expect(calibraciones.map((c) => [c.recetaIngredienteId, c.sucursal.nombre]).sort()).toEqual(
        [
          [ingHarina.id, "Sucursal A"],
          [ingQueso.id, "Sucursal A"],
        ].sort()
      );
    });

    it("con una lista de ids que no tienen ninguna calibración, devuelve []", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });
      const version = await crearVersion(pizza, 1, [harina]);
      const [ing] = await prisma.recetaIngrediente.findMany({ where: { recetaVersionId: version.id } });

      await expect(listarCalibracionesDeIngredientes([ing.id], prisma)).resolves.toEqual([]);
    });
  });
});
