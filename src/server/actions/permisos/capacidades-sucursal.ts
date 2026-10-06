"use server";

import { esIdentificador } from "@/core/datos/identificador";
import { claveEnCatalogo, type AccionClave } from "@/core/permisos/acciones";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { conPermisoDeEmpresa } from "../con-permiso";
import { refrescarVistaSiHaceFalta } from "../refrescar";
import { error, ok, type ResultadoAccion } from "../tipos";
import { requerirVerDeEmpresa } from "../con-sesion";
import { revalidarCartasPublicas } from "../carta/revalidar";

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
 * Equivalente de la escritura detrás de PanelCapacidadesSucursal
 * (Sucursales.js). `sucursalId: null` = fila default (ver
 * CapacidadSucursal en schema.prisma). 'capacidades_sucursal' nunca se
 * puede gobernar a sí misma (Sucursales.js:618 — auto-protección).
 */
export async function actualizarCapacidad(
  accionClave: AccionClave,
  sucursalId: string | null,
  habilitado: boolean
): Promise<ResultadoAccion> {
  return conPermisoDeEmpresa("capacidades_sucursal", async (ctx) => {
    if (accionClave === "capacidades_sucursal") {
      return error("Esta acción no se puede gobernar a sí misma.");
    }

    // `null` es la fila default a propósito; un `undefined` o un objeto es un argumento roto y con `findFirst({ where: { sucursalId } })` tocaría la fila de cualquier sucursal.
    if (sucursalId !== null && !esIdentificador(sucursalId)) return error("Sucursal inválida.");
    if (!claveEnCatalogo(accionClave)) return error("Acción inválida.");
    if (typeof habilitado !== "boolean") return error("Valor inválido.");
    if (sucursalId !== null && !(await ctx.db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true } }))) return error("No se encontró la sucursal.");

    // sucursalId puede ser null (fila default) — el tipo generado del
    // unique compuesto accionClave_sucursalId no acepta null ahí (Prisma
    // no permite un campo nullable como parte del input de una unique
    // compuesta), así que se resuelve con findFirst + create/update en vez
    // de upsert. La unicidad real de "una sola fila default por acción" la
    // garantiza el índice único parcial agregado a mano en la migración
    // (ver schema.prisma, comentario en CapacidadSucursal) — Postgres no
    // la garantiza sola sobre una columna nullable dentro de un @@unique.
    // El cambio y su auditoría (A3, Pivote 6) van en UNA transacción: o quedan los dos o ninguno.
    await ctx.transaccion(async (tx) => {
      const existente = await tx.capacidadSucursal.findFirst({ where: { accionClave, sucursalId } });
      const fila = existente
        ? await tx.capacidadSucursal.update({ where: { id: existente.id }, data: { habilitado } })
        : await tx.capacidadSucursal.create({ data: { accionClave, sucursalId, habilitado } });
      await registrarCambioAuditado(tx, {
        entidad: "CapacidadSucursal", entidadId: fila.id, campo: "habilitado",
        descripcion: `Capacidad "${accionClave}"${sucursalId ? "" : " (default)"}`,
        valorAnterior: existente?.habilitado ?? null, valorNuevo: habilitado, actorId: ctx.usuarioId, sucursalId,
      });
    });

    // Se llama desde un closure "use server" de la página, sin redirigir. Acá el botón ES el estado (✅/⛔): sin esto seguía mostrando el estado
    // viejo después de cambiarlo, hasta recargar a mano (ver refrescar.ts).
    if (accionClave === "precio_local") revalidarCartasPublicas(); // la carta pública muestra el precio efectivo: cambia con la capacidad
    refrescarVistaSiHaceFalta();
    return ok(`Capacidad de "${accionClave}" actualizada.`);
  });
}
