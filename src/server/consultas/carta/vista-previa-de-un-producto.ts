import "server-only";
import { opcionesParaLaCarta, presentacionDeUnProductoSolo, vistaPreviaDeOpciones, type VistaPreviaDeLaCarta } from "@/core/carta/public";
import { resumenDePrecios, tablaDePreciosParaLaCarta } from "@/core/pos/public";
import { precioLocalActivoEn, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { preciosLocalesDeOpcionVigentesEnProductos } from "@/server/lecturas/catalogo/precio-local-de-opciones";
import { opcionesDeLosProductosDeLaCarta } from "@/server/lecturas/carta/opciones";
import type { Db } from "@/lib/db-tipos";

/**
 * La VISTA PREVIA de UN producto en la carta de una sucursal (Fase 6, bloque 3, 6.18): cómo lo va a leer la carta pública, con las MISMAS lecturas y la MISMA proyección que ella y que el «Va a mostrar» de
 * «Agregar a la carta» (`cargarCartaParaMantener`: `opcionesDeLosProductosDeLaCarta`, la grilla de tamaños de la sucursal, `tablaDePreciosParaLaCarta` y `presentacionDeUnProductoSolo`), con el precio de lista
 * de ESA sucursal y sin el descuento de producto (la vista previa dice cómo se va a leer, no el precio final). Todo el cálculo de precios se hace ACÁ, en el servidor; quien dibuja
 * (`vista-previa-de-la-carta.tsx`) solo recibe el resultado y no puede calcular nada (lo fija la regla `vista-previa-sin-calculo-de-precio`).
 *
 * Sin guarda de permiso adentro: la pone la página. `mostrarNombreArriba` es el del contenido de carta del producto (`ContenidoCartaProducto`): quien no ve la carta pasa `false`.
 */
export async function cargarVistaPreviaDeLaCarta(
  db: Db,
  sucursalId: string,
  producto: { id: string; precioVenta: number; esBase: boolean },
  mostrarNombreArriba: boolean
): Promise<VistaPreviaDeLaCarta> {
  const grupos = (await opcionesDeLosProductosDeLaCarta(db, sucursalId, [producto.id])).get(producto.id) ?? [];
  if (!grupos.some((g) => g.admitido && g.activo)) return { tipo: "sin-opciones" };
  const precioLocalActivo = await precioLocalActivoEn(sucursalId, db);
  const [locales, grilla] = await Promise.all([
    preciosLocalesVigentes(sucursalId, db, [producto.id], precioLocalActivo),
    preciosLocalesDeOpcionVigentesEnProductos(sucursalId, db, [producto.id], precioLocalActivo),
  ]);
  const precioBase = locales.get(producto.id)?.precio ?? producto.precioVenta;
  const conGrilla = grupos.map((g) =>
    g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO" ? { ...g, opciones: g.opciones.map((o) => ({ ...o, precioDeSucursal: grilla.get(`${producto.id}|${o.opcionId}`) ?? null })) } : g
  );
  const enCarta = opcionesParaLaCarta(resumenDePrecios({ grupos: conGrilla, precioBase, descuentoDeProducto: null, esBase: producto.esBase }));
  if (enCarta === null) return { tipo: "no-se-puede-pedir" };
  const tabla = tablaDePreciosParaLaCarta({ grupos: conGrilla, precioBase, descuentoDeProducto: null, esBase: producto.esBase });
  const forma = tabla ? presentacionDeUnProductoSolo({ tabla, esBase: producto.esBase, mostrarNombreArriba, conDescuento: false }) : null;
  return forma ? { tipo: "forma", presentacion: forma.presentacion, rotulos: forma.rotulos } : { tipo: "texto", texto: vistaPreviaDeOpciones(true, enCarta) };
}
