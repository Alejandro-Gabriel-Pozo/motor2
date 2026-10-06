import { textoCadenaDeGruposEn, type NodoDeGrupo } from "@/core/catalogo/public";

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

/** El saldo (suma del Kardex) de un producto en una sección, tal como lo lee la consulta (`server/consultas/stock/por-familia.ts`). */
export interface SaldoDeProductoEnSeccion {
  productoId: string;
  seccionId: string;
  saldo: number;
}

/** Lo que el reporte necesita de un producto: su nombre, su unidad de stock y el Insumo (con su grupo) al que pertenece. */
export interface ProductoDeFamilia {
  id: string;
  nombre: string;
  unidadStockId: string | null;
  unidadStock: { nombre: string };
  insumo: { id: string; nombre: string; grupo: { id: string; nombre: string } | null } | null;
}

/**
 * Port de calcularStockPorFamilia_ (Stock.js:887-957) — "Familia" es
 * `Insumo` en el schema nuevo (porción Catálogo). Agrupa el saldo por
 * Insumo+Sección: varios Producto distintos (proveedores/presentaciones)
 * bajo el mismo Insumo aparecen como un único saldo. Solo agrupa MP — un
 * PV nunca se compra, sumar su saldo (negativo, artefacto de ventas) con
 * el de la MP que lo abastece daría un número sin sentido (mismo bugfix
 * que ya vale para resolverConsumoPorFamilia, porción Movimientos).
 *
 * Puro: recibe los saldos, los productos, las secciones y el árbol de grupos ya leídos (la consulta que los lee es
 * `calcularStockPorFamilia` en `server/consultas/stock/por-familia.ts`).
 */
export function armarStockPorFamilia(
  filas: readonly SaldoDeProductoEnSeccion[],
  productos: readonly ProductoDeFamilia[],
  secciones: readonly { id: string; nombre: string }[],
  arbolDeGrupos: ReadonlyMap<string, NodoDeGrupo>,
): FilaStockPorFamilia[] {
  if (!filas.length) return [];

  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  interface Acumulado {
    insumoId: string;
    insumoNombre: string;
    grupoId: string | null;
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
        grupoId: producto.insumo.grupo?.id ?? null,
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
    g.saldo += f.saldo;
    g.productos.add(producto.nombre);
    // v2.3.0 (Apps Script) — dos unidades de stock distintas bajo el mismo
    // Insumo hacen que el total NO sea confiable: se marca en vez de
    // mostrar un número plausible y equivocado.
    if (producto.unidadStockId && producto.unidadStockId !== g.unidadStockId) g.unidadesMezcladas = true;
  }

  const resultado: FilaStockPorFamilia[] = [];
  for (const g of grupos.values()) {
    resultado.push({
      insumoId: g.insumoId,
      insumoNombre: g.insumoNombre,
      grupoNombre: g.grupoNombre,
      grupoCadena: g.grupoId ? textoCadenaDeGruposEn(arbolDeGrupos, g.grupoId) : "",
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
      (a.grupoCadena || "\uffff").localeCompare(b.grupoCadena || "\uffff") ||
      a.insumoNombre.localeCompare(b.insumoNombre) ||
      a.seccionNombre.localeCompare(b.seccionNombre)
  );
}
