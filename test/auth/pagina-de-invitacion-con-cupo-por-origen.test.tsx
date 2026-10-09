import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * I-2 de la auditoría intermedia (corrección de S-27, T11): `GET /invitacion` leía el token de la cookie de invitación y consultaba la base compartida (la invitación por su
 * hash y la empresa) SIN cupo. La cookie la manda el cliente: `httpOnly` y `__Host-` frenan al navegador, no a un `curl` con `Cookie: …=<token de forma válida>`. El cupo por
 * origen solo se contaba en la Server Action `abrirInvitacion`: el bucle por la página (la puerta hermana) gastaba la misma base que S-27 quería cuidar. Ahora la página usa
 * el MISMO limitador que `abrirInvitacion` (una sola instancia, un solo cupo por origen) ANTES de consultar. La consulta (`invitacionConSuBase`) se reemplaza por un contador:
 * «no consulta» es exactamente «no llegó a la base». Sin base: el cupo es de memoria.
 */
vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn(async () => null) }));
vi.mock("../../src/lib/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
const consultas = vi.hoisted(() => ({ cuantas: 0, tokens: [] as Array<string | undefined> }));
vi.mock("../../src/server/sesion/invitacion", () => ({
  invitacionConSuBase: vi.fn(async (token: string | undefined) => {
    consultas.cuantas++;
    consultas.tokens.push(token);
    return null;
  }),
  accesosDeLaInvitacion: vi.fn(async () => []),
}));

import { __limpiarCookiesDeTest, __setCookieDeTest, __setHeadersDeTest } from "../setup/next-headers-stub";
import InvitacionPage from "../../src/app/invitacion/page";
import { nombreCookieInvitacion } from "../../src/core/auth/invitacion";
import {
  MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN,
  MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION,
  origenSinCupoParaAbrirInvitacion,
} from "../../src/server/actions/limitador-anonimo";
import { generarTokenOpaco } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/** Un token de forma válida (43 caracteres base64url) que no corresponde a ninguna invitación: lo que mandaría un script que prueba al azar. */
const tokenAlAzar = () => generarTokenOpaco(azarDelProceso);
/** Cada caso usa SU origen: el cupo es de memoria del proceso y los casos no se pisan. */
let ip = 0;
const origenNuevo = () => `198.51.100.${++ip}`;

/** Todo el texto que dibuja un árbol de elementos de React (sin renderizarlo: la página es un componente de servidor `async`). */
function textoDe(nodo: ReactNode): string {
  if (nodo === null || nodo === undefined || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join(" ");
  const hijos = (nodo as { props?: { children?: ReactNode } }).props?.children;
  return textoDe(hijos);
}

/** Un `GET /invitacion` con esa cookie (o sin ninguna), desde el origen que estén fijados los encabezados de prueba. */
async function pedirPagina(token: string | undefined): Promise<string> {
  __setCookieDeTest(nombreCookieInvitacion(process.env), token);
  return textoDe(await InvitacionPage());
}

beforeEach(() => {
  consultas.cuantas = 0;
  consultas.tokens.length = 0;
  __limpiarCookiesDeTest();
  __setHeadersDeTest({});
});

describe("GET /invitacion: cupo por origen antes de la base (I-2)", () => {
  it("EL ATAQUE: 100 pedidos con una cookie inventada desde la misma IP → solo los primeros llegan a la base; el resto vuelve con el mensaje del cupo, sin consultar", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    const pantallas: string[] = [];
    for (let i = 0; i < 100; i++) pantallas.push(await pedirPagina(tokenAlAzar()));

    expect(consultas.cuantas).toBe(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN);
    expect(pantallas.slice(0, MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN).some((p) => p.includes(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION))).toBe(false);
    expect(pantallas.slice(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN).every((p) => p.includes(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION))).toBe(true);
  });

  it("es el MISMO cupo que el de abrirInvitacion: lo que gastó el origen por la acción ya no le alcanza a la página", async () => {
    const origen = origenNuevo();
    __setHeadersDeTest({ "x-forwarded-for": origen });
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN; i++) origenSinCupoParaAbrirInvitacion(origen, Date.now());
    const pantalla = await pedirPagina(tokenAlAzar());
    expect(consultas.cuantas).toBe(0);
    expect(pantalla).toContain(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION);
  });

  it("el cupo es por origen: otra IP sigue pudiendo abrir su enlace", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN + 5; i++) await pedirPagina(tokenAlAzar());
    consultas.cuantas = 0;

    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    const pantalla = await pedirPagina(tokenAlAzar());
    expect(consultas.cuantas).toBe(1);
    expect(pantalla).not.toContain(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION);
  });

  it("sin cookie o con una de forma inválida no se consulta nada ni se gasta el cupo: el enlace bueno que viene después pasa", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    for (let i = 0; i < 200; i++) {
      await pedirPagina(undefined);
      await pedirPagina(`no-es-un-token-${i}`);
    }
    expect(consultas.cuantas).toBe(0);
    await pedirPagina(tokenAlAzar());
    expect(consultas.cuantas).toBe(1);
    expect(consultas.tokens).toHaveLength(1);
  });

  it("sin cabecera (desarrollo local, E2E) no hay origen que contar: no se limita", async () => {
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN * 2; i++) await pedirPagina(tokenAlAzar());
    expect(consultas.cuantas).toBe(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN * 2);
  });

  it("sin cookie la pantalla sigue siendo la de siempre (pedir el token del fragmento), no el mensaje del cupo", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    const pantalla = await pedirPagina(undefined);
    expect(pantalla).toContain("Invitación");
    expect(pantalla).not.toContain(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION);
  });
});
