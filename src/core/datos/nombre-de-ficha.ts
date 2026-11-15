import { FICHAS_DE_TEXTO, textoDeFichaDesdeTexto, type FichaDeTexto } from "./fichas-de-texto";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";
import { textoDeUnaLineaDesdeTexto } from "./texto-de-catalogo";
import { texto } from "@/core/texto";

/**
 * NOMBRE CON LA REGLA DE PEDERNAL (etapa E1 del plan de paridad; AGENTS.md «Paridad con Pedernal», 2026-11-13). Une la regla pura (`texto-de-catalogo.ts`, `fichas-de-texto.ts`)
 * con la forma de resultado y los MENSAJES que las pantallas de Motor2 ya muestran (`ResultadoDato`): no se inventa ningún texto. Pedernal no tiene un mensaje por motivo para los
 * nombres de catálogo (todos salen como un «dato inválido» genérico), así que cada motivo conserva el mensaje que Motor2 ya tenía; la tabla «mensaje de Pedernal | de Motor2 hoy |
 * que queda» está en la descripción del PR para que el dueño la apruebe.
 *
 * DOS MODOS:
 *  - `nombreDeFicha` (ALTA y todo cambio de nombre): la regla estricta. Devuelve el nombre canónico (recortado, NFC, espacios colapsados): es el que se guarda.
 *  - `nombreMinimoDeFicha` (EDICIÓN, en el guard, que no conoce el nombre guardado): solo recorta, exige que no esté vacío y que no pase del tope de la ficha. NO mira los caracteres:
 *    un nombre viejo que no cumple la regla nueva no puede bloquear la edición de otro campo. El caso de uso, que lee la fila, llama a `nombreDeFichaSiCambio`, que aplica la regla
 *    estricta SOLO si el nombre pedido es distinto del guardado (la comparación la hace el servidor contra lo guardado, nunca contra lo que manda el formulario).
 * Lo ya guardado que no cumple NO se toca ni se bloquea al leer: acá no hay lecturas.
 */
function mensajeDeCaracteres(etiqueta: string): string {
  return `${etiqueta} tiene caracteres no permitidos. Se admiten letras, números, espacios y - . , ( ) % & / '`;
}

/** Con la regla estricta de la ficha, o el rechazo con el mensaje de siempre de Motor2. `texto()` recorta y trata `null`/`undefined` como vacío (los mismos de `nombreDeCatalogo`). */
export function nombreDeFicha(valor: unknown, ficha: FichaDeTexto, mensajeVacio: string, etiqueta: string): ResultadoDato<string> {
  const v = typeof valor === "string" ? texto(valor) : texto(valor ?? "");
  if (v === "") return rechazar("vacio", mensajeVacio);
  const r = textoDeFichaDesdeTexto(ficha, typeof valor === "string" ? valor : v);
  if (r.ok) return aceptar(r.valor);
  const { maximo } = FICHAS_DE_TEXTO[ficha];
  switch (r.error) {
    case "VACIO":
      return rechazar("vacio", mensajeVacio);
    case "DEMASIADO_LARGO":
      return rechazar("largo", `${etiqueta} no puede superar los ${maximo} caracteres.`);
    case "SIN_LETRAS":
      return rechazar("sin_alfanumerico", `${etiqueta} tiene que tener al menos una letra o un número.`);
    case "CARACTER_PROHIBIDO":
      // El «-» del principio tenía su propio mensaje; solo se lo da si ese era el único problema (cambiado por una letra, el texto pasa).
      if (v.startsWith("-") && textoDeUnaLineaDesdeTexto(`A${v.slice(1)}`, { ...FICHAS_DE_TEXTO[ficha], exigirUnaLetra: false }).ok) {
        return rechazar("caracteres", `${etiqueta} no puede empezar con "-".`);
      }
      return rechazar("caracteres", mensajeDeCaracteres(etiqueta));
  }
}

/** El mínimo de una EDICIÓN en el guard (ver arriba): recortado, no vacío y dentro del tope de la ficha, sin mirar los caracteres. */
export function nombreMinimoDeFicha(valor: unknown, ficha: FichaDeTexto, mensajeVacio: string, etiqueta: string): ResultadoDato<string> {
  const v = typeof valor === "string" ? texto(valor) : texto(valor ?? "");
  if (v === "") return rechazar("vacio", mensajeVacio);
  const { maximo } = FICHAS_DE_TEXTO[ficha];
  if ([...v].length > maximo) return rechazar("largo", `${etiqueta} no puede superar los ${maximo} caracteres.`);
  return aceptar(v);
}

/**
 * Lo que aplica el caso de uso de una EDICIÓN, con el nombre que ya está guardado: si el pedido es el mismo (el texto recortado, igual al guardado) no hay
 * nada que validar y se devuelve el guardado tal cual; si cambia, la regla estricta de la ficha.
 */
export function nombreDeFichaSiCambio(valor: unknown, vigente: string, ficha: FichaDeTexto, mensajeVacio: string, etiqueta: string): ResultadoDato<string> {
  const v = typeof valor === "string" ? texto(valor) : texto(valor ?? "");
  if (v !== "" && v === vigente.trim()) return aceptar(vigente);
  return nombreDeFicha(valor, ficha, mensajeVacio, etiqueta);
}
