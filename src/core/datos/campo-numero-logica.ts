import { validarCantidad } from "./cantidad";
import { validarImporte } from "./importe";
import { CONTEXTO_CANTIDAD_SIN_UNIDAD, CONTEXTO_IMPORTE, contextoDeCantidad, interpretarNumeroTecleado, leerNumeroCanonico, marcarNoCanonico, mensajeDeNumeroRechazado, sinMarcaDeNoCanonico, textoCanonico, textoParaEscribir, type ContextoNumerico } from "./numero-tecleado";

/**
 * La lógica PURA de `CampoNumero` (src/components/campo-numero.tsx; micro-paso 2c): qué contexto tiene un campo, qué emite cuando la persona teclea, cómo se ve y qué error dice. Vive acá, sin React, para
 * probarla con casos y propiedades; el componente solo conecta esto con el DOM.
 *
 * Dos textos distintos circulan por un campo numérico y no se mezclan:
 *  - lo que la persona TECLEA o PEGA: dígitos y UNA coma, se lee con `interpretarNumeroTecleado` y el contexto del campo (el «.» no existe: `aplicarEdicion`);
 *  - el «canal de valor» (lo que el campo emite, y lo que los formularios y la base le pasan: `value`, `defaultValue`, el campo oculto): dígitos y un punto decimal (`leerNumeroCanonico`).
 */

/**
 * El TIPO de dato que recibe un campo numérico (lo declara cada uso de `CampoNumero`; es obligatorio y lo bloquea el compilador, lote 6.33):
 *  - `importe`: plata, hasta 2 decimales.
 *  - `cantidad`: lo que se cuenta, pesa o mide, con los decimales de su unidad (`decimales`; sin ellos, los 4 de las columnas `Decimal(14,4)`).
 *  - `entero`: un número sin decimales (minutos, días, el número de una mesa). Es una cantidad de 0 decimales.
 *  - `porcentaje`: un porcentaje (merma, diferencia de precio), con los 4 decimales de su columna salvo que se diga otra cosa.
 */
export type TipoDeCampoNumerico = "importe" | "cantidad" | "entero" | "porcentaje";

/** El contexto del campo: un importe (2 decimales), un entero (0), una cantidad o un porcentaje (los de su unidad o columna, o, sin `decimales`, los 4: el máximo). */
export function contextoDelCampo(tipo: TipoDeCampoNumerico, decimales: number | undefined): ContextoNumerico {
  if (tipo === "importe") return CONTEXTO_IMPORTE;
  if (tipo === "entero") return contextoDeCantidad(0);
  return decimales === undefined ? CONTEXTO_CANTIDAD_SIN_UNIDAD : contextoDeCantidad(decimales);
}

/** El sujeto del mensaje cuando el uso no pone `etiqueta`: el nombre del tipo («El importe no es un número válido.»). */
const SUJETO_DEL_TIPO: Readonly<Record<TipoDeCampoNumerico, string>> = {
  importe: "El importe",
  cantidad: "La cantidad",
  entero: "El valor",
  porcentaje: "El porcentaje",
};

/**
 * Lo que el campo EMITE al tipear: vacío → ""; un número válido → su texto canónico; lo que no es un número en este contexto → el texto TAL CUAL (nunca "" ni "0"), marcado si PARECE canónico
 * (`marcarNoCanonico`) para que nadie lo lea como un número en silencio.
 */
export function valorAEmitir(texto: string, contexto: ContextoNumerico): string {
  const r = interpretarNumeroTecleado(texto, contexto);
  if (!r.ok) return marcarNoCanonico(texto);
  return r.valor === null ? "" : textoCanonico(r.valor);
}

/** «1234567» → «1.234.567»: el punto de miles lo agrega el sistema al mostrar (nunca se escribe). Sin `toLocaleString`: el de es-AR no agrupa los números de 4 cifras («1234»), y el dueño quiere «1.000,00» siempre. */
function conPuntosDeMiles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Un número como lo muestra el sistema: punto de miles, coma decimal, sin redondear ni esconder cifras (se ven las que tiene). Un `importe` siempre con 2 decimales («1.000,00»); lo demás, los que tenga
 * («1.234,5», «60»). Es el formato del campo: el de las tablas y los reportes es de otro módulo (formateo de salida).
 */
export function formatearNumeroDelCampo(n: number, tipo: TipoDeCampoNumerico): string {
  const [entero, decimal = ""] = textoCanonico(Math.abs(n)).split(".");
  const decimales = tipo === "importe" ? decimal.padEnd(2, "0") : decimal;
  return `${n < 0 ? "-" : ""}${conPuntosDeMiles(entero)}${decimales ? `,${decimales}` : ""}`;
}

/** Cómo se ve el valor del canal cuando el campo no tiene el foco: un número válido con puntos de miles y coma decimal; lo demás, lo que se escribió (sin la marca, que no se ve). */
export function textoParaVer(valor: string, tipo: TipoDeCampoNumerico): string {
  const r = leerNumeroCanonico(valor);
  if (!r.ok) return sinMarcaDeNoCanonico(valor);
  return r.valor === null ? "" : formatearNumeroDelCampo(r.valor, tipo);
}

/**
 * El número ENTENDIDO que se muestra junto al campo («= 1.234,50», «= $ 1.234,50», «= 60 g»): lo que el sistema va a guardar, en el formato de pantalla. `null` si el campo está vacío o lo tecleado no es un número
 * (en ese caso habla el error). Se calcula desde el valor EMITIDO, nunca desde el texto crudo.
 */
export function textoEntendido(valor: string, tipo: TipoDeCampoNumerico, unidad?: string): string | null {
  const r = leerNumeroCanonico(valor);
  if (!r.ok || r.valor === null) return null;
  const numero = formatearNumeroDelCampo(r.valor, tipo);
  return `= ${tipo === "importe" ? "$ " : ""}${numero}${unidad ? ` ${unidad}` : ""}`;
}

/** De dónde vino un cambio del texto del campo: una tecla (un carácter) o algo que entra de golpe (pegado, arrastrado, autocompletado, reemplazo). */
export type OrigenDeLaEdicion = "tecleado" | "pegado";

/** El origen de un cambio, según el `inputType` y el `data` del evento `input` del navegador: solo un carácter insertado por teclado (o por el teclado del celular) es «tecleado»; todo lo demás, «pegado». */
export function origenDeLaEdicion(inputType: string | undefined, data: string | null | undefined): OrigenDeLaEdicion {
  const porTeclado = inputType === "insertText" || inputType === "insertCompositionText";
  return porTeclado && data?.length === 1 ? "tecleado" : "pegado";
}

export interface ResultadoDeLaEdicion {
  /** El texto que queda en el campo. */
  texto: string;
  /** Dónde queda el cursor (`null` = al final: se rechazó todo y el campo vuelve a como estaba). */
  cursor: number | null;
  /** true si se mostró el aviso del «.» (se ignoró la tecla o se rechazó el pegado). */
  avisoDelPunto: boolean;
}

/**
 * La regla del «.» al ESCRIBIR (decisión del dueño, 2026-11-09): el campo numérico no acepta el punto. Una tecla «.» se ignora (el resto de lo escrito queda y el cursor no se corre) y se avisa; un pegado,
 * arrastre o autocompletado que trae un «.» se rechaza ENTERO (el campo queda como estaba) y se avisa: sin heurísticas, nunca se adivina si «1.234» eran mil doscientos o uno con coma. Sin «.», el texto pasa tal cual.
 * `anterior` es el texto antes del cambio; `nuevo`, el que dejó el navegador; `cursor`, su `selectionStart`.
 */
export function aplicarEdicion(anterior: string, nuevo: string, origen: OrigenDeLaEdicion, cursor: number | null): ResultadoDeLaEdicion {
  if (!nuevo.includes(".")) return { texto: nuevo, cursor, avisoDelPunto: false };
  if (origen === "pegado") return { texto: anterior, cursor: null, avisoDelPunto: true };
  const puntosAntesDelCursor = cursor === null ? 0 : nuevo.slice(0, cursor).split(".").length - 1;
  return { texto: nuevo.replaceAll(".", ""), cursor: cursor === null ? null : cursor - puntosAntesDelCursor, avisoDelPunto: true };
}

/**
 * El texto que se edita al tomar el foco: el número del canal con la COMA como decimal y sin separador de miles («1,205»), que con la regla de la notación argentina se lee igual en cualquier campo (el
 * canal, «1.205», se leería como ambiguo en uno de kilos). Un texto que no era un número se devuelve como se escribió.
 */
export function textoParaEditar(valor: string): string {
  const r = leerNumeroCanonico(valor);
  if (!r.ok) return sinMarcaDeNoCanonico(valor);
  return r.valor === null ? "" : textoParaEscribir(r.valor);
}

export interface OpcionesDeErrorDeCampo {
  tipo: TipoDeCampoNumerico;
  /** Sujeto del mensaje, en mayúscula («El precio»). */
  etiqueta?: string;
  permitirNegativo?: boolean;
}

/** Por qué el valor del canal no sirve: lo que se TECLEÓ y no es un número en este contexto («¿1,205 o 1205? Escribí 1205 o 1,205.»), o — con `tipo` — lo que dice la MISMA validación que la Server Action. */
export type ErrorDeCampoNumerico = { origen: "tecleado" | "regla"; mensaje: string };

export function errorDelCampo(valor: string, contexto: ContextoNumerico, { tipo, etiqueta, permitirNegativo }: OpcionesDeErrorDeCampo): ErrorDeCampoNumerico | null {
  const leido = leerNumeroCanonico(valor);
  if (!leido.ok) {
    const tecleado = interpretarNumeroTecleado(sinMarcaDeNoCanonico(valor), contexto);
    // Un texto que no es canónico pero que el parser SÍ entiende (un valor que llegó en otra notación por afuera) no es un error del campo.
    if (tecleado.ok) return null;
    // El mensaje lleva el sujeto del campo (como el de la Server Action): la etiqueta del uso o, si no hay, el nombre del tipo.
    return { origen: "tecleado", mensaje: mensajeDeNumeroRechazado(tecleado, etiqueta ?? SUJETO_DEL_TIPO[tipo]) };
  }
  if (leido.valor === null) return null;
  if (tipo === "importe") {
    const r = validarImporte(leido.valor, { etiqueta: etiqueta ?? "El importe", permitirNegativo });
    return r.ok ? null : { origen: "regla", mensaje: r.mensaje };
  }
  // Cantidad, entero y porcentaje: la misma regla, con los decimales del contexto. El cero lo decide cada proceso en el servidor (Ajuste lo admite): acá solo formato, signo, tope y decimales.
  const r = validarCantidad(leido.valor, { nombre: "", decimales: contexto.decimales }, { etiqueta: etiqueta ?? SUJETO_DEL_TIPO[tipo], permitirNegativo, permitirCero: true });
  return r.ok ? null : { origen: "regla", mensaje: r.mensaje };
}
