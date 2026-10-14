import "server-only";
import { cuposDeSeccionActivos, precioDePromo, promoVigenteEl, seleccionDeSucursalDePromo, wherePromoOfrecidaEn } from "@/core/carta/public";
import { precioLocalActivoEn } from "@/server/lecturas/catalogo/precio-local";
import { pediblesDeEntrada, type CupoDePromo, type CupoPromoDefinicion } from "@/core/pos/public";
import { diaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { cargarEntradasDePromoParaVender, type CupoDeEntradasLeido, type EntradasDePromoParaVender } from "@/server/lecturas/pos/entradas-de-promo-para-vender";
import { modulosDelPosDeSucursal, type ModulosDelPos } from "@/server/lecturas/pos/modulos-del-pos";
import { cargarSelectorCartaPos } from "@/server/lecturas/pos/selector-carta";
import type { Db } from "@/lib/db-tipos";

/**
 * Capa de LECTURA de una promo ARMABLE para agregarla a una cuenta (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 8a) —
 * separada de `promo-combo.ts` (puro) por el mismo motivo que `selector-carta-consulta.ts`/`selector-carta.ts`.
 */
export interface PromoCartaParaAgregar {
  id: string;
  titulo: string;
  precio: number;
  /** Los cupos en su orden: los de sección de siempre y (GO-3b) los de entradas, LISTA y DEL_DIA, con sus elegibles de hoy. */
  cupos: CupoDePromo[];
  /** Precio DE CARTA de cada producto elegible de CUALQUIER cupo DE SECCIÓN de esta promo — lo que `prorratearPrecioPromo` (D3) necesita
   *  para repartir, y lo que se congela en `CuentaItem.precioCartaUnitario`. */
  precioCartaPorProducto: ReadonlyMap<string, number>;
  /** GO-3b: SOLO si la promo tiene cupos de entradas — el precio de lista por `claveComponente`, la línea configurada de cada entrada que la lleva y las alícuotas (ver `entradas-de-promo-para-vender.ts`). */
  entradas?: EntradasDePromoParaVender;
}

/**
 * Carga una `PromoCarta` OFRECIDA en la sucursal (activa en la empresa y prendida acá) y ARMABLE (con uno o más cupos), con su precio vigente acá, con los MISMOS elegibles que el selector del
 * POS ofrece en cada sección de sus cupos (D5) — la fuente ÚNICA, para que `agregarItems` (paso 8a) valide la elección del
 * mozo con la misma información que ve en pantalla, nunca una lista propia que pueda desincronizarse (test de paridad contra
 * el selector, `test/pos/promo-combo-consulta.test.ts`). `null` si la promo no existe en esta sucursal, está apagada, o
 * todavía no tiene ningún cupo (sigue siendo informativa: el POS la ignora).
 *
 * `ahora` (O.22-c de docs/pureza-integracion.md) es obligatorio: el caso de uso de agregar ítems pasa `actor.ahora`; solo llega al `generadoEn` de la carta
 * del selector, que acá no se usa.
 *
 * GO-3b (ADR-032, F5 paso I2; el SEGUNDO despliegue de «expandir y contraer»): ya no se excluye una promo con cupos LISTA o DEL_DIA activos: sus cupos se arman con sus entradas elegibles HOY
 * (`cargarEntradasDePromoParaVender`). `dia` es el día de calendario de la zona de la empresa (`diaDeCalendario(actor.ahora, empresaZonaHoraria)`) y decide dos cosas: la VIGENCIA de la promo
 * (rango de fechas y días de la semana, `promoVigenteEl`: fuera de ella, `null`) y los platos de un DEL_DIA (solo los de ese día). Sin `dia`, una promo con vigencia o con un cupo DEL_DIA falla
 * cerrado (`null`). Una promo solo con cupos de sección (todo lo de antes) lee y devuelve exactamente lo mismo que antes (sin `entradas`); una solo con cupos de entradas no lee el selector.
 */
export async function cargarPromoCartaParaAgregar(
  sucursalId: string,
  promoCartaId: string,
  db: Db,
  ahora: Date,
  /** Los módulos de la empresa ya leídos por quien llama (`agregarItems`); ausentes, se leen acá. */
  modulosCargados?: ModulosDelPos,
  /** GO-3b: «AAAA-MM-DD», el día de calendario de la zona de la empresa (ver arriba). */
  dia?: string
): Promise<PromoCartaParaAgregar | null> {
  // S-22 / D2: sin Promociones (o sin la Carta que ella requiere) no hay promo que agregar, exista o no la fila: lo contratado manda sobre lo que quedó cargado.
  const modulos = modulosCargados ?? (await modulosDelPosDeSucursal(sucursalId, db));
  if (!modulos.promociones) return null;
  const promo =
    typeof promoCartaId === "string"
      ? await db.promoCarta.findFirst({
          where: { id: promoCartaId, ...wherePromoOfrecidaEn(sucursalId) },
          include: { sucursales: seleccionDeSucursalDePromo(sucursalId), cupos: { where: { activo: true }, include: { seccionCarta: { select: { nombre: true } } }, orderBy: { orden: "asc" } } },
        })
      : null;
  if (!promo) return null;
  // GO-3b: la vigencia (D-7). NULL en las tres columnas = siempre (todo lo de antes, sin mirar el día); con alguna, hace falta el día y la promo tiene que valer ese día.
  if (promo.vigenteDesde !== null || promo.vigenteHasta !== null || promo.diasDeSemana !== null) {
    const vigencia = { vigenteDesde: promo.vigenteDesde && diaDeColumnaDate(promo.vigenteDesde), vigenteHasta: promo.vigenteHasta && diaDeColumnaDate(promo.vigenteHasta), diasDeSemana: promo.diasDeSemana };
    if (dia === undefined || !promoVigenteEl(vigencia, dia)) return null;
  }
  const cuposDeSeccion = cuposDeSeccionActivos(promo.cupos);
  const cuposDeEntradas: CupoDeEntradasLeido[] = promo.cupos.flatMap((c) =>
    c.activo && (c.tipo === "LISTA" || c.tipo === "DEL_DIA") && c.nombre !== null ? [{ id: c.id, tipo: c.tipo, nombre: c.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima }] : [],
  );
  // Un cupo activo de un tipo que este código no conoce (no puede pasar: CHECK) falla cerrado: nunca un combo a medias por su precio entero.
  if (promo.cupos.some((c) => c.activo && c.tipo !== "SECCION" && !cuposDeEntradas.some((e) => e.id === c.id))) return null;
  if (!cuposDeSeccion.length && !cuposDeEntradas.length) return null;
  if (dia === undefined && cuposDeEntradas.some((c) => c.tipo === "DEL_DIA")) return null;

  // La capacidad `precio_local` se lee una vez y la comparten el selector y el precio de la promo (O.39: antes 7 lecturas por carga).
  const precioLocalActivoLeido = precioLocalActivoEn(sucursalId, db);
  const [selector, precioLocalActivo, entradas] = await Promise.all([
    cuposDeSeccion.length ? cargarSelectorCartaPos(sucursalId, db, ahora, precioLocalActivoLeido, modulos) : Promise.resolve(null),
    precioLocalActivoLeido,
    cuposDeEntradas.length ? cargarEntradasDePromoParaVender(db, { sucursalId, dia: dia ?? "", cupos: cuposDeEntradas, precioLocalActivo: precioLocalActivoLeido }) : Promise.resolve(null),
  ]);
  const pediblesPorSeccion = new Map((selector?.seccionesCarta ?? []).map((s) => [s.seccionCartaId, s.entradas.flatMap(pediblesDeEntrada)]));

  const precioCartaPorProducto = new Map<string, number>();
  const deSeccion = new Map<string, CupoPromoDefinicion>();
  for (const c of cuposDeSeccion) {
    const pedibles = pediblesPorSeccion.get(c.seccionCartaId) ?? [];
    // Los componentes de una promo se prorratean sobre el precio de LISTA: el descuento de producto no aplica dentro de una promo.
    for (const p of pedibles) precioCartaPorProducto.set(p.productoId, p.precioLista ?? p.precio);
    deSeccion.set(c.id, {
      seccionCartaId: c.seccionCartaId,
      nombreSeccion: c.seccionCarta.nombre,
      cantidadMinima: c.cantidadMinima,
      cantidadMaximaCupo: c.cantidadMaxima,
      elegibles: new Set(pedibles.map((p) => p.productoId)),
    });
  }
  // En el orden de los cupos (`orden`), los de sección y los de entradas mezclados.
  const cupos: CupoDePromo[] = promo.cupos.flatMap((c) => {
    const definicion = deSeccion.get(c.id) ?? entradas?.cupos.get(c.id);
    return definicion ? [definicion] : [];
  });
  const precio = precioDePromo(promo.precio, promo.sucursales[0], precioLocalActivo);
  return entradas ? { id: promo.id, titulo: promo.titulo, precio, cupos, precioCartaPorProducto, entradas } : { id: promo.id, titulo: promo.titulo, precio, cupos, precioCartaPorProducto };
}
