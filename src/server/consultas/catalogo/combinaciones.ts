import "server-only";
import { validarEjesDeCombinacion } from "@/core/opciones/public";
import { vistaPreviaDeConfiguracion } from "@/core/pos/public";
import type { CeldaDeCombinacion, CombinacionesDelProductoAdmin } from "@/core/catalogo/public";
import { cargarProductoConEjesEnTx } from "@/server/lecturas/catalogo/combinaciones";
import { cargarRecetasVigentesDeCombinaciones } from "@/server/lecturas/catalogo/recetas-de-combinacion";
import { filasDePrecioLocalDeCombinacionesEnSucursal } from "@/server/lecturas/catalogo/precio-local-de-combinaciones";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import type { Db } from "@/lib/db-tipos";

/**
 * La CONSULTA de la pantalla de COMBINACIONES de un producto (GO-3b, ADR-032, F6 paso U4; la de TARIFAS se retiró en la Fase 3). Sin guarda de permiso adentro: las páginas la ponen antes. Lo que se cobra lo decide la venta; acá
 * se muestra el estado de cada combinación (sin fila = la regla general, con el precio que daría), su receta propia vigente y el precio local de la sucursal activa.
 */

/** La grilla de combinaciones de un producto, o `null` si el producto no existe (o es de otra empresa). */
export async function cargarCombinacionesDelProducto(db: Db, productoId: string, sucursalId: string): Promise<CombinacionesDelProductoAdmin | null> {
  const producto = await cargarProductoConEjesEnTx(db, productoId);
  if (!producto) return null;
  const pv = await db.producto.findFirst({ where: { id: productoId }, select: { tipo: true, precioVenta: true } });
  const posiblesEjes = producto.grupos
    .filter((g) => g.activo && (g.tipo === "MEDIDA" || g.tipo === "VARIANTE") && g.cantidadMinima === 1 && g.cantidadMaxima === 1)
    .map((g) => ({ grupoId: g.grupoId, nombre: g.nombre, tipo: g.tipo }));
  const [filas, materiasPrimas] = await Promise.all([
    db.combinacionDeProducto.findMany({
      where: { productoId },
      select: { id: true, opcionEje1Id: true, opcionEje2Id: true, activa: true, precio: true, version: true },
    }),
    db.producto.findMany({ where: { tipo: "MP" }, orderBy: [{ nombre: "asc" }, { id: "asc" }], select: { id: true, nombre: true, unidadStock: { select: { nombre: true } } } }),
  ]);
  const recetas = await cargarRecetasVigentesDeCombinaciones(db, filas.map((f) => f.id));
  const locales = (await filasDePrecioLocalDeCombinacionesEnSucursal(db, { sucursalId, combinacionIds: filas.map((f) => f.id), grupoDePrecioIds: [] })).porCombinacion;
  const ejesValidos = validarEjesDeCombinacion(producto.grupos.filter((g) => g.eje !== null));
  const eje1 = ejesValidos.ok ? producto.grupos.find((g) => g.grupoId === ejesValidos.ejes.eje1) : undefined;
  const eje2 = ejesValidos.ok && ejesValidos.ejes.eje2 ? producto.grupos.find((g) => g.grupoId === ejesValidos.ejes.eje2) : undefined;
  const opcionesDe = (g: typeof eje1) => (g ? [...g.opcionesAdmitidas].filter(([, o]) => !o.esNinguna).map(([opcionId, o]) => ({ opcionId, nombre: o.nombre })) : []);
  // El precio de la regla general (sin combinación) de cada par, con lo que el producto admite hoy en la sucursal: la misma composición que la venta.
  const paraVender = (await cargarOpcionesParaVender(db, { sucursalId, productoIds: [productoId] })).get(productoId);
  const gruposSinEjes = (paraVender?.grupos ?? []).map((g) => {
    const { ejeDeCombinacion: _sinEje, ...resto } = g;
    void _sinEje;
    return resto;
  });
  const precioBase = Number(pv?.precioVenta ?? 0);
  const aditivo = (ids: string[]) => {
    const v = vistaPreviaDeConfiguracion({ grupos: gruposSinEjes, elegidas: ids.map((opcionId) => ({ opcionId, cantidad: 1 })), precioBase, descuentoDeProducto: null, cantidad: 1 });
    return v.ok ? (v.precioLista ?? v.precioUnitario) : null;
  };
  const celdas: CeldaDeCombinacion[] = [];
  for (const o1 of opcionesDe(eje1)) {
    for (const o2 of eje2 ? opcionesDe(eje2) : [null]) {
      const fila = filas.find((f) => f.opcionEje1Id === o1.opcionId && f.opcionEje2Id === (o2?.opcionId ?? null));
      const receta = fila ? recetas.get(fila.id) : undefined;
      const local = fila ? (locales.get(fila.id) ?? null) : null;
      celdas.push({
        opcionEje1: o1,
        opcionEje2: o2,
        precioAditivo: aditivo([o1.opcionId, ...(o2 ? [o2.opcionId] : [])]),
        fila: fila
          ? {
              combinacionId: fila.id,
              version: fila.version,
              activa: fila.activa,
              precio: fila.precio === null ? null : Number(fila.precio),
              precioLocal: local ?? null,
              receta: receta ? { numero: receta.numero, ingredientes: receta.ingredientes.map((i) => ({ insumoProductoId: i.insumoProductoId, cantidad: i.cantidad, mermaPorcentaje: i.mermaPorcentaje })) } : null,
            }
          : null,
      });
    }
  }
  return {
    producto: { id: producto.id, nombre: producto.nombre, esPV: pv?.tipo === "PV", seProduce: producto.seProduce },
    posiblesEjes,
    ejes: producto.ejes,
    ejesValidos: ejesValidos.ok,
    eje1: eje1 ? { grupoId: eje1.grupoId, nombre: eje1.nombre } : null,
    eje2: eje2 ? { grupoId: eje2.grupoId, nombre: eje2.nombre } : null,
    celdas,
    materiasPrimas: materiasPrimas.map((m) => ({ productoId: m.id, nombre: m.nombre, unidad: m.unidadStock.nombre })),
  };
}
