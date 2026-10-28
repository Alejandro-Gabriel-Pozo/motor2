import { esLocalDelImportador, REGLA_MAS_FRECUENTE_Y_EL_MAYOR, type CorreccionNominal, type CorreccionesDelDueno, type ErrorDeImportacion, type LocalDelImportador } from "./tipos";

/**
 * Lee y valida el archivo de correcciones del dueño (`correcciones.json`, ADENDA v2 A.1 del diseño del importador): las correcciones nominales (`precioUnico`, `nombre`), la aceptación de la
 * regla de precio único y el mapeo de categorías a secciones de carta. Todo con forma CERRADA: una clave que no se conoce, un precio que no es un entero positivo, una fecha sin forma
 * `AAAA-MM-DD` o un motivo vacío son errores (nunca se adivina ni se completa nada). Puro: recibe el JSON ya parseado.
 */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Las claves que acepta cada parte del archivo (forma cerrada; el guardián `DIMENSIONES_DEL_IMPORTADOR` exige que cada una esté declarada). */
export const CLAVES_DEL_ARCHIVO_DE_CORRECCIONES = ["version", "reglaDePrecioUnico", "correcciones", "mapeoDeSecciones"] as const;
export const CLAVES_DE_LA_REGLA = ["regla", "fecha", "motivo"] as const;
export const CLAVES_DE_CORRECCION_DE_PRECIO_UNICO = ["tipo", "sku", "preciosEnElExcel", "valorACargar", "fecha", "motivo"] as const;
export const CLAVES_DE_CORRECCION_DE_NOMBRE = ["tipo", "sku", "valorEnElExcel", "valorACargar", "fecha", "motivo"] as const;
const ARCHIVO = "correcciones.json";

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const textoNoVacio = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
/** Un precio de una corrección: entero en pesos, mayor que cero y exacto en `number` (entero seguro). */
export const esPrecioEnteroDeCorreccion = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function error(motivo: string, sku: string | null = null): ErrorDeImportacion {
  return { hoja: ARCHIVO, fila: null, columna: null, valor: null, sku, codigo: "CORRECCIONES_INVALIDAS", motivo };
}

function clavesDeMas(objeto: Record<string, unknown>, permitidas: readonly string[], donde: string, sku: string | null = null): ErrorDeImportacion[] {
  return Object.keys(objeto)
    .filter((k) => !permitidas.includes(k))
    .map((k) => error(`${donde}: la clave «${k}» no se conoce.`, sku));
}

function fechaYMotivo(c: Record<string, unknown>, donde: string, sku: string | null): ErrorDeImportacion[] {
  const errores: ErrorDeImportacion[] = [];
  if (typeof c.fecha !== "string" || !RE_FECHA.test(c.fecha)) errores.push(error(`${donde}: falta la fecha (AAAA-MM-DD).`, sku));
  if (!textoNoVacio(c.motivo)) errores.push(error(`${donde}: falta el motivo.`, sku));
  return errores;
}

function leerCorreccion(c: unknown, i: number): { correccion: CorreccionNominal | null; errores: ErrorDeImportacion[] } {
  const donde = `corrección ${i + 1}`;
  if (!esObjeto(c)) return { correccion: null, errores: [error(`${donde}: no es un objeto.`)] };
  const sku = textoNoVacio(c.sku) ? c.sku.trim() : null;
  const errores: ErrorDeImportacion[] = [];
  if (!sku) errores.push(error(`${donde}: falta el SKU.`));
  if (c.tipo === "precioUnico") {
    errores.push(...clavesDeMas(c, CLAVES_DE_CORRECCION_DE_PRECIO_UNICO, donde, sku), ...fechaYMotivo(c, donde, sku));
    const precios: Partial<Record<LocalDelImportador, number>> = {};
    if (!esObjeto(c.preciosEnElExcel) || Object.keys(c.preciosEnElExcel).length === 0) errores.push(error(`${donde}: faltan los precios que trae el Excel (local → precio).`, sku));
    else
      for (const [local, precio] of Object.entries(c.preciosEnElExcel)) {
        if (!esLocalDelImportador(local)) errores.push(error(`${donde}: «${local}» no es uno de los 5 locales.`, sku));
        else if (!esPrecioEnteroDeCorreccion(precio)) errores.push(error(`${donde}: el precio de ${local} tiene que ser un entero mayor que cero.`, sku));
        else precios[local] = precio;
      }
    if (!esPrecioEnteroDeCorreccion(c.valorACargar)) errores.push(error(`${donde}: el valor a cargar tiene que ser un entero mayor que cero.`, sku));
    if (errores.length > 0 || !sku) return { correccion: null, errores };
    return { correccion: { tipo: "precioUnico", sku, preciosEnElExcel: precios, valorACargar: c.valorACargar as number, fecha: c.fecha as string, motivo: (c.motivo as string).trim() }, errores };
  }
  if (c.tipo === "nombre") {
    errores.push(...clavesDeMas(c, CLAVES_DE_CORRECCION_DE_NOMBRE, donde, sku), ...fechaYMotivo(c, donde, sku));
    if (!textoNoVacio(c.valorEnElExcel)) errores.push(error(`${donde}: falta el nombre que trae el Excel.`, sku));
    if (!textoNoVacio(c.valorACargar)) errores.push(error(`${donde}: falta el nombre a cargar.`, sku));
    if (errores.length > 0 || !sku) return { correccion: null, errores };
    return {
      correccion: { tipo: "nombre", sku, valorEnElExcel: (c.valorEnElExcel as string).trim(), valorACargar: (c.valorACargar as string).trim(), fecha: c.fecha as string, motivo: (c.motivo as string).trim() },
      errores,
    };
  }
  return { correccion: null, errores: [error(`${donde}: el tipo tiene que ser «precioUnico» o «nombre».`, sku)] };
}

/** Las correcciones validadas, o los errores (con la corrección que falló). Una corrección repetida (mismo tipo y SKU) es error: no se elige una en silencio. */
export function leerCorrecciones(json: unknown): { ok: true; correcciones: CorreccionesDelDueno } | { ok: false; errores: ErrorDeImportacion[] } {
  if (!esObjeto(json)) return { ok: false, errores: [error("el archivo tiene que ser un objeto JSON.")] };
  const errores: ErrorDeImportacion[] = [...clavesDeMas(json, CLAVES_DEL_ARCHIVO_DE_CORRECCIONES, "el archivo")];
  if (json.version !== 1) errores.push(error("la versión tiene que ser 1."));

  let regla: CorreccionesDelDueno["reglaDePrecioUnico"] = null;
  if (json.reglaDePrecioUnico !== undefined && json.reglaDePrecioUnico !== null) {
    const r = json.reglaDePrecioUnico;
    if (!esObjeto(r)) errores.push(error("reglaDePrecioUnico: no es un objeto."));
    else {
      errores.push(...clavesDeMas(r, CLAVES_DE_LA_REGLA, "reglaDePrecioUnico"), ...fechaYMotivo(r, "reglaDePrecioUnico", null));
      if (r.regla !== REGLA_MAS_FRECUENTE_Y_EL_MAYOR) errores.push(error(`reglaDePrecioUnico: la única regla que existe es «${REGLA_MAS_FRECUENTE_Y_EL_MAYOR}».`));
      else if (typeof r.fecha === "string" && textoNoVacio(r.motivo)) regla = { regla: REGLA_MAS_FRECUENTE_Y_EL_MAYOR, fecha: r.fecha, motivo: r.motivo.trim() };
    }
  }

  const correcciones: CorreccionNominal[] = [];
  if (json.correcciones !== undefined && !Array.isArray(json.correcciones)) errores.push(error("correcciones: tiene que ser una lista."));
  for (const [i, c] of (Array.isArray(json.correcciones) ? json.correcciones : []).entries()) {
    const leida = leerCorreccion(c, i);
    errores.push(...leida.errores);
    if (!leida.correccion) continue;
    if (correcciones.some((o) => o.tipo === leida.correccion!.tipo && o.sku === leida.correccion!.sku)) errores.push(error(`corrección ${i + 1}: hay otra corrección «${leida.correccion.tipo}» para el mismo SKU.`, leida.correccion.sku));
    else correcciones.push(leida.correccion);
  }

  const mapeo: Record<string, string | null> = {};
  if (!esObjeto(json.mapeoDeSecciones)) errores.push(error("falta el mapeo de categorías a secciones de carta (mapeoDeSecciones)."));
  else
    for (const [categoria, seccion] of Object.entries(json.mapeoDeSecciones)) {
      if (seccion === null) mapeo[categoria] = null;
      else if (textoNoVacio(seccion)) mapeo[categoria] = seccion.trim();
      else errores.push(error(`mapeoDeSecciones: la categoría «${categoria}» tiene que ir a un nombre de sección o a null (sin sección).`));
    }

  if (errores.length > 0) return { ok: false, errores };
  return { ok: true, correcciones: { reglaDePrecioUnico: regla, correcciones, mapeoDeSecciones: mapeo } };
}
