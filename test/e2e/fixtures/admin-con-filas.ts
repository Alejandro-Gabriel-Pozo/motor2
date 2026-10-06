import { prisma } from "./db";
import type { AccionClave } from "../../../src/core/permisos/acciones";

/** El estado de una celda del rol: Ver/Editar, o `null` = sin fila. */
export type FilaPermiso = { puedeVer: boolean; puedeEditar: boolean } | null;

/**
 * Las acciones de piso «administrador» solo las alcanza el rol «admin» (un rol personalizado es de nivel operario y el piso manda): para
 * probar «un rol que SOLO VE esto» o «un rol que no tiene aquello» sobre una de esas acciones, el caso se arma sobre el propio «admin»,
 * dejándole esas celdas como pide el caso. `restaurar()` devuelve cada celda a cómo estaba (la suite corre con un solo worker: nadie más
 * lee el rol mientras tanto). El rol «admin» NO se borra nunca.
 */
export async function ajustarCeldasDelAdmin(filas: Partial<Record<AccionClave, FilaPermiso>>) {
  const { id: empresaId } = await prisma.empresa.findUniqueOrThrow({ where: { id: "empresa_principal" } });
  const rol = await prisma.rol.findUniqueOrThrow({ where: { empresaId_clave: { empresaId, clave: "admin" } } });
  const claves = Object.keys(filas) as AccionClave[];
  const originales = new Map<AccionClave, FilaPermiso>();
  for (const clave of claves) {
    const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId: rol.id, accionClave: clave } } });
    originales.set(clave, f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : null);
  }

  async function fijar(clave: AccionClave, fila: FilaPermiso) {
    const where = { rolId_accionClave: { rolId: rol.id, accionClave: clave } };
    if (!fila) {
      await prisma.permisoRol.deleteMany({ where: { rolId: rol.id, accionClave: clave } });
      return;
    }
    await prisma.permisoRol.upsert({ where, update: fila, create: { rolId: rol.id, accionClave: clave, ...fila } });
  }

  for (const clave of claves) await fijar(clave, filas[clave] ?? null);

  return {
    rolId: rol.id,
    cambiar: async (nuevas: Partial<Record<AccionClave, FilaPermiso>>) => {
      for (const clave of Object.keys(nuevas) as AccionClave[]) {
        if (!originales.has(clave)) {
          const f = await prisma.permisoRol.findUnique({ where: { rolId_accionClave: { rolId: rol.id, accionClave: clave } } });
          originales.set(clave, f ? { puedeVer: f.puedeVer, puedeEditar: f.puedeEditar } : null);
        }
        await fijar(clave, nuevas[clave] ?? null);
      }
    },
    restaurar: async () => {
      for (const [clave, fila] of originales) await fijar(clave, fila);
    },
  };
}
