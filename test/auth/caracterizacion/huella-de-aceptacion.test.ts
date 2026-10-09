import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prismaAdmin } from "../../setup/test-db";
import { AHORA_DE_LA_CORRIDA, HORA_MS } from "../../setup/tiempo";
import { aceptarInvitacionDelToken, aceptarInvitacionDeUsuarioDelToken, requierePermiso, sembrarEmpresa, incorporarPrimerGerente, hashDeToken } from "./adaptador-de-imports";

/**
 * HUELLA de ACEPTAR una invitación (Hito 3, B3-1 de `docs/plan-hito-3-pureza.md`; O.34 de `docs/pureza-integracion.md`). B3 mueve las dos aceptaciones —la del primer
 * gerente (E5, ADR-020) y la de usuario (E8, ADR-024)— de `core` a casos de uso con su persistencia. `huella-de-gobierno` solo toca aceptar-usuario en el camino feliz: la
 * revalidación de quien otorgó (`aceptar-invitacion-de-usuario.ts`) la cubrían tests de comportamiento que miran `ok: false` sin fijar el TEXTO de 5 de los 7 mensajes, ni
 * qué mensaje gana cuando fallan varias cosas a la vez, ni el caso del rol de QUIEN OTORGÓ desactivado con el rol de la invitación activo. Esta huella fija todo eso.
 *
 * Se escribe contra el código VIEJO, antes de mover nada, y NO se edita en ningún paso posterior: si una mudanza cambia un mensaje, el orden de los chequeos, una fila o su
 * auditoría, este archivo lo detecta en rojo. Importa lo que prueba DESDE `adaptador-de-imports.ts` (lo único que cambia cuando una función se muda). Para regenerarlo A
 * PROPÓSITO (una decisión de producto, nunca una mudanza): `REGENERAR_HUELLA_DE_ACEPTACION=1 npx vitest run test/auth/caracterizacion/huella-de-aceptacion.test.ts`, y la
 * regeneración se declara en `test/arquitectura/caracterizaciones-congeladas.test.ts`. Archivo propio y no snapshots de Vitest, para que `-u` no lo regenere en silencio.
 *
 * Es UNA secuencia con estado: cada rechazo usa una invitación propia (o cambia algo y lo vuelve atrás), y después de cada paso se vuelcan el resultado y TODAS las filas
 * de `Invitacion`, `UsuarioEmpresa`, `UsuarioSucursal` y `RegistroAuditoria` de las empresas de la huella, con todas sus columnas, ids reemplazados por nombres simbólicos y
 * lo que cambia por corrida (horas, hashes de tokens) enmascarado: un rechazo que escribiera algo (o una aceptación que escribiera de más) se ve en el volcado. La hora entra
 * EXPLÍCITA (`ahora`, la de la corrida: `test/setup/tiempo.ts`) en cada aceptación; los vencimientos se escriben relativos a ella.
 */
const ARCHIVO = join(__dirname, "huella-de-aceptacion.golden.txt");
const E = "empresa-activa-huella";
const F = "empresa-en-alta-huella";
const G = "empresa-con-cuit-huella";
const AHORA = AHORA_DE_LA_CORRIDA;
const VIGENTE = new Date(AHORA.getTime() + 24 * HORA_MS);
const VENCIDA = new Date(AHORA.getTime() - HORA_MS);
const TOKEN = (n: number) => `A${String(n).padStart(2, "0")}${"a".repeat(40)}`;
const CUIT_DE_G = "30712345671";
const CUIT_VALIDO = "30-50000000-3";

afterAll(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

describe("Huella de aceptar una invitación (gerente y usuario)", () => {
  const nombres = new Map<string, string>();
  const desconocidos = new Map<string, string>();
  const lineas: string[] = [];
  let tokens = 0;

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

  /** Las cuatro tablas que toca aceptar, de las tres empresas de la huella, con todas sus columnas. */
  async function volcado(): Promise<string[]> {
    const donde = { empresaId: { in: [E, F, G] } };
    const filas = (titulo: string, datos: Record<string, unknown>[]) => datos.map((d) => `  ${titulo} ${fila({ ...d })}`);
    const invs = await prismaAdmin.invitacion.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadaEn: "asc" }, { id: "asc" }] });
    invs.forEach((u, i) => nombres.set(u.id, `inv${i + 1}`));
    const uemp = await prismaAdmin.usuarioEmpresa.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadoEn: "asc" }, { id: "asc" }] });
    uemp.forEach((u, i) => nombres.set(u.id, `uemp${i + 1}`));
    const usuc = await prismaAdmin.usuarioSucursal.findMany({ where: donde, orderBy: [{ empresaId: "asc" }, { creadoEn: "asc" }, { id: "asc" }] });
    usuc.forEach((u, i) => nombres.set(u.id, `usuc${i + 1}`));
    const auditoria = await prismaAdmin.registroAuditoria.findMany({ where: donde, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    return [
      ...filas("INVITACION", invs as unknown as Record<string, unknown>[]),
      ...filas("USUARIO_EMPRESA", uemp as unknown as Record<string, unknown>[]),
      ...filas("USUARIO_SUCURSAL", usuc as unknown as Record<string, unknown>[]),
      ...filas("AUDITORIA", auditoria as unknown as Record<string, unknown>[]),
    ];
  }

  const paso = async (titulo: string, resultado: unknown) => {
    lineas.push(`### ${titulo}`, `  resultado: ${JSON.stringify(resultado, (_, v) => (typeof v === "string" ? simbolo(v).replace(/c[a-z0-9]{20,}/g, (id) => simbolo(id)) : v))}`, ...(await volcado()));
  };

  beforeEach(async () => {
    nombres.clear();
    desconocidos.clear();
    lineas.length = 0;
    tokens = 0;
    await limpiarBaseDeTest();
  });

  /** Una empresa sembrada (roles, matriz, sucursal) en el estado pedido. */
  async function empresaSembrada(id: string, estado: "ACTIVE" | "PROVISIONING", sucursal: string) {
    await prismaAdmin.empresa.create({ data: { id, nombre: `Empresa ${id}`, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado } });
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${id}, true)`;
      await sembrarEmpresa(tx, id, sucursal);
    });
  }

  const usuario = async (nombre: string, email: string) => {
    const u = await prismaAdmin.user.create({ data: { email } });
    nombres.set(u.id, nombre);
    return u.id;
  };

  /** Una invitación de gerente (como la deja la consola), con su token. */
  async function invitacionDeGerente(empresaId: string, email: string, venceEn = VIGENTE) {
    const token = TOKEN(++tokens);
    await prismaAdmin.invitacion.create({ data: { empresaId, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn } });
    return token;
  }

  /** Una invitación de usuario de la empresa E con una fila por sucursal (en este orden), como la deja la acción de invitar. */
  async function invitacionDeUsuario(email: string, accesos: Array<{ sucursalId: string; rolId: string; invitadoPorId: string; notas?: string }>, venceEn = VIGENTE, firmante = accesos[0]?.invitadoPorId) {
    const token = TOKEN(++tokens);
    const inv = await prismaAdmin.invitacion.create({ data: { empresaId: E, email, rolEmpresa: "usuario", hashToken: hashDeToken(token), venceEn, invitadoPorId: firmante ?? null } });
    for (const a of accesos) {
      await prismaAdmin.invitacionSucursal.create({ data: { empresaId: E, invitacionId: inv.id, sucursalId: a.sucursalId, rolId: a.rolId, invitadoPorId: a.invitadoPorId, notas: a.notas ?? null } });
    }
    return { token, id: inv.id };
  }

  it("la secuencia entera coincide con lo guardado", async () => {
    // ---- Preparación: E activa (Central y Norte, su gerente y un segundo administrador), F en alta (su sucursal, sin gerente) y G con un CUIT.
    await empresaSembrada(E, "ACTIVE", "Central");
    await empresaSembrada(F, "PROVISIONING", "Casa central");
    await prismaAdmin.empresa.create({ data: { id: G, nombre: "Empresa con CUIT", slug: G, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit: CUIT_DE_G } });
    const gerente = await usuario("gerente", "gerente@gmail.com");
    await prismaAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.empresa_id', ${E}, true)`;
      await incorporarPrimerGerente(tx, { empresaId: E, usuarioId: gerente });
    });
    const central = (await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: E } })).id;
    const casaCentralF = (await prismaAdmin.sucursal.findFirstOrThrow({ where: { empresaId: F } })).id;
    const rolAdmin = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: E, clave: "admin" } })).id;
    const rolOperador = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: E, clave: "operador" } })).id;
    const rolAdminF = (await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: F, clave: "admin" } })).id;
    const norte = (await prismaAdmin.sucursal.create({ data: { empresaId: E, nombre: "Norte" } })).id;
    const rolCajero = (await prismaAdmin.rol.create({ data: { empresaId: E, nombre: "Cajero" } })).id;
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: gerente, sucursalId: norte, empresaId: E, rolId: rolAdmin } });
    const admin2 = await usuario("admin2", "admin2@gmail.com");
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: admin2, empresaId: E } });
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: admin2, sucursalId: central, empresaId: E, rolId: rolAdmin } });
    const dueño = await usuario("dueño", "dueno@gmail.com");
    const intruso = await usuario("intruso", "intruso@gmail.com");
    for (const [nombre, id] of Object.entries({ E, F, G, central, norte, casaCentralF, rolAdmin, rolOperador, rolCajero, rolAdminF })) nombres.set(id, nombre);
    await paso("0. Preparación", null);

    const comoGerente = (token: string, quien: { id: string; email: string }, cuit: unknown) => aceptarInvitacionDelToken({ token, usuario: quien, cuit, ahora: AHORA });
    const comoUsuario = (token: string, quien: { id: string; email: string }) => aceptarInvitacionDeUsuarioDelToken({ token, usuario: quien, ahora: AHORA }, requierePermiso);
    const elDueño = { id: dueño, email: "dueno@gmail.com" };
    const elIntruso = { id: intruso, email: "intruso@gmail.com" };

    // ==== Aceptar la invitación del PRIMER GERENTE (empresa F en alta) ====
    // Una sola invitación PENDIENTE por email y empresa (índice único): cada invitación de un solo caso se revoca al terminar.
    const revocar = (token: string) => prismaAdmin.invitacion.updateMany({ where: { hashToken: hashDeToken(token), estado: "PENDIENTE" }, data: { estado: "REVOCADA", revocadaEn: AHORA } });
    const unCaso = async (titulo: string, token: string, intento: (token: string) => Promise<unknown>) => {
      await paso(titulo, await intento(token));
      await revocar(token);
    };
    await paso("G1. Token mal formado", await comoGerente("corto", elDueño, CUIT_VALIDO));
    await paso("G2. Token bien formado que no existe", await comoGerente(TOKEN(99), elDueño, CUIT_VALIDO));
    await unCaso("G3. Invitación vencida", await invitacionDeGerente(F, "dueno@gmail.com", VENCIDA), (t) => comoGerente(t, elDueño, CUIT_VALIDO));
    const revocada = await invitacionDeGerente(F, "dueno@gmail.com");
    await revocar(revocada);
    await paso("G4. Invitación revocada", await comoGerente(revocada, elDueño, CUIT_VALIDO));
    await unCaso("G5. Una invitación de usuario usada como de gerente", (await invitacionDeUsuario("dueno@gmail.com", [{ sucursalId: central, rolId: rolOperador, invitadoPorId: gerente }])).token, (t) => comoGerente(t, elDueño, CUIT_VALIDO));
    await unCaso("G6. Una invitación de gerente de una empresa que ya no está en alta", await invitacionDeGerente(E, "dueno@gmail.com"), (t) => comoGerente(t, elDueño, CUIT_VALIDO));
    await unCaso("G7. Dos fallas: vencida y otro email", await invitacionDeGerente(F, "dueno@gmail.com", VENCIDA), (t) => comoGerente(t, elIntruso, CUIT_VALIDO));
    await unCaso("G8. Dos fallas: empresa que no está en alta y CUIT inválido", await invitacionDeGerente(E, "dueno@gmail.com"), (t) => comoGerente(t, elDueño, "123"));
    const principal = await invitacionDeGerente(F, "dueno@gmail.com");
    await paso("G9. Otro email", await comoGerente(principal, elIntruso, CUIT_VALIDO));
    await paso("G10. CUIT con formato inválido", await comoGerente(principal, elDueño, "123"));
    await paso("G11. CUIT con el dígito verificador mal", await comoGerente(principal, elDueño, "30-71234567-4"));
    await paso("G12. CUIT vacío", await comoGerente(principal, elDueño, ""));
    await paso("G13. CUIT que ya tiene otra empresa", await comoGerente(principal, elDueño, CUIT_DE_G));
    await paso("G14. Dos fallas: otro email y CUIT inválido (gana el email)", await comoGerente(principal, elIntruso, "123"));
    const otroGerente = await usuario("otroGerente", "otro-gerente@gmail.com");
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: otroGerente, empresaId: F, rolEmpresa: "gerente" } });
    await paso("G15. La empresa ya tiene gerente (se deshace todo, la invitación sigue pendiente)", await comoGerente(principal, elDueño, CUIT_VALIDO));
    await prismaAdmin.usuarioEmpresa.deleteMany({ where: { usuarioId: otroGerente, empresaId: F } });
    await prismaAdmin.sucursal.update({ where: { id: casaCentralF }, data: { activo: false } });
    await paso("G16. La empresa no tiene sucursal activa (se deshace todo)", await comoGerente(principal, elDueño, CUIT_VALIDO));
    await prismaAdmin.sucursal.update({ where: { id: casaCentralF }, data: { activo: true } });
    await paso("G17. Aceptar con un CUIT válido", await comoGerente(principal, elDueño, CUIT_VALIDO));
    await paso("G18. Aceptar otra vez el mismo enlace", await comoGerente(principal, elDueño, CUIT_VALIDO));

    // ==== Aceptar una invitación de USUARIO (empresa E activa) ====
    const persona = await usuario("persona", "persona@gmail.com");
    const laPersona = { id: persona, email: "persona@gmail.com" };
    const unaFila = (invitadoPorId = gerente, sucursalId = central, rolId = rolOperador) => [{ sucursalId, rolId, invitadoPorId }];
    await paso("U1. Token mal formado", await comoUsuario("corto", laPersona));
    await paso("U2. Token bien formado que no existe", await comoUsuario(TOKEN(98), laPersona));
    await unCaso("U3. Una invitación de gerente usada como de usuario", await invitacionDeGerente(F, "persona@gmail.com"), (t) => comoUsuario(t, laPersona));
    await unCaso("U4. Invitación vencida", (await invitacionDeUsuario("persona@gmail.com", unaFila(), VENCIDA)).token, (t) => comoUsuario(t, laPersona));
    const revocadaU = await invitacionDeUsuario("persona@gmail.com", unaFila());
    await revocar(revocadaU.token);
    await paso("U5. Invitación revocada", await comoUsuario(revocadaU.token, laPersona));
    const deOtro = await invitacionDeUsuario("persona@gmail.com", unaFila());
    await paso("U6. Otro email", await comoUsuario(deOtro.token, elIntruso));
    await prismaAdmin.empresa.update({ where: { id: E }, data: { estado: "SUSPENDED" } });
    await paso("U7. Empresa suspendida", await comoUsuario(deOtro.token, laPersona));
    await paso("U8. Dos fallas: otro email y empresa suspendida (gana el email)", await comoUsuario(deOtro.token, elIntruso));
    await prismaAdmin.empresa.update({ where: { id: E }, data: { estado: "ACTIVE" } });
    await revocar(deOtro.token);
    await unCaso("U9. Una invitación sin sucursales", (await invitacionDeUsuario("persona@gmail.com", [], VIGENTE, gerente)).token, (t) => comoUsuario(t, laPersona));

    // Desde acá, cada caso con su invitación (Central por admin2, Norte por el gerente), que se revoca al terminar.
    const conDos = () => invitacionDeUsuario("persona@gmail.com", [{ sucursalId: central, rolId: rolOperador, invitadoPorId: admin2 }, { sucursalId: norte, rolId: rolOperador, invitadoPorId: gerente }]);
    const caso = async (titulo: string, invitacion: { token: string; id: string }, romper: () => Promise<unknown>, arreglar: () => Promise<unknown>) => {
      await romper();
      await paso(titulo, await comoUsuario(invitacion.token, laPersona));
      await arreglar();
      await revocar(invitacion.token);
    };
    const sucursalActiva = (id: string, activo: boolean) => prismaAdmin.sucursal.update({ where: { id }, data: { activo } });
    const rolActivo = (id: string, activo: boolean) => prismaAdmin.rol.update({ where: { id }, data: { activo } });
    const cuentaGlobal = (id: string, activoGlobal: boolean) => prismaAdmin.user.update({ where: { id }, data: { activoGlobal } });
    const cuentaEnE = (id: string, activo: boolean) => prismaAdmin.usuarioEmpresa.updateMany({ where: { usuarioId: id, empresaId: E }, data: { activo } });
    const membresia = (id: string, sucursalId: string, activo: boolean) => prismaAdmin.usuarioSucursal.updateMany({ where: { usuarioId: id, sucursalId }, data: { activo } });
    const gestionDeUsuariosDelAdmin = (puedeEditar: boolean) => prismaAdmin.permisoRol.updateMany({ where: { rolId: rolAdmin, accionClave: "gestion_usuarios" }, data: { puedeEditar } });

    await caso("U10. La segunda sucursal (Norte) se desactivó", await conDos(), () => sucursalActiva(norte, false), () => sucursalActiva(norte, true));
    await caso("U11. El rol que da la invitación se desactivó", await invitacionDeUsuario("persona@gmail.com", [{ sucursalId: central, rolId: rolCajero, invitadoPorId: admin2 }]), () => rolActivo(rolCajero, false), () => rolActivo(rolCajero, true));
    await caso("U12. Quien otorgó Central tiene la cuenta apagada en toda la plataforma", await conDos(), () => cuentaGlobal(admin2, false), () => cuentaGlobal(admin2, true));
    await caso("U13. Quien otorgó Central tiene la cuenta apagada en la empresa", await conDos(), () => cuentaEnE(admin2, false), () => cuentaEnE(admin2, true));
    await caso("U14. Quien otorgó Central perdió su membresía en Central", await conDos(), () => membresia(admin2, central, false), () => membresia(admin2, central, true));
    await caso("U15. Al rol de quien otorgó le sacaron gestion_usuarios", await conDos(), () => gestionDeUsuariosDelAdmin(false), () => gestionDeUsuariosDelAdmin(true));
    await caso("U16. El rol de QUIEN OTORGÓ se desactivó y el rol de la invitación sigue activo", await conDos(), () => rolActivo(rolAdmin, false), () => rolActivo(rolAdmin, true));
    await unCaso("U17. El techo: un administrador que no es el gerente no incorpora al gerente", (await invitacionDeUsuario("gerente@gmail.com", unaFila(admin2))).token, (t) => comoUsuario(t, { id: gerente, email: "gerente@gmail.com" }));
    const exAdmin = await usuario("exAdmin", "ex-admin@gmail.com");
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: exAdmin, empresaId: E, activo: false } });
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: exAdmin, sucursalId: norte, empresaId: E, rolId: rolAdmin, activo: false } });
    await unCaso("U18. Reactivar a quien fue administrador sin ser el gerente", (await invitacionDeUsuario("ex-admin@gmail.com", unaFila(admin2))).token, (t) => comoUsuario(t, { id: exAdmin, email: "ex-admin@gmail.com" }));

    // Dos fallas a la vez: fijan el ORDEN de los chequeos.
    await caso("U19. Dos fallas en sucursales distintas: Central sin permiso de quien otorgó y Norte desactivada (gana la primera fila)", await conDos(),
      () => Promise.all([membresia(admin2, central, false), sucursalActiva(norte, false)]), () => Promise.all([membresia(admin2, central, true), sucursalActiva(norte, true)]));
    await caso("U20. Dos fallas en la misma sucursal: Central desactivada y quien la otorgó apagado (gana la sucursal)", await conDos(),
      () => Promise.all([sucursalActiva(central, false), cuentaGlobal(admin2, false)]), () => Promise.all([sucursalActiva(central, true), cuentaGlobal(admin2, true)]));
    await caso("U21. Dos fallas de quien otorgó: cuenta apagada y sin membresía (gana la cuenta)", await conDos(),
      () => Promise.all([cuentaEnE(admin2, false), membresia(admin2, central, false)]), () => Promise.all([cuentaEnE(admin2, true), membresia(admin2, central, true)]));
    await caso("U22. Dos fallas: rol de la invitación desactivado y quien otorgó sin permiso (gana el rol)", await invitacionDeUsuario("persona@gmail.com", [{ sucursalId: central, rolId: rolCajero, invitadoPorId: admin2 }]),
      () => Promise.all([rolActivo(rolCajero, false), gestionDeUsuariosDelAdmin(false)]), () => Promise.all([rolActivo(rolCajero, true), gestionDeUsuariosDelAdmin(true)]));

    // Éxito: la persona ya tenía la cuenta (apagada) y una membresía (apagada) en Central; la invitación le da Central (operador, por admin2, con notas) y Norte (admin, por el gerente).
    await prismaAdmin.usuarioEmpresa.create({ data: { usuarioId: persona, empresaId: E, activo: false } });
    await prismaAdmin.usuarioSucursal.create({ data: { usuarioId: persona, sucursalId: central, empresaId: E, rolId: rolCajero, activo: false } });
    const buena = await invitacionDeUsuario("persona@gmail.com", [
      { sucursalId: central, rolId: rolOperador, invitadoPorId: admin2, notas: "Turno mañana" },
      { sucursalId: norte, rolId: rolAdmin, invitadoPorId: gerente },
    ]);
    await paso("U23. Aceptar: reactiva la cuenta, actualiza Central y crea Norte, con quien otorgó cada una como actor", await comoUsuario(buena.token, laPersona));
    await paso("U24. Aceptar otra vez el mismo enlace", await comoUsuario(buena.token, laPersona));

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(8_000); // si el escenario no armó nada, esto no está mirando nada

    if (process.env.REGENERAR_HUELLA_DE_ACEPTACION === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta huella-de-aceptacion.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 180_000);
});
