import { validarCuit } from "@/core/fiscal/public";
import { invalido, valido, type ResultadoDeRegla } from "./resultado-de-regla";

/** Los 11 dígitos canónicos de un CUIT, CUIL o CDI (módulo 11, sin lista de prefijos: la regla estricta de `cuit-estricto.ts`, que `validarCuit` aplica) o `null`. */
function cuitCanonico(texto: string): string | null {
  const r = validarCuit(texto);
  return r.ok ? r.valor : null;
}

/**
 * EL DOCUMENTO DE UNA PARTE (ficha única de personas y empresas; docs/diseno-parte-2026-11-12.md §4.1, invariantes I1 a I4; AGENTS.md «Paridad con Pedernal»): igual a `dominio/documento.ts` de Pedernal
 * (`src/modulos/clientes`, versión vigente). Seis tipos: `CUIT`, `CUIL` y `CDI` (el mismo número de once dígitos con dígito verificador), `DNI`, `PASAPORTE` (con país) y `ID_EXTRANJERO` (con país).
 * Una persona puede tener cualquiera; una EMPRESA solo `CUIT` o `ID_EXTRANJERO`. Es opcional: lo decide quien lo usa.
 *
 * Lo que se escribe y lo que se guarda (lista de PERMITIDOS, «todo nace cerrado»): CUIT/CUIL/CDI, 11 dígitos con verificador (se acepta `XX-XXXXXXXX-X`, se guarda sin guiones: `cuit-estricto.ts`); DNI, de 6 a 9
 * dígitos sin cero a la izquierda (se aceptan los puntos de miles `12.345.678`, se guarda sin ellos); pasaporte, letras y números de 6 a 9 caracteres, en mayúsculas (se guarda en mayúsculas); documento extranjero,
 * letras y números de 3 a 20, en mayúsculas; país, dos letras mayúsculas. Los documentos argentinos no llevan país.
 *
 * `documentoNormalizado` es la MISMA clave que la columna generada `"Parte"."documentoNormalizado"` de la base (con su único por empresa): un CUIT y un CUIL con el mismo número son el mismo documento. Un test de
 * integración compara las dos. Puro: sin reloj ni azar.
 */
export const TIPOS_DE_DOCUMENTO_DE_PARTE = ["CUIT", "CUIL", "CDI", "DNI", "PASAPORTE", "ID_EXTRANJERO"] as const;
export type TipoDeDocumentoDeParte = (typeof TIPOS_DE_DOCUMENTO_DE_PARTE)[number];

/** Los únicos tipos que admite una empresa (persona jurídica). */
const TIPOS_DE_DOCUMENTO_DE_EMPRESA = ["CUIT", "ID_EXTRANJERO"] as const satisfies readonly TipoDeDocumentoDeParte[];

export type NaturalezaDeParte = "HUMANA" | "JURIDICA";

export type DocumentoDeParte =
  | Readonly<{ tipo: "CUIT" | "CUIL" | "CDI" | "DNI"; pais: null; numero: string }>
  | Readonly<{ tipo: "PASAPORTE" | "ID_EXTRANJERO"; pais: string; numero: string }>;

/** El documento tal como llega, sin validar. */
export type DatosDeDocumento = Readonly<{ tipo: string; pais?: string | null; numero: string }>;

export type ErrorDeDocumentoDeParte =
  | "TIPO_DE_DOCUMENTO_INVALIDO"
  | "DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA"
  | "CUIT_INVALIDO"
  | "DNI_INVALIDO"
  | "PAIS_REQUERIDO"
  | "PAIS_INVALIDO"
  | "PAIS_NO_CORRESPONDE"
  | "PASAPORTE_INVALIDO"
  | "DOCUMENTO_EXTRANJERO_INVALIDO";

const FORMATO_DE_DNI = /^[1-9][0-9]{5,8}$/;
const FORMATO_DE_DNI_CON_PUNTOS = /^[1-9][0-9]{0,2}(\.[0-9]{3}){1,2}$/;
const FORMATO_DE_PASAPORTE = /^[A-Z0-9]{6,9}$/;
const FORMATO_DE_DOCUMENTO_EXTRANJERO = /^[A-Z0-9]{3,20}$/;
const FORMATO_DE_PAIS = /^[A-Z]{2}$/;

function esTipoDeDocumentoDeParte(texto: string): texto is TipoDeDocumentoDeParte {
  return (TIPOS_DE_DOCUMENTO_DE_PARTE as readonly string[]).includes(texto);
}

/** Código de país de dos letras mayúsculas (la forma de la base). */
export function esPaisDeParte(texto: string): boolean {
  return FORMATO_DE_PAIS.test(texto);
}

const conMayusculas = (texto: string): string => texto.replace(/[a-z]/g, (letra) => letra.toUpperCase());

/** DNI en su forma canónica (solo dígitos) o `null`. */
function dniDesdeTexto(texto: string): string | null {
  const canonico = FORMATO_DE_DNI_CON_PUNTOS.test(texto) ? texto.replaceAll(".", "") : texto;
  return FORMATO_DE_DNI.test(canonico) ? canonico : null;
}

/**
 * Valida y deja en su forma canónica el documento de una parte. El primer error, en el orden: tipo, naturaleza, y después el país y el número según el tipo. Los documentos argentinos no llevan país
 * (`PAIS_NO_CORRESPONDE` si llega uno); los dos extranjeros lo exigen (`PAIS_REQUERIDO` si falta, `PAIS_INVALIDO` si no tiene la forma).
 */
export function documentoDeParteDesdeDatos(naturaleza: NaturalezaDeParte, datos: DatosDeDocumento): ResultadoDeRegla<DocumentoDeParte, ErrorDeDocumentoDeParte> {
  const tipo = datos.tipo;
  if (!esTipoDeDocumentoDeParte(tipo)) return invalido("TIPO_DE_DOCUMENTO_INVALIDO");
  if (naturaleza === "JURIDICA" && !(TIPOS_DE_DOCUMENTO_DE_EMPRESA as readonly string[]).includes(tipo)) return invalido("DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA");
  const pais = datos.pais ?? null;

  if (tipo === "PASAPORTE" || tipo === "ID_EXTRANJERO") {
    if (pais === null) return invalido("PAIS_REQUERIDO");
    if (!esPaisDeParte(pais)) return invalido("PAIS_INVALIDO");
    const figura = conMayusculas(datos.numero);
    if (tipo === "PASAPORTE") return FORMATO_DE_PASAPORTE.test(figura) ? valido({ tipo, pais, numero: figura }) : invalido("PASAPORTE_INVALIDO");
    return FORMATO_DE_DOCUMENTO_EXTRANJERO.test(figura) ? valido({ tipo, pais, numero: figura }) : invalido("DOCUMENTO_EXTRANJERO_INVALIDO");
  }

  if (pais !== null) return invalido("PAIS_NO_CORRESPONDE");
  if (tipo === "DNI") {
    const dni = dniDesdeTexto(datos.numero);
    return dni === null ? invalido("DNI_INVALIDO") : valido({ tipo, pais: null, numero: dni });
  }
  const cuit = cuitCanonico(datos.numero);
  return cuit === null ? invalido("CUIT_INVALIDO") : valido({ tipo, pais: null, numero: cuit });
}

/**
 * La clave única del documento dentro de una empresa: `T` + número para CUIT, CUIL y CDI, `D` + número para el DNI, y la inicial del tipo + país + `:` + número para el pasaporte y el documento extranjero.
 * Idéntica a la columna generada de la base.
 */
export function documentoNormalizado(documento: DocumentoDeParte): string {
  switch (documento.tipo) {
    case "CUIT":
    case "CUIL":
    case "CDI":
      return `T${documento.numero}`;
    case "DNI":
      return `D${documento.numero}`;
    case "PASAPORTE":
    case "ID_EXTRANJERO":
      return `${documento.tipo.charAt(0)}${documento.pais}:${documento.numero}`;
  }
}

/**
 * Si lo que se escribió en el buscador es un documento, su clave en la forma de `documentoNormalizado` (para buscar «documento idéntico» primero): un CUIT válido (con o sin guiones) o un DNI válido (con o sin
 * puntos). Cualquier otro texto no es un documento (`null`): se busca solo por nombre.
 */
export function documentoBuscadoDesdeTexto(texto: string): string | null {
  const limpio = texto.trim();
  const cuit = cuitCanonico(limpio);
  if (cuit !== null) return `T${cuit}`;
  const dni = dniDesdeTexto(limpio);
  return dni === null ? null : `D${dni}`;
}
