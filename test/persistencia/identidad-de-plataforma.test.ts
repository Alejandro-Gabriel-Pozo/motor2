import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma, prismaAdmin } from "../setup/test-db";

/**
 * Identidad de la consola de plataforma (E4, ADR-012 §1/§3, ADR-019): las cinco tablas de `20261009120000_admin_de_plataforma` y
 * `20261009130000_auditoria_de_plataforma`. Lo que se cuida: la aplicación (`motor2_app`) NO las toca, el email se guarda normalizado, y la
 * auditoría de plataforma es append-only. La mitad con el rol real `motor2_plataforma` corre solo si hay PLATAFORMA_DATABASE_URL (la base de test
 * local no crea el rol; el job `integracion` de CI sí, con scripts/operaciones/crear-rol-motor2-plataforma.sql).
 */
const TABLAS = ["AdminPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma", "AuditoriaPlataforma"] as const;

afterAll(() => prismaAdmin.$disconnect());

afterEach(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "SesionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeRecuperacionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeIngresoPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
});

// Código SQLSTATE 42501 (insufficient_privilege): el texto del servidor sale localizado ("permiso denegado"), el código no.
const SIN_PERMISO = /42501|permission denied|permiso denegado|append-only/i;

const ADMIN = { email: "admin@plataforma.test", nombre: "Admin", secretoTotp: "secreto-cifrado" };

describe("la aplicación (motor2_app) no ve ni escribe la identidad de plataforma", () => {
  it.each(TABLAS)("%s: ni SELECT ni INSERT ni UPDATE ni DELETE", async (tabla) => {
    // Mutación: darle un GRANT a motor2_app sobre la tabla (o quitar el REVOKE de la migración) pone este test en rojo.
    const [{ privilegios }] = await prismaAdmin.$queryRawUnsafe<Array<{ privilegios: string[] }>>(
      `SELECT ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege('motor2_app', '"${tabla}"', p)) AS privilegios`,
    );
    expect(privilegios).toEqual([]);
    await expect(prisma.$queryRawUnsafe(`SELECT 1 FROM "${tabla}"`)).rejects.toThrow(SIN_PERMISO);
  });
});

describe("AdminPlataforma como dueño (el que migra)", () => {
  it("guarda el email ya normalizado: mayúsculas o espacios se rechazan por CHECK, y el email es único", async () => {
    await expect(prismaAdmin.adminPlataforma.create({ data: { ...ADMIN, email: "Admin@Plataforma.test" } })).rejects.toThrow(/AdminPlataforma_email_normalizado_check/);
    await expect(prismaAdmin.adminPlataforma.create({ data: { ...ADMIN, email: " admin@plataforma.test" } })).rejects.toThrow(/AdminPlataforma_email_normalizado_check/);
    await prismaAdmin.adminPlataforma.create({ data: ADMIN });
    await expect(prismaAdmin.adminPlataforma.create({ data: ADMIN })).rejects.toThrow(/Unique constraint/);
  });

  it("nace activo, sin fallos de segundo factor y sin paso TOTP usado", async () => {
    const admin = await prismaAdmin.adminPlataforma.create({ data: ADMIN });
    expect(admin).toMatchObject({ activo: true, fallosSegundoFactor: 0, ultimoPasoTotp: null, bloqueadoHasta: null });
  });

  it("un administrador con códigos o sesiones no se puede borrar (FK RESTRICT): se desactiva", async () => {
    const admin = await prismaAdmin.adminPlataforma.create({ data: ADMIN });
    await prismaAdmin.sesionPlataforma.create({ data: { adminId: admin.id, hashToken: "hash-1" } });
    await expect(prismaAdmin.adminPlataforma.delete({ where: { id: admin.id } })).rejects.toThrow();
  });

  it("un código de recuperación no se repite para el mismo administrador", async () => {
    const admin = await prismaAdmin.adminPlataforma.create({ data: ADMIN });
    await prismaAdmin.codigoDeRecuperacionPlataforma.create({ data: { adminId: admin.id, hashCodigo: "h" } });
    await expect(prismaAdmin.codigoDeRecuperacionPlataforma.create({ data: { adminId: admin.id, hashCodigo: "h" } })).rejects.toThrow(/Unique constraint/);
  });
});

describe("AuditoriaPlataforma: append-only, sin FK al administrador y sin `empresaId`", () => {
  it("guarda adminId y adminEmail como texto (sin FK) y la empresa afectada en `empresaAfectadaId`", async () => {
    const fila = await prismaAdmin.auditoriaPlataforma.create({ data: { adminId: "no-existe", adminEmail: "x@y.test", accion: "alta-de-empresa", empresaAfectadaId: "norte", detalle: { slug: "norte" } } });
    expect(fila).toMatchObject({ adminId: "no-existe", empresaAfectadaId: "norte" });
  });

  it("tiene los triggers que rechazan UPDATE, DELETE y TRUNCATE a quien no es el dueño", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`
      SELECT tgname::text AS nombre FROM pg_trigger WHERE tgrelid = '"AuditoriaPlataforma"'::regclass AND NOT tgisinternal ORDER BY 1`;
    expect(filas.map((f) => f.nombre)).toEqual(["AuditoriaPlataforma_inmutable_fila", "AuditoriaPlataforma_inmutable_truncate"]);
  });
});

describe.skipIf(!process.env.PLATAFORMA_DATABASE_URL)("con el rol motor2_plataforma real", () => {
  const plataforma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.PLATAFORMA_DATABASE_URL ?? "" }) });
  afterAll(() => plataforma.$disconnect());

  // Lista cerrada: es la misma que documenta scripts/operaciones/crear-rol-motor2-plataforma.sql. Una tabla nueva no entra sola.
  const LECTURA_Y_ALTA_Y_CAMBIO = ["Empresa", "User", "ModuloEmpresa", "AdminPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma"];
  const LECTURA_Y_ALTA = ["Accion", "Rol", "PermisoRol", "Unidad", "MotivoMerma", "DestinoConsumo", "Sucursal", "UsuarioEmpresa", "UsuarioSucursal", "RegistroAuditoria", "AuditoriaPlataforma"];
  const PRIVILEGIOS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

  it("tiene los privilegios mínimos, tabla por tabla: nunca DELETE, nada sobre las tablas de operación", async () => {
    const tablas = await prismaAdmin.$queryRaw<Array<{ tabla: string }>>`
      SELECT tablename::text AS tabla FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`;
    const reales: Record<string, string[]> = {};
    for (const { tabla } of tablas) {
      const [{ privilegios }] = await prismaAdmin.$queryRawUnsafe<Array<{ privilegios: string[] }>>(
        `SELECT ARRAY(SELECT p FROM unnest($1::text[]) p WHERE has_table_privilege('motor2_plataforma', '"${tabla}"', p)) AS privilegios`,
        PRIVILEGIOS,
      );
      reales[tabla] = privilegios;
    }
    const esperados: Record<string, string[]> = {};
    for (const { tabla } of tablas) {
      esperados[tabla] = LECTURA_Y_ALTA_Y_CAMBIO.includes(tabla) ? ["SELECT", "INSERT", "UPDATE"] : LECTURA_Y_ALTA.includes(tabla) ? ["SELECT", "INSERT"] : [];
    }
    expect(reales).toEqual(esperados);
  });

  it("escribe y lee la identidad (con RLS: política por nombre de rol) pero no puede borrar", async () => {
    const admin = await plataforma.adminPlataforma.create({ data: ADMIN });
    expect(await plataforma.adminPlataforma.count()).toBe(1);
    await plataforma.adminPlataforma.update({ where: { id: admin.id }, data: { activo: false } });
    await expect(plataforma.adminPlataforma.delete({ where: { id: admin.id } })).rejects.toThrow(SIN_PERMISO);
  });

  it("puede agregar a la auditoría de plataforma pero no modificarla ni borrarla (ni siquiera con permiso: el trigger lo frena)", async () => {
    const fila = await plataforma.auditoriaPlataforma.create({ data: { adminId: "a", adminEmail: "a@y.test", accion: "ingreso" } });
    await expect(plataforma.auditoriaPlataforma.update({ where: { id: fila.id }, data: { accion: "otra" } })).rejects.toThrow(SIN_PERMISO);
    await expect(plataforma.auditoriaPlataforma.delete({ where: { id: fila.id } })).rejects.toThrow(SIN_PERMISO);
  });
});
