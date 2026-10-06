import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cifrarSecreto } from "../../src/core/plataforma/cifrado";
import { generarCodigosDeRecuperacion, hashDeCodigoDeRecuperacion } from "../../src/core/plataforma/codigos";
import { hashDeToken } from "../../src/core/seguridad/tokens";
import {
  BLOQUEO_POR_FALLOS_MS,
  MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA,
  MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR,
  MAXIMO_DE_INTENTOS_POR_CODIGO,
  VIDA_DEL_CODIGO_DE_INGRESO_MS,
} from "../../src/core/plataforma/limites";
import { VIDA_DE_SESION_PENDIENTE_MS } from "../../src/core/plataforma/sesion";
import { codigoTotp, generarSecretoTotp, pasoDeTotp } from "../../src/core/plataforma/totp";
import {
  prepararCodigoDeIngreso,
  verificarCodigoDeIngreso,
  verificarSegundoFactor,
  type DependenciasDeIngreso,
} from "../../plataforma/src/servidor/ingreso";
import { prismaAdmin } from "../setup/test-db";
import { azarDelProceso } from "../../src/lib/azar";

/**
 * Los dos factores de ingreso de la consola contra Postgres real (E4, ADR-012 §2, ADR-019), con la conexión del dueño (el rol `motor2_plataforma`
 * existe solo en CI) y un reloj que el test mueve a mano. Lo que se cuida: nada se guarda en claro, un código sirve una vez y por un rato, los
 * intentos son finitos (también en paralelo), un TOTP no se repite, la sesión del paso 1 no sirve después del paso 2, y quien falla no distingue por qué.
 */
const EMAIL = "admin@plataforma.test";
const SECRETO_DE_CODIGOS = "s".repeat(40);
const CLAVE_TOTP = randomBytes(32).toString("base64");
const INICIO = new Date("2026-10-03T12:00:00.000Z");

let reloj = INICIO;
const deps: DependenciasDeIngreso = { ahora: () => reloj, secretoDeCodigos: SECRETO_DE_CODIGOS, claveTotp: CLAVE_TOTP };
const avanzar = (ms: number) => {
  reloj = new Date(reloj.getTime() + ms);
};

let adminId: string;
let secretoTotp: string;
let codigosDeRecuperacion: string[];

async function sembrarAdmin(email = EMAIL, activo = true) {
  const id = randomUUID();
  const secreto = generarSecretoTotp(azarDelProceso);
  await prismaAdmin.adminPlataforma.create({ data: { id, email, nombre: "Admin", activo, secretoTotp: cifrarSecreto(secreto, CLAVE_TOTP, id, azarDelProceso) } });
  const recuperacion = generarCodigosDeRecuperacion(azarDelProceso, 3);
  await prismaAdmin.codigoDeRecuperacionPlataforma.createMany({
    data: recuperacion.map((codigo) => ({ adminId: id, hashCodigo: hashDeCodigoDeRecuperacion(codigo, SECRETO_DE_CODIGOS, id) })),
  });
  return { id, secreto, recuperacion };
}

/** Pide el código y lo lee del mail armado (lo único que viaja en claro, y solo por el correo). */
async function pedirCodigo(email = EMAIL): Promise<string> {
  const mensaje = await prepararCodigoDeIngreso(prismaAdmin, deps, email);
  expect(mensaje).not.toBeNull();
  const coincidencia = /\b(\d{6})\b/.exec(mensaje!.texto);
  expect(coincidencia).not.toBeNull();
  return coincidencia![1];
}

const otro = (codigo: string) => (codigo === "000000" ? "000001" : "000000");

async function abrirSesionPendiente(): Promise<string> {
  const resultado = await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, await pedirCodigo());
  expect(resultado.ok).toBe(true);
  return resultado.ok ? resultado.token : "";
}

/** Un TOTP válido para el reloj actual y MAYOR a cualquier paso ya usado (avanza el reloj de a un paso si hace falta). */
function totpValido(): string {
  return codigoTotp(secretoTotp, pasoDeTotp(reloj.getTime()));
}

beforeEach(async () => {
  reloj = INICIO;
  const admin = await sembrarAdmin();
  adminId = admin.id;
  secretoTotp = admin.secreto;
  codigosDeRecuperacion = admin.recuperacion;
});

afterEach(async () => {
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "SesionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeRecuperacionPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "CodigoDeIngresoPlataforma"');
  await prismaAdmin.$executeRawUnsafe('DELETE FROM "AdminPlataforma"');
});

afterAll(() => prismaAdmin.$disconnect());

describe("paso 1 — el código del mail", () => {
  it("el mail lleva el código a la casilla del administrador; la base guarda solo un HMAC, nunca el código", async () => {
    const mensaje = await prepararCodigoDeIngreso(prismaAdmin, deps, EMAIL);
    expect(mensaje?.para).toEqual([EMAIL]);
    const codigo = /\b(\d{6})\b/.exec(mensaje!.texto)![1];
    const guardado = await prismaAdmin.codigoDeIngresoPlataforma.findFirstOrThrow({ where: { adminId } });
    expect(guardado.hashCodigo).toMatch(/^[0-9a-f]{64}$/);
    expect(guardado.hashCodigo).not.toContain(codigo);
    expect(guardado.venceEn.getTime() - guardado.creadoEn.getTime()).toBe(VIDA_DEL_CODIGO_DE_INGRESO_MS);
  });

  it("el email se normaliza (mayúsculas y espacios) al pedir y al verificar", async () => {
    const codigo = await pedirCodigo("  Admin@Plataforma.TEST ");
    const resultado = await verificarCodigoDeIngreso(prismaAdmin, deps, " ADMIN@plataforma.test", codigo);
    expect(resultado.ok).toBe(true);
  });

  it("un email que no es de un administrador activo no genera código ni mail (y no se distingue de uno que sí)", async () => {
    expect(await prepararCodigoDeIngreso(prismaAdmin, deps, "nadie@plataforma.test")).toBeNull();
    expect(await prepararCodigoDeIngreso(prismaAdmin, deps, "esto no es un email")).toBeNull();
    await sembrarAdmin("inactivo@plataforma.test", false);
    expect(await prepararCodigoDeIngreso(prismaAdmin, deps, "inactivo@plataforma.test")).toBeNull();
    expect(await prismaAdmin.codigoDeIngresoPlataforma.count({ where: { adminId: { not: adminId } } })).toBe(0);
    // Y el que sí existe, fallando, recibe lo mismo que el que no existe: `{ ok: false }` sin motivo.
    const existente = await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, "123456");
    const inexistente = await verificarCodigoDeIngreso(prismaAdmin, deps, "nadie@plataforma.test", "123456");
    expect(existente).toEqual(inexistente);
    expect(existente).toEqual({ ok: false });
  });

  it("se pueden pedir como mucho N códigos por hora; pasada la hora, se vuelve a poder", async () => {
    for (let i = 0; i < MAXIMO_DE_CODIGOS_PEDIDOS_POR_HORA; i++) await pedirCodigo();
    expect(await prepararCodigoDeIngreso(prismaAdmin, deps, EMAIL)).toBeNull();
    avanzar(61 * 60 * 1000);
    expect(await prepararCodigoDeIngreso(prismaAdmin, deps, EMAIL)).not.toBeNull();
  });

  it("un código nuevo invalida el anterior, aunque fuera el correcto", async () => {
    const viejo = await pedirCodigo();
    await pedirCodigo();
    expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, viejo)).toEqual({ ok: false });
  });

  it("el código sirve una sola vez", async () => {
    const codigo = await pedirCodigo();
    expect((await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, codigo)).ok).toBe(true);
    expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, codigo)).toEqual({ ok: false });
  });

  it("vence a los 10 minutos (el último instante todavía vale)", async () => {
    const codigo = await pedirCodigo();
    avanzar(VIDA_DEL_CODIGO_DE_INGRESO_MS);
    expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, codigo)).toEqual({ ok: false });
    const otroCodigo = await pedirCodigo();
    avanzar(VIDA_DEL_CODIGO_DE_INGRESO_MS - 1);
    expect((await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, otroCodigo)).ok).toBe(true);
  });

  it("agota los intentos: pasados N errores ni el código correcto sirve", async () => {
    const codigo = await pedirCodigo();
    for (let i = 0; i < MAXIMO_DE_INTENTOS_POR_CODIGO; i++) expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, otro(codigo))).toEqual({ ok: false });
    expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, codigo)).toEqual({ ok: false });
  });

  it("los intentos se reservan de forma atómica: en paralelo no se consigue ningún intento de más", async () => {
    const codigo = await pedirCodigo();
    const malos = Array.from({ length: 30 }, () => verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, otro(codigo)));
    await Promise.all(malos);
    const guardado = await prismaAdmin.codigoDeIngresoPlataforma.findFirstOrThrow({ where: { adminId } });
    expect(guardado.intentosFallidos).toBe(MAXIMO_DE_INTENTOS_POR_CODIGO);
  });

  it("dos pedidos simultáneos con el código correcto abren UNA sola sesión", async () => {
    const codigo = await pedirCodigo();
    const resultados = await Promise.all([verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, codigo), verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, codigo)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await prismaAdmin.sesionPlataforma.count({ where: { adminId } })).toBe(1);
  });

  it("la sesión abierta es PENDIENTE (sin segundo factor) y la base guarda solo el hash del token", async () => {
    const token = await abrirSesionPendiente();
    const sesion = await prismaAdmin.sesionPlataforma.findFirstOrThrow({ where: { adminId } });
    expect(sesion.segundoFactorEn).toBeNull();
    expect(sesion.hashToken).toBe(hashDeToken(token));
    expect(sesion.hashToken).not.toBe(token);
  });

  it("un código con espacios o de formato raro no abre nada", async () => {
    const codigo = await pedirCodigo();
    expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, "")).toEqual({ ok: false });
    expect(await verificarCodigoDeIngreso(prismaAdmin, deps, EMAIL, `${codigo}0`)).toEqual({ ok: false });
  });
});

describe("paso 2 — el segundo factor (TOTP o código de recuperación)", () => {
  it("con el TOTP correcto la sesión pasa a vigente con un TOKEN NUEVO: el del paso 1 deja de servir", async () => {
    const tokenPendiente = await abrirSesionPendiente();
    const resultado = await verificarSegundoFactor(prismaAdmin, deps, tokenPendiente, totpValido());
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.token).not.toBe(tokenPendiente);
    expect(resultado.adminEmail).toBe(EMAIL);
    const sesion = await prismaAdmin.sesionPlataforma.findFirstOrThrow({ where: { adminId } });
    expect(sesion.segundoFactorEn).not.toBeNull();
    expect(sesion.hashToken).toBe(hashDeToken(resultado.token));
    // El token del paso 1 ya no corresponde a ninguna sesión.
    expect(await prismaAdmin.sesionPlataforma.findUnique({ where: { hashToken: hashDeToken(tokenPendiente) } })).toBeNull();
    expect(await verificarSegundoFactor(prismaAdmin, deps, tokenPendiente, totpValido())).toMatchObject({ ok: false, motivo: "SESION_INVALIDA" });
  });

  it("el vencimiento de la cookie es de 8 horas desde el segundo factor", async () => {
    const resultado = await verificarSegundoFactor(prismaAdmin, deps, await abrirSesionPendiente(), totpValido());
    expect(resultado.ok && resultado.vencimiento.getTime()).toBe(reloj.getTime() + 8 * 60 * 60 * 1000);
  });

  it("un TOTP equivocado no entra y suma un fallo", async () => {
    const token = await abrirSesionPendiente();
    const equivocado = otro(totpValido());
    const resultado = await verificarSegundoFactor(prismaAdmin, deps, token, equivocado);
    expect(resultado).toMatchObject({ ok: false, motivo: "INCORRECTO", adminId });
    expect((await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: adminId } })).fallosSegundoFactor).toBe(1);
  });

  it("anti-replay: el mismo TOTP no entra dos veces (ni siquiera con otra sesión)", async () => {
    const codigo = totpValido();
    expect((await verificarSegundoFactor(prismaAdmin, deps, await abrirSesionPendiente(), codigo)).ok).toBe(true);
    avanzar(1000);
    const segundoToken = await abrirSesionPendiente();
    expect(await verificarSegundoFactor(prismaAdmin, deps, segundoToken, codigo)).toMatchObject({ ok: false, motivo: "INCORRECTO" });
    // El del paso siguiente sí.
    avanzar(30_000);
    expect((await verificarSegundoFactor(prismaAdmin, deps, segundoToken, totpValido())).ok).toBe(true);
  });

  it("un código de recuperación entra una sola vez (en cualquier formato) y los demás siguen vigentes", async () => {
    const [primero, segundo] = codigosDeRecuperacion;
    const resultado = await verificarSegundoFactor(prismaAdmin, deps, await abrirSesionPendiente(), primero.toLowerCase().replace("-", " "));
    expect(resultado.ok).toBe(true);
    const consumido = await prismaAdmin.codigoDeRecuperacionPlataforma.findMany({ where: { adminId, usadoEn: { not: null } } });
    expect(consumido).toHaveLength(1);
    expect(consumido[0].hashCodigo).toBe(hashDeCodigoDeRecuperacion(primero, SECRETO_DE_CODIGOS, adminId));

    avanzar(1000);
    expect(await verificarSegundoFactor(prismaAdmin, deps, await abrirSesionPendiente(), primero)).toMatchObject({ ok: false, motivo: "INCORRECTO" });
    expect((await verificarSegundoFactor(prismaAdmin, deps, await abrirSesionPendiente(), segundo)).ok).toBe(true);
  });

  it("un código de recuperación de OTRO administrador no sirve (el hash está atado al administrador)", async () => {
    const ajeno = await sembrarAdmin("otro@plataforma.test");
    const token = await abrirSesionPendiente();
    expect(await verificarSegundoFactor(prismaAdmin, deps, token, ajeno.recuperacion[0])).toMatchObject({ ok: false, motivo: "INCORRECTO" });
  });

  it("tras N fallos el administrador queda bloqueado: ni el TOTP correcto entra, y la sesión pendiente se cierra", async () => {
    const token = await abrirSesionPendiente();
    const malo = otro(totpValido());
    let ultimo = await verificarSegundoFactor(prismaAdmin, deps, token, malo);
    for (let i = 1; i < MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR; i++) {
      expect(ultimo).toMatchObject({ ok: false, motivo: "INCORRECTO", seBloqueo: false });
      ultimo = await verificarSegundoFactor(prismaAdmin, deps, token, malo);
    }
    expect(ultimo).toMatchObject({ ok: false, motivo: "INCORRECTO", seBloqueo: true });

    // La sesión pendiente se cerró: para volver a intentar hay que pedir otro código del mail.
    expect(await verificarSegundoFactor(prismaAdmin, deps, token, totpValido())).toMatchObject({ ok: false, motivo: "SESION_INVALIDA" });
    const nuevoToken = await abrirSesionPendiente();
    expect(await verificarSegundoFactor(prismaAdmin, deps, nuevoToken, totpValido())).toMatchObject({ ok: false, motivo: "BLOQUEADO" });

    // Cumplido el bloqueo, vuelve a poder entrar y el contador se limpia.
    avanzar(BLOQUEO_POR_FALLOS_MS);
    const tokenDespues = await abrirSesionPendiente();
    expect((await verificarSegundoFactor(prismaAdmin, deps, tokenDespues, totpValido())).ok).toBe(true);
    expect(await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: adminId } })).toMatchObject({ fallosSegundoFactor: 0, bloqueadoHasta: null });
  });

  it("los fallos en paralelo no se pierden: el cerrojo de la fila serializa el contador", async () => {
    const token = await abrirSesionPendiente();
    const malo = otro(totpValido());
    await Promise.all(Array.from({ length: 4 }, () => verificarSegundoFactor(prismaAdmin, deps, token, malo)));
    expect((await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: adminId } })).fallosSegundoFactor).toBe(4);
  });

  it("dos pedidos simultáneos con el MISMO TOTP correcto: solo uno promueve la sesión", async () => {
    const token = await abrirSesionPendiente();
    const codigo = totpValido();
    const resultados = await Promise.all([verificarSegundoFactor(prismaAdmin, deps, token, codigo), verificarSegundoFactor(prismaAdmin, deps, token, codigo)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });

  it("la sesión pendiente vence a los 10 minutos", async () => {
    const token = await abrirSesionPendiente();
    avanzar(VIDA_DE_SESION_PENDIENTE_MS);
    expect(await verificarSegundoFactor(prismaAdmin, deps, token, totpValido())).toMatchObject({ ok: false, motivo: "SESION_INVALIDA" });
  });

  it("un token que no existe, o de una sesión ya vigente, no sirve", async () => {
    expect(await verificarSegundoFactor(prismaAdmin, deps, "token-inventado", totpValido())).toMatchObject({ ok: false, motivo: "SESION_INVALIDA" });
    const vigente = await verificarSegundoFactor(prismaAdmin, deps, await abrirSesionPendiente(), totpValido());
    expect(vigente.ok && (await verificarSegundoFactor(prismaAdmin, deps, vigente.token, totpValido()))).toMatchObject({ ok: false, motivo: "SESION_INVALIDA" });
  });

  it("un administrador desactivado a mitad del ingreso no entra", async () => {
    const token = await abrirSesionPendiente();
    await prismaAdmin.adminPlataforma.update({ where: { id: adminId }, data: { activo: false } });
    expect(await verificarSegundoFactor(prismaAdmin, deps, token, totpValido())).toMatchObject({ ok: false, motivo: "SESION_INVALIDA" });
  });

  it("si la clave de cifrado no es la del secreto guardado, no entra nadie (ni se lanza una excepción)", async () => {
    const token = await abrirSesionPendiente();
    const otraClave = randomBytes(32).toString("base64");
    const resultado = await verificarSegundoFactor(prismaAdmin, { ...deps, claveTotp: otraClave }, token, totpValido());
    expect(resultado).toMatchObject({ ok: false, motivo: "INCORRECTO" });
  });
});
