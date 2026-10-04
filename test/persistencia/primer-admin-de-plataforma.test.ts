import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { descifrarSecreto } from "../../src/core/plataforma/cifrado";
import { AdminDePlataformaInvalidoError, crearAdminDePlataforma } from "../../src/core/plataforma/primer-admin";
import { codigoTotp, pasoDeTotp } from "../../src/core/plataforma/totp";
import { prepararCodigoDeIngreso, verificarCodigoDeIngreso, verificarSegundoFactor, type DependenciasDeIngreso } from "../../plataforma/src/servidor/ingreso";
import { prismaAdmin } from "../setup/test-db";

/**
 * El alta del primer administrador de plataforma (E4, ADR-019) contra Postgres real: lo que queda en la base es solo secreto cifrado y hashes, lo que se le
 * muestra a la persona alcanza para ingresar de verdad por la consola, y un email que ya es de un administrador o de un usuario de empresa se rechaza sin
 * dejar nada a medias.
 */
const SECRETOS = { claveTotp: randomBytes(32).toString("base64"), secretoCodigos: "c".repeat(40) };
const AHORA = new Date("2026-10-03T12:00:00.000Z");
const deps: DependenciasDeIngreso = { ahora: () => AHORA, secretoDeCodigos: SECRETOS.secretoCodigos, claveTotp: SECRETOS.claveTotp };

afterEach(async () => {
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "SesionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeRecuperacionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeIngresoPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
  await prismaAdmin.user.deleteMany({ where: { email: "usuario@empresa.test" } });
});

afterAll(() => prismaAdmin.$disconnect());

describe("crearAdminDePlataforma", () => {
  it("guarda el secreto TOTP cifrado y solo el hash de cada código de recuperación; nada en claro", async () => {
    const creado = await crearAdminDePlataforma(prismaAdmin, { email: "  Dueno@Plataforma.TEST ", nombre: " Dueño " }, SECRETOS);
    expect(creado.email).toBe("dueno@plataforma.test");
    expect(creado.codigosDeRecuperacion).toHaveLength(10);
    expect(creado.uriOtpauth).toContain(creado.secretoTotp);

    const admin = await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: creado.id } });
    expect(admin).toMatchObject({ email: "dueno@plataforma.test", nombre: "Dueño", activo: true });
    expect(admin.secretoTotp).not.toContain(creado.secretoTotp);
    expect(descifrarSecreto(admin.secretoTotp, SECRETOS.claveTotp, creado.id)).toBe(creado.secretoTotp);

    const codigos = await prismaAdmin.codigoDeRecuperacionPlataforma.findMany({ where: { adminId: creado.id } });
    expect(codigos).toHaveLength(10);
    for (const { hashCodigo } of codigos) {
      expect(hashCodigo).toMatch(/^[0-9a-f]{64}$/);
      for (const codigo of creado.codigosDeRecuperacion) expect(hashCodigo).not.toContain(codigo.replace("-", ""));
    }
  });

  it("lo que se le muestra a la persona alcanza para ingresar por la consola: código del mail + TOTP, y un código de recuperación", async () => {
    const creado = await crearAdminDePlataforma(prismaAdmin, { email: "dueno@plataforma.test", nombre: "Dueño" }, SECRETOS);

    const mensaje = await prepararCodigoDeIngreso(prismaAdmin, deps, creado.email);
    const codigo = /\b(\d{6})\b/.exec(mensaje!.texto)![1];
    const paso1 = await verificarCodigoDeIngreso(prismaAdmin, deps, creado.email, codigo);
    expect(paso1.ok).toBe(true);
    const paso2 = await verificarSegundoFactor(prismaAdmin, deps, paso1.ok ? paso1.token : "", codigoTotp(creado.secretoTotp, pasoDeTotp(AHORA.getTime())));
    expect(paso2.ok).toBe(true);

    const mensaje2 = await prepararCodigoDeIngreso(prismaAdmin, deps, creado.email);
    const paso1b = await verificarCodigoDeIngreso(prismaAdmin, deps, creado.email, /\b(\d{6})\b/.exec(mensaje2!.texto)![1]);
    const paso2b = await verificarSegundoFactor(prismaAdmin, deps, paso1b.ok ? paso1b.token : "", creado.codigosDeRecuperacion[0]);
    expect(paso2b.ok).toBe(true);
  });

  it("rechaza un email repetido (aunque cambien mayúsculas) y no deja nada a medias", async () => {
    await crearAdminDePlataforma(prismaAdmin, { email: "dueno@plataforma.test", nombre: "Dueño" }, SECRETOS);
    await expect(crearAdminDePlataforma(prismaAdmin, { email: "DUENO@plataforma.test", nombre: "Otro" }, SECRETOS)).rejects.toThrow(AdminDePlataformaInvalidoError);
    expect(await prismaAdmin.adminPlataforma.count()).toBe(1);
    expect(await prismaAdmin.codigoDeRecuperacionPlataforma.count()).toBe(10);
  });

  it("rechaza un email que ya es de un usuario de una empresa: el administrador no entra a ninguna", async () => {
    await prismaAdmin.user.create({ data: { email: "Usuario@Empresa.test" } });
    await expect(crearAdminDePlataforma(prismaAdmin, { email: "usuario@empresa.test", nombre: "Alguien" }, SECRETOS)).rejects.toThrow(/usuario de una empresa/);
    expect(await prismaAdmin.adminPlataforma.count()).toBe(0);
  });

  it("rechaza un email mal formado y un nombre vacío sin tocar la base", async () => {
    await expect(crearAdminDePlataforma(prismaAdmin, { email: "no-es-un-email", nombre: "X" }, SECRETOS)).rejects.toThrow(/email no es válido/);
    await expect(crearAdminDePlataforma(prismaAdmin, { email: "a@b.test", nombre: "   " }, SECRETOS)).rejects.toThrow(/nombre/);
    expect(await prismaAdmin.adminPlataforma.count()).toBe(0);
  });
});
