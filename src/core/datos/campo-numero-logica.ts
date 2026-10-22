import { validarCantidad } from "./cantidad";
import { validarImporte } from "./importe";
import { CONTEXTO_CANTIDAD_SIN_UNIDAD, CONTEXTO_IMPORTE, contextoDeCantidad, interpretarNumeroTecleado, leerNumeroCanonico, marcarNoCanonico, mensajeDeNumeroRechazado, sinMarcaDeNoCanonico, textoCanonico, textoParaEscribir, type ContextoNumerico } from "./numero-tecleado";

/**
 * La lógica PURA de `CampoNumero` (src/components/campo-numero.tsx; micro-paso 2c): qué contexto tiene un campo, qué emite cuando la persona teclea, cómo se ve y qué error dice. Vive acá, sin React, para
 * probarla con casos y propiedades; el componente solo conecta esto con el DOM.
 *
 * Dos textos distintos circulan por un campo numérico y no se mezclan:
 *  - lo que la persona TECLEA: notación argentina, se lee con `interpretarNumeroTecleado` y el contexto del campo;
 *  - el «canal de valor» (lo que el campo emite, y lo que los formularios y la base le pasan: `value`, `defaultValue`, el campo oculto): dígitos y un punto decimal (`leerNumeroCanonico`).
 */

export type TipoDeCampoNumerico = "importe" | "cantidad";

/** El contexto del campo: un importe (2 decimales), una cantidad (los de su unidad) o, sin tipo y sin decimales, una cantidad de unidad desconocida (4: el máximo, así «1.205» nunca se adivina). */
export function contextoDelCampo(tipo: TipoDeCampoNumerico | undefined, decimales: number | undefined): ContextoNumerico {
  if (tipo === "importe") return CONTEXTO_IMPORTE;
  return decimales === undefined ? CONTEXTO_CANTIDAD_SIN_UNIDAD : contextoDeCantidad(decimales);
}

/**
 * Lo que el campo EMITE al tipear: vacío → ""; un número válido → su texto canónico; lo que no es un número en este contexto → el texto TAL CUAL (nunca "" ni "0"), marcado si PARECE canónico
 * (`marcarNoCanonico`) para que nadie lo lea como un número en silencio.
 */
export function valorAEmitir(texto: string, contexto: ContextoNumerico): string {
  const r = interpretarNumeroTecleado(texto, contexto);
  if (!r.ok) return marcarNoCanonico(texto);
  return r.valor === null ? "" : textoCanonico(r.valor);
}

/** Cómo se ve el valor del canal cuando el campo no tiene el foco: un número válido en es-AR; lo demás, lo que se escribió (sin la marca, que no se ve). */
export function textoParaVer(valor: string): string {
  const r = leerNumeroCanonico(valor);
  if (!r.ok) return sinMarcaDeNoCanonico(valor);
  return r.valor === null ? "" : r.valor.toLocaleString("es-AR", { maximumFractionDigits: 4 });
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
  tipo?: TipoDeCampoNumerico;
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
    // Con tipo, el mensaje lleva el sujeto del campo (como el de la Server Action); sin tipo, el del parser tal cual.
    const sujeto = etiqueta ?? (tipo === "importe" ? "El importe" : tipo === "cantidad" ? "La cantidad" : undefined);
    return { origen: "tecleado", mensaje: mensajeDeNumeroRechazado(tecleado, tipo === undefined ? etiqueta : sujeto) };
  }
  if (leido.valor === null) return null;
  if (tipo === "importe") {
    const r = validarImporte(leido.valor, { etiqueta: etiqueta ?? "El importe", permitirNegativo });
    return r.ok ? null : { origen: "regla", mensaje: r.mensaje };
  }
  if (tipo === "cantidad") {
    // El cero lo decide cada proceso en el servidor (Ajuste lo admite): acá solo formato, signo, tope y decimales.
    const r = validarCantidad(leido.valor, { nombre: "", decimales: contexto.decimales }, { etiqueta: etiqueta ?? "La cantidad", permitirNegativo, permitirCero: true });
    return r.ok ? null : { origen: "regla", mensaje: r.mensaje };
  }
  return null;
}
