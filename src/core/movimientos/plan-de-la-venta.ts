import { asignarConsumosDeVenta, elegirSeccionDeStockPropio, type ParteAsignada, type ParteConsumo, type PedidoDeConsumo } from "@/core/movimientos/origen-venta";
import type { DatosDeOrigen } from "@/core/movimientos/origen-venta-datos";

/**
 * El PLAN DE ORIGEN de una venta (Hito 5, pieza 5.1, bloque B: mudado TAL CUAL desde `registrarVentaEnTx`, que vive en `server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`).
 * Dadas las líneas ya validadas y los datos de origen YA CARGADOS (`DatosDeOrigen`: el libro de stock, las secciones habituales y de respaldo, las familias), decide de qué sección y de
 * qué lote sale cada cosa. P0: sin Prisma, sin lectura ni escritura, sin reloj ni azar — `origenDatos.habitualDe`, `referenciaDe`, `familiaDe` y `familiaSustitutaDe` son cierres sobre
 * mapas que el cargador (`server/persistencia/movimientos/cargar-origen-de-venta.ts`) armó ANTES, y el libro es una cuenta en memoria.
 *
 * El ORDEN de las mutaciones del libro es parte del contrato (los goldens de la venta lo registran): primero el stock PROPIO de cada PV que se produce (en el orden de las líneas), después
 * UN solo `asignarConsumosDeVenta` para los pedidos de receta de la venta ENTERA, después el `map` que arma cada venta. Cambiar ese orden cambia qué lote le toca a quién.
 */

/** Una línea validada, todavía SIN sección: lo que pide su receta (o su stock propio, si se produce) se asigna después, con el libro. */
export interface LineaArmada {
  productoId: string;
  nombre: string;
  seProduce: boolean;
  cantidadVendida: number;
  precioVenta: number;
  /** Precio de LISTA de esta línea, si difiere de `precioVenta` (Task #14). `null` = coinciden, no se guarda nada distinto. */
  precioListaVenta: number | null;
  /** Costo de receta resuelto AL MOMENTO de esta venta (docstring en schema.prisma, MovimientoStock.costoUnitarioVenta) — null si el costeo estaba incompleto ese día. */
  costoUnitarioAlVender: number | null;
  /** La `PromoCuenta` de la que esta línea es un componente (Task #16) — null = un suelto. */
  promoCuentaId: string | null;
  /** Consumo de receta por ingrediente, en el orden de los ingredientes (id ascendente: determinístico para el libro). */
  pedidos: {
    productoId: string;
    cantidad: number;
    /** Insumos sustitutos declarados en ESTA línea de receta, en orden (docs/plan-sustitucion-insumos-receta-2026-09-26.md, D1). */
    insumoSustitutoIds: string[];
    /** Unidad de stock de la MP principal — la familia sustituta se filtra a esta misma unidad (D8). */
    unidadStockId: string;
  }[];
}

export interface VentaCalculada extends LineaArmada {
  seccionId: string;
  loteVencimiento: Date | null;
  /** Solo el PV que se produce: de qué lotes (y secciones) sale su stock propio, FEFO. Con más de una parte, la fila VENTA se parte en una por parte (precio repartido con `repartirImporte`). */
  partesPropias?: ParteAsignada[];
  consumos: ParteConsumo[];
}

/**
 * Sin ninguna sección de respaldo (todas excluidas con `sirveDeRespaldoEnVentas`), un PV sin habitual no tiene de dónde salir: devuelve el rechazo con la salida concreta (distinto de
 * «sin secciones activas»: la solución es otra), o `null` si la venta puede seguir. Se llama ANTES de escribir nada. Con respaldos, o con todos los PV con habitual, no rechaza.
 */
export function rechazoSinRespaldo(lineas: readonly LineaArmada[], origenDatos: DatosDeOrigen, sucursalNombre: string): string | null {
  if (origenDatos.respaldos.length) return null;
  const sinHabitual = lineas.find((l) => !origenDatos.habitualDe(l.productoId));
  if (!sinHabitual) return null;
  return (
    `Ninguna sección de «${sucursalNombre}» sirve de respaldo automático en ventas y «${sinHabitual.nombre}» no tiene sección habitual: ` +
    "configurá su sección habitual (Stock → Sección habitual) o marcá una sección como respaldo (Movimientos → Secciones)."
  );
}

/**
 * De qué sección y lote sale cada cosa: todo con UN libro para la venta entera, en el orden de las líneas y de sus ingredientes. Devuelve las ventas ya calculadas y los pedidos de receta
 * planos (que el orquestador necesita para saber qué familias de sustitutos tocó la venta y validar el stock). MUTA el libro de `origenDatos`.
 */
export function asignarOrigenDeLaVenta(lineas: readonly LineaArmada[], origenDatos: DatosDeOrigen): { ventas: VentaCalculada[]; pedidosPlanos: PedidoDeConsumo[] } {
  const { libro, respaldos, seccionPorDefectoId } = origenDatos;

  // PVs que se producen: stock PROPIO, sin sustitutos ni receta — se resuelven en su propio sub-paso, en el orden de las líneas
  // (no interactúan con el consumo de receta de las demás: un PV que se produce nunca es MP de ninguna receta, así que el orden
  // relativo entre este sub-paso y el de abajo no cambia ningún resultado).
  const propiaPorLinea = new Map<number, ParteAsignada[]>();
  lineas.forEach((linea, i) => {
    if (!linea.seProduce) return;
    const habitual = origenDatos.habitualDe(linea.productoId);
    // El PV vendido también puede tener lotes propios si está marcado "Se produce" — siempre el que vence antes (FEFO), nunca a
    // elección manual; el dato ya está en el Kardex desde que se produjo, no hace falta pedírselo a quien vende.
    propiaPorLinea.set(
      i,
      elegirSeccionDeStockPropio(libro, {
        productoId: linea.productoId,
        cantidad: linea.cantidadVendida,
        seccionHabitual: habitual,
        respaldos,
        seccionSiNingunaAlcanzaId: habitual?.id ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId,
      })
    );
  });

  // Pedidos de receta de TODAS las líneas que consumen (no seProduce), en el orden de línea e ingrediente — UN solo
  // asignarConsumosDeVenta para la venta ENTERA (D5): una sustitución nunca le saca stock a un consumo principal de OTRA línea,
  // porque su pasada 2 corre después de que la 1 terminó para todas. Sin sustitutos, misma secuencia que antes (demostración (a),
  // docs/plan-sustitucion-insumos-receta-2026-09-26.md §4).
  const pedidosPlanos: PedidoDeConsumo[] = [];
  const rangoPorLinea = new Map<number, { desde: number; hasta: number }>();
  lineas.forEach((linea, i) => {
    if (linea.seProduce) return;
    const habitual = origenDatos.habitualDe(linea.productoId);
    const desde = pedidosPlanos.length;
    for (const p of linea.pedidos) {
      pedidosPlanos.push({
        productoId: p.productoId,
        familia: origenDatos.familiaDe(p.productoId),
        cantidad: p.cantidad,
        seccionHabitual: habitual,
        respaldos,
        seccionParaFaltanteId: habitual?.id ?? origenDatos.referenciaDe(p.productoId) ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId,
        sustitutos: p.insumoSustitutoIds.length ? p.insumoSustitutoIds.map((insumoId) => origenDatos.familiaSustitutaDe(insumoId, p.unidadStockId)) : undefined,
      });
    }
    rangoPorLinea.set(i, { desde, hasta: pedidosPlanos.length });
  });
  const resultadosPlanos = asignarConsumosDeVenta(libro, pedidosPlanos);

  const ventas: VentaCalculada[] = lineas.map((linea, i) => {
    if (linea.seProduce) {
      const propia = propiaPorLinea.get(i)!;
      return { ...linea, seccionId: propia[0]!.seccionId, loteVencimiento: propia[0]!.loteVencimiento, partesPropias: propia, consumos: [] };
    }
    const habitual = origenDatos.habitualDe(linea.productoId);
    const { desde, hasta } = rangoPorLinea.get(i)!;
    const consumos = resultadosPlanos.slice(desde, hasta).flat();
    const seccionId = habitual?.id ?? consumos[0]?.seccionId ?? origenDatos.referenciaDe(linea.productoId) ?? seccionPorDefectoId;
    return { ...linea, seccionId, loteVencimiento: null, consumos };
  });

  return { ventas, pedidosPlanos };
}
