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

/**
 * El PIE de la carta impresa (DEC-20, Fase 5 paso 10): «Precios vigentes al 20/10/2026 · https://la-cuadra.cartas.ar/centro». La fecha es la del armado de la carta (`generadoEn`), en la hora de
 * Argentina (la carta no lleva la zona de la empresa; la convención de la carta es es-AR fija, como el precio); la dirección pública, EN TEXTO (decisión del dueño: no se genera QR), solo si la
 * instalación tiene dominio de cartas.
 */
export function pieDeLaCartaImpresa(generadoEn: string, direccionPublica: string | null): string {
  const [anio, mes, dia] = diaDeCalendario(new Date(generadoEn), ZONA_ARGENTINA).split("-");
  return `Precios vigentes al ${dia}/${mes}/${anio}${direccionPublica ? ` · ${direccionPublica}` : ""}`;
}
