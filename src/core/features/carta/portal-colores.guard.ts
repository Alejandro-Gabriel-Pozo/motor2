import { MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL, leerDireccionDeImagen, lineaDelPortalDesdeTexto, tituloDelPortalDesdeTexto, type PartesDeImagen } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { PedidoDeGuardarColoresDelPortal } from "./portal-colores.schema";

/**
 * Guard de «colores del portal» (pantalla simple): formato del pedido ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa("carta_portal", …)`. Puro. TODO NACE CERRADO: cada dato declara lo que se PERMITE (color `#rrggbb`, textos de una línea con la lista
 * de permitidos del catálogo, imagen de un proveedor de la lista cerrada). Un color se acepta en mayúsculas o minúsculas y se guarda en minúsculas (Pedernal `colorDeLaCarta` hace lo mismo, `color-de-la-carta.ts:104`); un color que no se lee NO se rechaza: se ajusta al mostrar.
 * Los textos mantienen las reglas de Pedernal (`datos-de-portal.ts`): la línea superior hasta 40 y el título hasta 60.
 */

const MENSAJE_PEDIDO_INVALIDO = "El pedido no es válido: recargá la pantalla.";
const FORMA_DEL_COLOR = /^#[0-9a-fA-F]{6}$/;
const VERSION_MAXIMA = 1_000_000;

const esObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);

function color(valor: unknown, etiqueta: string): ResultadoDato<string | null> {
  if (valor === undefined || valor === null || valor === "") return aceptar(null);
  return typeof valor === "string" && FORMA_DEL_COLOR.test(valor) ? aceptar(valor.toLowerCase()) : rechazar("formato", `${etiqueta}: ${MENSAJE_FORMATO_DEL_COLOR_DEL_PORTAL} (un # y seis números o letras de la a a la f).`);
}

function texto(valor: unknown, convertir: typeof lineaDelPortalDesdeTexto, mensaje: string): ResultadoDato<string | null> {
  if (valor === undefined || valor === null) return aceptar(null);
  if (typeof valor !== "string") return rechazar("formato", mensaje);
  if (valor.trim() === "") return aceptar(null);
  const r = convertir(valor);
  return r.ok ? aceptar(r.valor) : rechazar("caracteres", mensaje);
}

/** Valida el pedido de guardar los colores del portal. `entrada` llega tal cual del navegador (`unknown`). */
export function guardComandoGuardarColoresDelPortal(entrada: unknown): ResultadoDato<PedidoDeGuardarColoresDelPortal> {
  if (!esObjeto(entrada) || typeof entrada.logoVisible !== "boolean") return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  const encabezado = color(entrada.colorEncabezado, "Encabezado");
  if (!encabezado.ok) return encabezado;
  const pagina = color(entrada.colorPagina, "Página");
  if (!pagina.ok) return pagina;
  const detras = color(entrada.colorDetras, "Detrás de la imagen");
  if (!detras.ok) return detras;
  const linea = texto(entrada.lineaSuperior, lineaDelPortalDesdeTexto, "La línea sobre el título no es válida (hasta 40 caracteres, sin signos raros).");
  if (!linea.ok) return linea;
  const titulo = texto(entrada.titulo, tituloDelPortalDesdeTexto, "El título no es válido (hasta 60 caracteres, sin signos raros).");
  if (!titulo.ok) return titulo;
  let imagen: PartesDeImagen | null | undefined;
  if (entrada.imagen === undefined) imagen = undefined;
  else if (entrada.imagen === null || (typeof entrada.imagen === "string" && entrada.imagen.trim() === "")) imagen = null;
  else {
    const leida = typeof entrada.imagen === "string" ? leerDireccionDeImagen(entrada.imagen) : null;
    if (leida === null || !leida.ok) return rechazar("formato", "La imagen del portal tiene que ser una dirección de imagen de un proveedor permitido (Cloudinary).");
    imagen = leida.valor;
  }
  const v = entrada.versionEsperada;
  if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > VERSION_MAXIMA)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  return aceptar({
    colorEncabezado: encabezado.valor,
    colorPagina: pagina.valor,
    colorDetras: detras.valor,
    lineaSuperior: linea.valor,
    titulo: titulo.valor,
    logoVisible: entrada.logoVisible,
    imagen,
    versionEsperada: typeof v === "number" ? v : undefined,
  });
}
