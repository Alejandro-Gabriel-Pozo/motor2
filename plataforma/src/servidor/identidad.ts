import "server-only";
import { dbDeIdentidad } from "../db";

/**
 * Lo que la operación necesita saber de la IDENTIDAD, leído de la base de la instalación principal (ADR-025). Las funciones de `servidor/empresas.ts`, `ciclo-de-vida.ts` y `modulos.ts`
 * operan sobre la base de la instalación elegida y NUNCA tocan las tablas de identidad: lo que necesitan de ellas entra por sus dependencias.
 */
export async function emailsDeAdministradores(): Promise<string[]> {
  return (await dbDeIdentidad().adminPlataforma.findMany({ select: { email: true } })).map((a) => a.email);
}
