"use server";

import { guardComandoActualizarCapacidad } from "@/core/features/permisos/capacidad.guard";
import { claveEnCatalogo, type AccionClave } from "@/core/permisos/acciones";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";
import { revalidarCartasPublicas } from "../carta/revalidar";
import { actualizarCapacidadCasoDeUso } from "./casos-de-uso/actualizar-capacidad";

export async function listarCapacidades() {
  const ctx = await requerirVerDeEmpresa("capacidades_sucursal");
  const [acciones, sucursales, capacidades] = await Promise.all([
    ctx.db.accion.findMany({ where: { clave: { not: "capacidades_sucursal" } }, orderBy: { clave: "asc" } }),
    ctx.db.sucursal.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    ctx.db.capacidadSucursal.findMany(),
  ]);
  return { acciones: acciones.filter((a) => claveEnCatalogo(a.clave)), sucursales, capacidades };
}

/**
 * Equivalente de la escritura detrás de PanelCapacidadesSucursal (Sucursales.js). `sucursalId: null` = fila default (ver CapacidadSucursal en
 * schema.prisma). 'capacidades_sucursal' nunca se puede gobernar a sí misma (Sucursales.js:618 — auto-protección).
 *
 * Desde el Hito 3 (Fase I, I.1 de `docs/plan-hito-3-pureza.md`) es un adaptador: permiso (`conPermisoDeEmpresa("capacidades_sucursal")`) → formato
 * (`guardComandoActualizarCapacidad`, llamado DENTRO del envoltorio para que el rechazo por permiso siga llegando primero) → caso de uso
 * (`casos-de-uso/actualizar-capacidad.ts`: la sucursal existe, escritura y auditoría en una transacción) → efectos de Next → `aResultadoAccion`.
 */
export async function actualizarCapacidad(
  accionClave: AccionClave,
  sucursalId: string | null,
  habilitado: boolean
): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("capacidades_sucursal", async (ctx) => {
    const comando = guardComandoActualizarCapacidad({ accionClave, sucursalId, habilitado });
    if (!comando.ok) return error(comando.mensaje);
    const resultado = await actualizarCapacidadCasoDeUso(ctx, comando.valor);
    if (resultado.ok) {
      // Se llama desde un closure "use server" de la página, sin redirigir. Acá el botón ES el estado (✅/⛔): sin esto seguía mostrando el estado
      // viejo después de cambiarlo, hasta recargar a mano (ver refrescar.ts).
      if (accionClave === "precio_local") revalidarCartasPublicas(); // la carta pública muestra el precio efectivo: cambia con la capacidad
      refrescarVistaSiHaceFalta();
    }
    return aResultadoAccion(resultado);
  });
}
