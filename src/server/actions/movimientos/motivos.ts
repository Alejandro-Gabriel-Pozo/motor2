"use server";

import { prisma } from "@/lib/db";
import { requerirSesion } from "../con-sesion";

/**
 * Lecturas de los catálogos Motivo de Merma / Destino de Consumo (plan "motivos de Consumo/Merma como catálogo
 * administrable", 2026-09-23, P5) — a diferencia de Secciones/Proveedores/Unidades, estos dos catálogos son GLOBALES
 * (no por sucursal, mismo criterio que Insumo/Grupo/CategoriaProducto). Lecturas públicas (solo exigen sesión, sin
 * `requerirVer`) para poblar el <select> del panel de Merma/Consumo — mismo criterio que
 * `listarSeccionesActivas`/`listarProveedores`/`listarUnidadesActivas` (secciones.ts).
 */
export async function listarMotivosMermaActivos() {
  await requerirSesion();
  return prisma.motivoMerma.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}

export async function listarDestinosConsumoActivos() {
  await requerirSesion();
  return prisma.destinoConsumo.findMany({ where: { activo: true }, orderBy: { nombre: "asc" } });
}
