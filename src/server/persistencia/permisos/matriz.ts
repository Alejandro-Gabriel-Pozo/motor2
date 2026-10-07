import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de la MATRIZ de permisos (`PermisoRol`; Hito 3, Fase I, I.3 de `docs/plan-hito-3-pureza.md`). Son EXACTAMENTE la lectura y la escritura que la
 * Server Action `guardarPermisos` hacía en línea dentro de su transacción serializable, mudadas tal cual. Sin reglas de negocio ni auditoría: qué celdas, el
 * chequeo optimista contra lo que la persona vio y la auditoría los decide el caso de uso `server/actions/permisos/casos-de-uso/guardar-permisos.ts`. El cliente
 * es SIEMPRE el primer parámetro, la transacción del caso de uso (nunca `db = prisma` por defecto).
 *
 * Contrato C5 del RBAC (modo ii de `test/arquitectura/escrituras-de-permisos-por-politica.test.ts`): escribir `PermisoRol` vale acá SOLO porque a este archivo
 * lo importa únicamente un caso de uso de `server/actions/permisos/`, al que solo importa su Server Action, que lo llama DENTRO de `conEdicionDePermisos` (la
 * clave más la política de plataforma, ADR-008). Toca la matriz de acceso a mano (`permisoRol`): es su trabajo, y por eso figura con sus 2 accesos en las
 * excepciones permanentes de `acceso-solo-por-el-guard.test.ts` (la decisión de acceso la toma el guard).
 */

/** Las filas ACTUALES de `PermisoRol` de esas celdas (rol × acción). Una celda sin fila no viene (= sin permiso). */
export async function leerCeldasDeLaMatriz(tx: Prisma.TransactionClient, celdas: { rolId: string; accionClave: string }[]) {
  return tx.permisoRol.findMany({
    where: { OR: celdas.map((c) => ({ rolId: c.rolId, accionClave: c.accionClave })) },
  });
}

/** Deja la celda (rol × acción) con esos dos valores, creando la fila si no existía. Devuelve la fila (el caso de uso usa su id en la auditoría). */
export async function escribirCeldaDeLaMatriz(
  tx: Prisma.TransactionClient,
  celda: { rolId: string; accionClave: string; puedeVer: boolean; puedeEditar: boolean },
): Promise<{ id: string }> {
  const { rolId, accionClave, puedeVer, puedeEditar } = celda;
  return tx.permisoRol.upsert({
    where: { rolId_accionClave: { rolId, accionClave } },
    update: { puedeEditar, puedeVer },
    create: { rolId, accionClave, puedeEditar, puedeVer },
  });
}
