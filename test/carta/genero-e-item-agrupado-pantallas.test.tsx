import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// El interruptor APAGADO, como en producción (el setup global lo enciende; este archivo lo apaga a propósito).
vi.mock("../../src/core/carta/genero-e-item-agrupado", async (original) => ({ ...(await original<typeof import("../../src/core/carta/genero-e-item-agrupado")>()), GENERO_E_ITEM_AGRUPADO_VISIBLE: false }));

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { GRUPOS_NAV, RUTAS_DE_UNA_ENTRADA } from "../../src/core/navegacion/estructura";
import { PESTANAS_DE_CARTA } from "../../src/core/carta/ui-config";
import { CLAVES_DE_PERMISO_DE_GENERO_Y_AGRUPADO, claveOcultaDeLaMatriz } from "../../src/core/carta/genero-e-item-agrupado";
import { listarMatrizPermisos } from "../../src/server/actions/permisos/permisos";
import { estadoDelProductoEnLaCarta } from "../../src/server/consultas/carta/admin";
import { resumirParametrizacionDeCarta } from "../../src/server/consultas/carta/mantenimiento";
import ItemsAgrupadosPage from "../../src/app/(app)/carta/agrupados/page";
import GenerosDeCartaPage from "../../src/app/(app)/carta/parametrizacion/generos/page";
import { sembrarCartaConGeneros } from "./genero-e-item-agrupado.semilla";

/**
 * Etapa 2 de la poda de género e ítem agrupado (decisión del dueño 2026-11-06): las pantallas, el menú y la matriz de permisos. Apagado (valor de producción): las dos pantallas responden «no existe»
 * antes de leer la sesión, el menú y las pestañas de Carta no las nombran, las claves `carta_generos` y `carta_items_agrupados` no se ofrecen en la matriz (siguen en el catálogo y en la base) y las
 * consultas de administración no cuentan ni muestran géneros ni agrupados. Encendido (reversibilidad): vuelve todo lo de antes. Reglas: `docs/oraculo-combinaciones-poda-genero-agrupado-2026-11-06.md`.
 */
const HREFS_OCULTOS = ["/carta/agrupados", "/carta/parametrizacion/generos"];
const esNoExiste = (e: unknown) => typeof (e as { digest?: unknown })?.digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404");
const hrefsDeCarta = (pestanas: typeof PESTANAS_DE_CARTA) => pestanas.flatMap((p) => p.pantallas.map((x) => x.href));

describe("pantallas, menú y matriz con género e ítem agrupado APAGADOS", () => {
  let s: Awaited<ReturnType<typeof sembrarCartaConGeneros>>;
  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarCartaConGeneros(true);
    await mockearUsuarioActual({ id: s.admin.id, email: s.admin.email, nombre: null });
  });

  it("las dos pantallas responden «no existe» (404) para todos, antes de leer la sesión", async () => {
    const { getUsuarioActual } = await import("../../src/server/sesion/session");
    vi.mocked(getUsuarioActual).mockClear();
    for (const pagina of [ItemsAgrupadosPage, GenerosDeCartaPage]) {
      const error = await pagina().then(
        () => null,
        (e: unknown) => e,
      );
      expect(esNoExiste(error)).toBe(true);
    }
    expect(getUsuarioActual).not.toHaveBeenCalled();
  });

  it("el menú y las pestañas de Carta no nombran las pantallas ocultas", () => {
    expect(hrefsDeCarta(PESTANAS_DE_CARTA)).toEqual(["/carta", "/movimientos/opciones-agotadas", "/carta/parametrizacion/secciones"]);
    expect(PESTANAS_DE_CARTA.map((p) => p.texto)).toEqual(["Hoy", "Secciones"]);
    const todos = [...GRUPOS_NAV.flatMap((g) => g.items.map((i) => i.href)), ...RUTAS_DE_UNA_ENTRADA.map((r) => r.href)];
    for (const h of HREFS_OCULTOS) expect(todos).not.toContain(h);
  });

  it("la matriz de permisos no ofrece las dos claves, pero siguen en la base y las demás de carta se ofrecen", async () => {
    const { acciones } = await listarMatrizPermisos();
    const claves = acciones.map((a) => a.clave);
    for (const c of CLAVES_DE_PERMISO_DE_GENERO_Y_AGRUPADO) {
      expect(claves).not.toContain(c);
      expect(await prisma.accion.count({ where: { clave: c } })).toBe(1);
    }
    expect(claves).toContain("carta_ver");
    expect(claveOcultaDeLaMatriz("carta_generos", false)).toBe(true);
    expect(claveOcultaDeLaMatriz("carta_ver", false)).toBe(false);
    expect(claveOcultaDeLaMatriz("carta_generos", true)).toBe(false);
  });

  it("las consultas de administración no cuentan ni muestran géneros ni agrupados, con los datos todavía en la base", async () => {
    expect(await resumirParametrizacionDeCarta(prisma, s.sucursalId)).toMatchObject({ generos: 0, agrupados: 0 });
    // La Cerveza Patagonia es opción del agrupado oculto y tiene contenido visible: para la carta está «visible», no «agrupado».
    expect(await estadoDelProductoEnLaCarta(prisma, s.sucursalId, s.ids.patagonia)).toBe("visible");
    expect(await prisma.itemAgrupadoCarta.count()).toBe(1);
  });
});

describe("pantallas, menú y matriz ENCENDIDOS (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/genero-e-item-agrupado");
    vi.resetModules();
  });
  async function conInterruptorEncendido() {
    vi.resetModules();
    vi.doMock("../../src/core/carta/genero-e-item-agrupado", async (original) => ({ ...(await original<typeof import("../../src/core/carta/genero-e-item-agrupado")>()), GENERO_E_ITEM_AGRUPADO_VISIBLE: true }));
    return {
      pestanas: (await import("../../src/core/carta/ui-config")).PESTANAS_DE_CARTA,
      pagina: (await import("../../src/app/(app)/carta/agrupados/page")).default,
      sesion: await import("../../src/server/sesion/session"),
    };
  }

  it("vuelven las pestañas «Secciones y géneros» e «Ítems agrupados» y las pantallas dejan de responder 404", async () => {
    const { pestanas, pagina, sesion } = await conInterruptorEncendido();
    expect(pestanas.map((p) => p.texto)).toEqual(["Hoy", "Secciones y géneros", "Ítems agrupados"]);
    expect(hrefsDeCarta(pestanas)).toEqual(expect.arrayContaining(HREFS_OCULTOS));
    vi.mocked(sesion.getUsuarioActual).mockResolvedValue(null);
    const error = await pagina().then(
      () => null,
      (e: unknown) => e,
    );
    expect(esNoExiste(error)).toBe(false);
    expect(String((error as { digest?: string })?.digest)).toMatch(/^NEXT_REDIRECT/);
  });
});
