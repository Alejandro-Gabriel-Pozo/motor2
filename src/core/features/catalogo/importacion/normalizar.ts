import { LARGO_MAXIMO_DESCRIPCION_CARTA, aCentavos, validarTextoLibreCarta } from "@/core/carta/public";
import { CENTAVOS_MAXIMOS, validarImporte } from "@/core/datos/importe";
import { quitarCaracteresInadmisibles, texto, validarTextoCatalogo } from "@/core/texto";
import { esPrecioEnteroDeCorreccion } from "./correcciones";
import {
  esLocalDelImportador,
  LOCALES_DEL_IMPORTADOR,
  type AvisoDeImportacion,
  type CatalogoNormalizado,
  type CeldaDeEntrada,
  type CorreccionDePrecioUnico,
  type CorreccionesDelDueno,
  type DescripcionDeCarta,
  type ErrorDeImportacion,
  type FilaDePrecioNormalizada,
  type LibroDeEntrada,
  type LocalDelImportador,
  type ProductoNormalizado,
} from "./tipos";

/**
 * NORMALIZADOR Y VALIDADOR del importador del catálogo (E1.2; diseño §4.3, I8, I11, I12 y ADENDA A.1-A.3). Puro: del libro que leyó el lector y las correcciones del dueño saca los
 * productos (uno por SKU de «Catálogo») y las filas por local («Precios por local»), con TODOS los errores por fila (hoja, fila, columna, valor, motivo) y los avisos. No lee la base:
 * lo que depende de ella (sucursales, secciones, productos existentes, permisos) lo decide el planificador.
 *
 * Forma CERRADA (guardián `DIMENSIONES_DEL_IMPORTADOR`): las hojas y los encabezados son exactamente los de `ENCABEZADOS`; una hoja o una columna con datos que no está declarada es error,
 * no se ignora en silencio.
 */

/** Versión del normalizador: entra en la huella (si cambia cómo se lee el Excel, una huella vieja ya no confirma). */
export const VERSION_DEL_NORMALIZADOR = "importador-de-catalogo/1";

export const HOJA_CATALOGO = "Catálogo";
export const HOJA_PRECIOS = "Precios por local";
export const HOJA_PRODUCTOS = "Productos";
export const HOJA_INCONSISTENCIAS = "Inconsistencias";
export const HOJA_LEEME = "Leeme";

/** Los encabezados EXACTOS de cada hoja que se lee, en orden (fila 1). «Leeme» no tiene encabezados: no se lee. */
export const ENCABEZADOS: Readonly<Record<string, readonly string[]>> = {
  [HOJA_CATALOGO]: [
    "SKU",
    "Categoría",
    "Producto base",
    "Variante 1",
    "Variante 2",
    "Variante 3",
    "Marca / bodega",
    ...LOCALES_DEL_IMPORTADOR,
    "Precio mín",
    "Precio máx",
    "Precio difiere",
    "Sin stock en",
  ],
  [HOJA_PRECIOS]: ["SKU", "Producto base", "Local", "Precio", "Disponible", "Nombre en la carta", "Descripción en la carta"],
  [HOJA_PRODUCTOS]: ["Categoría", "Producto base", "Eje variante 1", "Eje variante 2", "Eje variante 3", "Cant. SKUs", "Cant. locales", "Locales"],
  [HOJA_INCONSISTENCIAS]: ["Tipo", "SKU / producto", "Detalle"],
};

/** Las hojas que se aceptan y NO se leen (con su motivo en `DIMENSIONES_DEL_IMPORTADOR`). */
export const HOJAS_QUE_NO_SE_LEEN: readonly string[] = [HOJA_LEEME];

const RE_SKU = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const LARGO_MAXIMO_SKU = 80;
const RE_PRECIO_ENTERO = /^\d+$/;
const CIEN = BigInt(100);
const CERO = BigInt(0);

/** «A1» → columna «A» y fila 1 (para los problemas del lector). */
function partirReferencia(ref: string): { columna: string | null; fila: number | null } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { columna: m[1], fila: Number(m[2]) } : { columna: ref, fila: null };
}

function letra(columna: number): string {
  let n = columna + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function textoDeCelda(c: CeldaDeEntrada | undefined): string | null {
  if (!c) return null;
  if (c.tipo === "booleano") return c.valor ? "TRUE" : "FALSE";
  const v = texto(c.valor);
  return v === "" ? null : v;
}

/** Arma el nombre del producto: la base y las variantes no vacías, separadas por un espacio, sin repetir la base (§4.3). */
export function nombreDelExcel(base: string, variantes: readonly string[]): string {
  return [base, ...variantes.filter((v) => v !== base)].join(" ");
}

/** La descripción de una fila, validada con el MISMO validador de la carta (I11) y sin caracteres que Postgres no recibe (NUL, sustitutos sueltos: se rechazan, no se borran en silencio). */
export function descripcionDeCarta(valor: string | null): DescripcionDeCarta {
  if (valor === null || texto(valor) === "") return { estado: "AUSENTE" };
  if (quitarCaracteresInadmisibles(valor) !== valor) return { estado: "INVALIDA", texto: valor, mensaje: "La descripción tiene caracteres que no se pueden guardar (NUL o un emoji partido)." };
  const validada = validarTextoLibreCarta(valor, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!validada.ok) return { estado: "INVALIDA", texto: valor, mensaje: validada.mensaje };
  return validada.valor === null ? { estado: "AUSENTE" } : { estado: "VALIDA", valor: validada.valor };
}

/** Un precio de una celda: entero > 0, dentro del tope de la columna, validado con `validarImporte` y llevado a centavos DESDE EL TEXTO (`aCentavos`), nunca por `number`. */
export function precioDeCelda(c: CeldaDeEntrada | undefined): { ok: true; centavos: bigint | null } | { ok: false; motivo: string } {
  if (!c) return { ok: true, centavos: null };
  if (c.tipo !== "numero") return { ok: false, motivo: "el precio no es un número" };
  if (!RE_PRECIO_ENTERO.test(c.valor)) return { ok: false, motivo: "el precio tiene que ser un entero (pesos, sin decimales)" };
  const validado = validarImporte(c.valor, { etiqueta: "El precio", obligatorio: true, permitirCero: false });
  if (!validado.ok) return { ok: false, motivo: validado.mensaje };
  const centavos = aCentavos(c.valor);
  if (centavos === null || centavos <= CERO || centavos > CENTAVOS_MAXIMOS) return { ok: false, motivo: "el precio está fuera del rango de la columna" };
  return { ok: true, centavos };
}

/** Normaliza y valida el libro con las correcciones del dueño. Nunca lanza: todo lo que no cierra es un error (bloqueante) o un aviso. */
export function normalizarCatalogo(libro: LibroDeEntrada, correcciones: CorreccionesDelDueno): CatalogoNormalizado {
  const errores: ErrorDeImportacion[] = [];
  const avisos: AvisoDeImportacion[] = [];
  const err = (e: Omit<ErrorDeImportacion, "valor" | "sku"> & { valor?: string | null; sku?: string | null }) => errores.push({ valor: null, sku: null, ...e });

  for (const p of libro.problemas) {
    const { columna, fila } = partirReferencia(p.celda);
    err({ hoja: p.hoja, fila, columna, codigo: "CELDA_ILEGIBLE", motivo: p.motivo });
  }

  const hojas = new Map(libro.hojas.map((h) => [h.nombre, h]));
  for (const h of libro.hojas) {
    if (!(h.nombre in ENCABEZADOS) && !HOJAS_QUE_NO_SE_LEEN.includes(h.nombre)) err({ hoja: h.nombre, fila: null, columna: null, codigo: "HOJA_NO_DECLARADA", motivo: "el importador no conoce esta hoja" });
  }

  /** Las filas de datos de una hoja (sin el encabezado), después de comprobar el encabezado y que ninguna celda caiga fuera de las columnas declaradas. */
  const filasDe = (nombre: string) => {
    const hoja = hojas.get(nombre);
    const esperados = ENCABEZADOS[nombre];
    if (!hoja) {
      err({ hoja: nombre, fila: null, columna: null, codigo: "FALTA_LA_HOJA", motivo: "falta la hoja" });
      return [];
    }
    const encabezado = hoja.filas.find((f) => f.numero === 1);
    for (const [i, esperado] of esperados.entries()) {
      const real = textoDeCelda(encabezado?.celdas.get(i));
      if (real !== esperado) err({ hoja: nombre, fila: 1, columna: letra(i), valor: real, codigo: "ENCABEZADO_DISTINTO", motivo: `se esperaba «${esperado}»` });
    }
    for (const f of hoja.filas)
      for (const [col, c] of f.celdas)
        if (col >= esperados.length) err({ hoja: nombre, fila: f.numero, columna: letra(col), valor: textoDeCelda(c), codigo: "COLUMNA_NO_DECLARADA", motivo: "la columna no es una de las declaradas" });
    return hoja.filas.filter((f) => f.numero > 1);
  };

  // ── Catálogo: un producto por SKU ──
  const columnaCatalogo = (nombre: string) => ENCABEZADOS[HOJA_CATALOGO].indexOf(nombre);
  const productos: ProductoNormalizado[] = [];
  const preciosDelCatalogo = new Map<string, Map<LocalDelImportador, { centavos: bigint | null; ilegible: boolean; fila: number; columna: string; valor: string | null }>>();
  const skusVistos = new Set<string>();
  /** SKU → el valor de cada eje (Variante 1 a 3) en su posición, para el aviso de un eje sin valores. */
  const ejesPorSku = new Map<string, (string | null)[]>();
  for (const f of filasDe(HOJA_CATALOGO)) {
    const celda = (nombre: string) => f.celdas.get(columnaCatalogo(nombre));
    const sku = textoDeCelda(celda("SKU"));
    const enFila = (columna: string, valor: string | null, codigo: string, motivo: string) => err({ hoja: HOJA_CATALOGO, fila: f.numero, columna, valor, sku, codigo, motivo });
    if (!sku) {
      enFila("A", null, "SKU_VACIO", "falta el SKU");
      continue;
    }
    if (!RE_SKU.test(sku) || sku.length > LARGO_MAXIMO_SKU) {
      enFila("A", sku, "SKU_INVALIDO", `el SKU tiene que ser MAYÚSCULAS, dígitos y guiones (${LARGO_MAXIMO_SKU} caracteres como máximo)`);
      continue;
    }
    if (skusVistos.has(sku)) {
      enFila("A", sku, "SKU_REPETIDO", "el SKU está repetido en «Catálogo»");
      continue;
    }
    skusVistos.add(sku);
    for (const nombre of ENCABEZADOS[HOJA_CATALOGO]) {
      const c = celda(nombre);
      if (c?.tipo === "booleano" && nombre !== "Precio difiere") enFila(letra(columnaCatalogo(nombre)), textoDeCelda(c), "CELDA_DE_OTRO_TIPO", "se esperaba texto o número");
    }
    const categoria = textoDeCelda(celda("Categoría"));
    const base = textoDeCelda(celda("Producto base"));
    if (!categoria) enFila("B", null, "CATEGORIA_VACIA", "falta la categoría");
    if (!base) enFila("C", null, "BASE_VACIA", "falta el producto base");
    const ejes = ["Variante 1", "Variante 2", "Variante 3"].map((v) => textoDeCelda(celda(v)));
    ejesPorSku.set(sku, ejes);
    const variantes = ejes.filter((v): v is string => v !== null);
    const porLocal = new Map<LocalDelImportador, { centavos: bigint | null; ilegible: boolean; fila: number; columna: string; valor: string | null }>();
    for (const local of LOCALES_DEL_IMPORTADOR) {
      const c = celda(local);
      const columna = letra(columnaCatalogo(local));
      const precio = precioDeCelda(c);
      if (!precio.ok) enFila(columna, textoDeCelda(c), "PRECIO_INVALIDO", precio.motivo);
      porLocal.set(local, { centavos: precio.ok ? precio.centavos : null, ilegible: !precio.ok, fila: f.numero, columna, valor: textoDeCelda(c) });
    }
    preciosDelCatalogo.set(sku, porLocal);
    if (!categoria || !base) continue;
    const nombreExcel = nombreDelExcel(base, variantes);
    productos.push({ fila: f.numero, sku, categoria, base, variantes, marca: textoDeCelda(celda("Marca / bodega")), nombreEnElExcel: nombreExcel, nombre: nombreExcel, nombreCorregido: false });
  }
  const productoPorSku = new Map(productos.map((p) => [p.sku, p]));

  // ── Precios por local: una fila por (SKU, local) ──
  const columnaPrecios = (nombre: string) => ENCABEZADOS[HOJA_PRECIOS].indexOf(nombre);
  const filas: FilaDePrecioNormalizada[] = [];
  const paresVistos = new Set<string>();
  /** (SKU|local) cuyo precio no se pudo leer: ya tiene su error; no se compara con «Catálogo» (sería el mismo error dos veces). */
  const conPrecioIlegible = new Set<string>();
  for (const f of filasDe(HOJA_PRECIOS)) {
    const celda = (nombre: string) => f.celdas.get(columnaPrecios(nombre));
    const sku = textoDeCelda(celda("SKU"));
    const enFila = (nombre: string, valor: string | null, codigo: string, motivo: string) =>
      err({ hoja: HOJA_PRECIOS, fila: f.numero, columna: letra(columnaPrecios(nombre)), valor, sku, codigo, motivo });
    if (!sku) {
      enFila("SKU", null, "SKU_VACIO", "falta el SKU");
      continue;
    }
    const producto = productoPorSku.get(sku);
    if (!producto) {
      if (!skusVistos.has(sku)) enFila("SKU", sku, "SKU_DESCONOCIDO", "el SKU no está en «Catálogo»");
      continue;
    }
    const base = textoDeCelda(celda("Producto base"));
    if (base !== producto.base) enFila("Producto base", base, "DISTINTO_DEL_CATALOGO", `en «Catálogo» el producto base es «${producto.base}»`);
    const local = textoDeCelda(celda("Local"));
    if (!local || !esLocalDelImportador(local)) {
      enFila("Local", local, "LOCAL_DESCONOCIDO", `el local tiene que ser uno de: ${LOCALES_DEL_IMPORTADOR.join(", ")}`);
      continue;
    }
    if (paresVistos.has(`${sku}|${local}`)) {
      enFila("Local", local, "FILA_REPETIDA", "el par (SKU, local) está repetido");
      continue;
    }
    paresVistos.add(`${sku}|${local}`);
    const precio = precioDeCelda(celda("Precio"));
    if (!precio.ok) {
      enFila("Precio", textoDeCelda(celda("Precio")), "PRECIO_INVALIDO", precio.motivo);
      conPrecioIlegible.add(`${sku}|${local}`);
    }
    const textoDisponible = textoDeCelda(celda("Disponible"));
    const disponibleLegible = textoDisponible === "TRUE" || textoDisponible === "FALSE";
    // Un «Disponible» ilegible es error; la fila se conserva (como no disponible) para no sumar errores en cadena por la misma celda.
    if (!disponibleLegible) enFila("Disponible", textoDisponible, "DISPONIBLE_INVALIDO", "«Disponible» tiene que ser TRUE o FALSE");
    const disponible = textoDisponible === "TRUE";
    const centavos = precio.ok ? precio.centavos : null;
    if (precio.ok && disponible && centavos === null) enFila("Precio", null, "DISPONIBLE_SIN_PRECIO", "un local disponible tiene que tener precio (I7)");
    const cDescripcion = celda("Descripción en la carta");
    filas.push({
      fila: f.numero,
      sku,
      local,
      precioCentavos: centavos,
      disponible,
      nombreEnCarta: textoDeCelda(celda("Nombre en la carta")),
      descripcion: descripcionDeCarta(cDescripcion && cDescripcion.tipo !== "booleano" ? cDescripcion.valor : null),
    });
  }

  // ── «Catálogo» y «Precios por local» dicen lo mismo (I8) ──
  const filasPorSku = new Map<string, FilaDePrecioNormalizada[]>();
  for (const fila of filas) filasPorSku.set(fila.sku, [...(filasPorSku.get(fila.sku) ?? []), fila]);
  for (const p of productos) {
    const enCatalogo = preciosDelCatalogo.get(p.sku)!;
    const deLaFila = new Map((filasPorSku.get(p.sku) ?? []).map((f) => [f.local, f]));
    for (const local of LOCALES_DEL_IMPORTADOR) {
      const c = enCatalogo.get(local)!;
      if (c.ilegible || conPrecioIlegible.has(`${p.sku}|${local}`)) continue;
      const fila = deLaFila.get(local);
      const enPrecios = fila ? fila.precioCentavos : null;
      if (c.centavos !== enPrecios)
        err({ hoja: HOJA_CATALOGO, fila: c.fila, columna: c.columna, valor: c.valor, sku: p.sku, codigo: "DISTINTO_DE_PRECIOS_POR_LOCAL", motivo: `en «Precios por local» ${local} ${enPrecios === null ? "no tiene precio" : `tiene ${enPrecios / CIEN}`}` });
    }
    if (!filasPorSku.has(p.sku)) avisos.push({ tipo: "SIN_FILAS_POR_LOCAL", sku: p.sku, detalle: "no tiene ninguna fila en «Precios por local»: se crearía sin disponibilidad en ningún local" });
  }

  // ── Correcciones nominales (A.1, I12) ──
  const usadas = new Set<string>();
  for (const c of correcciones.correcciones) {
    if (c.tipo !== "nombre") continue;
    const p = productoPorSku.get(c.sku);
    if (!p) continue;
    usadas.add(`nombre|${c.sku}`);
    if (p.nombreEnElExcel !== c.valorEnElExcel) {
      err({ hoja: HOJA_CATALOGO, fila: p.fila, columna: "C", valor: p.nombreEnElExcel, sku: c.sku, codigo: "CORRECCION_NO_COINCIDE", motivo: `la corrección de nombre se registró para «${c.valorEnElExcel}» y el Excel trae otro: no se aplica en silencio` });
      continue;
    }
    p.nombre = c.valorACargar;
    p.nombreCorregido = true;
  }
  const preciosUnicosCorregidos = new Map<string, { centavos: bigint; correccion: CorreccionDePrecioUnico }>();
  for (const c of correcciones.correcciones) {
    if (c.tipo !== "precioUnico") continue;
    const p = productoPorSku.get(c.sku);
    if (!p) continue;
    usadas.add(`precioUnico|${c.sku}`);
    const enElExcel = new Map((filasPorSku.get(c.sku) ?? []).filter((f) => f.precioCentavos !== null).map((f) => [f.local, f.precioCentavos!]));
    const registrados = Object.entries(c.preciosEnElExcel) as [LocalDelImportador, number][];
    const coincide = registrados.length === enElExcel.size && registrados.every(([local, precio]) => enElExcel.get(local) === BigInt(precio) * CIEN);
    if (!coincide || !esPrecioEnteroDeCorreccion(c.valorACargar)) {
      err({ hoja: HOJA_PRECIOS, fila: null, columna: "D", valor: null, sku: c.sku, codigo: "CORRECCION_NO_COINCIDE", motivo: "la corrección de precio único se registró para otros precios que los que trae hoy el Excel: no se aplica en silencio" });
      continue;
    }
    preciosUnicosCorregidos.set(c.sku, { centavos: BigInt(c.valorACargar) * CIEN, correccion: c });
  }
  for (const c of correcciones.correcciones) if (!usadas.has(`${c.tipo}|${c.sku}`)) avisos.push({ tipo: "CORRECCION_SIN_USAR", sku: c.sku, detalle: `la corrección «${c.tipo}» es de un SKU que el Excel no trae` });

  // ── Nombres: válidos y sin repetir sin distinguir mayúsculas (I8) ──
  const nombres = new Map<string, string>();
  for (const p of productos) {
    const invalido = validarTextoCatalogo(p.nombre, "El nombre");
    if (invalido) err({ hoja: HOJA_CATALOGO, fila: p.fila, columna: "C", valor: p.nombre, sku: p.sku, codigo: "NOMBRE_INVALIDO", motivo: `${invalido} (se corrige con una corrección «nombre»)` });
    const clave = p.nombre.toLowerCase();
    const otro = nombres.get(clave);
    if (otro) err({ hoja: HOJA_CATALOGO, fila: p.fila, columna: "C", valor: p.nombre, sku: p.sku, codigo: "NOMBRE_REPETIDO", motivo: `el nombre se repite con ${otro} (sin distinguir mayúsculas)` });
    else nombres.set(clave, p.sku);
  }

  // ── Mapeo de categorías a secciones: toda categoría tiene su entrada (aunque sea «sin sección») ──
  const categorias = new Set(productos.map((p) => p.categoria));
  for (const categoria of categorias)
    if (!(categoria in correcciones.mapeoDeSecciones)) err({ hoja: HOJA_CATALOGO, fila: null, columna: "B", valor: categoria, codigo: "CATEGORIA_SIN_MAPEO", motivo: "la categoría no está en el mapeo de secciones (poné la sección o null)" });
  for (const categoria of Object.keys(correcciones.mapeoDeSecciones))
    if (!categorias.has(categoria)) avisos.push({ tipo: "MAPEO_SIN_USAR", sku: null, detalle: `el mapeo tiene la categoría «${categoria}», que el Excel no trae` });

  // ── Avisos del propio Excel ──
  const inconsistenciasDelExcel = filasDe(HOJA_INCONSISTENCIAS).map((f) => ({
    tipo: textoDeCelda(f.celdas.get(0)) ?? "",
    sku: textoDeCelda(f.celdas.get(1)) ?? "",
    detalle: textoDeCelda(f.celdas.get(2)) ?? "",
  }));
  const categoriasPorBase = new Map<string, Set<string>>();
  for (const p of productos) categoriasPorBase.set(p.base, (categoriasPorBase.get(p.base) ?? new Set()).add(p.categoria));
  for (const [base, cats] of categoriasPorBase)
    if (cats.size > 1) avisos.push({ tipo: "BASE_EN_VARIAS_CATEGORIAS", sku: null, detalle: `«${base}» está en ${[...cats].join(" y ")} (cada SKU va con la categoría de su fila en «Catálogo»)` });
  const paresDeProductos = new Set<string>();
  for (const f of filasDe(HOJA_PRODUCTOS)) {
    const categoria = textoDeCelda(f.celdas.get(0));
    const base = textoDeCelda(f.celdas.get(1));
    if (!base) continue;
    paresDeProductos.add(`${categoria}|${base}`);
    const skusDeLaBase = productos.filter((p) => p.base === base);
    if (!skusDeLaBase.some((p) => p.categoria === categoria)) avisos.push({ tipo: "PRODUCTOS_DISTINTO_DE_CATALOGO", sku: null, detalle: `«Productos» pone «${base}» en «${categoria}» y «Catálogo» no tiene ningún SKU así` });
    for (const eje of [2, 3, 4]) {
      const nombreEje = textoDeCelda(f.celdas.get(eje));
      const conValor = skusDeLaBase.filter((p) => ejesPorSku.get(p.sku)?.[eje - 2] != null);
      if (nombreEje && skusDeLaBase.length > 0 && conValor.length === 0) avisos.push({ tipo: "EJE_SIN_VALORES", sku: null, detalle: `«${base}» declara el eje «${nombreEje}» y ningún SKU tiene un valor para él` });
    }
  }

  const paresDelCatalogo = new Map<string, { categoria: string; base: string }>(productos.map((p) => [`${p.categoria}|${p.base}`, { categoria: p.categoria, base: p.base }]));
  for (const [clave, par] of paresDelCatalogo)
    if (!paresDeProductos.has(clave)) avisos.push({ tipo: "CATALOGO_DISTINTO_DE_PRODUCTOS", sku: null, detalle: `«Catálogo» tiene «${par.base}» en «${par.categoria}» y la hoja «Productos» no lo lista ahí` });

  return { productos, filas, correcciones, preciosUnicosCorregidos, inconsistenciasDelExcel, errores, avisos };
}
