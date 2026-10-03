import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRUPOS_NAV,
  RUTAS_FUERA_DEL_MENU,
  filtrarMenuPorPermiso,
  hrefsDelMenu,
  mostrarSelectorDePaneles,
  particionarMenu,
  type GrupoNav,
} from "../../src/core/navegacion/estructura";
import { ACCIONES, type AccionClave } from "../../src/core/permisos/acciones";

/**
 * GOLDEN MASTER del registro de módulos (ADR-011, Bloque 0). Fija lo que una empresa «completa» —la que hoy tienen todas— le deja ver a cada
 * perfil, ANTES de que exista el registro. Cuando el registro y el guard por módulo estén, este mismo archivo tiene que seguir verde sin tocar
 * el JSON: una empresa con todos los módulos activos no puede perder ni ganar una sola pantalla ni una sola acción.
 *
 * Un cambio legítimo de menú o de catálogo cambia el JSON a propósito: regenerarlo con `GOLDEN_ACTUALIZAR=1 npx vitest run test/modulos` y
 * revisar el diff en el commit.
 */
const RUTA_JSON = resolve(__dirname, "__golden__", "empresa-principal.json");

const TODOS_LOS_ITEMS = [...GRUPOS_NAV.flatMap((g) => g.items), ...RUTAS_FUERA_DEL_MENU];
const ADMIN = new Set<AccionClave>(TODOS_LOS_ITEMS.flatMap((i) => (i.accion ? [i.accion] : [])));
const OPERADOR = new Set<AccionClave>(
  ACCIONES.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes("operador")).map((a) => a.clave as AccionClave),
);
const SOLO_SALON = new Set<AccionClave>(["pos_mesas"]);

const hrefsPor = (grupos: GrupoNav[]) => grupos.flatMap((g) => g.items.map((i) => `${g.id}|${i.href}`));

function fotoDelPerfil(acciones: ReadonlySet<AccionClave>) {
  const visible = filtrarMenuPorPermiso(GRUPOS_NAV, acciones);
  const paneles = particionarMenu(visible);
  return {
    acciones: [...acciones].sort(),
    menu: hrefsPor(visible),
    panelEmpresa: hrefsPor(paneles.empresa),
    panelSucursal: hrefsPor(paneles.sucursal),
    selectorDePaneles: mostrarSelectorDePaneles(visible),
  };
}

function fotoActual() {
  return {
    perfiles: { admin: fotoDelPerfil(ADMIN), operador: fotoDelPerfil(OPERADOR), soloSalon: fotoDelPerfil(SOLO_SALON) },
    menuCompleto: hrefsDelMenu(),
    rutasFueraDelMenu: RUTAS_FUERA_DEL_MENU.map((i) => i.href),
    catalogoDeAcciones: ACCIONES.map((a) => ({
      clave: a.clave,
      contexto: a.contexto,
      nivelMinimo: a.nivelMinimo,
      rolesEditarSemilla: [...a.rolesEditarSemilla],
    })),
  };
}

describe("golden master: lo que ve una empresa con todo activo (antes del registro de módulos)", () => {
  it("el menú por perfil, los paneles y el catálogo de acciones coinciden con la foto guardada", () => {
    const actual = fotoActual();
    if (process.env.GOLDEN_ACTUALIZAR === "1" || !existsSync(RUTA_JSON)) {
      mkdirSync(dirname(RUTA_JSON), { recursive: true });
      writeFileSync(RUTA_JSON, JSON.stringify(actual, null, 2) + "\n");
    }
    expect(actual).toEqual(JSON.parse(readFileSync(RUTA_JSON, "utf8")));
  });

  it("la foto no está vacía: el admin ve las pantallas del menú y hay un catálogo de acciones", () => {
    const foto = JSON.parse(readFileSync(RUTA_JSON, "utf8")) as ReturnType<typeof fotoActual>;
    expect(foto.perfiles.admin.menu.length).toBeGreaterThan(10);
    expect(foto.perfiles.admin.panelEmpresa.length).toBeGreaterThan(0);
    expect(foto.catalogoDeAcciones.length).toBeGreaterThan(40);
  });
});
