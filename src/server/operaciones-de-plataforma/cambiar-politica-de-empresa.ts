import type { PrismaClient } from "@prisma/client";
import { PoliticaDeEmpresaError, perillasPedidas, planDeCambioDePolitica, type CambioDePoliticaHecho, type CambioDePoliticaPedido } from "@/core/features/empresa/cambio-de-politica";
import type { PoliticaDeEmpresa } from "@/core/permisos/politica-de-empresa";
import { auditarCambioDePlataforma, type AutorDeCambioDePlataforma } from "./auditar-cambio-de-plataforma";

/**
 * Cambia la política de plataforma de una empresa (add-on de plataforma, ADR-008/ADR-010). SOLO la plataforma lo hace: lo llama el script `scripts/politica-empresa.ts` y
 * nada del resto de `src/` (regla `operaciones-de-plataforma-solo-desde-scripts` de dependency-cruiser + guardián `politica-de-empresa-solo-plataforma.test.ts`). Sin
 * `import "server-only"`: lo importan scripts con `tsx` y specs de Playwright. Un `perfil` fija las dos perillas; las perillas sueltas se aplican después y lo pisan (el cálculo es
 * puro y vive en `core/features/empresa/cambio-de-politica.ts`).
 *
 * `autor` es el administrador de plataforma ya verificado (`requerirAdminDePlataforma`, contra la base de identidad de la consola) y la instalación en la que opera: NO es un
 * `User` (S-33, decisión del dueño). Cada perilla que cambia deja una fila de `AuditoriaPlataforma` a su nombre (antes y después, con la instalación en el `detalle`); todo en una
 * transacción, así que no queda un cambio sin su rastro ni un rastro de un cambio revertido. Estos cambios ya no aparecen en el registro de auditoría de la empresa. Como
 * `cambiarModulosDeEmpresa`, `db` es un cliente SIN empresa (el del proceso) y la transacción fija `app.empresa_id` en la empresa elegida para poder escribirla con el RLS puesto.
 */
export async function cambiarPoliticaDeEmpresa(db: PrismaClient, pedido: CambioDePoliticaPedido, autor: AutorDeCambioDePlataforma): Promise<CambioDePoliticaHecho> {
  const pedidas = perillasPedidas(pedido);

  return db.$transaction(async (tx) => {
    // S-33: la fila de la empresa se toma ANTES de leerla (`FOR UPDATE`): dos corridas a la vez (dos operadores, un reintento) se serializan y la segunda lee lo que dejó la primera, en
    // vez de calcular su «antes» sobre el mismo estado y pisarla (con una auditoría que dice un «antes» que ya no era cierto).
    await tx.$queryRaw`SELECT id FROM "Empresa" WHERE slug = ${pedido.slug} FOR UPDATE`;
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true, permisosEditables: true, dosPaneles: true } });
    if (!empresa) throw new PoliticaDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const antes: PoliticaDeEmpresa = { permisosEditables: empresa.permisosEditables, dosPaneles: empresa.dosPaneles };
    const { despues, cambiadas } = planDeCambioDePolitica(antes, pedidas);
    if (cambiadas.length === 0) return { empresaId: empresa.id, politica: despues, cambiadas };

    await tx.empresa.update({ where: { id: empresa.id }, data: despues });
    for (const perilla of cambiadas) {
      await auditarCambioDePlataforma(tx, autor, "politica-cambiada", empresa.id, { perilla, antes: antes[perilla], despues: despues[perilla] });
    }
    return { empresaId: empresa.id, politica: despues, cambiadas };
  });
}
