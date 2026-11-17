import "server-only";
import { precioLocalActivoEn } from "@/server/lecturas/catalogo/precio-local";
import { cargarEntradasDePromoParaVender, type CupoDeEntradasLeido } from "@/server/lecturas/pos/entradas-de-promo-para-vender";
import { cargarSelectorCartaPos } from "@/server/lecturas/pos/selector-carta";
import { pediblesDeEntrada } from "@/core/pos/public";
import type { ParteParaRepartir } from "@/core/pos/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Las partes de cada promo con su producto de EJEMPLO para el «Reparto del precio» de Carta › Promociones (solo lectura, detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`; la pantalla solo la llama con el
 * interruptor encendido). Sin guarda de permiso adentro: la página la pone antes (`carta_ver`). Filtrada por la sucursal de la sesión y la RLS de `db`, como `cargarCombosDeLaCarta`: no lee otra empresa ni otra sucursal.
 *
 * REGLA DE «DISPONIBLE» (reutilizada, no propia): la que el POS usa para ofrecer qué elegir en una parte de promo, a la hora de vender (`promo-para-agregar.ts`):
 *  - parte de SECCIÓN: los pedibles de esa sección en el selector del POS (`cargarSelectorCartaPos`: PV con `whereDisponibleEn` y `whereNoOcultoEn` de la sucursal, ubicados en la sección por la carta de la sucursal; sin carta o sin la
 *    sección activa, ninguno), en el orden del selector; el precio es el de lista (`precioLista ?? precio`, el mismo que arma `precioCartaPorProducto` en `promo-para-agregar.ts`);
 *  - parte LISTA: las entradas elegibles hoy de `cargarEntradasDePromoParaVender` (la misma lectura que valida la venta), en el orden de la lista; el precio, su `precioCartaPorClave`.
 * El «primero» es el primero de esa lectura. A diferencia de las promos que ofrece el POS, acá entran también las pausadas (el reparto sirve para revisarlas antes de prenderlas).
 * DIFERENCIA con Pedernal declarada: su `elegiblesDeSeccion` (`src/modulos/catalogo/dominio/conjuntos.ts`, zuluhub-erp) además excluye los productos con tamaños (grupo VARIANTE activo) y los agotados; Motor2 no excluye por
 * stock agotado y un producto con opciones sí se ofrece (su precio de lista es el base). Se declara, no se cambia: la regla de venta de Motor2 es la que manda.
 */
export async function cargarRepartoDeLasPromos(db: Db, sucursalId: string, ahora: Date): Promise<Record<string, ParteParaRepartir[]>> {
  const promos = await db.promoCarta.findMany({
    select: {
      id: true,
      cupos: { where: { activo: true }, orderBy: [{ orden: "asc" }, { id: "asc" }], select: { id: true, tipo: true, nombre: true, seccionCartaId: true, cantidadMinima: true, cantidadMaxima: true, seccionCarta: { select: { nombre: true } } } },
    },
  });
  const deLista: CupoDeEntradasLeido[] = promos.flatMap((p) => p.cupos.flatMap((c) => (c.tipo === "LISTA" && c.nombre !== null ? [{ id: c.id, tipo: c.tipo, nombre: c.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima }] : [])));
  const hayDeSeccion = promos.some((p) => p.cupos.some((c) => c.tipo === "SECCION"));
  const precioLocalActivo = precioLocalActivoEn(sucursalId, db);
  const [selector, entradas] = await Promise.all([
    hayDeSeccion ? cargarSelectorCartaPos(sucursalId, db, ahora, precioLocalActivo) : Promise.resolve(null),
    deLista.length ? cargarEntradasDePromoParaVender(db, { sucursalId, cupos: deLista, precioLocalActivo }) : Promise.resolve(null),
  ]);
  const pediblesPorSeccion = new Map((selector?.seccionesCarta ?? []).map((s) => [s.seccionCartaId, s.entradas.flatMap(pediblesDeEntrada)]));

  const resultado: Record<string, ParteParaRepartir[]> = {};
  for (const p of promos) {
    const partes: ParteParaRepartir[] = [];
    for (const c of p.cupos) {
      if (c.tipo === "SECCION" && c.seccionCartaId !== null && c.seccionCarta !== null) {
        const primero = pediblesPorSeccion.get(c.seccionCartaId)?.[0];
        partes.push({ nombre: c.seccionCarta.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima, ejemplo: primero ? { nombre: primero.nombre, precioLista: primero.precioLista ?? primero.precio } : null });
      } else if (c.tipo === "LISTA" && c.nombre !== null) {
        const primera = entradas?.cupos.get(c.id)?.entradas.values().next().value;
        const precio = primera ? entradas?.precioCartaPorClave.get(primera.claveComponente) : undefined;
        const nombre = primera ? entradas?.nombrePorEntrada.get(primera.entradaId) : undefined;
        partes.push({ nombre: c.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima, ejemplo: precio !== undefined && nombre !== undefined ? { nombre, precioLista: precio } : null });
      }
    }
    resultado[p.id] = partes;
  }
  return resultado;
}
