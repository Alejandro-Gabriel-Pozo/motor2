import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (docs/plan-mutaciones-controladas-2026-09-25.md, Paso 7): la confirmación de intención y la transición de estado de
 * un traspaso viven en UN solo lugar cada una.
 *
 *  - En todo `src/`: nada de `window.confirm(` (fuera de comentarios). Se ve fuera de la página, no se puede probar con Playwright sin manejar
 *    diálogos y no es accesible del mismo modo; la confirmación es `BotonConConfirmacion` (src/components/boton-con-confirmacion.tsx).
 *  - En los archivos YA MIGRADOS a `BotonConConfirmacion` (lista `MIGRADOS`): no vuelve a aparecer un estado `confirmando` armado a mano
 *    (`[confirmando, setConfirmando] = useState…`). Cada fase siguiente agrega a la lista los archivos que migra (la variante básica, F2).
 *  - En `src/server/actions/traspasos/traspasos.ts` y sus casos de uso (`casos-de-uso/`, adonde se mudaron las transiciones en la Task #41,
 *    Fases M11a/M11b): nada de comparar el estado contra un literal (`estado !== "…"`). De qué estado a qué estado se puede pasar lo decide
 *    `guardTransicionTraspaso` (src/core/features/traspasos/traspaso.guard.ts).
 */
const RAIZ = join(__dirname, "../../src");

const MIGRADOS = ["app/(app)/traspasos/bandeja.tsx", "app/(app)/reportes/compras/boton-anular-compra.tsx"];
const ACCIONES_TRASPASOS = "server/actions/traspasos/traspasos.ts";
const CASOS_DE_USO_TRASPASOS = "server/actions/traspasos/casos-de-uso";

const WINDOW_CONFIRM = /\bwindow\.confirm\s*\(/;
const CONFIRMANDO_A_MANO = /\bsetConfirmando\b|\[\s*confirmando\s*,/;
const ESTADO_CONTRA_LITERAL = /\bestado\s*!==?\s*["'`]/;

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("{/*");
}

/** Las líneas (1-based) que matchean `patron` fuera de un comentario, como "línea: texto". */
function usos(fuente: string, patron: RegExp): string[] {
  const malas: string[] = [];
  fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((linea, i) => {
      if (esComentario(linea)) return;
      if (patron.test(linea.replace(/\/\/.*$/, ""))) malas.push(`${i + 1}: ${linea.trim()}`);
    });
  return malas;
}

function archivosDeCodigo(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDeCodigo(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

const leer = (archivo: string) => readFileSync(join(RAIZ, archivo), "utf8");

describe("confirmación y transición de traspasos en un solo lugar", () => {
  it("ningún archivo de src/ usa window.confirm (la confirmación es BotonConConfirmacion)", () => {
    const problemas = archivosDeCodigo(RAIZ).flatMap((ruta) => usos(readFileSync(ruta, "utf8"), WINDOW_CONFIRM).map((u) => `${relative(RAIZ, ruta)}:${u}`));
    expect(problemas, `window.confirm fuera de un comentario:\n${problemas.join("\n")}`).toEqual([]);
  });

  it.each(MIGRADOS)("%s no arma a mano un estado `confirmando` (usa BotonConConfirmacion)", (archivo) => {
    const fuente = leer(archivo);
    expect(fuente, `${archivo} ya no usa BotonConConfirmacion`).toContain("BotonConConfirmacion");
    const problemas = usos(fuente, CONFIRMANDO_A_MANO);
    expect(problemas, `${archivo} volvió a armar la confirmación a mano:\n${problemas.join("\n")}`).toEqual([]);
  });

  it(`${ACCIONES_TRASPASOS} y sus casos de uso no comparan el estado contra un literal (lo decide guardTransicionTraspaso)`, () => {
    const archivos = [
      ACCIONES_TRASPASOS,
      ...archivosDeCodigo(join(RAIZ, CASOS_DE_USO_TRASPASOS)).map((ruta) => relative(RAIZ, ruta).replace(/\\/g, "/")),
    ];
    expect(archivos.map(leer).join("\n")).toContain("guardTransicionTraspaso(");
    for (const archivo of archivos) {
      const problemas = usos(leer(archivo), ESTADO_CONTRA_LITERAL);
      expect(problemas, `${archivo} volvió a chequear el estado a mano:\n${problemas.join("\n")}`).toEqual([]);
    }
  });

  describe("los detectores (con fuentes sintéticas)", () => {
    it("marcan window.confirm, el estado confirmando a mano y la comparación de estado contra un literal", () => {
      expect(usos("if (!window.confirm('¿Seguro?')) return;", WINDOW_CONFIRM)).toHaveLength(1);
      expect(usos("const [confirmando, setConfirmando] = useState(false);", CONFIRMANDO_A_MANO)).toHaveLength(1);
      expect(usos("onClick={() => setConfirmando(true)}", CONFIRMANDO_A_MANO)).toHaveLength(1);
      expect(usos('if (traspaso.estado !== "SOLICITADA") return error("x");', ESTADO_CONTRA_LITERAL)).toHaveLength(1);
      expect(usos("if (t.estado != 'ENVIADA') return;", ESTADO_CONTRA_LITERAL)).toHaveLength(1);
    });

    it("no marcan comentarios, ni un filtro de lectura por igualdad, ni el estado que devuelve el guard", () => {
      const fuente = [
        " * Sin diálogo del navegador (`window.confirm`): se ve dentro de la página.",
        "// antes: if (traspaso.estado !== \"SOLICITADA\")",
        "const paraAprobar = enCurso.filter((t) => t.estado === \"SOLICITADA\");",
        "data: { estado: transicion.estadoNuevo },",
        "{/* confirmando: se abre el aviso */}",
      ].join("\n");
      expect(usos(fuente, WINDOW_CONFIRM)).toEqual([]);
      expect(usos(fuente, CONFIRMANDO_A_MANO)).toEqual([]);
      expect(usos(fuente, ESTADO_CONTRA_LITERAL)).toEqual([]);
    });
  });
});
