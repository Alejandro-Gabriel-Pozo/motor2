import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";
import type { LibroDeStock, ParteAsignada, SeccionCandidata } from "@/core/movimientos/origen-venta";

/**
 * REFERENCIA CONGELADA — NO EDITAR.
 *
 * Copia LITERAL de `asignarConsumo` y sus auxiliares privados tal como estaban en `src/core/movimientos/origen-venta.ts` ANTES del
 * refactor del paso 2 (extraer `tomarDeFamilia`) y de la sustitución de insumos del paso 3
 * (docs/plan-sustitucion-insumos-receta-2026-09-26.md, paso 1). Sirve de oráculo para el test diferencial
 * (`test/core/origen-venta-diferencial.test.ts`): mientras el comportamiento SIN sustitutos no tenga que cambiar, el `asignarConsumo`
 * real tiene que devolver EXACTAMENTE lo mismo que esta copia, escenario por escenario.
 *
 * Reusa `crearLibroDeStock`/`LibroDeStock`/`SeccionCandidata`/`ParteAsignada` del módulo real — esa parte no cambia en ningún paso del
 * plan, solo el cuerpo de `asignarConsumo` se reorganiza. Todo lo demás (r4, compararLotes, disponibleDeProducto, ordenarRespaldos,
 * seccionesEnOrden, juntarPartes, asignarConsumo) está pegado tal cual estaba, con un solo cambio cosmético: el nombre de la función
 * pública (`asignarConsumoReferencia` en vez de `asignarConsumo`) para no chocar con la importación del módulo real en el mismo test.
 */

const r4 = (n: number) => redondearACantidadDeUnidad(n, 4);
const claveLote = (lote: Date | null) => (lote ? String(lote.getTime()) : "sin-lote");

/** Lo que todavía se puede tomar del producto en la sección: lo disponible por lote, sin pasar nunca el saldo TOTAL que queda (un lote negativo resta). */
function disponibleDeProducto(libro: LibroDeStock, productoId: string, seccionId: string): number {
  const porLotes = r4(libro.lotes(productoId, seccionId).reduce((suma, lote) => suma + libro.disponible(productoId, seccionId, lote), 0));
  const porTotal = Math.max(0, r4(libro.saldoInicial(productoId, seccionId) - libro.cargado(productoId, seccionId)));
  return Math.min(porLotes, porTotal);
}

/** FEFO: con fecha antes que sin fecha; entre fechas, la que vence antes. */
function compararLotes(a: Date | null, b: Date | null): number {
  if (a && b) return a.getTime() - b.getTime();
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Respaldo ordenado (B2): por el lote disponible que vence antes en toda la familia dentro de la sección; más disponible; nombre. */
function ordenarRespaldos(libro: LibroDeStock, familia: readonly string[], respaldos: readonly SeccionCandidata[]): SeccionCandidata[] {
  const claves = respaldos.map((seccion) => {
    let primerVencimiento: Date | null = null;
    let conVencimiento = false;
    let total = 0;
    for (const productoId of familia) {
      const disponible = disponibleDeProducto(libro, productoId, seccion.id);
      if (disponible <= 0) continue;
      total += disponible;
      for (const lote of libro.lotes(productoId, seccion.id)) {
        if (!lote || libro.disponible(productoId, seccion.id, lote) <= 0) continue;
        if (!conVencimiento || lote.getTime() < primerVencimiento!.getTime()) primerVencimiento = lote;
        conVencimiento = true;
      }
    }
    return { seccion, vence: conVencimiento ? primerVencimiento!.getTime() : Infinity, total: r4(total) };
  });
  claves.sort((a, b) => (a.vence === b.vence ? 0 : a.vence < b.vence ? -1 : 1) || b.total - a.total || a.seccion.nombre.localeCompare(b.seccion.nombre, "es"));
  return claves.map((c) => c.seccion);
}

function seccionesEnOrden(libro: LibroDeStock, familia: readonly string[], habitual: SeccionCandidata | null, respaldos: readonly SeccionCandidata[]): SeccionCandidata[] {
  const otras = respaldos.filter((s) => s.id !== habitual?.id);
  return [...(habitual ? [habitual] : []), ...ordenarRespaldos(libro, familia, otras)];
}

/** Junta las partes del mismo (producto, sección, lote): una sola fila de Kardex por cada una, como antes. */
function juntarPartes(partes: ParteAsignada[]): ParteAsignada[] {
  const juntas: ParteAsignada[] = [];
  for (const p of partes) {
    const igual = juntas.find((j) => j.productoId === p.productoId && j.seccionId === p.seccionId && claveLote(j.loteVencimiento) === claveLote(p.loteVencimiento));
    if (igual) igual.cantidad += p.cantidad;
    else juntas.push({ ...p });
  }
  return juntas;
}

/**
 * Asigna el consumo de UN ingrediente (`productoId`, el de la receta, con su `familia` de hermanos: él mismo incluido) y lo anota en
 * el libro. Devuelve las partes, ya juntadas por (producto, sección, lote).
 */
export function asignarConsumoReferencia(
  libro: LibroDeStock,
  pedido: {
    productoId: string;
    familia: readonly string[];
    cantidad: number;
    /** Se usa primero aunque no sirva de respaldo. */
    seccionHabitual: SeccionCandidata | null;
    /** Activas que sirven de respaldo (la habitual, si está, se ignora acá). */
    respaldos: readonly SeccionCandidata[];
    seccionParaFaltanteId: string;
  }
): ParteAsignada[] {
  const familia = pedido.familia.includes(pedido.productoId) ? pedido.familia : [pedido.productoId, ...pedido.familia];
  const partes: ParteAsignada[] = [];
  let restante = pedido.cantidad;

  for (const seccion of seccionesEnOrden(libro, familia, pedido.seccionHabitual, pedido.respaldos)) {
    if (r4(restante) <= 0) break;
    const candidatos = familia.flatMap((productoId) => libro.lotes(productoId, seccion.id).map((lote) => ({ productoId, lote })));
    candidatos.sort(
      (a, b) =>
        compararLotes(a.lote, b.lote) ||
        Number(b.productoId === pedido.productoId) - Number(a.productoId === pedido.productoId) ||
        (a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0)
    );
    for (const c of candidatos) {
      if (r4(restante) <= 0) break;
      const tomar = Math.min(restante, libro.disponible(c.productoId, seccion.id, c.lote), disponibleDeProducto(libro, c.productoId, seccion.id));
      if (r4(tomar) <= 0) continue;
      const parte = { productoId: c.productoId, seccionId: seccion.id, loteVencimiento: c.lote, cantidad: tomar };
      libro.tomar(parte);
      partes.push(parte);
      restante -= tomar;
    }
  }

  if (r4(restante) > 0) {
    const ultimaAhi = partes.findLast((p) => p.productoId === pedido.productoId && p.seccionId === pedido.seccionParaFaltanteId);
    const resto = { productoId: pedido.productoId, seccionId: pedido.seccionParaFaltanteId, loteVencimiento: ultimaAhi?.loteVencimiento ?? null, cantidad: restante };
    libro.tomar(resto);
    partes.push(resto);
  }
  return juntarPartes(partes);
}
