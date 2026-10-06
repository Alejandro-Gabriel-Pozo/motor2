import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { medirPrecargadosSinGoogle } from "../../scripts/lecturas-de-auth";

/** Cuántos precargados faltan migrar a invitaciones antes de apagar `allowDangerousEmailAccountLinking`. */
describe("medirPrecargadosSinGoogle", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
  });

  const cuenta = (userId: string, provider: string) => prisma.account.create({ data: { userId, type: "oidc", provider, providerAccountId: `${provider}-${userId}` } });

  it("base vacía: todo en cero", async () => {
    expect(await medirPrecargadosSinGoogle(prisma)).toEqual({ totalDeUsuarios: 0, conGoogle: 0, precargadosSinGoogle: 0, precargadosActivosSinGoogle: 0, emailsPendientes: [] });
  });

  it("separa a quien ya entró con Google de los precargados, y de estos a los desactivados", async () => {
    const entro = await prisma.user.create({ data: { email: "entro@x.com" } });
    await cuenta(entro.id, "google");
    await prisma.user.create({ data: { email: "pendiente-b@x.com" } });
    await prisma.user.create({ data: { email: "pendiente-a@x.com" } });
    await prisma.user.create({ data: { email: "apagado@x.com", activoGlobal: false } });

    expect(await medirPrecargadosSinGoogle(prisma)).toEqual({
      totalDeUsuarios: 4,
      conGoogle: 1,
      precargadosSinGoogle: 3,
      precargadosActivosSinGoogle: 2,
      emailsPendientes: ["pendiente-a@x.com", "pendiente-b@x.com"],
    });
  });

  it("una cuenta de otro proveedor no cuenta como haber entrado con Google", async () => {
    const otro = await prisma.user.create({ data: { email: "otro@x.com" } });
    await cuenta(otro.id, "github");
    expect((await medirPrecargadosSinGoogle(prisma)).precargadosSinGoogle).toBe(1);
  });
});
