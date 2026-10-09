import type { PrismaClient } from "@prisma/client";
import { ModulosDeEmpresaError, normalizarPedidoDeModulos, planDeCambioDeModulos, type CambioDeModulosHecho, type CambioDeModulosPedido } from "@/core/features/empresa/cambio-de-modulos";
import { auditarCambioDePlataforma, type AutorDeCambioDePlataforma } from "./auditar-cambio-de-plataforma";

/**
 * Activa y desactiva módulos vendibles de una empresa en el registro `ModuloEmpresa` (ADR-011, ADR-014, ADR-015). SOLO la plataforma lo hace: lo llama el script
 * `scripts/modulos-empresa.ts` y nada del resto de `src/` (regla `operaciones-de-plataforma-solo-desde-scripts` de dependency-cruiser). Además la base lo exige: solo
 * el dueño y `motor2_plataforma` escriben esa tabla (RLS + REVOKE a `motor2_app` + trigger). Sin `import "server-only"`: lo importan scripts con `tsx` y specs de Playwright.
 *
 * El cálculo (validar el pedido, qué filas cambian) es puro y vive en `core/features/empresa/cambio-de-modulos.ts`; acá se LEE el registro y se ESCRIBE. `autor` es el
 * administrador de plataforma ya verificado (`requerirAdminDePlataforma`, contra la base de identidad de la consola) y la instalación en la que opera: NO es un `User` (S-33,
 * decisión del dueño). Cada fila que cambia deja una fila de `AuditoriaPlataforma` a su nombre, con la instalación en el `detalle`; todo en una transacción, así que un cambio
 * revertido no deja su fila. Estos cambios ya no aparecen en el registro de auditoría de la empresa. Como `cambiarPoliticaDeEmpresa`, `db` es un cliente SIN empresa y la
 * transacción fija `app.empresa_id` en la empresa elegida para poder leer su registro con el RLS puesto.
 */
export async function cambiarModulosDeEmpresa(db: PrismaClient, pedido: CambioDeModulosPedido, autor: AutorDeCambioDePlataforma): Promise<CambioDeModulosHecho> {
  const { activar, desactivar } = normalizarPedidoDeModulos(pedido);

  return db.$transaction(async (tx) => {
    // S-33: la fila de la empresa se toma ANTES de leer el registro (`FOR UPDATE`): dos corridas a la vez se serializan y la segunda planifica sobre lo que dejó la primera, en vez de
    // calcular su «antes» sobre el mismo estado y pisarla (con una auditoría que dice un «antes» que ya no era cierto).
    await tx.$queryRaw`SELECT id FROM "Empresa" WHERE slug = ${pedido.slug} FOR UPDATE`;
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true } });
    if (!empresa) throw new ModulosDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const filas = await tx.moduloEmpresa.findMany({ where: { empresaId: empresa.id } });
    const plan = planDeCambioDeModulos(filas, { activar, desactivar });

    for (const { modulo, antes, despues } of plan.cambiados) {
      await tx.moduloEmpresa.upsert({
        where: { empresaId_modulo: { empresaId: empresa.id, modulo } },
        create: { empresaId: empresa.id, modulo, estado: despues },
        update: { estado: despues },
      });
      await auditarCambioDePlataforma(tx, autor, despues === "ACTIVO" ? "modulo-activado" : "modulo-desactivado", empresa.id, { modulo, antes: antes ?? "sin fila", despues });
    }

    return { empresaId: empresa.id, cambiados: plan.cambiados, activos: plan.activos, efectivos: plan.efectivos };
  });
}
