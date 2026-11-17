import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { esModoDeOrdenDeSeccion, validarOrdenCarta } from "@/core/carta/public";
import {
  MAXIMO_DE_RENGLONES_AL_ORDENAR,
  TIPOS_DE_RENGLON_DE_CARTA,
  type ComandoFijarModoDeOrdenDeSeccion,
  type ComandoReordenarRenglonesDeSeccion,
  type RenglonPedidoAlOrdenar,
  type TipoDeRenglonDeCarta,
} from "./orden-de-renglones.schema";

/**
 * Guard de la feature «orden de los renglones de una sección» (etapa O1). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermiso(…)`, así que el rechazo por permiso
 * llega antes que el de formato. Puro. TODO NACE CERRADO: cada dato declara lo que se PERMITE (modo de una lista cerrada, ids con la forma de un id, versión entera acotada, tope de renglones), nunca lo que se prohíbe.
 */

const MENSAJE_PEDIDO_INVALIDO = "El pedido no es válido: recargá la pantalla.";
/** La forma de un id (los de la base son cuid o uuid: letras, dígitos, guion y guion bajo), de 1 a 64 caracteres. */
const FORMA_DE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_MAXIMA = 1_000_000;

const esId = (valor: unknown): valor is string => typeof valor === "string" && FORMA_DE_ID.test(valor);
const esTipo = (valor: unknown): valor is TipoDeRenglonDeCarta => typeof valor === "string" && (TIPOS_DE_RENGLON_DE_CARTA as readonly string[]).includes(valor);

/** Guard del comando «fijar el modo de orden de una sección»: la sección (un id), el modo (uno de la lista cerrada) y la versión vista (entero de 0 al tope; 0 = sin fila). */
export function guardComandoFijarModoDeOrdenDeSeccion(entrada: { seccionCartaId: unknown; modo: unknown; versionVista: unknown }): ResultadoDato<Omit<ComandoFijarModoDeOrdenDeSeccion, "modoId">> {
  if (!esId(entrada.seccionCartaId)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  if (!esModoDeOrdenDeSeccion(entrada.modo)) return rechazar("formato", "El modo de orden no es válido: elegí «Alfabético» o «A mano».");
  const v = entrada.versionVista;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > VERSION_MAXIMA) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  return aceptar({ seccionCartaId: entrada.seccionCartaId, modo: entrada.modo, versionVista: v });
}

/**
 * Guard del comando «reordenar los renglones de una sección»: la sección (un id) y la lista (de 1 al tope, sin repetidos por `{tipo, id}`); cada renglón con un tipo de la lista cerrada, un id con forma de id y el
 * `ordenVisto` como número entero dentro del tope del orden de la carta (`validarOrdenCarta`; tiene que llegar como número, no como texto).
 */
export function guardComandoReordenarRenglonesDeSeccion(entrada: { seccionCartaId: unknown; renglones: unknown }): ResultadoDato<ComandoReordenarRenglonesDeSeccion> {
  if (!esId(entrada.seccionCartaId)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  if (!Array.isArray(entrada.renglones) || entrada.renglones.length === 0) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  if (entrada.renglones.length > MAXIMO_DE_RENGLONES_AL_ORDENAR) return rechazar("rango", `Son demasiados renglones de una vez (el máximo es ${MAXIMO_DE_RENGLONES_AL_ORDENAR}).`);
  const renglones: RenglonPedidoAlOrdenar[] = [];
  const vistos = new Set<string>();
  for (const x of entrada.renglones as unknown[]) {
    const { tipo, id, ordenVisto } = (typeof x === "object" && x !== null ? x : {}) as { tipo?: unknown; id?: unknown; ordenVisto?: unknown };
    if (!esTipo(tipo) || !esId(id)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
    const clave = `${tipo}:${id}`;
    if (vistos.has(clave)) return rechazar("formato", "El orden repite un renglón: recargá la pantalla.");
    vistos.add(clave);
    const orden = typeof ordenVisto === "number" ? validarOrdenCarta(ordenVisto) : null;
    if (!orden?.ok) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
    renglones.push({ tipo, id, ordenVisto: orden.valor });
  }
  return aceptar({ seccionCartaId: entrada.seccionCartaId, renglones });
}
