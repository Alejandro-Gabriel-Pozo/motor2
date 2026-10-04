import type { PrismaClient } from "@prisma/client";
import { verificarRolDeEjecucion } from "@/core/auth/rol-de-ejecucion";
import { esEmailReservadoDeAdminPlataforma, MENSAJE_EMAIL_RESERVADO } from "@/core/plataforma/email-reservado";
import { sembrarEmpresa } from "./sembrar-empresa";
import { crearEmpresaConAdminSchema, esTransicionValida, type ComandoCrearEmpresaConAdmin } from "./empresa.schema";

/** Regla de negocio (ADR-007): quien crea la empresa —su primer admin— es su «gerente». */
const ROL_EMPRESA_DEL_PRIMER_ADMIN = "gerente";

export class EmpresaYaExisteError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "EmpresaYaExisteError";
  }
}

/** El email del primer admin es el de un administrador de plataforma: ese no entra a ninguna empresa (ADR-012 §1, ADR-019). */
export class EmailReservadoError extends Error {
  constructor() {
    super(MENSAJE_EMAIL_RESERVADO);
    this.name = "EmailReservadoError";
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
 * Alta DIRECTA de una empresa completa (ADR-007, A7), usada hoy solo como fixture de pruebas: el alta real es la de la consola de plataforma (E5, ADR-020), que
 * deja la empresa en `PROVISIONING` y al gerente por invitación. Todo en una transacción: la `Empresa` nace `PROVISIONING`, se le siembra lo mismo que
 * `prisma/seed.ts` siembra para la primera (roles admin/operador con su matriz de permisos, unidades base, motivos de merma y destinos
 * de consumo), su primera sucursal y su primer admin (`UsuarioEmpresa.rolEmpresa = 'gerente'` + membresía de sucursal con rol admin), y
 * recién al final pasa a `ACTIVE`. Si algo falla, no queda nada: nunca hay una empresa `ACTIVE` a medias.
 *
 * `db` es un cliente SIN empresa (el del proceso, `DATABASE_URL`): la transacción fija `app.empresa_id` en la empresa nueva (local a la
 * transacción), así que con el rol `motor2_app` el RLS deja escribir solo en ella. Con un rol que salta el RLS (dueño, superusuario, BYPASSRLS)
 * se niega siempre (ADR-022: `verificarRolDeEjecucion`).
 *
 * `emailsReservados` son los emails de los administradores de plataforma (los lee quien llama con el rol de plataforma, que es el único con permiso sobre
 * `AdminPlataforma`: ver `emailsDeAdminsDePlataforma`); si el del primer admin está entre ellos, el alta se rechaza antes de tocar nada.
 *
 * No es idempotente a propósito: si el slug o el nombre ya existen falla con `EmpresaYaExisteError` sin tocar nada (re-correrlo por error no
 * debe «completar» ni pisar una empresa que ya tiene datos).
 */
export async function crearEmpresa(db: PrismaClient, entrada: ComandoCrearEmpresaConAdmin, emailsReservados: readonly string[]): Promise<EmpresaCreada> {
  const { nombre, slug, zonaHoraria, moneda, emailPrimerAdmin, nombreSucursal } = crearEmpresaConAdminSchema.parse(entrada);
  if (esEmailReservadoDeAdminPlataforma(emailPrimerAdmin, emailsReservados)) throw new EmailReservadoError();

  await verificarRolDeEjecucion(db);

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

      const { rolAdmin, sucursal } = await sembrarEmpresa(tx, empresaId, nombreSucursal);
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
