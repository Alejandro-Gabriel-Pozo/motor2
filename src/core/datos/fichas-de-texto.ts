import { invalido, type ResultadoDeRegla } from "./resultado-de-regla";
import { textoDeUnaLineaDesdeTexto, type MotivoDeTextoInvalido, type ReglasDelTexto } from "./texto-de-catalogo";

/**
 * FICHAS DE TEXTO: el largo y las opciones de cada nombre, iguales a los de Pedernal (`src/primitivas/texto/nombre-de-producto.ts`,
 * `nombre-de-eleccion.ts`, `nombre-o-razon-social.ts` y `clasificacion/nombre-de-nodo.ts`). Una sola tabla: un dato nuevo se declara acá y en su
 * oráculo (`test/core/oraculo-texto-de-catalogo.ts`); el guardián (`test/arquitectura/texto-de-catalogo-declarado.test.ts`) falla si una ficha o una
 * función de este archivo no está declarada allá.
 *  · PRODUCTO: 1 a 120, con signos de catálogo, exige una letra. Único por empresa sin distinguir mayúsculas (`claveDeNombre`).
 *  · ELECCION (sección de la carta, grupo de opciones, opción y nodo de la clasificación comercial): 1 a 80, con signos de catálogo, NO exige letra
 *    («2x1» o «12» son nombres posibles de una opción).
 *  · NOMBRE_DE_COCINA (cómo nombra la cocina un producto de venta en la comanda; Pedernal `nombre-de-cocina.ts`): 1 a 80, SIN signos de catálogo, exige una letra.
 *  · NOMBRE_DE_SUCURSAL (nombre de una sucursal; dueño, 2026-11-16, «Sí, así (Recomendada)», `motor2-docs` «Caja y Datos»): 1 a 80, SIN signos de catálogo (se imprime en el ticket), exige una letra. DIFERENCIA con Pedernal declarada:
 *    Pedernal valida el nombre de sucursal con una regla propia (1 a 100, rechaza solo los caracteres de control: una lista de prohibidos); acá rige la lista de permitidos común («todo nace cerrado») y se mantiene el largo de 80 de Motor2.
 *  · RAZON_SOCIAL (nombre o razón social de una persona o empresa: proveedor, cliente, receptor de un comprobante): 1 a 200, SIN signos de
 *    catálogo (viaja a un comprobante), exige una letra: eso también rechaza un CUIT escrito en el campo del nombre.
 * Qué dato de Motor2 usa cuál ficha, y qué no tiene ficha en Pedernal, está en el documento del recuento (todavía sin conectar).
 */
export const FICHAS_DE_TEXTO = {
  PRODUCTO: { maximo: 120, exigirUnaLetra: true, conSignosDeCatalogo: true },
  ELECCION: { maximo: 80, exigirUnaLetra: false, conSignosDeCatalogo: true },
  RAZON_SOCIAL: { maximo: 200, exigirUnaLetra: true, conSignosDeCatalogo: false },
  NOMBRE_DE_COCINA: { maximo: 80, exigirUnaLetra: true, conSignosDeCatalogo: false },
  NOMBRE_DE_SUCURSAL: { maximo: 80, exigirUnaLetra: true, conSignosDeCatalogo: false },
} as const satisfies Record<string, ReglasDelTexto>;

export type FichaDeTexto = keyof typeof FICHAS_DE_TEXTO;

export function textoDeFichaDesdeTexto(ficha: FichaDeTexto, texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  // Fallo cerrado: algo que no es texto (un dato que llega de afuera) se informa como vacío, nunca lanza.
  if (typeof texto !== "string") return invalido("VACIO");
  return textoDeUnaLineaDesdeTexto(texto, FICHAS_DE_TEXTO[ficha]);
}

export function nombreDeProductoDesdeTexto(texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeFichaDesdeTexto("PRODUCTO", texto);
}

export function nombreDeEleccionDesdeTexto(texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeFichaDesdeTexto("ELECCION", texto);
}

export function nombreDeCocinaDesdeTexto(texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeFichaDesdeTexto("NOMBRE_DE_COCINA", texto);
}

export function nombreDeSucursalDesdeTexto(texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeFichaDesdeTexto("NOMBRE_DE_SUCURSAL", texto);
}

export function nombreODenominacionDesdeTexto(texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return textoDeFichaDesdeTexto("RAZON_SOCIAL", texto);
}

/** La clave con la que se compara un nombre: NFC y minúsculas (`Café` y `CAFÉ` colisionan). Parte del nombre ya canónico. */
export function claveDeNombre(nombreCanonico: string): string {
  return nombreCanonico.normalize("NFC").toLowerCase();
}
