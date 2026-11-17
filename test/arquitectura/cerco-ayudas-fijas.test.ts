import { describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, sinComentarios, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «ayudas fijas» (Frente «Visual», V5; mandato del dueño 2026-11-17: «en Pedernal veo pocas palabras bien elegidas, en Motor 2 veo párrafos explicativos»). Cuenta, en `src/app` y
 * `src/components`, los lugares donde una pantalla escribe un texto explicativo FIJO a mano, que no pasa por el interruptor `AYUDAS_FIJAS_VISIBLES` (`src/core/textos/ayudas-fijas-visibles.ts`):
 *  - `ayuda-campo`: un `<AyudaCampo>` (ya respeta el interruptor; se cuenta para que no crezca el uso);
 *  - `prop-ayuda`: una prop `ayuda=` de una primitiva (ya respeta el interruptor; ídem). Un texto CONDICIONAL (permiso, estado) va en `aviso=`, no acá;
 *  - `parrafo-de-ayuda`: un `<p className="…">` con la clase de texto chico (`text-xs` o `text-sm`) Y de tinta suave o tenue (`text-tinta-suave`/`text-tinta-tenue`) y SIN `role=` (los avisos de
 *    estado y los errores llevan `role`): un párrafo explicativo escrito a mano, que el interruptor no apaga.
 * Es un trinquete: la línea de base es lo que hay hoy y SOLO baja (cada párrafo que pasa por el interruptor o se borra la hace bajar: `BAJAR_CERCOS=1`); uno nuevo no entra. Es una alarma para errores
 * honestos, no un límite de seguridad.
 * LÍMITES (un ejemplo cada uno, también abajo): no ve un párrafo cuyo `className` se arma con una variable (`className={clase}`) ni uno escrito con otra etiqueta (`<span>`, `<small>`); un `<p>` de
 * datos (un monto en tinta suave) cuenta igual que una ayuda, porque por la clase no se distinguen; una prop `ayuda=` pasada con `{...props}` no se ve.
 * Criterio medible del dueño para el resultado (no lo mide este cerco): ninguna ayuda fija de más de 80 caracteres y no más de 10 palabras de ayuda fija por pantalla.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const RE_AYUDA_CAMPO = /<AyudaCampo\b/g;
const RE_PROP_AYUDA = /(?<=\s)ayuda=/g;
const RE_PARRAFO = /<p\b([^>]*?)>/gs;

function claseDe(atributos: string): string {
  const m = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/.exec(atributos);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

function contarParrafosDeAyuda(fuente: string): number {
  let n = 0;
  for (const m of fuente.matchAll(RE_PARRAFO)) {
    const atributos = m[1];
    if (/\brole=/.test(atributos)) continue;
    const clase = claseDe(atributos);
    if (/(?<![\w-])(?:[a-z0-9]+:)*text-(?:xs|sm)(?![\w-])/.test(clase) && /(?<![\w-])text-tinta-(?:suave|tenue)(?![\w-])/.test(clase)) n++;
  }
  return n;
}

export function contarAyudasFijas(fuente: string): Record<string, number> {
  return {
    "ayuda-campo": contarCoincidencias(fuente, RE_AYUDA_CAMPO),
    "prop-ayuda": contarCoincidencias(fuente, RE_PROP_AYUDA),
    "parrafo-de-ayuda": contarParrafosDeAyuda(fuente),
  };
}

const CERCO_AYUDAS_FIJAS: Cerco = {
  regla: "ayudas-fijas",
  meta: "bajar a medida que cada texto explicativo pase por el interruptor AYUDAS_FIJAS_VISIBLES, se acorte a lo de la maqueta de Pedernal o se borre",
  medir: medirPorArchivo({
    raices: ["src/app", "src/components"],
    extensiones: [".tsx"],
    contar: (fuente, ruta) => contarAyudasFijas(sinComentarios(fuente, ruta)),
  }),
};

describe("cerco «ayudas fijas»: el detector", () => {
  const contar = (fuente: string) => contarAyudasFijas(sinComentarios(fuente, "x.tsx"));
  const nada = { "ayuda-campo": 0, "prop-ayuda": 0, "parrafo-de-ayuda": 0 };

  it("un <AyudaCampo> y una prop ayuda= cuentan; aviso= y ayudaDe no", () => {
    expect(contar('<AyudaCampo>x</AyudaCampo><Campo ayuda="x" /><Campo aviso="x" /><Campo ayudaExtra="x" />')).toEqual({ ...nada, "ayuda-campo": 1, "prop-ayuda": 1 });
  });

  it("un <p> chico de tinta suave o tenue sin role cuenta; con role, con otra tinta o con otro tamaño, no", () => {
    expect(contar('<p className="text-xs text-tinta-suave">a</p><p className="text-sm text-tinta-tenue">b</p><p className="-mt-1 md:text-sm text-tinta-suave">c</p>')).toEqual({ ...nada, "parrafo-de-ayuda": 3 });
    expect(contar('<p role="alert" className="text-sm text-tinta-suave">a</p><p className="text-sm text-error">b</p><p className="text-base text-tinta-suave">c</p><p className="text-sm">d</p>')).toEqual(nada);
  });

  it("LÍMITES: un className armado con una variable, o escrito con <span>, no se ve; un <p> de datos en tinta suave cuenta igual", () => {
    expect(contar('<p className={clase}>a</p><span className="text-xs text-tinta-suave">b</span>')).toEqual(nada);
    expect(contar('<p className="text-sm text-tinta-suave">$ 9.500,00</p>')).toEqual({ ...nada, "parrafo-de-ayuda": 1 });
  });

  it("un texto dentro de un comentario no cuenta", () => {
    expect(contar('{/* <AyudaCampo>x</AyudaCampo> */}')).toEqual(nada);
  });
});

probarCerco(CERCO_AYUDAS_FIJAS);
