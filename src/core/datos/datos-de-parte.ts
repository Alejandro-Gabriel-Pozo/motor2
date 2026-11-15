import { esEmailValido } from "./email";
import { documentoDeParteDesdeDatos, esPaisDeParte, type DatosDeDocumento, type DocumentoDeParte, type NaturalezaDeParte } from "./documento-de-parte";
import { nombreODenominacionDesdeTexto } from "./fichas-de-texto";
import { textoDeUnaLineaDesdeTexto } from "./texto-de-catalogo";

/**
 * LOS DATOS DE UNA PARTE, validados campo por campo (ficha única de personas y empresas; docs/diseno-parte-2026-11-12.md §4.1; AGENTS.md «Paridad con Pedernal»): igual a `dominio/datos-de-parte.ts` de Pedernal.
 * Cada campo opcional vacío (ausente, `null` o en blanco) queda `null`. Devuelve TODOS los errores de una vez, uno por campo, para que la pantalla los marque juntos: el motivo es un CÓDIGO estable (la pantalla lo traduce a texto).
 * Todo es una lista de PERMITIDOS («todo nace cerrado», 2026-11-11): lo que no está declarado se rechaza. La base repite estas reglas con CHECK (`Parte_*_chk`, migración 20261115140000_parte_ficha_unica_p1); un test de paridad
 * compara las dos capas. Diferencias con Pedernal, cada una con su motivo: el nombre usa la ficha RAZON_SOCIAL de Motor2 (sin `¿ ¡ ? ! % $`, decisión del dueño D4, 2026-11-12); la nota rechaza controles e invisibles (R-2, D17, 2026-11-13).
 * Puro: sin reloj ni azar.
 */
export const LARGO_MAXIMO_DEL_APELLIDO_DE_PARTE = 100;
export const LARGO_MAXIMO_DEL_ALIAS_DE_PARTE = 100;
export const LARGO_MAXIMO_DE_LA_NOTA_DE_PARTE = 2000;
const LARGO_MAXIMO_DEL_TELEFONO = 40;
const LARGO_MAXIMO_DEL_DOMICILIO_LIBRE = 300;

/** Las once condiciones frente al IVA del receptor de WSFE v4.8 (la lista de la base, `Parte_condicionIva_chk`). Es la del RECEPTOR, aparte de la del emisor de `Empresa`. */
export const CONDICIONES_IVA_DE_PARTE = [
  "RESPONSABLE_INSCRIPTO", "EXENTO", "CONSUMIDOR_FINAL", "MONOTRIBUTO", "NO_CATEGORIZADO", "PROVEEDOR_DEL_EXTERIOR", "CLIENTE_DEL_EXTERIOR",
  "IVA_LIBERADO_LEY_19640", "MONOTRIBUTISTA_SOCIAL", "IVA_NO_ALCANZADO", "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO",
] as const;
export type CondicionIvaDeParte = (typeof CONDICIONES_IVA_DE_PARTE)[number];

/** Los 24 códigos ISO 3166-2:AR (la lista de la base, `Parte_domProvincia_chk`). */
export const PROVINCIAS_DE_PARTE = [
  "AR-A", "AR-B", "AR-C", "AR-D", "AR-E", "AR-F", "AR-G", "AR-H", "AR-J", "AR-K", "AR-L", "AR-M", "AR-N", "AR-P", "AR-Q", "AR-R", "AR-S", "AR-T", "AR-U", "AR-V", "AR-W", "AR-X", "AR-Y", "AR-Z",
] as const;

/** Un domicilio argentino estructurado, tal como llega. */
export type DomicilioArgentinoEntrada = Readonly<{ calle: string; numero: string; piso?: string | null; departamento?: string | null; localidad: string; provincia: string; codigoPostal?: string | null }>;
/** Un domicilio argentino (estructurado) o del exterior (una línea de texto), tal como llega. */
export type DomicilioDeParteEntrada = Readonly<{ pais: string; estructurado?: DomicilioArgentinoEntrada | null; texto?: string | null }>;

export type EntradaDeParte = Readonly<{
  naturaleza: string;
  nombre: string;
  apellido?: string | null;
  alias?: string | null;
  documento?: DatosDeDocumento | null;
  condicionIva?: string | null;
  email?: string | null;
  telefono?: string | null;
  domicilio?: DomicilioDeParteEntrada | null;
  nota?: string | null;
}>;

export type DomicilioDeParte =
  | Readonly<{ pais: "AR"; calle: string; numero: string; piso: string | null; departamento: string | null; localidad: string; provincia: string; codigoPostal: string | null }>
  | Readonly<{ pais: string; texto: string }>;

export type DatosDeParte = Readonly<{
  naturaleza: NaturalezaDeParte;
  nombre: string;
  apellido: string | null;
  alias: string | null;
  documento: DocumentoDeParte | null;
  condicionIva: CondicionIvaDeParte | null;
  email: string | null;
  telefono: string | null;
  domicilio: DomicilioDeParte | null;
  nota: string | null;
}>;

export type CampoDeParte = "naturaleza" | "nombre" | "apellido" | "alias" | "documento" | "condicionIva" | "email" | "telefono" | "domicilio" | "nota";
export type ErrorDeCampoDeParte = Readonly<{ campo: CampoDeParte; codigo: string }>;
/** Los datos validados, o TODOS los errores (uno por campo). */
export type ResultadoDeDatosDeParte = { readonly ok: true; readonly valor: DatosDeParte } | { readonly ok: false; readonly errores: readonly ErrorDeCampoDeParte[] };

/** Recorta; lo ausente, nulo o en blanco es `null`. */
const opcional = (valor: string | null | undefined): string | null => {
  const limpio = typeof valor === "string" ? valor.trim() : "";
  return limpio === "" ? null : limpio;
};

/** Lo que admite un teléfono: una línea con letras, marcas, números, puntuación, símbolos y espacio común (la base: `[[:print:]]`). */
const SOLO_PERMITIDOS_DEL_TELEFONO = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u;
/** Lo que admite una línea de la nota (la misma lista de permitidos que el texto libre de la carta): sin controles, invisibles ni de dirección de texto; el salto de línea separa líneas. */
const SOLO_PERMITIDOS_DE_UNA_LINEA_DE_NOTA = /^[\p{L}\p{M}\p{N}\p{P}\p{S}  ]+$/u;
const FORMATO_DE_NUMERO_DE_CALLE = /^([0-9]{1,6}|S\/N)$/;
const FORMATO_DE_CODIGO_POSTAL = /^[A-Z0-9]{4,8}$/;

const largoEnCaracteres = (texto: string): number => [...texto].length;

/** La nota en su forma canónica (saltos `\r\n` como `\n`) o `null` si no cumple (largo, caracteres no permitidos). */
function notaDesdeTexto(texto: string): string | null {
  const nota = texto.replace(/\r\n?/g, "\n");
  if (largoEnCaracteres(nota) > LARGO_MAXIMO_DE_LA_NOTA_DE_PARTE) return null;
  return nota.split("\n").every((linea) => linea === "" || SOLO_PERMITIDOS_DE_UNA_LINEA_DE_NOTA.test(linea)) ? nota : null;
}

type Falla = (campo: CampoDeParte, codigo: string) => null;

function textoOpcional(texto: string | null | undefined, maximo: number, exigirUnaLetra: boolean, campo: CampoDeParte, codigo: string, falla: Falla): string | null {
  const limpio = opcional(texto);
  if (limpio === null) return null;
  const r = textoDeUnaLineaDesdeTexto(limpio, { maximo, exigirUnaLetra });
  return r.ok ? r.valor : falla(campo, codigo);
}

function domicilioDeEntrada(entrada: DomicilioDeParteEntrada, falla: Falla): DomicilioDeParte | null {
  const pais = opcional(entrada.pais);
  if (pais === null || !esPaisDeParte(pais)) return falla("domicilio", "PAIS_INVALIDO");
  const estructurado = entrada.estructurado ?? null;
  const libre = opcional(entrada.texto);
  if (pais === "AR") {
    if (estructurado === null || libre !== null) return falla("domicilio", "DOMICILIO_INVALIDO");
    const calle = textoDeUnaLineaDesdeTexto(opcional(estructurado.calle) ?? "", { maximo: 100, exigirUnaLetra: false });
    const localidad = textoDeUnaLineaDesdeTexto(opcional(estructurado.localidad) ?? "", { maximo: 100, exigirUnaLetra: true });
    const numero = opcional(estructurado.numero);
    const provincia = opcional(estructurado.provincia);
    const codigoPostal = opcional(estructurado.codigoPostal);
    const piso = opcional(estructurado.piso) === null ? { ok: true as const, valor: null } : textoDeUnaLineaDesdeTexto(opcional(estructurado.piso) ?? "", { maximo: 20, exigirUnaLetra: false });
    const departamento = opcional(estructurado.departamento) === null ? { ok: true as const, valor: null } : textoDeUnaLineaDesdeTexto(opcional(estructurado.departamento) ?? "", { maximo: 20, exigirUnaLetra: false });
    if (!calle.ok || !localidad.ok || !piso.ok || !departamento.ok || numero === null || !FORMATO_DE_NUMERO_DE_CALLE.test(numero)) return falla("domicilio", "DOMICILIO_INVALIDO");
    if (provincia === null || !(PROVINCIAS_DE_PARTE as readonly string[]).includes(provincia)) return falla("domicilio", "DOMICILIO_INVALIDO");
    if (codigoPostal !== null && !FORMATO_DE_CODIGO_POSTAL.test(codigoPostal)) return falla("domicilio", "DOMICILIO_INVALIDO");
    return { pais: "AR", calle: calle.valor, numero, piso: piso.valor, departamento: departamento.valor, localidad: localidad.valor, provincia, codigoPostal };
  }
  if (estructurado !== null) return falla("domicilio", "DOMICILIO_INVALIDO");
  const texto = libre === null ? null : textoDeUnaLineaDesdeTexto(libre, { maximo: LARGO_MAXIMO_DEL_DOMICILIO_LIBRE, exigirUnaLetra: false });
  return texto !== null && texto.ok ? { pais, texto: texto.valor } : falla("domicilio", "DOMICILIO_INVALIDO");
}

export function validarDatosDeParte(entrada: EntradaDeParte): ResultadoDeDatosDeParte {
  const errores: ErrorDeCampoDeParte[] = [];
  const falla: Falla = (campo, codigo) => {
    errores.push({ campo, codigo });
    return null;
  };
  if (entrada.naturaleza !== "HUMANA" && entrada.naturaleza !== "JURIDICA") return { ok: false, errores: [{ campo: "naturaleza", codigo: "NATURALEZA_INVALIDA" }] };
  const naturaleza = entrada.naturaleza;

  const nombreValido = nombreODenominacionDesdeTexto(entrada.nombre);
  const nombre = nombreValido.ok ? nombreValido.valor : falla("nombre", nombreValido.error === "VACIO" ? "NOMBRE_REQUERIDO" : "NOMBRE_INVALIDO");

  let apellido: string | null = null;
  if (opcional(entrada.apellido) !== null) {
    apellido = naturaleza === "JURIDICA" ? falla("apellido", "APELLIDO_SOLO_DE_PERSONA") : textoOpcional(entrada.apellido, LARGO_MAXIMO_DEL_APELLIDO_DE_PARTE, true, "apellido", "APELLIDO_INVALIDO", falla);
  }
  const alias = textoOpcional(entrada.alias, LARGO_MAXIMO_DEL_ALIAS_DE_PARTE, true, "alias", "ALIAS_INVALIDO", falla);

  let documento: DocumentoDeParte | null = null;
  if (entrada.documento !== undefined && entrada.documento !== null) {
    const r = documentoDeParteDesdeDatos(naturaleza, entrada.documento);
    documento = r.ok ? r.valor : falla("documento", r.error);
  }

  let condicionIva: CondicionIvaDeParte | null = null;
  const condicionTexto = opcional(entrada.condicionIva);
  if (condicionTexto !== null) condicionIva = (CONDICIONES_IVA_DE_PARTE as readonly string[]).includes(condicionTexto) ? (condicionTexto as CondicionIvaDeParte) : falla("condicionIva", "CONDICION_IVA_INVALIDA");

  let email: string | null = null;
  const emailTexto = opcional(entrada.email);
  if (emailTexto !== null) email = esEmailValido(emailTexto.toLowerCase()) ? emailTexto.toLowerCase() : falla("email", "EMAIL_INVALIDO");

  let telefono: string | null = null;
  const telefonoTexto = opcional(entrada.telefono);
  if (telefonoTexto !== null) telefono = largoEnCaracteres(telefonoTexto) <= LARGO_MAXIMO_DEL_TELEFONO && SOLO_PERMITIDOS_DEL_TELEFONO.test(telefonoTexto) ? telefonoTexto : falla("telefono", "TELEFONO_INVALIDO");

  const domicilio = entrada.domicilio === undefined || entrada.domicilio === null ? null : domicilioDeEntrada(entrada.domicilio, falla);

  let nota: string | null = null;
  const notaTexto = opcional(entrada.nota);
  if (notaTexto !== null) nota = notaDesdeTexto(notaTexto) ?? falla("nota", "NOTA_INVALIDA");

  if (errores.length > 0 || nombre === null) return { ok: false, errores };
  return { ok: true, valor: { naturaleza, nombre, apellido, alias, documento, condicionIva, email, telefono, domicilio, nota } };
}

/** Las columnas de "Parte" que lleva una ficha validada (todas las de identidad; las que no se dijeron, `null`). Es lo que se inserta o se actualiza. */
export function columnasDeParte(datos: DatosDeParte) {
  const d = datos.domicilio;
  const ar = d !== null && d.pais === "AR" ? (d as Extract<DomicilioDeParte, { pais: "AR" }>) : null;
  return {
    naturaleza: datos.naturaleza,
    nombre: datos.nombre,
    apellido: datos.apellido,
    alias: datos.alias,
    documentoTipo: datos.documento?.tipo ?? null,
    documentoPais: datos.documento?.pais ?? null,
    documentoNumero: datos.documento?.numero ?? null,
    condicionIva: datos.condicionIva,
    email: datos.email,
    telefono: datos.telefono,
    domPais: d?.pais ?? null,
    domCalle: ar?.calle ?? null,
    domNumero: ar?.numero ?? null,
    domPiso: ar?.piso ?? null,
    domDepartamento: ar?.departamento ?? null,
    domLocalidad: ar?.localidad ?? null,
    domProvincia: ar?.provincia ?? null,
    domCodigoPostal: ar?.codigoPostal ?? null,
    domTexto: d !== null && d.pais !== "AR" ? (d as Extract<DomicilioDeParte, { texto: string }>).texto : null,
    nota: datos.nota,
  };
}
