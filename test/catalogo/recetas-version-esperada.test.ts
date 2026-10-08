import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { agregarIngredienteAReceta, guardarReceta } from "../../src/server/actions/catalogo/recetas";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { versionVigenteDeReceta } from "../setup/version-de-receta";
import { agregarIngredienteARecetaPropia, crearRecetaPropiaDesdeLaCentral, volverALaRecetaCentral } from "../../src/server/actions/catalogo/receta-sucursal";

/**
 * H7 (Pureza Fase 4, decisión del dueño 2026-10-06: «rechazar con mensaje»): una edición de la receta que se armó leyendo la versión N NO puede pisar a otro que guardó N+1 en el medio.
 * Antes el caso de uso calculaba `version = MAX + 1` sobre lo que hubiera, así que el segundo guardado ganaba EN SILENCIO y el cambio del primero se perdía. Ahora quien lee y modifica manda
 * `versionEsperada` y, si la receta ya va por otra, el guardado se rechaza con un mensaje y no escribe nada.
 */
describe("guardar la receta con versión esperada (H7)", () => {
  let kgId: string;
  let pvId: string;
  let mp1Id: string;
  let mp2Id: string;
  let mp3Id: string;
  const linea = (insumoProductoId: string, cantidad = 0.3) => ({ insumoProductoId, cantidad, unidadId: kgId });
  const versiones = (sucursalId: string | null = null) => prisma.recetaVersion.findMany({ where: { productoId: pvId, sucursalId }, orderBy: { version: "asc" }, include: { ingredientes: true } });
  const ingredientesDeLaUltima = async (sucursalId: string | null = null) => ((await versiones(sucursalId)).at(-1)?.ingredientes ?? []).map((i) => i.insumoProductoId).sort();

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    for (const nombre of ["Pizza muzza", "Harina", "Muzzarella", "Tomate"]) {
      await darDeAltaProducto({ nombre, tipo: nombre === "Pizza muzza" ? "PV" : "MP", unidadStockId: kgId, factorConversion: 1 });
    }
    const id = async (nombre: string) => (await prisma.producto.findFirstOrThrow({ where: { nombre } })).id;
    pvId = await id("Pizza muzza");
    mp1Id = await id("Harina");
    mp2Id = await id("Muzzarella");
    mp3Id = await id("Tomate");
  });

  it("un guardado armado sobre una versión que ya cambió se rechaza con un mensaje y no escribe nada", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true); // v1, sobre «todavía no hay receta»
    expect((await guardarReceta(pvId, [linea(mp1Id), linea(mp2Id)], [], {}, 1)).ok).toBe(true); // v2, sobre v1

    // Otro editor, que había leído la v1 y recién ahora guarda:
    const tarde = await guardarReceta(pvId, [linea(mp1Id), linea(mp3Id)], [], {}, 1);
    expect(tarde.ok).toBe(false);
    expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas.*versión 2.*partiste de la 1.*Recargá/);
    expect((await versiones()).map((v) => v.version)).toEqual([1, 2]); // nada nuevo
    expect(await ingredientesDeLaUltima()).toEqual([mp1Id, mp2Id].sort()); // el cambio del primero NO se perdió
  });

  it("«todavía no hay receta» (0) también se compara: si alguien creó la primera versión, se rechaza", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
    const otraPrimera = await guardarReceta(pvId, [linea(mp2Id)], [], {}, 0);
    expect(otraPrimera.ok).toBe(false);
    expect((await versiones()).map((v) => v.version)).toEqual([1]);
  });

  it("sin versión esperada es un reemplazo completo a ciegas (seeds y scripts): guarda sobre lo que haya", async () => {
    // O.1 (H4C-23): el reemplazo a ciegas ya no es la acción pública sin versión, es la función interna `guardarRecetaACiegas`.
    expect((await guardarRecetaACiegas(pvId, [linea(mp1Id)])).ok).toBe(true);
    expect((await guardarRecetaACiegas(pvId, [linea(mp2Id)])).ok).toBe(true);
    expect((await versiones()).map((v) => v.version)).toEqual([1, 2]);
  });

  it("una versión esperada que no es un entero ≥ 0 se rechaza antes de tocar nada", async () => {
    for (const mala of [-1, 1.5, Number.NaN, "2" as unknown as number]) {
      const r = await guardarReceta(pvId, [linea(mp1Id)], [], {}, mala);
      expect(r.ok, String(mala)).toBe(false);
    }
    expect(await versiones()).toHaveLength(0);
  });

  it("dos guardados simultáneos armados sobre la MISMA versión: gana uno solo y el otro recibe el mensaje (sin importar el orden)", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
    for (let i = 0; i < 6; i++) {
      const esperada = (await versiones()).length;
      const [a, b] = await Promise.all([
        guardarReceta(pvId, [linea(mp1Id), linea(mp2Id, 0.1 + i)], [], {}, esperada),
        guardarReceta(pvId, [linea(mp1Id), linea(mp3Id, 0.1 + i)], [], {}, esperada),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `vuelta ${i}: exactamente uno tiene que ganar`).toHaveLength(1);
      const perdedor = a.ok ? b : a;
      expect(!perdedor.ok && perdedor.mensaje, `vuelta ${i}`).toMatch(/cambió mientras la editabas/);
      expect((await versiones()).map((v) => v.version), `vuelta ${i}: una versión nueva, sin huecos`).toEqual(Array.from({ length: esperada + 1 }, (_, k) => k + 1));
    }
  });

  describe("las acciones puntuales piden la versión que la PANTALLA mostraba (`versionVista`)", () => {
    it("una pantalla vieja no pisa lo que otra persona ya guardó: se rechaza con el mensaje y la receta queda como la dejó la otra", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true); // v1
      const vistaPorAmbos = await versionVigenteDeReceta(pvId); // las dos personas abren el editor en la v1

      expect((await agregarIngredienteAReceta(pvId, linea(mp2Id), vistaPorAmbos)).ok).toBe(true); // la primera guarda: v2
      const tarde = await agregarIngredienteAReceta(pvId, linea(mp3Id), vistaPorAmbos); // la segunda, con su pantalla vieja
      expect(tarde.ok).toBe(false);
      expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas.*versión 2.*partiste de la 1/);
      expect((await versiones()).map((v) => v.version)).toEqual([1, 2]);
      expect(await ingredientesDeLaUltima()).toEqual([mp1Id, mp2Id].sort());

      // Con la pantalla recargada (v2) el mismo cambio sí entra, y suma al de la otra persona.
      expect((await agregarIngredienteAReceta(pvId, linea(mp3Id), await versionVigenteDeReceta(pvId))).ok).toBe(true);
      expect(await ingredientesDeLaUltima()).toEqual([mp1Id, mp2Id, mp3Id].sort());
    });

    it("dos pantallas que guardan A LA VEZ sobre la misma versión: gana una y la otra recibe el mensaje; nunca se pierde un cambio", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
      const vista = await versionVigenteDeReceta(pvId);
      const [a, b] = await Promise.all([agregarIngredienteAReceta(pvId, linea(mp2Id), vista), agregarIngredienteAReceta(pvId, linea(mp3Id), vista)]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const perdedor = a.ok ? b : a;
      expect(!perdedor.ok && perdedor.mensaje).toMatch(/cambió mientras la editabas/);
      expect(await ingredientesDeLaUltima()).toEqual([mp1Id, a.ok ? mp2Id : mp3Id].sort());
    });

    it("la receta PROPIA de la sucursal también: una pantalla vieja de la serie propia se rechaza", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
      expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0)).ok).toBe(true); // propia v1 (la sucursal no tenía serie propia: la pantalla mostraba 0)
      const sucursalId = (await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pvId, sucursalId: { not: null } } })).sucursalId;
      const vista = await versionVigenteDeReceta(pvId, sucursalId); // las dos pantallas abren la propia en la v1

      expect((await agregarIngredienteARecetaPropia(pvId, linea(mp2Id), vista)).ok).toBe(true);
      const tarde = await agregarIngredienteARecetaPropia(pvId, linea(mp3Id), vista);
      expect(tarde.ok).toBe(false);
      expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas/);
      expect(await ingredientesDeLaUltima(sucursalId)).toEqual([mp1Id, mp2Id].sort());
      expect(await versiones(null), "la central no se tocó").toHaveLength(1);
    });

    it("crear la receta propia con una pantalla que ya no es la vigente también se rechaza (alguien la creó antes)", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
      expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0)).ok).toBe(true);
      await volverALaRecetaCentral(pvId, true); // la propia queda en el historial, deshabilitada
      const tarde = await crearRecetaPropiaDesdeLaCentral(pvId, 0); // pantalla que no sabía de esa serie
      expect(tarde.ok).toBe(false);
      expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas/);
    });
  });
});
