import type { Prisma } from "@prisma/client";

/**
 * Quién hace un cambio de plataforma por script y desde qué instalación (S-33, decisión del dueño 2026-10-08: «el admin de plataforma no es User y no debe serlo»). El administrador es
 * un `AdminPlataforma` ACTIVO verificado contra la base de identidad de la consola (`requerir-admin-de-plataforma.ts`); su `id` y su email se copian a la fila de auditoría como
 * texto, sin clave foránea (el administrador vive en la base de la instalación principal, la empresa en la suya). La instalación viaja con él: `instalacionId` e `instalacionNombre`
 * son el id y el nombre de la instalación que declara el archivo de entorno de plataforma (por defecto `principal`), los mismos que usa la consola. `src/` no lee ese archivo: los
 * resuelve el script (`scripts/conexion-de-plataforma.ts`) y se los pasa.
 */
export interface AutorDeCambioDePlataforma {
  adminId: string;
  adminEmail: string;
  instalacionId: string;
  instalacionNombre: string;
}

/**
 * Las acciones de los cambios por script. Las de módulos son las MISMAS que escribe la consola (`modulo-activado` / `modulo-desactivado`): el historial de la empresa en la consola
 * las muestra juntas, y el `detalle.origen = "script"` dice por cuál vía salió cada una.
 */
export type AccionDeCambioDePlataforma = "modulo-activado" | "modulo-desactivado" | "politica-cambiada";

type Detalle = Record<string, string | number | boolean | null>;

/**
 * La fila de `AuditoriaPlataforma` de un cambio por script, escrita con el cliente `tx` de la MISMA transacción que el cambio (ADR-012 §5): si el cambio se revierte, la fila también, y
 * un cambio sin su fila no puede existir. Antes estos cambios se anotaban en `RegistroAuditoria` a nombre de un `User` con el email del actor; ahora dejan de aparecer en el registro
 * que ve el gerente de la empresa y quedan SOLO acá (decisión del dueño: un rastro del lado de la empresa pediría una migración —actor nulo más administrador de plataforma—). El
 * `detalle` lleva la instalación DESPUÉS de lo que pasa quien llama, para que no se la pueda pisar, y nunca secretos.
 */
export async function auditarCambioDePlataforma(
  tx: Prisma.TransactionClient,
  autor: AutorDeCambioDePlataforma,
  accion: AccionDeCambioDePlataforma,
  empresaAfectadaId: string,
  detalle: Detalle,
): Promise<void> {
  await tx.auditoriaPlataforma.create({
    data: {
      adminId: autor.adminId,
      adminEmail: autor.adminEmail,
      accion,
      empresaAfectadaId,
      detalle: { ...detalle, origen: "script", instalacion: autor.instalacionId, instalacionNombre: autor.instalacionNombre },
    },
  });
}
