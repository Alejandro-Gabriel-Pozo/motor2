import type { PrismaClient } from "@prisma/client";
import { modulosEfectivos, validarCambioDeModulos } from "@/core/modulos/clausura";
import { explicarErrorDeCambio, nombreDeModulo } from "@/core/modulos/vista-de-modulos";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";

/** Los módulos vendibles que la plataforma quiere activar o desactivar en una empresa. Sin ninguno, no hay nada que hacer. */
export interface CambioDeModulosPedido {
  slug: string;
  /** Email del operador de la plataforma que hace el cambio: queda en la auditoría de la empresa. Tiene que ser un usuario existente. */
  actorEmail: string;
  activar?: readonly string[];
  desactivar?: readonly string[];
}

export interface CambioDeModulosHecho {
  empresaId: string;
  /** Lo que de verdad cambió en el registro (vacío si todo ya estaba así). `antes` es `null` si el módulo no tenía fila. */
  cambiados: Array<{ modulo: string; antes: "ACTIVO" | "INACTIVO" | null; despues: "ACTIVO" | "INACTIVO" }>;
  /** Los módulos vendibles activos en el registro tras el cambio. */
  activos: string[];
  /** Con lo que cuenta la empresa tras el cambio: fijos, vendibles activos y todo lo que ellos requieren. */
  efectivos: string[];
}

export class ModulosDeEmpresaError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ModulosDeEmpresaError";
  }
}

const nombreDe = (id: string) => nombreDeModulo(id);

/**
 * Activa y desactiva módulos vendibles de una empresa en el registro `ModuloEmpresa` (ADR-011, ADR-014, ADR-015). SOLO la plataforma lo hace: lo llama
 * el script `scripts/modulos-empresa.ts` y nada de `src/` (regla `modulos-solo-desde-plataforma` de dependency-cruiser). Además la base lo exige: solo el
 * dueño y `motor2_plataforma` escriben esa tabla (RLS + REVOKE a `motor2_app` + trigger).
 *
 * La validación es la de `validarCambioDeModulos` (la misma clausura que usa el guard): no se activa un módulo en desarrollo, no se desactiva uno que otro
 * activo requiere. Desactivar deja la fila en INACTIVO; nunca se borra (ADR-012 §3: la plataforma no tiene DELETE). Cada fila que cambia deja una fila de
 * auditoría `ModuloEmpresa` a nombre de `actorEmail`; todo en una transacción. Como `cambiarPoliticaDeEmpresa`, `db` es un cliente SIN empresa y la
 * transacción fija `app.empresa_id` en la empresa elegida para poder leer su registro y escribir su auditoría con el RLS puesto.
 */
export async function cambiarModulosDeEmpresa(db: PrismaClient, pedido: CambioDeModulosPedido): Promise<CambioDeModulosHecho> {
  const activar = [...new Set(pedido.activar ?? [])];
  const desactivar = [...new Set(pedido.desactivar ?? [])];
  if (activar.length === 0 && desactivar.length === 0) throw new ModulosDeEmpresaError("No pediste ningún cambio: indicá módulos a activar o a desactivar.");
  const enAmbos = activar.filter((m) => desactivar.includes(m));
  if (enAmbos.length) throw new ModulosDeEmpresaError(`Pediste activar y desactivar a la vez: ${enAmbos.join(", ")}.`);

  return db.$transaction(async (tx) => {
    const empresa = await tx.empresa.findUnique({ where: { slug: pedido.slug }, select: { id: true, nombre: true } });
    if (!empresa) throw new ModulosDeEmpresaError(`No existe una empresa con el slug "${pedido.slug}".`);
    const actor = await tx.user.findUnique({ where: { email: pedido.actorEmail.trim().toLowerCase() }, select: { id: true } });
    if (!actor) throw new ModulosDeEmpresaError(`No existe un usuario con el email "${pedido.actorEmail}": el cambio queda a su nombre en la auditoría.`);

    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresa.id}, true)`;

    const filas = await tx.moduloEmpresa.findMany({ where: { empresaId: empresa.id } });
    const estadoActual = new Map(filas.map((f) => [f.modulo, f.estado]));
    const validacion = validarCambioDeModulos(filas.filter((f) => f.estado === "ACTIVO").map((f) => f.modulo), { activar, desactivar });
    if (!validacion.ok) throw new ModulosDeEmpresaError(validacion.errores.map(explicarErrorDeCambio).join(" "));

    const cambiados: CambioDeModulosHecho["cambiados"] = [];
    for (const [modulos, despues] of [[activar, "ACTIVO"], [desactivar, "INACTIVO"]] as const) {
      for (const modulo of modulos) {
        const antes = estadoActual.get(modulo) ?? null;
        if (antes === despues || (antes === null && despues === "INACTIVO")) continue;
        await tx.moduloEmpresa.upsert({
          where: { empresaId_modulo: { empresaId: empresa.id, modulo } },
          create: { empresaId: empresa.id, modulo, estado: despues },
          update: { estado: despues },
        });
        await registrarCambioAuditado(tx, {
          entidad: "ModuloEmpresa",
          entidadId: `${empresa.id}:${modulo}`,
          descripcion: `Empresa "${empresa.nombre}": módulo ${nombreDe(modulo)}`,
          campo: "estado",
          valorAnterior: antes,
          valorNuevo: despues,
          actorId: actor.id,
        });
        cambiados.push({ modulo, antes, despues });
      }
    }

    const activos = [...validacion.activos].sort();
    return { empresaId: empresa.id, cambiados, activos, efectivos: [...modulosEfectivos(activos)].sort() };
  });
}
