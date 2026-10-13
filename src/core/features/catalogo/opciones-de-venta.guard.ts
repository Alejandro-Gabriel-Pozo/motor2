import { esIdentificador } from "@/core/datos/identificador";
import { validarImporte } from "@/core/datos/importe";
import { ENTERO_MAXIMO_RAZONABLE, validarTopeDeLista } from "@/core/datos/limites";
import { validarNombreCatalogo } from "@/core/datos/nombre-catalogo";
import { numeroDeEntrada, tieneALoSumoDecimales } from "@/core/datos/numero-tecleado";
import { validarFactorDeEscala, validarPorcentajeDeDiferencia } from "@/core/datos/porcentaje-y-factor";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import {
  CANTIDAD_MAXIMA_DE_OPCION,
  EFECTOS_DE_CONSUMO_DE_OPCION,
  MAXIMO_CONSUMOS_POR_VERSION,
  MERMA_MAXIMA_DE_CONSUMO,
  MODOS_DE_PRECIO_DE_MEDIDA,
  TIPOS_DE_GRUPO_DE_OPCIONES,
  type ConsumoDeConfiguracion,
  type DiferenciaDePrecio,
  type EfectoDeConsumoDeOpcion,
  type ModoDePrecioDeMedida,
  type TipoDeGrupoDeOpciones,
} from "@/core/opciones/public";
import type {
  ComandoAgregarVersionDeOpcion,
  ComandoCrearGrupoDeOpciones,
  ComandoCrearOpcionDeGrupo,
  ComandoEditarGrupoDeOpciones,
  ComandoEditarOpcionDeGrupo,
  ComandoFijarAdmisionDeGrupo,
  DatosDeVersionDeOpcion,
  OpcionAdmitidaEnComando,
} from "./opciones-de-venta.schema";

/**
 * Guard de la feature «catálogo de opciones de venta» (GO-2a; convención «guard por feature»). FORMATO Y RANGO de cada comando, ANTES de tocar la base; lo llama la Server Action
 * DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso llega antes que el de formato. Puro: sin Prisma ni permisos. Una Server Action es una puerta HTTP y acá
 * puede llegar cualquier cosa (un `NaN`, `Infinity`, un texto, una lista de diez mil elementos): todo número pasa por el parser estricto de `core/datos` y lo que trae más
 * decimales de los que guarda su columna se RECHAZA, no se redondea (la base redondearía sin avisar).
 *
 * Las reglas que dependen del TIPO del grupo (la MEDIDA 1 y 1, la INCLUIDA en 0, el ADICIONAL solo SUMA…) no van acá: son de `core/opciones` (`validar-configuracion.ts`) y las
 * aplica el caso de uso, que es el que lee el grupo.
 */

/** Tope de opciones de un grupo que la pantalla manda de una vez al fijar lo que admite un producto. */
const MAXIMO_OPCIONES_POR_ADMISION = 100;
/** Tope de un id que llega del cliente (un cuid tiene 25). */
const LARGO_MAXIMO_DE_ID = 64;
/** Tope de una cantidad de consumo (`DECIMAL(14,4)`). */
const CANTIDAD_DE_CONSUMO_MAXIMA = 1e10;

export const MENSAJE_GRUPO_NO_ENCONTRADO = "No se encontró el grupo de opciones.";
export const MENSAJE_OPCION_NO_ENCONTRADA = "No se encontró la opción.";

function id(valor: unknown, mensaje: string): ResultadoDato<string> {
  return esIdentificador(valor) && valor.length <= LARGO_MAXIMO_DE_ID ? aceptar(valor) : rechazar("formato", mensaje);
}

function idONulo(valor: unknown, mensaje: string): ResultadoDato<string | null> {
  if (valor === null || valor === undefined) return aceptar(null);
  return id(valor, mensaje);
}

function booleano(valor: unknown, etiqueta: string): ResultadoDato<boolean> {
  return typeof valor === "boolean" ? aceptar(valor) : rechazar("formato", `${etiqueta} tiene que ser sí o no.`);
}

function entero(valor: unknown, etiqueta: string, minimo: number, maximo: number): ResultadoDato<number> {
  const numero = numeroDeEntrada(valor);
  if (!numero.ok || numero.valor === null) return rechazar("formato", `${etiqueta} no es un número válido.`);
  const n = numero.valor;
  if (!Number.isInteger(n) || n < minimo || n > maximo) return rechazar("rango", `${etiqueta} tiene que ser un número entero entre ${minimo} y ${maximo}.`);
  return aceptar(n);
}

function enteroONulo(valor: unknown, etiqueta: string, minimo: number, maximo: number): ResultadoDato<number | null> {
  if (valor === null || valor === undefined) return aceptar(null);
  return entero(valor, etiqueta, minimo, maximo);
}

function nombre(valor: unknown, etiqueta: string): ResultadoDato<string> {
  const n = validarNombreCatalogo(valor, etiqueta, { obligatorio: true });
  if (!n.ok) return rechazar(n.codigo, n.mensaje);
  return aceptar(n.valor!); // obligatorio: nunca null
}

function deLista<T extends string>(valor: unknown, lista: readonly T[], mensaje: string): ResultadoDato<T> {
  return typeof valor === "string" && (lista as readonly string[]).includes(valor) ? aceptar(valor as T) : rechazar("formato", mensaje);
}

function versionEsperada(valor: unknown, minimo: 0 | 1): ResultadoDato<number> {
  const v = entero(valor, "La versión que se esperaba", minimo, ENTERO_MAXIMO_RAZONABLE);
  return v.ok ? v : rechazar(v.codigo, "La versión que se esperaba no es válida: recargá la pantalla.");
}

/** Una diferencia de precio: `{ tipo: "MONTO", monto }` (hasta 2 decimales, puede ser negativa o 0) o `{ tipo: "PORCENTAJE", porcentaje }` (-100 < p ≤ 999,9999, hasta 4 decimales). */
function diferencia(valor: unknown, etiqueta: string): ResultadoDato<DiferenciaDePrecio> {
  if (typeof valor !== "object" || valor === null) return rechazar("formato", `${etiqueta} no es válida.`);
  const d = valor as { tipo?: unknown; monto?: unknown; porcentaje?: unknown };
  if (d.tipo === "MONTO") {
    const monto = validarImporte(d.monto, { etiqueta: `El monto de ${etiqueta.toLowerCase()}`, obligatorio: true, permitirNegativo: true });
    return monto.ok ? aceptar({ tipo: "MONTO", monto: monto.valor! }) : rechazar(monto.codigo, monto.mensaje);
  }
  if (d.tipo === "PORCENTAJE") {
    const p = validarPorcentajeDeDiferencia(d.porcentaje, { etiqueta: `El porcentaje de ${etiqueta.toLowerCase()}` });
    return p.ok ? aceptar({ tipo: "PORCENTAJE", porcentaje: p.valor! }) : rechazar(p.codigo, p.mensaje);
  }
  return rechazar("formato", `${etiqueta} tiene que ser un monto o un porcentaje.`);
}

function diferenciaONula(valor: unknown, etiqueta: string): ResultadoDato<DiferenciaDePrecio | null> {
  if (valor === null || valor === undefined) return aceptar(null);
  return diferencia(valor, etiqueta);
}

function consumo(valor: unknown, linea: number): ResultadoDato<ConsumoDeConfiguracion> {
  const etiqueta = `La línea ${linea} del consumo`;
  if (typeof valor !== "object" || valor === null) return rechazar("formato", `${etiqueta} no es válida.`);
  const c = valor as Record<string, unknown>;
  const efecto = deLista<EfectoDeConsumoDeOpcion>(c.efecto, EFECTOS_DE_CONSUMO_DE_OPCION, `${etiqueta} no dice si suma o reemplaza.`);
  if (!efecto.ok) return efecto;
  const insumo = id(c.insumoProductoId, `${etiqueta} no tiene un insumo válido.`);
  if (!insumo.ok) return insumo;
  const reemplazado = idONulo(c.reemplazaAProductoId, `${etiqueta} no tiene un insumo reemplazado válido.`);
  if (!reemplazado.ok) return reemplazado;
  const cantidad = numeroDeEntrada(c.cantidad);
  if (!cantidad.ok || cantidad.valor === null || !(cantidad.valor > 0) || cantidad.valor >= CANTIDAD_DE_CONSUMO_MAXIMA || !tieneALoSumoDecimales(cantidad.valor, 4)) {
    return rechazar("rango", `${etiqueta}: la cantidad tiene que ser mayor que 0, con hasta 4 decimales.`);
  }
  const merma = numeroDeEntrada(c.mermaPorcentaje ?? 0);
  if (!merma.ok || merma.valor === null || merma.valor < 0 || merma.valor > MERMA_MAXIMA_DE_CONSUMO || !tieneALoSumoDecimales(merma.valor, 2)) {
    return rechazar("rango", `${etiqueta}: la merma tiene que estar entre 0 y ${MERMA_MAXIMA_DE_CONSUMO}, con hasta 2 decimales.`);
  }
  const escala = booleano(c.escalaConLaMedida ?? false, `${etiqueta}: «escala con el tamaño»`);
  if (!escala.ok) return escala;
  return aceptar({
    efecto: efecto.valor,
    insumoProductoId: insumo.valor,
    reemplazaAProductoId: reemplazado.valor,
    cantidad: cantidad.valor,
    mermaPorcentaje: merma.valor,
    escalaConLaMedida: escala.valor,
  });
}

function datosDeVersion(valor: unknown): ResultadoDato<DatosDeVersionDeOpcion> {
  if (typeof valor !== "object" || valor === null) return rechazar("formato", "Los datos de la versión no son válidos.");
  const v = valor as Record<string, unknown>;
  const dif = diferencia(v.diferencia, "La diferencia de precio");
  if (!dif.ok) return dif;
  const factor = validarFactorDeEscala(v.factorEscala, { etiqueta: "El factor de escala", obligatorio: false });
  if (!factor.ok) return rechazar(factor.codigo, factor.mensaje);
  const lista = v.consumos ?? [];
  if (!Array.isArray(lista)) return rechazar("formato", "Los consumos no son una lista.");
  const tope = validarTopeDeLista(lista, "Las líneas de consumo", MAXIMO_CONSUMOS_POR_VERSION);
  if (tope) return rechazar("rango", tope);
  const consumos: ConsumoDeConfiguracion[] = [];
  for (const [i, c] of lista.entries()) {
    const r = consumo(c, i + 1);
    if (!r.ok) return r;
    consumos.push(r.valor);
  }
  return aceptar({ diferencia: dif.valor, factorEscala: factor.valor, consumos });
}

// ───────────────────────────── Grupos ─────────────────────────────

export function guardComandoCrearGrupoDeOpciones(entrada: { nombre: unknown; tipo: unknown; cantidadMinima: unknown; cantidadMaxima: unknown }): ResultadoDato<ComandoCrearGrupoDeOpciones> {
  const n = nombre(entrada.nombre, "El nombre del grupo");
  if (!n.ok) return n;
  const tipo = deLista<TipoDeGrupoDeOpciones>(entrada.tipo, TIPOS_DE_GRUPO_DE_OPCIONES, "El tipo de grupo no es válido.");
  if (!tipo.ok) return tipo;
  const minimo = entero(entrada.cantidadMinima, "El mínimo de opciones", 0, CANTIDAD_MAXIMA_DE_OPCION);
  if (!minimo.ok) return minimo;
  const maximo = entero(entrada.cantidadMaxima, "El máximo de opciones", 1, CANTIDAD_MAXIMA_DE_OPCION);
  if (!maximo.ok) return maximo;
  return aceptar({ nombre: n.valor, tipo: tipo.valor, cantidadMinima: minimo.valor, cantidadMaxima: maximo.valor });
}

export function guardComandoEditarGrupoDeOpciones(entrada: {
  grupoId: unknown;
  versionEsperada: unknown;
  nombre: unknown;
  cantidadMinima: unknown;
  cantidadMaxima: unknown;
  activo: unknown;
}): ResultadoDato<ComandoEditarGrupoDeOpciones> {
  const grupoId = id(entrada.grupoId, MENSAJE_GRUPO_NO_ENCONTRADO);
  if (!grupoId.ok) return grupoId;
  const version = versionEsperada(entrada.versionEsperada, 1);
  if (!version.ok) return version;
  const n = nombre(entrada.nombre, "El nombre del grupo");
  if (!n.ok) return n;
  const minimo = entero(entrada.cantidadMinima, "El mínimo de opciones", 0, CANTIDAD_MAXIMA_DE_OPCION);
  if (!minimo.ok) return minimo;
  const maximo = entero(entrada.cantidadMaxima, "El máximo de opciones", 1, CANTIDAD_MAXIMA_DE_OPCION);
  if (!maximo.ok) return maximo;
  const activo = booleano(entrada.activo, "«Activo»");
  if (!activo.ok) return activo;
  return aceptar({ grupoId: grupoId.valor, versionEsperada: version.valor, nombre: n.valor, cantidadMinima: minimo.valor, cantidadMaxima: maximo.valor, activo: activo.valor });
}

// ───────────────────────────── Opciones y versiones ─────────────────────────────

export function guardComandoCrearOpcionDeGrupo(entrada: {
  grupoId: unknown;
  nombre: unknown;
  orden: unknown;
  esNinguna: unknown;
  version: unknown;
  ancla: unknown;
}): ResultadoDato<ComandoCrearOpcionDeGrupo> {
  const grupoId = id(entrada.grupoId, MENSAJE_GRUPO_NO_ENCONTRADO);
  if (!grupoId.ok) return grupoId;
  const n = nombre(entrada.nombre, "El nombre de la opción");
  if (!n.ok) return n;
  const orden = entero(entrada.orden ?? 0, "El orden", 0, ENTERO_MAXIMO_RAZONABLE);
  if (!orden.ok) return orden;
  const esNinguna = booleano(entrada.esNinguna ?? false, "«Ninguna»");
  if (!esNinguna.ok) return esNinguna;
  const version = datosDeVersion(entrada.version);
  if (!version.ok) return version;
  let ancla: ComandoCrearOpcionDeGrupo["ancla"] = null;
  if (entrada.ancla !== null && entrada.ancla !== undefined) {
    if (typeof entrada.ancla !== "object") return rechazar("formato", "Los datos del producto de respaldo no son válidos.");
    const unidad = id((entrada.ancla as { unidadStockId?: unknown }).unidadStockId, "Elegí la unidad del producto de respaldo.");
    if (!unidad.ok) return unidad;
    ancla = { unidadStockId: unidad.valor };
  }
  return aceptar({ grupoId: grupoId.valor, nombre: n.valor, orden: orden.valor, esNinguna: esNinguna.valor, version: version.valor, ancla });
}

export function guardComandoEditarOpcionDeGrupo(entrada: { opcionId: unknown; versionEsperada: unknown; nombre: unknown; orden: unknown; activa: unknown }): ResultadoDato<ComandoEditarOpcionDeGrupo> {
  const opcionId = id(entrada.opcionId, MENSAJE_OPCION_NO_ENCONTRADA);
  if (!opcionId.ok) return opcionId;
  const version = versionEsperada(entrada.versionEsperada, 1);
  if (!version.ok) return version;
  const n = nombre(entrada.nombre, "El nombre de la opción");
  if (!n.ok) return n;
  const orden = entero(entrada.orden, "El orden", 0, ENTERO_MAXIMO_RAZONABLE);
  if (!orden.ok) return orden;
  const activa = booleano(entrada.activa, "«Activa»");
  if (!activa.ok) return activa;
  return aceptar({ opcionId: opcionId.valor, versionEsperada: version.valor, nombre: n.valor, orden: orden.valor, activa: activa.valor });
}

export function guardComandoAgregarVersionDeOpcion(entrada: { opcionId: unknown; numeroEsperado: unknown; version: unknown }): ResultadoDato<ComandoAgregarVersionDeOpcion> {
  const opcionId = id(entrada.opcionId, MENSAJE_OPCION_NO_ENCONTRADA);
  if (!opcionId.ok) return opcionId;
  const numero = versionEsperada(entrada.numeroEsperado, 1);
  if (!numero.ok) return numero;
  const version = datosDeVersion(entrada.version);
  if (!version.ok) return version;
  return aceptar({ opcionId: opcionId.valor, numeroEsperado: numero.valor, version: version.valor });
}

// ───────────────────────────── Lo que admite cada producto ─────────────────────────────

function opcionAdmitida(valor: unknown, posicion: number): ResultadoDato<OpcionAdmitidaEnComando> {
  const etiqueta = `La opción ${posicion}`;
  if (typeof valor !== "object" || valor === null) return rechazar("formato", `${etiqueta} no es válida.`);
  const o = valor as Record<string, unknown>;
  const opcionId = id(o.opcionId, `${etiqueta} no es válida.`);
  if (!opcionId.ok) return opcionId;
  const version = versionEsperada(o.versionEsperada, 0);
  if (!version.ok) return version;
  const tope = entero(o.cantidadMaxima ?? 1, `El tope de ${etiqueta.toLowerCase()}`, 1, CANTIDAD_MAXIMA_DE_OPCION);
  if (!tope.ok) return tope;
  const precio = validarImporte(o.precioAbsoluto, { etiqueta: `El precio propio de ${etiqueta.toLowerCase()}`, permitirCero: false });
  if (!precio.ok) return rechazar(precio.codigo, precio.mensaje);
  const dif = diferenciaONula(o.diferencia, `La diferencia de ${etiqueta.toLowerCase()}`);
  if (!dif.ok) return dif;
  const activo = booleano(o.activo ?? true, `«Activa» de ${etiqueta.toLowerCase()}`);
  if (!activo.ok) return activo;
  return aceptar({ opcionId: opcionId.valor, versionEsperada: version.valor, cantidadMaxima: tope.valor, precioAbsoluto: precio.valor, diferencia: dif.valor, activo: activo.valor });
}

export function guardComandoFijarAdmisionDeGrupo(entrada: {
  productoId: unknown;
  grupoId: unknown;
  versionEsperada: unknown;
  orden: unknown;
  cantidadMinima: unknown;
  cantidadMaxima: unknown;
  modoPrecio: unknown;
  activo: unknown;
  opciones: unknown;
}): ResultadoDato<ComandoFijarAdmisionDeGrupo> {
  const productoId = id(entrada.productoId, "No se encontró el producto.");
  if (!productoId.ok) return productoId;
  const grupoId = id(entrada.grupoId, MENSAJE_GRUPO_NO_ENCONTRADO);
  if (!grupoId.ok) return grupoId;
  const version = versionEsperada(entrada.versionEsperada, 0);
  if (!version.ok) return version;
  const orden = entero(entrada.orden ?? 0, "El orden", 0, ENTERO_MAXIMO_RAZONABLE);
  if (!orden.ok) return orden;
  const minimo = enteroONulo(entrada.cantidadMinima, "El mínimo de este producto", 0, CANTIDAD_MAXIMA_DE_OPCION);
  if (!minimo.ok) return minimo;
  const maximo = enteroONulo(entrada.cantidadMaxima, "El máximo de este producto", 1, CANTIDAD_MAXIMA_DE_OPCION);
  if (!maximo.ok) return maximo;
  let modoPrecio: ModoDePrecioDeMedida | null = null;
  if (entrada.modoPrecio !== null && entrada.modoPrecio !== undefined) {
    const modo = deLista<ModoDePrecioDeMedida>(entrada.modoPrecio, MODOS_DE_PRECIO_DE_MEDIDA, "El modo de precio no es válido.");
    if (!modo.ok) return modo;
    modoPrecio = modo.valor;
  }
  const activo = booleano(entrada.activo, "«Activo»");
  if (!activo.ok) return activo;
  if (!Array.isArray(entrada.opciones)) return rechazar("formato", "Las opciones no son una lista.");
  const tope = validarTopeDeLista(entrada.opciones, "Las opciones", MAXIMO_OPCIONES_POR_ADMISION);
  if (tope) return rechazar("rango", tope);
  const opciones: OpcionAdmitidaEnComando[] = [];
  for (const [i, o] of entrada.opciones.entries()) {
    const r = opcionAdmitida(o, i + 1);
    if (!r.ok) return r;
    opciones.push(r.valor);
  }
  return aceptar({
    productoId: productoId.valor,
    grupoId: grupoId.valor,
    versionEsperada: version.valor,
    orden: orden.valor,
    cantidadMinima: minimo.valor,
    cantidadMaxima: maximo.valor,
    modoPrecio,
    activo: activo.valor,
    opciones,
  });
}
