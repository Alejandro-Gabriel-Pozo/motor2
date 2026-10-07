import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { versionVigenteDeReceta } from "../setup/version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { guardarReceta, agregarPasoAReceta, actualizarIngredienteDeReceta, quitarIngredienteDeReceta, actualizarCabeceraDeReceta, obtenerRecetaVigente, listarVersionesDeReceta } from "../../src/server/actions/catalogo/recetas";

/**
 * Sustitutos por línea de ingrediente (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 6): se crean con su orden, viajan
 * en la ida y vuelta append-only de guardarReceta (§0.6/D1 — el riesgo principal de la parte de catálogo), y las validaciones D2/D8.
 */
describe("recetas: sustitutos por línea de ingrediente", () => {
  let sucursalId: string;
  let kgId: string;
  let gId: string;
  let pvId: string;
  let bifeId: string; // MP principal
  let vacioId: string; // MP sustituto (también usada como ingrediente directo en algunos casos)
  let insumoBifeId: string;
  let insumoOjoId: string;
  let insumoVacioId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const insumoBife = await prisma.insumo.create({ data: { nombre: "Bife de chorizo" } });
    const insumoOjo = await prisma.insumo.create({ data: { nombre: "Ojo de bife" } });
    const insumoVacio = await prisma.insumo.create({ data: { nombre: "Vacío" } });
    insumoBifeId = insumoBife.id;
    insumoOjoId = insumoOjo.id;
    insumoVacioId = insumoVacio.id;

    bifeId = (await sembrarProductoDisponible({ codigo: "MP_BIFE", nombre: "Bife de chorizo", tipo: "MP", unidadStockId: kgId, insumoId: insumoBifeId }, sucursalId)).id;
    await sembrarProductoDisponible({ codigo: "MP_OJO", nombre: "Ojo de bife", tipo: "MP", unidadStockId: kgId, insumoId: insumoOjoId }, sucursalId);
    vacioId = (await sembrarProductoDisponible({ codigo: "MP_VACIO", nombre: "Vacío", tipo: "MP", unidadStockId: kgId, insumoId: insumoVacioId }, sucursalId)).id;
    pvId = (await sembrarProductoDisponible({ codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: kgId, precioVenta: 5000 }, sucursalId)).id;
  });

  it("se crean con su orden", async () => {
    const r = await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId, insumoVacioId] }]);
    expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);

    const vigente = await obtenerRecetaVigente(pvId);
    const ing = vigente!.ingredientes[0];
    expect(ing.sustitutos.map((s) => [s.insumoSustitutoId, s.orden])).toEqual([
      [insumoOjoId, 1],
      [insumoVacioId, 2],
    ]);
  });

  it("regresión de ida y vuelta: agregar un paso, editar la ficha, editar/quitar OTRO ingrediente y reordenar pasos conservan los sustitutos", async () => {
    await guardarReceta(pvId, [
      { insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId, insumoVacioId] },
      { insumoProductoId: vacioId, cantidad: 0.1, unidadId: kgId },
    ]);
    const sustitutosDeBife = async () => {
      const vigente = await obtenerRecetaVigente(pvId);
      return vigente!.ingredientes.find((i) => i.insumoProductoId === bifeId)!.sustitutos.map((s) => s.insumoSustitutoId);
    };
    expect(await sustitutosDeBife()).toEqual([insumoOjoId, insumoVacioId]);

    // Agregar un paso nuevo (no toca ingredientes).
    await agregarPasoAReceta(pvId, { orden: 1, instruccion: "Sellar a fuego fuerte." }, await versionVigenteDeReceta(pvId));
    expect(await sustitutosDeBife()).toEqual([insumoOjoId, insumoVacioId]);

    // Editar la cabecera/ficha (no toca ingredientes).
    await actualizarCabeceraDeReceta(pvId, { comentarios: "Servir caliente." }, await versionVigenteDeReceta(pvId));
    expect(await sustitutosDeBife()).toEqual([insumoOjoId, insumoVacioId]);

    // Editar OTRO ingrediente (Vacío, sin sustitutos) — Bife no se toca.
    await actualizarIngredienteDeReceta(pvId, vacioId, { cantidad: 0.15, unidadId: kgId }, await versionVigenteDeReceta(pvId));
    expect(await sustitutosDeBife()).toEqual([insumoOjoId, insumoVacioId]);

    // Quitar el OTRO ingrediente.
    await quitarIngredienteDeReceta(pvId, vacioId, await versionVigenteDeReceta(pvId));
    expect(await sustitutosDeBife()).toEqual([insumoOjoId, insumoVacioId]);

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente?.version).toBe(5);
  });

  it("la versión vieja conserva los suyos aunque una versión nueva cambie los sustitutos", async () => {
    await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId] }]);
    await actualizarIngredienteDeReceta(pvId, bifeId, { cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoVacioId] }, await versionVigenteDeReceta(pvId));

    const versiones = await listarVersionesDeReceta(pvId);
    const v1 = versiones.find((v) => v.version === 1)!;
    const v2 = versiones.find((v) => v.version === 2)!;
    expect(v1.ingredientes[0].sustitutos.map((s) => s.insumoSustitutoId)).toEqual([insumoOjoId]);
    expect(v2.ingredientes[0].sustitutos.map((s) => s.insumoSustitutoId)).toEqual([insumoVacioId]);
  });

  it("quitar el ingrediente se lleva sus sustitutos (cascade) en la versión nueva", async () => {
    await guardarReceta(pvId, [
      { insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId] },
      { insumoProductoId: vacioId, cantidad: 0.1, unidadId: kgId },
    ]);
    await quitarIngredienteDeReceta(pvId, bifeId, await versionVigenteDeReceta(pvId));

    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente!.ingredientes.map((i) => i.insumoProductoId)).toEqual([vacioId]);
  });

  it("D2: rechaza declarar sustitutos en la receta de un producto que se produce", async () => {
    const salsaSeProduce = await sembrarProductoDisponible({ codigo: "MP_SALSA", nombre: "Salsa base", tipo: "MP", unidadStockId: kgId, seProduce: true }, sucursalId);
    const r = await guardarReceta(salsaSeProduce.id, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId] }]);
    expect(r).toEqual({ ok: false, mensaje: "La sustitución automática solo aplica a platos que se descuentan al vender (no a recetas que se producen)." });
  });

  it("D8: rechaza un sustituto duplicado en la misma línea", async () => {
    const r = await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId, insumoOjoId] }]);
    expect(r).toEqual({ ok: false, mensaje: "Un ingrediente no puede tener el mismo sustituto declarado dos veces." });
  });

  it("D8: rechaza que el sustituto sea el mismo Insumo que el ingrediente principal", async () => {
    const otroBife = await sembrarProductoDisponible({ codigo: "MP_BIFE_2", nombre: "Bife de chorizo (otro corte)", tipo: "MP", unidadStockId: kgId, insumoId: insumoBifeId }, sucursalId);
    const r = await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoBifeId] }]);
    expect(r).toEqual({ ok: false, mensaje: "Un sustituto no puede ser el mismo Insumo que el ingrediente principal." });
    void otroBife;
  });

  it("D8: rechaza un Insumo sustituto inexistente", async () => {
    const r = await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: ["insumo-inexistente"] }]);
    expect(r).toEqual({ ok: false, mensaje: "No se encontró uno de los insumos sustitutos." });
  });

  it("D8: rechaza un Insumo sustituto inactivo", async () => {
    await prisma.insumo.update({ where: { id: insumoOjoId }, data: { activo: false } });
    const r = await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId] }]);
    expect(r).toEqual({ ok: false, mensaje: 'El insumo sustituto "Ojo de bife" está inactivo.' });
  });

  it("D8: rechaza un sustituto con una MP de otra unidad de stock", async () => {
    const ojoEnGramos = await sembrarProductoDisponible({ codigo: "MP_OJO_G", nombre: "Ojo de bife (fraccionado)", tipo: "MP", unidadStockId: gId, insumoId: insumoOjoId }, sucursalId);
    const r = await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId] }]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.mensaje).toContain("otra unidad de stock");
    void ojoEnGramos;
  });

  it("mutación: sacar la copia de insumoSustitutoIds en mapIngredientesAInput hace caer la regresión de ida y vuelta", async () => {
    // Demostración documentada (no aplicada): si mapIngredientesAInput dejara de copiar insumoSustitutoIds, cualquier acción
    // puntual que relea la receta vigente (agregarPasoAReceta, actualizarCabeceraDeReceta, actualizarIngredienteDeReceta de OTRO
    // ingrediente, quitarIngredienteDeReceta de OTRO ingrediente) perdería los sustitutos de Bife en la próxima versión — el test
    // "regresión de ida y vuelta" de arriba lo detecta en rojo.
    await guardarReceta(pvId, [{ insumoProductoId: bifeId, cantidad: 0.2, unidadId: kgId, insumoSustitutoIds: [insumoOjoId] }]);
    await actualizarCabeceraDeReceta(pvId, { comentarios: "x" }, await versionVigenteDeReceta(pvId));
    const vigente = await obtenerRecetaVigente(pvId);
    expect(vigente!.ingredientes[0].sustitutos).toHaveLength(1);
  });
});
