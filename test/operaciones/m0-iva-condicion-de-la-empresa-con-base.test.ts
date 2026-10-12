import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutarScript } from "../../scripts/operaciones/ejecutar-sql-de-psql.mjs";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M0-IVA, paso de DATOS (`scripts/operaciones/m0-iva-condicion-de-la-empresa.sql`), contra Postgres REAL: el script se corre de verdad sobre una base TEMPORAL con todas las migraciones, con el
 * mismo ejecutor que usa el dueño (`ejecutarScript`, una transacción por corrida) y CONECTADO COMO `motor2_plataforma` con los grants reales del recorte M.1 (`crear-rol-motor2-plataforma.sql`
 * con `restringir`, sin `clave`: no rota la credencial de nadie). Jamás sobre `motor2_dev`, `motor2_e2e` ni una base real. Si el cluster no tiene los roles o falta `PLATAFORMA_DATABASE_URL`, los
 * casos se omiten con motivo (como `grants-m1-con-base`).
 *
 * Qué fija: simulación sin escribir; aplicar = UN cambio y UNA auditoría con el antes y el después; idempotencia (la segunda corrida no cambia nada ni audita); concurrencia (dos corridas a la
 * vez: 1 cambio y 1 auditoría con el mismo valor; 2 y 2, encadenadas, con valores distintos); atomicidad (si la auditoría falla, el cambio también); errores explícitos y aislamiento (otra
 * empresa intacta).
 *
 * Mutación: reemplazar `IS DISTINCT FROM` por una condición siempre verdadera deja una auditoría duplicada y pone en rojo idempotencia y concurrencia.
 */
const RAIZ = join(__dirname, "../..");
const SCRIPT_SQL = readFileSync(join(RAIZ, "scripts/operaciones/m0-iva-condicion-de-la-empresa.sql"), "utf8");
const CREAR_ROL = readFileSync(join(RAIZ, "scripts/operaciones/crear-rol-motor2-plataforma.sql"), "utf8");

let base: BaseTemporalMigrada;
let hayRoles = false;
let plataforma: Client | null = null;
let plataforma2: Client | null = null;

const escapar = (c: Client) => ({ literal: (v: string) => c.escapeLiteral(v), identificador: (v: string) => c.escapeIdentifier(v) });

function clienteComo(urlConCredenciales: string | undefined, usuarioEsperado: string): Client | null {
  if (!urlConCredenciales) return null;
  const credenciales = new URL(urlConCredenciales);
  if (decodeURIComponent(credenciales.username) !== usuarioEsperado) return null;
  const destino = new URL(base.url);
  return new Client({
    host: destino.hostname,
    port: destino.port ? Number(destino.port) : 5432,
    user: usuarioEsperado,
    password: decodeURIComponent(credenciales.password),
    database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
}

interface Resultado {
  empresas_cambiadas?: number;
  auditorias_escritas?: number;
  [k: string]: unknown;
}

/** Corre el script como `cliente` en UNA transacción (si falla, ROLLBACK y el error sale) y devuelve la última fila que imprimió. Sin `begin` no abre la transacción (para el caso «sin -1»). */
async function correr(cliente: Client, vars: Record<string, string>, opciones: { commit?: boolean } = {}): Promise<Resultado | undefined> {
  const commit = opciones.commit ?? true;
  let ultima: Resultado | undefined;
  await cliente.query("BEGIN");
  try {
    await ejecutarScript(SCRIPT_SQL, cliente, { ...vars }, escapar(cliente), (sentencia, resultado) => {
      if (sentencia.includes("empresas_cambiadas") || sentencia.includes("cambiaria")) ultima = resultado.rows?.[0] as Resultado | undefined;
    });
    if (commit) await cliente.query("COMMIT");
    return ultima;
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

const base_ = { slug: "stockhneuquen", condicion: "RESPONSABLE_INSCRIPTO", admin_email: "dueno@plataforma.test" };
const aplicar = (extra: Record<string, string> = {}) => ({ ...base_, aplicar: "1", ...extra });

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const condicionDe = async (slug: string) => (await q<{ c: string | null }>(`SELECT "condicionIva" AS c FROM "Empresa" WHERE "slug" = $1`, [slug]))[0]?.c;
const auditorias = () => q<{ id: string; adminId: string; adminEmail: string; accion: string; empresaAfectadaId: string; detalle: Record<string, unknown> }>(
  `SELECT "id","adminId","adminEmail","accion","empresaAfectadaId","detalle" FROM "AuditoriaPlataforma" WHERE "accion" = 'condicion-iva' ORDER BY "creadoEn", "id"`,
);

/** Espera (hasta 5 s) a que haya una sesión bloqueada esperando un lock: la prueba de que la segunda corrida quedó detrás de la primera. */
async function esperarUnBloqueo(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
    if (r[0]!.n > 0) return;
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error("la segunda corrida nunca quedó esperando el lock de la fila");
}

async function reiniciarEmpresas(): Promise<void> {
  await base.cliente.query(`DELETE FROM "AuditoriaPlataforma"`); // append-only para el rol; el dueño de la base temporal puede limpiar
  await base.cliente.query(`UPDATE "Empresa" SET "condicionIva" = NULL`);
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  const roles = await base.cliente.query<{ rolname: string }>("SELECT rolname FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma')");
  hayRoles = roles.rows.length === 2 && Boolean(process.env.PLATAFORMA_DATABASE_URL);
  if (!hayRoles) return;
  // Los grants reales del recorte M.1 (sin `clave`: no se toca la contraseña del rol, que es del cluster entero).
  await base.cliente.query("BEGIN");
  await ejecutarScript(CREAR_ROL, base.cliente, { restringir: "1" }, escapar(base.cliente));
  await base.cliente.query("COMMIT");
  for (const id of ["stockhneuquen", "otra"]) {
    await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [id]);
  }
  await base.cliente.query(`INSERT INTO "AdminPlataforma" ("id","email","nombre","secretoTotp","activo") VALUES ('adm-1','dueno@plataforma.test','Dueño','x',true), ('adm-2','baja@plataforma.test','De baja','x',false)`);
  plataforma = clienteComo(process.env.PLATAFORMA_DATABASE_URL, "motor2_plataforma");
  plataforma2 = clienteComo(process.env.PLATAFORMA_DATABASE_URL, "motor2_plataforma");
  await plataforma?.connect();
  await plataforma2?.connect();
}, 240_000);

afterAll(async () => {
  await plataforma?.end().catch(() => undefined);
  await plataforma2?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("M0-IVA: paso de datos de la condición de la empresa frente al IVA", () => {
  it("SIMULACIÓN (sin `aplicar`): muestra qué cambiaría y NO escribe nada, ni la empresa ni la auditoría", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    const r = await correr(plataforma, base_);
    expect(r).toMatchObject({ slug: "stockhneuquen", condicion_actual: null, condicion_pedida: "RESPONSABLE_INSCRIPTO", cambiaria: true });
    expect(await condicionDe("stockhneuquen")).toBeNull();
    expect(await auditorias()).toEqual([]);
  });

  it("APLICAR: un cambio y UNA auditoría con el antes, el después y el autor; la otra empresa y las demás columnas no se tocan", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    const otraAntes = (await q(`SELECT * FROM "Empresa" WHERE "slug" = 'otra'`))[0];
    const propiaAntes = (await q<Record<string, unknown>>(`SELECT * FROM "Empresa" WHERE "slug" = 'stockhneuquen'`))[0]!;
    expect(await correr(plataforma, aplicar())).toEqual({ empresas_cambiadas: 1, auditorias_escritas: 1 });
    expect(await condicionDe("stockhneuquen")).toBe("RESPONSABLE_INSCRIPTO");
    const sinCondicion = (fila: Record<string, unknown>) => Object.fromEntries(Object.entries(fila).filter(([columna]) => columna !== "condicionIva"));
    const propiaDespues = (await q<Record<string, unknown>>(`SELECT * FROM "Empresa" WHERE "slug" = 'stockhneuquen'`))[0]!;
    expect(sinCondicion(propiaDespues), "ninguna otra columna de la empresa cambió").toEqual(sinCondicion(propiaAntes));
    expect((await q(`SELECT * FROM "Empresa" WHERE "slug" = 'otra'`))[0], "aislamiento: la otra empresa quedó intacta").toEqual(otraAntes);
    const filas = await auditorias();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      adminId: "adm-1",
      adminEmail: "dueno@plataforma.test",
      accion: "condicion-iva",
      empresaAfectadaId: "stockhneuquen",
      detalle: { campo: "condicionIva", antes: null, despues: "RESPONSABLE_INSCRIPTO", origen: "script-sql" },
    });
  });

  it("IDEMPOTENCIA: volver a correrlo con la misma condición no cambia nada y NO suma una auditoría (ni dos corridas más)", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    await correr(plataforma, aplicar());
    for (let i = 0; i < 2; i++) expect(await correr(plataforma, aplicar()), `repetición ${i + 1}`).toEqual({ empresas_cambiadas: 0, auditorias_escritas: 0 });
    expect(await auditorias()).toHaveLength(1);
    expect(await condicionDe("stockhneuquen")).toBe("RESPONSABLE_INSCRIPTO");
  });

  it("un cambio posterior deja su propia auditoría con el «antes» correcto, y la historia anterior sigue (no se borra, se agrega)", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    await correr(plataforma, aplicar());
    expect(await correr(plataforma, aplicar({ condicion: "MONOTRIBUTO" }))).toEqual({ empresas_cambiadas: 1, auditorias_escritas: 1 });
    const filas = await auditorias();
    expect(filas.map((f) => [f.detalle.antes, f.detalle.despues])).toEqual([[null, "RESPONSABLE_INSCRIPTO"], ["RESPONSABLE_INSCRIPTO", "MONOTRIBUTO"]]);
  });

  it("CONCURRENCIA, mismo valor: dos corridas a la vez dan 1 cambio y 1 auditoría (la segunda re-evalúa y ve que ya está)", async (ctx) => {
    if (!hayRoles || !plataforma || !plataforma2) return ctx.skip();
    await reiniciarEmpresas();
    // La primera toma la fila y NO confirma; la segunda arranca y queda esperando el lock; recién entonces la primera confirma.
    await plataforma.query("BEGIN");
    let primera: Resultado | undefined;
    await ejecutarScript(SCRIPT_SQL, plataforma, { ...aplicar() }, escapar(plataforma), (s, r) => {
      if (s.includes("empresas_cambiadas")) primera = r.rows?.[0] as Resultado;
    });
    const segunda = correr(plataforma2, aplicar());
    await esperarUnBloqueo();
    await plataforma.query("COMMIT");
    expect(primera).toEqual({ empresas_cambiadas: 1, auditorias_escritas: 1 });
    expect(await segunda).toEqual({ empresas_cambiadas: 0, auditorias_escritas: 0 });
    expect(await auditorias(), "exactamente una auditoría").toHaveLength(1);
    expect(await condicionDe("stockhneuquen")).toBe("RESPONSABLE_INSCRIPTO");
  });

  it("CONCURRENCIA, valores distintos: se serializan; 2 cambios, 2 auditorías, y el «antes» de la segunda es el «después» de la primera", async (ctx) => {
    if (!hayRoles || !plataforma || !plataforma2) return ctx.skip();
    await reiniciarEmpresas();
    await plataforma.query("BEGIN");
    await ejecutarScript(SCRIPT_SQL, plataforma, { ...aplicar() }, escapar(plataforma));
    const segunda = correr(plataforma2, aplicar({ condicion: "EXENTO" }));
    await esperarUnBloqueo();
    await plataforma.query("COMMIT");
    expect(await segunda).toEqual({ empresas_cambiadas: 1, auditorias_escritas: 1 });
    const filas = await auditorias();
    expect(filas.map((f) => [f.detalle.antes, f.detalle.despues])).toEqual([[null, "RESPONSABLE_INSCRIPTO"], ["RESPONSABLE_INSCRIPTO", "EXENTO"]]);
    expect(await condicionDe("stockhneuquen")).toBe("EXENTO");
  });

  it("ATOMICIDAD: si la auditoría no se puede escribir, el cambio de la empresa tampoco queda (una sola sentencia, una transacción)", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    await base.cliente.query(`ALTER TABLE "AuditoriaPlataforma" ADD CONSTRAINT "zz_prueba_rechaza" CHECK ("accion" <> 'condicion-iva')`);
    try {
      await expect(correr(plataforma, aplicar())).rejects.toMatchObject({ code: "23514", constraint: "zz_prueba_rechaza" });
    } finally {
      await base.cliente.query(`ALTER TABLE "AuditoriaPlataforma" DROP CONSTRAINT "zz_prueba_rechaza"`);
    }
    expect(await condicionDe("stockhneuquen"), "la empresa quedó como estaba").toBeNull();
    expect(await auditorias()).toEqual([]);
  });

  it("ERRORES EXPLÍCITOS: condición fuera de la lista, empresa inexistente, administrador inexistente o de baja; en ningún caso queda algo escrito", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    const casos: Array<[Record<string, string>, RegExp]> = [
      [aplicar({ condicion: "RI" }), /"RI" no es una condicion frente al IVA admitida/],
      [aplicar({ condicion: "responsable_inscripto" }), /no es una condicion frente al IVA admitida/],
      [aplicar({ condicion: "" }), /no es una condicion frente al IVA admitida/],
      [aplicar({ slug: "no-existe" }), /no existe una empresa con el slug "no-existe"/],
      [aplicar({ slug: "" }), /falta el slug/],
      [aplicar({ admin_email: "nadie@plataforma.test" }), /no es un administrador de plataforma ACTIVO/],
      [aplicar({ admin_email: "baja@plataforma.test" }), /no es un administrador de plataforma ACTIVO/],
    ];
    for (const [vars, mensaje] of casos) await expect(correr(plataforma, vars), JSON.stringify(vars)).rejects.toThrow(mensaje);
    // El email se normaliza (mayúsculas y espacios), como en AdminPlataforma_email_normalizado_check.
    expect(await correr(plataforma, aplicar({ admin_email: "  DUENO@Plataforma.test " }))).toEqual({ empresas_cambiadas: 1, auditorias_escritas: 1 });
    expect((await auditorias())[0]?.adminEmail).toBe("dueno@plataforma.test");
  });

  it("sin la transacción de `-1` falla cerrado: no escribe nada (los valores viajan por set_config local a la transacción)", async (ctx) => {
    if (!hayRoles || !plataforma) return ctx.skip();
    await reiniciarEmpresas();
    // Sin BEGIN, cada sentencia es su propia transacción: el DO de la guarda no ve lo que fijó el set_config anterior y se niega.
    await expect(ejecutarScript(SCRIPT_SQL, plataforma, { ...aplicar() }, escapar(plataforma))).rejects.toThrow(/falta el slug de la empresa/);
    expect(await condicionDe("stockhneuquen")).toBeNull();
    expect(await auditorias()).toEqual([]);
  });

  it("el rol de plataforma hace todo esto sin ningún privilegio de más: sin DELETE sobre Empresa ni sobre la auditoría, y motor2_app sigue sin poder escribir Empresa", async (ctx) => {
    if (!hayRoles) return ctx.skip();
    const tiene = async (rol: string, tabla: string, privilegio: string) => (await q<{ v: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS v`, [rol, `public."${tabla}"`, privilegio]))[0]!.v;
    expect(await tiene("motor2_plataforma", "Empresa", "DELETE")).toBe(false);
    expect(await tiene("motor2_plataforma", "AuditoriaPlataforma", "UPDATE")).toBe(false);
    expect(await tiene("motor2_plataforma", "AuditoriaPlataforma", "DELETE")).toBe(false);
    for (const p of ["INSERT", "UPDATE", "DELETE"]) expect(await tiene("motor2_app", "Empresa", p), `motor2_app ${p}`).toBe(false);
  });
});
