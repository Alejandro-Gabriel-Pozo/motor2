import "server-only";
import { decidirSobreProducto, ocultoPor } from "@/core/catalogo/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Los lectores de «Ocultar» (docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-12): ¿está el producto oculto en esta sucursal? = hay una marca `oculto` de la empresa o de la sucursal (`ocultoPor`, una sola
 * definición). Sin marca = visible. Los usan la venta (dentro de su transacción) y las pantallas. El `where` de Prisma para los listados es `whereNoOcultoEn` (core). FALLA CERRADO (I-13): si la lectura falla,
 * el error sube y no se agrega la línea; nunca se asume «visible».
 */
export async function productoOcultoEn(sucursalId: string, productoId: string, db: Db): Promise<boolean> {
  return (await productosOcultosEn(sucursalId, [productoId], db)).has(productoId);
}

/** Batch — de estos productos, cuáles están ocultos en la sucursal (UNA consulta). Sin productos no lee nada. */
export async function productosOcultosEn(sucursalId: string, productoIds: readonly string[], db: Db): Promise<Set<string>> {
  if (productoIds.length === 0) return new Set();
  const filas = await db.ocultamientoProducto.findMany({
    where: { productoId: { in: [...productoIds] }, oculto: true, OR: [{ sucursalId: null }, { sucursalId }] },
    select: { productoId: true, sucursalId: true, oculto: true },
  });
  const ocultos = new Set<string>();
  for (const id of new Set(filas.map((f) => f.productoId))) {
    if (ocultoPor(filas.filter((f) => f.productoId === id), sucursalId) !== null) ocultos.add(id);
  }
  return ocultos;
}

/**
 * «Suma es suma» (diseño 2026-11-15, I-5, R-6 y R-8): de estas líneas (cantidad con SIGNO: positiva = entra existencia), ¿cuáles dejarían a un producto OCULTO en esta sucursal con saldo por encima de cero en su
 * sección? Se suma por (producto, sección); si el neto no suma (≤ 0) no cuenta (restar y corregir un negativo hasta cero se permiten); si suma, se mira el saldo actual de esa sección. La decisión la toma el
 * núcleo (`decidirSobreProducto`, oráculo: `anular_venta` o `entrada_que_suma`). Devuelve los ids de producto que se rechazan (vacío = todo bien). Solo lee: quien llama arma la transacción (la anulación es SERIALIZABLE).
 */
export async function ocultosQueQuedarianConExistencia(
  sucursalId: string,
  lineas: readonly { readonly productoId: string; readonly seccionId: string; readonly cantidad: number }[],
  operacion: "anular_venta" | "entrada_que_suma",
  db: Db
): Promise<string[]> {
  const netos = new Map<string, { productoId: string; seccionId: string; neto: number }>();
  for (const l of lineas) {
    const clave = `${l.productoId}|${l.seccionId}`;
    const previo = netos.get(clave);
    netos.set(clave, { productoId: l.productoId, seccionId: l.seccionId, neto: (previo?.neto ?? 0) + l.cantidad });
  }
  const queSuman = [...netos.values()].filter((n) => n.neto > 0);
  if (queSuman.length === 0) return [];
  const ocultos = await productosOcultosEn(sucursalId, [...new Set(queSuman.map((n) => n.productoId))], db);
  const aMirar = queSuman.filter((n) => ocultos.has(n.productoId));
  if (aMirar.length === 0) return [];
  const saldos = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { productoId: { in: [...new Set(aMirar.map((n) => n.productoId))] }, seccionId: { in: [...new Set(aMirar.map((n) => n.seccionId))] } },
    _sum: { cantidad: true },
  });
  const saldoDe = new Map(saldos.map((s) => [`${s.productoId}|${s.seccionId}`, Number(s._sum.cantidad ?? 0)]));
  const rechazados = new Set<string>();
  for (const n of aMirar) {
    const final = (saldoDe.get(`${n.productoId}|${n.seccionId}`) ?? 0) + n.neto;
    const decision = decidirSobreProducto({
      hechos: { desactivar: "activo", ocultar: { empresa: false, local: true }, saldo: final > 0 ? "positivo" : final < 0 ? "negativo" : "cero", conteoSinResolver: false, enRecetaVigente: false },
      operacion,
    });
    if (!decision.ok) rechazados.add(n.productoId);
  }
  return [...rechazados];
}
