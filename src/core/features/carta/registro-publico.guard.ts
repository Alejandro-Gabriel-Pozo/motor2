import {
  LARGO_MAXIMO_ETIQUETA_PORTAL,
  LARGO_MAXIMO_SUBTITULO_PORTAL,
  validarOrdenCarta,
  validarPosicionPortal,
  validarSlugTenant,
  validarTextoLibreCarta,
} from "@/core/carta/public";
import { esIdentificador } from "@/core/datos/identificador";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type {
  ComandoAgregarSucursalAlPortal,
  ComandoGuardarSucursalPublica,
  ComandoMoverSucursalEnMapa,
  ComandoQuitarSucursalDelPortal,
} from "./registro-publico.schema";

/**
 * Guard de la feature «registro público de las sucursales en el portal» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md`
 * §6.1). Formato del comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa("carta_portal", …)`, así que el rechazo por permiso
 * sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Lo primero de cada acción era comprobar que el `sucursalId` sea un texto no vacío (un `undefined` en un `where` de Prisma toca la primera fila o todas): eso es el
 * guard de las cuatro. `guardarSucursalPublica` además validaba todo el formulario antes de leer. `moverSucursalEnMapa` valida la posición DESPUÉS de leer la fila
 * (necesita el ancho y el alto que ya tiene), así que su guard solo mira el id.
 */

const SUCURSAL_INVALIDA = "Sucursal inválida.";

/** Guard del comando «agregar la sucursal al portal»: que el id sea un texto no vacío. */
export function guardComandoAgregarSucursalAlPortal(sucursalId: unknown): ResultadoDato<ComandoAgregarSucursalAlPortal> {
  if (!esIdentificador(sucursalId)) return rechazar("vacio", SUCURSAL_INVALIDA);
  return aceptar({ sucursalId });
}

/** Los datos del registro público tal como llegan del formulario del admin (los mismos campos que `DatosSucursalPublica` de la Server Action). */
interface EntradaSucursalPublica {
  slug: unknown;
  etiqueta?: unknown;
  subtituloPortal?: unknown;
  posX?: unknown;
  posY?: unknown;
  posW?: unknown;
  posH?: unknown;
  orden?: unknown;
  publicada: boolean;
}

/**
 * Guard del comando «guardar el registro público de una sucursal»: EXACTAMENTE la validación que antes era lo primero de `guardarSucursalPublica`, antes de leer nada,
 * con los MISMOS textos y en el MISMO orden: el id; que los datos sean un objeto con `publicada` booleana; el slug; la etiqueta; el subtítulo; la posición en el mapa y
 * el orden.
 */
export function guardComandoGuardarSucursalPublica(sucursalId: unknown, datos: EntradaSucursalPublica): ResultadoDato<ComandoGuardarSucursalPublica> {
  if (!esIdentificador(sucursalId)) return rechazar("vacio", SUCURSAL_INVALIDA);
  if (!datos || typeof datos !== "object" || typeof datos.publicada !== "boolean") return rechazar("formato", "Datos inválidos.");
  const slug = validarSlugTenant(datos.slug);
  if (!slug.ok) return rechazar("formato", slug.mensaje);
  const etiqueta = validarTextoLibreCarta(datos.etiqueta, "La etiqueta", LARGO_MAXIMO_ETIQUETA_PORTAL);
  if (!etiqueta.ok) return rechazar("largo", etiqueta.mensaje);
  const subtitulo = validarTextoLibreCarta(datos.subtituloPortal, "El subtítulo", LARGO_MAXIMO_SUBTITULO_PORTAL);
  if (!subtitulo.ok) return rechazar("largo", subtitulo.mensaje);
  const posicion = validarPosicionPortal({ x: datos.posX, y: datos.posY, w: datos.posW, h: datos.posH });
  if (!posicion.ok) return rechazar("formato", posicion.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({
    sucursalId,
    slug: slug.valor,
    etiqueta: etiqueta.valor,
    subtituloPortal: subtitulo.valor,
    posicion: posicion.valor,
    orden: orden.valor,
    publicada: datos.publicada,
  });
}

/** Guard del comando «sacar la sucursal del portal»: que el id sea un texto no vacío. */
export function guardComandoQuitarSucursalDelPortal(sucursalId: unknown): ResultadoDato<ComandoQuitarSucursalDelPortal> {
  if (!esIdentificador(sucursalId)) return rechazar("vacio", SUCURSAL_INVALIDA);
  return aceptar({ sucursalId });
}

/** Guard del comando «mover la sucursal en el mapa»: SOLO que el id sea un texto no vacío; las coordenadas pasan crudas y el caso de uso las valida después de leer la fila. */
export function guardComandoMoverSucursalEnMapa(entrada: { sucursalId: unknown; x: number; y: number }): ResultadoDato<ComandoMoverSucursalEnMapa> {
  if (!esIdentificador(entrada.sucursalId)) return rechazar("vacio", SUCURSAL_INVALIDA);
  return aceptar({ sucursalId: entrada.sucursalId, x: entrada.x, y: entrada.y });
}
