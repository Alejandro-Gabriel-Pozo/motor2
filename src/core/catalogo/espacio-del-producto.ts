import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { esBaseConfigurable, type ModoDeVenta } from "@/core/opciones/public";
import { PRESENTACIONES_VISIBLES } from "./presentaciones-visibles";

/**
 * El ESPACIO DEL PRODUCTO (Fase 6, paso 6.9b; DEC-12): el recorrido de pasos por el que se arma y se mantiene UN producto sin salir de él. Puro: no lee nada. Dice qué pasos tiene un
 * producto según su TIPO, a qué ruta lleva cada uno, qué le falta a cada paso (los «pendientes») y qué pasos puede abrir quien mira, así la pantalla del marco dibuja las pestañas sin
 * decidir nada.
 *
 * UN solo espacio para todos los tipos de producto (decisión del ingeniero, 2026-10-21): el paso 1 vive siempre en `/catalogo/productos/[id]/datos`; lo que cambia con el tipo es qué pasos
 * aparecen. Un paso que no corresponde al tipo NO aparece (no es «sin permiso»):
 *
 *   | Producto                                   | Pasos                                              |
 *   |--------------------------------------------|----------------------------------------------------|
 *   | De venta (PV)                              | Datos · Precios · Opciones · Receta · En la carta  |
 *   | Materia prima (MP) que se produce          | Datos · Receta                                     |
 *   | Materia prima (MP) que no se produce       | Datos                                              |
 *   | De respaldo de un adicional (PV interno)   | Qué se vende (sin pasos de venta ni receta)        |
 *
 * (El producto de respaldo no se vende solo y no puede tener receta —ADR-030, D-1—: se maneja como un adicional, así que solo conserva el paso de datos.)
 *
 * PRIVACIDAD: un paso que el usuario no puede abrir nunca revela datos. `pasosDelEspacio` lo marca `href: null` y fuerza su estado a `sin-dato`, aunque quien llama haya calculado el
 * pendiente (la portada no dice «a la receta le falta algo» a quien no ve recetas). Sin módulo (la receta o la carta apagadas para la empresa) el paso directamente no aparece.
 */

/**
 * Los pasos del espacio, en orden. La ficha tiene como pestañas Datos, Precios y Opciones, y «Cómo se compra» cuando el producto se compra, como la de Pedernal (docs/diseno-productos-igual-a-pedernal-2026-11-13.md, D4, D8 y D12;
 * dueño, 2026-11-13: «Fuera de la ficha, como Pedernal»: «Receta» y «En la carta» ya no se muestran en la ficha, se llega desde Recetas y Carta; siguen siendo pasos para que «Qué falta» avise y lleve a esas pantallas).
 * `precios` es solo de un producto de venta; `compra`, solo de una materia prima y mientras las presentaciones estén visibles.
 */
export const PASOS_DEL_ESPACIO = ["datos", "precios", "opciones", "compra", "receta", "en-la-carta"] as const;
export type PasoDelEspacio = (typeof PASOS_DEL_ESPACIO)[number];

/** Las rutas de cada paso. En el bloque 2 la receta sigue siendo la pantalla de hoy (`/catalogo/recetas/[id]`); `portada` es la ficha del producto. */
export function rutaDelPaso(productoId: string, paso: PasoDelEspacio | "portada"): string {
  const id = encodeURIComponent(productoId);
  switch (paso) {
    case "portada":
      return `/catalogo/productos/${id}`;
    case "datos":
      return `/catalogo/productos/${id}/datos`;
    case "precios":
      return `/catalogo/productos/${id}/precios`;
    case "opciones":
      return `/catalogo/productos/${id}/opciones`;
    case "compra":
      return `/catalogo/productos/${id}/compra`;
    case "receta":
      return `/catalogo/recetas/${id}`;
    case "en-la-carta":
      return `/catalogo/productos/${id}/en-la-carta`;
  }
}

/** Lo que define QUÉ pasos tiene un producto: su tipo y dos banderas. */
export interface FormaDelProducto {
  tipo: TipoProducto;
  /** Solo una materia prima con `seProduce` tiene receta propia. */
  seProduce: boolean;
  /** El producto interno que respalda el stock de un adicional (ADR-030): se vende solo como adicional y no se maneja con los pasos de venta. */
  esAnclaDeAdicional: boolean;
}

/**
 * Cómo está el producto en la carta de la sucursal activa (lo que lee la administración de la carta). `sin-seccion`: tiene contenido prendido pero ninguna sección de carta activa (la carta pública
 * no lo muestra: es el «visible sin sección» del diagnóstico de la carta).
 */
export type EstadoEnLaCarta = "visible" | "oculto" | "fuera" | "agrupado" | "no-disponible" | "sin-seccion";

/**
 * Los hechos que hacen falta para calcular los pendientes, ya leídos por quien llama. `null` en `opciones`, `receta` o `carta` = «ese dato no se leyó»: el usuario no ve esa pantalla (la
 * consulta ni se hizo) o el paso no corresponde al tipo; el estado de ese paso es `sin-dato`.
 */
export interface HechosDelProducto extends FormaDelProducto {
  modoDeVenta: ModoDeVenta;
  precioDeVenta: number;
  /** `vendibleAca`: el resumen de precios dice que se puede vender hoy en la sucursal activa (`vistaPrevia.vendible`). */
  opciones: { vendibleAca: boolean } | null;
  /** `rechazo`: el mensaje de «sin receta no se vende» (`rechazoSinOrigenDeStock`), o `null` si tiene origen de stock. */
  receta: { rechazo: string | null } | null;
  carta: { estado: EstadoEnLaCarta } | null;
}

export type EstadoDelPaso = { tipo: "listo"; texto: string } | { tipo: "pendiente"; texto: string } | { tipo: "sin-dato" };

const SIN_DATO: EstadoDelPaso = { tipo: "sin-dato" };

/** Si un paso corresponde al producto: lo que decide la tabla de la cabecera. Lo que no corresponde ni aparece ni se calcula. */
function pasoCorrespondeAlProducto(forma: FormaDelProducto, paso: PasoDelEspacio): boolean {
  if (paso === "datos") return true;
  if (forma.esAnclaDeAdicional) return false;
  if (paso === "compra") return forma.tipo === "MP" && PRESENTACIONES_VISIBLES;
  if (forma.tipo === "MP") return paso === "receta" && forma.seProduce;
  return true; // PV
}

function estadoDeDatos(h: HechosDelProducto): EstadoDelPaso {
  if (h.esAnclaDeAdicional) return { tipo: "listo", texto: "Producto de respaldo de un adicional" };
  if (h.tipo === "MP") return { tipo: "listo", texto: "Materia prima" };
  return { tipo: "listo", texto: "Datos al día" };
}

/** El precio: un producto de venta directo sin precio queda pendiente; uno que se vende por opción tiene el precio en cada opción. */
function estadoDePrecios(h: HechosDelProducto): EstadoDelPaso {
  if (esBaseConfigurable(h.modoDeVenta)) return { tipo: "listo", texto: "Se vende por opción" };
  if (!(h.precioDeVenta > 0)) return { tipo: "pendiente", texto: "Falta el precio de venta" };
  return { tipo: "listo", texto: "Se vende directo" };
}

function estadoDeOpciones(h: HechosDelProducto): EstadoDelPaso {
  if (h.opciones === null) return SIN_DATO;
  if (!h.opciones.vendibleAca) return { tipo: "pendiente", texto: "Hoy no se puede vender acá: revisá las opciones y sus precios" };
  return { tipo: "listo", texto: esBaseConfigurable(h.modoDeVenta) ? "El precio sale de las opciones" : "Opciones al día" };
}

function estadoDeReceta(h: HechosDelProducto): EstadoDelPaso {
  if (h.receta === null) return SIN_DATO;
  if (h.receta.rechazo !== null) return { tipo: "pendiente", texto: h.receta.rechazo };
  return { tipo: "listo", texto: "Tiene receta" };
}

function estadoEnLaCarta(h: HechosDelProducto): EstadoDelPaso {
  if (h.carta === null) return SIN_DATO;
  switch (h.carta.estado) {
    case "visible":
      return { tipo: "listo", texto: "Se ve en la carta" };
    case "agrupado":
      return { tipo: "listo", texto: "Se ve en la carta, agrupado con otros" };
    case "oculto":
      return { tipo: "pendiente", texto: "Está en la carta pero oculto" };
    case "fuera":
      return { tipo: "pendiente", texto: "Todavía no está en la carta" };
    case "no-disponible":
      return { tipo: "pendiente", texto: "No está disponible en esta sucursal" };
    case "sin-seccion":
      return { tipo: "pendiente", texto: "Está en la carta pero le falta una sección" };
  }
}

/**
 * Qué le falta a cada paso. Es total: devuelve los cuatro pasos y los que no corresponden al tipo (o cuyo dato no se leyó) valen `sin-dato`. Quien dibuja solo muestra los que devuelve
 * `pasosDelEspacio`.
 * - datos: siempre listo (es la ficha; lo que falta de un producto de venta está en sus otros pasos).
 * - precios: un producto de venta directo sin precio queda pendiente; uno que se vende por opción está listo.
 * - opciones: pendiente si el resumen dice que hoy no se puede vender en la sucursal.
 * - receta: pendiente con el mensaje de «sin receta no se vende».
 * - en-la-carta: pendiente si no se ve (oculto, fuera, sin sección o no disponible).
 */
export function pendientesDelProducto(h: HechosDelProducto): Record<PasoDelEspacio, EstadoDelPaso> {
  return {
    datos: estadoDeDatos(h),
    precios: pasoCorrespondeAlProducto(h, "precios") ? estadoDePrecios(h) : SIN_DATO,
    opciones: pasoCorrespondeAlProducto(h, "opciones") ? estadoDeOpciones(h) : SIN_DATO,
    // «Cómo se compra» no tiene pendiente propio: las presentaciones son opcionales.
    compra: SIN_DATO,
    receta: pasoCorrespondeAlProducto(h, "receta") ? estadoDeReceta(h) : SIN_DATO,
    "en-la-carta": pasoCorrespondeAlProducto(h, "en-la-carta") ? estadoEnLaCarta(h) : SIN_DATO,
  };
}

/** Lo que el usuario puede abrir de cada paso. `receta` y `carta` distinguen el permiso del módulo apagado: sin permiso el paso se ve sin enlace; sin módulo no se ve. */
export interface AccesoAlEspacio {
  /** Puede EDITAR los datos del producto: el paso `datos` lleva a su formulario (`/datos`) y es lo que habilita «Editar datos». La pestaña Datos del marco abre la ficha (portada), que ve quien ve el catálogo. */
  datos: boolean;
  /** Puede ver el catálogo (`producto_ver_catalogo`): abre la pestaña Precios. */
  ver: boolean;
  opciones: boolean;
  receta: "si" | "sin-permiso" | "sin-modulo";
  carta: "si" | "sin-permiso" | "sin-modulo";
}

export interface PasoDeLaPortada {
  paso: PasoDelEspacio;
  titulo: string;
  /** `null` = el usuario no puede abrirlo: se muestra como texto, sin enlace. */
  href: string | null;
  estado: EstadoDelPaso;
}

function tituloDelPaso(forma: FormaDelProducto, paso: PasoDelEspacio): string {
  switch (paso) {
    case "datos":
      return "Datos";
    case "precios":
      return "Precios";
    case "opciones":
      return "Opciones";
    case "compra":
      return "Cómo se compra";
    case "receta":
      return "Receta";
    case "en-la-carta":
      return "En la carta";
  }
}

function aperturaDelPaso(acceso: AccesoAlEspacio, paso: PasoDelEspacio): "si" | "sin-permiso" | "sin-modulo" {
  switch (paso) {
    case "datos":
      return acceso.datos ? "si" : "sin-permiso";
    case "precios":
      return acceso.ver ? "si" : "sin-permiso";
    case "opciones":
      return acceso.opciones ? "si" : "sin-permiso";
    case "compra":
      return acceso.ver ? "si" : "sin-permiso";
    case "receta":
      return acceso.receta;
    case "en-la-carta":
      return acceso.carta;
  }
}

/**
 * Los pasos que se muestran de UN producto, en orden: solo los que corresponden a su tipo, sin los de un módulo apagado, y cada uno con su enlace y su estado.
 * - Sin permiso para abrirlo: `href: null` y estado `sin-dato` (aunque `estados` traiga el pendiente: no se revela).
 * - Sin módulo: el paso se omite.
 */
export function pasosDelEspacio(productoId: string, forma: FormaDelProducto, acceso: AccesoAlEspacio, estados: Record<PasoDelEspacio, EstadoDelPaso>): PasoDeLaPortada[] {
  const pasos: PasoDeLaPortada[] = [];
  for (const paso of PASOS_DEL_ESPACIO) {
    if (!pasoCorrespondeAlProducto(forma, paso)) continue;
    const apertura = aperturaDelPaso(acceso, paso);
    if (apertura === "sin-modulo") continue;
    const puede = apertura === "si";
    pasos.push({ paso, titulo: tituloDelPaso(forma, paso), href: puede ? rutaDelPaso(productoId, paso) : null, estado: puede ? estados[paso] : SIN_DATO });
  }
  return pasos;
}
