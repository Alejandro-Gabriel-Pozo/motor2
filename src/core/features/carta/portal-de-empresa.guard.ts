import { leerDireccionDeImagen, type PartesDeImagen } from "@/core/carta/public";
import {
  centesimasDesdeTexto,
  esColorDePortalValido,
  esTelefonoDeTarjetaValido,
  esVarianteDePortal,
  lineaDelPortalDesdeTexto,
  tituloDelPortalDesdeTexto,
  zonaDentroDeLaImagen,
  type TarjetaDePortal,
} from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeFicha } from "@/core/datos/nombre-de-ficha";
import { MAXIMO_DE_TARJETAS_Y_ZONAS, type PedidoDeGuardarPortalDeEmpresa, type ZonaPedida } from "./portal-de-empresa.schema";

/**
 * Guard de la feature «portal de la empresa» (diseño `docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md` §7; Pedernal `validarPortal`): formato del pedido de «guardar el portal», ANTES de tocar la base; lo llama la Server Action DENTRO de su
 * `conPermisoDeEmpresa("carta_portal", …)`, así que el rechazo por permiso llega antes que el de formato. Puro. TODO NACE CERRADO: cada dato declara lo que se PERMITE (variante de una lista cerrada, textos de una línea con la lista de permitidos del catálogo, colores
 * `#rrggbb`, teléfono solo dígitos, ids con la forma de un id, imagen por partes de un proveedor de la lista cerrada, porcentajes con dos decimales dentro de la imagen), nunca lo que se prohíbe.
 *
 * Lo opcional vacío (texto en blanco, `null`, ausente) es «sin él»: el portal usa el valor por defecto. La imagen del portal es la excepción: AUSENTE (`undefined`) = conservar la que tiene (así cambiar de variante no pierde la imagen de la B) y vacío o `null` = quitarla.
 * La imagen y la foto de la tarjeta llegan como la dirección que pegó la persona (`https://res.cloudinary.com/…`): se leen contra la lista cerrada y lo que se guarda son las partes.
 */

const MENSAJE_PEDIDO_INVALIDO = "El pedido no es válido: recargá la pantalla.";
/** La forma de un id de sucursal (cuid o uuid: letras, dígitos, guion y guion bajo), de 1 a 64 caracteres. */
const FORMA_DE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_MAXIMA = 1_000_000;
const ORDEN_MAXIMO = 1_000_000;

const esId = (valor: unknown): valor is string => typeof valor === "string" && FORMA_DE_ID.test(valor);
const esObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Un texto opcional: ausente o en blanco es «sin él» (`null`); si trae algo tiene que ser válido (`mensaje` si no lo es). */
function textoOpcional(valor: unknown, convertir: (t: string) => { ok: true; valor: string } | { ok: false }, mensaje: string): ResultadoDato<string | null> {
  if (valor === undefined || valor === null) return aceptar(null);
  if (typeof valor !== "string") return rechazar("formato", mensaje);
  if (valor.trim() === "") return aceptar(null);
  const r = convertir(valor);
  return r.ok ? aceptar(r.valor) : rechazar("caracteres", mensaje);
}

function colorOpcional(valor: unknown, etiqueta: string): ResultadoDato<string | null> {
  if (valor === undefined || valor === null || valor === "") return aceptar(null);
  return esColorDePortalValido(valor) ? aceptar(valor) : rechazar("formato", `${etiqueta}: tiene que ser un color con la forma #rrggbb, en minúsculas.`);
}

/** Una dirección de imagen pegada: vacía o ausente = sin imagen; si trae algo, tiene que ser del proveedor permitido. */
function imagenOpcional(valor: unknown, mensaje: string): ResultadoDato<PartesDeImagen | null> {
  if (valor === undefined || valor === null) return aceptar(null);
  if (typeof valor !== "string") return rechazar("formato", mensaje);
  if (valor.trim() === "") return aceptar(null);
  const leida = leerDireccionDeImagen(valor);
  return leida.ok ? aceptar(leida.valor) : rechazar("formato", mensaje);
}

/** Un porcentaje de la imagen: texto decimal con hasta dos decimales (`"12.5"`) o un número finito; lo demás se rechaza. */
function aCentesimas(valor: unknown): number | null {
  const texto = typeof valor === "number" && Number.isFinite(valor) ? String(valor) : typeof valor === "string" ? valor.trim() : "";
  return centesimasDesdeTexto(texto);
}

function validarTarjeta(crudo: unknown): ResultadoDato<TarjetaDePortal> {
  if (!esObjeto(crudo) || !esId(crudo.sucursalId) || typeof crudo.visible !== "boolean") return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  const orden = crudo.orden;
  if (typeof orden !== "number" || !Number.isInteger(orden) || orden < 0 || orden > ORDEN_MAXIMO) return rechazar("rango", "El orden de una tarjeta tiene que ser un número entero de 0 en adelante.");
  let nombre: string | null = null;
  if (crudo.nombre !== undefined && crudo.nombre !== null && !(typeof crudo.nombre === "string" && crudo.nombre.trim() === "")) {
    const n = nombreDeFicha(crudo.nombre, "ELECCION", "El nombre de la tarjeta no puede estar vacío.");
    if (!n.ok) return rechazar(n.codigo, "El nombre de la tarjeta no es válido.");
    nombre = n.valor;
  }
  let telefono: string | null = null;
  if (crudo.telefono !== undefined && crudo.telefono !== null && crudo.telefono !== "") {
    const t = typeof crudo.telefono === "string" ? crudo.telefono.trim() : crudo.telefono;
    if (!esTelefonoDeTarjetaValido(t)) return rechazar("formato", "El teléfono de la tarjeta tiene que tener solo números (de 1 a 40), sin espacios ni signos.");
    telefono = t;
  }
  const foto = imagenOpcional(crudo.foto, "La foto de la tarjeta tiene que ser una dirección de imagen de un proveedor permitido (Cloudinary).");
  if (!foto.ok) return foto;
  return aceptar({ sucursalId: crudo.sucursalId, orden, visible: crudo.visible, nombre, telefono, foto: foto.valor });
}

function validarZona(crudo: unknown): ResultadoDato<ZonaPedida> {
  if (!esObjeto(crudo) || !esId(crudo.sucursalId) || typeof crudo.visible !== "boolean") return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  const x = aCentesimas(crudo.x);
  const y = aCentesimas(crudo.y);
  const ancho = aCentesimas(crudo.ancho);
  const alto = aCentesimas(crudo.alto);
  const mensaje = "Cada zona tiene que quedar dentro de la imagen: x, y, ancho y alto en % (de 0 a 100, hasta dos decimales), con ancho y alto mayores que 0.";
  if (x === null || y === null || ancho === null || alto === null) return rechazar("formato", mensaje);
  const rectangulo = { x, y, ancho, alto };
  return zonaDentroDeLaImagen(rectangulo) ? aceptar({ sucursalId: crudo.sucursalId, ...rectangulo, visible: crudo.visible }) : rechazar("rango", mensaje);
}

/** Valida las listas de tarjetas o de zonas: tope del pedido, cada elemento válido y una sola por sucursal. */
function validarLista<T extends { sucursalId: string }>(crudo: unknown, validar: (x: unknown) => ResultadoDato<T>, repetida: string): ResultadoDato<T[]> {
  if (crudo === undefined || crudo === null) return aceptar([]);
  if (!Array.isArray(crudo)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  if (crudo.length > MAXIMO_DE_TARJETAS_Y_ZONAS) return rechazar("rango", `Son demasiadas de una vez (el máximo es ${MAXIMO_DE_TARJETAS_Y_ZONAS}).`);
  const salida: T[] = [];
  for (const x of crudo as unknown[]) {
    const v = validar(x);
    if (!v.ok) return v;
    salida.push(v.valor);
  }
  if (new Set(salida.map((s) => s.sucursalId)).size !== salida.length) return rechazar("formato", repetida);
  return aceptar(salida);
}

/**
 * Valida el pedido de guardar el portal. `entrada` llega tal cual del navegador (`unknown`): variante, textos, colores, `logoVisible`, `imagen`, tarjetas, zonas y la versión que vio la pantalla (`versionEsperada`: un entero de 1 al tope, o ausente si la pantalla no vio ningún portal).
 */
export function guardComandoGuardarPortalDeEmpresa(entrada: unknown): ResultadoDato<PedidoDeGuardarPortalDeEmpresa> {
  if (!esObjeto(entrada)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  if (!esVarianteDePortal(entrada.variante)) return rechazar("formato", "La variante del portal no es válida: elegí «Tarjetas» (A) o «Imagen con zonas» (B).");
  if (typeof entrada.logoVisible !== "boolean") return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  const linea = textoOpcional(entrada.lineaSuperior, lineaDelPortalDesdeTexto, "La línea superior no es válida (hasta 40 caracteres, sin signos raros).");
  if (!linea.ok) return linea;
  const titulo = textoOpcional(entrada.titulo, tituloDelPortalDesdeTexto, "El título no es válido (hasta 60 caracteres, sin signos raros).");
  if (!titulo.ok) return titulo;
  const encabezado = colorOpcional(entrada.colorEncabezado, "Color del encabezado");
  if (!encabezado.ok) return encabezado;
  const pagina = colorOpcional(entrada.colorPagina, "Color de la página");
  if (!pagina.ok) return pagina;
  const detras = colorOpcional(entrada.colorDetras, "Color de detrás de la página");
  if (!detras.ok) return detras;
  let imagen: PartesDeImagen | null | undefined;
  if (entrada.imagen === undefined) imagen = undefined;
  else {
    const i = imagenOpcional(entrada.imagen, "La imagen del portal tiene que ser una dirección de imagen de un proveedor permitido (Cloudinary).");
    if (!i.ok) return i;
    imagen = i.valor;
  }
  const tarjetas = validarLista(entrada.tarjetas, validarTarjeta, "Hay dos tarjetas de la misma sucursal.");
  if (!tarjetas.ok) return tarjetas;
  const zonas = validarLista(entrada.zonas, validarZona, "Hay dos zonas de la misma sucursal.");
  if (!zonas.ok) return zonas;
  const v = entrada.versionEsperada;
  if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > VERSION_MAXIMA)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  return aceptar({
    datos: {
      variante: entrada.variante,
      lineaSuperior: linea.valor,
      titulo: titulo.valor,
      colorEncabezado: encabezado.valor,
      colorPagina: pagina.valor,
      colorDetras: detras.valor,
      logoVisible: entrada.logoVisible,
    },
    imagen,
    tarjetas: tarjetas.valor,
    zonas: zonas.valor,
    versionEsperada: v === undefined || v === null ? undefined : v,
  });
}
