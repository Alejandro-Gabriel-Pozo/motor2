import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { agregarIngredienteAReceta, guardarReceta } from "../../src/server/actions/catalogo/recetas";
import { agregarIngredienteARecetaPropia, crearRecetaPropiaDesdeLaCentral } from "../../src/server/actions/catalogo/receta-sucursal";

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
    expect((await guardarReceta(pvId, [linea(mp1Id)])).ok).toBe(true);
    expect((await guardarReceta(pvId, [linea(mp2Id)])).ok).toBe(true);
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

  it("agregar un ingrediente desde dos pantallas a la vez nunca pierde un cambio: todo guardado que dijo «ok» está en la última versión", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
    const [a, b] = await Promise.all([agregarIngredienteAReceta(pvId, linea(mp2Id)), agregarIngredienteAReceta(pvId, linea(mp3Id))]);
    expect(a.ok || b.ok, "al menos uno guarda").toBe(true);
    const ultima = await ingredientesDeLaUltima();
    if (a.ok) expect(ultima, "el cambio de A").toContain(mp2Id);
    if (b.ok) expect(ultima, "el cambio de B").toContain(mp3Id);
    for (const r of [a, b]) if (!r.ok) expect(r.mensaje).toMatch(/cambió mientras la editabas/);
  });

  it("la receta PROPIA de la sucursal también: el guardado armado sobre una versión vieja de la serie propia se rechaza", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
    expect((await crearRecetaPropiaDesdeLaCentral(pvId)).ok).toBe(true); // propia v1
    const sucursalId = (await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pvId, sucursalId: { not: null } } })).sucursalId;
    const [a, b] = await Promise.all([agregarIngredienteARecetaPropia(pvId, linea(mp2Id)), agregarIngredienteARecetaPropia(pvId, linea(mp3Id))]);
    expect(a.ok || b.ok).toBe(true);
    const ultima = await ingredientesDeLaUltima(sucursalId);
    if (a.ok) expect(ultima).toContain(mp2Id);
    if (b.ok) expect(ultima).toContain(mp3Id);
    for (const r of [a, b]) if (!r.ok) expect(r.mensaje).toMatch(/cambió mientras la editabas/);
    expect(await versiones(null), "la central no se tocó").toHaveLength(1);
  });
});
