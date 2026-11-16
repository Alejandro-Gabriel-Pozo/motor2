/**
 * Las cinco CLASES de producto, como Pedernal (docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md, §4 y §5): el NÚCLEO PURO de
 * las reglas. Sin Prisma, sin reloj, sin azar: recibe la clase y los hechos y devuelve qué pasa. Todavía NO está conectado a ninguna
 * pantalla, acción ni tabla (no hay columna `claseDeUso`: eso es la etapa E1, con su migración); existe para fijar la regla en un
 * solo lugar y recorrerla entera contra el oráculo escrito aparte (`test/catalogo/clases-de-producto-oraculo.ts`).
 *
 * Qué es una clase: lo que el producto ES para el negocio, elegido al crear entre cinco valores cerrados. Referencia en Pedernal:
 * `src/modulos/catalogo/dominio/clases.ts` y `clase-comprable.ts`; textos: `src/capacidades/vocabulario/catalogo-catalogo.ts`.
 * Se copia el RESULTADO y la FORMA (nombres, motivos, orden), no el código.
 *
 * Todo nace cerrado (AGENTS.md, 2026-11-11): lo permitido se declara por clase y por operación; una clase o una operación que esta
 * función no conoce NO está permitida (rechaza con motivo), y las listas son de PERMITIDOS, nunca de prohibidos.
 *
 * «Insumo» acá es la CLASE (packaging, limpieza), no el modelo `Insumo` de Motor2 (el nodo de familia de Maestros → Insumos): son dos
 * cosas distintas con el mismo nombre (diseño, §4.4 y D-T1). Este archivo no toca el modelo.
 *
 * Idempotencia y concurrencia: la función es pura, así que repetirla no cambia nada y no hay carrera dentro de ella. Que la clase no
 * cambie después del alta (I2) y que la base lo haga cumplir (CHECK y disparador) es de la etapa con tabla.
 */

/** Las cinco clases, en el orden de Pedernal (el de los chips de la lista). */
export const CLASES_DE_PRODUCTO = ["MATERIA_PRIMA", "INSUMO", "REVENTA", "ELABORADO", "VENDIBLE"] as const;
export type ClaseDeProducto = (typeof CLASES_DE_PRODUCTO)[number];

/** Lista de permitidos: un texto es una clase solo si es exactamente uno de los cinco valores. */
export function esClaseDeProducto(valor: unknown): valor is ClaseDeProducto {
  return typeof valor === "string" && (CLASES_DE_PRODUCTO as readonly string[]).includes(valor);
}

/** Nombre en pantalla de cada clase (literal de Pedernal, `catalogo.clase.*`). */
export const NOMBRE_DE_CLASE: Readonly<Record<ClaseDeProducto, string>> = {
  MATERIA_PRIMA: "Materia prima",
  INSUMO: "Insumo",
  REVENTA: "Reventa",
  ELABORADO: "Elaborado",
  VENDIBLE: "Producto vendible",
};

/** Descripción corta de cada clase (literal de Pedernal, `catalogo.clase.descripcion.*`; aprobada por el dueño allá el 2026-11-09). */
export const DESCRIPCION_DE_CLASE: Readonly<Record<ClaseDeProducto, string>> = {
  MATERIA_PRIMA: "Se compra y es componente de lo que se elabora y se vende.",
  INSUMO: "Se compra y se consume para operar, sin ser parte del producto.",
  REVENTA: "Se compra y se vende tal cual.",
  ELABORADO: "Se produce en el negocio y se usa como componente.",
  VENDIBLE: "Se arma o se produce y se vende; tiene composición.",
};

const CLASES_QUE_VENDEN: readonly ClaseDeProducto[] = ["REVENTA", "VENDIBLE"];
/** Solo se compran estas tres (I4): el elaborado y el vendible se producen o se venden, no se compran. */
export const CLASES_COMPRABLES: readonly ClaseDeProducto[] = ["MATERIA_PRIMA", "INSUMO", "REVENTA"];
const CLASES_QUE_SE_PRODUCEN: readonly ClaseDeProducto[] = ["ELABORADO", "VENDIBLE"];
const CLASES_CON_RECETA: readonly ClaseDeProducto[] = ["ELABORADO", "VENDIBLE"];
/** Lo que puede ser ingrediente de una receta (I6): el insumo (packaging, limpieza) NO entra, desde la decisión del dueño de Pedernal del 2026-11-14. */
const CLASES_QUE_SON_INGREDIENTE: readonly ClaseDeProducto[] = ["MATERIA_PRIMA", "REVENTA", "ELABORADO"];
/** Lo que una opción puede consumir (I5, P4): materia prima, insumo, reventa y —decisión del 2026-11-12— elaborado. Nunca el vendible. */
const CLASES_QUE_CONSUME_UNA_OPCION: readonly ClaseDeProducto[] = ["MATERIA_PRIMA", "INSUMO", "REVENTA", "ELABORADO"];
/** El insumo queda fuera del food cost (decisión 77 de Pedernal). */
const CLASES_QUE_CUENTAN_EN_EL_FOOD_COST: readonly ClaseDeProducto[] = ["MATERIA_PRIMA", "REVENTA", "ELABORADO", "VENDIBLE"];

/** Reventa y vendible: llevan alícuota, sección de la carta, nombre de cocina, descripción, precio y opciones; las demás, ninguno (I3). */
export const vendeLaClase = (clase: ClaseDeProducto): boolean => CLASES_QUE_VENDEN.includes(clase);
/** Solo se compran materia prima, insumo y reventa (I4). */
export const esClaseComprable = (clase: ClaseDeProducto): boolean => CLASES_COMPRABLES.includes(clase);
/** Lo que una opción puede consumir (I5). */
export const seConsumeLaClase = (clase: ClaseDeProducto): boolean => CLASES_QUE_CONSUME_UNA_OPCION.includes(clase);
/** ¿La clase cuenta en el food cost? El insumo no (decisión 77). */
export const cuentaEnElFoodCost = (clase: ClaseDeProducto): boolean => CLASES_QUE_CUENTAN_EN_EL_FOOD_COST.includes(clase);

/** Operaciones que el sistema decide por clase. Una operación que no está acá no está permitida. */
export const OPERACIONES_DE_CLASE = [
  "vender",
  "llevar_datos_de_venta",
  "estar_en_la_carta",
  "comprar",
  "producir",
  "llevar_receta",
  "entrar_en_receta",
  "ser_consumido_por_opcion",
  "tener_stock_propio",
] as const;
export type OperacionDeClase = (typeof OPERACIONES_DE_CLASE)[number];

/** Los hechos del producto, además de su clase, que cuentan para decidir. */
export interface HechosDeClase {
  /** La marca «se produce» (`Producto.seProduce` hoy). Solo cambia el stock propio del vendible: el elaborado siempre lo tiene; el vendible, solo si se produce. */
  readonly seProduce: boolean;
}

export interface EntradaDeClase {
  readonly clase: ClaseDeProducto;
  readonly operacion: OperacionDeClase;
  readonly hechos: HechosDeClase;
}

/**
 * Motivos cerrados. Los que existen en Pedernal llevan su nombre (`PRODUCTO_NO_COMPRABLE`, `PRODUCTO_NO_LLEVA_RECETA`,
 * `COMPONENTE_ES_INSUMO`, `INSUMO_NO_ADMITIDO`, `CAMPO_NO_ADMITIDO_POR_LA_CLASE`); los otros son de este núcleo. El mensaje que ve
 * una persona lo decide la etapa que conecte el núcleo (los textos nuevos los aprueba el dueño).
 */
export const MOTIVOS_DE_RECHAZO_DE_CLASE = [
  "CLASE_DESCONOCIDA",
  "OPERACION_DESCONOCIDA",
  "LA_CLASE_NO_VENDE",
  "CAMPO_NO_ADMITIDO_POR_LA_CLASE",
  "PRODUCTO_NO_COMPRABLE",
  "LA_CLASE_NO_SE_PRODUCE",
  "PRODUCTO_NO_LLEVA_RECETA",
  "COMPONENTE_ES_INSUMO",
  "COMPONENTE_NO_ES_INGREDIENTE",
  "INSUMO_NO_ADMITIDO",
  "SIN_STOCK_PROPIO",
] as const;
export type MotivoDeRechazoDeClase = (typeof MOTIVOS_DE_RECHAZO_DE_CLASE)[number];

export type DecisionDeClase = { readonly ok: true } | { readonly ok: false; readonly motivo: MotivoDeRechazoDeClase };

const PERMITIDO: DecisionDeClase = { ok: true };
const rechazo = (motivo: MotivoDeRechazoDeClase): DecisionDeClase => ({ ok: false, motivo });
const permitidoSi = (condicion: boolean, motivo: MotivoDeRechazoDeClase): DecisionDeClase => (condicion ? PERMITIDO : rechazo(motivo));

/** La decisión sobre una clase en una operación. Pura y total: toda combinación da una respuesta; lo que no se declara, se rechaza. */
export function decidirSobreClase(entrada: EntradaDeClase): DecisionDeClase {
  const { clase, operacion, hechos } = entrada;
  if (!esClaseDeProducto(clase)) return rechazo("CLASE_DESCONOCIDA");
  switch (operacion) {
    case "vender":
    case "estar_en_la_carta":
      return permitidoSi(CLASES_QUE_VENDEN.includes(clase), "LA_CLASE_NO_VENDE");
    case "llevar_datos_de_venta": // alícuota, sección, nombre de cocina, descripción, precio, opciones (I3)
      return permitidoSi(CLASES_QUE_VENDEN.includes(clase), "CAMPO_NO_ADMITIDO_POR_LA_CLASE");
    case "comprar":
      return permitidoSi(CLASES_COMPRABLES.includes(clase), "PRODUCTO_NO_COMPRABLE");
    case "producir":
      return permitidoSi(CLASES_QUE_SE_PRODUCEN.includes(clase), "LA_CLASE_NO_SE_PRODUCE");
    case "llevar_receta":
      return permitidoSi(CLASES_CON_RECETA.includes(clase), "PRODUCTO_NO_LLEVA_RECETA");
    case "entrar_en_receta":
      if (clase === "INSUMO") return rechazo("COMPONENTE_ES_INSUMO"); // el packaging y la limpieza no entran (2026-11-14)
      return permitidoSi(CLASES_QUE_SON_INGREDIENTE.includes(clase), "COMPONENTE_NO_ES_INGREDIENTE");
    case "ser_consumido_por_opcion":
      return permitidoSi(CLASES_QUE_CONSUME_UNA_OPCION.includes(clase), "INSUMO_NO_ADMITIDO");
    case "tener_stock_propio":
      // El vendible lo tiene solo si se produce; las otras cuatro siempre (el elaborado se produce en tanda; lo comprado se cuenta).
      return permitidoSi(clase !== "VENDIBLE" || hechos.seProduce, "SIN_STOCK_PROPIO");
    default:
      return rechazo("OPERACION_DESCONOCIDA"); // todo nace cerrado
  }
}
