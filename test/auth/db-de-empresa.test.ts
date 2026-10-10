import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { limpiarBaseDeTest, sembrarBase, prisma, prismaAdmin, prismaSinEmpresa, prismaDuenioSinEmpresa } from "../setup/test-db";
import { baseDeEmpresa, dbDeEmpresa, serializarSucursalesDelAlcance, transaccionDeEmpresa, type AlcanceDeSucursal } from "../../src/core/auth/base";
import { verificarRolDeEjecucion, datosDelRolDeEjecucion } from "../../src/core/auth/rol-de-ejecucion";
import { reportarErrorUnaVez } from "../../src/lib/reportar-error";

/**
 * ADR-007, A5: cada operación del contexto de un usuario corre con `app.empresa_id` fijado (local a su transacción). Se prueba con DOS
 * empresas ACTIVE, donde el default de `empresaId` (`app_empresa_actual()`) es NULL salvo que haya contexto: si una fila queda en la
 * empresa correcta sin decir `empresaId`, es porque el contexto llegó a la consulta.
 *
 * M.3-A2: lo mismo para el ALCANCE POR SUCURSAL (`app.sucursales_lectura`, `app.sucursales_escritura`), fijado junto con la empresa en UNA sola sentencia.
 * El cliente de `src/lib/db` se reemplaza por uno del mismo Postgres que además emite cada consulta que manda (`consultas`), para poder CONTAR las sentencias:
 * el alcance no puede sumar viajes a la base.
 */
vi.mock("../../src/lib/reportar-error", () => ({ reportarErrorUnaVez: vi.fn(async () => undefined), reportarError: vi.fn(async () => undefined) }));
const { consultas } = vi.hoisted(() => ({ consultas: [] as string[] }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }), log: [{ emit: "event", level: "query" }] });
  (prisma as unknown as { $on: (evento: "query", fn: (e: { query: string }) => void) => void }).$on("query", (e) => consultas.push(e.query));
  return { prisma };
});
afterAll(() => prismaAdmin.$disconnect());

async function crearEmpresa(id: string) {
  return prisma.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" } });
}

async function contextoDeLaConexion(cliente: Pick<typeof prisma, "$queryRaw">) {
  const [fila] = await cliente.$queryRaw<Array<{ valor: string | null }>>`SELECT current_setting('app.empresa_id', true) AS valor`;
  return fila.valor;
}

describe("dbDeEmpresa / transaccionDeEmpresa", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
    await crearEmpresa("norte");
  });

  it("una operación de modelo sin empresaId queda en la empresa del cliente (el default lee el contexto)", async () => {
    const creada = await dbDeEmpresa("norte").sucursal.create({ data: { nombre: "Sucursal Norte" } });
    expect(creada.empresaId).toBe("norte");
    const otra = await dbDeEmpresa("empresa_principal").sucursal.create({ data: { nombre: "Sucursal Principal 2" } });
    expect(otra.empresaId).toBe("empresa_principal");
  });

  it("una consulta cruda y un INSERT crudo también llevan el contexto", async () => {
    const db = dbDeEmpresa("norte");
    expect(await contextoDeLaConexion(db)).toBe("norte");
    await db.$executeRaw`INSERT INTO "Sucursal" (id, nombre) VALUES ('suc-cruda', 'Cruda')`;
    expect((await prismaAdmin.sucursal.findUniqueOrThrow({ where: { id: "suc-cruda" } })).empresaId).toBe("norte");
  });

  it("sin contexto, con dos empresas activas, un alta sin empresaId falla (el sentido seguro)", async () => {
    await expect(prismaSinEmpresa.sucursal.create({ data: { nombre: "Huerfana" } })).rejects.toThrow();
  });

  it("no filtra el contexto a otros pedidos: ninguna conexión del pool queda con app.empresa_id", async () => {
    const db = dbDeEmpresa("norte");
    await Promise.all(Array.from({ length: 12 }, (_, i) => db.sucursal.create({ data: { nombre: `S${i}` } })));
    await transaccionDeEmpresa("norte", async (tx) => tx.sucursal.create({ data: { nombre: "T" } }));
    const lecturas = await Promise.all(Array.from({ length: 12 }, () => contextoDeLaConexion(prismaSinEmpresa)));
    expect(lecturas.every((valor) => !valor)).toBe(true);
  });

  it("transaccionDeEmpresa fija el contexto antes de cualquier consulta, para todas las de la transacción", async () => {
    const dentro = await transaccionDeEmpresa("norte", async (tx) => {
      const primera = await tx.sucursal.create({ data: { nombre: "Uno" } });
      const segunda = await tx.sucursal.create({ data: { nombre: "Dos" } });
      return { primera, segunda, contexto: await contextoDeLaConexion(tx) };
    });
    expect(dentro.contexto).toBe("norte");
    expect(dentro.primera.empresaId).toBe("norte");
    expect(dentro.segunda.empresaId).toBe("norte");
  });

  it("transaccionDeEmpresa revierte todo si falla, y acepta opciones", async () => {
    await expect(
      transaccionDeEmpresa(
        "norte",
        async (tx) => {
          await tx.sucursal.create({ data: { id: "revertida", nombre: "R" } });
          throw new Error("falla");
        },
        { timeout: 5000 }
      )
    ).rejects.toThrow("falla");
    expect(await prisma.sucursal.findUnique({ where: { id: "revertida" } })).toBeNull();
  });

  it("baseDeEmpresa arma db y transaccion de la MISMA empresa", async () => {
    const base = baseDeEmpresa("norte");
    expect((await base.db.sucursal.create({ data: { nombre: "Por db" } })).empresaId).toBe("norte");
    const porTransaccion = await base.transaccion((tx) => tx.sucursal.create({ data: { nombre: "Por transaccion" } }));
    expect(porTransaccion.empresaId).toBe("norte");
  });
});

/** Las tres variables de contexto como las ve la conexión que lee (`null` si nunca se fijaron en ella, `''` si se fijaron y la transacción terminó). */
async function variablesDeLaConexion(cliente: Pick<typeof prisma, "$queryRaw">) {
  const [fila] = await cliente.$queryRaw<Array<{ empresa: string | null; lectura: string | null; escritura: string | null }>>`
    SELECT current_setting('app.empresa_id', true) AS empresa, current_setting('app.sucursales_lectura', true) AS lectura, current_setting('app.sucursales_escritura', true) AS escritura`;
  return fila;
}

describe("M.3-A2: el alcance por sucursal se fija con la empresa, local a la transacción", () => {
  const ALCANCE_UNA: AlcanceDeSucursal = { lectura: ["sucuna"], escritura: ["sucuna"] };
  const ALCANCE_VARIAS: AlcanceDeSucursal = { lectura: ["sucdos", "suctres", "sucuna"], escritura: ["sucdos"] };
  const SOLO_LECTURA: AlcanceDeSucursal = { lectura: ["sucuna"], escritura: [] };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
    await crearEmpresa("norte");
  });

  it("dbDeEmpresa, transaccionDeEmpresa y baseDeEmpresa dejan las tres variables en la transacción de cada operación", async () => {
    expect(await variablesDeLaConexion(dbDeEmpresa("norte", ALCANCE_VARIAS))).toEqual({ empresa: "norte", lectura: "sucdos,suctres,sucuna", escritura: "sucdos" });
    const dentro = await transaccionDeEmpresa("norte", async (tx) => variablesDeLaConexion(tx), undefined, ALCANCE_UNA);
    expect(dentro).toEqual({ empresa: "norte", lectura: "sucuna", escritura: "sucuna" });
    const base = baseDeEmpresa("norte", SOLO_LECTURA);
    expect(await variablesDeLaConexion(base.db)).toEqual({ empresa: "norte", lectura: "sucuna", escritura: "" });
    expect(await base.transaccion((tx) => variablesDeLaConexion(tx))).toEqual({ empresa: "norte", lectura: "sucuna", escritura: "" });
    expect(base.alcance).toEqual(SOLO_LECTURA);
  });

  it("sin alcance las listas van VACÍAS (falla cerrado en las tablas por sucursal) y la empresa se fija igual", async () => {
    expect(await variablesDeLaConexion(dbDeEmpresa("norte"))).toEqual({ empresa: "norte", lectura: "", escritura: "" });
    expect(await transaccionDeEmpresa("norte", async (tx) => variablesDeLaConexion(tx))).toEqual({ empresa: "norte", lectura: "", escritura: "" });
    const base = baseDeEmpresa("norte");
    expect(base.alcance).toBeUndefined();
    expect(await variablesDeLaConexion(base.db)).toEqual({ empresa: "norte", lectura: "", escritura: "" });
  });

  it("SIN FUGA: transacciones concurrentes con alcances distintos, en el MISMO pool, ven cada una el suyo; y al terminar ninguna conexión conserva nada", async () => {
    const alcances: Array<AlcanceDeSucursal | undefined> = [ALCANCE_UNA, ALCANCE_VARIAS, undefined, SOLO_LECTURA];
    const esperado = (a: AlcanceDeSucursal | undefined) => ({ empresa: "norte", lectura: (a?.lectura ?? []).join(","), escritura: (a?.escritura ?? []).join(",") });
    // 48 trabajos sobre un pool de 10: las conexiones se reciclan entre alcances distintos, que es donde una variable de sesión se filtraría.
    const trabajos = Array.from({ length: 48 }, (_, i) => {
      const alcance = alcances[i % alcances.length];
      if (i % 2 === 0) {
        return transaccionDeEmpresa(
          "norte",
          async (tx) => {
            const antes = await variablesDeLaConexion(tx);
            await tx.$executeRaw`SELECT pg_sleep(0.01)`;
            return { alcance, vistas: [antes, await variablesDeLaConexion(tx)] };
          },
          undefined,
          alcance,
        );
      }
      return variablesDeLaConexion(dbDeEmpresa("norte", alcance)).then((vista) => ({ alcance, vistas: [vista] }));
    });
    for (const { alcance, vistas } of await Promise.all(trabajos)) for (const vista of vistas) expect(vista).toEqual(esperado(alcance));

    // Después, por el mismo pool y SIN contexto: ninguna conexión trae empresa ni alcance (vacío, o nunca fijado).
    const despues = await Promise.all(Array.from({ length: 48 }, () => variablesDeLaConexion(prismaSinEmpresa)));
    for (const vista of despues) expect({ empresa: vista.empresa || null, lectura: vista.lectura || null, escritura: vista.escritura || null }).toEqual({ empresa: null, lectura: null, escritura: null });
  });

  it("una transacción que falla (rollback) tampoco deja el alcance en la conexión", async () => {
    await expect(
      transaccionDeEmpresa(
        "norte",
        async (tx) => {
          expect((await variablesDeLaConexion(tx)).lectura).toBe("sucuna");
          throw new Error("falla");
        },
        undefined,
        ALCANCE_UNA,
      ),
    ).rejects.toThrow("falla");
    const despues = await Promise.all(Array.from({ length: 24 }, () => variablesDeLaConexion(prismaSinEmpresa)));
    expect(despues.every((v) => !v.empresa && !v.lectura && !v.escritura)).toBe(true);
  });

  it("MISMA cantidad de consultas: el alcance viaja en la misma sentencia que la empresa (una sola, con los tres set_config), con o sin alcance", async () => {
    const sentencias = async (cliente: ReturnType<typeof dbDeEmpresa>) => {
      consultas.length = 0;
      await cliente.sucursal.findMany({ where: { empresaId: "norte" } });
      return [...consultas];
    };
    const sinAlcance = await sentencias(dbDeEmpresa("norte"));
    const conAlcance = await sentencias(dbDeEmpresa("norte", ALCANCE_VARIAS));
    expect(conAlcance.length).toBe(sinAlcance.length);
    for (const lista of [sinAlcance, conAlcance]) {
      const fijan = lista.filter((q) => q.includes("set_config"));
      expect(fijan).toHaveLength(1);
      expect(fijan[0]).toContain("app.empresa_id");
      expect(fijan[0]).toContain("app.sucursales_lectura");
      expect(fijan[0]).toContain("app.sucursales_escritura");
    }
    // Lo mismo en la transacción interactiva: una sentencia de contexto, no tres.
    consultas.length = 0;
    await transaccionDeEmpresa("norte", async (tx) => tx.sucursal.findMany({ where: { empresaId: "norte" } }), undefined, ALCANCE_VARIAS);
    expect(consultas.filter((q) => q.includes("set_config"))).toHaveLength(1);
  });

  it("un id que no es un id de sucursal, o repetido, FALLA al armar la base (no se corrige ni se filtra): sin comas, comillas, espacios, comodines ni vacíos", () => {
    for (const malo of ["", "A", "a,b", "a b", "a'b", "a\"b", "*", "a;b", "a\nb", "á", "a-b", "a_b"]) {
      expect(() => dbDeEmpresa("norte", { lectura: [malo], escritura: [] }), `lectura ${JSON.stringify(malo)}`).toThrow(/forma de un id de sucursal/);
      expect(() => baseDeEmpresa("norte", { lectura: [], escritura: [malo] }), `escritura ${JSON.stringify(malo)}`).toThrow(/forma de un id de sucursal/);
      expect(() => serializarSucursalesDelAlcance([malo])).toThrow(/forma de un id de sucursal/);
    }
    expect(() => baseDeEmpresa("norte", { lectura: ["sucuna", "sucuna"], escritura: [] })).toThrow(/repetido/);
    expect(() => baseDeEmpresa("norte", { lectura: [], escritura: ["sucuna", "sucdos", "sucuna"] })).toThrow(/repetido/);
    expect(serializarSucursalesDelAlcance([])).toBe("");
    expect(serializarSucursalesDelAlcance(["c1x2y3", "c4z5"])).toBe("c1x2y3,c4z5");
  });

  it("el alcance que el contexto muestra es el que la base fija: cambiar el objeto original después no lo mueve", async () => {
    const original = { lectura: ["sucuna"], escritura: ["sucuna"] };
    const base = baseDeEmpresa("norte", original);
    original.lectura.push("sucdos");
    expect(base.alcance).toEqual({ lectura: ["sucuna"], escritura: ["sucuna"] });
    expect(Object.isFrozen(base.alcance)).toBe(true);
    expect(await variablesDeLaConexion(base.db)).toMatchObject({ lectura: "sucuna" });
    expect(await base.transaccion((tx) => variablesDeLaConexion(tx))).toMatchObject({ lectura: "sucuna" });
  });
});

describe("verificarRolDeEjecucion (ADR-022: estricto siempre, sin «una sola empresa» que lo disculpe)", () => {
  const base = { usuario: "x", superusuario: false, bypassRls: false, duenio: false, contextoPreseteado: false };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    await sembrarBase();
  });

  it("el rol de ejecución real (motor2_app, sin contexto) pasa con una o con dos empresas activas", async () => {
    await expect(verificarRolDeEjecucion(prismaSinEmpresa)).resolves.toBeUndefined();
    await crearEmpresa("norte");
    await expect(verificarRolDeEjecucion(prismaSinEmpresa)).resolves.toBeUndefined();
  });

  it("un rol dueño de las tablas se niega SIEMPRE: con una empresa, con dos o con cien", async () => {
    expect((await datosDelRolDeEjecucion(prismaDuenioSinEmpresa)).duenio).toBe(true);
    await expect(verificarRolDeEjecucion(prismaDuenioSinEmpresa)).rejects.toThrow(/no queda aislado por empresa/);
    await crearEmpresa("norte");
    await expect(verificarRolDeEjecucion(prismaDuenioSinEmpresa)).rejects.toThrow(/no queda aislado por empresa/);
  });

  it("superusuario y BYPASSRLS también se niegan, cuente la empresa que cuente (activa, suspendida, en baja o en alta)", async () => {
    for (const estado of ["ACTIVE", "SUSPENDED", "DELETING", "PROVISIONING"] as const) {
      await crearEmpresa(`norte-${estado.toLowerCase()}`);
      await prisma.empresa.update({ where: { id: `norte-${estado.toLowerCase()}` }, data: { estado } });
      await expect(verificarRolDeEjecucion(prisma, { ...base, superusuario: true }), estado).rejects.toThrow(/superusuario/);
      await expect(verificarRolDeEjecucion(prisma, { ...base, bypassRls: true }), estado).rejects.toThrow(/BYPASSRLS/);
    }
  });

  it("MOTOR2_ROL_ESTRICTO=0 (permitirPrivilegiado) es el escape de las herramientas de demo: deja pasar un rol que salta el RLS, AVISA a Sentry, y el rol sin privilegios no avisa nada", async () => {
    vi.mocked(reportarErrorUnaVez).mockClear();
    await verificarRolDeEjecucion(prisma, base, true);
    expect(reportarErrorUnaVez).not.toHaveBeenCalled();
    await verificarRolDeEjecucion(prisma, { ...base, bypassRls: true }, true);
    expect(reportarErrorUnaVez).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportarErrorUnaVez).mock.calls[0][1]).toMatchObject({ message: expect.stringContaining("BYPASSRLS") });
  });

  it("una conexión que trae contexto preseteado (app.empresa_id, app.usuario_id o app.invitacion_hash) se niega SIN escape, aunque el rol no tenga privilegios", async () => {
    // `prisma` de las pruebas abre la conexión con app.empresa_id fijado: justo lo que ADR-022 prohíbe para el proceso real.
    expect((await datosDelRolDeEjecucion(prisma)).contextoPreseteado).toBe(true);
    expect((await datosDelRolDeEjecucion(prismaSinEmpresa)).contextoPreseteado).toBe(false);
    await expect(verificarRolDeEjecucion(prisma)).rejects.toThrow(/trae app\.empresa_id/);
    await expect(verificarRolDeEjecucion(prisma, undefined, true)).rejects.toThrow(/trae app\.empresa_id/);
    await expect(verificarRolDeEjecucion(prisma, { ...base, contextoPreseteado: true }, true)).rejects.toThrow(/preset/);
  });

  it("M.3-A2: un alcance por sucursal preseteado (app.sucursales_lectura o app.sucursales_escritura) también cuenta como contexto preseteado y se niega SIN escape", async () => {
    for (const variable of ["app.sucursales_lectura", "app.sucursales_escritura"]) {
      const dentro = await prismaSinEmpresa.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config(${variable}, 'sucuna', true)`;
        return { datos: await datosDelRolDeEjecucion(tx), error: await verificarRolDeEjecucion(tx, undefined, true).then(() => null, (e: Error) => e.message) };
      });
      expect(dentro.datos.contextoPreseteado, variable).toBe(true);
      expect(dentro.error, variable).toMatch(/app\.sucursales_lectura o app\.sucursales_escritura/);
    }
    // Sin nada fijado (la conexión del proceso real), no hay preset.
    expect((await datosDelRolDeEjecucion(prismaSinEmpresa)).contextoPreseteado).toBe(false);
  });
});
