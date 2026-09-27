import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import {
  listarCalibracionesDeIngredientes,
  listarMpDisponiblesEnAlguna,
  listarOpcionesDeSustituto,
  listarProductosConReceta,
} from "../../../src/server/consultas/catalogo/recetas";

/**
 * `src/server/consultas/catalogo/recetas.ts` (Task #41, Fase D3) contra Postgres real.
 *
 * `listarProductosConReceta` reemplaza, SIN cambiar su forma, la consulta que hacía en línea la lista de recetas
 * (`/catalogo/recetas`). Ningún spec de Playwright verifica el CONTENIDO de esa lista (solo la maquetación general la
 * visita), así que este archivo es la protección real del cambio: qué productos entran (disponibles en ALGUNA sucursal y con
 * al menos una versión de receta), en qué orden (nombre asc), y que cada uno traiga SOLO su última versión (la de `version`
 * más alta, no la última creada) con el conteo de ingredientes DE ESA versión. También fija las claves exactas de cada nivel
 * del `include`, porque es lo que la página usa (`p.recetaVersiones[0].version`, `._count.ingredientes`).
 *
 * D4 suma las tres lecturas del editor (`/catalogo/recetas/[productoId]`): `listarMpDisponiblesEnAlguna` (desplegable
 * "Agregar ingrediente"), `listarOpcionesDeSustituto` (desplegables "Sustituto N" de un ingrediente) y
 * `listarCalibracionesDeIngredientes` (nota "Calibrado en N sucursal(es)"). Los specs de Playwright (recetas-sustitutos,
 * accesibilidad) solo ven un caso feliz de cada una; acá se fija qué entra y qué queda fuera de cada filtro, y la forma exacta.
 */

const ESCALARES_PRODUCTO = Object.keys(Prisma.ProductoScalarFieldEnum).sort();
const ESCALARES_VERSION = Object.keys(Prisma.RecetaVersionScalarFieldEnum).sort();
const ESCALARES_CALIBRACION = Object.keys(Prisma.RendimientoLocalIngredienteScalarFieldEnum).sort();

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
      await expect(listarProductosConReceta()).resolves.toEqual([]);
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

      const lista = await listarProductosConReceta();

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

      const [p] = await listarProductosConReceta();
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

      let [p] = await listarProductosConReceta();
      expect(p.recetaVersiones.map((v) => [v.version, v._count.ingredientes])).toEqual([[1, 3]]);

      await crearVersion(pizza, 2, [harina]);
      [p] = await listarProductosConReceta();
      expect(p.recetaVersiones.map((v) => [v.version, v._count.ingredientes])).toEqual([[2, 1]]);
    });

    it("sigue la disponibilidad: deja de aparecer cuando se desactiva en la última sucursal donde estaba disponible", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true, [sucursalB]: true });
      await crearVersion(pizza, 1, [harina]);

      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalA, productoId: pizza } }, data: { disponible: false } });
      expect((await listarProductosConReceta()).map((p) => p.id)).toEqual([pizza]);

      await prisma.disponibilidadProducto.update({ where: { sucursalId_productoId: { sucursalId: sucursalB, productoId: pizza } }, data: { disponible: false } });
      await expect(listarProductosConReceta()).resolves.toEqual([]);
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
    it("devuelve EXACTAMENTE las materias primas disponibles en alguna sucursal, por nombre, sin duplicados", async () => {
      // Entra: MP "Se produce" disponible (sigue siendo MP).
      await crearProducto("MP_SALSA", "Salsa base", "MP", { [sucursalA]: false, [sucursalB]: true }, { seProduce: true });
      // Fuera: un PV disponible, una MP con todas sus filas en false y una MP sin ninguna fila de disponibilidad.
      await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true, [sucursalB]: true });
      await crearProducto("MP_ALBAHACA", "Albahaca", "MP", { [sucursalA]: false, [sucursalB]: false });
      await crearProducto("MP_OREGANO", "Orégano", "MP", {});

      const lista = await listarMpDisponiblesEnAlguna();
      // Harina está disponible en las DOS sucursales: aparece una sola vez.
      expect(lista.map((p) => p.nombre)).toEqual(["Aceite", "Harina", "Queso", "Salsa base", "Tomate"]);
      expect(lista.filter((p) => p.nombre !== "Salsa base").map((p) => p.id)).toEqual([aceite, harina, queso, tomate]);
      expect(lista.every((p) => p.tipo === "MP")).toBe(true);
    });

    it("forma exacta: solo los escalares del producto, sin relaciones", async () => {
      const lista = await listarMpDisponiblesEnAlguna();
      for (const p of lista) expect(Object.keys(p).sort()).toEqual(ESCALARES_PRODUCTO);
      expect(lista.find((p) => p.id === harina)).toMatchObject({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg });
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const lista = await prisma.$transaction(async (tx) => {
        const p = await tx.producto.create({ data: { codigo: "MP_TX", nombre: "Azúcar", tipo: "MP", unidadStockId: kg } });
        await tx.disponibilidadProducto.create({ data: { sucursalId: sucursalB, productoId: p.id, disponible: true } });
        return listarMpDisponiblesEnAlguna(tx);
      });
      expect(lista.map((p) => p.nombre)).toEqual(["Aceite", "Azúcar", "Harina", "Queso", "Tomate"]);
    });
  });

  describe("listarOpcionesDeSustituto", () => {
    let litro: string;
    let insHarina: string;
    let insIntegral: string;
    let insQueso: string;
    let insOliva: string;

    async function crearInsumo(nombre: string, productoIds: string[], activo = true) {
      const i = await prisma.insumo.create({ data: { nombre, activo } });
      if (productoIds.length > 0) await prisma.producto.updateMany({ where: { id: { in: productoIds } }, data: { insumoId: i.id } });
      return i.id;
    }

    beforeEach(async () => {
      litro = (await prisma.unidad.create({ data: { nombre: "l", magnitud: "VOLUMEN", decimales: 2 } })).id;

      insHarina = await crearInsumo("Harina 000", [harina]);
      // Dos MP del mismo insumo, una sola disponible: el insumo entra UNA vez.
      const integralA = await crearProducto("MP_INTEGRAL_A", "Harina integral A", "MP", { [sucursalA]: true });
      const integralB = await crearProducto("MP_INTEGRAL_B", "Harina integral B", "MP", { [sucursalB]: false });
      insIntegral = await crearInsumo("Harina integral", [integralA, integralB]);
      insQueso = await crearInsumo("Queso cremoso", [queso]);
      const oliva = await crearProducto("MP_OLIVA", "Aceite de oliva", "MP", { [sucursalA]: true }, { unidadStockId: litro });
      insOliva = await crearInsumo("Aceite de oliva", [oliva]);

      // Fuera siempre: insumo inactivo, insumo cuya única MP no está disponible, insumo cuyo producto es un PV, insumo sin productos.
      const viejo = await crearProducto("MP_VIEJO", "Harina vieja", "MP", { [sucursalA]: true });
      await crearInsumo("Harina vieja", [viejo], false);
      const sinDisp = await crearProducto("MP_SIN_DISP", "Harina sin disponibilidad", "MP", { [sucursalA]: false, [sucursalB]: false });
      await crearInsumo("Harina sin disponibilidad", [sinDisp]);
      const pv = await crearProducto("PV_PAN", "Pan", "PV", { [sucursalA]: true });
      await crearInsumo("Pan", [pv]);
      await crearInsumo("Sin productos", []);
    });

    it("insumos activos con alguna MP disponible en la MISMA unidad de stock, por nombre, sin el insumo excluido", async () => {
      await expect(listarOpcionesDeSustituto({ insumoIdExcluido: insHarina, unidadId: kg })).resolves.toEqual([
        { id: insIntegral, nombre: "Harina integral" },
        { id: insQueso, nombre: "Queso cremoso" },
      ]);
    });

    it("insumoIdExcluido null → no excluye ninguno (la MP del ingrediente no tiene insumo)", async () => {
      await expect(listarOpcionesDeSustituto({ insumoIdExcluido: null, unidadId: kg })).resolves.toEqual([
        { id: insHarina, nombre: "Harina 000" },
        { id: insIntegral, nombre: "Harina integral" },
        { id: insQueso, nombre: "Queso cremoso" },
      ]);
    });

    it("filtra por la unidad del ingrediente: con litros solo entra el insumo que tiene una MP en litros", async () => {
      await expect(listarOpcionesDeSustituto({ insumoIdExcluido: insHarina, unidadId: litro })).resolves.toEqual([{ id: insOliva, nombre: "Aceite de oliva" }]);
      await expect(listarOpcionesDeSustituto({ insumoIdExcluido: insOliva, unidadId: litro })).resolves.toEqual([]);
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const opciones = await prisma.$transaction(async (tx) => {
        await tx.insumo.update({ where: { id: insQueso }, data: { activo: false } });
        return listarOpcionesDeSustituto({ insumoIdExcluido: insHarina, unidadId: kg }, tx);
      });
      expect(opciones).toEqual([{ id: insIntegral, nombre: "Harina integral" }]);
    });
  });

  describe("listarCalibracionesDeIngredientes", () => {
    it("devuelve SOLO las calibraciones de las líneas pedidas que pisan cantidad o merma, cada una con el nombre de su sucursal", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });
      const v1 = await prisma.recetaVersion.create({
        data: {
          productoId: pizza,
          version: 1,
          ingredientes: {
            create: [
              { insumoProductoId: harina, cantidad: 0.3, unidadId: kg },
              { insumoProductoId: queso, cantidad: 0.2, unidadId: kg },
              { insumoProductoId: tomate, cantidad: 0.1, unidadId: kg },
            ],
          },
        },
        include: { ingredientes: true },
      });
      const linea = (insumoProductoId: string) => v1.ingredientes.find((i) => i.insumoProductoId === insumoProductoId)!.id;

      // Otra receta con una línea calibrada: no se pidió, queda fuera.
      const empanada = await crearProducto("PV_EMPANADA", "Empanada", "PV", { [sucursalA]: true });
      const otra = await prisma.recetaVersion.create({
        data: { productoId: empanada, version: 1, ingredientes: { create: [{ insumoProductoId: harina, cantidad: 0.05, unidadId: kg }] } },
        include: { ingredientes: true },
      });

      await prisma.rendimientoLocalIngrediente.createMany({
        data: [
          { recetaIngredienteId: linea(harina), sucursalId: sucursalA, cantidad: 0.35 },
          { recetaIngredienteId: linea(harina), sucursalId: sucursalB, mermaPorcentaje: 7 },
          // Fila sin nada pisado (cantidad y merma null): no cuenta como calibración.
          { recetaIngredienteId: linea(queso), sucursalId: sucursalA },
          { recetaIngredienteId: otra.ingredientes[0].id, sucursalId: sucursalA, cantidad: 0.06 },
        ],
      });

      const calibraciones = await listarCalibracionesDeIngredientes(v1.ingredientes.map((i) => i.id));
      const resumen = calibraciones
        .map((c) => ({ linea: c.recetaIngredienteId, sucursal: c.sucursal.nombre, cantidad: c.cantidad && Number(c.cantidad), merma: c.mermaPorcentaje && Number(c.mermaPorcentaje) }))
        .sort((a, b) => a.sucursal.localeCompare(b.sucursal));
      expect(resumen).toEqual([
        { linea: linea(harina), sucursal: "Sucursal A", cantidad: 0.35, merma: null },
        { linea: linea(harina), sucursal: "Sucursal B", cantidad: null, merma: 7 },
      ]);

      // Forma exacta: escalares de la calibración + sucursal con SOLO el nombre.
      for (const c of calibraciones) {
        expect(Object.keys(c).sort()).toEqual([...ESCALARES_CALIBRACION, "sucursal"].sort());
        expect(Object.keys(c.sucursal)).toEqual(["nombre"]);
      }
    });

    it("sin líneas pedidas (o sin calibraciones) devuelve []", async () => {
      await expect(listarCalibracionesDeIngredientes([])).resolves.toEqual([]);
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });
      const v1 = await crearVersion(pizza, 1, [harina]);
      const lineas = await prisma.recetaIngrediente.findMany({ where: { recetaVersionId: v1.id }, select: { id: true } });
      await expect(listarCalibracionesDeIngredientes(lineas.map((l) => l.id))).resolves.toEqual([]);
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const pizza = await crearProducto("PV_PIZZA", "Pizza muzza", "PV", { [sucursalA]: true });
      const v1 = await prisma.recetaVersion.create({
        data: { productoId: pizza, version: 1, ingredientes: { create: [{ insumoProductoId: harina, cantidad: 0.3, unidadId: kg }] } },
        include: { ingredientes: true },
      });
      const calibraciones = await prisma.$transaction(async (tx) => {
        await tx.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: v1.ingredientes[0].id, sucursalId: sucursalB, cantidad: 0.4 } });
        return listarCalibracionesDeIngredientes([v1.ingredientes[0].id], tx);
      });
      expect(calibraciones.map((c) => [c.sucursal.nombre, Number(c.cantidad)])).toEqual([["Sucursal B", 0.4]]);
    });
  });
});
