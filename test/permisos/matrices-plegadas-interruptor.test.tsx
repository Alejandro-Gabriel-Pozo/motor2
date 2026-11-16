import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";

// «Permisos» es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. «Capacidades» es una página de servidor: se llama con sus dependencias simuladas. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("../../src/server/actions/permisos/permisos", () => ({ guardarPermisos: vi.fn() }));
vi.mock("../../src/server/sesion/contexto", () => ({ obtenerContextoUsuario: async () => ({ usuarioId: "u", empresaId: "e", sucursalId: "s", db: {} }) }));
vi.mock("../../src/server/sesion/ir-al-login", () => ({ irAlLogin: () => null }));
vi.mock("../../src/server/actions/limitador-de-lecturas", () => ({ MENSAJE_DEMASIADAS_LECTURAS: "demasiadas", lecturaSinCupo: () => false }));
vi.mock("../../src/server/acceso/gate", () => ({ requierePermisoVerDeEmpresa: async () => ({ ok: true }) }));
vi.mock("../../src/server/actions/permisos/capacidades-sucursal", () => ({
  actualizarCapacidad: vi.fn(),
  listarCapacidades: async () => ({
    acciones: ACCIONES.slice(0, 40).map((a) => ({ clave: a.clave })),
    sucursales: [{ id: "s1", nombre: "Centro" }],
    capacidades: [],
  }),
}));

/**
 * Interruptores de las vistas plegadas de «Permisos» y «Capacidades por sucursal» (`PERMISOS_PLEGADOS` y `CAPACIDADES_PLEGADAS`, `src/core/permisos/matrices-plegadas.ts`; dueño, 2026-11-16, paso 3), los DOS estados de cada una.
 * Permisos: plegado (hoy) la lectura muestra un renglón por módulo y ninguna acción hasta abrirlo, y la edición las muestra todas; apagado, la tabla de siempre sin renglones de módulo.
 * Capacidades: plegado (hoy) un `<details>` por módulo, cerrado; apagado, una sola tabla con todas las acciones.
 */
const MODULOS_DE_ACCIONES = [...new Set(ACCIONES.slice(0, 40).map((a) => a.modulo))];
const PRIMERA = ACCIONES[0];
const ACCIONES_P = [{ clave: PRIMERA.clave, descripcion: "Ver el resumen operativo" }];
const ROLES = [{ id: "r1", nombre: "admin", clave: "admin" }];
const PERMISOS = [{ rolId: "r1", accionClave: PRIMERA.clave, puedeVer: true, puedeEditar: false }];

afterEach(() => {
  vi.doUnmock("../../src/core/permisos/matrices-plegadas");
  vi.resetModules();
});

async function cargar(plegadas: boolean) {
  vi.resetModules();
  vi.doMock("../../src/core/permisos/matrices-plegadas", () => ({ PERMISOS_PLEGADOS: plegadas, CAPACIDADES_PLEGADAS: plegadas }));
  const { PermisosMatriz } = await import("../../src/app/(app)/administracion/permisos/permisos-matriz");
  const pagina = (await import("../../src/app/(app)/administracion/capacidades-sucursal/page")).default;
  return { PermisosMatriz, pagina };
}

describe("hoy los dos interruptores están prendidos", () => {
  it("PERMISOS_PLEGADOS y CAPACIDADES_PLEGADAS son true", async () => {
    const real = await import("../../src/core/permisos/matrices-plegadas");
    expect(real.PERMISOS_PLEGADOS).toBe(true);
    expect(real.CAPACIDADES_PLEGADAS).toBe(true);
  });
});

describe("Permisos", () => {
  it("plegado: un renglón por módulo, ninguna acción a la vista y el módulo con su cantidad", async () => {
    const { PermisosMatriz } = await cargar(true);
    const html = renderToStaticMarkup(<PermisosMatriz acciones={ACCIONES_P} roles={ROLES} permisosIniciales={PERMISOS} />);
    expect(html).toContain(`data-modulo-de-permisos="${PRIMERA.modulo}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("· 1");
    expect(html).not.toContain("Ver el resumen operativo");
    expect(html).toContain("Editar permisos");
  });

  it("apagado: la tabla de siempre, sin renglones de módulo y con la acción a la vista", async () => {
    const { PermisosMatriz } = await cargar(false);
    const html = renderToStaticMarkup(<PermisosMatriz acciones={ACCIONES_P} roles={ROLES} permisosIniciales={PERMISOS} />);
    expect(html).not.toContain("data-modulo-de-permisos");
    expect(html).toContain("Ver el resumen operativo");
  });
});

describe("Capacidades por sucursal", () => {
  it("plegado: un bloque cerrado por módulo, cada uno con su tabla", async () => {
    const { pagina } = await cargar(true);
    const html = renderToStaticMarkup(await pagina());
    for (const m of MODULOS_DE_ACCIONES) expect(html, m).toContain(`data-modulo-de-capacidades="${m}"`);
    expect(html.match(/<details/g)?.length).toBe(MODULOS_DE_ACCIONES.length);
    expect(html).not.toContain("<details open");
    expect(html.match(/<table/g)?.length).toBe(MODULOS_DE_ACCIONES.length);
  });

  it("apagado: una sola tabla con todas las acciones y sin bloques plegables", async () => {
    const { pagina } = await cargar(false);
    const html = renderToStaticMarkup(await pagina());
    expect(html).not.toContain("<details");
    expect(html.match(/<table/g)?.length).toBe(1);
    expect(html.match(/<tr/g)?.length).toBe(1 + 40);
  });
});
