import "server-only";
import { whereDisponibleEnAlguna, validarPasoVenta } from "@/core/catalogo/public";
import { validarCantidad } from "@/core/datos/cantidad";
import { validarImporte } from "@/core/datos/importe";
import { LARGO_MAXIMO_NOTAS, validarTextoLibre } from "@/core/datos/limites";
import type { EntradaProducto } from "@/core/features/catalogo/productos.schema";
import { tieneStockReal } from "@/core/movimientos/public";
import { texto, validarTextoCatalogo } from "@/core/texto";
import type { Db } from "@/lib/db-tipos";
import { validarUnidadInsumo } from "./unidad-de-insumo";

/**
 * Validación de los datos de un producto (alta completa y edición) y lo que se guarda de ellos (Hito 4 de la pureza, bloque 4.3, paso H4C-12 —
 * `docs/plan-hito-4-pureza.md` §3). Son `validarComun` y `datosParaGuardar`, que antes vivían en `src/server/actions/catalogo/productos.ts`, movidos TAL CUAL
 * (mismos textos, mismo orden de chequeos, mismas lecturas): la usan el caso de uso del alta (`casos-de-uso/dar-de-alta-producto.ts`) y la edición. Vive en
 * `server/lecturas/` y no en `core/` porque lee: la unidad de stock (sus decimales validan el factor y el paso de venta), un producto disponible con el mismo
 * nombre y la unidad de los otros productos del insumo (`validarUnidadInsumo`, mismo criterio que `unidad-de-insumo.ts`). No escribe nada.
 */

/** Los números del producto ya validados Y NORMALIZADOS: lo que se guarda es esto, nunca el valor crudo del POST (que pudo ser «1.234,5», « 5 » o null). */
interface NumerosValidados {
  factorConversion: number;
  precioVenta: number;
  precioConsignacion: number;
  pasoVenta: number | null;
}

export async function validarDatosDeProducto(db: Db, datos: EntradaProducto, productoIdExcluir?: string): Promise<{ error: string } | { numeros: NumerosValidados }> {
  const nombre = texto(datos.nombre);
  if (!nombre) return { error: "El nombre no puede estar vacío." };
  const invalido = validarTextoCatalogo(nombre, "El nombre");
  if (invalido) return { error: invalido };
  const observaciones = validarTextoLibre(datos.observaciones, "Las observaciones", LARGO_MAXIMO_NOTAS);
  if (!observaciones.ok) return { error: observaciones.mensaje };
  if (!datos.unidadStockId) return { error: "La unidad de stock es obligatoria." };
  // Unidad de stock, una sola vez: `factorConversion` son "unidades de stock por unidad de compra" (Catalogo.js:1083/1095,
  // prisma/schema.prisma) — sus decimales son los de ESA unidad, igual que `pasoVenta` (R3, validarPasoVenta) más abajo.
  const unidadStock = await db.unidad.findUnique({ where: { id: datos.unidadStockId }, select: { nombre: true, decimales: true } });
  if (!unidadStock) return { error: "La unidad de stock es obligatoria." };

  const factorConversion = validarCantidad(datos.factorConversion, unidadStock, { etiqueta: "El factor de conversión", obligatorio: true });
  if (!factorConversion.ok) return { error: factorConversion.mensaje };

  const precioVenta = validarImporte(datos.precioVenta, { etiqueta: "El precio de venta" });
  if (!precioVenta.ok) return { error: precioVenta.mensaje };

  let precioConsignacion: number | null;
  if (datos.esConsignacion) {
    if (!datos.proveedorConsignacionId) return { error: "Falta el proveedor de consignación." };
    const r = validarImporte(datos.precioConsignacion, { etiqueta: "El precio de consignación", obligatorio: true, permitirCero: false });
    if (!r.ok) return { error: r.mensaje };
    precioConsignacion = r.valor;
  } else {
    // Sin consignación el precio no se usa, pero igual se guarda: tiene que ser un importe válido (antes pasaba crudo, hasta un negativo).
    const r = validarImporte(datos.precioConsignacion, { etiqueta: "El precio de consignación" });
    if (!r.ok) return { error: r.mensaje };
    precioConsignacion = r.valor;
  }

  let pasoVenta: number | null = null;
  if (datos.pasoVenta !== undefined && datos.pasoVenta !== null) {
    if (datos.tipo !== "PV") return { error: "El paso de venta solo aplica a productos de venta (PV)." };
    const r = validarPasoVenta(datos.pasoVenta, { decimalesUnidad: unidadStock.decimales, tieneStockReal: tieneStockReal("PV", datos.seProduce ?? false) });
    if (!r.ok) return { error: r.mensaje };
    pasoVenta = r.paso;
  }

  const dup = await db.producto.findFirst({
    where: {
      ...whereDisponibleEnAlguna(),
      nombre: { equals: nombre, mode: "insensitive" },
      ...(productoIdExcluir ? { id: { not: productoIdExcluir } } : {}),
    },
  });
  if (dup) return { error: `Ya existe un producto disponible llamado "${nombre}".` };

  const errorInsumo = await validarUnidadInsumo(datos.insumoId, datos.unidadStockId, productoIdExcluir, db);
  if (errorInsumo) return { error: errorInsumo };
  return { numeros: { factorConversion: factorConversion.valor!, precioVenta: precioVenta.valor ?? 0, precioConsignacion: precioConsignacion ?? 0, pasoVenta } };
}

/** Lo que se guarda de un producto (alta y edición), con los números ya validados. Sin `tipo` a propósito: la edición no lo cambia, y el alta lo pone aparte. */
export function datosParaGuardar(datos: EntradaProducto, numeros: NumerosValidados) {
  return {
    nombre: texto(datos.nombre),
    categoriaId: datos.categoriaId || null,
    unidadCompraId: datos.unidadCompraId || null,
    unidadStockId: datos.unidadStockId,
    factorConversion: numeros.factorConversion,
    insumoId: datos.insumoId || null,
    precioVenta: numeros.precioVenta,
    // Defensivo (validarDatosDeProducto ya lo rechaza para MP): un paso de venta nunca se guarda fuera de un PV.
    pasoVenta: datos.tipo === "PV" ? numeros.pasoVenta : null,
    seProduce: datos.seProduce ?? false,
    esConsignacion: datos.esConsignacion ?? false,
    proveedorConsignacionId: datos.proveedorConsignacionId || null,
    precioConsignacion: numeros.precioConsignacion,
    // Sin el campo, Prisma no lo toca (strictUndefinedChecks no admite `undefined`).
    ...(datos.observaciones !== undefined && { observaciones: datos.observaciones }),
  };
}
