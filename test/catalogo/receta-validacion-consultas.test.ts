import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, prisma } from "../setup/test-db";
import { validarCabecera, validarIngredientes, type IngredienteInput } from "../../src/core/catalogo/public";
import { cargarDatosParaValidarReceta } from "../../src/server/persistencia/catalogo/cargar-datos-para-validar-receta";
import type { Db } from "../../src/lib/db-tipos";

/**
 * Pureza Fase 3 — validación de recetas. La validación es pura y recibe lo del catálogo ya leído; `cargarDatosParaValidarReceta` lo lee EN LOTE. Antes `guardarReceta`
 * hacía dos consultas por ingrediente (`findUnique` + `findFirst`) y una por cada sustituto: crecía con el tamaño de la receta. Los mensajes de cada caso tienen que ser
 * los de siempre.
 */
describe("validación de receta: el catálogo se lee en lote y los mensajes no cambian", () => {
  let sucursalId: string;
  let kgId: string;
  let gId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    sucursalId = (await sembrarBase()).sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
  });

  const ingrediente = (insumoProductoId: string, extra: Partial<IngredienteInput> = {}): IngredienteInput => ({ insumoProductoId, cantidad: 1, unidadId: kgId, ...extra });

  async function mp(codigo: string, insumoId: string | null = null, unidadStockId = kgId) {
    return sembrarProductoDisponible({ codigo, nombre: `MP ${codigo}`, tipo: "MP", unidadStockId, ...(insumoId ? { insumoId } : {}) }, sucursalId);
  }

  const contarOperaciones = () => {
    const operaciones: string[] = [];
    const db = prisma.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            operaciones.push(`${model}.${operation}`);
            return query(args);
          },
        },
      },
    }) as unknown as Db;
    return { db, operaciones };
  };

  it("una receta con seis ingredientes lee el catálogo con DOS consultas de producto, sin importar cuántos ingredientes tenga", async () => {
    const ingredientes = [];
    for (let i = 0; i < 6; i++) ingredientes.push(ingrediente((await mp(`MP_${i}`)).id));

    const { db, operaciones } = contarOperaciones();
    const datos = await cargarDatosParaValidarReceta(db, ingredientes, {});

    expect(validarIngredientes(ingredientes, { seProduce: false }, datos)).toBeNull();
    expect(operaciones.filter((o) => o.startsWith("Producto."))).toEqual(["Producto.findMany", "Producto.findMany"]);
  });

  it("los mensajes de cada caso son los de siempre", async () => {
    const insumoA = await prisma.insumo.create({ data: { nombre: "Insumo A" } });
    const insumoInactivo = await prisma.insumo.create({ data: { nombre: "Insumo inactivo", activo: false } });
    const insumoEnGramos = await prisma.insumo.create({ data: { nombre: "Insumo en gramos" } });
    await mp("MP_G", insumoEnGramos.id, gId);
    const principal = await mp("MP_P", insumoA.id);
    const pv = await sembrarProductoDisponible({ codigo: "PV_1", nombre: "Un plato", tipo: "PV", unidadStockId: kgId }, sucursalId);
    const apagada = await mp("MP_OFF");
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: apagada.id } });

    const validar = async (items: IngredienteInput[], cabecera = {}) => {
      const datos = await cargarDatosParaValidarReceta(prisma, items, cabecera);
      return validarIngredientes(items, { seProduce: false }, datos);
    };

    expect(await validar([ingrediente(principal.id)])).toBeNull();
    expect(await validar([ingrediente(pv.id)])).toBe(`Cada ingrediente tiene que ser una materia prima (MP) (${pv.nombre} no lo es).`);
    expect(await validar([ingrediente("no-existe")])).toBe("Cada ingrediente tiene que ser una materia prima (MP) (no-existe no lo es).");
    expect(await validar([ingrediente(apagada.id)])).toBe(`Cada ingrediente tiene que ser una materia prima (MP) disponible en alguna sucursal (${apagada.nombre} no lo está en ninguna).`);
    expect(await validar([ingrediente(principal.id, { insumoSustitutoIds: ["no-existe"] })])).toBe("No se encontró uno de los insumos sustitutos.");
    expect(await validar([ingrediente(principal.id, { insumoSustitutoIds: [insumoInactivo.id] })])).toBe('El insumo sustituto "Insumo inactivo" está inactivo.');
    expect(await validar([ingrediente(principal.id, { insumoSustitutoIds: [insumoA.id] })])).toBe("Un sustituto no puede ser el mismo Insumo que el ingrediente principal.");
    expect(await validar([ingrediente(principal.id, { insumoSustitutoIds: [insumoInactivo.id, insumoInactivo.id] })])).toBe("Un ingrediente no puede tener el mismo sustituto declarado dos veces.");
    expect(await validar([ingrediente(principal.id, { insumoSustitutoIds: [insumoEnGramos.id] })])).toMatch(/Este Insumo ya tiene productos disponibles con otra unidad de stock/);
  });

  it("la cabecera valida la unidad del rendimiento con la unidad leída en lote", async () => {
    const datos = await cargarDatosParaValidarReceta(prisma, [], { rendimientoCantidad: 1.5, rendimientoUnidadId: kgId });
    // kg admite decimales: 1,5 es válido. Con una unidad inexistente, el mensaje de siempre.
    expect(validarCabecera({ rendimientoCantidad: 1.5, rendimientoUnidadId: kgId }, datos)).toBeNull();
    expect(validarCabecera({ rendimientoCantidad: 1, rendimientoUnidadId: "no-existe" }, datos)).toBe("No se encontró la unidad del rendimiento.");
    expect(validarCabecera({ rendimientoCantidad: 1 }, datos)).toBe("Falta la unidad del rendimiento.");
  });
});
