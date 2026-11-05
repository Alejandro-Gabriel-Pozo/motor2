import "server-only";
import { diaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { whereCartaDeSucursal, type CombosDeLaCarta, type LugarDeCombo, type ProductoParaEntrada } from "@/core/carta/public";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import type { Db } from "@/lib/db-tipos";

/**
 * La CONSULTA de los COMBOS de la carta (GO-3b, ADR-032, F6 paso U1), aparte de `cargarAdminCarta` (que sigue igual: su forma la fija una caracterización): de cada promo, sus lugares de ENTRADAS
 * activos (LISTA y DEL_DIA) con las entradas de cada lista (activas o no, con el nombre de su configuración) y su vigencia con la versión que vio la pantalla; y los productos de venta de la
 * empresa que se pueden sumar a una lista, con los grupos de una sola elección que admiten (para fijar su configuración: el tamaño, la variante). Las entradas son de la EMPRESA; lo que valida si un
 * producto puede ser componente lo decide el servidor al agregarlo. Sin guarda de permiso adentro: la página la pone antes (`carta`). Cuatro consultas más la de las opciones (la última, de dónde sale cada producto en la carta de ESTA sucursal: la fuente para tildar al armar un lugar, no una regla).
 */
export async function cargarCombosDeLaCarta(db: Db, sucursalId: string): Promise<CombosDeLaCarta> {
  const [promos, pvs, enSeccion, enItemAgrupado] = await Promise.all([
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
              select: { id: true, activa: true, productoId: true, modoDeOpciones: true, producto: { select: { nombre: true } }, opciones: { orderBy: [{ creadoEn: "asc" }, { id: "asc" }], select: { cantidad: true, opcion: { select: { nombre: true } } } } },
            },
          },
        },
      },
    }),
    db.producto.findMany({ where: { tipo: "PV" }, orderBy: [{ nombre: "asc" }, { id: "asc" }], select: { id: true, nombre: true, categoria: { select: { id: true, nombre: true } } } }),
    // El origen de cada producto (la sección de la carta de ESTA sucursal): suelto o dentro de un ítem agrupado. Un producto fuera de ambos «no está en la carta».
    db.contenidoCartaProducto.findMany({ where: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true, seccionCartaId: { not: null } }, select: { productoId: true, seccionCartaId: true } }),
    db.opcionItemAgrupadoCarta.findMany({ where: { ...whereCartaDeSucursal(sucursalId), itemAgrupadoCarta: { activo: true } }, select: { productoId: true, itemAgrupadoCarta: { select: { seccionCartaId: true } } } }),
  ]);
  const seccionDe = new Map<string, string>();
  for (const c of enSeccion) if (c.seccionCartaId) seccionDe.set(c.productoId, c.seccionCartaId);
  // Un producto dentro de un ítem agrupado sale en la sección del ítem, nunca suelto (D3 de la carta): el ítem manda sobre su contenido.
  for (const a of enItemAgrupado) seccionDe.set(a.productoId, a.itemAgrupadoCarta.seccionCartaId);
  const opciones = await cargarOpcionesParaVender(db, { sucursalId, productoIds: pvs.map((p) => p.id) });
  const productos: ProductoParaEntrada[] = pvs.flatMap((p) => {
    const admite = opciones.get(p.id);
    // El ancla de un adicional no entra a un combo (se vende solo como adicional).
    if (admite?.anclaDeOpcionId) return [];
    const grupos = (admite?.grupos ?? [])
      .filter((g) => g.admitido && g.activo && g.tipo !== "ADICIONAL" && g.cantidadMaxima === 1)
      .map((g) => ({ grupoId: g.grupoId, nombre: g.nombre, obligatorio: g.cantidadMinima > 0, opciones: g.opciones.filter((o) => o.activa && o.admitida).map((o) => ({ opcionId: o.opcionId, nombre: o.nombre })) }));
    // «El mozo elige»: todos los grupos que admite (con los límites del grupo, solo para mostrar) y sus opciones activas; el ADICIONAL va marcado (no entra en una promo de precio fijo).
    const gruposAElegir = (admite?.grupos ?? [])
      .filter((g) => g.admitido && g.activo)
      .map((g) => ({
        grupoId: g.grupoId,
        nombre: g.nombre,
        adicional: g.tipo === "ADICIONAL",
        cantidadMinima: g.cantidadMinima,
        cantidadMaxima: g.cantidadMaxima,
        opciones: g.opciones.filter((o) => o.activa && o.admitida).map((o) => ({ opcionId: o.opcionId, nombre: o.nombre })),
      }));
    return [{ productoId: p.id, nombre: p.nombre, grupos, seccionCartaId: seccionDe.get(p.id) ?? null, categoria: p.categoria, gruposAElegir }];
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
        // «el mozo elige»: las opciones de la entrada son las PERMITIDAS (sin sus unidades: el tope es el de los límites del grupo).
        nombre:
          e.modoDeOpciones === "A_ELEGIR"
            ? `${e.producto.nombre} · el mozo elige entre: ${e.opciones.map((o) => o.opcion.nombre).join(", ")}`
            : [e.producto.nombre, ...e.opciones.map((o) => (o.cantidad > 1 ? `${o.opcion.nombre} ×${o.cantidad}` : o.opcion.nombre))].join(" · "),
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
