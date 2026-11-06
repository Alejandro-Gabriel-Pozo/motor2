import type { OpcionElegida } from "@/core/opciones/public";
import { rechazoDeComponenteDeCombo, type ProductoComoComponente } from "./componente-de-combo";
import { armarLineaConfigurada, type GrupoParaVender, type LineaConfigurada } from "./linea-configurada";

/**
 * Armar lo que el mozo eligió dentro de UNA entrada «a elegir» de una promo (`EntradaDeCupo.modoDeOpciones = 'A_ELEGIR'`, diseño 2026-11-04, ADR-032 D-6 enmendada, I2, I7 e I8). PURO: sin lecturas, con lo que
 * `cargarEntradasDePromoParaVender` ya leyó adentro de la transacción de `agregarItemsCasoDeUso` (la MISMA lectura que alimenta al selector del mozo).
 */

/** Una entrada «a elegir» elegible hoy, con todo lo que hace falta para armar lo que elija el mozo (la misma lectura alimenta al selector y al servidor). */
export interface EntradaAElegirLeida {
  entradaId: string;
  productoId: string;
  /** El producto como componente de combo (PV, origen de stock, receta…): sin el precio de referencia, que depende de la configuración elegida. */
  producto: Omit<ProductoComoComponente, "precioDeReferencia" | "opcionesQueDescuentan">;
  /** El precio base de la sucursal (precio local si rige), redondeado: sobre él se compone cada configuración elegida. */
  precioBase: number;
  /** Los grupos con SOLO las opciones permitidas efectivas (lo que el selector muestra y lo único que el servidor acepta). */
  grupos: readonly GrupoParaVender[];
  /** Todo lo que el producto admite en la sucursal: solo para nombrar en el mensaje una opción que no está permitida. */
  gruposDelProducto: readonly GrupoParaVender[];
}

/**
 * Arma lo que el mozo eligió dentro de UNA entrada «a elegir» (I2, I7, I8): las opciones tienen que estar entre las permitidas efectivas de la entrada (si no, `OPCION_NO_PERMITIDA_EN_PROMO`, sin
 * escribir nada), pasan por `armarLineaConfigurada` con SOLO esos grupos (mínimos y máximos del grupo, la versión que vio el mozo —`OPCION_CAMBIO`—, la lista compuesta) y la configuración resultante
 * tiene que seguir siendo un componente válido (precio de referencia y origen de stock, D-8/D-9, por lo que descuentan las opciones elegidas). El precio de la promo no cambia: devuelve el precio de lista
 * de ESA configuración, que solo pesa en el reparto (`prorratearPrecioPromo`).
 */
type ResultadoDeConfiguracionAElegir =
  | { ok: true; linea: LineaConfigurada | null; precioDeLista: number }
  | { ok: false; codigo: "OPCION_NO_PERMITIDA_EN_PROMO" | "OPCION_CAMBIO" | "OPCIONES_INVALIDAS" | "ENTRADA_NO_DISPONIBLE"; mensaje: string };

export function armarConfiguracionDeEntradaAElegir(entrada: EntradaAElegirLeida, elegidas: readonly OpcionElegida[]): ResultadoDeConfiguracionAElegir {
  const permitidas = new Set(entrada.grupos.flatMap((g) => g.opciones.map((o) => o.opcionId)));
  for (const o of elegidas) {
    if (permitidas.has(o.opcionId)) continue;
    const nombre = entrada.gruposDelProducto.flatMap((g) => g.opciones).find((x) => x.opcionId === o.opcionId)?.nombre;
    return { ok: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO", mensaje: `«${entrada.producto.nombre}» no admite ${nombre === undefined ? "esa opción" : `«${nombre}»`} en esta promo.` };
  }
  const armada = armarLineaConfigurada({ grupos: entrada.grupos, elegidas, precioBase: entrada.precioBase, descuentoDeProducto: null, cantidad: 1 });
  if (!armada.ok) {
    const codigo = armada.codigo === "OPCION_CAMBIO" ? armada.codigo : "OPCIONES_INVALIDAS";
    return { ok: false, codigo, mensaje: `«${entrada.producto.nombre}»: ${armada.mensaje}` };
  }
  const precioDeLista = armada.linea?.precioUnitario ?? entrada.precioBase;
  const queDescuentan = armada.linea !== null && armada.linea.fotos.length > 0 ? { insumos: armada.linea.insumosSinLaBase, nombres: armada.linea.fotos.map((f) => f.nombreOpcion) } : undefined;
  const rechazo = rechazoDeComponenteDeCombo({ ...entrada.producto, precioDeReferencia: precioDeLista, ...(queDescuentan ? { opcionesQueDescuentan: queDescuentan } : {}) });
  if (rechazo !== null) return { ok: false, codigo: "ENTRADA_NO_DISPONIBLE", mensaje: rechazo.mensaje };
  return { ok: true, linea: armada.linea, precioDeLista };
}
