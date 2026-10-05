import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ejecutarScript, interpolar } from "../../scripts/operaciones/ejecutar-sql-de-psql.mjs";

/**
 * El ejecutor de scripts de psql (para máquinas sin psql). Se prueba con un cliente FALSO: lo que importa es qué sentencias arma, en qué orden y con qué ramas, sobre todo con el script
 * real de creación del rol de plataforma. Escapa igual que psql: `:'x'` es un literal entre comillas simples (con las comillas duplicadas) y `:"x"` un identificador.
 */
type Fila = Record<string, unknown>;
const escapar = { literal: (v: string) => `'${v.replace(/'/g, "''")}'`, identificador: (v: string) => `"${v.replace(/"/g, '""')}"` };

/** Un cliente que anota las sentencias y contesta a los `\gset` con lo que se le configure. */
function clienteFalso(respuestas: { crear: boolean; dueno?: string }) {
  const sentencias: string[] = [];
  return {
    sentencias,
    async query(texto: string): Promise<{ rows: Fila[] }> {
      sentencias.push(texto);
      if (/AS crear\b/i.test(texto)) return { rows: [{ crear: respuestas.crear }] };
      if (/AS dueno\b/i.test(texto)) return { rows: [{ dueno: respuestas.dueno ?? "neondb_owner" }] };
      return { rows: [] };
    },
  };
}

const SCRIPT = readFileSync(join(__dirname, "../../scripts/operaciones/crear-rol-motor2-plataforma.sql"), "utf8");

describe("interpolar", () => {
  it("literales con comillas duplicadas, identificadores, :{?x} y variables simples", () => {
    expect(interpolar("PASSWORD :'clave'", { clave: "a'b" }, escapar)).toBe("PASSWORD 'a''b'");
    expect(interpolar('FOR ROLE :"dueno"', { dueno: "neon db" }, escapar)).toBe('FOR ROLE "neon db"');
    expect(interpolar(":{?restringir}", {}, escapar)).toBe("FALSE");
    expect(interpolar(":{?restringir}", { restringir: "1" }, escapar)).toBe("TRUE");
    expect(interpolar(":crear", { crear: "t" }, escapar)).toBe("t");
  });

  it("no toca los casts `::` ni los dos puntos de un texto", () => {
    expect(interpolar("SELECT 1::int, 'a:b'", {}, escapar)).toBe("SELECT 1::int, 'a:b'");
  });

  it("una variable que falta es un error, no un SQL roto en silencio", () => {
    expect(() => interpolar("PASSWORD :'clave'", {}, escapar)).toThrow(/falta la variable :'clave'/);
  });
});

describe("el script real de creación del rol de plataforma", () => {
  it("si el rol NO existe: hace CREATE ROLE con la clave escapada, y no ALTER ROLE", async () => {
    const c = clienteFalso({ crear: true });
    await ejecutarScript(SCRIPT, c, { clave: "x'y" }, escapar);
    const todo = c.sentencias.join("\n");
    expect(todo).toMatch(/CREATE ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'x''y'/);
    expect(todo).not.toMatch(/ALTER ROLE motor2_plataforma/);
  });

  it("si el rol YA existe: hace ALTER ROLE (idempotente) y no CREATE ROLE", async () => {
    const c = clienteFalso({ crear: false });
    await ejecutarScript(SCRIPT, c, { clave: "clave" }, escapar);
    const todo = c.sentencias.join("\n");
    expect(todo).toMatch(/ALTER ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'clave'/);
    expect(todo).not.toMatch(/CREATE ROLE motor2_plataforma/);
  });

  it("parte de cero con el dueño real (default privileges) y deja los permisos mínimos; sin `restringir` NO toca a motor2_app", async () => {
    const c = clienteFalso({ crear: true, dueno: "neondb_owner" });
    await ejecutarScript(SCRIPT, c, { clave: "clave" }, escapar);
    const todo = c.sentencias.join("\n");
    expect(todo).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner" IN SCHEMA public REVOKE ALL ON TABLES FROM motor2_plataforma');
    expect(todo).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM motor2_plataforma");
    expect(todo).toMatch(/GRANT SELECT, INSERT, UPDATE ON "Empresa", "User", "ModuloEmpresa" TO motor2_plataforma/);
    expect(todo).toContain("GRANT SELECT ON public._prisma_migrations TO motor2_plataforma");
    expect(todo).not.toMatch(/REVOKE INSERT, UPDATE, DELETE ON "Empresa" FROM motor2_app/);
    expect(todo).not.toMatch(/DELETE ON/);
  });

  it("con `restringir` además le quita la escritura de Empresa a motor2_app", async () => {
    const c = clienteFalso({ crear: true });
    await ejecutarScript(SCRIPT, c, { clave: "clave", restringir: "1" }, escapar);
    expect(c.sentencias.join("\n")).toMatch(/REVOKE INSERT, UPDATE, DELETE ON "Empresa" FROM motor2_app/);
  });

  it("los bloques DO $$ … $$ con varios ';' adentro se mandan enteros (una sola sentencia)", async () => {
    const c = clienteFalso({ crear: true });
    await ejecutarScript(SCRIPT, c, { clave: "clave" }, escapar);
    const bloques = c.sentencias.filter((s) => s.trimStart().startsWith("DO $$"));
    expect(bloques).toHaveLength(2);
    for (const b of bloques) expect(b.trimEnd().endsWith("$$;")).toBe(true);
    expect(bloques[1]).toContain("FOREACH t IN ARRAY");
    expect(bloques[1]).toContain("AuditoriaPlataforma");
  });

  it("sin la variable `clave` falla antes de mandar el CREATE ROLE (nunca crea un rol sin clave)", async () => {
    const c = clienteFalso({ crear: true });
    await expect(ejecutarScript(SCRIPT, c, {}, escapar)).rejects.toThrow(/falta la variable :'clave'/);
    expect(c.sentencias.join("\n")).not.toMatch(/CREATE ROLE/);
  });
});

describe("ejecutarScript", () => {
  it("rechaza un comando de psql que no soporta, un \\endif sobrante y una sentencia sin cerrar", async () => {
    await expect(ejecutarScript("\\copy x to y\n", clienteFalso({ crear: true }), {}, escapar)).rejects.toThrow(/no soportado/);
    await expect(ejecutarScript("\\endif\n", clienteFalso({ crear: true }), {}, escapar)).rejects.toThrow(/sin \\if/);
    await expect(ejecutarScript("SELECT 1", clienteFalso({ crear: true }), {}, escapar)).rejects.toThrow(/sin cerrar/);
  });
});
