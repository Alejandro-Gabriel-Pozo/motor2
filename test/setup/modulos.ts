import { MODULOS } from "../../src/core/modulos/catalogo";
import { prismaAdmin } from "./cliente-duenio";

/**
 * Interruptores que NACEN APAGADOS: la plataforma los enciende empresa por empresa y el backfill de la migración del registro no los trae. `recepcion_de_compras` (Compras N3-a, recepción separada): con él encendido una compra de una sola parte
 * nace «pendiente de recibir» y no entra al stock hasta que se confirma la recepción, así que `activarTodosLosModulos` NO lo enciende (un test que lo necesita lo pide con `fijarModulosActivos(empresa, [...MODULOS_VENDIBLES, "recepcion_de_compras"])`).
 */
const MODULOS_QUE_NACEN_APAGADOS: readonly string[] = ["recepcion_de_compras"];

/**
 * Los módulos que se activan por empresa: los vendibles DISPONIBLES del catálogo del código (el fijo y los de soporte se calculan, no tienen fila; uno en
 * desarrollo no se activa nunca). El nombre quedó de antes de que existiera `en_desarrollo`.
 */
export const MODULOS_VENDIBLES: readonly string[] = MODULOS.filter((m) => m.tipo === "vendible" && m.estado === "disponible" && !MODULOS_QUE_NACEN_APAGADOS.includes(m.id)).map((m) => m.id);

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

/** Deja el registro de la empresa con EXACTAMENTE estos módulos en ACTIVO (los demás filas se borran). Para probar el guard con un plan parcial o vacío. */
export async function fijarModulosActivos(empresaId: string, modulos: readonly string[]): Promise<void> {
  await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId } });
  if (modulos.length) await prismaAdmin.moduloEmpresa.createMany({ data: modulos.map((modulo) => ({ empresaId, modulo })) });
}

/**
 * Enciende `recepcion_de_compras` en la empresa (fila ACTIVO, la crea si no está). Desde la guarda de apagado (20261117170000) la BASE no deja nacer una parte de compra PENDIENTE con el módulo apagado: un fixture que siembra
 * una parte pendiente a mano (el default de la columna) la tiene que pedir antes. No toca los demás módulos.
 */
export async function encenderRecepcionDeCompras(empresaId: string): Promise<void> {
  await prismaAdmin.moduloEmpresa.upsert({ where: { empresaId_modulo: { empresaId, modulo: "recepcion_de_compras" } }, create: { empresaId, modulo: "recepcion_de_compras", estado: "ACTIVO" }, update: { estado: "ACTIVO" } });
}
