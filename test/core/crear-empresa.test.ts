import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { crearEmpresa, EmpresaYaExisteError } from "../../src/core/features/empresa/crear-empresa";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { DESTINOS_CONSUMO_SEMILLA, MOTIVOS_MERMA_SEMILLA } from "../../src/core/movimientos/motivos-semilla";

/**
 * ADR-007, A7: `crearEmpresa` contra Postgres real. El código corre como `motor2_app` (`prisma`, con el que corre el script); las verificaciones
 * van como dueño (`prismaAdmin`, salta el RLS). Cada test se prueba por mutación (ver el comentario de cada uno).
 */
afterAll(() => prismaAdmin.$disconnect());

const COMANDO = {
  nombre: "Pizzería Norte",
  slug: "norte",
  zonaHoraria: "America/Argentina/Buenos_Aires",
  moneda: "ARS",
  emailPrimerAdmin: "Gerente@Norte.com",
  nombreSucursal: "Centro",
};

async function limpiarTrampas() {
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_a7_estado_rol ON "Rol"');
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_a7_estado_unidad ON "Unidad"');
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_a7_estado_membresia ON "UsuarioSucursal"');
  await prismaAdmin.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_a7_falla_membresia ON "UsuarioSucursal"');
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_a7_registrar_estado()");
  await prismaAdmin.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_a7_fallar()");
  await prismaAdmin.$executeRawUnsafe('DROP TABLE IF EXISTS "test_a7_estado_visto"');
}

beforeEach(async () => {
  await limpiarTrampas();
  await limpiarBaseDeTest();
});
afterEach(limpiarTrampas);

describe("crearEmpresa: lo que deja una empresa recién creada", () => {
  it("crea la empresa ACTIVE con sus roles, permisos, unidades, motivos, destinos, sucursal y primer admin", async () => {
    const resultado = await crearEmpresa(prisma, COMANDO);

    const empresa = await prismaAdmin.empresa.findUniqueOrThrow({ where: { slug: "norte" } });
    expect(empresa).toMatchObject({ id: resultado.empresaId, nombre: "Pizzería Norte", estado: "ACTIVE", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" });

    const roles = await prismaAdmin.rol.findMany({ where: { empresaId: empresa.id }, orderBy: { nombre: "asc" } });
    expect(roles.map((r) => r.nombre)).toEqual(["admin", "operador"]);
    // G1: los dos roles de sistema nacen con su clave estable (igual al nombre de hoy).
    expect(roles.map((r) => r.clave)).toEqual(["admin", "operador"]);

    // La matriz de permisos es la misma que siembra prisma/seed.ts: cada acción × cada rol, Ver = Editar.
    const permisos = await prismaAdmin.permisoRol.findMany({ where: { empresaId: empresa.id } });
    expect(permisos).toHaveLength(ACCIONES.length * 2);
    for (const rol of roles) {
      for (const accion of ACCIONES) {
        const esperado = (accion.rolesEditarSemilla as readonly string[]).includes(rol.nombre);
        const fila = permisos.find((p) => p.rolId === rol.id && p.accionClave === accion.clave);
        expect(fila, `${rol.nombre}/${accion.clave}`).toMatchObject({ puedeEditar: esperado, puedeVer: esperado });
      }
    }
    expect(await prismaAdmin.accion.count()).toBe(ACCIONES.length);

    const unidades = await prismaAdmin.unidad.findMany({ where: { empresaId: empresa.id }, orderBy: { nombre: "asc" } });
    expect(unidades.map((u) => u.nombre)).toEqual(["g", "kg", "l", "ml", "unidad"]);
    expect((await prismaAdmin.motivoMerma.findMany({ where: { empresaId: empresa.id } })).map((m) => m.nombre).sort()).toEqual(MOTIVOS_MERMA_SEMILLA.map((m) => m.nombre).sort());
    expect((await prismaAdmin.destinoConsumo.findMany({ where: { empresaId: empresa.id } })).map((d) => d.nombre).sort()).toEqual(DESTINOS_CONSUMO_SEMILLA.map((d) => d.nombre).sort());

    const sucursales = await prismaAdmin.sucursal.findMany({ where: { empresaId: empresa.id } });
    expect(sucursales).toHaveLength(1);
    expect(sucursales[0]).toMatchObject({ id: resultado.sucursalId, nombre: "Centro" });
  });

  it("la sucursal se llama «Central» si no se indica", async () => {
    const resultado = await crearEmpresa(prisma, { ...COMANDO, nombreSucursal: undefined });
    expect((await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: resultado.sucursalId } })).nombre).toBe("Central");
  });

  it("el primer admin es gerente de la empresa y admin de su sucursal (email normalizado a minúsculas)", async () => {
    const resultado = await crearEmpresa(prisma, COMANDO);

    const usuario = await prismaAdmin.user.findUniqueOrThrow({ where: { email: "gerente@norte.com" } });
    expect(resultado.usuarioId).toBe(usuario.id);
    const membresiaEmpresa = await prismaAdmin.usuarioEmpresa.findMany({ where: { usuarioId: usuario.id } });
    expect(membresiaEmpresa).toEqual([expect.objectContaining({ empresaId: resultado.empresaId, rolEmpresa: "gerente" })]);
    const membresiaSucursal = await prismaAdmin.usuarioSucursal.findMany({ where: { usuarioId: usuario.id }, include: { rol: true } });
    expect(membresiaSucursal).toHaveLength(1);
    expect(membresiaSucursal[0]).toMatchObject({ empresaId: resultado.empresaId, sucursalId: resultado.sucursalId });
    expect(membresiaSucursal[0].rol.nombre).toBe("admin");
  });

  it("un usuario que ya existe se reusa (queda en las dos empresas) en vez de duplicarse", async () => {
    const existente = await prismaAdmin.user.create({ data: { email: "gerente@norte.com" } });
    const resultado = await crearEmpresa(prisma, COMANDO);
    expect(resultado.usuarioId).toBe(existente.id);
    expect(await prismaAdmin.user.count({ where: { email: "gerente@norte.com" } })).toBe(1);
  });
});

describe("crearEmpresa: atomicidad", () => {
  it("la empresa está PROVISIONING mientras se siembra y pasa a ACTIVE recién al final", async () => {
    // Fault injection real en Postgres: cada fila sembrada anota en qué estado estaba la empresa en ese instante.
    // Mutación: crear la empresa ya ACTIVE (o subirla a ACTIVE antes de sembrar) deja estados ≠ PROVISIONING y este test falla.
    await prismaAdmin.$executeRawUnsafe('CREATE TABLE "test_a7_estado_visto" (tabla text NOT NULL, estado text NOT NULL)');
    await prismaAdmin.$executeRawUnsafe(`
      CREATE FUNCTION test_a7_registrar_estado() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
      BEGIN
        INSERT INTO "test_a7_estado_visto" SELECT TG_TABLE_NAME, e.estado::text FROM "Empresa" e WHERE e.id = NEW."empresaId";
        RETURN NEW;
      END $f$`);
    for (const [trigger, tabla] of [["test_a7_estado_rol", "Rol"], ["test_a7_estado_unidad", "Unidad"], ["test_a7_estado_membresia", "UsuarioSucursal"]]) {
      await prismaAdmin.$executeRawUnsafe(`CREATE TRIGGER ${trigger} AFTER INSERT ON "${tabla}" FOR EACH ROW EXECUTE FUNCTION test_a7_registrar_estado()`);
    }

    const resultado = await crearEmpresa(prisma, COMANDO);

    const vistos = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; estado: string }>>('SELECT tabla, estado FROM "test_a7_estado_visto"');
    expect([...new Set(vistos.map((v) => v.tabla))].sort()).toEqual(["Rol", "Unidad", "UsuarioSucursal"]);
    expect([...new Set(vistos.map((v) => v.estado))]).toEqual(["PROVISIONING"]);
    expect((await prismaAdmin.empresa.findUniqueOrThrow({ where: { id: resultado.empresaId } })).estado).toBe("ACTIVE");
  });

  it("si falla a mitad no queda nada: ni empresa, ni filas sembradas, ni el usuario nuevo", async () => {
    // Mutación: sacar la transacción (o hacer commits parciales) deja la empresa y sus roles/unidades huérfanos y este test falla.
    await prismaAdmin.$executeRawUnsafe(`
      CREATE FUNCTION test_a7_fallar() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'falla inyectada por el test'; END $f$`);
    await prismaAdmin.$executeRawUnsafe('CREATE TRIGGER test_a7_falla_membresia BEFORE INSERT ON "UsuarioSucursal" FOR EACH ROW EXECUTE FUNCTION test_a7_fallar()');

    await expect(crearEmpresa(prisma, COMANDO)).rejects.toThrow(/falla inyectada/);

    expect(await prismaAdmin.empresa.count({ where: { slug: "norte" } })).toBe(0);
    expect(await prismaAdmin.empresa.count()).toBe(1); // solo la empresa por defecto
    for (const modelo of [prismaAdmin.rol, prismaAdmin.permisoRol, prismaAdmin.unidad, prismaAdmin.motivoMerma, prismaAdmin.destinoConsumo, prismaAdmin.sucursal, prismaAdmin.usuarioSucursal, prismaAdmin.usuarioEmpresa, prismaAdmin.user, prismaAdmin.accion]) {
      expect(await (modelo as unknown as { count: () => Promise<number> }).count()).toBe(0);
    }
  });
});

describe("crearEmpresa: entradas rechazadas", () => {
  it("un slug que ya existe falla con un error claro y no toca nada", async () => {
    await crearEmpresa(prisma, COMANDO);
    const antes = { unidades: await prismaAdmin.unidad.count(), roles: await prismaAdmin.rol.count(), usuarios: await prismaAdmin.user.count() };

    const intento = crearEmpresa(prisma, { ...COMANDO, nombre: "Otro nombre", emailPrimerAdmin: "otro@norte.com" });
    await expect(intento).rejects.toBeInstanceOf(EmpresaYaExisteError);
    await expect(intento).rejects.toThrow('Ya existe una empresa con el slug "norte".');

    expect(await prismaAdmin.empresa.count()).toBe(2);
    expect({ unidades: await prismaAdmin.unidad.count(), roles: await prismaAdmin.rol.count(), usuarios: await prismaAdmin.user.count() }).toEqual(antes);
  });

  it("un nombre que ya existe también falla con un error claro", async () => {
    await crearEmpresa(prisma, COMANDO);
    await expect(crearEmpresa(prisma, { ...COMANDO, slug: "norte-2", emailPrimerAdmin: "otro@norte.com" })).rejects.toThrow('Ya existe una empresa con el nombre "Pizzería Norte".');
    expect(await prismaAdmin.empresa.count()).toBe(2);
  });

  it("datos inválidos (slug con mayúsculas, email mal formado) se rechazan antes de escribir", async () => {
    await expect(crearEmpresa(prisma, { ...COMANDO, slug: "Norte SA" })).rejects.toBeInstanceOf(ZodError);
    await expect(crearEmpresa(prisma, { ...COMANDO, emailPrimerAdmin: "no-es-un-email" })).rejects.toBeInstanceOf(ZodError);
    expect(await prismaAdmin.empresa.count()).toBe(1);
  });

  it("con un rol que salta el RLS (el dueño) se niega a dar de alta una segunda empresa activa", async () => {
    // Mutación: quitar el `empresasNuevas = 1` de crearEmpresa (verificarRolDeEjecucion(db)) deja pasar el alta y este test falla.
    await expect(crearEmpresa(prismaAdmin, COMANDO)).rejects.toThrow(/no queda aislado por empresa/);
    expect(await prismaAdmin.empresa.count({ where: { slug: "norte" } })).toBe(0);
  });
});
