import { MAXIMO_CUPOS_POR_PROMO, validarTopeDeLista } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA, validarCantidadCupoPromo, validarOrdenCarta, validarPrecioCarta, validarTextoLibreCarta } from "@/core/carta/public";
import type { ComandoGuardarPromoCarta, CupoValidadoPromoCarta } from "./promos.schema";

/**
 * Guard de la feature «promos de la carta» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.2, paso H4C-2). Formato del comando, ANTES de tocar la
 * base; lo llama la Server Action DENTRO de su envoltorio, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * `guardarPromoCarta` valida TODO antes de la primera lectura y devuelve su rechazo en la acción. El precio local y los cupos (S-52) leen la promo primero (un id inexistente gana
 * sobre un dato inválido, fijado por tests): sus guards (`guardComandoGuardarPrecioLocalPromoCarta`, `guardComandoGuardarCuposPromoCarta`) también los calcula la acción con
 * lo que mandó el cliente, pero su RECHAZO lo aplica el caso de uso después de leer la promo. Mismos textos y mismo orden de siempre.
 */

/** Los datos de una promo tal como llegan del formulario del admin (los mismos campos que `DatosPromoCarta` de la Server Action). */
interface EntradaPromoCarta {
  id?: string;
  seccionCartaId: string;
  titulo: unknown;
  descripcion?: unknown;
  precio: unknown;
  orden?: unknown;
}

/**
 * Guard del comando «guardar una promo». Es EXACTAMENTE la validación que antes era lo primero de `guardarPromoCarta`, antes de leer la sección, con los MISMOS
 * textos y en el MISMO orden: el título (largo, y que no quede vacío: «La promo necesita un título.»), la descripción, el precio y el orden. Los ids pasan tal
 * cual (los resuelve el caso de uso).
 */
export function guardComandoGuardarPromoCarta(datos: EntradaPromoCarta): ResultadoDato<ComandoGuardarPromoCarta> {
  const titulo = validarTextoLibreCarta(datos.titulo, "El título", LARGO_MAXIMO_TITULO_CARTA);
  if (!titulo.ok) return rechazar("largo", titulo.mensaje);
  if (!titulo.valor) return rechazar("vacio", "La promo necesita un título.");
  const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!descripcion.ok) return rechazar("largo", descripcion.mensaje);
  const precio = validarPrecioCarta(datos.precio);
  if (!precio.ok) return rechazar("formato", precio.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({
    ...(datos.id ? { id: datos.id } : {}),
    seccionCartaId: datos.seccionCartaId,
    titulo: titulo.valor,
    descripcion: descripcion.valor,
    precio: precio.valor,
    orden: orden.valor,
  });
}

/**
 * Guard del comando «fijar el precio de una promo en la sucursal activa» (S-52): EXACTAMENTE la validación que antes vivía en el caso de uso, con los MISMOS textos: `null` o un
 * texto vacío = vuelve al precio de la empresa (`precioLocal: null`); si no, `validarPrecioCarta` (finito, ≥ 0, a lo sumo 2 decimales y menor que el tope de la columna: rechaza
 * NaN, ±Infinity, 1e308, un objeto, un arreglo). El piso contra los cupos lo decide el caso de uso (necesita la promo). Lo calcula la acción; su rechazo lo aplica el caso de
 * uso DESPUÉS de leer la promo.
 */
export function guardComandoGuardarPrecioLocalPromoCarta(entrada: { precioLocal: unknown }): ResultadoDato<{ precioLocal: number | null }> {
  const { precioLocal } = entrada;
  if (precioLocal === null || String(precioLocal).trim() === "") return aceptar({ precioLocal: null });
  // Un precio es un número o un texto con un número: un objeto o un arreglo no lo es (`Number([1])` es 1).
  const precio = validarPrecioCarta(typeof precioLocal === "object" ? Number.NaN : precioLocal);
  if (!precio.ok) return rechazar("formato", precio.mensaje);
  return aceptar({ precioLocal: precio.valor });
}

/**
 * Guard del comando «reemplazar todos los cupos de una promo» (S-52): EXACTAMENTE la validación del bucle que antes vivía en el caso de uso, con los MISMOS textos y en el MISMO
 * orden por cupo (la sección elegida, la sección repetida, el mínimo, el máximo, «al menos 1» y mínimo ≤ máximo), más lo que antes reventaba o no tenía tope: la lista tiene que
 * ser un arreglo de a lo sumo `MAXIMO_CUPOS_POR_PROMO` cupos y cada cupo un objeto con la sección como texto (un cupo `null` o con la sección numérica daba un error crudo). Lo
 * que dependa de la base (que las secciones existan, el piso del precio) lo decide el caso de uso. Lo calcula la acción; su rechazo lo aplica el caso de uso DESPUÉS de leer la promo.
 */
export function guardComandoGuardarCuposPromoCarta(entrada: { cupos: unknown }): ResultadoDato<readonly CupoValidadoPromoCarta[]> {
  const { cupos } = entrada;
  if (!Array.isArray(cupos)) return rechazar("formato", "Los cupos de la promo no son válidos.");
  const excede = validarTopeDeLista(cupos, "Los cupos", MAXIMO_CUPOS_POR_PROMO);
  if (excede) return rechazar("rango", excede);
  const seccionIds = new Set<string>();
  const validados: CupoValidadoPromoCarta[] = [];
  for (const [i, c] of (cupos as unknown[]).entries()) {
    const cupo = (typeof c === "object" && c !== null ? c : {}) as { seccionCartaId?: unknown; cantidadMinima?: unknown; cantidadMaxima?: unknown };
    if (typeof cupo.seccionCartaId !== "string" || !cupo.seccionCartaId) return rechazar("vacio", "Elegí la sección de cada cupo.");
    if (seccionIds.has(cupo.seccionCartaId)) return rechazar("formato", "No se puede repetir la misma sección de carta en dos cupos de la misma promo.");
    seccionIds.add(cupo.seccionCartaId);

    const minima = validarCantidadCupoPromo(cupo.cantidadMinima, "La cantidad mínima", 0);
    if (!minima.ok) return rechazar("rango", minima.mensaje);
    const maxima = validarCantidadCupoPromo(cupo.cantidadMaxima, "La cantidad máxima");
    if (!maxima.ok) return rechazar("rango", maxima.mensaje);
    if (maxima.valor < 1) return rechazar("rango", "La cantidad máxima de un cupo tiene que ser al menos 1.");
    if (minima.valor > maxima.valor) return rechazar("rango", "En cada cupo, el mínimo no puede ser mayor que el máximo.");

    validados.push({ seccionCartaId: cupo.seccionCartaId, cantidadMinima: minima.valor, cantidadMaxima: maxima.valor, orden: i });
  }
  return aceptar(validados);
}
