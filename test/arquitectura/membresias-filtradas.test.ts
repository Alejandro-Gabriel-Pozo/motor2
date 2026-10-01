import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura: `ctx.membresias` son TODAS las sucursales del usuario, no las que puede ver para una acción. El gate de una
 * pantalla mira solo la sucursal activa; una pantalla que junta datos de varias sucursales y recorre `ctx.membresias` a secas muestra
 * las de una sucursal donde el rol no tiene el permiso (la fuga que cerró `9e72c9f` en el consolidado). Por eso todo archivo de `src/app`,
 * `src/components` y `src/server` que lea `.membresias` tiene que llamar `sucursalesVisiblesPara` — o estar en `EXCEPCIONES`, cada una con
 * su motivo.
 */
const RAIZ = join(__dirname, "../../src");
const CARPETAS = ["app", "components", "server"];
const HELPER = "sucursalesVisiblesPara";
const EXCEPCIONES: Record<string, string> = {
  "components/app-shell.tsx": "pinta el selector de sucursal: ahí van todas las del usuario, a propósito",
  "components/pos-shell.tsx": "pinta el selector de sucursal: ahí van todas las del usuario, a propósito",
  "app/(app)/administracion/auditoria/page.tsx": "filtra con `sucursalesVisiblesDeAuditoria` (core/permisos/auditoria.ts), que mira `ver_auditoria` en cada una",
  "server/actions/con-sesion.ts": "`requerirSesionEnSucursal`: comprueba pertenencia a UNA sucursal, no arma un alcance de datos",
  "server/actions/auth/usuarios.ts": "pregunta por el rol del usuario en una sucursal concreta, no recorre sucursales para mostrar datos",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Si el fuente lee `<algo>.membresias` y si llama al helper (los comentarios no cuentan: se analiza el AST). */
function analizar(fuente: string): { leeMembresias: boolean; usaHelper: boolean } {
  const sf = ts.createSourceFile("x.tsx", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let leeMembresias = false;
  let usaHelper = false;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isPropertyAccessExpression(nodo) && nodo.name.text === "membresias") leeMembresias = true;
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === HELPER) usaHelper = true;
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
  return { leeMembresias, usaHelper };
}

describe("membresías: las pantallas que juntan sucursales las filtran por permiso", () => {
  const rutas = CARPETAS.flatMap((c) => archivos(join(RAIZ, c)));
  const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("todo archivo que lee `.membresias` usa `sucursalesVisiblesPara` o es una excepción", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = nombreDe(ruta);
      if (nombre in EXCEPCIONES) continue;
      const { leeMembresias, usaHelper } = analizar(readFileSync(ruta, "utf8"));
      if (leeMembresias && !usaHelper) problemas.push(nombre);
    }
    expect(
      problemas,
      `Estos archivos recorren \`.membresias\` sin filtrar por permiso (usá \`sucursalesVisiblesPara(ctx, accion)\`, o agregalos a EXCEPCIONES con su motivo):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  it("las excepciones existen y siguen leyendo `.membresias` (la lista no quedó desactualizada)", () => {
    const porNombre = new Map(rutas.map((r) => [nombreDe(r), r]));
    for (const nombre of Object.keys(EXCEPCIONES)) {
      const ruta = porNombre.get(nombre);
      expect(ruta, `${nombre} ya no existe: actualizá EXCEPCIONES`).toBeDefined();
      expect(analizar(readFileSync(ruta!, "utf8")).leeMembresias, `${nombre} ya no lee .membresias: sacalo de EXCEPCIONES`).toBe(true);
    }
  });

  it("las pantallas de datos de varias sucursales usan el helper", () => {
    for (const nombre of ["app/(app)/reportes/consolidado/page.tsx", "app/(app)/reportes/rendimiento-recetas/por-sucursal/page.tsx"]) {
      const { usaHelper } = analizar(readFileSync(join(RAIZ, nombre), "utf8"));
      expect(usaHelper, `${nombre} tiene que filtrar con sucursalesVisiblesPara`).toBe(true);
    }
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca `ctx.membresias` y `x.y.membresias` sin el helper", () => {
      expect(analizar("const s = ctx.membresias.map((m) => m.sucursalId);")).toEqual({ leeMembresias: true, usaHelper: false });
      expect(analizar("const s = a.b.membresias.length;")).toEqual({ leeMembresias: true, usaHelper: false });
    });

    it("reconoce el helper", () => {
      expect(analizar('const s = await sucursalesVisiblesPara(ctx, "reporte_consolidado"); const t = ctx.membresias;')).toEqual({ leeMembresias: true, usaHelper: true });
    });

    it("no marca un comentario, un string ni un identificador suelto `membresias`", () => {
      const fuente = ["// ctx.membresias", 'const t = "ctx.membresias";', "const membresias = []; membresias.push(1);"].join("\n");
      expect(analizar(fuente)).toEqual({ leeMembresias: false, usaHelper: false });
    });
  });
});
