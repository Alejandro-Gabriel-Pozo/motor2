import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ejecutarScript, interpolar, leerArgumentos, principal } from "../../scripts/operaciones/ejecutar-sql-de-psql.mjs";

/**
 * El ejecutor de scripts de psql (para máquinas sin psql). Se prueba con un cliente FALSO: lo que importa es qué sentencias arma, en qué orden y con qué ramas, sobre todo con el script
 * real de creación del rol de plataforma. Escapa igual que psql: `:'x'` es un literal entre comillas simples (con las comillas duplicadas) y `:"x"` un identificador.
 */
type Fila = Record<string, unknown>;
const escapar = { literal: (v: string) => `'${v.replace(/'/g, "''")}'`, identificador: (v: string) => `"${v.replace(/"/g, '""')}"` };

/** Un cliente que anota las sentencias y contesta a los `\gset` con lo que se le configure. */
function clienteFalso(respuestas: { crear?: boolean; dueno?: string; existe?: boolean }) {
  const sentencias: string[] = [];
  return {
    sentencias,
    async query(texto: string): Promise<{ rows: Fila[] }> {
      sentencias.push(texto);
      if (/AS crear\b/i.test(texto)) return { rows: [{ crear: respuestas.crear }] };
      if (/AS existe\b/i.test(texto)) return { rows: [{ existe: respuestas.existe }] };
      if (/AS dueno\b/i.test(texto)) return { rows: [{ dueno: respuestas.dueno ?? "neondb_owner" }] };
      return { rows: [] };
    },
  };
}

/** El `DO $$ … $$` que mira los atributos del rol que ya existe (M.1-C1): rolsuper, rolbypassrls y rolcanlogin, y aborta con RAISE EXCEPTION. */
const esVerificacionDeAtributos = (s: string) => /^\s*DO\b/.test(s) && /rolsuper/.test(s) && /rolbypassrls/.test(s) && /rolcanlogin/.test(s) && /RAISE EXCEPTION/.test(s);

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

  it("M.1-C1: rol YA existente + restringir SIN clave: no hay ALTER ROLE (no rota la credencial), sí el DO que verifica atributos y sí el REVOKE, en ese orden", async () => {
    const c = clienteFalso({ crear: false });
    await ejecutarScript(SCRIPT, c, { restringir: "1" }, escapar);
    const todo = c.sentencias.join("\n");
    expect(todo, "sin clave NO se toca el rol").not.toMatch(/ALTER ROLE motor2_plataforma/);
    expect(todo).not.toMatch(/CREATE ROLE/);
    const verificacion = c.sentencias.findIndex(esVerificacionDeAtributos);
    expect(verificacion, "falta el DO que verifica rolsuper / rolbypassrls / rolcanlogin y hace RAISE EXCEPTION").toBeGreaterThanOrEqual(0);
    const revoke = c.sentencias.findIndex((s) => /REVOKE\b[^;]*\bON "Empresa" FROM motor2_app/.test(s));
    expect(revoke, "falta el REVOKE sobre Empresa").toBeGreaterThan(verificacion);
  });

  it("M.1-C1: rol YA existente + clave: ALTER ROLE y nada de verificación de atributos; rol existente sin clave y sin restringir: verifica y no toca nada más del rol", async () => {
    const conClave = clienteFalso({ crear: false });
    await ejecutarScript(SCRIPT, conClave, { clave: "clave", restringir: "1" }, escapar);
    expect(conClave.sentencias.join("\n")).toMatch(/ALTER ROLE motor2_plataforma LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD 'clave'/);
    expect(conClave.sentencias.some(esVerificacionDeAtributos), "con clave el rol se vuelve a definir: no hay nada que verificar").toBe(false);

    const sinClave = clienteFalso({ crear: false });
    await ejecutarScript(SCRIPT, sinClave, {}, escapar);
    expect(sinClave.sentencias.join("\n")).not.toMatch(/ALTER ROLE|CREATE ROLE/);
    expect(sinClave.sentencias.some(esVerificacionDeAtributos)).toBe(true);
  });

  it("parte de cero con el dueño real (default privileges) y deja los permisos mínimos; sin `restringir` NO toca a motor2_app", async () => {
    const c = clienteFalso({ crear: true, dueno: "neondb_owner" });
    await ejecutarScript(SCRIPT, c, { clave: "clave" }, escapar);
    const todo = c.sentencias.join("\n");
    expect(todo).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "neondb_owner" IN SCHEMA public REVOKE ALL ON TABLES FROM motor2_plataforma');
    expect(todo).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM motor2_plataforma");
    // S-35: grants = uso. `User` y `UsuarioEmpresa` solo se leen; `UsuarioSucursal` no tiene ninguno.
    expect(todo).toMatch(/GRANT SELECT, INSERT, UPDATE ON "Empresa", "ModuloEmpresa" TO motor2_plataforma/);
    expect(todo).toMatch(/GRANT SELECT ON "User", "UsuarioEmpresa" TO motor2_plataforma/);
    expect(todo).not.toMatch(/GRANT[^;]*"UsuarioSucursal"[^;]*TO motor2_plataforma/);
    expect(todo).not.toMatch(/GRANT[^;]*(INSERT|UPDATE)[^;]*"User"[^;]*TO motor2_plataforma/);
    expect(todo).toContain("GRANT SELECT ON public._prisma_migrations TO motor2_plataforma");
    expect(todo).not.toMatch(/ON "Empresa" (FROM|TO) motor2_app/);
    expect(todo).not.toMatch(/DELETE ON/);
  });

  it("M.1-C2: con `restringir` DENIEGA POR DEFECTO sobre Empresa a motor2_app: REVOKE ALL, GRANT SELECT y la aserción de que no quedó nada de escritura, en ese orden", async () => {
    const c = clienteFalso({ crear: true });
    await ejecutarScript(SCRIPT, c, { clave: "clave", restringir: "1" }, escapar);
    const s = c.sentencias;
    const revoke = s.findIndex((x) => /^\s*REVOKE ALL ON "Empresa" FROM motor2_app;?\s*$/.test(x));
    const grant = s.findIndex((x) => /^\s*GRANT SELECT ON "Empresa" TO motor2_app;?\s*$/.test(x));
    const asercion = s.findIndex((x) => /^\s*DO\b/.test(x) && /has_table_privilege\('motor2_app'/.test(x) && /has_any_column_privilege\('motor2_app'/.test(x) && /RAISE EXCEPTION/.test(x));
    expect(revoke, "falta REVOKE ALL ON \"Empresa\" FROM motor2_app").toBeGreaterThanOrEqual(0);
    expect(grant, "falta GRANT SELECT ON \"Empresa\" TO motor2_app").toBeGreaterThan(revoke);
    expect(asercion, "falta la aserción DO con has_table_privilege / has_any_column_privilege").toBeGreaterThan(grant);
    // la aserción cubre TODO lo que no sea leer: tabla (incluidos TRUNCATE, REFERENCES y TRIGGER) y columnas
    expect(s[asercion]).toMatch(/has_table_privilege\('motor2_app',\s*'public\."Empresa"',\s*'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'\)/);
    expect(s[asercion]).toMatch(/has_any_column_privilege\('motor2_app',\s*'public\."Empresa"',\s*'INSERT, UPDATE, REFERENCES'\)/);
    expect(s.join("\n")).not.toMatch(/REVOKE INSERT, UPDATE, DELETE ON "Empresa"/);
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

  it("el árbol de la dueña usa CRLF: con saltos de línea CRLF el ejecutor manda EXACTAMENTE las mismas sentencias que con LF", async () => {
    for (const vars of [{ clave: "clave" }, { restringir: "1" }, {}]) {
      for (const crear of [true, false]) {
        const lf = clienteFalso({ crear });
        const crlf = clienteFalso({ crear });
        if (crear && !("clave" in vars)) continue; // sin clave y rol inexistente falla (cubierto abajo)
        await ejecutarScript(SCRIPT, lf, { ...vars }, escapar);
        await ejecutarScript(SCRIPT.replace(/\r?\n/g, "\r\n"), crlf, { ...vars }, escapar);
        expect(crlf.sentencias).toEqual(lf.sentencias);
      }
    }
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

describe("M.1-C6: quitar-rol-motor2-plataforma.sql es idempotente (no hace nada si el rol no existe)", () => {
  const QUITAR = readFileSync(join(__dirname, "../../scripts/operaciones/quitar-rol-motor2-plataforma.sql"), "utf8");

  it("rol inexistente: solo pregunta si existe; no manda GRANT, DROP OWNED ni DROP ROLE (y no falla)", async () => {
    const c = clienteFalso({ existe: false });
    await ejecutarScript(QUITAR, c, {}, escapar);
    expect(c.sentencias).toHaveLength(2); // la pregunta y el aviso
    expect(c.sentencias[0]).toMatch(/pg_roles/);
    expect(c.sentencias.join("\n")).not.toMatch(/GRANT|DROP/);
  });

  it("rol existente: devuelve la escritura de Empresa a motor2_app y recién después borra lo suyo y el rol, en ese orden (también con CRLF)", async () => {
    for (const texto of [QUITAR, QUITAR.replace(/\r?\n/g, "\r\n")]) {
      const c = clienteFalso({ existe: true });
      await ejecutarScript(texto, c, {}, escapar);
      const s = c.sentencias.join("\n");
      const grant = s.indexOf('GRANT INSERT, UPDATE, DELETE ON "Empresa" TO motor2_app');
      const owned = s.indexOf("DROP OWNED BY motor2_plataforma");
      const rol = s.indexOf("DROP ROLE motor2_plataforma");
      expect(grant, "falta devolver la escritura").toBeGreaterThanOrEqual(0);
      expect(owned).toBeGreaterThan(grant);
      expect(rol).toBeGreaterThan(owned);
    }
  });
});

describe("M.1-C6: el ejecutor se niega a conectarse a un host que no es el esperado (--host-esperado)", () => {
  const ENV = 'DIRECT_URL="postgresql://dueno:clave-ficticia@ep-prueba-123.neon.example/neondb?sslmode=require"\n';
  const SQL = "SELECT 1;\n";

  /** Un `pg.Client` falso: anota lo que se le pide y si alguien llegó a crearlo o a conectarse. */
  function entorno(args: string[]) {
    const eventos: string[] = [];
    const configs: Array<Record<string, unknown>> = [];
    const dependencias = {
      entorno: {},
      leerArchivo: (ruta: string) => (ruta.endsWith(".env") ? ENV : SQL),
      log: () => undefined,
      logError: () => undefined,
      crearCliente: async (config: Record<string, unknown>) => {
        configs.push(config);
        eventos.push("crear-cliente");
        return {
          connect: async () => void eventos.push("connect"),
          query: async (t: string) => (eventos.push(t), { rows: [] }),
          end: async () => void eventos.push("end"),
          escapeLiteral: escapar.literal,
          escapeIdentifier: escapar.identificador,
        };
      },
    };
    return { eventos, configs, correr: () => principal(args, dependencias) };
  }
  const BASE = ["clientes.env", "script.sql"];

  it("leerArgumentos: el valor de --host-esperado no se confunde con el archivo, y una opción desconocida es un error", () => {
    expect(leerArgumentos([...BASE, "--simular", "--host-esperado", "ep-prueba-123.neon.example", "--var", "clave=CLAVE_X"])).toEqual({
      archivoEnv: "clientes.env",
      archivoSql: "script.sql",
      simular: true,
      hostEsperado: "ep-prueba-123.neon.example",
      vars: [["clave", "CLAVE_X"]],
    });
    expect(leerArgumentos([...BASE, "--host-esperado=otro.example"]).hostEsperado).toBe("otro.example");
    expect(leerArgumentos(BASE).hostEsperado).toBeUndefined();
    expect(() => leerArgumentos([...BASE, "--simulr"])).toThrow(/opción desconocida/);
    expect(() => leerArgumentos([...BASE, "--host-esperado"])).toThrow(/--host-esperado necesita/);
  });

  it("ejecución REAL sin --host-esperado: se niega ANTES de crear el cliente (no hay conexión)", async () => {
    const e = entorno(BASE);
    await expect(e.correr()).rejects.toThrow(/falta --host-esperado/);
    expect(e.eventos).toEqual([]);
  });

  it("ejecución real con un host DISTINTO al de DIRECT_URL: se niega, no conecta y no manda nada", async () => {
    const e = entorno([...BASE, "--host-esperado", "ep-produccion-999.neon.example"]);
    await expect(e.correr()).rejects.toThrow(/no es el esperado/);
    expect(e.eventos, "llegó a conectarse a un host que no era el esperado").toEqual([]);
  });

  it("con el host esperado (sin importar mayúsculas) conecta a ESE host y confirma; con --simular deshace", async () => {
    const real = entorno([...BASE, "--host-esperado", "EP-prueba-123.NEON.example"]);
    await expect(real.correr()).resolves.toBe(0);
    expect(real.configs[0]).toMatchObject({ host: "ep-prueba-123.neon.example", user: "dueno", database: "neondb" });
    expect(real.eventos).toEqual(["crear-cliente", "connect", "BEGIN", "SELECT 1;", "COMMIT", "end"]);

    const simulada = entorno([...BASE, "--simular", "--host-esperado", "ep-prueba-123.neon.example"]);
    await expect(simulada.correr()).resolves.toBe(0);
    expect(simulada.eventos).toEqual(["crear-cliente", "connect", "BEGIN", "SELECT 1;", "ROLLBACK", "end"]);
  });

  it("--simular sin --host-esperado se permite (no escribe nada), pero con un host equivocado también se niega", async () => {
    const sinHost = entorno([...BASE, "--simular"]);
    await expect(sinHost.correr()).resolves.toBe(0);
    expect(sinHost.eventos).toContain("ROLLBACK");
    expect(sinHost.eventos).not.toContain("COMMIT");

    const equivocado = entorno([...BASE, "--simular", "--host-esperado", "localhost"]);
    await expect(equivocado.correr()).rejects.toThrow(/no es el esperado/);
    expect(equivocado.eventos).toEqual([]);
  });

  it("un fallo del script deshace todo y devuelve 1 (sin tocar process.exitCode)", async () => {
    const e = entorno([...BASE, "--host-esperado", "ep-prueba-123.neon.example"]);
    const antes = process.exitCode;
    const dependenciasQueFallan = {
      entorno: {},
      leerArchivo: (ruta: string) => (ruta.endsWith(".env") ? ENV : "SELECT 1;\n"),
      log: () => undefined,
      logError: () => undefined,
      crearCliente: async () => ({
        connect: async () => undefined,
        query: async (t: string) => {
          e.eventos.push(t);
          if (t.startsWith("SELECT")) throw new Error("boom PASSWORD 'secreta'");
          return { rows: [] };
        },
        end: async () => undefined,
        escapeLiteral: escapar.literal,
        escapeIdentifier: escapar.identificador,
      }),
    };
    await expect(principal([...BASE, "--host-esperado", "ep-prueba-123.neon.example"], dependenciasQueFallan)).resolves.toBe(1);
    expect(e.eventos).toEqual(["BEGIN", "SELECT 1;", "ROLLBACK"]);
    expect(process.exitCode).toBe(antes);
  });
});
