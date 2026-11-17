import { nombreDeFicha, nombreMinimoDeFicha } from "@/core/datos/nombre-de-ficha";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type {
  ComandoAgregarProductoAFamilia,
  ComandoCrearFamiliaDeProducto,
  ComandoEditarFamiliaDeProducto,
  ComandoFijarActivaFamiliaDeProducto,
  ComandoQuitarProductoDeFamilia,
} from "./familias.schema";

/**
 * Guard de la feature «familias de productos» (etapa F1). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa("carta_secciones", …)`, así que el rechazo por
 * permiso llega antes que el de formato. Puro. TODO NACE CERRADO: cada dato declara lo que se PERMITE (el nombre, con la regla de la ficha PRODUCTO: 1 a 120 y exige una letra; ids con la forma de un id; la versión,
 * un entero acotado; los interruptores, exactamente `true` o `false`), nunca lo que se prohíbe. El `id` de una fila nueva NO viaja en el pedido: lo agrega la Server Action (uuid del servidor).
 */

const MENSAJE_PEDIDO_INVALIDO = "El pedido no es válido: recargá la pantalla.";
const MENSAJE_NOMBRE_VACIO = "El nombre de la familia no puede estar vacío.";
/** La forma de un uuid en minúsculas (los ids de las familias): la base los guarda como `uuid` y rechazaría cualquier otra cosa con un error crudo. */
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** La forma de un id de producto (cuid: letras y dígitos), de 1 a 64 caracteres. */
const FORMA_DE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_MAXIMA = 1_000_000;

const esUuid = (valor: unknown): valor is string => typeof valor === "string" && FORMA_DE_UUID.test(valor);
const esId = (valor: unknown): valor is string => typeof valor === "string" && FORMA_DE_ID.test(valor);
const esVersion = (valor: unknown): valor is number => typeof valor === "number" && Number.isInteger(valor) && valor >= 1 && valor <= VERSION_MAXIMA;

/** «Crear una familia»: el nombre con la regla estricta de la ficha PRODUCTO (el nombre canónico es el que se guarda). */
export function guardComandoCrearFamiliaDeProducto(entrada: { nombre: unknown }): ResultadoDato<Omit<ComandoCrearFamiliaDeProducto, "id">> {
  const nombre = nombreDeFicha(entrada.nombre, "PRODUCTO", MENSAJE_NOMBRE_VACIO);
  if (!nombre.ok) return rechazar("formato", nombre.mensaje);
  return aceptar({ nombre: nombre.valor });
}

/**
 * «Editar una familia» (estado deseado): la familia (uuid), la versión vista, el nombre y los dos interruptores. En la EDICIÓN el guard no conoce el nombre guardado, así que solo aplica el mínimo (recortado, no vacío,
 * dentro del tope); el caso de uso aplica la regla estricta SOLO si el nombre cambió.
 */
export function guardComandoEditarFamiliaDeProducto(entrada: {
  familiaId: unknown;
  versionEsperada: unknown;
  nombre: unknown;
  agruparEnCarta: unknown;
  agruparEnPos: unknown;
}): ResultadoDato<ComandoEditarFamiliaDeProducto> {
  if (!esUuid(entrada.familiaId) || !esVersion(entrada.versionEsperada)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  if (typeof entrada.agruparEnCarta !== "boolean" || typeof entrada.agruparEnPos !== "boolean") return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  const nombre = nombreMinimoDeFicha(entrada.nombre, "PRODUCTO", MENSAJE_NOMBRE_VACIO);
  if (!nombre.ok) return rechazar("formato", nombre.mensaje);
  return aceptar({ familiaId: entrada.familiaId, versionEsperada: entrada.versionEsperada, nombre: nombre.valor, agruparEnCarta: entrada.agruparEnCarta, agruparEnPos: entrada.agruparEnPos });
}

/** «Desactivar o reactivar una familia» (estado deseado): la familia (uuid), la versión vista y `activa` (exactamente `true` o `false`). */
export function guardComandoFijarActivaFamiliaDeProducto(entrada: { familiaId: unknown; versionEsperada: unknown; activa: unknown }): ResultadoDato<ComandoFijarActivaFamiliaDeProducto> {
  if (!esUuid(entrada.familiaId) || !esVersion(entrada.versionEsperada) || typeof entrada.activa !== "boolean") return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  return aceptar({ familiaId: entrada.familiaId, versionEsperada: entrada.versionEsperada, activa: entrada.activa });
}

/** «Agregar un producto a una familia»: la familia (uuid) y el producto (un id). El `miembroId` lo agrega la Server Action. */
export function guardComandoAgregarProductoAFamilia(entrada: { familiaId: unknown; productoId: unknown }): ResultadoDato<Omit<ComandoAgregarProductoAFamilia, "miembroId">> {
  if (!esUuid(entrada.familiaId) || !esId(entrada.productoId)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  return aceptar({ familiaId: entrada.familiaId, productoId: entrada.productoId });
}

/** «Quitar un producto de una familia»: la familia (uuid), el producto (un id) y la versión vista de la familia. */
export function guardComandoQuitarProductoDeFamilia(entrada: { familiaId: unknown; productoId: unknown; versionEsperada: unknown }): ResultadoDato<ComandoQuitarProductoDeFamilia> {
  if (!esUuid(entrada.familiaId) || !esId(entrada.productoId) || !esVersion(entrada.versionEsperada)) return rechazar("formato", MENSAJE_PEDIDO_INVALIDO);
  return aceptar({ familiaId: entrada.familiaId, productoId: entrada.productoId, versionEsperada: entrada.versionEsperada });
}
