import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, crearUsuarioConMembresia, prismaAdmin, EMPRESA_POR_DEFECTO_ID } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarActivoRol, crearRol } from "../../src/server/actions/permisos/roles";
import { MENSAJE_PERMISOS_DE_PLATAFORMA } from "../../src/core/permisos/politica-de-empresa";
import { hayCupoDeRolPropio } from "../../src/core/permisos/cupo-de-roles-propios";

/**
 * Roles propios por empresa (frente 4, P2; «como pedernal,», 2026-11-16): la perilla `Empresa.rolesPropiosMax` nace en 0 y la sube la plataforma. Crear un rol propio o reactivar uno archivado exige `activos < tope`; los de sistema no cuentan;
 * bajar el tope no toca lo que ya hay. Cubre concurrencia (dos altas a la vez con cupo 1: una sola crea) e idempotencia (repetir el alta no gasta cupo).
 * Mutación: contar los roles de sistema → rojo «los de sistema no cuentan»; sacar el candado → rojo de concurrencia (o, por la serializable, un reintento que lo tapa: el resultado final sigue siendo uno solo).
 */
const poner = (rolesPropiosMax: number) => prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { rolesPropiosMax } });
const propiosActivos = () => prismaAdmin.rol.count({ where: { clave: null, activo: true } });

describe("cupo de roles propios (P2)", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  it("la regla pura: hay cupo solo con activos < tope", () => {
    expect(hayCupoDeRolPropio(0, 0)).toBe(false);
    expect(hayCupoDeRolPropio(1, 0)).toBe(true);
    expect(hayCupoDeRolPropio(1, 1)).toBe(false);
    expect(hayCupoDeRolPropio(3, 2)).toBe(true);
    expect(hayCupoDeRolPropio(3, 4)).toBe(false);
    expect(hayCupoDeRolPropio(-1, 0)).toBe(false);
    expect(hayCupoDeRolPropio(1.5, 0)).toBe(false);
  });

  it("una empresa NUEVA nace con la perilla en 0 (la columna la deja así) y no puede crear roles propios", async () => {
    const otra = await prismaAdmin.empresa.create({ data: { nombre: "Otra", slug: "otra", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS" } });
    expect(otra.rolesPropiosMax).toBe(0);
    await poner(0);
    const r = await crearRol("cajero");
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(MENSAJE_PERMISOS_DE_PLATAFORMA);
    expect(await propiosActivos()).toBe(0);
  });

  it("con cupo 1 crea uno y el siguiente se rechaza; archivar libera el cupo y reactivar vuelve a contarlo", async () => {
    await poner(1);
    expect((await crearRol("cajero")).ok).toBe(true);
    const segundo = await crearRol("mozo");
    expect(segundo.ok).toBe(false);
    expect(segundo.mensaje).toBe(MENSAJE_PERMISOS_DE_PLATAFORMA);

    const cajero = await prismaAdmin.rol.findFirstOrThrow({ where: { nombre: "cajero" } });
    expect((await actualizarActivoRol(cajero.id, false)).ok).toBe(true);
    expect((await crearRol("mozo")).ok).toBe(true); // el cupo se liberó
    const reactivar = await actualizarActivoRol(cajero.id, true); // ya hay uno activo: sin cupo
    expect(reactivar.ok).toBe(false);
    expect(reactivar.mensaje).toBe(MENSAJE_PERMISOS_DE_PLATAFORMA);
    expect((await prismaAdmin.rol.findUniqueOrThrow({ where: { id: cajero.id } })).activo).toBe(false);
  });

  it("los roles de sistema (admin y operador) no cuentan para el cupo", async () => {
    await poner(1);
    expect(await prismaAdmin.rol.count({ where: { clave: { not: null } } })).toBeGreaterThanOrEqual(2);
    expect((await crearRol("cajero")).ok).toBe(true);
  });

  it("IDEMPOTENCIA: repetir el alta del mismo nombre devuelve «Ya existe el rol» y no gasta cupo; activar uno ya activo no gasta cupo", async () => {
    await poner(2);
    expect((await crearRol("cajero")).ok).toBe(true);
    const repetido = await crearRol("cajero");
    expect(repetido.ok).toBe(false);
    expect(repetido.mensaje).toMatch(/Ya existe/);
    expect((await crearRol("mozo")).ok).toBe(true); // el cupo 2 sigue disponible para otro nombre
    const cajero = await prismaAdmin.rol.findFirstOrThrow({ where: { nombre: "cajero" } });
    expect((await actualizarActivoRol(cajero.id, true)).ok).toBe(true); // ya activo: no cambia nada ni exige cupo
    expect(await propiosActivos()).toBe(2);
  });

  it("CONCURRENCIA: dos altas a la vez con cupo 1: una sola crea y la otra recibe el rechazo", async () => {
    await poner(1);
    const resultados = await Promise.all([crearRol("cajero"), crearRol("mozo")]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await propiosActivos()).toBe(1);
  });

  it("CONCURRENCIA DETERMINISTA: con el INSERT de «Rol» demorado 0,4 s, cinco altas a la vez con cupo 1: una sola gana y el resto recibe el rechazo de cupo (sin el candado por empresa, todas pasaban el conteo)", async () => {
    await poner(1);
    // El trigger alarga la ventana entre contar y confirmar: sin `tomarCandadoDeRolesPropios` todas las altas cuentan 0 antes de que alguna inserte.
    await prismaAdmin.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION "demorar_alta_rol_p2"() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $f$`);
    await prismaAdmin.$executeRawUnsafe(`CREATE TRIGGER "demorar_alta_rol_p2" BEFORE INSERT ON "Rol" FOR EACH ROW EXECUTE FUNCTION "demorar_alta_rol_p2"()`);
    try {
      const resultados = await Promise.all(["alta-uno", "alta-dos", "alta-tres", "alta-cuatro", "alta-cinco"].map((n) => crearRol(n)));
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const rechazados = resultados.filter((r) => !r.ok);
      expect(rechazados).toHaveLength(4);
      for (const r of rechazados) expect(r.mensaje).toBe(MENSAJE_PERMISOS_DE_PLATAFORMA);
      expect(await propiosActivos()).toBe(1);
    } finally {
      await prismaAdmin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "demorar_alta_rol_p2" ON "Rol"`);
      await prismaAdmin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "demorar_alta_rol_p2"()`);
    }
  });

  it("CONCURRENCIA: dos reactivaciones a la vez con un solo cupo libre: una sola reactiva", async () => {
    await poner(2);
    expect((await crearRol("cajero")).ok).toBe(true);
    expect((await crearRol("mozo")).ok).toBe(true);
    const roles = await prismaAdmin.rol.findMany({ where: { clave: null } });
    for (const r of roles) expect((await actualizarActivoRol(r.id, false)).ok).toBe(true);
    await poner(1);
    const resultados = await Promise.all(roles.map((r) => actualizarActivoRol(r.id, true)));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await propiosActivos()).toBe(1);
  });

  it("bajar el tope NO desactiva ni edita ningún rol que ya existe: solo impide crear y reactivar", async () => {
    await poner(3);
    for (const nombre of ["a-uno", "a-dos", "a-tres"]) expect((await crearRol(nombre)).ok).toBe(true);
    await poner(0);
    expect(await propiosActivos()).toBe(3);
    expect((await crearRol("a-cuatro")).ok).toBe(false);
    const uno = await prismaAdmin.rol.findFirstOrThrow({ where: { nombre: "a-uno" } });
    expect((await actualizarActivoRol(uno.id, false)).ok).toBe(true); // desactivar siempre se puede
  });
});
