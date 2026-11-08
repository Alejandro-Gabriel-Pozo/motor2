import "server-only";
import type { Db } from "@/lib/db-tipos";
import type { VersionDeVenta } from "@/core/pos/public";

/**
 * Las versiones de las ventas de una cuenta cerrada que se CORRIGIERON quitando unidades (E1, docs/diseno-correccion-por-ajuste-2026-11-06.md): la venta original A, la B que
 * la reemplaza (`Operacion.reemplazaAOperacionId`), la C que reemplaza a B… Lectura COMPARTIDA (ADR-026): la usan las consultas del ticket y la escritura de la corrección,
 * con el `db` que reciben (suelto o el `tx` de una transacción: dentro de la corrección ve la B recién escrita).
 *
 * Devuelve, por cada venta de `ventaIds` que tiene alguna reemplazante, su cadena completa (A primero, la vigente al final) con las unidades de cada versión (suma de
 * sus filas VENTA, en valor absoluto) y cuándo se anuló. Una venta que nadie reemplazó NO aparece: el ticket de siempre. Consultas: una por escalón de la cadena (casi
 * siempre una sola, vacía) más dos para los datos de las versiones, solo si hay alguna.
 */
const MAXIMO_DE_ESCALONES = 50; // una cadena real tiene un puñado de correcciones; el tope evita un ciclo imposible (la base los impide) sin colgar la lectura.

export async function cargarVersionesDeVentas(db: Db, ventaIds: readonly string[]): Promise<Map<string, VersionDeVenta[]>> {
  const raices = [...new Set(ventaIds)];
  const cadenas = new Map<string, string[]>(raices.map((r) => [r, [r]]));
  let frontera = new Map<string, string>(raices.map((r) => [r, r])); // última venta conocida de la cadena → su raíz
  for (let escalon = 0; escalon < MAXIMO_DE_ESCALONES && frontera.size > 0; escalon++) {
    const siguientes = await db.operacion.findMany({
      where: { reemplazaAOperacionId: { in: [...frontera.keys()] } },
      select: { id: true, reemplazaAOperacionId: true },
      take: frontera.size, // el índice único deja una sola reemplazante por venta: nunca hay más filas que ventas en la frontera
    });
    const nuevaFrontera = new Map<string, string>();
    for (const s of siguientes) {
      const raiz = frontera.get(s.reemplazaAOperacionId!);
      if (raiz === undefined) continue;
      cadenas.get(raiz)!.push(s.id);
      nuevaFrontera.set(s.id, raiz);
    }
    frontera = nuevaFrontera;
  }

  const conReemplazo = [...cadenas].filter(([, ids]) => ids.length > 1);
  if (conReemplazo.length === 0) return new Map();
  const todas = conReemplazo.flatMap(([, ids]) => ids);
  const [operaciones, unidades] = await Promise.all([
    db.operacion.findMany({ where: { id: { in: todas } }, select: { id: true, anuladaEn: true }, take: todas.length }),
    db.movimientoStock.groupBy({ by: ["operacionId"], where: { operacionId: { in: todas }, proceso: "VENTA" }, _sum: { cantidad: true } }),
  ]);
  const anuladaEn = new Map(operaciones.map((o) => [o.id, o.anuladaEn]));
  const cantidad = new Map(unidades.map((u) => [u.operacionId, Math.abs(Number(u._sum.cantidad ?? 0))]));
  return new Map(
    conReemplazo.map(([raiz, ids]) => [raiz, ids.map((id) => ({ operacionId: id, cantidad: cantidad.get(id) ?? 0, anuladaEn: anuladaEn.get(id) ?? null }))])
  );
}
