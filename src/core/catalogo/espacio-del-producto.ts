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
 *   | De venta (PV)                              | Qué se vende · Opciones y precio · Receta · En la carta |
 *   | Materia prima (MP) que se produce          | Datos · Receta                                     |
 *   | Materia prima (MP) que no se produce       | Datos                                              |
 *   | De respaldo de un adicional (PV interno)   | Qué se vende (sin pasos de venta ni receta)        |
 *
 * (El producto de respaldo no se vende solo y no puede tener receta —ADR-030, D-1—: se maneja como un adicional, así que solo conserva el paso de datos.)
 *
 * PRIVACIDAD: un paso que el usuario no puede abrir nunca revela datos. `pasosDelEspacio` lo marca `href: null` y fuerza su estado a `sin-dato`, aunque quien llama haya calculado el
 * pendiente (la portada no dice «a la receta le falta algo» a quien no ve recetas). Sin módulo (la receta o la carta apagadas para la empresa) el paso directamente no aparece.
 */

/** Los cuatro pasos del espacio, en orden. `datos` es «Qué se vende» en un producto de venta y «Datos» en una materia prima. */
export const PASOS_DEL_ESPACIO = ["datos", "opciones", "receta", "en-la-carta"] as const;
export type PasoDelEspacio = (typeof PASOS_DEL_ESPACIO)[number];

/** Las rutas de cada paso. En el bloque 2 la receta sigue siendo la pantalla de hoy (`/catalogo/recetas/[id]`); `portada` es la ficha del producto. */
export function rutaDelPaso(productoId: string, paso: PasoDelEspacio | "portada"): string {
  const id = encodeURIComponent(productoId);
  switch (paso) {
    case "portada":
      return `/catalogo/productos/${id}`;
    case "datos":
      return `/catalogo/productos/${id}/datos`;
    case "opciones":
      return `/catalogo/productos/${id}/opciones`;
    case "receta":
      return `/catalogo/recetas/${id}`;
    case "en-la-carta":
      return `/catalogo/productos/${id}/en-la-carta`;
  }
}

/** Lo que define QUÉ pasos tiene un producto: su tipo y dos banderas. */
export interface FormaDelProducto {
  tipo: "PV" | "MP";
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
  modoDeVenta: "DIRECTO" | "BASE_CONFIGURABLE";
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
  if (forma.tipo === "MP") return paso === "receta" && forma.seProduce;
  return true; // PV
}

function estadoDeDatos(h: HechosDelProducto): EstadoDelPaso {
  if (h.esAnclaDeAdicional) return { tipo: "listo", texto: "Producto de respaldo de un adicional" };
  if (h.tipo === "MP") return { tipo: "listo", texto: "Materia prima" };
  if (h.modoDeVenta === "BASE_CONFIGURABLE") return { tipo: "listo", texto: "Se vende por opción" };
  if (!(h.precioDeVenta > 0)) return { tipo: "pendiente", texto: "Falta el precio de venta" };
  return { tipo: "listo", texto: "Se vende directo" };
}

function estadoDeOpciones(h: HechosDelProducto): EstadoDelPaso {
  if (h.opciones === null) return SIN_DATO;
  if (!h.opciones.vendibleAca) return { tipo: "pendiente", texto: "Hoy no se puede vender acá: revisá las opciones y sus precios" };
  return { tipo: "listo", texto: h.modoDeVenta === "BASE_CONFIGURABLE" ? "El precio sale de las opciones" : "Opciones al día" };
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
 * - datos: un producto de venta directo sin precio queda pendiente; uno que se vende por opción, una materia prima y el de respaldo están listos.
 * - opciones: pendiente si el resumen dice que hoy no se puede vender en la sucursal.
 * - receta: pendiente con el mensaje de «sin receta no se vende».
 * - en-la-carta: pendiente si no se ve (oculto, fuera, sin sección o no disponible).
 */
export function pendientesDelProducto(h: HechosDelProducto): Record<PasoDelEspacio, EstadoDelPaso> {
  return {
    datos: estadoDeDatos(h),
    opciones: pasoCorrespondeAlProducto(h, "opciones") ? estadoDeOpciones(h) : SIN_DATO,
    receta: pasoCorrespondeAlProducto(h, "receta") ? estadoDeReceta(h) : SIN_DATO,
    "en-la-carta": pasoCorrespondeAlProducto(h, "en-la-carta") ? estadoEnLaCarta(h) : SIN_DATO,
  };
}

/** Lo que el usuario puede abrir de cada paso. `receta` y `carta` distinguen el permiso del módulo apagado: sin permiso el paso se ve sin enlace; sin módulo no se ve. */
export interface AccesoAlEspacio {
  /** Puede editar los datos del producto (paso 1). */
  datos: boolean;
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
      return forma.tipo === "PV" ? "Qué se vende" : "Datos";
    case "opciones":
      return "Opciones y precio";
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
    case "opciones":
      return acceso.opciones ? "si" : "sin-permiso";
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
