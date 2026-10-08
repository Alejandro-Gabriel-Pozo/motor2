import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { guardarReceta } from "../../src/server/actions/catalogo/recetas";

type GuardarSinTipos = (...args: unknown[]) => Promise<{ ok: boolean; mensaje: string }>;

/**
 * O.1 de `docs/pureza-integracion.md` (Revisión #93 (3); autorizado por el dueño, `docs/plan-hito-4-pureza.md` §1; Hito 4, bloque C, paso H4C-23 — CAMBIA
 * COMPORTAMIENTO): el modo «a ciegas» de `guardarReceta` (sin versión esperada: un reemplazo completo sobre lo que haya, que pisaría en silencio un cambio ajeno) ya
 * NO es alcanzable desde la red. La acción pública exige `versionEsperada` entero ≥ 0: la omitida, `undefined` y `null` se rechazan con el mismo texto que una
 * versión inválida y no escriben nada. El reemplazo a ciegas quedó en `guardarRecetaACiegas` (`receta-a-ciegas.ts`, sin `"use server"`), solo para seeds, scripts
 * y tests. ROJO contra H4C-22 (la acción aceptaba los tres). Se llama a la acción SIN tipos porque desde la red llega cualquier cosa (TypeScript ya rechaza la
 * llamada sin la versión).
 */
describe("guardarReceta (la acción pública) exige la versión esperada", () => {
  let kgId: string;
  let pvId: string;
  let mpId: string;
  const MENSAJE = "La versión de la receta que se esperaba no es válida.";

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

  it("la versión omitida, undefined o null se rechaza con el texto de siempre y no escribe nada", async () => {
    const llamar = guardarReceta as unknown as GuardarSinTipos;
    const items = [{ insumoProductoId: mpId, cantidad: 0.3, unidadId: kgId }];
    expect(await llamar(pvId, items)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await llamar(pvId, items, [], {})).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await llamar(pvId, items, [], {}, undefined)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await llamar(pvId, items, [], {}, null)).toEqual({ ok: false, mensaje: MENSAJE });
    expect(await prisma.recetaVersion.count()).toBe(0);
  });

  it("con la versión esperada sigue guardando", async () => {
    expect(await guardarReceta(pvId, [{ insumoProductoId: mpId, cantidad: 0.3, unidadId: kgId }], [], {}, 0)).toMatchObject({ ok: true });
    expect(await prisma.recetaVersion.count()).toBe(1);
  });
});
