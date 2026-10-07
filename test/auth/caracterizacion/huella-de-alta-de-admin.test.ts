import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prismaAdmin } from "../../setup/test-db";
import { crearAdminDePlataforma } from "../../../plataforma/src/servidor/alta-de-admin";
import type { FuenteDeAzar } from "../../../src/core/seguridad/azar";

/**
 * HUELLA del alta de un administrador de plataforma (`crearAdminDePlataforma`, plataforma/src/servidor/alta-de-admin.ts; ADR-012 §2, ADR-019). B1 (#86) la movió desde `core` a la
 * consola SIN una huella byte a byte previa (solo tenía tests de comportamiento, `test/persistencia/primer-admin-de-plataforma.test.ts`): el plan de pureza (sección 10.2) lo anotó como
 * un desvío. Esta huella llega tarde pero fija lo que importa: con una fuente de azar FIJA y los secretos de la consola fijos, el material del alta (id, secreto TOTP, URI, códigos de
 * recuperación), lo que queda en la base (secreto cifrado y hashes) y los mensajes de cada rechazo son idénticos byte a byte. Si un paso posterior cambia una fila, un mensaje, el orden de
 * las escrituras o cómo se deriva el material del azar, este archivo lo detecta en rojo. NO se edita después. Para regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza):
 * `REGENERAR_HUELLA_DE_ALTA_DE_ADMIN=1 npx vitest run test/auth/caracterizacion/huella-de-alta-de-admin.test.ts`. Archivo propio y no snapshots de Vitest, para que `-u` no lo regenere en silencio.
 */
const ARCHIVO = join(__dirname, "huella-de-alta-de-admin.golden.txt");
// Los secretos de la consola (fuera del repositorio en producción): acá, valores fijos de prueba.
const SECRETOS = { claveTotp: Buffer.alloc(32, 7).toString("base64"), secretoCodigos: "c".repeat(40) };

/** Una fuente de azar DETERMINISTA: la misma secuencia de pedidos da siempre los mismos bytes, enteros y UUID. */
function azarFijo(desde = 0): FuenteDeAzar {
  let n = desde;
  return {
    bytes: (cantidad) => Uint8Array.from({ length: cantidad }, (_, i) => (++n * 31 + i * 17) % 256),
    entero: (minimo, maximoExclusivo) => minimo + ((++n * 2654435761) % (maximoExclusivo - minimo)),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
}

afterAll(async () => {
  await limpiar();
  await prismaAdmin.$disconnect();
});

async function limpiar() {
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "SesionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeRecuperacionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeIngresoPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
  await prismaAdmin.invitacion.deleteMany({ where: { empresaId: "alta-huella-admin" } });
  await prismaAdmin.empresa.deleteMany({ where: { id: "alta-huella-admin" } });
  await prismaAdmin.user.deleteMany({ where: { email: { in: ["usuario@empresa.test", "otra-base@empresa.test"] } } });
}

describe("Huella del alta de un administrador de plataforma", () => {
  const lineas: string[] = [];
  beforeEach(async () => {
    lineas.length = 0;
    await limpiar();
  });

  const volcado = async (): Promise<string[]> => {
    const admins = await prismaAdmin.adminPlataforma.findMany({ orderBy: { email: "asc" } });
    const codigos = await prismaAdmin.codigoDeRecuperacionPlataforma.findMany({ orderBy: [{ adminId: "asc" }, { hashCodigo: "asc" }] });
    return [
      ...admins.map((a) => `  ADMIN id=${a.id} email=${a.email} nombre=${a.nombre} activo=${a.activo} secretoTotp=${a.secretoTotp}`),
      ...codigos.map((c) => `  CODIGO adminId=${c.adminId} hash=${c.hashCodigo} usadoEn=${(c as { usadoEn?: Date | null }).usadoEn ? "<usado>" : "null"}`),
    ];
  };
  const paso = async (titulo: string, accion: () => Promise<unknown>) => {
    let resultado: string;
    try {
      resultado = `ok ${JSON.stringify(await accion())}`;
    } catch (e) {
      resultado = `error ${(e as Error).constructor.name}: ${(e as Error).message}`;
    }
    lineas.push(`### ${titulo}`, `  resultado: ${resultado}`, ...(await volcado()));
  };

  it("la secuencia entera coincide con lo guardado", async () => {
    // 1. Rechazos de formato (nada se escribe).
    await paso("1a. Email inválido", () => crearAdminDePlataforma(prismaAdmin, { email: "no-es-un-email", nombre: "X" }, SECRETOS, { azar: azarFijo() }));
    await paso("1b. Nombre vacío", () => crearAdminDePlataforma(prismaAdmin, { email: "uno@plataforma.test", nombre: "   " }, SECRETOS, { azar: azarFijo() }));

    // 2. El alta: se normaliza el email y el nombre, y se guarda el secreto cifrado y el hash de cada código.
    await paso("2a. Alta con email y nombre con mayúsculas y espacios", () => crearAdminDePlataforma(prismaAdmin, { email: "  Dueno@Plataforma.TEST ", nombre: " Dueño " }, SECRETOS, { azar: azarFijo(), emisor: "Motor 2 (huella)" }));
    await paso("2b. El mismo email otra vez", () => crearAdminDePlataforma(prismaAdmin, { email: "dueno@plataforma.test", nombre: "Otro" }, SECRETOS, { azar: azarFijo() }));
    await paso("2c. Un segundo administrador (otra secuencia de azar fija)", () => crearAdminDePlataforma(prismaAdmin, { email: "segundo@plataforma.test", nombre: "Segundo" }, SECRETOS, { azar: azarFijo(100) }));

    // 3. Conflictos en esta base.
    await prismaAdmin.user.create({ data: { email: "usuario@empresa.test" } });
    await paso("3a. El email ya es de un usuario de empresa", () => crearAdminDePlataforma(prismaAdmin, { email: "Usuario@Empresa.test", nombre: "X" }, SECRETOS, { azar: azarFijo() }));
    await prismaAdmin.empresa.create({ data: { id: "alta-huella-admin", nombre: "Alta huella", slug: "alta-huella-admin", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
    await prismaAdmin.invitacion.create({ data: { empresaId: "alta-huella-admin", email: "invitado@empresa.test", rolEmpresa: "gerente", hashToken: "a".repeat(64), venceEn: new Date(Date.now() + 3_600_000) } });
    await paso("3b. El email tiene una invitación pendiente a gerente", () => crearAdminDePlataforma(prismaAdmin, { email: "invitado@empresa.test", nombre: "X" }, SECRETOS, { azar: azarFijo() }));

    // 4. Otras instalaciones (ADR-025): un conflicto allá se rechaza antes de escribir acá; una base que no se puede revisar también.
    const otraConConflicto = {
      id: "otra",
      nombre: "Otra instalación",
      db: { user: { findFirst: async () => ({ id: "u1" }) }, invitacion: { findFirst: async () => null } } as unknown as PrismaClient,
    };
    await paso("4a. Conflicto de email en otra instalación", () => crearAdminDePlataforma(prismaAdmin, { email: "otra-base@empresa.test", nombre: "X" }, SECRETOS, { azar: azarFijo(), otrasBases: [otraConConflicto] }));
    const otraNoRevisable = {
      id: "caida",
      nombre: "Instalación caída",
      db: { user: { findFirst: async () => { throw new Error("sin conexión"); } }, invitacion: { findFirst: async () => null } } as unknown as PrismaClient,
    };
    await paso("4b. Otra instalación que no se puede revisar", () => crearAdminDePlataforma(prismaAdmin, { email: "otra-base@empresa.test", nombre: "X" }, SECRETOS, { azar: azarFijo(), otrasBases: [otraNoRevisable] }));
    const otraLibre = { id: "libre", nombre: "Instalación libre", db: { user: { findFirst: async () => null }, invitacion: { findFirst: async () => null } } as unknown as PrismaClient };
    await paso("4c. Otra instalación sin conflicto: se crea", () => crearAdminDePlataforma(prismaAdmin, { email: "tercero@plataforma.test", nombre: "Tercero" }, SECRETOS, { azar: azarFijo(200), otrasBases: [otraLibre] }));

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(2_500); // si el escenario no armó nada, esto no está mirando nada
    expect(actual).toContain("ok {"); // al menos un alta exitosa

    if (process.env.REGENERAR_HUELLA_DE_ALTA_DE_ADMIN === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta huella-de-alta-de-admin.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 120_000);
});
