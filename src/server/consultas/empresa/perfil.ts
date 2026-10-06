import "server-only";
import type { Db } from "@/lib/db-tipos";

/**
 * Lectura de Administración › Perfil de la empresa para el Server Component de `/administracion/empresa`. Mismo contrato que
 * `src/server/consultas/permisos/roles.ts`: `server-only`, sin `"use server"`, sin guarda de permiso adentro (la página hace
 * `requierePermisoVerDeEmpresa(...)` antes) y `db: Db` al final.
 *
 * `Empresa` no tiene RLS (las empresas se leen entre sí solo por su `id`): el filtro por `empresaId` es lo único que impide traer los datos de otra,
 * así que va siempre y el que llama pasa la empresa del contexto, nunca una que viene del navegador.
 *
 * Devuelve `null` si la empresa no existe. `cuit` viene tal como se guarda (11 dígitos, sin guiones) o `null` si todavía no está confirmado.
 */
export async function obtenerPerfilDeEmpresa(empresaId: string, db: Db) {
  return db.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true, cuit: true, zonaHoraria: true, moneda: true } });
}
