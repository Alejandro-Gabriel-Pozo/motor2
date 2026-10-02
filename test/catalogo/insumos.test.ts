import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { renombrarOFusionarInsumo, previsualizarFusionInsumo } from "../../src/server/actions/catalogo/insumos";

describe("renombrarOFusionarInsumo", () => {
  let unidadKgId: string;
  let unidadGId: string;
  let insumoAId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    unidadGId = catalogo.g.id;
    insumoAId = catalogo.insumo.id;

    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("renombra sin chocar con ningún insumo existente", async () => {
    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina 0000");
    expect(resultado.ok, resultado.mensaje).toBe(true);
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumoAId } })).nombre).toBe("Harina 0000");
  });

  it("previsualizarFusionInsumo devuelve null cuando el nombre no choca con nada", async () => {
    expect(await previsualizarFusionInsumo(insumoAId, "Un nombre nuevo")).toBeNull();
  });

  it("previsualizarFusionInsumo avisa con qué insumo fusionaría, sin tocar nada", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    expect(await previsualizarFusionInsumo(insumoAId, "Harina premium")).toBe("Harina premium");
    // No tocó nada: sigue existiendo el insumo A con su nombre original.
    expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumoAId } })).nombre).toBe("Harina");
    expect(await prisma.insumo.count()).toBe(2);
    void insumoB;
  });

  it("exige confirmarFusion=true antes de aplicar la fusión — sin eso, no fusiona ni borra nada", async () => {
    await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium");
    expect(resultado.ok).toBe(false);
    expect(await prisma.insumo.count()).toBe(2);
  });

  it("solo el booleano true confirma la fusión: un valor truthy que llega del navegador (\"false\", 1) no fusiona nada", async () => {
    await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    for (const falsaConfirmacion of ["false", 1, {}]) {
      const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", falsaConfirmacion as unknown as boolean);
      expect(resultado.ok).toBe(false);
    }
    expect(await prisma.insumo.count()).toBe(2);
  });

  it("con confirmarFusion=true, mueve los productos del insumo viejo y lo borra", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await darDeAltaProducto({ nombre: "Harina A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoAId });

    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
    expect(resultado.ok, resultado.mensaje).toBe(true);

    expect(await prisma.insumo.findUnique({ where: { id: insumoAId } })).toBeNull();
    const producto = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina A" } });
    expect(producto.insumoId).toBe(insumoB.id);
  });

  it("rechaza fusionar si mezclaría unidades de stock distintas bajo el mismo insumo (hallazgo de la auditoría)", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await darDeAltaProducto({ nombre: "Harina A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoAId });
    await darDeAltaProducto({ nombre: "Harina B", tipo: "MP", unidadStockId: unidadGId, factorConversion: 1, insumoId: insumoB.id });

    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
    expect(resultado.ok).toBe(false);

    // No se movió nada ni se borró el insumo viejo.
    expect(await prisma.insumo.findUnique({ where: { id: insumoAId } })).not.toBeNull();
    const productoA = await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina A" } });
    expect(productoA.insumoId).toBe(insumoAId);
  });

  it("permite fusionar cuando ambos insumos comparten la misma unidad de stock", async () => {
    const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
    await darDeAltaProducto({ nombre: "Harina A", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoAId });
    await darDeAltaProducto({ nombre: "Harina B", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1, insumoId: insumoB.id });

    const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
    expect(resultado.ok, resultado.mensaje).toBe(true);
  });

  /**
   * D9 (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 7): fusionar un Insumo usado como sustituto en alguna receta
   * tiene que arrastrar esos sustitutos, no fallar por la FK RESTRICT de SustitutoRecetaIngrediente.insumoSustitutoId.
   */
  describe("D9: la fusión arrastra los sustitutos de receta", () => {
    let pvId: string;
    let mpPrincipalId: string;
    let insumoBId: string;

    beforeEach(async () => {
      const insumoB = await prisma.insumo.create({ data: { nombre: "Harina premium" } });
      insumoBId = insumoB.id;
      const mpPrincipal = await darDeAltaProducto({ nombre: "Manteca", tipo: "MP", unidadStockId: unidadKgId, factorConversion: 1 });
      mpPrincipalId = mpPrincipal.ok ? mpPrincipal.id : "";
      const pv = await darDeAltaProducto({ nombre: "Medialuna", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
      pvId = pv.ok ? pv.id : "";
    });

    it("la fusión reapunta el sustituto del Insumo viejo al nuevo", async () => {
      await prisma.recetaVersion.create({
        data: {
          productoId: pvId,
          version: 1,
          ingredientes: { create: [{ insumoProductoId: mpPrincipalId, cantidad: 0.1, unidadId: unidadKgId, sustitutos: { create: [{ insumoSustitutoId: insumoAId, orden: 1 }] } }] },
        },
      });

      const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const ingrediente = await prisma.recetaIngrediente.findFirstOrThrow({ where: { insumoProductoId: mpPrincipalId }, include: { sustitutos: true } });
      expect(ingrediente.sustitutos.map((s) => [s.insumoSustitutoId, s.orden])).toEqual([[insumoBId, 1]]);
    });

    it("el duplicado se colapsa: si la línea ya tenía al insumo destino como sustituto, se queda con uno solo", async () => {
      await prisma.recetaVersion.create({
        data: {
          productoId: pvId,
          version: 1,
          ingredientes: {
            create: [
              {
                insumoProductoId: mpPrincipalId,
                cantidad: 0.1,
                unidadId: unidadKgId,
                sustitutos: { create: [{ insumoSustitutoId: insumoAId, orden: 1 }, { insumoSustitutoId: insumoBId, orden: 2 }] },
              },
            ],
          },
        },
      });

      const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const ingrediente = await prisma.recetaIngrediente.findFirstOrThrow({ where: { insumoProductoId: mpPrincipalId }, include: { sustitutos: true } });
      expect(ingrediente.sustitutos.map((s) => s.insumoSustitutoId)).toEqual([insumoBId]);
      // Renumerado sin huecos (D9): quedaba en orden 2, pasa a 1 al colapsar el duplicado.
      expect(ingrediente.sustitutos.map((s) => s.orden)).toEqual([1]);
    });

    it("el redundante con el principal se borra: si el destino de la fusión es el propio Insumo del ingrediente, el sustituto desaparece", async () => {
      // La MP principal de la receta ahora pertenece al Insumo B (destino de la próxima fusión).
      await prisma.producto.update({ where: { id: mpPrincipalId }, data: { insumoId: insumoBId } });
      await prisma.recetaVersion.create({
        data: {
          productoId: pvId,
          version: 1,
          ingredientes: { create: [{ insumoProductoId: mpPrincipalId, cantidad: 0.1, unidadId: unidadKgId, sustitutos: { create: [{ insumoSustitutoId: insumoAId, orden: 1 }] } }] },
        },
      });

      const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
      expect(resultado.ok, resultado.mensaje).toBe(true);

      const ingrediente = await prisma.recetaIngrediente.findFirstOrThrow({ where: { insumoProductoId: mpPrincipalId }, include: { sustitutos: true } });
      expect(ingrediente.sustitutos).toEqual([]);
    });

    it("la fusión ya no falla por la FK cuando el Insumo fusionado es sustituto en dos líneas de receta distintas", async () => {
      const pv2 = await darDeAltaProducto({ nombre: "Facturita", tipo: "PV", unidadStockId: unidadKgId, factorConversion: 1 });
      const pv2Id = pv2.ok ? pv2.id : "";
      await prisma.recetaVersion.create({
        data: {
          productoId: pvId,
          version: 1,
          ingredientes: { create: [{ insumoProductoId: mpPrincipalId, cantidad: 0.1, unidadId: unidadKgId, sustitutos: { create: [{ insumoSustitutoId: insumoAId, orden: 1 }] } }] },
        },
      });
      await prisma.recetaVersion.create({
        data: {
          productoId: pv2Id,
          version: 1,
          ingredientes: { create: [{ insumoProductoId: mpPrincipalId, cantidad: 0.2, unidadId: unidadKgId, sustitutos: { create: [{ insumoSustitutoId: insumoAId, orden: 1 }] } }] },
        },
      });

      const resultado = await renombrarOFusionarInsumo(insumoAId, "Harina premium", true);
      expect(resultado.ok, resultado.mensaje).toBe(true);
      expect(await prisma.insumo.findUnique({ where: { id: insumoAId } })).toBeNull();
      const sustitutos = await prisma.sustitutoRecetaIngrediente.findMany({});
      expect(sustitutos.every((s) => s.insumoSustitutoId === insumoBId)).toBe(true);
      expect(sustitutos).toHaveLength(2);
    });
  });
});
