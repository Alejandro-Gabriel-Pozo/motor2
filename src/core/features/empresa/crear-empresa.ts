import type { PrismaClient } from "@prisma/client";
import { verificarRolDeEjecucion } from "@/core/auth/rol-de-ejecucion";
import { DESTINOS_CONSUMO_SEMILLA, MOTIVOS_MERMA_SEMILLA } from "@/core/movimientos/public";
import { ACCIONES } from "@/core/permisos/acciones";
import { crearEmpresaConAdminSchema, esTransicionValida, type ComandoCrearEmpresaConAdmin } from "./empresa.schema";

/** Mismas 5 unidades base que `prisma/seed.ts` (decimales por magnitud, como DECIMALES_DEFAULT_POR_CATEGORIA_ de Apps Script). */
const UNIDADES_BASE: ReadonlyArray<{ nombre: string; magnitud: "PESO" | "VOLUMEN" | "CANTIDAD"; decimales: number }> = [
  { nombre: "kg", magnitud: "PESO", decimales: 2 },
  { nombre: "g", magnitud: "PESO", decimales: 0 },
  { nombre: "l", magnitud: "VOLUMEN", decimales: 2 },
  { nombre: "ml", magnitud: "VOLUMEN", decimales: 0 },
  { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 },
];

/** Regla de negocio (ADR-007): quien crea la empresa —su primer admin— es su «gerente». */
const ROL_EMPRESA_DEL_PRIMER_ADMIN = "gerente";

export class EmpresaYaExisteError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "EmpresaYaExisteError";
  }
}

export interface EmpresaCreada {
  empresaId: string;
  slug: string;
  sucursalId: string;
  usuarioId: string;
  emailPrimerAdmin: string;
}

/**
 * Alta de una empresa completa (ADR-007, A7), TODO en una transacción: la `Empresa` nace `PROVISIONING`, se le siembra lo mismo que
 * `prisma/seed.ts` siembra para la primera (roles admin/operador con su matriz de permisos, unidades base, motivos de merma y destinos
 * de consumo), su primera sucursal y su primer admin (`UsuarioEmpresa.rolEmpresa = 'gerente'` + membresía de sucursal con rol admin), y
 * recién al final pasa a `ACTIVE`. Si algo falla, no queda nada: nunca hay una empresa `ACTIVE` a medias.
 *
 * `db` es un cliente SIN empresa (el del proceso, `DATABASE_URL`): la transacción fija `app.empresa_id` en la empresa nueva (local a la
 * transacción), así que con el rol `motor2_app` el RLS deja escribir solo en ella. Con un rol que salta el RLS (dueño, superusuario, BYPASSRLS)
 * se niega si la empresa nueva deja más de una activa (mismo criterio que `verificarRolDeEjecucion`).
 *
 * No es idempotente a propósito: si el slug o el nombre ya existen falla con `EmpresaYaExisteError` sin tocar nada (re-correrlo por error no
 * debe «completar» ni pisar una empresa que ya tiene datos).
 */
export async function crearEmpresa(db: PrismaClient, entrada: ComandoCrearEmpresaConAdmin): Promise<EmpresaCreada> {
  const { nombre, slug, zonaHoraria, moneda, emailPrimerAdmin, nombreSucursal } = crearEmpresaConAdminSchema.parse(entrada);

  await verificarRolDeEjecucion(db, undefined, 1);

  return db.$transaction(
    async (tx) => {
      const existente = await tx.empresa.findFirst({ where: { OR: [{ slug }, { nombre }] }, select: { slug: true, nombre: true } });
      if (existente) {
        throw new EmpresaYaExisteError(
          existente.slug === slug ? `Ya existe una empresa con el slug "${slug}".` : `Ya existe una empresa con el nombre "${nombre}".`,
        );
      }

      const { id: empresaId } = await tx.empresa.create({ data: { nombre, slug, zonaHoraria, moneda, estado: "PROVISIONING" } });
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`;

      // `Accion` es global (una fila por clave para todo el sistema): las de la primera empresa ya están, no se pisan.
      await tx.accion.createMany({ data: ACCIONES.map((a) => ({ clave: a.clave, descripcion: a.descripcion })), skipDuplicates: true });

      const rolAdmin = await tx.rol.create({ data: { empresaId, nombre: "admin" } });
      const rolOperador = await tx.rol.create({ data: { empresaId, nombre: "operador" } });
      const rolesPorNombre = { admin: rolAdmin, operador: rolOperador } as const;
      await tx.permisoRol.createMany({
        data: ACCIONES.flatMap((accion) =>
          (["admin", "operador"] as const).map((nombreRol) => {
            const puedeEditar = accion.rolesEditarSemilla.includes(nombreRol);
            // Ver arranca igual a Editar (mismo estado que en el seed).
            return { empresaId, rolId: rolesPorNombre[nombreRol].id, accionClave: accion.clave, puedeEditar, puedeVer: puedeEditar };
          }),
        ),
      });

      await tx.unidad.createMany({ data: UNIDADES_BASE.map((u) => ({ empresaId, ...u })) });
      await tx.motivoMerma.createMany({ data: MOTIVOS_MERMA_SEMILLA.map((m) => ({ empresaId, nombre: m.nombre, descripcion: m.descripcion ?? null })) });
      await tx.destinoConsumo.createMany({ data: DESTINOS_CONSUMO_SEMILLA.map((d) => ({ empresaId, nombre: d.nombre, descripcion: d.descripcion ?? null })) });

      const sucursal = await tx.sucursal.create({ data: { empresaId, nombre: nombreSucursal } });
      // `User` es global: si el primer admin ya existe en otra empresa se reusa (queda en las dos, y ve el selector de empresa).
      const usuario = await tx.user.upsert({ where: { email: emailPrimerAdmin }, update: {}, create: { email: emailPrimerAdmin } });
      await tx.usuarioEmpresa.create({ data: { usuarioId: usuario.id, empresaId, rolEmpresa: ROL_EMPRESA_DEL_PRIMER_ADMIN } });
      await tx.usuarioSucursal.create({ data: { empresaId, usuarioId: usuario.id, sucursalId: sucursal.id, rolId: rolAdmin.id } });

      if (!esTransicionValida("PROVISIONING", "ACTIVE")) throw new Error("La máquina de estados de la empresa no permite PROVISIONING → ACTIVE.");
      await tx.empresa.update({ where: { id: empresaId }, data: { estado: "ACTIVE" } });

      return { empresaId, slug, sucursalId: sucursal.id, usuarioId: usuario.id, emailPrimerAdmin };
    },
    { timeout: 30_000 },
  );
}
