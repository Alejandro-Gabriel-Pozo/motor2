import "server-only";
import { notFound, redirect } from "next/navigation";
import type { PrismaClient } from "@prisma/client";
import { dbDeInstalacion } from "../db";
import { instalacionesConfiguradas, instalacionPorId, type Instalacion } from "../entorno";
import { administradorEnSesion } from "./sesion";

/**
 * Con qué base opera una PÁGINA (ADR-025). Primero la sesión (sin sesión, al login: no se revela qué instalaciones existen), después la instalación de la ruta contra la lista cerrada que
 * configura el despliegue. Una instalación desconocida es un 404, NUNCA la principal: dos instalaciones pueden tener una empresa con el mismo id, así que caer en otra base operaría
 * sobre la empresa equivocada. Las acciones hacen lo mismo en `resolverInstalacion` desde su propio ayudante, que abre con la sesión.
 */
export function resolverInstalacion(id: string): Instalacion {
  const instalacion = instalacionPorId(instalacionesConfiguradas(), id);
  if (!instalacion) notFound();
  return instalacion;
}

export async function contextoDePagina(instalacionId: string): Promise<{
  admin: { adminId: string; email: string };
  instalacion: Instalacion;
  instalaciones: Instalacion[];
  db: PrismaClient;
}> {
  const admin = await administradorEnSesion();
  if (!admin) redirect("/login");
  const instalacion = resolverInstalacion(instalacionId);
  return { admin, instalacion, instalaciones: instalacionesConfiguradas(), db: dbDeInstalacion(instalacion) };
}
