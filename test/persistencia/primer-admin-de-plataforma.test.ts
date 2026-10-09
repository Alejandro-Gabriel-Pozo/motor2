import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { descifrarSecreto } from "../../src/core/plataforma/cifrado";
import { generarPedidoDeIngreso } from "../../src/core/plataforma/pedido-de-ingreso";
import { AdminDePlataformaInvalidoError } from "../../src/core/plataforma/primer-admin";
import { azarDelProceso } from "../../src/lib/azar";
import { crearAdminDePlataforma } from "../../plataforma/src/servidor/alta-de-admin";
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
  // `mode: "insensitive"`: el test crea «Usuario@Empresa.test» y, sin esto, sobrevivía a la limpieza y rompía la corrida siguiente.
  await prismaAdmin.user.deleteMany({ where: { email: { equals: "usuario@empresa.test", mode: "insensitive" } } });
});

afterAll(() => prismaAdmin.$disconnect());

describe("crearAdminDePlataforma", () => {
  it("rechaza un email con una invitación pendiente a gerente (E5), pero no uno cuya invitación ya no está pendiente", async () => {
    await prismaAdmin.empresa.create({ data: { id: "alta-pa", nombre: "Alta PA", slug: "alta-pa", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    try {
      const inv = await prismaAdmin.invitacion.create({ data: { empresaId: "alta-pa", email: "invitado@empresa.test", rolEmpresa: "gerente", hashToken: "a".repeat(64), venceEn: AHORA } });
      await expect(crearAdminDePlataforma(prismaAdmin, { email: "Invitado@Empresa.test", nombre: "X" }, SECRETOS)).rejects.toThrow(/invitación pendiente/);
      expect(await prismaAdmin.adminPlataforma.count()).toBe(0);
      await prismaAdmin.invitacion.update({ where: { id: inv.id }, data: { estado: "REVOCADA", revocadaEn: AHORA } });
      await expect(crearAdminDePlataforma(prismaAdmin, { email: "invitado@empresa.test", nombre: "X" }, SECRETOS)).resolves.toBeTruthy();
    } finally {
      await prismaAdmin.invitacion.deleteMany({ where: { empresaId: "alta-pa" } });
      await prismaAdmin.empresa.delete({ where: { id: "alta-pa" } });
    }
  });

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

    // Cada pedido de código lleva el de su navegador (la cookie del pedido): el código solo se comprueba con él.
    const pedido = generarPedidoDeIngreso(azarDelProceso);
    const mensaje = await prepararCodigoDeIngreso(prismaAdmin, deps, creado.email, pedido);
    const codigo = /\b(\d{6})\b/.exec(mensaje!.texto)![1];
    const paso1 = await verificarCodigoDeIngreso(prismaAdmin, deps, creado.email, codigo, pedido);
    expect(paso1.ok).toBe(true);
    const paso2 = await verificarSegundoFactor(prismaAdmin, deps, paso1.ok ? paso1.token : "", codigoTotp(creado.secretoTotp, pasoDeTotp(AHORA.getTime())));
    expect(paso2.ok).toBe(true);

    const pedido2 = generarPedidoDeIngreso(azarDelProceso);
    const mensaje2 = await prepararCodigoDeIngreso(prismaAdmin, deps, creado.email, pedido2);
    const paso1b = await verificarCodigoDeIngreso(prismaAdmin, deps, creado.email, /\b(\d{6})\b/.exec(mensaje2!.texto)![1], pedido2);
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
