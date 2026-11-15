import { FICHAS_DE_TEXTO, textoDeFichaDesdeTexto, type FichaDeTexto } from "./fichas-de-texto";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";
import { texto } from "@/core/texto";

/**
 * NOMBRE CON LA REGLA DE PEDERNAL (etapa E1 del plan de paridad; AGENTS.md «Paridad con Pedernal», 2026-11-13). Une la regla pura (`texto-de-catalogo.ts`, `fichas-de-texto.ts`) con la forma de
 * resultado de las pantallas de Motor2 (`ResultadoDato`).
 *
 * MENSAJE: decisión del dueño (2026-11-15, chat con el orquestador, relatada): «Como Pedernal: mensaje genérico de dato inválido». Pedernal no tiene un texto por motivo para un nombre de catálogo
 * que no cumple (carácter no permitido, largo, falta de letra): todos salen como `CATALOGO_ACCION_NO_PERMITIDA` (`src/composicion/errores-de-catalogo.ts` de ZuluHub-ERP, rama final de
 * `traducirErrorDeCatalogo`), cuyo texto es «Esta acción no está permitida» (`src/capacidades/vocabulario/catalogo-catalogo.ts:104`). Ese es el único texto de rechazo de este archivo, y ya NO se
 * enumeran los caracteres admitidos. El nombre VACÍO conserva el mensaje que cada pantalla de Motor2 ya tenía («… no puede estar vacío.»): Pedernal tiene «Falta el nombre»
 * (`catalogo-catalogo.ts:94`), que no se adoptó porque cada pantalla ya dice a qué dato se refiere. El código (`vacio`, `caracteres`, `largo`, `sin_alfanumerico`) sigue distinguiendo el motivo.
 *
 * DOS MODOS:
 *  - `nombreDeFicha` (ALTA y todo cambio de nombre): la regla estricta. Devuelve el nombre canónico (recortado, NFC, espacios colapsados): es el que se guarda.
 *  - `nombreMinimoDeFicha` (EDICIÓN, en el guard, que no conoce el nombre guardado): solo recorta, exige que no esté vacío y que no pase del tope de la ficha. NO mira los caracteres:
 *    un nombre viejo que no cumple la regla nueva no puede bloquear la edición de otro campo. El caso de uso, que lee la fila, llama a `nombreDeFichaSiCambio`, que aplica la regla
 *    estricta SOLO si el nombre pedido es distinto del guardado (la comparación la hace el servidor contra lo guardado, nunca contra lo que manda el formulario).
 * Lo ya guardado que no cumple NO se toca ni se bloquea al leer: acá no hay lecturas.
 */
const MENSAJE_DE_NOMBRE_NO_PERMITIDO = "Esta acción no está permitida";

/** Con la regla estricta de la ficha, o el rechazo. `texto()` recorta y trata `null`/`undefined` como vacío (los mismos de `nombreDeCatalogo`). */
export function nombreDeFicha(valor: unknown, ficha: FichaDeTexto, mensajeVacio: string): ResultadoDato<string> {
  const v = typeof valor === "string" ? texto(valor) : texto(valor ?? "");
  if (v === "") return rechazar("vacio", mensajeVacio);
  const r = textoDeFichaDesdeTexto(ficha, typeof valor === "string" ? valor : v);
  if (r.ok) return aceptar(r.valor);
  switch (r.error) {
    case "VACIO":
      return rechazar("vacio", mensajeVacio);
    case "DEMASIADO_LARGO":
      return rechazar("largo", MENSAJE_DE_NOMBRE_NO_PERMITIDO);
    case "SIN_LETRAS":
      return rechazar("sin_alfanumerico", MENSAJE_DE_NOMBRE_NO_PERMITIDO);
    case "CARACTER_PROHIBIDO":
      return rechazar("caracteres", MENSAJE_DE_NOMBRE_NO_PERMITIDO);
  }
}

/** El mínimo de una EDICIÓN en el guard (ver arriba): recortado, no vacío y dentro del tope de la ficha, sin mirar los caracteres. */
export function nombreMinimoDeFicha(valor: unknown, ficha: FichaDeTexto, mensajeVacio: string): ResultadoDato<string> {
  const v = typeof valor === "string" ? texto(valor) : texto(valor ?? "");
  if (v === "") return rechazar("vacio", mensajeVacio);
  if ([...v].length > FICHAS_DE_TEXTO[ficha].maximo) return rechazar("largo", MENSAJE_DE_NOMBRE_NO_PERMITIDO);
  return aceptar(v);
}

/**
 * Lo que aplica el caso de uso de una EDICIÓN, con el nombre que ya está guardado: si el pedido es el mismo (el texto recortado, igual al guardado) no hay nada que validar y se devuelve el
 * guardado tal cual; si cambia, la regla estricta de la ficha.
 */
export function nombreDeFichaSiCambio(valor: unknown, vigente: string, ficha: FichaDeTexto, mensajeVacio: string): ResultadoDato<string> {
  const v = typeof valor === "string" ? texto(valor) : texto(valor ?? "");
  if (v !== "" && v === vigente.trim()) return aceptar(vigente);
  return nombreDeFicha(valor, ficha, mensajeVacio);
}
