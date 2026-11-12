import type { IngredienteInput, PasoInput } from "./receta-validacion";

/**
 * Reglas PURAS de «Duplicar producto» (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`): qué se copia y qué no de cada tabla, qué decide cada permiso y los textos de la auditoría y de los avisos. Sin Prisma
 * ni permisos: las lee el caso de uso (`server/actions/catalogo/casos-de-uso/duplicar-producto.ts`) y las prueban los tests sin base (`test/catalogo/duplicar-producto-reglas.test.ts`).
 */

/**
 * Qué pasa con una columna al duplicar un producto:
 *  - `SE_COPIA`: el duplicado nace con el valor del original.
 *  - `SE_COPIA_CON_PERMISO`: se copia solo si quien duplica tiene `producto_campos_sensibles` (el precio de venta, el factor y la unidad de compra, el modo de venta); sin la clave nace con el valor neutro del alta
 *    (precio 0, factor 1, sin unidad de compra, «Directo»).
 *  - `NO_SE_COPIA`: el duplicado nace con otro valor (el nombre propio, el código autogenerado) o con el de fábrica (sin consignación, sin insumo).
 *  - `DERIVADA`: la fila nueva la arma el sistema (ids, empresa, versión 1, fechas, a qué producto, ingrediente o paso apunta la copia): nunca se copia ni se elige.
 */
export type DestinoDeColumna = "SE_COPIA" | "SE_COPIA_CON_PERMISO" | "NO_SE_COPIA" | "DERIVADA";

/**
 * EL ORÁCULO de columnas (nivel 10 del diseño): para cada tabla que «Duplicar» toca, cada columna escalar de `prisma/schema.prisma` con lo que pasa con ella. El guardián
 * (`test/catalogo/duplicar-producto-columnas.test.ts`) la compara con el esquema en las dos direcciones: una columna nueva sin declarar, o una declarada que ya no existe, pone el test en rojo — así nadie suma una
 * columna al producto, a la receta o a lo que el producto admite sin decidir si el duplicado la hereda.
 */
export const COLUMNAS_DEL_DUPLICADO: Readonly<Record<string, Readonly<Record<string, DestinoDeColumna>>>> = {
  Producto: {
    id: "DERIVADA", // lo manda la aplicación (`duplicadoId`): es la clave de idempotencia
    empresaId: "DERIVADA",
    codigo: "NO_SE_COPIA", // autogenerado, como en el alta
    nombre: "NO_SE_COPIA", // propio y obligatorio
    tipo: "SE_COPIA",
    categoriaId: "SE_COPIA",
    unidadCompraId: "SE_COPIA_CON_PERMISO", // viaja con el factor de conversión
    unidadStockId: "SE_COPIA",
    factorConversion: "SE_COPIA_CON_PERMISO",
    observaciones: "SE_COPIA",
    insumoId: "NO_SE_COPIA", // el hermanado de una materia prima con su insumo se decide para cada producto
    precioVenta: "SE_COPIA_CON_PERMISO", // punto de partida editable
    modoDeVenta: "SE_COPIA_CON_PERMISO",
    alicuotaIvaVenta: "SE_COPIA",
    alicuotaIvaCompra: "SE_COPIA",
    pasoVenta: "SE_COPIA",
    seProduce: "SE_COPIA",
    esConsignacion: "NO_SE_COPIA", // fijar el costo de un consignante exige `pagar_consignante`: no se hereda
    proveedorConsignacionId: "NO_SE_COPIA",
    precioConsignacion: "NO_SE_COPIA",
    creadoEn: "DERIVADA",
  },
  RecetaVersion: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    productoId: "DERIVADA", // el producto nuevo
    version: "DERIVADA", // 1: la primera de la serie central del producto nuevo
    creadoEn: "DERIVADA",
    sucursalId: "DERIVADA", // siempre la serie central
    basadaEnVersionId: "NO_SE_COPIA", // solo lo llevan las versiones propias de una sucursal
    rendimientoCantidad: "SE_COPIA",
    rendimientoUnidadId: "SE_COPIA",
    racionesCantidad: "SE_COPIA",
    racionTamano: "SE_COPIA",
    racionUnidadId: "SE_COPIA",
    tiempoPreparacionMinutos: "SE_COPIA",
    tiempoCoccionMinutos: "SE_COPIA",
    comentarios: "SE_COPIA",
    presentacionEmplatado: "SE_COPIA",
    notasAdicionales: "SE_COPIA",
    equipamientoNecesario: "SE_COPIA",
  },
  RecetaIngrediente: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    recetaVersionId: "DERIVADA",
    insumoProductoId: "SE_COPIA",
    cantidad: "SE_COPIA",
    unidadId: "SE_COPIA",
    mermaPorcentaje: "SE_COPIA",
    observaciones: "SE_COPIA",
  },
  RecetaPaso: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    recetaVersionId: "DERIVADA",
    orden: "SE_COPIA",
    nombre: "SE_COPIA",
    instruccion: "SE_COPIA",
    minutos: "SE_COPIA",
  },
  RecetaPasoIngrediente: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    recetaPasoId: "DERIVADA", // se reconstruye contra los pasos nuevos
    recetaIngredienteId: "DERIVADA", // y contra los ingredientes nuevos (nunca se reutilizan los ids del original)
  },
  SustitutoRecetaIngrediente: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    recetaIngredienteId: "DERIVADA",
    insumoSustitutoId: "SE_COPIA",
    orden: "SE_COPIA",
  },
  ProductoAdmiteGrupo: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    productoId: "DERIVADA",
    grupoId: "SE_COPIA", // el MISMO grupo de la biblioteca: no se crea ninguno
    orden: "SE_COPIA",
    cantidadMinima: "SE_COPIA",
    cantidadMaxima: "SE_COPIA",
    modoPrecio: "SE_COPIA",
    activo: "SE_COPIA", // solo se copian los grupos activos
    seMuestraEnCarta: "SE_COPIA",
    version: "DERIVADA",
    creadoEn: "DERIVADA",
    actualizadoEn: "DERIVADA",
  },
  ProductoAdmiteOpcion: {
    id: "DERIVADA",
    empresaId: "DERIVADA",
    productoId: "DERIVADA",
    opcionId: "SE_COPIA", // la MISMA opción de la biblioteca
    cantidadMaxima: "SE_COPIA",
    precioAbsoluto: "SE_COPIA",
    tipoDeDiferencia: "SE_COPIA",
    diferenciaPrecio: "SE_COPIA",
    porcentaje: "SE_COPIA",
    activo: "SE_COPIA", // solo se copian las opciones activas
    version: "DERIVADA",
    creadoEn: "DERIVADA",
    actualizadoEn: "DERIVADA",
  },
};

/** Lo que el diseño dice que NO se copia, en lenguaje llano: la pantalla lo muestra antes de confirmar y el mensaje de éxito lo recuerda. */
export const LO_QUE_NO_SE_COPIA = [
  "«En la carta»: queda pendiente de completar",
  "los precios por sucursal",
  "la disponibilidad por sucursal (el producto nuevo nace con la regla del alta)",
  "el stock, los proveedores, las presentaciones de compra y la consignación",
  "las calibraciones de rendimiento local de la receta",
] as const;

/** ¿Hay un paso de la receta que nombra a algún ingrediente? Entonces el texto del paso se copió tal cual y conviene revisarlo (decisión del dueño, 2026-11-12: «hay pasos para revisar»). */
export function hayPasosParaRevisar(pasos: readonly PasoInput[]): boolean {
  return pasos.some((p) => (p.insumoProductoIds?.length ?? 0) > 0);
}

/** Receta circular: un producto no puede ser ingrediente de sí mismo. El destino de la copia es el producto nuevo, así que el control mira su id. */
export function hayRecetaCircular(destinoId: string, ingredientes: readonly IngredienteInput[]): boolean {
  return ingredientes.some((i) => i.insumoProductoId === destinoId);
}

/**
 * Los nombres de los ingredientes que no están disponibles en NINGUNA sucursal (dados de baja), sin repetir y en el orden de la receta: el rechazo los nombra a todos, no solo al primero. `nombres` trae el nombre de
 * cada producto leído (los que no figuran salen por su id).
 */
export function ingredientesDadosDeBaja(ingredientes: readonly IngredienteInput[], disponiblesEnAlguna: ReadonlySet<string>, nombres: ReadonlyMap<string, { nombre: string }>): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const i of ingredientes) {
    if (disponiblesEnAlguna.has(i.insumoProductoId) || vistos.has(i.insumoProductoId)) continue;
    vistos.add(i.insumoProductoId);
    salida.push(nombres.get(i.insumoProductoId)?.nombre ?? i.insumoProductoId);
  }
  return salida;
}

/** El mensaje de rechazo cuando hay ingredientes dados de baja: nombra a cada uno. */
export function textoDeIngredientesDadosDeBaja(nombres: readonly string[]): string {
  const lista = nombres.map((n) => `«${n}»`).join(", ");
  return nombres.length === 1
    ? `No se puede copiar la receta: el ingrediente ${lista} está dado de baja (no está disponible en ninguna sucursal). Arreglalo en el producto original o duplicalo sin la receta.`
    : `No se puede copiar la receta: los ingredientes ${lista} están dados de baja (no están disponibles en ninguna sucursal). Arreglalos en el producto original o duplicalo sin la receta.`;
}

/** Auditoría: el producto nuevo y de cuál salió (quién lo hizo y cuándo lo dicen `actorId` y la fecha de la fila). */
export function describirProductoDuplicado(nuevoNombre: string, origenNombre: string): string {
  return `Producto "${nuevoNombre}" creado por duplicación de "${origenNombre}".`;
}

/** Auditoría: la receta del producto nuevo, de qué producto y de qué versión salió (y de dónde: la central o la propia de una sucursal). */
export function describirRecetaDuplicada(nuevoNombre: string, origenNombre: string, versionDeOrigen: number, dondeRegia: string): string {
  return `Receta de "${nuevoNombre}" creada como versión 1 por duplicación de "${origenNombre}" (${dondeRegia}, versión ${versionDeOrigen}).`;
}

/** Auditoría: el precio de lista con el que nació el duplicado (de nada al valor). */
export function describirPrecioDelDuplicado(nuevoNombre: string, origenNombre: string, editado: boolean): string {
  return editado ? `Producto "${nuevoNombre}": precio de venta fijado al duplicar "${origenNombre}" (editado al duplicar).` : `Producto "${nuevoNombre}": precio de venta copiado de "${origenNombre}" al duplicarlo.`;
}

/** Aviso del éxito cuando algún paso nombra un ingrediente. */
export const AVISO_PASOS_PARA_REVISAR =
  "Hay pasos para revisar: se copiaron tal cual y pueden seguir nombrando los ingredientes del original (un paso que dice «freír el bife de carne» sigue diciendo eso aunque cambies el ingrediente). Revisalos en la receta del producto nuevo.";
