import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import { ActorDePlataformaError, requerirAdminDePlataforma } from "../../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";

/**
 * S-33: `--actor` de los scripts de plataforma (`modulos-empresa`, `politica-empresa`) era un texto libre que solo tenía que ser un `User`: cualquier cuenta de la app (un empleado de
 * cualquier empresa, creada por una invitación) servía de «operador de plataforma» en la auditoría. Ahora el actor tiene que ser un administrador de plataforma ACTIVO (`AdminPlataforma`,
 * los que entran a la consola con doble factor). Corre con el cliente del dueño, que es el que puede leer `AdminPlataforma` en los tests (en producción, `motor2_plataforma`).
 */
afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.adminPlataforma.deleteMany();
});

const admin = (email: string, activo = true) => prismaAdmin.adminPlataforma.create({ data: { email, nombre: "Admin", secretoTotp: "x", activo } });

describe("requerirAdminDePlataforma", () => {
  it("un usuario común de la app (con cuenta, sin ser administrador de plataforma) NO sirve de actor", async () => {
    await prismaAdmin.user.create({ data: { email: "empleado@empresa.com" } });
    await expect(requerirAdminDePlataforma(prismaAdmin, "empleado@empresa.com")).rejects.toThrow(ActorDePlataformaError);
  });

  it("un email que no existe en ningún lado no sirve, y el mensaje no distingue entre «no existe» y «está desactivado»", async () => {
    await admin("baja@plataforma.com", false);
    const mensaje = (email: string) =>
      requerirAdminDePlataforma(prismaAdmin, email).then(
        () => "",
        (e: Error) => e.message,
      );
    const m1 = await mensaje("nadie@x.com");
    const m2 = await mensaje("baja@plataforma.com");
    expect(m1).toMatch(/no es un administrador de plataforma activo/);
    expect(m2).toBe(m1.replace("nadie@x.com", "baja@plataforma.com"));
  });

  it("un administrador de plataforma activo sirve, sin importar mayúsculas ni espacios", async () => {
    const creado = await admin("operador@plataforma.com");
    await expect(requerirAdminDePlataforma(prismaAdmin, "  Operador@Plataforma.COM ")).resolves.toEqual({ id: creado.id, email: "operador@plataforma.com" });
  });
});
