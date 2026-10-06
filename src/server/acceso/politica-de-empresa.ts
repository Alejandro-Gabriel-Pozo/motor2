import "server-only";
import type { PoliticaDeEmpresa } from "@/core/permisos/politica-de-empresa";
import type { Db } from "@/lib/db-tipos";

/**
 * La LECTURA de lo que la plataforma decidió para una empresa (`Empresa.permisosEditables` y `Empresa.dosPaneles`; ADR-008 y ADR-010). Es el único lugar que lo lee.
 * El tipo, los perfiles y el mensaje son puros y viven en `core/permisos/politica-de-empresa.ts` (Pureza Fase 3, tramo B). Solo los cambia la plataforma, nunca la
 * propia empresa (guardián `politica-de-empresa-solo-plataforma.test.ts`).
 */
export async function politicaDeEmpresa(empresaId: string, db: Db): Promise<PoliticaDeEmpresa> {
  const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { permisosEditables: true, dosPaneles: true } });
  if (!empresa) throw new Error(`politicaDeEmpresa: no existe la empresa ${empresaId}.`);
  return { permisosEditables: empresa.permisosEditables, dosPaneles: empresa.dosPaneles };
}
