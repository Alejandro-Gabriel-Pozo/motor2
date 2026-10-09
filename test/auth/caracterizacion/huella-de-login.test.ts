import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../../setup/test-db";
import { vincularCuentaConInvitacion, sembrarEmpresa, hashDeToken } from "./adaptador-de-imports";

/**
 * HUELLA del login por invitación: `vincularCuentaConInvitacion` (src/core/auth/invitacion.ts), la función que el callback `signIn` de Auth.js llama ANTES de que exista
 * sesión y que escribe `Account` (y consume la invitación de vinculación) en una transacción serializable de la empresa de la invitación. Es la frontera de login y de la
 * frontera multi-tenant: la Fase 4 (B3) la mueve a `server/sesion/`, y el plan de pureza (sección 10.2) anotó que la caracterización del tramo B (#82) NO la cubría. Se escribe
 * ANTES de moverla y NO se edita después: si una mudanza cambia un resultado, una fila o su orden, este archivo lo tiene que detectar en rojo.
 * Para regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza): `REGENERAR_HUELLA_DE_LOGIN=1 npx vitest run test/auth/caracterizacion/huella-de-login.test.ts`.
 * Archivo propio y no snapshots de Vitest, para que `-u` no lo regenere en silencio.
 *
 * Una secuencia con estado: cada paso llama a la función con una entrada distinta y vuelca el resultado y TODAS las filas de `Invitacion`, `Account` y `RegistroAuditoria` de la
 * empresa (ids reemplazados por nombres simbólicos y lo que cambia por corrida, enmascarado).
 */
const ARCHIVO = join(__dirname, "huella-de-login.golden.txt");
const E = "empresa-login";
const S = "empresa-suspendida";
const P = "empresa-en-alta-login";
const AHORA = new Date();
const TOKEN = (letra: string, n: number) => `${letra}${String(n).padStart(2, "0")}${"l".repeat(40)}`;

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

describe("Huella del login por invitación (vincularCuentaConInvitacion)", () => {
  const nombres = new Map<string, string>();
  const desconocidos = new Map<string, string>();
  const lineas: string[] = [];

  const simbolo = (valor: string): string => {
    const conocido = nombres.get(valor);
    if (conocido) return conocido;
    if (!/^c[a-z0-9]{20,}$/.test(valor)) return valor;
    if (!desconocidos.has(valor)) desconocidos.set(valor, `id#${desconocidos.size + 1}`);
    return desconocidos.get(valor)!;
  };
  const MASCARAS = new Set(["creadoEn", "creadaEn", "actualizadoEn", "venceEn", "aceptadaEn", "revocadaEn", "hashToken", "ultimoEnvioEn", "enviadaEn"]);
  const fila = (f: Record<string, unknown>): string =>
    Object.keys(f)
      .sort()
      .map((columna) => {
        const v = f[columna];
        if (MASCARAS.has(columna)) return `${columna}=${v === null || v === undefined ? "null" : "<enmascarado>"}`;
        if (v === null || v === undefined) return `${columna}=null`;
        if (v instanceof Date) return `${columna}=<fecha>`;
        if (v instanceof Prisma.Decimal) return `${columna}=${v.toString()}`;
        if (typeof v === "string") return `${columna}=${simbolo(v).replace(/c[a-z0-9]{20,}/g, (id) => simbolo(id))}`;
        return `${columna}=${String(v)}`;
      })
      .join(" ");

  async function volcado(): Promise<string[]> {
    const donde = { empresaId: { in: [E, S, P] } };
    const invs = await prismaAdmin.invitacion.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadaEn: "asc" }, { id: "asc" }] });
    invs.forEach((i, n) => nombres.set(i.id, `inv${n + 1}`));
    const cuentas = await prismaAdmin.account.findMany({ orderBy: [{ providerAccountId: "asc" }] });
    cuentas.forEach((c, n) => nombres.set(c.id ?? `${c.provider}:${c.providerAccountId}`, `cuenta${n + 1}`));
    const auditoria = await prismaAdmin.registroAuditoria.findMany({ where: donde, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    return [
      ...invs.map((i) => `  INVITACION ${fila(i as unknown as Record<string, unknown>)}`),
      ...cuentas.map((c) => `  ACCOUNT ${fila({ ...c, id: undefined } as unknown as Record<string, unknown>)}`),
      ...auditoria.map((a) => `  AUDITORIA ${fila(a as unknown as Record<string, unknown>)}`),
    ];
  }

  beforeEach(async () => {
    nombres.clear();
    desconocidos.clear();
    lineas.length = 0;
    await limpiarBaseDeTest();
  });

  const paso = async (titulo: string, resultado: unknown) => {
    lineas.push(`### ${titulo}`, `  resultado: ${JSON.stringify(resultado)}`, ...(await volcado()));
  };

  it("la secuencia entera coincide con lo guardado", async () => {
    const empresa = async (id: string, estado: "ACTIVE" | "SUSPENDED" | "PROVISIONING", slug: string) => {
      await prismaAdmin.empresa.create({ data: { id, nombre: `Empresa ${slug}`, slug, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
      await prismaAdmin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.empresa_id', ${id}, true)`;
        await sembrarEmpresa(tx, id, "Central");
      });
    };
    await empresa(E, "ACTIVE", "empresa-login");
    await empresa(S, "SUSPENDED", "empresa-suspendida");
    await empresa(P, "PROVISIONING", "empresa-en-alta-login");

    const usuario = (email: string, etiqueta: string) =>
      prismaAdmin.user.create({ data: { email } }).then((u) => {
        nombres.set(u.id, etiqueta);
        return u;
      });
    // Las invitaciones de usuario y de vinculación las emite una persona (`invitadoPorId`); la de gerente, la plataforma (sin invitador): lo exige el check `Invitacion_invitador_check`.
    const invitador = await usuario("invitador@gmail.com", "invitador");
    const invitar = async (empresaId: string, email: string, tipo: "gerente" | "usuario" | "vinculacion", token: string, extra: { venceEn?: Date; estado?: "PENDIENTE" | "ACEPTADA" | "REVOCADA" } = {}) =>
      prismaAdmin.invitacion.create({
        data: {
          empresaId, email, rolEmpresa: tipo, hashToken: hashDeToken(token), venceEn: extra.venceEn ?? new Date(Date.now() + 3_600_000),
          ...(tipo === "gerente" ? {} : { invitadoPorId: invitador.id }),
          ...(extra.estado ? { estado: extra.estado } : {}),
          ...(extra.estado === "REVOCADA" ? { revocadaEn: new Date() } : {}), // el check `Invitacion_revocada_coherente_check` exige la fecha de revocación
        },
      });
    const cuenta = (id: string, extra: Partial<Parameters<typeof vincularCuentaConInvitacion>[0]["cuenta"]> = {}) => ({ providerAccountId: id, ...extra });
    const vincular = (token: string | undefined, u: { id: string; email: string }, c: ReturnType<typeof cuenta>) =>
      vincularCuentaConInvitacion({ token, usuario: { id: u.id, email: u.email }, cuenta: c, ahora: AHORA });

    const ana = await usuario("ana@gmail.com", "ana");
    const beto = await usuario("beto@gmail.com", "beto");
    const carla = await usuario("carla@gmail.com", "carla");
    const dani = await usuario("dani@gmail.com", "dani");
    const eva = await usuario("eva@gmail.com", "eva");
    const fede = await usuario("fede@gmail.com", "fede");
    const gabi = await usuario("gabi@gmail.com", "gabi");
    const hugo = await usuario("hugo@gmail.com", "hugo");

    // 1. Entradas que no llegan ni a la base.
    await paso("1a. Sin token", await vincular(undefined, ana, cuenta("g-ana")));
    await paso("1b. Token mal formado", await vincular("corto", ana, cuenta("g-ana")));
    await paso("1c. Token bien formado que no existe", await vincular(TOKEN("X", 1), ana, cuenta("g-ana")));

    // 2. La invitación de VINCULACIÓN: consume la invitación, crea la cuenta (con sus tokens opcionales) y audita.
    await invitar(E, "ana@gmail.com", "vinculacion", TOKEN("V", 1));
    await paso(
      "2a. Vinculación pendiente, email coincide, usuario sin cuenta (con los campos opcionales de la cuenta)",
      await vincular(TOKEN("V", 1), ana, cuenta("g-ana", { type: "oidc", access_token: "at", refresh_token: "rt", id_token: "idt", expires_at: 1234, scope: "openid email", token_type: "Bearer", session_state: "ss" })),
    );
    await paso("2b. La misma invitación ya consumida", await vincular(TOKEN("V", 1), ana, cuenta("g-ana")));

    // 3. La cuenta ya es la de ese usuario (idempotente: no consume la invitación) y con OTRO identificador (no se vincula nada).
    await invitar(E, "ana@gmail.com", "vinculacion", TOKEN("V", 2));
    await paso("3a. El usuario ya tiene esa misma cuenta de Google: devuelve true sin consumir la invitación", await vincular(TOKEN("V", 2), ana, cuenta("g-ana")));
    await paso("3b. El usuario ya tiene OTRA cuenta de Google: no se vincula", await vincular(TOKEN("V", 2), ana, cuenta("g-ana-otra")));

    // 4. El email tiene que ser exactamente el del usuario.
    await invitar(E, "beto@gmail.com", "vinculacion", TOKEN("V", 3));
    await paso("4a. El email de la invitación no es el del usuario", await vincular(TOKEN("V", 3), carla, cuenta("g-carla")));
    await paso("4b. El email del usuario con mayúsculas y espacios se normaliza", await vincular(TOKEN("V", 3), { id: beto.id, email: "  Beto@Gmail.com " }, cuenta("g-beto")));

    // 5. La invitación de USUARIO (empresa activa) vincula pero NO se consume (la consume la aceptación después).
    await invitar(E, "carla@gmail.com", "usuario", TOKEN("U", 1));
    await paso("5a. Invitación de usuario en empresa activa: vincula y no se consume", await vincular(TOKEN("U", 1), carla, cuenta("g-carla")));

    // 6. La invitación de GERENTE vincula solo con la empresa en alta.
    await invitar(P, "dani@gmail.com", "gerente", TOKEN("G", 1));
    await paso("6a. Gerente con la empresa en alta: vincula y no se consume", await vincular(TOKEN("G", 1), dani, cuenta("g-dani")));
    await invitar(E, "eva@gmail.com", "gerente", TOKEN("G", 2));
    await paso("6b. Gerente con la empresa ACTIVA: no sirve para vincular", await vincular(TOKEN("G", 2), eva, cuenta("g-eva")));

    // 7. Estados que no sirven.
    await invitar(E, "fede@gmail.com", "vinculacion", TOKEN("V", 4), { venceEn: new Date(Date.now() - 3_600_000) });
    await paso("7a. Invitación vencida", await vincular(TOKEN("V", 4), fede, cuenta("g-fede")));
    await invitar(E, "gabi@gmail.com", "vinculacion", TOKEN("V", 5), { estado: "REVOCADA" });
    await paso("7b. Invitación revocada", await vincular(TOKEN("V", 5), gabi, cuenta("g-gabi")));
    await invitar(S, "hugo@gmail.com", "vinculacion", TOKEN("V", 6));
    await paso("7c. Vinculación de una empresa suspendida", await vincular(TOKEN("V", 6), hugo, cuenta("g-hugo")));

    // 8. Choque de unicidad: ese identificador de Google ya es de otro usuario.
    await invitar(E, "gabi@gmail.com", "vinculacion", TOKEN("V", 7));
    await paso("8. El identificador de Google ya pertenece a otro usuario (choque de unicidad): false", await vincular(TOKEN("V", 7), gabi, cuenta("g-ana")));

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(4_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_HUELLA_DE_LOGIN === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta huella-de-login.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 120_000);
});
