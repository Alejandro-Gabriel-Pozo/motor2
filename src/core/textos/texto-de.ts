import { CATALOGO, type ClaveDeTexto } from "./catalogo";
import type { DefinicionDeTexto, TipoDeMarcador } from "./tipos";

/**
 * Lee un texto del catálogo (`textoDe`; el nombre evita el `texto()` de `core/texto.ts`, que es otra cosa: diseño §9, D1). Puro, sin estado: repetirlo da lo mismo.
 *
 * Cerrado por defecto (IT-6): una clave que no existe o un hueco mal pasado NO compila. Si algo llega igual (un `any`, un dato de afuera), devuelve `MENSAJE_GENERICO` y deja en los registros
 * solo la clave y qué falló (nunca los valores): jamás un texto vacío ni el código crudo.
 */
export const MENSAJE_GENERICO = "No se pudo completar la operación.";

type Catalogo = typeof CATALOGO;
type MarcadoresDe<C extends ClaveDeTexto> = Catalogo[C] extends { readonly marcadores: infer M } ? M : never;

/** Claves cuyo texto no tiene huecos propios: las únicas que pueden llenar un hueco `causa` (un solo nivel). */
type ClaveSinHuecos = { [C in ClaveDeTexto]: Catalogo[C] extends { readonly marcadores: object } ? never : C }[ClaveDeTexto];

type ValorDe<T extends TipoDeMarcador> = T extends "causa" ? ClaveSinHuecos : string;
type ValoresDe<C extends ClaveDeTexto> = { readonly [N in keyof MarcadoresDe<C>]: MarcadoresDe<C>[N] extends TipoDeMarcador ? ValorDe<MarcadoresDe<C>[N]> : never };
type ArgumentosDe<C extends ClaveDeTexto> = [MarcadoresDe<C>] extends [never] ? [] : [valores: ValoresDe<C>];

const HUECO = /\{([a-z][a-zA-Z0-9]*)\}/g;

/** Los nombres de los huecos `{nombre}` de un texto, en orden y sin repetir. Lo usa también el guardián del catálogo. */
export function huecosDe(texto: string): string[] {
  return [...new Set([...texto.matchAll(HUECO)].map((m) => m[1] ?? ""))];
}

function fallar(clave: string, motivo: string): string {
  console.error(`textoDe: ${motivo} (clave «${clave}»); se muestra el mensaje genérico.`);
  return MENSAJE_GENERICO;
}

/** Se arma en UNA pasada sobre el texto del catálogo: lo que se inserta no se vuelve a leer, así un nombre con `{causa}` adentro no se expande. */
function armar(clave: string, valores: Readonly<Record<string, string>>): string | null {
  const definicion = (CATALOGO as Readonly<Record<string, DefinicionDeTexto>>)[clave];
  if (!definicion) return null;
  const marcadores = definicion.marcadores ?? {};
  let falta = false;
  const texto = definicion.porDefecto.replace(HUECO, (_hueco, nombre: string) => {
    const tipo = marcadores[nombre];
    const valor = valores[nombre];
    if (tipo === undefined || typeof valor !== "string") {
      falta = true;
      return "";
    }
    if (tipo === "texto") return valor;
    // `causa`: otra clave, sin huecos propios (un solo nivel, sin recursión).
    const causa = (CATALOGO as Readonly<Record<string, DefinicionDeTexto>>)[valor];
    if (!causa || causa.marcadores !== undefined) {
      falta = true;
      return "";
    }
    return causa.porDefecto;
  });
  return falta ? null : texto;
}

export function textoDe<C extends ClaveDeTexto>(clave: C, ...valores: ArgumentosDe<C>): string {
  const dados = (valores[0] ?? {}) as Readonly<Record<string, string>>;
  const texto = armar(clave, dados);
  return texto === null ? fallar(clave, "clave desconocida, hueco sin valor o causa inválida") : texto;
}
