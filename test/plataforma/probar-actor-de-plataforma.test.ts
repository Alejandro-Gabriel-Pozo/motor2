import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cifrarSecreto } from "../../src/core/plataforma/cifrado";
import { BLOQUEO_POR_FALLOS_MS, MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR } from "../../src/core/plataforma/limites";
import { codigoTotp, generarSecretoTotp, pasoDeTotp } from "../../src/core/plataforma/totp";
import { azarDelProceso } from "../../src/lib/azar";
import { ActorDePlataformaError } from "../../src/server/operaciones-de-plataforma/requerir-admin-de-plataforma";
import { MENSAJE_DE_PRUEBA_RECHAZADA, MENSAJE_SIN_CODIGO_DE_ACTOR, probarActorDePlataforma } from "../../scripts/plataforma/probar-actor-de-plataforma";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * M-32 (el dueño dijo «ok cerrarlo»): `--actor` de los scripts de plataforma ATRIBUÍA pero no AUTENTICABA; quien tuviera `PLATAFORMA_DATABASE_URL` firmaba como cualquier administrador activo.
 * Ahora el script exige un TOTP vigente de ese administrador, verificado contra su secreto cifrado (mismo segundo factor que la consola), con cupo de intentos y auditoría del intento fallido.
 * Corre con el cliente del dueño (en producción, `motor2_plataforma`), como el resto de los tests de plataforma con base.
 */
const CLAVE = randomBytes(32).toString("base64");
const AHORA = AHORA_DE_LA_CORRIDA;

async function adminConTotp(email: string, activo = true) {
  const secreto = generarSecretoTotp(azarDelProceso);
  const creado = await prismaAdmin.adminPlataforma.create({ data: { email, nombre: "Admin", secretoTotp: "x", activo } });
  await prismaAdmin.adminPlataforma.update({ where: { id: creado.id }, data: { secretoTotp: cifrarSecreto(secreto, CLAVE, creado.id, azarDelProceso) } });
  return { id: creado.id, email, secreto };
}

const prueba = (codigo: string | undefined, extra: Partial<{ claveTotp: string | undefined; ahora: Date }> = {}) => ({ codigo, claveTotp: CLAVE, ahora: AHORA, instalacionId: "zuluhub", ...extra });
const codigoDe = (secreto: string, desplazamientoDePasos = 0, ahora = AHORA) => codigoTotp(secreto, pasoDeTotp(ahora.getTime()) + desplazamientoDePasos);

afterAll(async () => {
  await prismaAdmin.auditoriaPlataforma.deleteMany();
  await prismaAdmin.adminPlataforma.deleteMany();
  await limpiarBaseDeTest();
  await prismaAdmin.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  await prismaAdmin.auditoriaPlataforma.deleteMany();
  await prismaAdmin.adminPlataforma.deleteMany();
});

describe("probarActorDePlataforma (M-32)", () => {
  it("el código vigente del administrador indicado pasa, queda su paso anotado y se limpian los fallos", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    await prismaAdmin.adminPlataforma.update({ where: { id: a.id }, data: { fallosSegundoFactor: 3 } });
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto)))).resolves.toBeUndefined();
    const fila = await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: a.id } });
    expect(fila.ultimoPasoTotp).toBe(pasoDeTotp(AHORA.getTime()));
    expect(fila.fallosSegundoFactor).toBe(0);
    expect(await prismaAdmin.auditoriaPlataforma.count()).toBe(0);
  });

  it("EL ATAQUE: un actor válido SIN código se rechaza, sin gastar un intento ni tocar la auditoría", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    for (const sinCodigo of [undefined, "", "   "]) {
      await expect(probarActorDePlataforma(prismaAdmin, a, prueba(sinCodigo))).rejects.toThrow(MENSAJE_SIN_CODIGO_DE_ACTOR);
    }
    const fila = await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: a.id } });
    expect(fila.fallosSegundoFactor).toBe(0);
    expect(await prismaAdmin.auditoriaPlataforma.count()).toBe(0);
  });

  it("EL ATAQUE: el código de OTRO administrador se rechaza (cuenta como fallo del indicado y queda en la auditoría)", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    const otro = await adminConTotp("otro@plataforma.test");
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(otro.secreto)))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
    expect((await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: a.id } })).fallosSegundoFactor).toBe(1);
    const auditoria = await prismaAdmin.auditoriaPlataforma.findMany();
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ adminId: a.id, adminEmail: "dueno@plataforma.test", accion: "script-actor-rechazado" });
    expect(auditoria[0].detalle).toEqual({ origen: "script", motivo: "codigo-incorrecto", instalacion: "zuluhub" });
  });

  it("EL ATAQUE: un código VENCIDO (de hace más de la tolerancia de ±1 paso) se rechaza; uno dentro de la tolerancia, no", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto, -3)))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto, +3)))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto, -1)))).resolves.toBeUndefined();
  });

  it("EL ATAQUE: un código ya usado no sirve de nuevo (anti-replay, compartido con la consola)", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    const codigo = codigoDe(a.secreto);
    await probarActorDePlataforma(prismaAdmin, a, prueba(codigo));
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigo))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
  });

  it("EL ATAQUE: intentos agotados: tras el máximo de fallos la cuenta se bloquea y ni el código CORRECTO pasa hasta que venza el bloqueo", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    for (let i = 0; i < MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR; i++) {
      await expect(probarActorDePlataforma(prismaAdmin, a, prueba("000000"))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
    }
    const bloqueada = await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: a.id } });
    expect(bloqueada.bloqueadoHasta?.getTime()).toBe(AHORA.getTime() + BLOQUEO_POR_FALLOS_MS);

    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto)))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
    const motivos = (await prismaAdmin.auditoriaPlataforma.findMany({ orderBy: { creadoEn: "asc" } })).map((f) => (f.detalle as { motivo: string }).motivo);
    expect(motivos.at(-1)).toBe("bloqueado");

    const despues = new Date(AHORA.getTime() + BLOQUEO_POR_FALLOS_MS + 60_000);
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto, 0, despues), { ahora: despues }))).resolves.toBeUndefined();
  });

  it("intentos en paralelo no consiguen más intentos que los permitidos (cerrojo de la fila)", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    const resultados = await Promise.allSettled(Array.from({ length: 12 }, () => probarActorDePlataforma(prismaAdmin, a, prueba("000000"))));
    expect(resultados.every((r) => r.status === "rejected")).toBe(true);
    const fila = await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: a.id } });
    expect(fila.bloqueadoHasta).not.toBeNull();
    // 12 pedidos: 5 gastan intentos hasta el bloqueo y los demás se rechazan por el bloqueo, sin sumar fallos de más.
    expect(fila.fallosSegundoFactor).toBeLessThan(MAXIMO_DE_FALLOS_DE_SEGUNDO_FACTOR);
  });

  it("un administrador inactivo no pasa ni con un código correcto", async () => {
    const a = await adminConTotp("baja@plataforma.test", false);
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto)))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
  });

  it("una clave de entorno ausente o mal formada es un error de configuración: no gasta un intento del administrador", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto), { claveTotp: undefined }))).rejects.toThrow(/Falta PLATAFORMA_CLAVE_TOTP/);
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto), { claveTotp: "corta" }))).rejects.toThrow(ActorDePlataformaError);
    expect((await prismaAdmin.adminPlataforma.findUniqueOrThrow({ where: { id: a.id } })).fallosSegundoFactor).toBe(0);
  });

  it("una clave de entorno de otra instalación (descifra mal) no pasa", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba(codigoDe(a.secreto), { claveTotp: randomBytes(32).toString("base64") }))).rejects.toThrow(MENSAJE_DE_PRUEBA_RECHAZADA);
  });

  it("el código no queda escrito en la auditoría", async () => {
    const a = await adminConTotp("dueno@plataforma.test");
    await expect(probarActorDePlataforma(prismaAdmin, a, prueba("987654"))).rejects.toThrow();
    const volcado = JSON.stringify(await prismaAdmin.auditoriaPlataforma.findMany());
    expect(volcado).not.toContain("987654");
  });
});
