import type { PrismaClient } from "@prisma/client";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { PERFILES_DE_POLITICA, type NombreDePerfilDePolitica, type PoliticaDeEmpresa } from "@/core/permisos/politica-de-empresa";

/** Una perilla (o un perfil de política, que fija las dos) que la plataforma quiere cambiar. Sin ninguna, no hay nada que hacer. */
export interface CambioDePoliticaPedido {
  slug: string;
  /** Email del operador de la plataforma que hace el cambio: queda en la auditoría de la empresa. Tiene que ser un usuario existente. */
  actorEmail: string;
  perfil?: NombreDePerfilDePolitica;
  permisosEditables?: boolean;
  dosPaneles?: boolean;
}

export interface CambioDePoliticaHecho {
  empresaId: string;
  politica: PoliticaDeEmpresa;
  /** Las perillas que de verdad cambiaron de valor (vacío si todo ya estaba así). */
  cambiadas: Array<keyof PoliticaDeEmpresa>;
}

export class PoliticaDeEmpresaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "PoliticaDeEmpresaError";
  }
}

const DESCRIPCION_DE_PERILLA: Record<keyof PoliticaDeEmpresa, string> = {
  permisosEditables: "la empresa puede editar permisos",
  dosPaneles: "menú en dos paneles (Empresa y Sucursal)",
};

/**
 * Cambia la política de una empresa (add-on de plataforma, ADR-008/ADR-010). SOLO la plataforma lo hace: lo llama el script
 * `scripts/politica-empresa.ts` y nada de `src/` (regla `politica-solo-desde-plataforma` de dependency-cruiser + guardián
 * `politica-de-empresa-solo-plataforma.test.ts`). Un `perfil` fija las dos perillas; las perillas sueltas se aplican después y lo pisan.
 *
 * Cada perilla que cambia deja una fila de auditoría `Empresa` (de la empresa entera, sin sucursal) a nombre de `actorEmail`; todo en una
 * transacción, así que no queda un cambio sin su rastro. Como `crearEmpresa`, `db` es un cliente SIN empresa (el del proceso) y la transacción
 * fija `app.empresa_id` en la empresa elegida para poder escribir su auditoría con el RLS puesto.
 */
export async function cambiarPoliticaDeEmpresa(db: PrismaClient, pedido: CambioDePoliticaPedido): Promise<CambioDePoliticaHecho> {
  const pedidas: Partial<PoliticaDeEmpresa> = { ...(pedido.perfil ? PERFILES_DE_POLITICA[pedido.perfil] : {}) };
  if (pedido.permisosEditables !== undefined) pedidas.permisosEditables = pedido.permisosEditables;
  if (pedido.dosPaneles !== undefined) pedidas.dosPaneles = pedido.dosPaneles;
  if (Object.keys(pedidas).length === 0) throw new PoliticaDeEmpresaError("No pediste ningún cambio: indicá un perfil o alguna perilla.");

  return db.$transaction(async (tx) => {
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true, nombre: true, permisosEditables: true, dosPaneles: true } });
    if (!empresa) throw new PoliticaDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);
    const actor = await tx.user.findUnique({ where: { email: pedido.actorEmail.trim().toLowerCase() }, select: { id: true } });
    if (!actor) throw new PoliticaDeEmpresaError(`No existe un usuario con el email "${pedido.actorEmail}": el cambio queda a su nombre en la auditoría.`);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const antes: PoliticaDeEmpresa = { permisosEditables: empresa.permisosEditables, dosPaneles: empresa.dosPaneles };
    const despues: PoliticaDeEmpresa = { ...antes, ...pedidas };
    const cambiadas = (Object.keys(despues) as Array<keyof PoliticaDeEmpresa>).filter((perilla) => despues[perilla] !== antes[perilla]);
    if (cambiadas.length === 0) return { empresaId: empresa.id, politica: despues, cambiadas };

    await tx.empresa.update({ where: { id: empresa.id }, data: despues });
    for (const perilla of cambiadas) {
      await registrarCambioAuditado(tx, {
        entidad: "Empresa",
        entidadId: empresa.id,
        descripcion: `Empresa "${empresa.nombre}": ${DESCRIPCION_DE_PERILLA[perilla]}`,
        campo: perilla,
        valorAnterior: antes[perilla],
        valorNuevo: despues[perilla],
        actorId: actor.id,
      });
    }
    return { empresaId: empresa.id, politica: despues, cambiadas };
  });
}
