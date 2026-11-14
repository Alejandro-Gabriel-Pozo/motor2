import "server-only";
import { GENERO_E_ITEM_AGRUPADO_VISIBLE, nombreParaMostrar, whereCartaDeSucursal, type CombosDeLaCarta, type LugarDeCombo, type ProductoParaEntrada } from "@/core/carta/public";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import type { Db } from "@/lib/db-tipos";
import { grupoVigente, opcionOfrecida } from "@/core/opciones/public";

/**
 * La CONSULTA de los COMBOS de la carta (GO-3b, ADR-032, F6 paso U1), aparte de `cargarAdminCarta` (que sigue igual: su forma la fija una caracterización): de cada promo, sus lugares de ENTRADAS
 * activos (LISTA) con las entradas de cada lista (activas o no, con el nombre de su configuración) y la versión que vio la pantalla; y los productos de venta de la
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
        cupos: {
          where: { activo: true, tipo: "LISTA" },
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
    db.contenidoCartaProducto.findMany({ where: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true, seccionCartaId: { not: null } }, select: { productoId: true, seccionCartaId: true, nombreEnCarta: true, mostrarNombreArriba: true } }),
    // Interruptor de ítem agrupado apagado (`GENERO_E_ITEM_AGRUPADO_VISIBLE`): la carta ignora los agrupados, así que no hay origen «dentro de un ítem agrupado».
    GENERO_E_ITEM_AGRUPADO_VISIBLE ? db.opcionItemAgrupadoCarta.findMany({ where: { ...whereCartaDeSucursal(sucursalId), itemAgrupadoCarta: { activo: true } }, select: { productoId: true, itemAgrupadoCarta: { select: { seccionCartaId: true } } } }) : Promise.resolve([]),
  ]);
  const seccionDe = new Map<string, string>();
  for (const c of enSeccion) if (c.seccionCartaId) seccionDe.set(c.productoId, c.seccionCartaId);
  // Un producto dentro de un ítem agrupado sale en la sección del ítem, nunca suelto (D3 de la carta): el ítem manda sobre su contenido.
  for (const a of enItemAgrupado) seccionDe.set(a.productoId, a.itemAgrupadoCarta.seccionCartaId);
  const opciones = await cargarOpcionesParaVender(db, { sucursalId, productoIds: pvs.map((p) => p.id) });
  // El prefijo de lectura en la carta de cada grupo MEDIDA (para el nombre para mostrar de una base con el nombre oculto).
  const medidaIds = [...new Set([...opciones.values()].flatMap((o) => (o.esBase ? o.grupos.filter((g) => g.tipo === "MEDIDA" && grupoVigente(g)).map((g) => g.grupoId) : [])))];
  const prefijos = new Map((await db.grupoDeOpciones.findMany({ where: { id: { in: medidaIds } }, select: { id: true, prefijoEnCarta: true } })).map((g) => [g.id, g.prefijoEnCarta] as const));
  const contenidoDe = new Map(enSeccion.map((c) => [c.productoId, c] as const));
  const nombreDe = (p: { id: string; nombre: string }): string => {
    const admite = opciones.get(p.id);
    const medida = admite?.grupos.find((g) => g.tipo === "MEDIDA" && grupoVigente(g));
    return nombreParaMostrar({
      nombre: p.nombre,
      nombreEnCarta: contenidoDe.get(p.id)?.nombreEnCarta ?? null,
      esBase: admite?.esBase ?? false,
      mostrarNombreArriba: contenidoDe.get(p.id)?.mostrarNombreArriba ?? false,
      medida: medida ? { prefijoEnCarta: prefijos.get(medida.grupoId) ?? null, opciones: medida.opciones.filter(opcionOfrecida) } : null,
    });
  };
  const nombreParaMostrarPorProducto = new Map(pvs.map((p) => [p.id, nombreDe(p)] as const));
  const productos: ProductoParaEntrada[] = pvs.flatMap((p) => {
    const admite = opciones.get(p.id);
    // El ancla de un adicional no entra a un combo (se vende solo como adicional).
    if (admite?.anclaDeOpcionId) return [];
    const grupos = (admite?.grupos ?? [])
      .filter((g) => grupoVigente(g) && g.tipo !== "ADICIONAL" && g.cantidadMaxima === 1)
      .map((g) => ({ grupoId: g.grupoId, nombre: g.nombre, obligatorio: g.cantidadMinima > 0, opciones: g.opciones.filter(opcionOfrecida).map((o) => ({ opcionId: o.opcionId, nombre: o.nombre })) }));
    // «El mozo elige»: todos los grupos que admite (con los límites del grupo, solo para mostrar) y sus opciones activas; el ADICIONAL va marcado (no entra en una promo de precio fijo).
    const gruposAElegir = (admite?.grupos ?? [])
      .filter(grupoVigente)
      .map((g) => ({
        grupoId: g.grupoId,
        nombre: g.nombre,
        adicional: g.tipo === "ADICIONAL",
        cantidadMinima: g.cantidadMinima,
        cantidadMaxima: g.cantidadMaxima,
        opciones: g.opciones.filter(opcionOfrecida).map((o) => ({ opcionId: o.opcionId, nombre: o.nombre })),
      }));
    return [{ productoId: p.id, nombre: p.nombre, nombreParaMostrar: nombreParaMostrarPorProducto.get(p.id)!, grupos, seccionCartaId: seccionDe.get(p.id) ?? null, categoria: p.categoria, gruposAElegir }];
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
        modoDeOpciones: e.modoDeOpciones as "FIJAS" | "A_ELEGIR",
        // «el mozo elige»: las opciones de la entrada son las PERMITIDAS (sin sus unidades: el tope es el de los límites del grupo).
        nombre:
          e.modoDeOpciones === "A_ELEGIR"
            ? `${nombreParaMostrarPorProducto.get(e.productoId) ?? e.producto.nombre} · el mozo elige entre: ${e.opciones.map((o) => o.opcion.nombre).join(", ")}`
            : [nombreParaMostrarPorProducto.get(e.productoId) ?? e.producto.nombre, ...e.opciones.map((o) => (o.cantidad > 1 ? `${o.opcion.nombre} ×${o.cantidad}` : o.opcion.nombre))].join(" · "),
      })),
    }));
    porPromo[pr.id] = {
      soloSalon: pr.soloSalon,
      lugares,
      version: pr.version,
    };
  }
  return { porPromo, productos };
}
