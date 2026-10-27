import "server-only";
import { diaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import type { CombosDeLaCarta, LugarDeCombo, ProductoParaEntrada } from "@/core/carta/public";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import type { Db } from "@/lib/db-tipos";

/**
 * La CONSULTA de los COMBOS de la carta (GO-3b, ADR-032, F6 paso U1), aparte de `cargarAdminCarta` (que sigue igual: su forma la fija una caracterización): de cada promo, sus lugares de ENTRADAS
 * activos (LISTA y DEL_DIA) con las entradas de cada lista (activas o no, con el nombre de su configuración) y su vigencia con la versión que vio la pantalla; y los productos de venta de la
 * empresa que se pueden sumar a una lista, con los grupos de una sola elección que admiten (para fijar su configuración: el tamaño, la variante). Las entradas son de la EMPRESA; lo que valida si un
 * producto puede ser componente lo decide el servidor al agregarlo. Sin guarda de permiso adentro: la página la pone antes (`carta`). Tres consultas más la de las opciones.
 */
export async function cargarCombosDeLaCarta(db: Db, sucursalId: string): Promise<CombosDeLaCarta> {
  const [promos, pvs] = await Promise.all([
    db.promoCarta.findMany({
      select: {
        id: true,
        version: true,
        soloSalon: true,
        vigenteDesde: true,
        vigenteHasta: true,
        diasDeSemana: true,
        cupos: {
          where: { activo: true, tipo: { in: ["LISTA", "DEL_DIA"] } },
          orderBy: [{ orden: "asc" }, { id: "asc" }],
          select: {
            id: true,
            tipo: true,
            nombre: true,
            cantidadMinima: true,
            cantidadMaxima: true,
            orden: true,
            entradas: {
              orderBy: [{ orden: "asc" }, { creadoEn: "asc" }, { id: "asc" }],
              select: { id: true, activa: true, productoId: true, producto: { select: { nombre: true } }, opciones: { orderBy: [{ creadoEn: "asc" }, { id: "asc" }], select: { cantidad: true, opcion: { select: { nombre: true } } } } },
            },
          },
        },
      },
    }),
    db.producto.findMany({ where: { tipo: "PV" }, orderBy: [{ nombre: "asc" }, { id: "asc" }], select: { id: true, nombre: true } }),
  ]);
  const opciones = await cargarOpcionesParaVender(db, { sucursalId, productoIds: pvs.map((p) => p.id) });
  const productos: ProductoParaEntrada[] = pvs.flatMap((p) => {
    const admite = opciones.get(p.id);
    // El ancla de un adicional no entra a un combo (se vende solo como adicional).
    if (admite?.anclaDeOpcionId) return [];
    const grupos = (admite?.grupos ?? [])
      .filter((g) => g.admitido && g.activo && g.tipo !== "ADICIONAL" && g.cantidadMaxima === 1)
      .map((g) => ({ grupoId: g.grupoId, nombre: g.nombre, obligatorio: g.cantidadMinima > 0, opciones: g.opciones.filter((o) => o.activa && o.admitida).map((o) => ({ opcionId: o.opcionId, nombre: o.nombre })) }));
    return [{ productoId: p.id, nombre: p.nombre, grupos }];
  });
  const porPromo: CombosDeLaCarta["porPromo"] = {};
  for (const pr of promos) {
    const lugares: LugarDeCombo[] = pr.cupos.map((c) => ({
      id: c.id,
      tipo: c.tipo as LugarDeCombo["tipo"],
      nombre: c.nombre ?? "",
      cantidadMinima: c.cantidadMinima,
      cantidadMaxima: c.cantidadMaxima,
      orden: c.orden,
      entradas: c.entradas.map((e) => ({
        id: e.id,
        activa: e.activa,
        productoId: e.productoId,
        nombre: [e.producto.nombre, ...e.opciones.map((o) => (o.cantidad > 1 ? `${o.opcion.nombre} ×${o.cantidad}` : o.opcion.nombre))].join(" · "),
      })),
    }));
    porPromo[pr.id] = {
      soloSalon: pr.soloSalon,
      lugares,
      vigencia: {
        version: pr.version,
        vigenteDesde: pr.vigenteDesde ? diaDeColumnaDate(pr.vigenteDesde) : null,
        vigenteHasta: pr.vigenteHasta ? diaDeColumnaDate(pr.vigenteHasta) : null,
        diasDeSemana: pr.diasDeSemana,
      },
    };
  }
  return { porPromo, productos };
}
