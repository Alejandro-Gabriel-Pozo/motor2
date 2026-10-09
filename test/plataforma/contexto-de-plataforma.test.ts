import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ROL_DE_PLATAFORMA } from "../../plataforma/src/entorno";
import { ConexionDePlataformaError, exigirRolDePlataforma } from "../../scripts/conexion-de-plataforma";
import { abrirContextoDePlataforma, type DependenciasDelContexto } from "../../scripts/contexto-de-plataforma";
import { ActorDePlataformaError, requerirAdminDePlataforma } from "../../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * S-33 (decisión del dueño, 2026-10-08): lo que un script de cambios de plataforma resuelve ANTES de tocar nada. El actor es un `AdminPlataforma` activo verificado contra la base de
 * IDENTIDAD de la consola (la instalación principal), sin pedir ni crear ningún `User`; cada conexión se comprueba del rol `motor2_plataforma` con `select current_user`; sin
 * `PLATAFORMA_DATABASE_URL` no se abre ninguna conexión. Con clientes falsos para el orden y el reparto entre bases, y con la base real para el actor sin `User` y para el rol.
 */
const url = (host: string, usuario = ROL_DE_PLATAFORMA, clave = "clave-secreta-uno") => `postgresql://${usuario}:${clave}@${host}:5432/neondb?sslmode=require`;
const BASE = {
  PLATAFORMA_DATABASE_URL: url("ep-principal.c-6.us-east-2.aws.neon.tech"),
  PLATAFORMA_SECRETO_CODIGOS: "x".repeat(32),
  PLATAFORMA_CLAVE_TOTP: randomBytes(32).toString("base64"),
  PLATAFORMA_URL_APP: "https://zuluhub.ejemplo.test",
  PLATAFORMA_INSTALACION_ID: "zuluhub",
  PLATAFORMA_INSTALACION_NOMBRE: "Zuluhub",
};
const CON_ADICIONAL = {
  ...BASE,
  PLATAFORMA_INSTALACIONES_ADICIONALES: JSON.stringify([{ id: "stockhneuquen", nombre: "Stock Neuquén", urlApp: "https://stock.ejemplo.test" }]),
  PLATAFORMA_DATABASE_URL_STOCKHNEUQUEN: url("ep-stock.c-2.us-west-2.aws.neon.tech", ROL_DE_PLATAFORMA, "clave-secreta-dos"),
};

interface ClienteFalso {
  url: string;
  $disconnect: ReturnType<typeof vi.fn>;
}

/** Dependencias falsas que anotan el orden de las llamadas y a qué cliente (por la URL con la que se creó) va cada una. */
function falsas(opciones: { rol?: (c: ClienteFalso) => Promise<void>; admin?: (c: ClienteFalso, email: string) => Promise<{ id: string; email: string }> } = {}) {
  const llamadas: string[] = [];
  const clientes: ClienteFalso[] = [];
  const dependencias: DependenciasDelContexto = {
    crearCliente: (u) => {
      llamadas.push(`crear:${u.includes("stock") ? "stock" : "principal"}`);
      const c: ClienteFalso = { url: u, $disconnect: vi.fn(async () => undefined) };
      clientes.push(c);
      return c as unknown as PrismaClient;
    },
    exigirRol: async (db) => {
      const c = db as unknown as ClienteFalso;
      llamadas.push(`rol:${c.url.includes("stock") ? "stock" : "principal"}`);
      await opciones.rol?.(c);
    },
    exigirAdmin: async (db, email) => {
      const c = db as unknown as ClienteFalso;
      llamadas.push(`admin:${c.url.includes("stock") ? "stock" : "principal"}`);
      return opciones.admin ? opciones.admin(c, email) : { id: "admin-1", email: email.trim().toLowerCase() };
    },
  };
  return { dependencias, llamadas, clientes };
}

describe("abrirContextoDePlataforma: lo que se resuelve antes de la operación", () => {
  it("sin --instalacion: un solo cliente (identidad y empresa son la misma base), el rol se comprueba ANTES del actor y el autor lleva la instalación de la config", async () => {
    const { dependencias, llamadas } = falsas();
    const contexto = await abrirContextoDePlataforma(BASE, { instalacion: undefined, actor: " Dueno@Plataforma.test " }, dependencias);

    expect(llamadas).toEqual(["crear:principal", "rol:principal", "admin:principal"]);
    expect(contexto.autor).toEqual({ adminId: "admin-1", adminEmail: "dueno@plataforma.test", instalacionId: "zuluhub", instalacionNombre: "Zuluhub" });
  });

  it("con --instalacion de una adicional: el administrador se verifica en la base de IDENTIDAD (la principal), no en la que se opera, y las dos conexiones se comprueban del rol", async () => {
    const { dependencias, llamadas } = falsas();
    const contexto = await abrirContextoDePlataforma(CON_ADICIONAL, { instalacion: "stockhneuquen", actor: "dueno@plataforma.test" }, dependencias);

    // Mutación: verificar al administrador con el cliente de la base que se opera (`db`) en vez del de identidad pone este test en rojo (`admin:stock`).
    expect(llamadas).toEqual(["crear:principal", "crear:stock", "rol:principal", "rol:stock", "admin:principal"]);
    expect(contexto.autor).toMatchObject({ instalacionId: "stockhneuquen", instalacionNombre: "Stock Neuquén" });
    expect((contexto.db as unknown as ClienteFalso).url).toContain("stock");
  });

  it("una sesión que no es de motor2_plataforma corta antes de buscar al administrador, y cierra lo que abrió", async () => {
    const { dependencias, llamadas, clientes } = falsas({
      rol: async () => {
        throw new ConexionDePlataformaError("La conexión no es del rol motor2_plataforma (es «motor2»)");
      },
    });
    await expect(abrirContextoDePlataforma(BASE, { instalacion: undefined, actor: "dueno@plataforma.test" }, dependencias)).rejects.toThrow(/no es del rol motor2_plataforma/);
    expect(llamadas, "no llegó a mirar quién es el actor").toEqual(["crear:principal", "rol:principal"]);
    expect(clientes.every((c) => c.$disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("un actor que no es administrador de plataforma activo no abre el contexto (la operación no se llama) y se cierra lo abierto", async () => {
    const { dependencias, clientes } = falsas({
      admin: async (_c, email) => {
        throw new ActorDePlataformaError(`"${email}" no es un administrador de plataforma activo`);
      },
    });
    await expect(abrirContextoDePlataforma(CON_ADICIONAL, { instalacion: "stockhneuquen", actor: "empleado@empresa.test" }, dependencias)).rejects.toThrow(ActorDePlataformaError);
    expect(clientes).toHaveLength(2);
    expect(clientes.every((c) => c.$disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("sin PLATAFORMA_DATABASE_URL no abre NINGUNA conexión, aunque haya DATABASE_URL (no cae en la conexión de la app)", async () => {
    const { dependencias, llamadas } = falsas();
    const sinPlataforma = { DATABASE_URL: url("ep-dueno.neon.tech", "motor2", "clave-del-duenio") };
    await expect(abrirContextoDePlataforma(sinPlataforma, { instalacion: undefined, actor: "dueno@plataforma.test" }, dependencias)).rejects.toThrow(ConexionDePlataformaError);
    expect(llamadas).toEqual([]);
  });

  it("una PLATAFORMA_DATABASE_URL de otro usuario de base no abre ninguna conexión", async () => {
    const { dependencias, llamadas } = falsas();
    const delDuenio = { ...BASE, PLATAFORMA_DATABASE_URL: url("ep-principal.c-6.us-east-2.aws.neon.tech", "motor2", "clave-del-duenio") };
    await expect(abrirContextoDePlataforma(delDuenio, { instalacion: undefined, actor: "dueno@plataforma.test" }, dependencias)).rejects.toThrow(/motor2_plataforma/);
    expect(llamadas).toEqual([]);
  });
});

describe("abrirContextoDePlataforma contra la base real", () => {
  const abiertos: PrismaClient[] = [];
  const duenio = () => {
    const c = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? "" }) });
    abiertos.push(c);
    return c;
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await prismaAdmin.adminPlataforma.deleteMany();
  });

  afterAll(async () => {
    await prismaAdmin.adminPlataforma.deleteMany();
    await limpiarBaseDeTest();
    await Promise.allSettled(abiertos.map((c) => c.$disconnect()));
    await prismaAdmin.$disconnect();
  });

  it("un AdminPlataforma activo SIN ninguna cuenta de User basta como actor (el dueño es dos cuentas distintas)", async () => {
    const admin = await prismaAdmin.adminPlataforma.create({ data: { email: "dueno@plataforma.test", nombre: "Dueño", secretoTotp: "x" } });
    expect(await prismaAdmin.user.count({ where: { email: "dueno@plataforma.test" } }), "no hay un User con ese email").toBe(0);

    const dependencias: DependenciasDelContexto = { crearCliente: () => duenio(), exigirRol: async () => undefined, exigirAdmin: requerirAdminDePlataforma };
    const contexto = await abrirContextoDePlataforma(BASE, { instalacion: undefined, actor: "Dueno@Plataforma.test" }, dependencias);
    await contexto.cerrar();

    expect(contexto.autor).toEqual({ adminId: admin.id, adminEmail: "dueno@plataforma.test", instalacionId: "zuluhub", instalacionNombre: "Zuluhub" });
    expect(await prismaAdmin.user.count(), "no se creó ningún User").toBe(0);
  });

  it("un User de la app que no es administrador de plataforma no sirve de actor, aunque exista", async () => {
    await prismaAdmin.user.create({ data: { email: "empleado@empresa.test" } });
    const dependencias: DependenciasDelContexto = { crearCliente: () => duenio(), exigirRol: async () => undefined, exigirAdmin: requerirAdminDePlataforma };
    await expect(abrirContextoDePlataforma(BASE, { instalacion: undefined, actor: "empleado@empresa.test" }, dependencias)).rejects.toThrow(ActorDePlataformaError);
  });

  it("la comprobación de rol real rechaza una sesión del dueño (select current_user ≠ motor2_plataforma)", async () => {
    // exigirRol y exigirAdmin REALES: el cliente es el del dueño, que no es motor2_plataforma.
    const dependencias: DependenciasDelContexto = { crearCliente: () => duenio(), exigirRol: exigirRolDePlataforma, exigirAdmin: requerirAdminDePlataforma };
    await expect(abrirContextoDePlataforma(BASE, { instalacion: undefined, actor: "dueno@plataforma.test" }, dependencias)).rejects.toThrow(/no es del rol motor2_plataforma \(es «/);
  });
});
