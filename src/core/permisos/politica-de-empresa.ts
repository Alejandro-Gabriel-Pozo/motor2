import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lo que la PLATAFORMA le permite hacer a una empresa (add-on, ADR-008): hoy una sola perilla, si la empresa puede editar y otorgar permisos
 * (`PermisoRol`) y crear/activar/desactivar roles. Es el único lugar que lo decide: las acciones lo consultan a través de `conEdicionDePermisos`.
 *
 * Hoy NO hay dónde guardar la perilla (haría falta una columna o tabla: schema, con autorización expresa), así que toda empresa puede
 * (`permisosEditables: true`) y el comportamiento no cambia. Cuando exista el dato, solo cambia el cuerpo de esta función.
 */
interface PoliticaDeEmpresa {
  permisosEditables: boolean;
}

export const MENSAJE_PERMISOS_DE_PLATAFORMA = "Los permisos de tu empresa los administra la plataforma; no se pueden editar desde acá.";

export async function politicaDeEmpresa(empresaId: string, db: Db): Promise<PoliticaDeEmpresa> {
  void empresaId;
  void db;
  return { permisosEditables: true };
}
