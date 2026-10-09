import { beforeEach, describe, expect, it, vi } from "vitest";
import { leerPedidoDeIngreso } from "../../src/core/plataforma/pedido-de-ingreso";
import { VIDA_DEL_CODIGO_DE_INGRESO_MS, MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN } from "../../src/core/plataforma/limites";
import { __cookiesDeTest, __limpiarCookiesDeTest, __setHeadersDeTest } from "../setup/next-headers-stub";
import { pedirCodigo, type EstadoDeIngreso } from "../../plataforma/src/app/login/acciones";

/**
 * `pedirCodigo`, la acción pública del primer paso del ingreso a la consola (S-08, B-C15): lo que decide si un anónimo puede medir el tiempo de la respuesta para
 * saber qué emails son de un administrador, y si el cupo por origen frena un bucle. Los módulos que tocan la base, el correo o Next se reemplazan: lo que se prueba
 * es la FORMA de la acción (qué hace antes de responder y qué deja para después), no el ingreso (eso lo prueban `test/persistencia/ingreso-de-plataforma.test.ts` contra Postgres).
 */
const { despues, preparar, enviar, reportar } = vi.hoisted(() => ({
  despues: [] as Array<() => Promise<void> | void>,
  preparar: vi.fn(),
  enviar: vi.fn(),
  reportar: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (tarea: () => Promise<void> | void) => void despues.push(tarea) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../plataforma/src/db", () => ({ dbDeIdentidad: () => ({ base: "identidad" }) }));
vi.mock("../../plataforma/src/entorno", () => ({ entornoDePlataforma: () => ({ PLATAFORMA_SECRETO_CODIGOS: "s".repeat(40), PLATAFORMA_CLAVE_TOTP: "k".repeat(44) }) }));
vi.mock("../../plataforma/src/servidor/auditoria", () => ({ auditarAccionDePlataforma: vi.fn() }));
vi.mock("../../plataforma/src/servidor/ingreso", () => ({ prepararCodigoDeIngreso: preparar, verificarCodigoDeIngreso: vi.fn(), verificarSegundoFactor: vi.fn() }));
vi.mock("@/lib/enviar-correo", () => ({ enviarCorreo: enviar }));
vi.mock("@/lib/reportar-error", () => ({ reportarError: reportar }));

const INICIAL: EstadoDeIngreso = { paso: "email", email: "", error: null };
const formulario = (email: string) => {
  const datos = new FormData();
  datos.set("email", email);
  return datos;
};
const COOKIE = "plataforma.ingreso";
const ejecutarLoDiferido = async () => {
  const tareas = despues.splice(0);
  for (const tarea of tareas) await tarea();
};
let ip = 0;
/** Cada test pide desde una IP propia: el cupo por origen vive en la memoria del proceso y no se puede reiniciar. */
const desdeUnaIpNueva = () => {
  ip += 1;
  __setHeadersDeTest({ "x-forwarded-for": `203.0.113.${ip}, 10.0.0.1` });
  return `203.0.113.${ip}`;
};

beforeEach(() => {
  despues.length = 0;
  preparar.mockReset();
  enviar.mockReset();
  reportar.mockReset();
  __limpiarCookiesDeTest();
  desdeUnaIpNueva();
});

describe("pedirCodigo — la respuesta no delata qué emails son de un administrador", () => {
  it("responde SIN tocar la base: la preparación (buscar al administrador, contar el cupo, crear el código, mandar el mail) corre después de responder", async () => {
    preparar.mockResolvedValue({ para: ["admin@plataforma.test"], asunto: "a", texto: "b" });
    const estado = await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    expect(estado).toEqual({ paso: "codigo", email: "admin@plataforma.test", error: null });
    expect(preparar).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
    expect(despues).toHaveLength(1);

    await ejecutarLoDiferido();
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith("avisos", expect.objectContaining({ para: ["admin@plataforma.test"] }));
  });

  it("un email que no es de un administrador recibe la misma respuesta, la misma cookie y las mismas tareas diferidas (solo que no sale ningún mail)", async () => {
    preparar.mockResolvedValue(null);
    const estado = await pedirCodigo(INICIAL, formulario("nadie@plataforma.test"));
    expect(estado).toEqual({ paso: "codigo", email: "nadie@plataforma.test", error: null });
    expect(preparar).not.toHaveBeenCalled();
    expect(despues).toHaveLength(1);
    expect(__cookiesDeTest().escritas.has(COOKIE)).toBe(true);
    await ejecutarLoDiferido();
    expect(preparar).toHaveBeenCalledTimes(1);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("la cookie del pedido se pone SIEMPRE, con un pedido nuevo cada vez, y lleva el mismo pedido que se le pasa a la preparación", async () => {
    preparar.mockResolvedValue(null);
    await pedirCodigo(INICIAL, formulario("uno@plataforma.test"));
    const primero = leerPedidoDeIngreso(__cookiesDeTest().escritas.get(COOKIE));
    await pedirCodigo(INICIAL, formulario("uno@plataforma.test"));
    const segundo = leerPedidoDeIngreso(__cookiesDeTest().escritas.get(COOKIE));
    expect(primero).not.toBeNull();
    expect(segundo).not.toBeNull();
    expect(segundo).not.toEqual(primero);

    await ejecutarLoDiferido();
    expect(preparar).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), "uno@plataforma.test", primero);
    expect(preparar).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), "uno@plataforma.test", segundo);
  });

  it("la cookie es del propio navegador: httpOnly, SameSite=Strict, Path=/ y vive lo que el código", async () => {
    await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    const opciones = __cookiesDeTest().opciones.get(COOKIE) as { httpOnly: boolean; sameSite: string; path: string; expires: Date };
    expect(opciones).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    const vida = opciones.expires.getTime() - Date.now();
    expect(vida).toBeGreaterThan(VIDA_DEL_CODIGO_DE_INGRESO_MS - 5_000);
    expect(vida).toBeLessThanOrEqual(VIDA_DEL_CODIGO_DE_INGRESO_MS);
  });

  it("un email vacío es el único rechazo inmediato, y no toca nada (ni cookie ni tareas)", async () => {
    const estado = await pedirCodigo(INICIAL, formulario("  "));
    expect(estado).toMatchObject({ paso: "email", error: "Ingresá tu email." });
    expect(despues).toHaveLength(0);
    expect(__cookiesDeTest().escritas.has(COOKIE)).toBe(false);
  });

  it("si la preparación o el mail fallan (la base caída), no revienta nada: se reporta sin el mensaje original (puede traer el email)", async () => {
    preparar.mockRejectedValue(Object.assign(new Error("fallo con admin@plataforma.test"), { name: "PrismaClientKnownRequestError" }));
    await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    await expect(ejecutarLoDiferido()).resolves.toBeUndefined();
    expect(reportar).toHaveBeenCalledTimes(1);
    expect(String(reportar.mock.calls[0][0].message)).toContain("PrismaClientKnownRequestError");
    expect(String(reportar.mock.calls[0][0].message)).not.toContain("admin@plataforma.test");
  });
});

describe("pedirCodigo — el cupo por origen (best effort, por instancia)", () => {
  it(`desde un mismo origen se atienden ${MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN} pedidos; el siguiente se responde IGUAL pero no prepara ni manda nada`, async () => {
    for (let i = 0; i < MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN; i++) await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    expect(despues).toHaveLength(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN);
    despues.length = 0;
    __limpiarCookiesDeTest();

    const estado = await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    expect(estado).toEqual({ paso: "codigo", email: "admin@plataforma.test", error: null });
    expect(__cookiesDeTest().escritas.has(COOKIE)).toBe(true);
    expect(despues).toHaveLength(0);
  });

  it("el cupo es por origen: otro origen no lo comparte, y el que gastó el suyo no le gasta el cupo a nadie más", async () => {
    for (let i = 0; i < MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN + 3; i++) await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    despues.length = 0;
    desdeUnaIpNueva();
    await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    expect(despues).toHaveLength(1);
  });

  it("sin cabecera de IP (desarrollo local, E2E) no hay origen que contar: nunca se limita", async () => {
    __setHeadersDeTest({});
    for (let i = 0; i < MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN + 5; i++) await pedirCodigo(INICIAL, formulario("admin@plataforma.test"));
    expect(despues).toHaveLength(MAXIMO_DE_PEDIDOS_DE_CODIGO_POR_ORIGEN + 5);
  });
});
