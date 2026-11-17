import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// La matriz es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/permisos/permisos", () => ({ guardarPermisos: vi.fn() }));

import { MATRICES_AYUDAS_VISIBLES } from "../../src/core/permisos/matrices-ayudas-visibles";
import { PermisosMatriz } from "../../src/app/(app)/administracion/permisos/permisos-matriz";

/**
 * Interruptor de los textos repetidos de las matrices de administración (`MATRICES_AYUDAS_VISIBLES`, `src/core/permisos/matrices-ayudas-visibles.ts`; dueño, 2026-11-16, paso 3), lado de «Permisos» en SOLO LECTURA: apagado
 * (hoy) no se dibuja la nota al pie, pero SÍ la descripción de cada acción y el botón «Editar permisos»; encendido, vuelve la nota (reversibilidad). La parte de «Capacidades por sucursal» (página de servidor) la cubre el e2e.
 */
const ACCIONES = [{ clave: "reporte_resumen", descripcion: "Ver el resumen operativo" }];
const ROLES = [{ id: "r1", nombre: "admin", clave: "admin" }];
const PERMISOS = [{ rolId: "r1", accionClave: "reporte_resumen", puedeVer: true, puedeEditar: false }];
const dibujar = (Matriz: typeof PermisosMatriz) => renderToStaticMarkup(<Matriz acciones={ACCIONES} roles={ROLES} permisosIniciales={PERMISOS} />);

describe("Permisos: nota al pie OCULTA", () => {
  it("el interruptor está apagado: sin nota al pie, con la descripción de la acción y el botón de editar", () => {
    expect(MATRICES_AYUDAS_VISIBLES).toBe(false);
    const html = dibujar(PermisosMatriz);
    expect(html).not.toContain("Tocar «Editar» también prende «Ver»");
    // La descripción de la acción queda en la vista abierta (el módulo se pliega en la lectura: `PERMISOS_PLEGADOS`, cubierto en `matrices-plegadas-interruptor.test.tsx`).
    expect(html).toContain("data-modulo-de-permisos");
    expect(html).toContain("Editar permisos");
  });
});

describe("Permisos: nota al pie ENCENDIDA (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/permisos/matrices-ayudas-visibles");
    vi.resetModules();
  });

  it("con el interruptor en true vuelve la nota", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/permisos/matrices-ayudas-visibles", () => ({ MATRICES_AYUDAS_VISIBLES: true }));
    const { PermisosMatriz: Encendida } = await import("../../src/app/(app)/administracion/permisos/permisos-matriz");
    expect(dibujar(Encendida)).toContain("Tocar «Editar» también prende «Ver»");
  });
});
