import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (add-on de plataforma, ADR-008/ADR-010): la política de una empresa (`Empresa.permisosEditables`,
 * `Empresa.dosPaneles`) la cambia SOLO la plataforma, nunca la propia empresa. El rol de base `motor2_app` NO necesita escribir `Empresa`: el alta, la activación y la política los hace
 * el rol `motor2_plataforma` (la consola y scripts/politica-empresa.ts). Pero mientras no se aplique en cada base el recorte de M.1 (scripts/operaciones/crear-rol-motor2-plataforma.sql
 * con `restringir`; pendiente en producción), `motor2_app` conserva la escritura que le dio el GRANT masivo de la migración inicial y la base no puede impedirlo: lo impide el código, con dos candados que se
 * complementan —este guardián y la regla `operaciones-de-plataforma-solo-desde-scripts` de dependency-cruiser (`npm run arquitectura`), que además
 * prohíbe importar `server/operaciones-de-plataforma/` desde cualquier otro archivo de `src/`. Los tests y el e2e SÍ escriben `Empresa` como `motor2_app` en las bases de prueba (que no se recortan).
 *
 * En `src/`:
 *  1. Ninguna escritura (`create|createMany|update|updateMany|upsert|delete|deleteMany`) sobre `<algo>.empresa` fuera de las EXCEPCIONES.
 *  2. Las excepciones: `cambiar-politica-de-empresa.ts` (el único que escribe la política; lo llama `scripts/politica-empresa.ts`) y
 *     (`crearEmpresa`, que antes era la segunda excepción, se mudó a `test/setup` en E8: ya no está en `src/`).
 *  3. Ningún otro archivo menciona las perillas dentro de SQL crudo (`$executeRaw*`/`$queryRaw*`).
 */
const RAIZ = join(__dirname, "../../src");
const POLITICA = "server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts";
const EXCEPCIONES = [POLITICA];
const ESCRITURAS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const PERILLAS = ["permisosEditables", "dosPaneles"];
const SQL_CRUDO = new Set(["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function recorrer(fuente: string, alVisitar: (nodo: ts.Node, sf: ts.SourceFile) => void): void {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const visitar = (nodo: ts.Node): void => {
    alVisitar(nodo, sf);
    ts.forEachChild(nodo, visitar);
  };
  visitar(sf);
}

/** Escrituras sobre el modelo `empresa` de un fuente: `empresa.<método>:<línea>`. */
function escriturasDeEmpresa(fuente: string): string[] {
  const malas: string[] = [];
  recorrer(fuente, (nodo, sf) => {
    if (!ts.isCallExpression(nodo) || !ts.isPropertyAccessExpression(nodo.expression)) return;
    const objeto = nodo.expression.expression;
    if (ESCRITURAS.has(nodo.expression.name.text) && ts.isPropertyAccessExpression(objeto) && objeto.name.text === "empresa") {
      malas.push(`empresa.${nodo.expression.name.text}:${sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1}`);
    }
  });
  return malas;
}

/** Perillas mencionadas dentro de un SQL crudo (`tx.$executeRaw\`...\`` o `$executeRawUnsafe("...")`): `<perilla>:<línea>`. */
function perillasEnSqlCrudo(fuente: string): string[] {
  const malas: string[] = [];
  recorrer(fuente, (nodo, sf) => {
    const llamado = ts.isTaggedTemplateExpression(nodo) ? nodo.tag : ts.isCallExpression(nodo) ? nodo.expression : undefined;
    if (!llamado || !ts.isPropertyAccessExpression(llamado) || !SQL_CRUDO.has(llamado.name.text)) return;
    const texto = nodo.getText(sf);
    for (const perilla of PERILLAS) {
      if (texto.includes(perilla)) malas.push(`${perilla}:${sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1}`);
    }
  });
  return malas;
}

describe("la política de empresa solo la cambia la plataforma", () => {
  const rutas = archivos(RAIZ);
  const nombreDe = (ruta: string) => relative(RAIZ, ruta).split(sep).join("/");

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ninguna escritura sobre Empresa en src/ fuera de las excepciones", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      const nombre = nombreDe(ruta);
      if (EXCEPCIONES.includes(nombre)) continue;
      for (const m of escriturasDeEmpresa(readFileSync(ruta, "utf8"))) problemas.push(`${nombre} (${m})`);
    }
    expect(problemas, `Estas escrituras sobre Empresa podrían cambiar la política de plataforma desde la app:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("el alta de empresa no toca las perillas de política (queda con el default «completa»)", () => {
    const fuente = readFileSync(join(RAIZ, "../test/setup/crear-empresa.ts"), "utf8");
    for (const perilla of PERILLAS) expect(fuente, `crear-empresa.ts menciona ${perilla}`).not.toContain(perilla);
  });

  it("ningún SQL crudo de src/ nombra las perillas", () => {
    const problemas: string[] = [];
    for (const ruta of rutas) {
      for (const m of perillasEnSqlCrudo(readFileSync(ruta, "utf8"))) problemas.push(`${nombreDe(ruta)} (${m})`);
    }
    expect(problemas, `SQL crudo que nombra una perilla de política:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("las excepciones existen y siguen escribiendo Empresa (la lista no quedó desactualizada)", () => {
    const porNombre = new Map(rutas.map((r) => [nombreDe(r), r]));
    for (const excepcion of EXCEPCIONES) {
      const ruta = porNombre.get(excepcion);
      expect(ruta, `${excepcion} ya no existe: actualizá la lista`).toBeDefined();
      expect(escriturasDeEmpresa(readFileSync(ruta!, "utf8")).length, `${excepcion} ya no escribe Empresa: sacalo de la lista`).toBeGreaterThan(0);
    }
  });

  it("la única excepción que escribe las perillas es cambiar-politica-de-empresa.ts", () => {
    expect(readFileSync(join(RAIZ, POLITICA), "utf8")).toContain("empresa.update");
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca una escritura sobre empresa, también desde una transacción", () => {
      const fuente = ["await ctx.db.empresa.update({ where: { id }, data: { dosPaneles: false } });", "await ctx.db.$transaction((tx) => tx.empresa.upsert({}));"].join("\n");
      expect(escriturasDeEmpresa(fuente)).toEqual(["empresa.update:1", "empresa.upsert:2"]);
    });

    it("no marca lecturas, otros modelos ni un comentario", () => {
      const fuente = ["// ctx.db.empresa.update({})", "await ctx.db.empresa.findUnique({});", "await ctx.db.sucursal.update({});"].join("\n");
      expect(escriturasDeEmpresa(fuente)).toEqual([]);
    });

    it("marca una perilla en SQL crudo (plantilla y Unsafe) y no la nombrada en otro lado", () => {
      const fuente = [
        'await tx.$executeRaw`UPDATE "Empresa" SET "dosPaneles" = false`;',
        'await tx.$executeRawUnsafe("UPDATE \\"Empresa\\" SET \\"permisosEditables\\" = true");',
        'await tx.$executeRaw`SELECT set_config(\'app.empresa_id\', ${id}, true)`;',
        "const x = { dosPaneles: true };",
      ].join("\n");
      expect(perillasEnSqlCrudo(fuente)).toEqual(["dosPaneles:1", "permisosEditables:2"]);
    });
  });
});
