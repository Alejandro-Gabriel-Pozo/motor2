/**
 * Los textos de la pantalla de Carta › Promociones, en un solo lugar, según el interruptor `ARMADO_DE_PROMO_COMO_PEDERNAL` (pedido del dueño, 2026-11-17: «en Pedernal veo pocas palabras bien elegidas, en Motor 2 veo párrafos explicativos»).
 *
 * - Con `false`: los textos de siempre, intactos.
 * - Con `true`: el vocabulario aprobado por el dueño el 09/11/2026 en la maqueta de Pedernal (`combos.html`: Combos, Nuevo combo, Nombre, Precio, Qué lleva, Agregar componente, Cantidad, Cómo lo ve el cliente,
 *   Reparto del precio, Todavía no lleva nada, Quitar…); lo que la maqueta no tiene conserva su rótulo corto de hoy y pierde la ayuda; los párrafos explicativos se sacan (`null`). Ningún texto nuevo se inventa:
 *   cada cambio está en `docs/palabras-de-la-pantalla-de-promociones-2026-11-17.md` con su fuente, y `test/carta/textos-de-promociones.test.ts` cierra la lista.
 *
 * Los campos que solo se dibujan con el interruptor encendido (el armado «Qué lleva», el reparto) guardan, para `false`, lo que decían antes de este cambio: no se usan con el interruptor apagado.
 */
export interface TextosDePromos {
  /** Título de la barra de arriba (`<h1>`), la fila de pestañas y el menú. */
  encabezadoDeLaEntrada: string;
  /** Subtítulo de la barra de arriba; vacío = no se dibuja. */
  encabezadoDeLaPestana: string;
  /** Título de la sección de la lista (`<h2>`). */
  tituloDeLaSeccion: string;
  /** Párrafo de introducción de la lista; `null` = no se dibuja. */
  introduccion: string | null;
  /** Rótulo del título de la promo (campo y dato de solo lectura). */
  rotuloDelTitulo: string;
  /** Rótulo del precio de la promo (el asterisco de obligatorio lo decide `asteriscoEnElPrecio`). */
  rotuloDelPrecio: string;
  asteriscoEnElPrecio: boolean;
  rotuloDeLaDescripcion: string;
  rotuloDelPrecioLocal: string;
  botonGuardarPromo: string;
  tituloDelAlta: string;
  botonCrearPromo: string;
  soloSalonEtiqueta: string;
  /** Ayuda de la casilla «solo salón»; `null` = sin ayuda. */
  soloSalonAyuda: string | null;
  soloSalonDato: string;
  /** Aviso de una promo «solo salón» sin cupos; `null` = no se dibuja. */
  avisoSoloSalonSinCupos: string | null;
  tituloDeLoQueLleva: string;
  /** Párrafo bajo el título del armado; `null` = no se dibuja. */
  parrafoDeLoQueLleva: string | null;
  /** Aviso del «peor caso» y el piso (solo hoy); con `false` no se dibuja. */
  mostrarAvisoDelPeorCaso: boolean;
  botonGuardarCupos: string;
  sinComponentes: string;
  agregarComponente: string;
  /** Párrafo dentro de «Agregar componente»; `null` = no se dibuja. */
  parrafoDeAgregarComponente: string | null;
  /** Párrafo bajo el título del armado por partes (E2b, una fila por parte); `null` = no se dibuja. */
  parrafoDeLasPartes: string | null;
  /** Lo que dice la fila de una lista con nombre propio (no es una sección) sobre qué entra; con `null` no se dibuja. */
  modalidadDeLaListaPropia: string;
  /** Leyenda de «sumar un lugar» (el alta de un lugar de entradas). */
  leyendaDeSumarUnLugar: string;
  sinEntradas: string;
  quitarEntrada: (nombre: string) => string;
  /** Lo que sigue al reparto cuando hay partes con rango; `null` = no se dibuja. */
  ayudaDelRepartoConRango: string | null;
  sinPromos: string;
  hacenFaltaSecciones: string;
}

const DE_HOY: TextosDePromos = {
  encabezadoDeLaEntrada: "Promociones",
  encabezadoDeLaPestana: "Combos y cupos",
  tituloDeLaSeccion: "Promos",
  introduccion:
    "Una promo se define una sola vez para toda la empresa. Cada sucursal decide si la prende (apagada no sale en la carta ni en el POS) y, si quiere, le pone su propio precio. No tiene fechas: se maneja con activar y desactivar (mientras está prendida se vende; cuando termina, se apaga).",
  rotuloDelTitulo: "Título",
  rotuloDelPrecio: "Precio",
  asteriscoEnElPrecio: true,
  rotuloDeLaDescripcion: "Descripción (opcional)",
  rotuloDelPrecioLocal: "Precio en esta sucursal (vacío = el de la empresa)",
  botonGuardarPromo: "Guardar promo",
  tituloDelAlta: "Nueva promo (queda prendida en esta sucursal)",
  botonCrearPromo: "Crear promo",
  soloSalonEtiqueta: "Solo salón: se vende desde el POS, pero no aparece en la carta pública (web, QR ni impresa)",
  soloSalonAyuda: "Útil para un menú pactado con una empresa: el precio no queda publicado.",
  soloSalonDato: "Solo salón (no aparece en la carta pública)",
  avisoSoloSalonSinCupos:
    "Esta promo está en «solo salón» pero no tiene cupos: es solo informativa y el POS la ignora, así que no se vería en ningún lado. Cargale cupos para poder venderla en el salón.",
  tituloDeLoQueLleva: "Cupos",
  parrafoDeLoQueLleva:
    "Las partes de la promo se arman tildando secciones de la carta: de cada sección tildada el mozo elige entre «mín.» y «máx.» productos (para que elija más, subí el «máx.»). Para un grupo propio, como «Bebida», creá la sección en Carta › Secciones y géneros y tildala acá, o sumá abajo un lugar con su propia lista de productos.",
  mostrarAvisoDelPeorCaso: true,
  botonGuardarCupos: "Guardar cupos",
  sinComponentes: "Sin cupos: esta promo es solo informativa, el POS la ignora.",
  // Solo se dibujan con el interruptor encendido: lo que decían antes de este cambio.
  agregarComponente: "Agregar un componente",
  parrafoDeAgregarComponente: "Tildá la sección de la carta (o «No está en la carta»), elegí si entra toda la sección o solo ciertos platos y poné la cantidad. Ninguna viene tildada: cada decisión es tuya.",
  parrafoDeLasPartes:
    "Cada componente es una sección de la carta (o «No está en la carta»): entra toda la sección o solo los platos que tildes, y lleva una cantidad exacta. Cada uno se guarda con su propio botón. Los que se cargaron con un rango «de mín. a máx.» se siguen leyendo así hasta que les pongas una cantidad exacta.",
  modalidadDeLaListaPropia: "Solo estos platos (los que no están en la carta se tildan de a uno).",
  leyendaDeSumarUnLugar: "Sumar un lugar (opcional)",
  sinEntradas: "Sin entradas todavía: sumá los productos que se pueden elegir acá.",
  quitarEntrada: (nombre) => `Sacar «${nombre}»`,
  ayudaDelRepartoConRango: "En las partes cargadas con un rango se usa la cantidad máxima.",
  sinPromos: "La empresa no tiene promos cargadas.",
  hacenFaltaSecciones: "Para cargar una promo hace falta al menos una sección de carta activa.",
};

const COMO_PEDERNAL: TextosDePromos = {
  // Decisión del dueño (2026-11-17, vía el orquestador): lo que Pedernal ya resolvió se hace como Pedernal; el módulo se llama «Combos» (título, pestaña y menú). Sin subtítulo: repetir «Combos» no aporta.
  encabezadoDeLaEntrada: "Combos",
  encabezadoDeLaPestana: "",
  tituloDeLaSeccion: "Combos",
  introduccion: null,
  rotuloDelTitulo: "Nombre",
  rotuloDelPrecio: "Precio",
  asteriscoEnElPrecio: false,
  rotuloDeLaDescripcion: "Descripción",
  rotuloDelPrecioLocal: "Precio en esta sucursal",
  botonGuardarPromo: "Guardar",
  tituloDelAlta: "Nuevo combo",
  botonCrearPromo: "Guardar",
  soloSalonEtiqueta: "Solo salón",
  soloSalonAyuda: null,
  soloSalonDato: "Solo salón",
  avisoSoloSalonSinCupos: null,
  tituloDeLoQueLleva: "Qué lleva",
  parrafoDeLoQueLleva: null,
  mostrarAvisoDelPeorCaso: false,
  botonGuardarCupos: "Guardar",
  sinComponentes: "Todavía no lleva nada",
  agregarComponente: "Agregar componente",
  parrafoDeAgregarComponente: null,
  parrafoDeLasPartes: null,
  modalidadDeLaListaPropia: "Solo estos platos",
  leyendaDeSumarUnLugar: "Sumar un lugar",
  sinEntradas: "Todavía no lleva nada",
  quitarEntrada: (nombre) => `Quitar «${nombre}»`,
  ayudaDelRepartoConRango: null,
  sinPromos: "La empresa no tiene combos cargados.",
  hacenFaltaSecciones: "Para cargar un combo hace falta al menos una sección de carta activa.",
};

/** Los textos de la pantalla de promociones: los de siempre (`false`) o los del armado «como Pedernal» (`true`). */
export function textosDeLaPantallaDePromos(comoPedernal: boolean): TextosDePromos {
  return comoPedernal ? COMO_PEDERNAL : DE_HOY;
}
