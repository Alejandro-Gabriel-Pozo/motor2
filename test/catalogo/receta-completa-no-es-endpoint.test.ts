import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as accionesDeRecetas from "../../src/server/actions/catalogo/recetas";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";

/**
 * Poda del 2026-11-06 (aprobada por el dueño): `guardarReceta`, el reemplazo completo de la receta, era una acción abierta a la red que nadie usaba desde la pantalla
 * (la pantalla guarda con las acciones de a un ingrediente o paso, que exigen la versión que vio). Pasó a solo servidor: `guardarRecetaACiegas` (`receta-a-ciegas.ts`, sin
 * `"use server"`), con `versionEsperada` opcional. Antes de la poda este archivo fijaba que la acción pública exigiera la versión; ahora fija que YA NO ES un endpoint
 * y que el reemplazo con versión sigue rechazando el guardado sobre una receta que cambió.
 */
describe("el reemplazo completo de la receta ya no es un endpoint", () => {
  let kgId: string;
  let pvId: string;
  let mpId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    for (const nombre of ["Pizza muzza", "Harina"]) {
      await darDeAltaProducto({ nombre, tipo: nombre === "Pizza muzza" ? "PV" : "MP", unidadStockId: kgId, factorConversion: 1 });
    }
    pvId = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Pizza muzza" } })).id;
    mpId = (await prisma.producto.findFirstOrThrow({ where: { nombre: "Harina" } })).id;
  });

  it("recetas.ts (\"use server\") ya no exporta guardarReceta: no hay endpoint que reemplace la receta entera", () => {
    expect("guardarReceta" in accionesDeRecetas).toBe(false);
    const fuente = readFileSync(join(__dirname, "../../src/server/actions/catalogo/recetas.ts"), "utf8");
    expect(fuente).not.toMatch(/export\s+(async\s+)?function\s+guardarReceta\b/);
    const servidor = readFileSync(join(__dirname, "../../src/server/actions/catalogo/receta-a-ciegas.ts"), "utf8");
    expect(servidor).toContain('import "server-only"');
    expect(servidor).not.toMatch(/^\s*["']use server["']/m);
  });

  it("con la versión esperada correcta guarda; con una vieja rechaza sin escribir (el reintento con la misma versión no pisa)", async () => {
    const items = [{ insumoProductoId: mpId, cantidad: 0.3, unidadId: kgId }];
    expect(await guardarRecetaACiegas(pvId, items, [], {}, 0)).toMatchObject({ ok: true });
    expect(await prisma.recetaVersion.count()).toBe(1);
    const vieja = await guardarRecetaACiegas(pvId, [{ ...items[0], cantidad: 0.5 }], [], {}, 0);
    expect(vieja.ok).toBe(false);
    expect(await prisma.recetaVersion.count()).toBe(1);
  });
});
