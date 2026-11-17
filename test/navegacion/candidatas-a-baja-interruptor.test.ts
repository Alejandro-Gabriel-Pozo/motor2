import { afterEach, describe, expect, it, vi } from "vitest";
import { RUTAS_CANDIDATAS_A_BAJA, rutaOfrecida } from "@/core/navegacion/candidatas-a-baja";

/**
 * El interruptor de las seis pantallas candidatas a baja (Frente 6, paso 4): con `false` no se ofrecen en el menú ni en las pestañas;
 * con `true` vuelven. Nada se borra: las rutas siguen resolviendo su permiso (RUTAS_FUERA_DEL_MENU).
 */
const BUSCADAS = ["/movimientos/precio-local", "/catalogo/opciones/limpiar", "/movimientos/venta", "/catalogo/proveedores/comparativa", "/carta/parametrizacion/generos", "/carta/agrupados"];

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/core/navegacion/candidatas-a-baja");
});

describe("rutaOfrecida", () => {
  it("declara exactamente las seis candidatas", () => {
    expect([...RUTAS_CANDIDATAS_A_BAJA].sort()).toEqual([...BUSCADAS].sort());
  });
  it("apagado: oculta las seis y deja pasar cualquier otra", () => {
    for (const r of BUSCADAS) expect(rutaOfrecida(r, false)).toBe(false);
    expect(rutaOfrecida("/catalogo/productos", false)).toBe(true);
    expect(rutaOfrecida("/carta/parametrizacion/secciones", false)).toBe(true);
  });
  it("prendido: ofrece las seis", () => {
    for (const r of BUSCADAS) expect(rutaOfrecida(r, true)).toBe(true);
  });
  it("hoy está apagado", () => {
    for (const r of BUSCADAS) expect(rutaOfrecida(r)).toBe(false);
  });
});

async function menuConInterruptor(visibles: boolean) {
  vi.resetModules();
  vi.doMock("@/core/navegacion/candidatas-a-baja", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/core/navegacion/candidatas-a-baja")>();
    return { ...real, CANDIDATAS_A_BAJA_VISIBLES: visibles, rutaOfrecida: (href: string) => real.rutaOfrecida(href, visibles) };
  });
  return import("@/core/navegacion/estructura");
}

describe("menú y rutas fuera del menú", () => {
  it("apagado: «Carga de ventas sin ticket» no es ítem del menú pero su ruta sigue resolviendo la acción", async () => {
    const e = await menuConInterruptor(false);
    const enMenu = e.GRUPOS_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(enMenu).not.toContain("/movimientos/venta");
    expect(e.RUTAS_FUERA_DEL_MENU.map((i) => i.href)).toContain("/movimientos/venta");
  });
  it("prendido: vuelve al menú y no se duplica fuera de él", async () => {
    const e = await menuConInterruptor(true);
    const enMenu = e.GRUPOS_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(enMenu).toContain("/movimientos/venta");
    expect(e.RUTAS_FUERA_DEL_MENU.map((i) => i.href)).not.toContain("/movimientos/venta");
  });
});
