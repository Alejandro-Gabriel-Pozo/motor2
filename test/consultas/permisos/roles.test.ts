import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { listarRolesActivos } from "../../../src/server/consultas/permisos/roles";

/**
 * `src/server/consultas/permisos/roles.ts` (Task #41, Fase D5) contra Postgres real.
 *
 * `listarRolesActivos` reemplaza, SIN cambiar su forma, el `prisma.rol.findMany({ where: { activo: true }, orderBy: { nombre:
 * "asc" } })` que hacía en línea `/administracion/usuarios`: solo los roles activos, ordenados por nombre, con los escalares
 * de `Rol` y ninguna relación (es lo que la página serializa al cliente para el selector de rol).
 */

const ESCALARES_ROL = Object.keys(Prisma.RolScalarFieldEnum).sort();

describe("server/consultas/permisos/roles", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    // Sembrados fuera de orden alfabético a propósito, activos e inactivos intercalados.
    await prisma.rol.create({ data: { nombre: "mozo" } });
    await prisma.rol.create({ data: { nombre: "bartender", activo: false } });
    await prisma.rol.create({ data: { nombre: "admin" } });
    await prisma.rol.create({ data: { nombre: "zz_retirado", activo: false } });
    await prisma.rol.create({ data: { nombre: "cajero" } });
  });

  describe("listarRolesActivos", () => {
    it("trae SOLO los roles activos, ordenados por nombre ascendente", async () => {
      const roles = await listarRolesActivos();
      expect(roles.map((r) => r.nombre)).toEqual(["admin", "cajero", "mozo"]);
      expect(roles.every((r) => r.activo)).toBe(true);
    });

    it("devuelve los escalares de Rol y NINGUNA relación (ni usuarios ni permisos)", async () => {
      const [primero] = await listarRolesActivos();
      expect(Object.keys(primero).sort()).toEqual(ESCALARES_ROL);
    });

    it("un rol que se desactiva deja de aparecer, y uno que se reactiva vuelve en su lugar alfabético", async () => {
      await prisma.rol.update({ where: { nombre: "cajero" }, data: { activo: false } });
      await prisma.rol.update({ where: { nombre: "bartender" }, data: { activo: true } });
      expect((await listarRolesActivos()).map((r) => r.nombre)).toEqual(["admin", "bartender", "mozo"]);
    });

    it("devuelve [] si no hay ningún rol activo", async () => {
      await prisma.rol.updateMany({ data: { activo: false } });
      expect(await listarRolesActivos()).toEqual([]);
    });

    it("acepta el cliente de una transacción como `db`", async () => {
      const roles = await prisma.$transaction(async (tx) => {
        await tx.rol.create({ data: { nombre: "ayudante" } });
        return listarRolesActivos(tx);
      });
      expect(roles.map((r) => r.nombre)).toEqual(["admin", "ayudante", "cajero", "mozo"]);
    });
  });
});
