import { validarImporte } from "@/core/datos/importe";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeCatalogo } from "./nombre-de-catalogo";
import type { ComandoDuplicarProducto } from "./duplicar-producto.schema";

/**
 * Guard de la feature «Duplicar producto» (convención «guard por feature»; etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`). Formato y rango del comando, ANTES de tocar la base; lo
 * llama la Server Action DENTRO de su `conPermisoDeEmpresa("alta_producto", …)`, así que el rechazo por permiso llega antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Lo que decide: los dos ids son texto (el del duplicado con la forma de un identificador que genera la aplicación: letras, números, guion y guion bajo, de 16 a 64 caracteres), el nombre propio (recortado,
 * no vacío, caracteres y largo de catálogo: el mismo de un alta), los dos «qué copiar» son verdaderos o falsos (un valor que no es booleano se rechaza: no se interpreta), la sucursal de la receta es un texto
 * o `null` (la Central) y el precio, si viene, es un importe válido (≥ 0, hasta 2 decimales, bajo el tope). La sucursal solo se conserva con `copiarReceta`: sin receta que copiar no se lee.
 */

const FORMA_DEL_ID_DEL_DUPLICADO = /^[A-Za-z0-9_-]{16,64}$/;
const LARGO_MAXIMO_DE_ID = 64;

export function guardComandoDuplicarProducto(entrada: {
  duplicadoId: unknown;
  origenId: unknown;
  nombre: unknown;
  copiarReceta: unknown;
  copiarOpciones: unknown;
  sucursalDeLaRecetaId: unknown;
  precioVenta: unknown;
}): ResultadoDato<ComandoDuplicarProducto> {
  const { duplicadoId, origenId, copiarReceta, copiarOpciones, sucursalDeLaRecetaId, precioVenta } = entrada;
  if (typeof origenId !== "string" || origenId === "" || origenId.length > LARGO_MAXIMO_DE_ID) return rechazar("formato", "No se encontró el producto.");
  if (typeof duplicadoId !== "string" || !FORMA_DEL_ID_DEL_DUPLICADO.test(duplicadoId)) {
    return rechazar("formato", "No se pudo identificar este pedido de duplicado. Recargá la pantalla y volvé a intentar.");
  }
  // Un nombre que no es texto (un número, un objeto) no se «convierte»: es un pedido mal armado.
  if (entrada.nombre !== undefined && entrada.nombre !== null && typeof entrada.nombre !== "string") return rechazar("formato", "El nombre del producto nuevo no es válido.");
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre del producto nuevo no puede estar vacío.", "El nombre");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  if (typeof copiarReceta !== "boolean" || typeof copiarOpciones !== "boolean") return rechazar("formato", "No se entendió qué copiar. Recargá la pantalla y volvé a intentar.");
  if (sucursalDeLaRecetaId !== null && sucursalDeLaRecetaId !== undefined && (typeof sucursalDeLaRecetaId !== "string" || sucursalDeLaRecetaId === "" || sucursalDeLaRecetaId.length > LARGO_MAXIMO_DE_ID)) {
    return rechazar("formato", "No se encontró esa sucursal.");
  }
  let precio: number | null = null;
  if (precioVenta !== null && precioVenta !== undefined) {
    const importe = validarImporte(precioVenta, { etiqueta: "El precio de venta" });
    if (!importe.ok) return rechazar(importe.codigo, importe.mensaje);
    precio = importe.valor;
  }
  return aceptar({
    duplicadoId,
    origenId,
    nombre: nombre.valor,
    copiarReceta,
    copiarOpciones,
    sucursalDeLaRecetaId: copiarReceta && typeof sucursalDeLaRecetaId === "string" ? sucursalDeLaRecetaId : null,
    precioVenta: precio,
  });
}
