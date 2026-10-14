"use server";

import { lecturaEnSucursalesVisibles } from "@/server/acceso/alcance";
import { sucursalesVisiblesPara } from "@/server/acceso/gate";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { avisoDelPrecioDeLaEmpresa, type AvisoDePrecioDeEmpresa } from "@/server/lecturas/carta/aviso-de-precio-de-empresa";
import { guardComandoAvisoDePrecioDeEmpresa } from "@/core/features/carta/mantenimiento.guard";
import { requerirVerDeEmpresa } from "../con-sesion";

/**
 * CARTA-MANT F4 (decisión del dueño, 2026-10-14): SOLO LECTURA. El aviso de «Aplicar a toda la empresa» en «Precios»: en qué sucursales se va a ver el precio nuevo de la empresa y en cuáles no (tienen
 * precio local propio o no venden el producto). Lo pide la pantalla al elegir esa opción. Exige el «Ver» de `producto_editar` (de la empresa) y poder editar el precio de lista (`producto_campos_sensibles`, por su fuente única `puedeEditarCamposSensiblesDelProducto`): quien no puede cambiar
 * el precio de la empresa no necesita saber dónde rige, y ensancha la LECTURA a
 * las sucursales donde el usuario ve `precio_local` (`lecturaEnSucursalesVisibles`): solo esas se nombran; las demás se cuentan (S-07).
 */
export async function avisoDePrecioDeEmpresa(productoIds: string[]): Promise<AvisoDePrecioDeEmpresa> {
  const ctx = await requerirVerDeEmpresa("producto_editar");
  if (!(await puedeEditarCamposSensiblesDelProducto(ctx))) throw new Error("Tu rol no puede cambiar el precio de la empresa.");
  const comando = guardComandoAvisoDePrecioDeEmpresa({ productoIds });
  if (!comando.ok) throw new Error(comando.mensaje);
  const lectura = await lecturaEnSucursalesVisibles(ctx, "precio_local");
  // Las que se nombran: la activa y las de las membresías donde el rol ve `precio_local` (las mismas que ensanchó `lecturaEnSucursalesVisibles`), con el nombre de la membresía.
  const visibles = await sucursalesVisiblesPara(ctx, "precio_local");
  const sucursales = [{ id: ctx.sucursalId, nombre: ctx.sucursalNombre }, ...visibles.filter((x) => x.id !== ctx.sucursalId)];
  return avisoDelPrecioDeLaEmpresa(lectura.db, sucursales, comando.valor.productoIds);
}
