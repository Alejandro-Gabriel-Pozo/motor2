import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { medirPorArchivo, revisarCerco, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";
import { contarTextosAMano } from "./cerco-textos-a-mano-apoyo";

/**
 * Cerco «textos a mano» (T2 del diseño `docs/diseno-textos-en-codigo-2026-11-16.md`, regla R6 / invariante IT-5; regla del dueño del 2026-11-16: «reducir, inventariar y empezar a reutilizar»). Cuenta, por archivo de
 * `src/` y `plataforma/src/`, el texto que una persona lee y que está escrito a mano en vez de salir del catálogo (`textoDe`): texto de JSX, `aria-label`/`placeholder`/`title`/`alt`/`label` y el mensaje de
 * `exito`/`fracaso`/`ok`/`okConId`/`error`. Qué cuenta y qué NO ve (sus LÍMITES): `cerco-textos-a-mano-apoyo.ts`.
 *
 * La línea de base es la deuda de HOY (`linea-de-base/textos-a-mano.json`, con su vencimiento en `cercos/vencimientos.ts`): no se migra ningún texto viejo en este cambio. Hacia adelante un texto escrito a mano de más, en un archivo
 * viejo o nuevo, hace SUBIR la cuenta y falla: el texto nuevo va al catálogo (`src/core/textos/`) con sus `usos` y su `fuente`. Cuando se migra uno, la cuenta baja y se fija con `BAJAR_CERCOS=1`.
 * Mecanismo, regeneración y excepciones: `test/arquitectura/cercos/trinquete.ts`. El catálogo mismo (`src/core/textos/`) no se mide: es donde el texto tiene que vivir.
 */
const CERCO_TEXTOS_A_MANO: Cerco = {
  regla: "textos-a-mano",
  meta: "bajar hacia 0: cada texto que una persona lee sale del catálogo `src/core/textos/` (`textoDe`), con su fuente y sus usos; el texto nuevo no entra a mano",
  medir: medirPorArchivo({
    raices: ["src", "plataforma/src"],
    extensiones: [".ts", ".tsx"],
    incluir: (ruta) => !ruta.startsWith("src/core/textos/") && !ruta.endsWith(".d.ts"),
    contar: (fuente, ruta) => contarTextosAMano(fuente, ruta),
  }),
};

const AYUDA = "Un texto nuevo no se escribe a mano: declaralo en `src/core/textos/catalogo.ts` (con `usos` y `fuente`) y leelo con `textoDe(clave, valores)`. Ver docs/diseno-textos-en-codigo-2026-11-16.md.";

describe("cerco «textos a mano»: el detector (una violación inyectada por forma)", () => {
  const cuenta = (fuente: string, ruta = "x.tsx") => contarTextosAMano(fuente, ruta);

  it("texto suelto de JSX y cadena en una llave de JSX", () => {
    expect(cuenta('export const F = () => <button>Guardar</button>;')).toEqual({ "jsx-texto": 1 });
    expect(cuenta('export const F = () => <p>{"Hola"}</p>;')).toEqual({ "jsx-texto": 1 });
    expect(cuenta('export const F = ({ a }: { a: boolean }) => <p>{a ? "Sí" : "No"}</p>;')).toEqual({ "jsx-texto": 2 });
    expect(cuenta("export const F = ({ a }: { a: boolean }) => <p>{a && `Hay stock`}</p>;")).toEqual({ "jsx-texto": 1 });
  });

  it("cada atributo de texto (también dentro de una expresión y de una plantilla)", () => {
    expect(cuenta('export const F = () => <input aria-label="Cantidad" placeholder="Buscar" title="Ayuda" alt="Logo" label="Nombre" />;')).toEqual({
      "atributo-aria-label": 1,
      "atributo-placeholder": 1,
      "atributo-title": 1,
      "atributo-alt": 1,
      "atributo-label": 1,
    });
    expect(cuenta('export const F = ({ a }: { a: boolean }) => <i title={a ? "Abrir" : "Cerrar"} />;')).toEqual({ "atributo-title": 2 });
    expect(cuenta("export const F = ({ n }: { n: string }) => <i aria-label={`Quitar ${n}`} />;")).toEqual({ "atributo-aria-label": 1 });
  });

  it("el mensaje de exito, fracaso, ok, okConId y error, con su alias", () => {
    const fuente = [
      'import { exito, fracaso } from "@/core/resultado-caso";',
      'import { ok, okConId, error as fallar } from "../tipos";',
      "export const f = (x: string) => [",
      '  exito("Guardado", {}),',
      '  fracaso("CODIGO", "No se pudo"),',
      '  ok("Listo"),',
      '  okConId("Creado", "1", "n"),',
      '  fallar("Mal " + x),',
      "];",
    ].join("\n");
    expect(cuenta(fuente, "x.ts")).toEqual({ "mensaje-exito": 1, "mensaje-fracaso": 1, "mensaje-ok": 1, "mensaje-okConId": 1, "mensaje-error": 1 });
  });

  it("NO cuenta lo que sale del catálogo, comentarios, números, símbolos, variables, clases ni funciones con otro origen", () => {
    expect(cuenta('import { textoDe } from "@/core/textos/texto-de";\nexport const F = () => <p title={textoDe("aviso.x")}>{textoDe("aviso.y")}</p>;')).toEqual({});
    expect(cuenta('export const F = () => <p>{/* Hola */}</p>;')).toEqual({});
    expect(cuenta("export const F = () => <p>·</p>;")).toEqual({});
    expect(cuenta("export const F = () => <p>123 — 4,50</p>;")).toEqual({});
    expect(cuenta('export const F = ({ m }: { m: string }) => <p title={m}>{m}</p>;')).toEqual({});
    expect(cuenta('export const F = ({ a }: { a: boolean }) => <p className={a ? "flex gap-2" : undefined} id="caja" />;')).toEqual({});
    expect(cuenta('export const F = () => <ul>{[1].map(() => <li className="item" />)}</ul>;')).toEqual({});
    expect(cuenta('export const F = () => <p aria-description="Largo" />;')).toEqual({});
    // `error`/`ok` que no vienen de los dos archivos (o `console.error`) no son mensajes de caso de uso
    expect(cuenta('function error(m: string) { return m; }\nexport const a = error("Mal");\nexport const b = () => { try { 1; } catch (error) { console.error("Falló", error); } };', "x.ts")).toEqual({});
    expect(cuenta('import { error } from "./otro";\nexport const a = error("Mal");', "x.ts")).toEqual({});
    // un mensaje que llega por una variable no se ve (límite declarado en el apoyo)
    expect(cuenta('import { error } from "@/server/actions/tipos";\nconst M = "Mal";\nexport const a = error(M);', "x.ts")).toEqual({});
  });
});

describe("cerco «textos a mano»: el trinquete sobre un árbol temporal", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const arbol = (archivos: Record<string, string>) => {
    const raiz = mkdtempSync(join(tmpdir(), "textos-a-mano-"));
    dirs.push(raiz);
    for (const [ruta, texto] of Object.entries(archivos)) {
      mkdirSync(dirname(join(raiz, ruta)), { recursive: true });
      writeFileSync(join(raiz, ruta), texto);
    }
    return { raiz, linea: join(raiz, "linea-de-base") };
  };
  const revisar = (raiz: string, linea: string, extra: { crear?: boolean; bajar?: boolean } = {}) =>
    revisarCerco(CERCO_TEXTOS_A_MANO, { raizDelRepo: raiz, dirLineaDeBase: linea, crear: extra.crear ?? false, bajar: extra.bajar ?? false });

  it("un texto nuevo a mano en un archivo viejo o nuevo SUBE y falla; el catálogo no se mide; migrar uno BAJA y pide fijarlo", () => {
    const { raiz, linea } = arbol({
      "src/pantalla.tsx": "export const P = () => <button>Guardar</button>;",
      "src/core/textos/catalogo.ts": 'export const C = { a: { porDefecto: "Texto del catálogo" } };',
    });
    expect(revisar(raiz, linea, { crear: true }).escritura).toBe("creada");
    expect(revisar(raiz, linea).problemas).toEqual([]);
    // viejo con un texto más
    writeFileSync(join(raiz, "src/pantalla.tsx"), "export const P = () => <><button>Guardar</button><p>Nuevo</p></>;");
    expect(revisar(raiz, linea).problemas.join("\n")).toContain("SUBIÓ");
    // archivo nuevo con texto
    writeFileSync(join(raiz, "src/pantalla.tsx"), "export const P = () => <button>Guardar</button>;");
    writeFileSync(join(raiz, "src/nueva.tsx"), 'export const N = () => <i aria-label="Cerrar" />;');
    expect(revisar(raiz, linea).problemas.join("\n")).toContain("entrada nueva");
    // el mismo texto en el catálogo no cuenta
    rmSync(join(raiz, "src/nueva.tsx"));
    expect(revisar(raiz, linea).problemas).toEqual([]);
    // migrar el texto viejo: la cuenta baja y el cerco pide fijarlo
    writeFileSync(join(raiz, "src/pantalla.tsx"), 'import { textoDe } from "@/core/textos/texto-de";\nexport const P = () => <button>{textoDe("accion.guardar")}</button>;');
    expect(revisar(raiz, linea).problemas.join("\n")).toContain("BAJÓ");
    expect(revisar(raiz, linea, { bajar: true }).escritura).toBe("bajada");
  });
});

probarCerco(CERCO_TEXTOS_A_MANO, AYUDA);
