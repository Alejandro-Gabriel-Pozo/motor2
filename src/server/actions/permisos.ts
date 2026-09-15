"use server";

import { prisma } from "@/lib/db";
import { ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE, type AccionClave } from "@/core/permisos/acciones";
import { conPermiso } from "./con-permiso";
import { error, ok, type ResultadoAccion } from "./tipos";

export async function listarMatrizPermisos() {
  const [acciones, roles, permisos] = await Promise.all([
    prisma.accion.findMany({ orderBy: { clave: "asc" } }),
    prisma.rol.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } }),
    prisma.permisoRol.findMany(),
  ]);
  return { acciones, roles, permisos };
}

/**
 * Equivalente de actualizarPermisoDesdePanel (Core.js:1513-1551).
 *
 * "Ver ⊇ Editar" (Core.js:1534) se hace cumplir ACÁ, al escribir — no en
 * el gate de lectura (ver comentario en src/core/permisos/gate.ts).
 *
 * Salvaguarda (Core.js:1529-1531): 'gestion_permisos'/'gestion_usuarios'
 * SIEMPRE conservan Editar=true para el rol 'admin' — si no, un admin
 * podría desconfigurar esto y dejar a todo el mundo sin forma de volver a
 * entrar a corregirlo.
 */
export async function actualizarPermiso(
  rolId: string,
  accionClave: AccionClave,
  puedeEditar: boolean,
  puedeVerInput: boolean
): Promise<ResultadoAccion> {
  return conPermiso("gestion_permisos", async () => {
    const [rol, accion] = await Promise.all([
      prisma.rol.findUnique({ where: { id: rolId } }),
      prisma.accion.findUnique({ where: { clave: accionClave } }),
    ]);
    if (!rol) return error("No se encontró ese rol.");
    if (!accion) return error(`No se encontró la acción "${accionClave}".`);

    let editar = puedeEditar;
    if (ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE.includes(accionClave) && rol.nombre === "admin") {
      editar = true;
    }
    const ver = puedeVerInput || editar; // Ver ⊇ Editar, siempre.

    await prisma.permisoRol.upsert({
      where: { rolId_accionClave: { rolId, accionClave } },
      update: { puedeEditar: editar, puedeVer: ver },
      create: { rolId, accionClave, puedeEditar: editar, puedeVer: ver },
    });

    return ok(`Permisos de "${accionClave}" actualizados para "${rol.nombre}".`);
  });
}
