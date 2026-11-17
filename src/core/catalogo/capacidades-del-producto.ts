/**
 * Qué PUEDE HACER un producto (se compra, se vende, lleva stock propio, entra en una receta…), decidido en UN solo lugar a partir de lo que el producto es: su `tipo` (MP/PV), la marca «se produce» y,
 * si la tiene, su clase de uso. Etapa E4-0 de la clase «Reventa» (docs/diseno-reventa-e4-2026-11-17.md §3): hoy esas decisiones están repartidas en ≈110 a 130 puntos que comparan `tipo === "MP"` o
 * `tipo === "PV"` a mano. Esta función es el punto único al que irán pasando, de a un circuito por paso (E4-2 a E4-4).
 *
 * E4-0 NO CAMBIA NINGÚN RESULTADO: para todo lo que existe hoy (cualquier `tipo`, cualquier `seProduce`, cualquier clase que no sea REVENTA) devuelve EXACTAMENTE lo que deciden hoy los literales (la columna
 * «Dónde se decide hoy» de `test/catalogo/capacidades-del-producto-oraculo.ts`); la prueba de equivalencia lo recorre entero contra ese oráculo escrito aparte. La clase de uso NO cambia nada salvo REVENTA, que es
 * la única clase nueva: un producto de venta (`tipo PV`, no se produce) que además se compra y lleva stock propio. Una REVENTA incoherente (`tipo MP` o «se produce») y un `tipo` desconocido no pueden nada:
 * todo nace cerrado (AGENTS.md, 2026-11-11); las listas son de PERMITIDOS.
 *
 * Diferencia declarada con Pedernal (el diseño de clases §10.1 dice que una Reventa SÍ es ingrediente de receta y la consume una opción): acá NO lo es, porque el dueño no lo pidió (E4, regla R7, pregunta
 * abierta con recomendación «no ahora»). El día que lo pida, es una línea de acá y una fila del oráculo.
 *
 * Pura: sin Prisma, sin reloj, sin azar. Repetirla no cambia nada y no hay carrera dentro de ella.
 */

/** El `tipo` del producto tal como se guarda hoy (`TipoProducto` del esquema). Acá es un texto: lo desconocido se rechaza, no se asume. */
export interface DatosDeCapacidad {
  readonly tipo: string;
  readonly seProduce: boolean;
  /** La clase de uso guardada (`Producto.claseDeUso`); vacía en los productos anteriores a las clases. Solo `REVENTA` cambia lo que el producto puede. */
  readonly claseDeUso?: string | null;
}

export interface CapacidadesDelProducto {
  /** Se puede comprar a un proveedor (el proceso COMPRA). */
  readonly seCompra: boolean;
  /** Se vende: lleva precio, alícuota de venta, sección de la carta, nombre de cocina y opciones, y puede estar en la carta y en el POS. */
  readonly seVende: boolean;
  /** Lleva stock físico propio (compra, venta, conteo, traspaso, ajuste). */
  readonly tieneStockPropio: boolean;
  /** Es el resultado de correr una receta (el proceso PRODUCCION). */
  readonly sePuedeProducir: boolean;
  /** Puede tener receta propia. */
  readonly llevaReceta: boolean;
  /** Puede ser ingrediente de la receta de otro producto. */
  readonly esIngredienteDeReceta: boolean;
  /** Lo puede consumir una opción de venta. */
  readonly loConsumeUnaOpcion: boolean;
}

const NADA: CapacidadesDelProducto = {
  seCompra: false,
  seVende: false,
  tieneStockPropio: false,
  sePuedeProducir: false,
  llevaReceta: false,
  esIngredienteDeReceta: false,
  loConsumeUnaOpcion: false,
};

export function capacidadesDelProducto(datos: DatosDeCapacidad): CapacidadesDelProducto {
  const { tipo, seProduce, claseDeUso } = datos;
  // La Reventa: un producto de venta que no se produce, que además se compra y lleva stock propio. Cualquier otra forma de «REVENTA» (con tipo MP o que se produce) es incoherente: no puede nada.
  if (claseDeUso === "REVENTA") {
    if (tipo !== "PV" || seProduce) return NADA;
    return { ...NADA, seCompra: true, seVende: true, tieneStockPropio: true };
  }
  if (tipo === "MP") {
    // `transiciones.ts` (COMPRA solo MP; stock real: toda MP), `receta-validacion.ts` (ingrediente solo MP), `guardar-version-de-receta.ts` (receta solo si se produce), `opciones-de-venta-en-tx.ts` (consumo solo MP).
    return { ...NADA, seCompra: true, tieneStockPropio: true, sePuedeProducir: seProduce, llevaReceta: seProduce, esIngredienteDeReceta: true, loConsumeUnaOpcion: true };
  }
  if (tipo === "PV") {
    // Venta solo PV; stock propio solo si se produce; receta siempre (un PV sin receta se vende con aviso); no es ingrediente ni lo consume una opción.
    return { ...NADA, seVende: true, tieneStockPropio: seProduce, sePuedeProducir: seProduce, llevaReceta: true };
  }
  return NADA; // un `tipo` desconocido no puede nada (todo nace cerrado)
}
