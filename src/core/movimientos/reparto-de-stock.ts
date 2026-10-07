import { redondearACantidadDeUnidad, tieneStockReal } from "./transiciones";

/**
 * El cálculo PURO de los lectores del Kardex (Pureza Fase 4, tramo A): qué lote vence antes, cómo se reparte un consumo entre los «hermanos» de un insumo y qué filas
 * lleva la grilla de Conteo Físico. Sin base ni reloj: reciben las filas ya leídas (los lectores de `server/lecturas/movimientos/saldos.ts` y
 * `server/consultas/movimientos/stock-para-conteo.ts` las leen y se las pasan).
 */

/** Una parte de un consumo: de qué producto y de qué lote sale, y cuánto. */
export interface ParteDeReparto {
  productoId: string;
  loteVencimiento: Date | null;
  cantidad: number;
}

/**
 * FEFO simplificado (Stock.js:403-425, IDEA-conteo-fisico-por-lote.md): de los lotes de UN producto en UNA sección, el que tiene saldo positivo y vence antes. A
 * propósito NO reparte entre varios lotes si el elegido no alcanza — asigna todo el movimiento a ese único lote, misma simplificación deliberada que Apps Script.
 * `null` si ningún lote con fecha tiene saldo positivo (el bucket «sin lote» no cuenta: no tiene fecha que comparar).
 */
export function elegirLoteMasProximoAVencer(lotes: readonly { loteVencimiento: Date | null; saldo: number }[]): Date | null {
  const conSaldo = lotes.filter((l) => l.loteVencimiento && l.saldo > 0);
  if (!conSaldo.length) return null;

  const ordenados = [...conSaldo].sort((a, b) => a.loteVencimiento!.getTime() - b.loteVencimiento!.getTime());
  return ordenados[0].loteVencimiento;
}

/**
 * Port de resolverConsumoPorFamilia_ (Stock.js:438-523, sesión «recetas por insumo»), la parte de cálculo: dado el saldo de cada «hermano» (otro Producto con el mismo
 * insumo, MP, disponible en la sucursal) por lote en la sección, reparte `cantidadNecesaria` con criterio FEFO (lote que vence antes primero, sin-lote al final).
 * Devuelve `null` si el Insumo ENTERO tampoco alcanza: ahí el llamador cae al camino de siempre (todo el consumo contra el producto pedido, para que el «no alcanza»
 * posterior bloquee igual que hoy).
 *
 * Redondeado a 4 decimales (precisión real de `MovimientoStock.cantidad`, Decimal(14,4)) ANTES de comparar — investigado como flake intermitente de
 * `test/auditoria/precision-roundtrip-y-reparto.test.ts` («3 hermanos»): el orden del GROUP BY de Postgres no está garantizado y la suma de punto flotante no es
 * asociativa (3.37+2.19+1.81 en otro orden puede dar `7.3700000000000001066` en vez de `7.3700000000000009948`, el mismo valor decimal real). Sin este redondeo, ese ruido
 * de los últimos bits hacía fallar `disponibleInsumo < cantidadNecesaria` para un pedido que en realidad calzaba justo.
 */
export function repartirConsumoPorFamilia(
  candidatosCrudos: readonly { productoId: string; loteVencimiento: Date | null; saldo: number }[],
  cantidadNecesaria: number
): ParteDeReparto[] | null {
  const candidatos = candidatosCrudos
    .filter((c) => c.saldo > 0)
    .sort((a, b) => {
      if (a.loteVencimiento && b.loteVencimiento) return a.loteVencimiento.getTime() - b.loteVencimiento.getTime();
      if (a.loteVencimiento) return -1; // con fecha antes que sin fecha
      if (b.loteVencimiento) return 1;
      return 0;
    });

  const disponibleInsumo = redondearACantidadDeUnidad(candidatos.reduce((acc, c) => acc + c.saldo, 0), 4);
  if (disponibleInsumo < redondearACantidadDeUnidad(cantidadNecesaria, 4)) return null; // ni el Insumo entero alcanza

  const partes: ParteDeReparto[] = [];
  let restante = cantidadNecesaria;
  for (const c of candidatos) {
    if (restante <= 0) break;
    const tomar = Math.min(restante, c.saldo);
    partes.push({ productoId: c.productoId, loteVencimiento: c.loteVencimiento, cantidad: tomar });
    restante -= tomar;
  }
  return partes;
}

export interface FilaStockParaConteo {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadStockNombre: string;
  loteVencimiento: Date | null;
  saldoSistema: number;
}

/** Lo que la grilla de conteo necesita saber de un producto. */
export interface ProductoParaConteo {
  id: string;
  codigo: string;
  nombre: string;
  tipo: Parameters<typeof tieneStockReal>[0];
  seProduce: boolean;
  unidadStock: { nombre: string; decimales: number };
}

/**
 * Las filas de la grilla de Conteo Físico: una por (producto, lote) con saldo != 0 — la precarga (mismo criterio que «Fetch Items from Warehouse» de ERPNext,
 * `stock_reconciliation.py::get_items`: solo lo que ya tiene historial de stock ahí, no el catálogo entero). Excluye PV comunes (mismo filtro que
 * `registrarConteoFisico`, `tieneStockReal`), lo no disponible en la sucursal y el saldo 0 — nada que verificar ahí; si hay algo real que el sistema no sabe (nunca
 * contado, sin factura), se agrega a mano en la grilla, que sí admite contar sobre saldo 0. Ordenadas por nombre (en castellano) y, dentro del producto, por lote
 * (el «sin lote» primero).
 */
export function armarFilasStockParaConteo(
  gruposConSaldo: readonly { productoId: string; loteVencimiento: Date | null; saldo: number }[],
  productoPorId: ReadonlyMap<string, ProductoParaConteo>,
  disponibilidad: ReadonlyMap<string, boolean>
): FilaStockParaConteo[] {
  const filas: FilaStockParaConteo[] = [];
  for (const g of gruposConSaldo) {
    const p = productoPorId.get(g.productoId);
    if (!p || !disponibilidad.get(p.id) || !tieneStockReal(p.tipo, p.seProduce)) continue;
    filas.push({
      productoId: p.id,
      productoCodigo: p.codigo,
      productoNombre: p.nombre,
      unidadStockNombre: p.unidadStock.nombre,
      loteVencimiento: g.loteVencimiento,
      saldoSistema: redondearACantidadDeUnidad(g.saldo, p.unidadStock.decimales),
    });
  }

  filas.sort(
    (a, b) =>
      a.productoNombre.localeCompare(b.productoNombre, "es") ||
      (a.loteVencimiento?.getTime() ?? -Infinity) - (b.loteVencimiento?.getTime() ?? -Infinity)
  );
  return filas;
}
