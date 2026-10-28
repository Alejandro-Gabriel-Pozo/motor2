import { aCentavos, deCentavos } from "@/core/carta/public";
import type { EstadoDeLaBase, PermisosDelActor, ProductoExistente } from "./estado";
import { LOCALES_DEL_IMPORTADOR, type CatalogoNormalizado, type ErrorDeImportacion, type FilaDePrecioNormalizada, type LocalDelImportador, type ProductoNormalizado } from "./tipos";

/**
 * PLANIFICADOR DE PRODUCTOS del importador del catálogo (E1.3; ADENDA v2 A.1 y A.3). Puro: con el catálogo normalizado, el estado de la base y los permisos que aprobó el gate decide, por
 * SKU, `CREAR`, `SIN_CAMBIOS` o `ERROR`, su precio único (UN precio por empresa: nunca `PrecioLocalProducto`) y sus filas de disponibilidad por local.
 *
 * Precio único (decisión del dueño del 2026-10-28): si los locales coinciden, ese; si no, el de una corrección `precioUnico` (manda siempre) o, si el dueño aceptó la regla, el MÁS FRECUENTE
 * y, si empatan, el MAYOR. Sin regla aceptada ni corrección, el SKU es error (`PRECIO_UNICO_PENDIENTE`). La diferencia por local con lo que trae el Excel se informa SIEMPRE.
 */

export type OrigenDelPrecio = "UNICO_EN_EL_EXCEL" | "CORRECCION" | "REGLA" | "SIN_PRECIO_EN_EL_EXCEL";

export interface PrecioUnico {
  centavos: bigint;
  origen: OrigenDelPrecio;
  /** Con la regla: si hubo más de un precio con la frecuencia máxima (se tomó el mayor). */
  empate: boolean;
}

export interface DiferenciaPorLocal {
  local: LocalDelImportador;
  precioEnElExcel: bigint;
  precioUnico: bigint;
  /** precioUnico − precioEnElExcel, en centavos. */
  diferencia: bigint;
  /** La diferencia sobre el precio del Excel, en décimas de punto (125 = 12,5 %), redondeada. */
  porcentajeEnDecimas: bigint;
  sentido: "MAS" | "MENOS" | "IGUAL";
}

export type AccionDePlan = "CREAR" | "SIN_CAMBIOS" | "ERROR";

export interface PlanDeProducto {
  sku: string;
  fila: number;
  nombre: string;
  categoria: string;
  accion: AccionDePlan;
  errores: readonly { codigo: string; motivo: string }[];
  precio: PrecioUnico | null;
  /** Una fila por local con fila en «Precios por local» (sin fila = no disponible, ADR-009). */
  disponibilidad: readonly { local: LocalDelImportador; sucursalId: string | null; disponible: boolean }[];
  diferencias: readonly DiferenciaPorLocal[];
  /** El producto de la base con ese código (si existe). */
  existenteId: string | null;
}

/** Lo que se escribe de un producto nuevo (y nada más: el guardián `DIMENSIONES_DEL_IMPORTADOR` lo compara con lo declarado). */
export interface ProductoAEscribir {
  codigo: string;
  nombre: string;
  tipo: "PV";
  unidadStockId: string;
  factorConversion: string;
  precioVenta: string;
  modoDeVenta: "DIRECTO";
  seProduce: false;
}

/** Una fila de disponibilidad de un producto nuevo (el guardián `DIMENSIONES_DEL_IMPORTADOR` la compara con lo declarado). */
export interface DisponibilidadAEscribir {
  sucursalId: string;
  productoId: string;
  disponible: boolean;
}

const CERO = BigInt(0);
const MIL = BigInt(1000);
const DOS = BigInt(2);

/** El precio único de un SKU (o `null` si hay precios distintos y no hay corrección ni regla aceptada). */
export function precioUnicoDe(
  filas: readonly FilaDePrecioNormalizada[],
  correccion: bigint | undefined,
  reglaAceptada: boolean,
): PrecioUnico | null {
  const precios = filas.map((f) => f.precioCentavos).filter((p): p is bigint => p !== null);
  if (correccion !== undefined) return { centavos: correccion, origen: "CORRECCION", empate: false };
  if (precios.length === 0) return { centavos: CERO, origen: "SIN_PRECIO_EN_EL_EXCEL", empate: false };
  const distintos = [...new Set(precios.map(String))].map((p) => BigInt(p));
  if (distintos.length === 1) return { centavos: distintos[0], origen: "UNICO_EN_EL_EXCEL", empate: false };
  if (!reglaAceptada) return null;
  const frecuencia = new Map<string, number>();
  for (const p of precios) frecuencia.set(String(p), (frecuencia.get(String(p)) ?? 0) + 1);
  const maxima = Math.max(...frecuencia.values());
  const masFrecuentes = distintos.filter((p) => frecuencia.get(String(p)) === maxima);
  const mayor = masFrecuentes.reduce((a, b) => (b > a ? b : a));
  return { centavos: mayor, origen: "REGLA", empate: masFrecuentes.length > 1 };
}

/** La diferencia del precio único con el de cada local que trae precio (en $ y en décimas de punto, redondeado al más cercano). */
export function diferenciasPorLocal(filas: readonly FilaDePrecioNormalizada[], unico: bigint): DiferenciaPorLocal[] {
  return filas
    .filter((f) => f.precioCentavos !== null)
    .map((f) => {
      const enElExcel = f.precioCentavos!;
      const diferencia = unico - enElExcel;
      const abs = diferencia < CERO ? -diferencia : diferencia;
      const decimas = (abs * MIL * DOS + enElExcel) / (DOS * enElExcel);
      return {
        local: f.local,
        precioEnElExcel: enElExcel,
        precioUnico: unico,
        diferencia,
        porcentajeEnDecimas: diferencia < CERO ? -decimas : decimas,
        sentido: diferencia > CERO ? "MAS" : diferencia < CERO ? "MENOS" : "IGUAL",
      };
    });
}

/** Mismo dinero, al centavo, entre un importe de la base en texto («3000», «3000.00») y centavos. */
function mismoPrecio(texto: string, centavos: bigint): boolean {
  const c = aCentavos(texto);
  return c !== null && c === centavos;
}

/** Lo que difiere entre el producto existente y lo que cargaría el plan, campo por campo (vacío = idéntico). */
export function diferenciasConElExistente(
  existente: ProductoExistente,
  esperado: { nombre: string; precio: bigint; unidadId: string | null; disponibilidad: readonly { sucursalId: string | null; disponible: boolean }[] },
): string[] {
  const d: string[] = [];
  if (existente.nombre !== esperado.nombre) d.push(`nombre: «${existente.nombre}» (el archivo: «${esperado.nombre}»)`);
  if (existente.tipo !== "PV") d.push(`tipo: ${existente.tipo} (el archivo: PV)`);
  if (!mismoPrecio(existente.precioVenta, esperado.precio)) d.push(`precio de venta: ${existente.precioVenta} (el archivo: ${deCentavos(esperado.precio)})`);
  if (existente.modoDeVenta !== "DIRECTO") d.push(`modo de venta: ${existente.modoDeVenta} (el archivo: DIRECTO)`);
  if (existente.seProduce) d.push("se produce: sí (el archivo: no)");
  if (Number(existente.factorConversion) !== 1) d.push(`factor de conversión: ${existente.factorConversion} (el archivo: 1)`);
  if (esperado.unidadId !== null && existente.unidadStockId !== esperado.unidadId) d.push("unidad de stock: otra (el archivo: «unidad»)");
  if (existente.preciosLocales.length > 0) d.push(`tiene ${existente.preciosLocales.length} precio(s) local(es): con un precio por empresa no puede tener ninguno`);
  const clave = (x: { sucursalId: string | null; disponible: boolean }) => `${x.sucursalId}:${x.disponible}`;
  const real = existente.disponibilidades.map(clave).sort();
  const plan = esperado.disponibilidad.map(clave).sort();
  if (real.join("|") !== plan.join("|")) d.push(`disponibilidad por local distinta (base: ${real.length} fila(s), archivo: ${plan.length})`);
  return d;
}

export interface PlanDeProductos {
  productos: readonly PlanDeProducto[];
  /** Errores que no son de un SKU (una sucursal que no existe, la unidad «unidad», permisos de empresa). */
  errores: readonly ErrorDeImportacion[];
}

/** El plan de productos: uno por SKU del catálogo normalizado, en su orden. */
export function planificarProductos(catalogo: CatalogoNormalizado, estado: EstadoDeLaBase, permisos: PermisosDelActor): PlanDeProductos {
  const errores: ErrorDeImportacion[] = [];
  const global = (codigo: string, motivo: string) => errores.push({ hoja: null, fila: null, columna: null, valor: null, sku: null, codigo, motivo });
  for (const local of LOCALES_DEL_IMPORTADOR) {
    const s = estado.sucursales[local];
    if (!s) global("SUCURSAL_INEXISTENTE", `la empresa no tiene una sucursal llamada «${local}»`);
    else if (!s.activa) global("SUCURSAL_INACTIVA", `la sucursal «${local}» está dada de baja`);
  }
  if (estado.unidadId === null) global("UNIDAD_INEXISTENTE", "la empresa no tiene la unidad de stock «unidad» (el importador no la crea)");
  if (!permisos.altaProducto) global("SIN_PERMISO", "el actor no tiene «alta_producto» en la empresa");
  if (!permisos.camposSensibles) global("SIN_PERMISO", "el actor no tiene «producto_campos_sensibles» en la empresa");

  const filasPorSku = new Map<string, FilaDePrecioNormalizada[]>();
  for (const f of catalogo.filas) filasPorSku.set(f.sku, [...(filasPorSku.get(f.sku) ?? []), f]);
  const porCodigo = new Map(estado.productos.map((p) => [p.codigo, p]));
  const porNombre = new Map(estado.productos.map((p) => [p.nombre.toLowerCase(), p]));
  const reglaAceptada = catalogo.correcciones.reglaDePrecioUnico !== null;

  const productos = catalogo.productos.map((p: ProductoNormalizado): PlanDeProducto => {
    const filas = filasPorSku.get(p.sku) ?? [];
    const correccion = catalogo.preciosUnicosCorregidos.get(p.sku)?.centavos;
    const precio = precioUnicoDe(filas, correccion, reglaAceptada);
    const disponibilidad = filas.map((f) => ({ local: f.local, sucursalId: estado.sucursales[f.local]?.id ?? null, disponible: f.disponible }));
    const existente = porCodigo.get(p.sku) ?? null;
    const base = { sku: p.sku, fila: p.fila, nombre: p.nombre, categoria: p.categoria, precio, disponibilidad, diferencias: precio ? diferenciasPorLocal(filas, precio.centavos) : [], existenteId: existente?.id ?? null };
    const error = (codigo: string, motivo: string): PlanDeProducto => ({ ...base, accion: "ERROR", errores: [{ codigo, motivo }] });

    const sinAlcance = filas.filter((f) => !permisos.porLocal[f.local]?.disponibilidad).map((f) => f.local);
    if (!permisos.altaProducto || !permisos.camposSensibles || sinAlcance.length > 0)
      return error("SIN_PERMISO", sinAlcance.length > 0 ? `el actor no tiene «producto_disponibilidad» en ${sinAlcance.join(", ")}` : "el actor no tiene las claves de empresa del alta");
    if (!precio) return error("PRECIO_UNICO_PENDIENTE", "los locales tienen precios distintos y no hay corrección ni regla de precio único aceptada");
    if (existente) {
      const difieren = diferenciasConElExistente(existente, { nombre: p.nombre, precio: precio.centavos, unidadId: estado.unidadId, disponibilidad });
      return difieren.length === 0 ? { ...base, accion: "SIN_CAMBIOS", errores: [] } : error("EXISTE_DISTINTO", `el código ya existe y es distinto: ${difieren.join("; ")}`);
    }
    const conElNombre = porNombre.get(p.nombre.toLowerCase());
    if (conElNombre) return error("NOMBRE_EN_USO", `otro producto (${conElNombre.codigo}) ya se llama «${conElNombre.nombre}»`);
    return { ...base, accion: "CREAR", errores: [] };
  });
  return { productos, errores };
}

/** Lo que el plan escribe de los productos nuevos (solo los `CREAR`). Necesita la unidad: sin ella el plan ya es error. */
export function productosAEscribir(plan: PlanDeProductos, unidadId: string): ProductoAEscribir[] {
  return plan.productos
    .filter((p) => p.accion === "CREAR")
    .map((p) => ({ codigo: p.sku, nombre: p.nombre, tipo: "PV", unidadStockId: unidadId, factorConversion: "1", precioVenta: deCentavos(p.precio!.centavos), modoDeVenta: "DIRECTO", seProduce: false }));
}

/** Las filas de disponibilidad de los productos nuevos, con el id que les dio la base al crearlos (por código). */
export function disponibilidadesAEscribir(plan: PlanDeProductos, idPorCodigo: ReadonlyMap<string, string>): DisponibilidadAEscribir[] {
  return plan.productos
    .filter((p) => p.accion === "CREAR")
    .flatMap((p) => {
      const productoId = idPorCodigo.get(p.sku);
      if (!productoId) throw new Error(`El producto ${p.sku} no se creó: no se puede sembrar su disponibilidad.`);
      return p.disponibilidad.map((d) => {
        if (!d.sucursalId) throw new Error(`La sucursal «${d.local}» no existe: el plan no tendría que haber llegado a escribir.`);
        return { sucursalId: d.sucursalId, productoId, disponible: d.disponible };
      });
    });
}
