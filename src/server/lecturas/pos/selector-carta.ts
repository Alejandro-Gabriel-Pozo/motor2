import "server-only";
import { precioLocalActivoEn, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { WHERE_CUPO_ACTIVO_DE_TIPO_NUEVO, WHERE_CUPO_DE_SECCION_ACTIVO, aplicarDescuentoDeProducto, cuposDeSeccionActivos, precioDeCarta, precioDePromo, promoVigenteEl, seleccionDeSucursalDePromo, wherePromoOfrecidaEn, whereCartaDeSucursal } from "@/core/carta/public";
import { diaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { cargarEntradasDePromoParaVender, type CupoDeEntradasLeido } from "@/server/lecturas/pos/entradas-de-promo-para-vender";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { resolverMenuCarta } from "@/server/lecturas/carta/menu";
import { modulosDelPosDeSucursal, type ModulosDelPos } from "@/server/lecturas/pos/modulos-del-pos";
import { tieneStockReal } from "@/core/movimientos/public";
import { armarSelectorCartaPos, esCupoFijo, type CupoDeEntradasSelectorCarta, type GenerosSelectorCartaPos, type ProductoPedible, type PromoSelectorCartaPos, type SelectorCartaPos } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Capa de LECTURA del selector por sección de carta del POS (docs/plan-selector-carta-pos-2026-09-25.md) y por carpeta de género
 * (docs/plan-genero-carta-2026-09-26.md) — separada de `selector-carta.ts` (puro) por el mismo motivo que `menu-consulta.ts`.
 * Solo lee. Vive en `server/lecturas/pos` (ADR-026: la leen la pantalla de la mesa Y la acción de agregar ítems, que la revalida) y no en `core`: es una
 * necesidad del salón que REUSA la carta sin tocarla (mismo criterio que `grupo-producto-consulta.ts`).
 *
 *  - La estructura: la carta pública de la sucursal, tal cual (`resolverMenuCarta`). Sucursal inactiva → `null` → todo a «Fuera de
 *    carta».
 *  - Los pedibles: los PV disponibles en la sucursal (`whereDisponibleEn`, el mismo filtro que el buscador del POS y que valida
 *    `agregarItems`), con el precio que se congelaría al agregarlos: Precio Local habilitado o, si no, el global (`precioDeCarta`,
 *    paridad con `resolverPrecioVenta`, fijada por test/pos/selector-carta-consulta.test.ts).
 *  - Los géneros: los ACTIVOS (uno apagado no forma carpeta: lo que tenía ese género sale suelto, sin error), con el género de
 *    cada `ContenidoCartaProducto` y de cada `ItemAgrupadoCarta` — SOLO interno del POS (G4): la carta pública (`resolverMenuCarta`
 *    / `CartaV1`) no lee `generoCartaId` en absoluto.
 *  - Las promos ARMABLES (Task #16, docs/plan-promo-combo-2026-09-26.md): las `PromoCarta` ofrecidas en la sucursal (activas en la empresa
 *    Y prendidas en esta sucursal, con su precio local si lo tienen) que tengan
 *    al menos un cupo (una promo informativa, sin cupos, se ignora acá — sigue siendo solo visual en la carta pública), con
 *    sus cupos tal cual (`PromoCartaCupo`); `armarSelectorCartaPos` resuelve los elegibles de cada cupo con los MISMOS
 *    pedibles que ya ubicó en la sección de ese cupo (D5) — esta consulta no busca elegibles por su cuenta.
 *
 *  - LO CONTRATADO (S-22 / D2, `modulos-del-pos.ts`): sin el módulo Carta no se lee nada de la carta (ni secciones, ni géneros, ni ítems agrupados, ni promos) y el selector
 *    es la lista plana de los PV disponibles; sin el módulo Promociones no se lee ninguna promo, ni el POS las ofrece ni las acepta. El precio de cada
 *    producto NO depende del módulo (sale del producto y del Precio Local), pero el DESCUENTO de producto sí: sin Carta no rige (P18 / D18, decisión del dueño 2026-10-11),
 *    igual que en `agregarItems`, que congela el mismo precio (paridad).
 *
 * La pantalla de la mesa la llama DESPUÉS de su guarda de Ver de `pos_mesas` (el mozo no tiene el permiso `carta`): no hace falta
 * ninguna Server Action nueva.
 */
export async function cargarSelectorCartaPos(
  sucursalId: string,
  db: Db,
  /** La hora de la carta (O.22-c): obligatoria, la fija quien llama; solo alimenta el `generadoEn` de la carta, que el selector descarta. */
  ahora: Date,
  /** La capacidad `precio_local` de ESTA sucursal ya leída (o la promesa de esa lectura): `cargarPromoCartaParaAgregar` la comparte con el selector (O.39). */
  precioLocalActivoCargado?: boolean | Promise<boolean>,
  /**
   * Los módulos de carta y promociones de la empresa ya leídos (S-22 / D2): quien ya los tiene (`agregarItems`, que además rechaza la promo con su propio mensaje) los
   * comparte para no leer el registro dos veces. Ausentes, SE LEEN acá: el selector nunca ofrece lo que la empresa no contrató, aunque quien lo llame no lo haya
   * preguntado (denegar por defecto).
   */
  modulosCargados?: ModulosDelPos,
  /**
   * GO-3b (ADR-032): el día de calendario de la zona de la empresa. CON él (la pantalla de la mesa) el selector ofrece también las promos con cupos de entradas (LISTA y DEL_DIA, con las entradas
   * elegibles HOY: la MISMA lectura que valida la venta) y deja afuera las que no valen ese día (su vigencia). SIN él (la lectura de la promo para agregar, que solo usa las secciones), lo de siempre.
   */
  dia?: string
): Promise<SelectorCartaPos> {
  const modulos = modulosCargados ?? (await modulosDelPosDeSucursal(sucursalId, db));
  // La capacidad `precio_local` se lee UNA vez (o se toma la de quien llama) y la usan todos: la carta, los precios locales, los descuentos y el precio de
  // las promos. Antes cada uno la leía por su cuenta: 6 lecturas de `capacidadSucursal` por carga del selector (O.39 de docs/pureza-integracion.md).
  // Se pasa la PROMESA, no el valor, para que todo siga saliendo en paralelo como antes.
  const precioLocalActivoLeido = precioLocalActivoCargado ?? precioLocalActivoEn(sucursalId, db);
  // S-22 / D2: la carta (secciones, géneros, ítems agrupados) y las promos (que viven en ella) se leen SOLO si la empresa las contrató. Sin Carta el selector es la lista
  // plana de los PV disponibles (`armarSelectorCartaPos` con `carta: null` los deja todos en «Fuera de carta»): el POS vende con los productos sueltos, sin carta. Las
  // listas vacías y el `null` son exactamente lo que da una empresa que nunca cargó una carta.
  const conCarta = modulos.carta;
  const conPromos = conCarta && modulos.promociones;
  const [carta, productos, preciosLocales, descuentos, precioLocalActivo, generosActivos, contenidosConGenero, agrupadosConGenero, promosCarta] = await Promise.all([
    conCarta ? resolverMenuCarta(sucursalId, db, ahora, precioLocalActivoLeido) : Promise.resolve(null),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId) },
      select: { id: true, codigo: true, nombre: true, precioVenta: true, pasoVenta: true, seProduce: true, unidadStock: { select: { decimales: true } } },
    }),
    preciosLocalesVigentes(sucursalId, db, undefined, precioLocalActivoLeido),
    // P18 / D18: el descuento de producto es de la Carta; sin el módulo no se lee y el precio mostrado es el de lista (el que `agregarItems` congela).
    conCarta ? descuentosDeProductoEnSucursal(sucursalId, db, undefined, precioLocalActivoLeido) : Promise.resolve(new Map<string, number>()),
    precioLocalActivoLeido,
    conCarta ? db.generoCarta.findMany({ where: { activo: true, ...whereCartaDeSucursal(sucursalId) }, select: { id: true, nombre: true, orden: true } }) : Promise.resolve([]),
    conCarta ? db.contenidoCartaProducto.findMany({ where: { generoCartaId: { not: null }, ...whereCartaDeSucursal(sucursalId) }, select: { productoId: true, generoCartaId: true } }) : Promise.resolve([]),
    conCarta ? db.itemAgrupadoCarta.findMany({ where: { generoCartaId: { not: null }, ...whereCartaDeSucursal(sucursalId) }, select: { id: true, generoCartaId: true } }) : Promise.resolve([]),
    // Sin el módulo Promociones no se lee ninguna promo (ni se ofrece ni se acepta).
    conPromos
      ? db.promoCarta.findMany({
          // GO-3 (primer despliegue): solo las promos con algún cupo de SECCIÓN activo y NINGÚN cupo activo de un tipo nuevo. GO-3b: con el día, las que tienen algún cupo activo de cualquier tipo.
          where:
            dia === undefined
              ? { ...wherePromoOfrecidaEn(sucursalId), cupos: { some: WHERE_CUPO_DE_SECCION_ACTIVO, none: WHERE_CUPO_ACTIVO_DE_TIPO_NUEVO } }
              : { ...wherePromoOfrecidaEn(sucursalId), cupos: { some: { activo: true } } },
          select: {
            id: true,
            seccionCartaId: true,
            titulo: true,
            precio: true,
            sucursales: seleccionDeSucursalDePromo(sucursalId),
            vigenteDesde: true,
            vigenteHasta: true,
            diasDeSemana: true,
            cupos: {
              orderBy: { orden: "asc" },
              where: dia === undefined ? WHERE_CUPO_DE_SECCION_ACTIVO : { activo: true },
              select: { id: true, tipo: true, nombre: true, activo: true, seccionCartaId: true, cantidadMinima: true, cantidadMaxima: true, seccionCarta: { select: { nombre: true } } },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const localPorProducto = preciosLocales;
  const pedibles: ProductoPedible[] = productos.map((p) => {
    // Producto con descuento (Fase 2): el precio del pedible es el DESCONTADO (el que se congela al agregar); el de lista queda aparte para mostrarlo tachado.
    const aplicado = aplicarDescuentoDeProducto(precioDeCarta(Number(p.precioVenta), localPorProducto.get(p.id)), descuentos.get(p.id) ?? null);
    return {
      productoId: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      precio: aplicado.precio,
      ...(aplicado.precioLista !== null ? { precioLista: aplicado.precioLista } : {}),
      decimales: p.unidadStock.decimales,
      pasoVenta: p.pasoVenta !== null ? Number(p.pasoVenta) : null,
      tieneStockReal: tieneStockReal("PV", p.seProduce),
    };
  });
  const generos: GenerosSelectorCartaPos = {
    generos: generosActivos,
    generoPorProducto: new Map(contenidosConGenero.map((c) => [c.productoId, c.generoCartaId!])),
    generoPorAgrupado: new Map(agrupadosConGenero.map((a) => [a.id, a.generoCartaId!])),
  };
  // GO-3b: con el día, solo las promos que valen hoy (su vigencia) y, de las que tienen cupos de entradas, sus entradas elegibles de hoy (la MISMA lectura que valida la venta).
  const promosDeHoy =
    dia === undefined
      ? promosCarta
      : promosCarta.filter((p) => promoVigenteEl({ vigenteDesde: p.vigenteDesde && diaDeColumnaDate(p.vigenteDesde), vigenteHasta: p.vigenteHasta && diaDeColumnaDate(p.vigenteHasta), diasDeSemana: p.diasDeSemana }, dia));
  const cuposDeEntradasDe = (p: (typeof promosCarta)[number]): CupoDeEntradasLeido[] =>
    p.cupos.flatMap((c) => (c.activo && (c.tipo === "LISTA" || c.tipo === "DEL_DIA") && c.nombre !== null ? [{ id: c.id, tipo: c.tipo, nombre: c.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima }] : []));
  const entradasPorPromo = new Map(
    dia === undefined
      ? []
      : await Promise.all(
          promosDeHoy
            .filter((p) => cuposDeEntradasDe(p).length > 0)
            .map(async (p) => [p.id, await cargarEntradasDePromoParaVender(db, { sucursalId, dia, cupos: cuposDeEntradasDe(p), precioLocalActivo: precioLocalActivoLeido })] as const)
        )
  );
  const promos: PromoSelectorCartaPos[] = promosDeHoy.flatMap((p): PromoSelectorCartaPos[] => {
    const entradas = entradasPorPromo.get(p.id);
    const deSeccion = new Map(cuposDeSeccionActivos(p.cupos).map((c) => [c.id, { seccionCartaId: c.seccionCartaId, nombreSeccion: c.seccionCarta.nombre, cantidadMinima: c.cantidadMinima, cantidadMaximaCupo: c.cantidadMaxima }]));
    const cupos = p.cupos.flatMap((c): PromoSelectorCartaPos["cupos"][number][] => {
      const seccion = deSeccion.get(c.id);
      if (seccion) return [seccion];
      const definicion = entradas?.cupos.get(c.id);
      if (!definicion || !entradas) return [];
      const deEntradas: CupoDeEntradasSelectorCarta = {
        cupoId: definicion.cupoId,
        tipo: definicion.tipo,
        nombre: definicion.nombre,
        cantidadMinima: definicion.cantidadMinima,
        cantidadMaximaCupo: definicion.cantidadMaximaCupo,
        fijo: esCupoFijo(definicion),
        entradas: [...definicion.entradas.values()].map((e) => ({ entradaId: e.entradaId, productoId: e.productoId, nombre: entradas.nombrePorEntrada.get(e.entradaId) ?? "", precioLista: entradas.precioCartaPorClave.get(e.claveComponente) ?? 0 })),
      };
      return [deEntradas];
    });
    // Un cupo activo de un tipo que este código no sabe mostrar (no puede pasar: CHECK): la promo no se ofrece (nunca a medias).
    if (cupos.length !== p.cupos.filter((c) => c.activo).length || cupos.length === 0) return [];
    return [{ promoCartaId: p.id, seccionCartaId: p.seccionCartaId, titulo: p.titulo, precio: precioDePromo(p.precio, p.sucursales[0], precioLocalActivo), cupos }];
  });
  return armarSelectorCartaPos(carta, pedibles, generos, promos);
}
