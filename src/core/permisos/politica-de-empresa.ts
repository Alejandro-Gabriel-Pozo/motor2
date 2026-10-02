import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lo que la PLATAFORMA decide para una empresa (add-on, ADR-008 y ADR-010). Es el único lugar que lo decide.
 *  - `permisosEditables`: si la empresa puede editar y otorgar permisos (`PermisoRol`) y crear/activar/desactivar roles; las acciones lo
 *    consultan a través de `conEdicionDePermisos`.
 *  - `dosPaneles`: si el menú lateral se parte en los paneles Empresa y Sucursal (ADR-010) para quien ve pantallas de empresa. En `false`
 *    el menú es uno solo, como antes de los paneles: es la marcha atrás y lo que tendrá la versión «lite» de un cliente chico.
 *
 * Hoy NO hay dónde guardar las perillas (haría falta una columna o tabla: schema, con autorización expresa), así que valen lo mismo para
 * toda empresa (`permisosEditables: true`, `dosPaneles: true`). Cuando exista el dato, solo cambia el cuerpo de esta función.
 */
interface PoliticaDeEmpresa {
  permisosEditables: boolean;
  dosPaneles: boolean;
}

export const MENSAJE_PERMISOS_DE_PLATAFORMA = "Los permisos de tu empresa los administra la plataforma; no se pueden editar desde acá.";

export async function politicaDeEmpresa(empresaId: string, db: Db): Promise<PoliticaDeEmpresa> {
  void empresaId;
  void db;
  return { permisosEditables: true, dosPaneles: true };
}
