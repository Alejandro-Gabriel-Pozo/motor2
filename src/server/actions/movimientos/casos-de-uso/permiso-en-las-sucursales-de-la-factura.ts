import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { permisoYAlcanceEnSucursal } from "@/server/actions/con-permiso";
import { sucursalesConParteDeFactura } from "@/server/persistencia/compras/cargar-factura-proveedor";

/**
 * El gate de las acciones que tocan una factura ENTERA («anular» y «corregir los datos»): el permiso se pide EN CADA sucursal donde ya entró una parte y en la que la cargó (supuesto S2 de
 * docs/diseno-una-sola-compra-2026-11-06.md), además de la activa (que ya pasó `conPermiso`). Una lectura de VERIFICACIÓN devuelve solo los ids de esas sucursales (nada de otra sucursal se muestra); cada una
 * se gatea con `permisoYAlcanceEnSucursal`, que solo si aprueba ensancha el contexto a ella. Si falta el permiso en una, se rechaza nombrando el porqué. Devuelve el contexto ensanchado y las sucursales con parte
 * (el caso de uso las vuelve a comparar con las que ve después de bloquear la cabecera: si una destino aceptó en el medio, hay que repetir).
 */
export async function exigirPermisoEnLasSucursalesDeLaFactura(
  actor: ContextoDeAccion,
  facturaId: string,
  accion: "anular" | "corregir"
): Promise<{ ok: true; ctx: ContextoDeAccion; sucursalesConParte: string[] } | { ok: false; mensaje: string }> {
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(actor);
  const { conParte, queLaCargaron } = await sucursalesConParteDeFactura(verificacion.db, facturaId);
  let ctx: ContextoDeAccion = actor;
  for (const sucursalId of [...new Set([...conParte, ...queLaCargaron])].sort()) {
    if (sucursalId === actor.sucursalId) continue;
    const gate = await (accion === "anular" ? permisoYAlcanceEnSucursal(ctx, sucursalId, "anular_compra") : permisoYAlcanceEnSucursal(ctx, sucursalId, "corregir_compra"));
    if (!gate.ok) {
      // También la sucursal que CARGÓ la factura (aunque no se haya quedado con parte): sin esto, quien tiene el permiso en cualquier sucursal tocaba la factura que otra cargó solo para terceras.
      const porque = conParte.includes(sucursalId) ? "una de sus partes ya entró al stock de otra sucursal" : "la cargó otra sucursal";
      return { ok: false, mensaje: `No podés ${accion} esta factura: ${porque} donde no tenés permiso de ${accion} compras. ${gate.mensaje}` };
    }
    ctx = gate.ctx;
  }
  return { ok: true, ctx, sucursalesConParte: conParte };
}
