import "server-only";
import { masPedidasParaElDialogo, pediblesDeEntrada, resumenDePrecios, type ConfiguracionDelSelector, type GrupoParaVender, type ProductoPedible, type SelectorCartaPos } from "@/core/pos/public";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import { precioLocalActivoEn } from "@/server/lecturas/catalogo/precio-local";
import { preciosLocalesDeOpcionVigentesEnProductos } from "@/server/lecturas/catalogo/precio-local-de-opciones";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import { saldosTeoricosEnSucursal } from "@/server/lecturas/movimientos/saldos";
import { configuracionesMasPedidasEnSucursal } from "@/server/lecturas/pos/mas-pedidas";
import { diaDeCalendario, inicioDelDia, sumarDias } from "@/core/tiempo/zona-horaria";
import type { Db } from "@/lib/db-tipos";

/**
 * Las OPCIONES de los productos del selector del POS (GO-2d): para cada pedible que admite opciones, lo que necesita el diálogo «Elegir opciones» (ver `ConfiguracionDelSelector`).
 * La forma de los grupos y la elección de la versión vigente salen de la MISMA lectura que usa la venta al pedir (`cargarOpcionesParaVender`); el precio de cada tamaño con precio
 * propio, del lector único de la grilla (`preciosLocalesDeOpcionVigentesEnProductos`, con las mismas reglas que al vender); el «desde», de `resumenDePrecios`. Nada de esto decide lo
 * que se cobra: al pedir, el servidor vuelve a leer todo dentro de su transacción y responde `OPCION_CAMBIO` si algo cambió.
 *
 * El descuento de producto: rige solo si el selector ya lo aplicó al pedible (tiene `precioLista`: así manda la misma regla del módulo Carta que usa el selector, sin repetirla); entonces
 * se lee su porcentaje para componerlo sobre la lista con opciones, como hace la venta.
 *
 * Fuera del payload, a propósito: los consumos de cada opción (son de la receta, no del mozo) y las opciones de un adicional sin producto que lo respalde (no se pueden pedir). Sin
 * N+1: una lectura de opciones para todos los productos, la grilla y la capacidad, los descuentos, un agregado de stock y dos de «lo más pedido». Sin guarda de permiso adentro:
 * la pone la página de la mesa (después de su gate de `pos_mesas`).
 *
 * «Lo más pedido acá» (modelo 3): lo de los últimos 30 días contando hoy, con los días cortados en la zona de la empresa (`cuando`); sin `cuando`, no se lee.
 */
export async function cargarOpcionesDelSelector(
  sucursalId: string,
  db: Db,
  selector: SelectorCartaPos | null,
  cuando?: { ahora: Date; zonaHoraria: string }
): Promise<Record<string, ConfiguracionDelSelector>> {
  if (!selector) return {};
  const pedibles = new Map<string, ProductoPedible>();
  for (const p of [...selector.seccionesCarta.flatMap((s) => s.entradas.flatMap(pediblesDeEntrada)), ...selector.fueraDeCarta]) pedibles.set(p.productoId, p);
  if (pedibles.size === 0) return {};

  const opciones = await cargarOpcionesParaVender(db, { sucursalId, productoIds: [...pedibles.keys()] });
  const conOpciones = [...opciones].filter(([, o]) => o.grupos.some((g) => g.admitido && g.activo)).map(([id]) => id);
  if (conOpciones.length === 0) return {};

  const capacidad = precioLocalActivoEn(sucursalId, db);
  const conDescuento = conOpciones.filter((id) => pedibles.get(id)!.precioLista !== undefined);
  const insumoIds = conOpciones.flatMap((id) => opciones.get(id)!.grupos.flatMap((g) => g.opciones.flatMap((o) => o.consumos.map((c) => c.insumoProductoId))));
  const desde = cuando ? inicioDelDia(sumarDias(diaDeCalendario(cuando.ahora, cuando.zonaHoraria), -29), cuando.zonaHoraria) : null;
  const [grilla, descuentos, saldos, insumos, pedidas] = await Promise.all([
    preciosLocalesDeOpcionVigentesEnProductos(sucursalId, db, conOpciones, capacidad),
    conDescuento.length ? descuentosDeProductoEnSucursal(sucursalId, db, conDescuento, capacidad) : Promise.resolve(new Map<string, number>()),
    saldosTeoricosEnSucursal(sucursalId, insumoIds, db),
    insumoIds.length ? db.producto.findMany({ where: { id: { in: [...new Set(insumoIds)] } }, select: { id: true, nombre: true } }) : Promise.resolve([]),
    desde ? configuracionesMasPedidasEnSucursal(db, sucursalId, conOpciones, desde) : Promise.resolve(new Map<string, never[]>()),
  ]);
  const nombreDeInsumo = new Map(insumos.map((i) => [i.id, i.nombre]));

  const salida: Record<string, ConfiguracionDelSelector> = {};
  for (const productoId of conOpciones) {
    const pedible = pedibles.get(productoId)!;
    const sinStock: Record<string, string[]> = {};
    const grupos: GrupoParaVender[] = opciones.get(productoId)!.grupos.map((g) => ({
      ...g,
      opciones: g.opciones
        .filter((o) => g.tipo !== "ADICIONAL" || o.esNinguna || o.productoAnclaId !== null)
        .map((o) => {
          const enCero = [...new Set(o.consumos.map((c) => c.insumoProductoId))].filter((id) => (saldos.get(id) ?? 0) <= 0).flatMap((id) => (nombreDeInsumo.has(id) ? [nombreDeInsumo.get(id)!] : []));
          if (enCero.length) sinStock[o.opcionId] = enCero;
          const precioDeSucursal = g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO" ? (grilla.get(`${productoId}|${o.opcionId}`) ?? null) : null;
          return { ...o, consumos: [], precioDeSucursal };
        }),
    }));
    // El precio base es el mismo que el selector muestra para el producto suelto (precio local vigente o el de venta), antes del descuento.
    const precioBase = pedible.precioLista ?? pedible.precio;
    const descuentoDeProducto = descuentos.get(productoId) ?? null;
    const resumen = resumenDePrecios({ grupos, precioBase, descuentoDeProducto });
    const masPedidas = masPedidasParaElDialogo(grupos, pedidas.get(productoId) ?? []);
    salida[productoId] = { grupos, precioBase, descuentoDeProducto, desde: resumen.desde, hayVariacion: resumen.hayVariacion, vendible: resumen.vendible, sinStock, masPedidas };
  }
  return salida;
}
