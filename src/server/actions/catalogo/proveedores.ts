"use server";

import { guardComandoAltaProveedor } from "@/core/features/catalogo/proveedores.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { azarDelProceso } from "@/lib/azar";
import { conPermisoDeEmpresa } from "../con-permiso";
import { error, okConId, type ResultadoAccion, type ResultadoConId } from "../tipos";
import { requerirVerAlguna, requerirVerDeEmpresa } from "../con-sesion";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { actualizarActivaProveedorCasoDeUso } from "./casos-de-uso/actualizar-activa-proveedor";
import { actualizarProveedorCasoDeUso } from "./casos-de-uso/actualizar-proveedor";
import { altaProveedorCasoDeUso } from "./casos-de-uso/alta-proveedor";

/**
 * Desde el Hito 4 de la pureza (bloque C de la pieza carta/catálogo/stock, paso H4C-14) las tres mutaciones son adaptadores finos de sus casos de uso
 * (`./casos-de-uso/{alta-proveedor,actualizar-activa-proveedor,actualizar-proveedor}.ts`; escrituras en server/persistencia/catalogo/proveedores.ts, la lectura del
 * CUIT repetido en server/lecturas/catalogo/proveedor-con-cuit.ts): el archivo entero está en `ACCIONES_CON_CASO_DE_USO`. Las lecturas (H8) siguen acá con sus
 * guardas. La acción conserva el refresco de la vista (activar) y la fuente de azar del proceso (el código autogenerado del alta).
 */

/** La ficha completa de cada proveedor (H8, D-4): solo para la pantalla de Proveedores, con su clave. Para elegir un proveedor, `listarProveedoresParaSelector`. */
export async function listarProveedores(soloActivos = false) {
  const ctx = await requerirVerDeEmpresa("proveedores");
  return ctx.db.proveedor.findMany({
    where: soloActivos ? { activo: true } : {},
    orderBy: { nombre: "asc" },
  });
}

/** Lo que necesita un `<select>` de proveedor: sin los datos de la ficha (contacto, teléfono, email, CUIT, condiciones de pago, notas). */
export interface ProveedorParaSelector {
  id: string;
  nombre: string;
  activo: boolean;
}

/**
 * Proveedores para ELEGIR (H8, decisión D-4 del dueño): la compra y la devolución a proveedor, el filtro del reporte de compras y el formulario de producto
 * (proveedor de consignación) solo necesitan el id, el nombre y si está activo. La ficha completa (`listarProveedores`) es de la pantalla de Proveedores.
 */
export async function listarProveedoresParaSelector(soloActivos = false): Promise<ProveedorParaSelector[]> {
  const ctx = await requerirVerAlguna(["proceso_compra", "proceso_devolucion_proveedor", "reporte_compras", "alta_producto", "producto_ver_catalogo"]);
  return ctx.db.proveedor.findMany({
    where: soloActivos ? { activo: true } : {},
    select: { id: true, nombre: true, activo: true },
    orderBy: { nombre: "asc" },
  });
}

export interface DatosProveedor {
  nombre: string;
  contacto?: string;
  telefono?: string;
  email?: string;
  cuit?: string;
  condicionesPago?: string;
  notas?: string;
}

/**
 * Equivalente de altaProveedor (Catalogo.js:3757-3775). Gatea con
 * 'alta_producto', no con un permiso propio — se preserva la decisión
 * histórica documentada: es lo que ya usaba el flujo de Compra, no
 * restringe nada nuevo.
 *
 * Desde el Hito 4 (H4C-14): permiso (`conPermisoDeEmpresa("proveedor_alta")`) → formato (`guardComandoAltaProveedor`, core/features/catalogo/proveedores.guard.ts,
 * DENTRO del envoltorio: el nombre y los datos de contacto) → caso de uso (`casos-de-uso/alta-proveedor.ts`: nombre y CUIT libres, el código con reintento —SIN
 * transacción a propósito— y la carrera del CUIT), con la fuente de azar del proceso → `aResultadoAccion`, y si salió bien el id y el nombre (`okConId`).
 */
export async function altaProveedor(datos: DatosProveedor): Promise<ResultadoConId> {
  return conPermisoDeEmpresa<ResultadoConId>("proveedor_alta", async (ctx) => {
    const comando = guardComandoAltaProveedor(datos);
    if (!comando.ok) return error(comando.mensaje);
    const r = await altaProveedorCasoDeUso(ctx, comando.valor, azarDelProceso);
    const base = aResultadoAccion(r);
    return r.ok ? okConId(base.mensaje, r.datos.id, r.datos.nombre) : error(base.mensaje);
  });
}

/**
 * Desde el Hito 4 (H4C-14): permiso → caso de uso (`casos-de-uso/actualizar-activa-proveedor.ts`) → refrescar la vista → `aResultadoAccion`. Sin guard
 * (`SIN_GUARD`: solo recibe un id y un booleano).
 */
export async function actualizarActivaProveedor(proveedorId: string, activo: boolean): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("proveedores", async (ctx) => {
    const resultado = await actualizarActivaProveedorCasoDeUso(ctx, { proveedorId, activo });
    // Se llama desde la lista sin redirigir después — sin esto la columna
    // "Activo" no cambiaría en un navegador real hasta recargar a mano
    // (ver src/server/actions/refrescar.ts).
    refrescarVistaSiHaceFalta();
    return aResultadoAccion(resultado);
  });
}

/**
 * Antes solo existía alta (altaProveedor) y Activar/Desactivar — no había
 * forma de corregir contacto/teléfono/email/CUIT/condiciones de pago de un
 * proveedor ya creado. El nombre no se edita acá a propósito (mismo
 * criterio de identidad que Insumo/Producto): para eso está
 * renombrarOFusionarInsumo-style, fuera del alcance de este hallazgo.
 *
 * Desde el Hito 4 (H4C-14): permiso → caso de uso (`casos-de-uso/actualizar-proveedor.ts`: leer el proveedor, validar, CUIT libre, escribir y la carrera) →
 * `aResultadoAccion`. Sin guard (`SIN_GUARD`: la acción leía el proveedor ANTES de validar).
 */
export async function actualizarProveedor(proveedorId: string, datos: Omit<DatosProveedor, "nombre">): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("proveedores", async (ctx) => {
    return aResultadoAccion(await actualizarProveedorCasoDeUso(ctx, { proveedorId, datos }));
  });
}
