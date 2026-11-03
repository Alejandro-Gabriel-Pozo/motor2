import { prisma, sembrarProductoDisponible } from "../setup/test-db";
import { armarLineaConfigurada } from "../../src/core/pos/linea-configurada";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";
import { escribirLineaConfigurada } from "../../src/server/persistencia/pos/pedido";

/**
 * Ventas con opciones (diseño 2026-10-29): una «Gaseosa 500 cc» que se vende POR OPCIÓN y no tiene receta propia. Grupo «Marca» (VARIANTE, una a elegir): «Coca» (SUMA 1 botella de «Coca botella 500»)
 * y «Fanta» (sin consumo cargado). Sembrado directo con Prisma, sobre el escenario de `sembrarSalon`. Sirve para el cobro de una línea con opciones SIN pasar por el aviso temprano de agregar ítems
 * (`sembrarLineaDeGaseosa` escribe la foto como lo hace el POS, pero sin el chequeo de la receta), y para el aviso temprano mismo.
 */
export interface GaseosaPorOpcion {
  gaseosaId: string;
  botellaId: string;
  grupoMarcaId: string;
  cocaId: string;
  fantaId: string;
  versionDe: Readonly<Record<string, string>>;
}

export async function sembrarGaseosaPorOpcion(s: { sucursalId: string; unidad: { id: string }; admin: { id: string } }): Promise<GaseosaPorOpcion> {
  const insumo = await prisma.insumo.create({ data: { nombre: "Coca botella 500" } });
  const botella = await sembrarProductoDisponible({ codigo: "MP_COCA_500", nombre: "Coca botella 500", tipo: "MP", unidadStockId: s.unidad.id, insumoId: insumo.id }, s.sucursalId);
  const gaseosa = await sembrarProductoDisponible({ codigo: "PV_GASEOSA_500", nombre: "Gaseosa 500 cc", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 2500 }, s.sucursalId);
  const grupoMarcaId = (await prisma.grupoDeOpciones.create({ data: { nombre: "Marca", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
  const cocaId = (await prisma.opcionDeGrupo.create({ data: { grupoId: grupoMarcaId, nombre: "Coca", orden: 1 } })).id;
  const fantaId = (await prisma.opcionDeGrupo.create({ data: { grupoId: grupoMarcaId, nombre: "Fanta", orden: 2 } })).id;
  const versionDe: Record<string, string> = {};
  for (const opcionId of [cocaId, fantaId]) {
    versionDe[opcionId] = (await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } })).id;
  }
  await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: versionDe[cocaId]!, efecto: "SUMA", insumoProductoId: botella.id, cantidad: "1.0000", unidadId: s.unidad.id } });
  await prisma.productoAdmiteGrupo.create({ data: { productoId: gaseosa.id, grupoId: grupoMarcaId, orden: 0 } });
  for (const opcionId of [cocaId, fantaId]) await prisma.productoAdmiteOpcion.create({ data: { productoId: gaseosa.id, opcionId } });
  return { gaseosaId: gaseosa.id, botellaId: botella.id, grupoMarcaId, cocaId, fantaId, versionDe };
}

/**
 * Siembra en la cuenta UNA línea de un producto con la opción elegida, ya ENVIADA a cocina, escribiendo la foto con el mismo núcleo y la misma escritura que el POS (`armarLineaConfigurada` +
 * `escribirLineaConfigurada`) pero SIN el chequeo de receta de agregar ítems: lo que se prueba es el cobro (la barrera final).
 */
export async function sembrarLineaConOpcion(
  s: { sucursalId: string; admin: { id: string } },
  e: { productoId: string; cuentaId: string; opcionId: string; versionDeOpcionId: string; precioBase: number; cantidad?: number }
) {
  const cantidad = e.cantidad ?? 1;
  const linea = await prisma.$transaction(async (tx) => {
    const opciones = await cargarOpcionesParaVender(tx, { sucursalId: s.sucursalId, productoIds: [e.productoId] });
    const r = armarLineaConfigurada({
      grupos: opciones.get(e.productoId)!.grupos,
      elegidas: [{ opcionId: e.opcionId, cantidad: 1, versionDeOpcionId: e.versionDeOpcionId }],
      precioBase: e.precioBase,
      descuentoDeProducto: null,
      cantidad,
    });
    if (!r.ok || !r.linea) throw new Error(`debería armarse: ${JSON.stringify(r)}`);
    await escribirLineaConfigurada(tx, { cuentaId: e.cuentaId, creadoPorId: s.admin.id, linea: { productoId: e.productoId, cantidad, ...r.linea }, adicionales: [] });
    return r.linea;
  });
  await prisma.cuentaItem.updateMany({ where: { cuentaId: e.cuentaId, numeroEnvio: null }, data: { numeroEnvio: 1 } });
  return linea;
}

/** Una línea de la gaseosa con la opción elegida (ver `sembrarLineaConOpcion`). */
export function sembrarLineaDeGaseosa(s: { sucursalId: string; admin: { id: string } }, g: GaseosaPorOpcion, cuentaId: string, opcionId: string, cantidad = 1) {
  return sembrarLineaConOpcion(s, { productoId: g.gaseosaId, cuentaId, opcionId, versionDeOpcionId: g.versionDe[opcionId]!, precioBase: 2500, cantidad });
}
