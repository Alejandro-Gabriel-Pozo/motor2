import type { PrismaClient } from "@prisma/client";
import { PoliticaDeEmpresaError, descripcionDeCambioDePerilla, perillasPedidas, planDeCambioDePolitica, type CambioDePoliticaHecho, type CambioDePoliticaPedido } from "@/core/features/empresa/cambio-de-politica";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import type { PoliticaDeEmpresa } from "@/core/permisos/politica-de-empresa";

/**
 * Cambia la política de plataforma de una empresa (add-on de plataforma, ADR-008/ADR-010). SOLO la plataforma lo hace: lo llama el script `scripts/politica-empresa.ts` y
 * nada del resto de `src/` (regla `operaciones-de-plataforma-solo-desde-scripts` de dependency-cruiser + guardián `politica-de-empresa-solo-plataforma.test.ts`). Sin
 * `import "server-only"`: lo importan scripts con `tsx` y specs de Playwright. Un `perfil` fija las dos perillas; las perillas sueltas se aplican después y lo pisan (el cálculo es
 * puro y vive en `core/features/empresa/cambio-de-politica.ts`).
 *
 * Cada perilla que cambia deja una fila de auditoría `Empresa` (de la empresa entera, sin sucursal) a nombre de `actorEmail`; todo en una transacción, así que no queda un cambio
 * sin su rastro. Como `cambiarModulosDeEmpresa`, `db` es un cliente SIN empresa (el del proceso) y la transacción fija `app.empresa_id` en la empresa elegida para poder escribir su
 * auditoría con el RLS puesto.
 */
export async function cambiarPoliticaDeEmpresa(db: PrismaClient, pedido: CambioDePoliticaPedido): Promise<CambioDePoliticaHecho> {
  const pedidas = perillasPedidas(pedido);

  return db.$transaction(async (tx) => {
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true, nombre: true, permisosEditables: true, dosPaneles: true } });
    if (!empresa) throw new PoliticaDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);
    const actor = await tx.user.findUnique({ where: { email: pedido.actorEmail.trim().toLowerCase() }, select: { id: true } });
    if (!actor) throw new PoliticaDeEmpresaError(`No existe un usuario con el email "${pedido.actorEmail}": el cambio queda a su nombre en la auditoría.`);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const antes: PoliticaDeEmpresa = { permisosEditables: empresa.permisosEditables, dosPaneles: empresa.dosPaneles };
    const { despues, cambiadas } = planDeCambioDePolitica(antes, pedidas);
    if (cambiadas.length === 0) return { empresaId: empresa.id, politica: despues, cambiadas };

    await tx.empresa.update({ where: { id: empresa.id }, data: despues });
    for (const perilla of cambiadas) {
      await registrarCambioAuditado(tx, {
        entidad: "Empresa",
        entidadId: empresa.id,
        descripcion: descripcionDeCambioDePerilla(empresa.nombre, perilla),
        campo: perilla,
        valorAnterior: antes[perilla],
        valorNuevo: despues[perilla],
        actorId: actor.id,
      });
    }
    return { empresaId: empresa.id, politica: despues, cambiadas };
  });
}
