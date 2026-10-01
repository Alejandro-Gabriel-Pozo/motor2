import type { Prisma, PrismaClient } from "@prisma/client";
import { precioDePromo, seleccionDeSucursalDePromo, wherePromoOfrecidaEn } from "@/core/carta/public";
import { cargarSelectorCartaPos } from "./selector-carta-consulta";
import { pediblesDeEntrada } from "./selector-carta";
import type { CupoPromoDefinicion } from "./promo-combo";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de LECTURA de una promo ARMABLE para agregarla a una cuenta (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 8a) —
 * separada de `promo-combo.ts` (puro) por el mismo motivo que `selector-carta-consulta.ts`/`selector-carta.ts`.
 */
export interface PromoCartaParaAgregar {
  id: string;
  titulo: string;
  precio: number;
  cupos: CupoPromoDefinicion[];
  /** Precio DE CARTA de cada producto elegible de CUALQUIER cupo de esta promo — lo que `prorratearPrecioPromo` (D3) necesita
   *  para repartir, y lo que se congela en `CuentaItem.precioCartaUnitario`. */
  precioCartaPorProducto: ReadonlyMap<string, number>;
}

/**
 * Carga una `PromoCarta` OFRECIDA en la sucursal (activa en la empresa y prendida acá) y ARMABLE (con uno o más cupos), con su precio vigente acá, con los MISMOS elegibles que el selector del
 * POS ofrece en cada sección de sus cupos (D5) — la fuente ÚNICA, para que `agregarItems` (paso 8a) valide la elección del
 * mozo con la misma información que ve en pantalla, nunca una lista propia que pueda desincronizarse (test de paridad contra
 * el selector, `test/pos/promo-combo-consulta.test.ts`). `null` si la promo no existe en esta sucursal, está apagada, o
 * todavía no tiene ningún cupo (sigue siendo informativa: el POS la ignora).
 */
export async function cargarPromoCartaParaAgregar(sucursalId: string, promoCartaId: string, db: Db): Promise<PromoCartaParaAgregar | null> {
  const promo =
    typeof promoCartaId === "string"
      ? await db.promoCarta.findFirst({
          where: { id: promoCartaId, ...wherePromoOfrecidaEn(sucursalId) },
          include: { sucursales: seleccionDeSucursalDePromo(sucursalId), cupos: { include: { seccionCarta: { select: { nombre: true } } }, orderBy: { orden: "asc" } } },
        })
      : null;
  if (!promo || !promo.cupos.length) return null;

  const selector = await cargarSelectorCartaPos(sucursalId, db);
  const pediblesPorSeccion = new Map(selector.seccionesCarta.map((s) => [s.seccionCartaId, s.entradas.flatMap(pediblesDeEntrada)]));

  const precioCartaPorProducto = new Map<string, number>();
  const cupos: CupoPromoDefinicion[] = promo.cupos.map((c) => {
    const pedibles = pediblesPorSeccion.get(c.seccionCartaId) ?? [];
    for (const p of pedibles) precioCartaPorProducto.set(p.productoId, p.precio);
    return {
      seccionCartaId: c.seccionCartaId,
      nombreSeccion: c.seccionCarta.nombre,
      cantidadMinima: c.cantidadMinima,
      cantidadMaximaCupo: c.cantidadMaxima,
      elegibles: new Set(pedibles.map((p) => p.productoId)),
    };
  });
  return { id: promo.id, titulo: promo.titulo, precio: precioDePromo(promo.precio, promo.sucursales[0]), cupos, precioCartaPorProducto };
}
