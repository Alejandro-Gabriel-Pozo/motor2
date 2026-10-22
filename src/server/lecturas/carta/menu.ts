import { precioLocalActivoEn, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { armarMenuCarta, precioDeCarta, precioDePromo, seleccionDeSucursalDePromo, whereCartaDeSucursal, wherePromoOfrecidaEn, type CartaV1, type MenuArmado } from "@/core/carta/public";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { opcionesDeLosProductosDeLaCarta, type GrupoParaLaCarta } from "@/server/lecturas/carta/opciones";
import { preciosLocalesDeOpcionVigentesEnProductos } from "@/server/lecturas/catalogo/precio-local-de-opciones";
import { esBaseConfigurable } from "@/core/opciones/public";
import { resumenDePrecios, tablaDePreciosParaLaCarta } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Capa de LECTURA de la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M3) — separada de `armar-menu.ts` (puro)
 * por el mismo motivo que `disponibilidad-producto-consulta.ts`: nunca mezclar Prisma con funciones puras.
 *
 * NUNCA ESCRIBE (lo fija test/arquitectura/carta-solo-lectura.test.ts): la carta es un espejo de solo lectura del
 * catálogo. Qué entra:
 *  - PV disponibles en la sucursal — con `whereDisponibleEn`, el único lugar que escribe ese filtro ("fila ausente = no
 *    disponible", guardián disponibilidad-en-un-solo-lugar.test.ts);
 *  - y con `ContenidoCartaProducto.visibleEnCarta` en true EN LA CARTA PROPIA DE ESTA SUCURSAL (sin fila de contenido = no se muestra, decisión D3;
 *    una sucursal sin carta propia no muestra nada: ADR-009, C3);
 *  - con el precio local habilitado de la sucursal si lo hay (la regla la aplica `precioDeCarta`);
 *  - ubicados DIRECTO en las secciones de carta ACTIVAS, cada uno por su `seccionCartaId` (docs/plan-carta-seccion-directa-2026-09-25.md;
 *    la Categoría de producto solo viaja como texto informativo);
 *  - más las promos ofrecidas en ESTA sucursal (activas en la empresa y prendidas acá), con su precio local si lo tienen;
 *  - más los ítems AGRUPADOS activos (docs/plan-agrupacion-items-carta-2026-09-24.md, M3), cada uno con sus opciones PV
 *    disponibles acá. Un producto que es opción de un ítem agrupado NO entra como suelto (D3), esté prendido o apagado su
 *    grupo: apagar "Gaseosa 500cc" no hace aparecer tres gaseosas sueltas.
 *
 * Una sucursal inexistente o inactiva da `null` (el endpoint responde 404 igual en los dos casos, para no revelar cuál).
 */
export async function resolverMenuCartaConDiagnostico(
  sucursalId: string,
  db: Db,
  /**
   * La hora de la carta (O.22-c de docs/pureza-integracion.md): obligatoria, sin valor por defecto, la fija el borde (la página, la carta pública sin sesión
   * o el caso de uso con `actor.ahora`). Solo alimenta `generadoEn`; no decide qué entra en la carta.
   */
  ahora: Date,
  /** La capacidad `precio_local` de ESTA sucursal ya leída (o la promesa de esa lectura), para no volver a leerla (el selector del POS la comparte, O.39). */
  precioLocalActivoCargado?: boolean | Promise<boolean>,
  /** `false` = no leer ni armar las promos (la carta pública de una empresa sin el módulo Promociones, S-23). Por defecto sí: el POS y el admin deciden por su cuenta. */
  conPromos = true,
  /**
   * GO-2d (ADR-030): `true` = leer las opciones de venta de los PV y mostrarlas (la carta pública: tamaños, variantes, guarniciones y adicionales, con los precios de la regla de la
   * venta; lo agotado no sale, y un PV que hoy no se puede pedir tampoco). Por defecto no: el POS arma su propio diálogo y el admin ve la carta como siempre.
   */
  conOpciones = false
): Promise<MenuArmado | null> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true, activo: true, empresaId: true } });
  if (!sucursal || !sucursal.activo) return null;
  // Filtro explícito por la empresa de la sucursal, además del RLS: con un rol que lo salta, secciones/promos/agrupados no se mezclan entre empresas.
  const { empresaId } = sucursal;

  const [productos, secciones, promos, agrupados] = await Promise.all([
    db.producto.findMany({
      where: { empresaId, tipo: "PV", ...whereDisponibleEn(sucursalId), contenidosCarta: { some: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true } }, opcionesItemAgrupadoCarta: { none: whereCartaDeSucursal(sucursalId) } },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        modoDeVenta: true,
        categoria: { select: { nombre: true } },
        contenidosCarta: { where: whereCartaDeSucursal(sucursalId), select: { seccionCartaId: true, descripcion: true, tags: true, especial: true, orden: true, mostrarNombreArriba: true }, take: 1 },
        // GO-2d: si admite algún grupo de opciones (en la misma consulta): solo esos se leen después, así una carta sin opciones hace las mismas consultas que antes.
        gruposAdmitidos: { where: { activo: true }, select: { id: true }, take: 1 },
      },
    }),
    db.seccionCarta.findMany({
      where: { empresaId, activa: true },
      select: {
        id: true,
        nombre: true,
        titulo: true,
        descripcion: true,
        imagenUrl: true,
        orden: true,
      },
    }),
    conPromos
      ? db.promoCarta.findMany({
          where: { empresaId, ...wherePromoOfrecidaEn(sucursalId) },
          select: { id: true, seccionCartaId: true, titulo: true, descripcion: true, precio: true, orden: true, sucursales: seleccionDeSucursalDePromo(sucursalId) },
        })
      : Promise.resolve([]),
    db.itemAgrupadoCarta.findMany({
      where: { empresaId, activo: true, ...whereCartaDeSucursal(sucursalId) },
      select: {
        id: true,
        nombre: true,
        seccionCartaId: true,
        descripcion: true,
        tags: true,
        especial: true,
        orden: true,
        opciones: {
          where: { producto: { tipo: "PV", ...whereDisponibleEn(sucursalId) } },
          select: { orden: true, producto: { select: { id: true, nombre: true, precioVenta: true } } },
        },
      },
    }),
  ]);

  const idsConPrecio = [...new Set([...productos.map((p) => p.id), ...agrupados.flatMap((ag) => ag.opciones.map((o) => o.producto.id))])];
  // La capacidad `precio_local` se lee UNA vez y la usan los tres (precios locales, descuentos y precio de las promos): antes la leía cada uno (O.39).
  const precioLocalActivoLeido = precioLocalActivoCargado ?? precioLocalActivoEn(sucursalId, db);
  const conGrupos = conOpciones ? productos.filter((p) => p.gruposAdmitidos.length > 0).map((p) => p.id) : [];
  const [preciosLocales, descuentos, precioLocalActivo, opcionesLeidas, grillaDeTamanos] = await Promise.all([
    preciosLocalesVigentes(sucursalId, db, idsConPrecio, precioLocalActivoLeido),
    descuentosDeProductoEnSucursal(sucursalId, db, productos.map((p) => p.id), precioLocalActivoLeido),
    precioLocalActivoLeido,
    conGrupos.length ? opcionesDeLosProductosDeLaCarta(db, sucursalId, conGrupos) : Promise.resolve(new Map<string, GrupoParaLaCarta[]>()),
    conGrupos.length ? preciosLocalesDeOpcionVigentesEnProductos(sucursalId, db, conGrupos, precioLocalActivoLeido) : Promise.resolve(new Map<string, number>()),
  ]);
  // GO-2d: el resumen de precios de cada PV con opciones (la regla de la venta), con y sin el descuento de producto; el precio base es el mismo que la carta muestra del producto suelto.
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  // Fase 5, paso 10b (DEC-20): con `sinAgotadoHoy` arma lo mismo como si nada estuviera agotado HOY en la sucursal (la carta impresa sale completa); lo demás que no se puede pedir sigue afuera.
  const armarOpcionesDeProductos = (sinAgotadoHoy: boolean) => {
    const opcionesDeProductos = [...opcionesLeidas].flatMap(([productoId, gruposLeidos]) => {
      const p = productoPorId.get(productoId);
      if (!p || !gruposLeidos.some((g) => g.admitido && g.activo)) return [];
      const grupos = gruposLeidos
        .map((g) => (sinAgotadoHoy ? { ...g, opciones: g.opciones.map((o) => ({ ...o, apagadaEnSucursal: false })) } : g))
        .map((g) =>
          g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO" ? { ...g, opciones: g.opciones.map((o) => ({ ...o, precioDeSucursal: grillaDeTamanos.get(`${productoId}|${o.opcionId}`) ?? null })) } : g
        );
      const local = preciosLocales.get(productoId);
      const precioBase = precioDeCarta(Number(p.precioVenta), local ? { precio: local.precio, habilitado: local.habilitado } : null);
      const esBase = esBaseConfigurable(p.modoDeVenta);
      const descuentoDeProducto = descuentos.get(productoId) ?? null;
      return [
        {
          productoId,
          conDescuento: resumenDePrecios({ grupos, precioBase, descuentoDeProducto, esBase }),
          sinDescuento: resumenDePrecios({ grupos, precioBase, descuentoDeProducto: null, esBase }),
          // Fase 5 («carta pareja»): el precio de cada celda de la carta, con la misma regla (y el mismo descuento) que se cobra.
          tabla: tablaDePreciosParaLaCarta({ grupos, precioBase, descuentoDeProducto, esBase }),
          esBase,
        },
      ];
    });
    // Fase 4 (ADR-035): una base sin ningún grupo vigente (quitado o archivado) no sale en la carta con su precio guardado: falla cerrado, como un grupo obligatorio sin opciones.
    const conResumen = new Set(opcionesDeProductos.map((o) => o.productoId));
    for (const p of conOpciones ? productos : []) {
      if (!esBaseConfigurable(p.modoDeVenta) || conResumen.has(p.id)) continue;
      const sinPrecio = resumenDePrecios({ grupos: [], precioBase: 0, descuentoDeProducto: null, esBase: true });
      opcionesDeProductos.push({ productoId: p.id, conDescuento: sinPrecio, sinDescuento: sinPrecio, tabla: null, esBase: true });
    }
    return opcionesDeProductos;
  };
  const opcionesDeProductos = armarOpcionesDeProductos(false);

  const entrada: Parameters<typeof armarMenuCarta>[0] = {
    sucursal: { id: sucursal.id, nombre: sucursal.nombre },
    generadoEn: ahora,
    secciones,
    productos: productos.flatMap((p) =>
      // El `where` ya exige la fila de contenido de ESTA sucursal; el guard es solo para el tipo.
      p.contenidosCarta[0]
        ? [
            {
              id: p.id,
              nombre: p.nombre,
              precioVenta: Number(p.precioVenta),
              categoriaNombre: p.categoria?.nombre ?? null,
              seccionCartaId: p.contenidosCarta[0].seccionCartaId,
              contenido: p.contenidosCarta[0],
            },
          ]
        : []
    ),
    preciosLocales: [...preciosLocales].map(([productoId, pl]) => ({ productoId, precio: pl.precio, habilitado: pl.habilitado })),
    descuentos: [...descuentos].map(([productoId, porcentaje]) => ({ productoId, porcentaje })),
    promos: promos.map(({ sucursales, ...pr }) => ({ ...pr, precio: precioDePromo(pr.precio, sucursales[0], precioLocalActivo) })),
    agrupados: agrupados.map((ag) => ({
      id: ag.id,
      nombre: ag.nombre,
      seccionCartaId: ag.seccionCartaId,
      contenido: { descripcion: ag.descripcion, tags: ag.tags, especial: ag.especial, orden: ag.orden },
      opciones: ag.opciones.map((o) => ({ productoId: o.producto.id, nombre: o.producto.nombre, precioVenta: Number(o.producto.precioVenta), orden: o.orden })),
    })),
    ...(conOpciones ? { opcionesDeProductos } : {}),
  };
  const armado = armarMenuCarta(entrada);
  // Fase 5, paso 10b (DEC-20, decisión del dueño): la carta IMPRESA sale COMPLETA, sin lo «agotado hoy» (una opción apagada hoy en la sucursal: su fila, su celda y, si era la única de un grupo
  // obligatorio, el plato entero). Solo si hoy hay algo agotado y cambia lo que se ve: entonces viaja aparte (`seccionesImpresas`) y la página la muestra solo en papel. Un plato entero sin stock hoy
  // (la disponibilidad del producto en la sucursal) no entra: la base no distingue «sin stock hoy» de «no se vende acá».
  const hayAgotadoHoy = [...opcionesLeidas.values()].some((grupos) => grupos.some((g) => g.opciones.some((o) => o.apagadaEnSucursal)));
  if (!conOpciones || !hayAgotadoHoy) return armado;
  const completo = armarMenuCarta({ ...entrada, opcionesDeProductos: armarOpcionesDeProductos(true) });
  if (JSON.stringify(completo.carta.secciones) === JSON.stringify(armado.carta.secciones)) return armado;
  return { ...armado, carta: { ...armado.carta, seccionesImpresas: completo.carta.secciones } };
}

/** La carta pública de una sucursal, tal como la consume la página pública (sin el diagnóstico interno). `ahora` obligatorio (O.22-c): ver arriba. */
export async function resolverMenuCarta(
  sucursalId: string,
  db: Db,
  ahora: Date,
  precioLocalActivoCargado?: boolean | Promise<boolean>,
  conPromos = true,
  /** GO-2d: ver `resolverMenuCartaConDiagnostico` (solo la carta pública lo pide). */
  conOpciones = false
): Promise<CartaV1 | null> {
  const armado = await resolverMenuCartaConDiagnostico(sucursalId, db, ahora, precioLocalActivoCargado, conPromos, conOpciones);
  return armado ? armado.carta : null;
}
