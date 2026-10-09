import {
  validarDatosDeIngrediente,
  validarEncabezadoDePaso,
  validarEnterosDeCabecera,
  validarMinutosYMarcadosDePaso,
  validarTextosYTopesDeCabecera,
  type CabeceraRecetaInput,
  type IngredienteInput,
  type PasoInput,
} from "@/core/catalogo/public";
import { ENTERO_MAXIMO_RAZONABLE, MAXIMO_PASOS_RECETA } from "@/core/datos/limites";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoGuardarVersionDeReceta, PuertaDeReceta } from "./receta-version.schema";

/** Mismo texto que usaba `guardarReceta` cuando el producto no existe. */
export const MENSAJE_PRODUCTO_NO_ENCONTRADO = "No se encontró el producto.";

/** La versión esperada que llega no es un entero entre 0 y el tope. */
const MENSAJE_VERSION_ESPERADA_INVALIDA = "La versión de la receta que se esperaba no es válida.";

/**
 * S-52: el tope de una versión de receta. Cada guardado suma una (append-only), así que 1.000.000 es muy por encima de cualquier receta real y muy por debajo de lo que un `1e308` o un
 * `Number.MAX_SAFE_INTEGER` mandado a mano haría pasar por «un entero ≥ 0» (antes llegaba hasta la comparación con la versión vigente y volvía como «la receta cambió… partiste de la 1e+308»).
 */
const VERSION_MAXIMA_DE_RECETA = 1_000_000;

/** Una versión posible: un número entero entre 0 (todavía no hay receta) y `VERSION_MAXIMA_DE_RECETA`. Rechaza negativos, NaN, ±Infinity, no enteros y 1e308. */
function esVersionPosible(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= VERSION_MAXIMA_DE_RECETA;
}

/**
 * Guard del comando «guardar una versión nueva de la receta» (Task #41, P1; convención "guard por feature", 2026-09-25). Puro: sin
 * Prisma ni permisos. Solo el `productoId`: si no es un string, el MISMO mensaje que «no encontrado» (antes llegaba así a
 * `producto.findUnique` y Prisma lo rechazaba con un error crudo de validación — un 500 para la pantalla; mismo criterio que los guards
 * de compras, ventas, traspasos y cuentas).
 *
 * `items`, `pasos` y `cabecera` pasan TAL CUAL: los validan `validarIngredientes` → `validarPasos` → `validarCabecera` en el caso de
 * uso, DESPUÉS de cargar el producto y de chequear que sea elegible, en el mismo orden de siempre (validarlos acá cambiaría qué mensaje
 * sale primero cuando hay más de un dato inválido).
 *
 * `exigirVersion` (O.1, Hito 4, paso H4C-23): la acción PÚBLICA `guardarReceta` lo pide — una versión esperada ausente (`undefined` o `null`) se rechaza con el MISMO
 * texto que una inválida, así el modo «a ciegas» no es alcanzable desde la red. Desde O.45 (cierre del Hito 4) también lo piden las cinco acciones de la receta
 * propia de una sucursal (`server/actions/catalogo/receta-sucursal.ts`, `versionVistaExigida`, antes de su primera lectura). Sin la opción (`guardarRecetaACiegas` de
 * `server/actions/catalogo/receta-a-ciegas.ts`, solo para seeds, scripts y tests, y el segundo paso de la receta propia, que ya recibe la versión validada) la
 * ausencia sigue siendo «a ciegas».
 */
export function guardComandoGuardarVersionDeReceta(entrada: unknown, opciones: { exigirVersion?: boolean } = {}): ResultadoDato<ComandoGuardarVersionDeReceta> {
  const { productoId, items, pasos, cabecera, versionEsperada } = (entrada ?? {}) as {
    productoId?: unknown;
    items?: IngredienteInput[];
    pasos?: PasoInput[];
    cabecera?: CabeceraRecetaInput;
    versionEsperada?: unknown;
  };
  if (typeof productoId !== "string") return rechazar("formato", MENSAJE_PRODUCTO_NO_ENCONTRADO);
  if (opciones.exigirVersion && (versionEsperada === undefined || versionEsperada === null)) return rechazar("formato", MENSAJE_VERSION_ESPERADA_INVALIDA);
  // `undefined` = reemplazo completo a ciegas (sin lectura previa); un valor presente tiene que ser una versión posible (0 = «todavía no hay receta»).
  if (versionEsperada !== undefined && versionEsperada !== null && !esVersionPosible(versionEsperada)) {
    return rechazar("formato", MENSAJE_VERSION_ESPERADA_INVALIDA);
  }
  return aceptar({ productoId, items: items as IngredienteInput[], pasos: pasos as PasoInput[], cabecera: cabecera as CabeceraRecetaInput, versionEsperada: (versionEsperada as number | undefined) ?? null });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// S-52 — los guards de la PUERTA de las acciones puntuales de receta (agregar, editar o quitar UN ingrediente o paso, reordenar, insertar, la cabecera; y las dos de la receta propia que
// reciben un ingrediente). Cada una recibe, además de la versión que vio la pantalla, un dato del cambio (un ingrediente, un paso, una posición, una secuencia, la cabecera). Estos guards
// son PUROS y devuelven el resultado POR ETAPA (`PuertaDeReceta`): la acción lo calcula con lo que mandó el cliente y aplica cada etapa donde antes vivía su chequeo, sin cambiar ningún
// mensaje ni el orden. Los rangos son los MISMOS validadores de siempre (`validarDatosDeIngrediente`, `validarEncabezadoDePaso`, … de `core/catalogo/receta-validacion.ts`).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

const aprobado = (): ResultadoDato<null> => aceptar(null);
const dePuerta = (mensaje: string | null): ResultadoDato<null> => (mensaje === null ? aprobado() : rechazar("rango", mensaje));
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === "string" && v !== "";
const esListaDeTextos = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));

/** El producto es texto y la versión que vio la pantalla es una versión posible (la obligatoria, sin «a ciegas»): lo que `guardComandoGuardarVersionDeReceta` decide, con sus mismos textos y orden. */
function etapaInmediata(productoId: unknown, versionVista: unknown): ResultadoDato<null> {
  if (typeof productoId !== "string") return rechazar("formato", MENSAJE_PRODUCTO_NO_ENCONTRADO);
  if (!esVersionPosible(versionVista)) return rechazar("formato", MENSAJE_VERSION_ESPERADA_INVALIDA);
  return aprobado();
}

/** La forma de un ingrediente que la acción necesita para seguir. */
function formaDeIngrediente(i: unknown): ResultadoDato<null> {
  if (!esObjeto(i)) return rechazar("formato", "El ingrediente no es válido.");
  if (!esTexto(i.insumoProductoId)) return rechazar("vacio", "Elegí el insumo del ingrediente.");
  if (!esTexto(i.unidadId)) return rechazar("vacio", "Elegí la unidad del ingrediente.");
  if (!esListaDeTextos(i.insumoSustitutoIds)) return rechazar("formato", "Los sustitutos de un ingrediente no son válidos.");
  return aprobado();
}

/** La forma de un paso (o de los cambios de uno) que la acción necesita para seguir. */
function formaDePaso(p: unknown): ResultadoDato<null> {
  if (!esObjeto(p) || typeof p.instruccion !== "string") return rechazar("formato", "El paso no es válido.");
  if (!esListaDeTextos(p.insumoProductoIds)) return rechazar("formato", "Los ingredientes marcados en un paso no son válidos.");
  return aprobado();
}

/**
 * Guard de «agregar un ingrediente a la receta» (`agregarIngredienteAReceta` y `agregarIngredienteARecetaPropia`): la forma del ingrediente; el producto y la versión que vio la pantalla; y
 * el rango de su cantidad (> 0, finita, bajo el tope), su merma (≥ 0, finita, hasta 1000), sus observaciones y el tope de sustitutos.
 */
export function guardComandoAgregarIngredienteAReceta(entrada: { productoId: unknown; ingrediente: unknown; versionVista: unknown }): PuertaDeReceta {
  const forma = formaDeIngrediente(entrada.ingrediente);
  return { forma, inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango: forma.ok ? dePuerta(validarDatosDeIngrediente(entrada.ingrediente as unknown as IngredienteInput)) : aprobado() };
}

/**
 * Guard de «editar la cantidad, la unidad o la merma de un ingrediente» (`actualizarIngredienteDeReceta` y `actualizarIngredienteDeRecetaPropia`): la forma de los cambios (la acción la
 * aplica DESPUÉS de comprobar que el insumo está en la receta); el producto y la versión; y el rango de la cantidad, la merma y el tope de sustitutos.
 */
export function guardComandoActualizarIngredienteDeReceta(entrada: { productoId: unknown; cambios: unknown; versionVista: unknown }): PuertaDeReceta {
  const c = entrada.cambios;
  const forma: ResultadoDato<null> = !esObjeto(c)
    ? rechazar("formato", "Los cambios del ingrediente no son válidos.")
    : !esTexto(c.unidadId)
      ? rechazar("vacio", "Elegí la unidad del ingrediente.")
      : !esListaDeTextos(c.insumoSustitutoIds)
        ? rechazar("formato", "Los sustitutos de un ingrediente no son válidos.")
        : aprobado();
  const rango = esObjeto(c) && forma.ok ? dePuerta(validarDatosDeIngrediente({ insumoProductoId: "", unidadId: c.unidadId as string, cantidad: c.cantidad as number, mermaPorcentaje: (c.mermaPorcentaje as number | undefined) ?? 0, insumoSustitutoIds: c.insumoSustitutoIds as string[] | undefined })) : aprobado();
  return { forma, inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango };
}

/** Guard de «quitar un ingrediente de la receta»: el insumo a quitar es un texto (antes, uno que no lo era guardaba una versión idéntica); el producto y la versión. */
export function guardComandoQuitarIngredienteDeReceta(entrada: { productoId: unknown; insumoProductoId: unknown; versionVista: unknown }): PuertaDeReceta {
  return {
    forma: esTexto(entrada.insumoProductoId) ? aprobado() : rechazar("vacio", "Elegí el insumo a quitar."),
    inmediata: etapaInmediata(entrada.productoId, entrada.versionVista),
    rango: aprobado(),
  };
}

/** Guard de «agregar un paso a la receta»: la forma del paso; el producto y la versión; y el rango de su orden (entero > 0 y razonable), sus textos, sus minutos y el tope de ingredientes marcados. */
export function guardComandoAgregarPasoAReceta(entrada: { productoId: unknown; paso: unknown; versionVista: unknown }): PuertaDeReceta {
  const forma: ResultadoDato<null> = esObjeto(entrada.paso) && typeof entrada.paso.orden === "number" ? formaDePaso(entrada.paso) : rechazar("formato", "El paso no es válido.");
  const paso = entrada.paso as unknown as PasoInput;
  return { forma, inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango: forma.ok ? dePuerta(validarEncabezadoDePaso(paso) ?? validarMinutosYMarcadosDePaso(paso)) : aprobado() };
}

/** Guard de «editar un paso»: la forma de los cambios (la acción la aplica DESPUÉS de comprobar que el paso está en la receta); el producto y la versión; y el rango de sus textos, sus minutos y el tope de ingredientes marcados. */
export function guardComandoActualizarPasoDeReceta(entrada: { productoId: unknown; orden: unknown; cambios: unknown; versionVista: unknown }): PuertaDeReceta {
  const forma = formaDePaso(entrada.cambios);
  const paso = { ...(entrada.cambios as object), orden: entrada.orden } as unknown as PasoInput;
  return { forma, inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango: forma.ok ? dePuerta(validarEncabezadoDePaso(paso) ?? validarMinutosYMarcadosDePaso(paso)) : aprobado() };
}

/**
 * Guard de «quitar un paso»: el orden del paso es un entero entre 1 y el tope (antes bastaba con que fuera entero: `0`, un negativo o `1e308` guardaban una versión idéntica), con el
 * texto de siempre; el producto y la versión. La acción lo aplica primero de todo, como antes.
 */
export function guardComandoQuitarPasoDeReceta(entrada: { productoId: unknown; orden: unknown; versionVista: unknown }): PuertaDeReceta {
  const o = entrada.orden;
  const ordenValido = typeof o === "number" && Number.isInteger(o) && o >= 1 && o <= ENTERO_MAXIMO_RAZONABLE;
  return { forma: ordenValido ? aprobado() : rechazar("rango", "El número de paso no es válido."), inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango: aprobado() };
}

/**
 * Guard de «reordenar los pasos»: la secuencia es una lista de a lo sumo `MAXIMO_PASOS_RECETA` órdenes enteros entre 1 y el tope (antes se ordenaba cualquier arreglo, de cualquier
 * largo, con lo que fuera adentro); el producto y la versión. Que sea una permutación EXACTA de los pasos vigentes lo decide la acción con la receta leída; una secuencia mal formada
 * se rechaza con el MISMO texto que una que no es permutación.
 */
export function guardComandoReordenarPasosDeReceta(entrada: { productoId: unknown; secuencia: unknown; versionVista: unknown }): PuertaDeReceta {
  const s = entrada.secuencia;
  const valida = Array.isArray(s) && s.length <= MAXIMO_PASOS_RECETA && s.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= ENTERO_MAXIMO_RAZONABLE);
  return {
    forma: valida ? aprobado() : rechazar("formato", "La secuencia de pasos no es válida (faltan, sobran o se repiten pasos)."),
    inmediata: etapaInmediata(entrada.productoId, entrada.versionVista),
    rango: aprobado(),
  };
}

/**
 * Guard de «insertar un paso en una posición»: la posición es un entero entre 0 y el tope (con el texto de siempre; antes bastaba con que fuera entero: un negativo o `1e308` se recortaban
 * a una punta); la forma del paso; el producto y la versión; y el rango de sus textos, sus minutos y el tope de ingredientes marcados. La acción aplica `forma` primero de todo, como antes.
 */
export function guardComandoInsertarPasoEnReceta(entrada: { productoId: unknown; posicion: unknown; paso: unknown; versionVista: unknown }): PuertaDeReceta {
  const p = entrada.posicion;
  const forma: ResultadoDato<null> =
    typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= ENTERO_MAXIMO_RAZONABLE ? formaDePaso(entrada.paso) : rechazar("rango", "La posición del paso no es válida.");
  // `insertarEnPosicion` renumera: el orden del paso nuevo lo pone ella (1..N+1), así que acá se mide con uno cualquiera válido.
  const paso = { ...(esObjeto(entrada.paso) ? entrada.paso : {}), orden: 1 } as unknown as PasoInput;
  return { forma, inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango: forma.ok ? dePuerta(validarEncabezadoDePaso(paso) ?? validarMinutosYMarcadosDePaso(paso)) : aprobado() };
}

/** Guard de «actualizar la cabecera de la receta»: la cabecera es un objeto (antes, `null` se guardaba como «sin cabecera» y borraba la ficha); el producto y la versión; y el rango de los textos, los topes y los enteros (raciones y tiempos). */
export function guardComandoActualizarCabeceraDeReceta(entrada: { productoId: unknown; cabecera: unknown; versionVista: unknown }): PuertaDeReceta {
  const forma: ResultadoDato<null> = esObjeto(entrada.cabecera) ? aprobado() : rechazar("formato", "La cabecera de la receta no es válida.");
  const c = entrada.cabecera as unknown as CabeceraRecetaInput;
  return { forma, inmediata: etapaInmediata(entrada.productoId, entrada.versionVista), rango: forma.ok ? dePuerta(validarTextosYTopesDeCabecera(c) ?? validarEnterosDeCabecera(c)) : aprobado() };
}

/** El guard de las acciones de la receta propia que solo reciben el producto y la versión (crear, quitar un ingrediente, copiar): el mismo orden y los mismos textos de `guardComandoGuardarVersionDeReceta` con la versión obligatoria. */
export function guardComandoVersionVistaDeReceta(entrada: { productoId: unknown; versionVista: unknown }): ResultadoDato<null> {
  return etapaInmediata(entrada.productoId, entrada.versionVista);
}
