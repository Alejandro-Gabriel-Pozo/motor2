import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";

/**
 * Los ADRs no se pueden desactualizar en silencio (Tanda 8, 2026-10-02): lo que un ADR cita con comillas invertidas tiene que existir.
 *  1. Rutas (`src/...`, `test/...`, `docs/...`, `core/...`, `*.test.ts`): el archivo existe.
 *  2. ADR-008, ADR-009 y ADR-027 (los de permisos): toda clave en snake_case es una acción de `ACCIONES`; toda acción de piso gerente aparece en ADR-008;
 *     todo `con...` es una guarda exportada por `server/actions/con-permiso.ts`.
 * Lo histórico se declara abajo CON motivo, y una excepción que ya no hace falta falla: la lista no puede crecer sin que nadie la mire.
 */
const RAIZ = join(__dirname, "../..");
const DIR_ADR = join(RAIZ, "docs/adr");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

const ADRS = readdirSync(DIR_ADR).filter((n) => n.endsWith(".md")).sort();
// ADR-027 (Hito 3, 3.4) entra desde que existe: cita las 12 claves de gobierno y las de D15, y una clave inexistente entre comillas invertidas (el valor
// nuevo del piso o la futura acción de cambiar el nivel de un rol) sería una promesa falsa; por eso el ADR las nombra sin comillas invertidas.
const ADR_PERMISOS = ["ADR-008-rbac-accion-contexto.md", "ADR-009-semantica-de-ausencia-por-sucursal.md", "ADR-027-piso-administrador-de-sistema-y-rangos.md"];

/** `adr|ruta` → por qué la ruta citada ya no existe (o nunca estuvo en este repo). */
const RUTAS_HISTORICAS: Record<string, string> = {
  "ADR-003-adopcion-de-zod.md|src/core/auth/contexto-empresa.ts": "borrado en A4 (9548e73); el ADR lo dice en su «Actualización»",
  "ADR-005-acceso-multiempresa-portal-carta.md|src/core/carta/autorizar-servicio.ts": "ADR SUPERADO por ADR-006; el boundary HTTP se eliminó (de2dae8)",
  "ADR-005-acceso-multiempresa-portal-carta.md|docs/setup-sucursal.md": "doc de la app externa restaurant-menu-design, nunca estuvo en este repo",
  "ADR-006-carta-como-modulo-interno.md|docs/setup-sucursal.md": "doc de la app externa restaurant-menu-design, nunca estuvo en este repo",
  "ADR-007-instalacion-multiempresa-activada-con-una.md|scripts/crear-empresa.ts": "script retirado en E5 (2026-10-04): el alta pasó a la consola de plataforma, ver ADR-020",
  "ADR-007-instalacion-multiempresa-activada-con-una.md|src/core/features/empresa/crear-empresa.ts": "mudada a test/setup/crear-empresa.ts en E8 (2026-10-05): es una fixture de pruebas, ver ADR-024",
  "ADR-019-consola-de-plataforma-ingreso-y-sesion.md|scripts/crear-empresa.ts": "script retirado en E5 (2026-10-04): el alta pasó a la consola de plataforma, ver ADR-020",
};

/** `adr|clave` → clave o guarda retirada que el ADR nombra a propósito, como historia. */
const NOMBRES_RETIRADOS: Record<string, string> = {
  "ADR-008-rbac-accion-contexto.md|editar_producto": "partida en producto_editar (§5, partición de claves)",
  "ADR-008-rbac-accion-contexto.md|carta_promos": "partida en carta_promo_definir / _activar / _precio_local",
  "ADR-008-rbac-accion-contexto.md|promociones_config": "desapareció en la partición de promos",
  "ADR-008-rbac-accion-contexto.md|promociones_activar": "desapareció en la partición de promos",
  "ADR-008-rbac-accion-contexto.md|promociones_marcar_combo": "desapareció en la partición de promos",
  "ADR-008-rbac-accion-contexto.md|ejecutar_tests": "retirada del catálogo, sin consumidor",
  "ADR-008-rbac-accion-contexto.md|sincronizar_proveedores": "retirada del catálogo, sin consumidor",
  "ADR-008-rbac-accion-contexto.md|conGerenteDeEmpresa": "guarda eliminada en la Tanda 3; el ADR dice que ya no existe",
};

function tokensEnComillas(texto: string): string[] {
  return [...texto.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

function basesDeTests(): Set<string> {
  const bases = new Set<string>();
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else bases.add(nombre);
    }
  };
  recorrer(join(RAIZ, "test"));
  return bases;
}

const EXTENSIONES = /^[\w@()[\].\/-]+\.(tsx?|md|sql|json|cjs|jsonc|ya?ml)$/;
const ESPECIFICAS = /^(src|test|docs|scripts|prisma|\.github)\//;

function rutaCitadaInexistente(token: string, bases: Set<string>): boolean {
  if (!EXTENSIONES.test(token)) return false;
  if (ESPECIFICAS.test(token)) return !existsSync(join(RAIZ, token));
  if (/^(core|server)\//.test(token)) return !existsSync(join(RAIZ, "src", token));
  if (/\.test\.tsx?$/.test(token)) return !bases.has(token);
  return false;
}

const CLAVE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const GUARDA = /^con[A-Z]\w+$/;

describe("los ADRs citan solo lo que existe", () => {
  const bases = basesDeTests();

  it.each(ADRS)("%s: toda ruta citada existe (salvo las históricas declaradas)", (adr) => {
    const inexistentes = tokensEnComillas(leer(`docs/adr/${adr}`))
      .filter((t) => rutaCitadaInexistente(t, bases) && !(`${adr}|${t}` in RUTAS_HISTORICAS));
    expect([...new Set(inexistentes)]).toEqual([]);
  });

  it.each(ADR_PERMISOS)("%s: toda clave de permiso citada está en ACCIONES (salvo las retiradas declaradas)", (adr) => {
    const vigentes = new Set<string>(ACCIONES.map((a) => a.clave));
    const desconocidas = tokensEnComillas(leer(`docs/adr/${adr}`))
      .filter((t) => CLAVE.test(t) && !vigentes.has(t) && !(`${adr}|${t}` in NOMBRES_RETIRADOS) && !/^\d/.test(t));
    expect([...new Set(desconocidas)]).toEqual([]);
  });

  it("ADR-008: cada acción de piso gerente del catálogo está nombrada en el ADR", () => {
    const tokens = new Set(tokensEnComillas(leer("docs/adr/ADR-008-rbac-accion-contexto.md")));
    const faltan = ACCIONES.filter((a) => a.nivelMinimo === "gerente").map((a) => a.clave).filter((c) => !tokens.has(c));
    expect(faltan).toEqual([]);
  });

  it("ADR-008: cada guarda `con...` que cita existe en server/actions/con-permiso.ts (salvo las retiradas declaradas)", () => {
    const exportadas = new Set([...leer("src/server/actions/con-permiso.ts").matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]));
    const adr = "ADR-008-rbac-accion-contexto.md";
    const inexistentes = tokensEnComillas(leer(`docs/adr/${adr}`))
      .map((t) => t.replace(/\(.*$/, ""))
      .filter((t) => GUARDA.test(t) && !exportadas.has(t) && !(`${adr}|${t}` in NOMBRES_RETIRADOS));
    expect([...new Set(inexistentes)]).toEqual([]);
  });
});

describe("las excepciones declaradas siguen siendo necesarias", () => {
  const bases = basesDeTests();

  it.each(Object.keys(RUTAS_HISTORICAS))("ruta histórica %s: el ADR todavía la cita y el archivo sigue sin existir", (clave) => {
    const [adr, ruta] = clave.split("|");
    expect(tokensEnComillas(leer(`docs/adr/${adr}`)), "el ADR ya no cita la ruta: sacala de RUTAS_HISTORICAS").toContain(ruta);
    expect(rutaCitadaInexistente(ruta, bases), "la ruta existe de nuevo: sacala de RUTAS_HISTORICAS").toBe(true);
  });

  it.each(Object.keys(NOMBRES_RETIRADOS))("nombre retirado %s: el ADR todavía lo cita y ya no existe", (clave) => {
    const [adr, nombre] = clave.split("|");
    expect(tokensEnComillas(leer(`docs/adr/${adr}`)).map((t) => t.replace(/\(.*$/, "")), "el ADR ya no lo cita: sacalo de NOMBRES_RETIRADOS").toContain(nombre);
    const guardas = new Set([...leer("src/server/actions/con-permiso.ts").matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]));
    expect(ACCIONES.some((a) => a.clave === nombre) || guardas.has(nombre), "el nombre existe de nuevo: sacalo de NOMBRES_RETIRADOS").toBe(false);
  });
});
