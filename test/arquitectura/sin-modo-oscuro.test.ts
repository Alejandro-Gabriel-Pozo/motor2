import { describe, expect, it } from "vitest";
import { leerReglas } from "./contratos/adaptadores/css";
import { RAIZ_DEL_REPO, leer, listarArchivos, sinComentarios } from "./cercos/trinquete";

/**
 * Sin modo oscuro (DEC-04 del dueño, Fase 6 paso 6.2): la aplicación es siempre clara, aun con el sistema operativo en oscuro.
 *
 * El mecanismo, en `src/app/globals.css`:
 *  - `@custom-variant dark (&:where(.modo-oscuro-retirado, .modo-oscuro-retirado *));` — la variante `dark:` de Tailwind ya no depende de
 *    `prefers-color-scheme`: solo se activaría bajo la clase `.modo-oscuro-retirado`, que nadie usa. Las clases `dark:` que quedan en los
 *    componentes son CSS muerto (las cuenta y las baja a 0 el cerco «modo oscuro»);
 *  - `color-scheme: light` en el `:root` (y en el de la consola de plataforma): los controles nativos salen claros.
 *
 * Este test cierra las puertas de vuelta: nadie reactiva el modo oscuro con una consulta al tema del sistema, con la clase retirada ni
 * sacando la variante. Todo se mide sobre el texto SIN comentarios. Los mensajes dicen archivo y línea.
 */
const RAICES = ["src", "plataforma/src"];
const GLOBALS = ["src/app/globals.css", "plataforma/src/app/globals.css"];
const VARIANTE = "@custom-variant dark (&:where(.modo-oscuro-retirado, .modo-oscuro-retirado *));";
const CLASE_RETIRADA = "modo-oscuro-retirado";

const colapsar = (texto: string): string => texto.trim().replace(/\s+/g, " ");

function lineaDe(texto: string, posicion: number): number {
  return texto.slice(0, posicion).split("\n").length;
}

interface Aparicion {
  ruta: string;
  linea: number;
  texto: string;
}

const describir = (a: Aparicion): string => `${a.ruta}:${a.linea} — ${a.texto}`;

/** Cada aparición de `patron` (con bandera `g`) en los archivos con esas extensiones, sin contar comentarios. */
function apariciones(patron: RegExp, extensiones: readonly string[], salvo: readonly string[] = []): Aparicion[] {
  return listarArchivos(RAIZ_DEL_REPO, RAICES, extensiones)
    .filter((ruta) => !salvo.includes(ruta))
    .flatMap((ruta) => {
      const limpia = sinComentarios(leer(RAIZ_DEL_REPO, ruta), ruta);
      return [...limpia.matchAll(patron)].map((m) => ({ ruta, linea: lineaDe(limpia, m.index), texto: colapsar(m[0]) }));
    });
}

describe("sin modo oscuro (DEC-04)", () => {
  it.each(GLOBALS)("el :root de %s declara color-scheme: light", (ruta) => {
    const reglas = leerReglas(sinComentarios(leer(RAIZ_DEL_REPO, ruta), ruta));
    const raiz = reglas.filter((r) => r.selector === ":root");
    const valores = raiz.flatMap((r) => r.declaraciones.filter((d) => d.propiedad === "color-scheme").map((d) => d.valor));
    expect(valores, `${ruta}: el \`:root\` tiene que declarar \`color-scheme: light\` (la app no tiene modo oscuro, DEC-04)`).toEqual(["light"]);
  });

  it("existe EXACTAMENTE un @custom-variant dark, el que ata la variante a la clase retirada", () => {
    const encontradas = apariciones(/@custom-variant\s+dark\b[^;{]*(?:\{[^}]*\})?;?/g, [".css"]);
    const detalle = encontradas.map(describir).join(" | ") || "ninguno";
    expect(encontradas.length, `tiene que haber un único \`${VARIANTE}\` (en src/app/globals.css); hay: ${detalle}`).toBe(1);
    expect(encontradas[0].ruta, `la variante dark vive en src/app/globals.css (${describir(encontradas[0])})`).toBe("src/app/globals.css");
    expect(encontradas[0].texto, `la variante dark tiene que ser exactamente \`${VARIANTE}\` (${describir(encontradas[0])})`).toBe(VARIANTE);
  });

  it("no queda ninguna consulta prefers-color-scheme en el CSS ni en el código", () => {
    const halladas = apariciones(/prefers-color-scheme/g, [".css", ".ts", ".tsx"]).map(describir);
    expect(halladas, "la app no sigue el tema del sistema (DEC-04): borrar la consulta `prefers-color-scheme`").toEqual([]);
  });

  it(`${CLASE_RETIRADA} no aparece fuera de src/app/globals.css (nadie reactiva el modo oscuro con la clase)`, () => {
    const halladas = apariciones(new RegExp(`(?<![\\w-])${CLASE_RETIRADA}(?![\\w-])`, "g"), [".ts", ".tsx", ".css", ".js", ".jsx", ".mjs"], ["src/app/globals.css"]).map(describir);
    expect(halladas, `la clase \`${CLASE_RETIRADA}\` solo vive en la definición de la variante, en src/app/globals.css`).toEqual([]);
  });
});
