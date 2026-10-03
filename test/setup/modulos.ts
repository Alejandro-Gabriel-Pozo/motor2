import { MODULOS } from "../../src/core/modulos/catalogo";
import { prismaAdmin } from "./cliente-duenio";

/** Los módulos que se activan por empresa: los vendibles del catálogo del código (el fijo y los de soporte se calculan, no tienen fila). */
export const MODULOS_VENDIBLES: readonly string[] = MODULOS.filter((m) => m.tipo === "vendible").map((m) => m.id);

/**
 * Deja el registro de módulos de la empresa EXACTAMENTE como lo deja el backfill de la migración: los vendibles del catálogo, todos en ACTIVO, y nada más.
 * Se escribe como dueño: `motor2_app` no puede escribir `ModuloEmpresa` (ADR-012). Una empresa creada con `crearEmpresa` no recibe filas (la activa
 * la plataforma), así que todo test o spec que cree una empresa y pase por el guard o el menú la tiene que activar con esto.
 */
export async function activarTodosLosModulos(empresaId: string): Promise<void> {
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId, modulo: { notIn: [...MODULOS_VENDIBLES] } } });
  await prismaAdmin.moduloEmpresa.createMany({ data: MODULOS_VENDIBLES.map((modulo) => ({ empresaId, modulo })), skipDuplicates: true });
  await prismaAdmin.moduloEmpresa.updateMany({ where: { empresaId, estado: { not: "ACTIVO" } }, data: { estado: "ACTIVO" } });
}
