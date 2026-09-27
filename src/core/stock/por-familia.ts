import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { textoCadenaDeGrupos } from "@/core/catalogo/public-servidor";

type Db = PrismaClient | Prisma.TransactionClient;

export interface FilaStockPorFamilia {
  insumoId: string;
  insumoNombre: string;
  grupoNombre: string | null;
  grupoCadena: string;
  seccionId: string;
  seccionNombre: string;
  unidadStockNombre: string | null;
  saldo: number;
  productos: string[];
  unidadesMezcladas: boolean;
}

/**
 * Port de calcularStockPorFamilia_ (Stock.js:887-957) — "Familia" es
 * `Insumo` en el schema nuevo (porción Catálogo). Agrupa el saldo por
 * Insumo+Sección: varios Producto distintos (proveedores/presentaciones)
 * bajo el mismo Insumo aparecen como un único saldo. Solo agrupa MP — un
 * PV nunca se compra, sumar su saldo (negativo, artefacto de ventas) con
 * el de la MP que lo abastece daría un número sin sentido (mismo bugfix
 * que ya vale para resolverConsumoPorFamilia, porción Movimientos).
 */
export async function calcularStockPorFamilia(sucursalId: string, db: Db = prisma): Promise<FilaStockPorFamilia[]> {
  const filas = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { seccion: { sucursalId }, producto: { tipo: "MP" } },
    _sum: { cantidad: true },
  });
  if (!filas.length) return [];

  const productoIds = Array.from(new Set(filas.map((f) => f.productoId)));
  const productos = await db.producto.findMany({
    where: { id: { in: productoIds } },
    include: { insumo: { include: { grupo: true } }, unidadStock: true },
  });
  const productoPorId = new Map(productos.map((p) => [p.id, p]));

  const seccionIds = Array.from(new Set(filas.map((f) => f.seccionId)));
  const secciones = await db.seccion.findMany({ where: { id: { in: seccionIds } } });
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  interface Acumulado {
    insumoId: string;
    insumoNombre: string;
    grupoNombre: string | null;
    seccionId: string;
    seccionNombre: string;
    unidadStockId: string | null;
    unidadStockNombre: string | null;
    saldo: number;
    productos: Set<string>;
    unidadesMezcladas: boolean;
  }
  const grupos = new Map<string, Acumulado>();

  for (const f of filas) {
    const producto = productoPorId.get(f.productoId);
    if (!producto?.insumo) continue; // sin Insumo asignado: queda afuera de este reporte

    const seccion = seccionPorId.get(f.seccionId);
    const key = `${producto.insumo.id}||${f.seccionId}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        insumoId: producto.insumo.id,
        insumoNombre: producto.insumo.nombre,
        grupoNombre: producto.insumo.grupo?.nombre ?? null,
        seccionId: f.seccionId,
        seccionNombre: seccion?.nombre ?? "",
        unidadStockId: producto.unidadStockId,
        unidadStockNombre: producto.unidadStock.nombre,
        saldo: 0,
        productos: new Set(),
        unidadesMezcladas: false,
      });
    }
    const g = grupos.get(key)!;
    g.saldo += Number(f._sum.cantidad ?? 0);
    g.productos.add(producto.nombre);
    // v2.3.0 (Apps Script) — dos unidades de stock distintas bajo el mismo
    // Insumo hacen que el total NO sea confiable: se marca en vez de
    // mostrar un número plausible y equivocado.
    if (producto.unidadStockId && producto.unidadStockId !== g.unidadStockId) g.unidadesMezcladas = true;
  }

  const resultado: FilaStockPorFamilia[] = [];
  for (const g of grupos.values()) {
    const grupoRow = g.grupoNombre
      ? await db.grupo.findUnique({ where: { nombre: g.grupoNombre }, select: { id: true } })
      : null;
    const grupoCadena = grupoRow ? await textoCadenaDeGrupos(grupoRow.id, db) : "";
    resultado.push({
      insumoId: g.insumoId,
      insumoNombre: g.insumoNombre,
      grupoNombre: g.grupoNombre,
      grupoCadena,
      seccionId: g.seccionId,
      seccionNombre: g.seccionNombre,
      unidadStockNombre: g.unidadesMezcladas ? null : g.unidadStockNombre,
      saldo: g.saldo,
      productos: Array.from(g.productos),
      unidadesMezcladas: g.unidadesMezcladas,
    });
  }

  // Grupo primero (sin grupo al final), Insumo+Sección adentro — mismo
  // criterio de orden que Apps Script (ver el caracter U+FFFF como "va al final").
  return resultado.sort(
    (a, b) =>
      (a.grupoCadena || "￿").localeCompare(b.grupoCadena || "￿") ||
      a.insumoNombre.localeCompare(b.insumoNombre) ||
      a.seccionNombre.localeCompare(b.seccionNombre)
  );
}
