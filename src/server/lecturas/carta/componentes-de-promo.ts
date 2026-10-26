import "server-only";
import type { Prisma } from "@prisma/client";
import { ALICUOTAS_IVA, type AlicuotaIva } from "@/core/fiscal/public";
import type { ComponenteConAlicuota } from "@/core/pos/public";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { cargarOrigenDeStockParaVender } from "@/server/lecturas/movimientos/receta-para-vender";
import { cargarOpcionesParaVender, type OpcionesDeProducto } from "@/server/lecturas/opciones/opciones-para-vender";

/**
 * Lecturas de los COMPONENTES de los combos y del menú del día (GO-3b, ADR-032). SIEMPRE con el `tx` de quien llama (la transacción SERIALIZABLE del caso de uso: lo que decide se lee adentro).
 *
 *  - `cargarProductosComoComponentes`: de cada producto, lo que mira la regla del componente (`rechazoDeComponenteDeCombo`, `core/pos`: tipo, ancla, precio de la empresa, receta vigente en la
 *    sucursal o stock propio), su alícuota de IVA y lo que admite de opciones (para validar una configuración fija). Lecturas agrupadas, no por producto.
 *  - `cargarAlicuotasPosiblesDePromo`: las alícuotas de TODOS los componentes que un combo puede llegar a tener (D-2: no se mezclan alícuotas declaradas distintas): los productos de las secciones de
 *    sus cupos de sección (visibles en la carta de las sucursales pedidas, sueltos u opciones de un ítem agrupado activo), las entradas activas de sus listas y los platos del día
 *    activos de hoy en adelante.
 *
 * Un id que no se ve desde esta empresa no aparece (RLS): quien llama lo trata como inexistente.
 */

/** La alícuota declarada (el CHECK de la base garantiza la lista; acá se comprueba igual) o `null` = sin declarar. */
function alicuotaDe(valor: string | null): AlicuotaIva | null {
  return valor !== null && (ALICUOTAS_IVA as readonly string[]).includes(valor) ? (valor as AlicuotaIva) : null;
}

export interface ProductoComponenteLeido {
  id: string;
  nombre: string;
  tipo: string;
  /** `Producto.precioVenta` (el de la empresa). */
  precioVenta: number;
  seProduce: boolean;
  alicuota: AlicuotaIva | null;
  esAnclaDeAdicional: boolean;
  /** Ingredientes de la receta vigente en la sucursal pedida (0 = sin receta). */
  ingredientesDeLaRecetaVigente: number;
  /** Lo que admite de opciones (en la sucursal pedida). */
  opciones: OpcionesDeProducto;
}

export async function cargarProductosComoComponentes(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; productoIds: readonly string[] },
): Promise<Map<string, ProductoComponenteLeido>> {
  const ids = [...new Set(args.productoIds)];
  if (ids.length === 0) return new Map();
  const productos = await tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, tipo: true, precioVenta: true, seProduce: true, alicuotaIvaVenta: true } });
  const origen = await cargarOrigenDeStockParaVender(tx, { sucursalId: args.sucursalId, productoIds: ids });
  const opciones = await cargarOpcionesParaVender(tx, { sucursalId: args.sucursalId, productoIds: ids });
  return new Map(
    productos.map((p) => {
      const admite = opciones.get(p.id) ?? { grupos: [], anclaDeOpcionId: null, esBase: false };
      return [
        p.id,
        {
          id: p.id,
          nombre: p.nombre,
          tipo: p.tipo,
          precioVenta: Number(p.precioVenta),
          seProduce: p.seProduce,
          alicuota: alicuotaDe(p.alicuotaIvaVenta),
          esAnclaDeAdicional: admite.anclaDeOpcionId !== null,
          ingredientesDeLaRecetaVigente: origen.get(p.id)?.ingredientesDeLaRecetaVigente ?? 0,
          opciones: admite,
        },
      ];
    }),
  );
}

/** GO-3b (I2): la alícuota de IVA de cada producto pedido (los componentes ELEGIDOS de un combo, para D-2 al vender), en una consulta. */
export async function cargarAlicuotasDeProductos(tx: Prisma.TransactionClient, productoIds: readonly string[]): Promise<Map<string, ComponenteConAlicuota>> {
  const ids = [...new Set(productoIds)];
  if (ids.length === 0) return new Map();
  const productos = await tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, alicuotaIvaVenta: true } });
  return new Map(productos.map((p) => [p.id, { productoId: p.id, nombre: p.nombre, alicuota: alicuotaDe(p.alicuotaIvaVenta) }]));
}

/** Los lugares de un combo cuyos componentes posibles se miran (los de la promo, o los que se están por guardar). */
export interface LugaresDeCombo {
  seccionCartaIds: readonly string[];
  cupoListaIds: readonly string[];
  cupoDelDiaIds: readonly string[];
}

/**
 * `sucursalIds`: las cartas que se miran para los lugares de sección (la carta es PROPIA de cada sucursal; cada lectura lleva su `whereCartaDeSucursal`): en la administración de la empresa,
 * todas las de la empresa (`sucursalesDeLaEmpresa`); en la de la sucursal, la suya.
 */
export async function cargarAlicuotasPosiblesDeLugares(
  tx: Prisma.TransactionClient,
  lugares: LugaresDeCombo,
  args: { desdeDia: string; sucursalIds: readonly string[] },
): Promise<ComponenteConAlicuota[]> {
  const { desdeDia } = args;
  const productoIds = new Set<string>();
  if (lugares.seccionCartaIds.length) {
    const secciones = [...lugares.seccionCartaIds];
    for (const sucursalId of args.sucursalIds) {
      const sueltos = await tx.contenidoCartaProducto.findMany({ where: { ...whereCartaDeSucursal(sucursalId), seccionCartaId: { in: secciones }, visibleEnCarta: true }, select: { productoId: true } });
      for (const c of sueltos) productoIds.add(c.productoId);
      const agrupados = await tx.opcionItemAgrupadoCarta.findMany({ where: { ...whereCartaDeSucursal(sucursalId), itemAgrupadoCarta: { seccionCartaId: { in: secciones }, activo: true } }, select: { productoId: true } });
      for (const o of agrupados) productoIds.add(o.productoId);
    }
  }
  if (lugares.cupoListaIds.length) {
    for (const e of await tx.entradaDeCupo.findMany({ where: { cupoId: { in: [...lugares.cupoListaIds] }, activa: true }, select: { productoId: true } })) productoIds.add(e.productoId);
  }
  if (lugares.cupoDelDiaIds.length) {
    const desde = fechaDeColumnaDate(desdeDia);
    for (const e of await tx.entradaDelDiaDeCupo.findMany({ where: { cupoId: { in: [...lugares.cupoDelDiaIds] }, activa: true, fecha: { gte: desde } }, select: { productoId: true } })) {
      productoIds.add(e.productoId);
    }
  }
  if (productoIds.size === 0) return [];
  const productos = await tx.producto.findMany({ where: { id: { in: [...productoIds] } }, select: { id: true, nombre: true, alicuotaIvaVenta: true }, orderBy: { id: "asc" } });
  return productos.map((p) => ({ productoId: p.id, nombre: p.nombre, alicuota: alicuotaDe(p.alicuotaIvaVenta) }));
}

/** Las sucursales de la empresa (para mirar la carta de todas al decidir lo de la empresa). */
export async function sucursalesDeLaEmpresa(tx: Prisma.TransactionClient, empresaId: string): Promise<string[]> {
  return (await tx.sucursal.findMany({ where: { empresaId }, select: { id: true }, orderBy: { id: "asc" } })).map((s) => s.id);
}

/** Los lugares ACTIVOS de una promo (para mirar las alícuotas de todo lo que puede llegar a tener). */
export async function cargarLugaresActivosDePromo(tx: Prisma.TransactionClient, promoCartaId: string): Promise<LugaresDeCombo> {
  const cupos = await tx.promoCartaCupo.findMany({ where: { promoCartaId, activo: true }, select: { id: true, tipo: true, seccionCartaId: true } });
  return {
    seccionCartaIds: cupos.flatMap((c) => (c.tipo === "SECCION" && c.seccionCartaId !== null ? [c.seccionCartaId] : [])),
    cupoListaIds: cupos.filter((c) => c.tipo === "LISTA").map((c) => c.id),
    cupoDelDiaIds: cupos.filter((c) => c.tipo === "DEL_DIA").map((c) => c.id),
  };
}
