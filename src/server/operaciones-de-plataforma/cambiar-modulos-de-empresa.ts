import type { PrismaClient } from "@prisma/client";
import { ModulosDeEmpresaError, descripcionDeCambioDeModulo, normalizarPedidoDeModulos, planDeCambioDeModulos, type CambioDeModulosHecho, type CambioDeModulosPedido } from "@/core/features/empresa/cambio-de-modulos";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";

/**
 * Activa y desactiva módulos vendibles de una empresa en el registro `ModuloEmpresa` (ADR-011, ADR-014, ADR-015). SOLO la plataforma lo hace: lo llama el script
 * `scripts/modulos-empresa.ts` y nada del resto de `src/` (regla `operaciones-de-plataforma-solo-desde-scripts` de dependency-cruiser). Además la base lo exige: solo
 * el dueño y `motor2_plataforma` escriben esa tabla (RLS + REVOKE a `motor2_app` + trigger). Sin `import "server-only"`: lo importan scripts con `tsx` y specs de Playwright.
 *
 * El cálculo (validar el pedido, qué filas cambian) es puro y vive en `core/features/empresa/cambio-de-modulos.ts`; acá se LEE el registro y se ESCRIBE. Cada fila que
 * cambia deja una fila de auditoría `ModuloEmpresa` a nombre de `actorEmail`; todo en una transacción. Como `cambiarPoliticaDeEmpresa`, `db` es un cliente SIN
 * empresa y la transacción fija `app.empresa_id` en la empresa elegida para poder leer su registro y escribir su auditoría con el RLS puesto.
 */
export async function cambiarModulosDeEmpresa(db: PrismaClient, pedido: CambioDeModulosPedido): Promise<CambioDeModulosHecho> {
  const { activar, desactivar } = normalizarPedidoDeModulos(pedido);

  return db.$transaction(async (tx) => {
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true, nombre: true } });
    if (!empresa) throw new ModulosDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);
    const actor = await tx.user.findUnique({ where: { email: pedido.actorEmail.trim().toLowerCase() }, select: { id: true } });
    if (!actor) throw new ModulosDeEmpresaError(`No existe un usuario con el email "${pedido.actorEmail}": el cambio queda a su nombre en la auditoría.`);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const filas = await tx.moduloEmpresa.findMany({ where: { empresaId: empresa.id } });
    const plan = planDeCambioDeModulos(filas, { activar, desactivar });

    for (const { modulo, antes, despues } of plan.cambiados) {
      await tx.moduloEmpresa.upsert({
        where: { empresaId_modulo: { empresaId: empresa.id, modulo } },
        create: { empresaId: empresa.id, modulo, estado: despues },
        update: { estado: despues },
      });
      await registrarCambioAuditado(tx, {
        entidad: "ModuloEmpresa",
        entidadId: `${empresa.id}:${modulo}`,
        descripcion: descripcionDeCambioDeModulo(empresa.nombre, modulo),
        campo: "estado",
        valorAnterior: antes,
        valorNuevo: despues,
        actorId: actor.id,
      });
    }

    return { empresaId: empresa.id, cambiados: plan.cambiados, activos: plan.activos, efectivos: plan.efectivos };
  });
}
