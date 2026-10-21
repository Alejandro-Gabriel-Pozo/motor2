import { unirConO } from "@/core/opciones/public";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { formatearPrecioCarta } from "./precio-carta";

/**
 * Fase 5 («carta pareja», ADR-035): los TEXTOS con que se lee la forma de un producto, compartidos por la carta pública (`components/carta-publica/seccion.tsx`) y la vista previa de la
 * administración («Va a mostrar», `mantenimiento.ts`): una sola manera de escribir un recargo y una aclaración. Puro. (Aparte de `presentacion-en-carta.ts` para no cerrar un ciclo con el tema
 * por `precio-carta.ts`.)
 */

/** Una línea debajo del plato, tal como la arma `presentacion-en-carta.ts` (la misma forma en `CartaV1` y en la carta pública). */
type Aclaracion = { tipo: "eleccion"; rotulo: string; opciones: readonly string[] } | { tipo: "extras"; rotulo: string; opciones: readonly { nombre: string; recargo: number }[] };

/** «+$400» o «−$300»: lo que una opción suma o resta al precio que se ve. */
export function recargoEnPesos(recargo: number): string {
  return `${recargo < 0 ? "−" : "+"}${formatearPrecioCarta(Math.abs(recargo))}`;
}

/**
 * Lo que dice una aclaración después de su rótulo: una ELECCIÓN se une con «o» («ensalada, papas fritas o puré»); unos EXTRAS van separados por comas, cada uno con lo que suma o resta
 * («extra de papas +$2.000, huevo frito +$1.500»; lo que no suma, solo su nombre).
 */
export function textoDeLaAclaracion(a: Aclaracion): string {
  return a.tipo === "eleccion" ? unirConO(a.opciones) : a.opciones.map((o) => (o.recargo === 0 ? o.nombre : `${o.nombre} ${recargoEnPesos(o.recargo)}`)).join(", ");
}

/** El separador de las opciones en la línea de lo que no cuesta: espacio, punto medio (U+00B7), espacio. */
const SEPARADOR_DE_OPCIONES = " · ";

/**
 * Una aclaración partida para leerse en «P1» (jerarquía de la carta pública): lo que NO cuesta en UNA línea y cada opción que SÍ suma o resta, aparte, para dibujarla en su propia fila con el
 * recargo a la derecha. Texto NEUTRO, sin verbo (no sugiere obligatoriedad, cuántas se eligen ni que vienen juntas: la carta no lo sabe). Una ELECCIÓN (ninguna suma): solo las opciones unidas
 * por « · », «ensalada · papas fritas · puré». Unos EXTRAS: las opciones sin recargo (`recargo === 0`) van en `libres`, «Sin cargo: solo · cortado» (también con UNA sola: «Sin cargo: solo»), y
 * `null` si no hay ninguna; las que suman o restan (`recargo !== 0`) van en `conRecargo`, en su orden. Puro.
 */
export function partirLaAclaracion(a: Aclaracion): { libres: string | null; conRecargo: { nombre: string; recargo: number }[] } {
  if (a.tipo === "eleccion") return { libres: a.opciones.length > 0 ? a.opciones.join(SEPARADOR_DE_OPCIONES) : null, conRecargo: [] };
  const gratis = a.opciones.filter((o) => o.recargo === 0).map((o) => o.nombre);
  const libres = gratis.length === 0 ? null : `Sin cargo: ${gratis.join(SEPARADOR_DE_OPCIONES)}`;
  return { libres, conRecargo: a.opciones.filter((o) => o.recargo !== 0).map((o) => ({ nombre: o.nombre, recargo: o.recargo })) };
}

/**
 * El PIE de la carta impresa (DEC-20, Fase 5 paso 10): «Precios vigentes al 20/10/2026 · https://la-cuadra.cartas.ar/centro». La fecha es la del armado de la carta (`generadoEn`), en la hora de
 * Argentina (la carta no lleva la zona de la empresa; la convención de la carta es es-AR fija, como el precio); la dirección pública, EN TEXTO (decisión del dueño: no se genera QR), solo si la
 * instalación tiene dominio de cartas.
 */
export function pieDeLaCartaImpresa(generadoEn: string, direccionPublica: string | null): string {
  const [anio, mes, dia] = diaDeCalendario(new Date(generadoEn), ZONA_ARGENTINA).split("-");
  return `Precios vigentes al ${dia}/${mes}/${anio}${direccionPublica ? ` · ${direccionPublica}` : ""}`;
}
