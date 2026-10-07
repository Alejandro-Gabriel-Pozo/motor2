import type { Prisma } from "@prisma/client";
import { planDeSiembra } from "@/core/features/empresa/siembra-de-empresa";
import { ROLES_DE_FABRICA, matrizDeFabrica } from "@/core/permisos/roles-de-fabrica";

/**
 * Lo que toda empresa nueva necesita para existir, sin personas: roles admin/operador con su matriz de permisos, unidades base, motivos de merma, destinos de consumo y su
 * primera sucursal. Lo comparten el alta de la consola (E5, ADR-020) y `crearEmpresa` (el fixture de pruebas). Es el ESCRITOR: el plan (qué filas) es puro y vive en
 * `core/features/empresa/siembra-de-empresa.ts` y `core/permisos/roles-de-fabrica.ts`. Mudado TAL CUAL desde `core/features/empresa/sembrar-empresa.ts` (Pureza Fase 4,
 * tramo B): vive en la consola porque es de la plataforma (solo la plataforma da de alta una empresa) y la consola no puede importar `src/server`. Sin `server-only`: lo
 * importan specs de Playwright y tests.
 *
 * `tx` ya tiene fijado `app.empresa_id` en `empresaId` (el RLS de las tablas sembradas lo exige). Mismo orden de escritura que siempre: acciones, rol admin, rol operador,
 * la matriz de permisos, unidades, motivos, destinos y la sucursal.
 */
export async function sembrarEmpresa(tx: Prisma.TransactionClient, empresaId: string, nombreSucursal: string) {
  const plan = planDeSiembra(empresaId, nombreSucursal);

  await tx.accion.createMany({ data: plan.acciones, skipDuplicates: true });

  const rolAdmin = await tx.rol.create({ data: { empresaId, nombre: ROLES_DE_FABRICA[0].nombre, clave: ROLES_DE_FABRICA[0].clave } });
  const rolOperador = await tx.rol.create({ data: { empresaId, nombre: ROLES_DE_FABRICA[1].nombre, clave: ROLES_DE_FABRICA[1].clave } });
  await tx.permisoRol.createMany({ data: matrizDeFabrica(empresaId, { admin: rolAdmin.id, operador: rolOperador.id }) });

  await tx.unidad.createMany({ data: plan.unidades });
  await tx.motivoMerma.createMany({ data: plan.motivosDeMerma });
  await tx.destinoConsumo.createMany({ data: plan.destinosDeConsumo });

  const sucursal = await tx.sucursal.create({ data: plan.sucursal });
  return { rolAdmin, rolOperador, sucursal };
}
