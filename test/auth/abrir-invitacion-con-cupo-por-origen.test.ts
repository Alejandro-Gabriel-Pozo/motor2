import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-27 (T11 del endurecimiento; GT-8): `abrirInvitacion` es una puerta ANÓNIMA que consulta la base compartida (la invitación por su hash y su empresa) con cada token de forma
 * válida, y no tenía freno: un script sin cuenta podía mandar miles por minuto desde una sola conexión. Ahora corta el bucle de un origen ANTES de la consulta. La consulta
 * (`invitacionDelToken`) se reemplaza por un contador: «no consulta» es exactamente «no llegó a la base». Sin base: el cupo es de memoria.
 */
vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
const consultas = vi.hoisted(() => ({ cuantas: 0 }));
vi.mock("../../src/server/sesion/invitacion", () => ({
  invitacionDelToken: vi.fn(async () => {
    consultas.cuantas++;
    return null;
  }),
}));

import { __setHeadersDeTest } from "../setup/next-headers-stub";
import { abrirInvitacion } from "../../src/server/actions/auth/invitacion";
import {
  MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN,
  MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION,
  VENTANA_DE_APERTURAS_DE_INVITACION_MS,
  origenDelPedido,
  origenSinCupoParaAbrirInvitacion,
} from "../../src/server/actions/limitador-anonimo";
import { MENSAJE_ENLACE_NO_VALIDO } from "../../src/core/features/empresa/aceptar-invitacion";
import { ORIGEN_DESCONOCIDO } from "../../src/core/seguridad/origen-del-pedido";
import { generarTokenOpaco } from "../../src/core/seguridad/tokens";
import { azarDelProceso } from "../../src/lib/azar";

/** Un token de forma válida (43 caracteres base64url) que no corresponde a ninguna invitación: lo que mandaría un script que prueba al azar. */
const tokenAlAzar = () => generarTokenOpaco(azarDelProceso);
/** Cada caso usa SU origen: el cupo es de memoria del proceso y los casos no se pisan. */
let ip = 0;
const origenNuevo = () => `203.0.113.${++ip}`;

beforeEach(() => {
  consultas.cuantas = 0;
  __setHeadersDeTest({});
});

describe("abrirInvitacion: cupo por origen (S-27)", () => {
  it("EL ATAQUE: 100 tokens al azar desde la misma IP → solo los primeros llegan a la base; el resto vuelve con el mensaje del cupo, sin consultar", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    const respuestas = [];
    for (let i = 0; i < 100; i++) respuestas.push(await abrirInvitacion(tokenAlAzar()));

    expect(consultas.cuantas).toBe(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN);
    expect(respuestas.slice(0, MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN).every((r) => r.mensaje === MENSAJE_ENLACE_NO_VALIDO)).toBe(true);
    expect(respuestas.slice(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN).every((r) => !r.ok && r.mensaje === MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION)).toBe(true);
  });

  it("el cupo es por origen: otra IP sigue pudiendo abrir su enlace", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN + 5; i++) await abrirInvitacion(tokenAlAzar());
    consultas.cuantas = 0;

    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    const r = await abrirInvitacion(tokenAlAzar());
    expect(r.mensaje).toBe(MENSAJE_ENLACE_NO_VALIDO);
    expect(consultas.cuantas).toBe(1);
  });

  it("la IP es la primera de x-forwarded-for (la que fija Vercel); lo que sigue es la cadena de proxies y no cambia el origen", async () => {
    const cliente = origenNuevo();
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN; i++) {
      __setHeadersDeTest({ "x-forwarded-for": `${cliente}, 10.0.0.${i}` });
      await abrirInvitacion(tokenAlAzar());
    }
    consultas.cuantas = 0;
    __setHeadersDeTest({ "x-forwarded-for": `${cliente}, 10.9.9.9` });
    expect((await abrirInvitacion(tokenAlAzar())).mensaje).toBe(MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION);
    expect(consultas.cuantas).toBe(0);
  });

  it("un token mal formado no gasta el cupo ni toca la base: el enlace bueno que viene después pasa", async () => {
    __setHeadersDeTest({ "x-forwarded-for": origenNuevo() });
    for (let i = 0; i < 200; i++) expect((await abrirInvitacion(`no-es-un-token-${i}`)).mensaje).toBe(MENSAJE_ENLACE_NO_VALIDO);
    expect(consultas.cuantas).toBe(0);
    expect((await abrirInvitacion(tokenAlAzar())).mensaje).toBe(MENSAJE_ENLACE_NO_VALIDO);
    expect(consultas.cuantas).toBe(1);
  });

  // M-18 (T16; CAMBIA COMPORTAMIENTO donde antes no había cupo): sin x-forwarded-for el pedido ya no queda sin freno, cuenta en un balde común «desconocido» con el mismo cupo.
  it("EL ATAQUE (M-18): sin cabecera x-forwarded-for tampoco hay bucle libre: los pedidos sin origen comparten UN cupo y, pasado el tope, vuelven con el mensaje del cupo sin consultar", async () => {
    const respuestas = [];
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN * 2; i++) respuestas.push(await abrirInvitacion(tokenAlAzar()));
    expect(consultas.cuantas).toBe(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN);
    expect(respuestas.slice(MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN).every((r) => r.mensaje === MENSAJE_DEMASIADAS_APERTURAS_DE_INVITACION)).toBe(true);
  });

  it("una cabecera vacía o con la coma suelta cuenta igual que la ausente (mismo balde)", async () => {
    __setHeadersDeTest({ "x-forwarded-for": " , 10.0.0.1" });
    expect(origenDelPedido(new Headers({ "x-forwarded-for": " , 10.0.0.1" }))).toBe(ORIGEN_DESCONOCIDO);
    expect(origenSinCupoParaAbrirInvitacion(null, 5)).toBe(origenSinCupoParaAbrirInvitacion(ORIGEN_DESCONOCIDO, 5));
  });
});

describe("limitador de aperturas: la ventana", () => {
  it("al cumplirse la ventana el origen vuelve a tener cupo; justo en el tope todavía no", () => {
    const origen = origenNuevo();
    const t0 = 1_000_000;
    for (let i = 0; i < MAXIMO_DE_APERTURAS_DE_INVITACION_POR_ORIGEN; i++) expect(origenSinCupoParaAbrirInvitacion(origen, t0 + i)).toBe(false);
    expect(origenSinCupoParaAbrirInvitacion(origen, t0 + 100)).toBe(true);
    expect(origenSinCupoParaAbrirInvitacion(origen, t0 + VENTANA_DE_APERTURAS_DE_INVITACION_MS + 1)).toBe(false);
  });

  it("origenDelPedido: el primer valor, recortado; sin cabecera o vacía, el balde común de los desconocidos (M-18), nunca null", () => {
    expect(origenDelPedido(new Headers({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" }))).toBe("198.51.100.7");
    expect(origenDelPedido(new Headers())).toBe(ORIGEN_DESCONOCIDO);
    expect(origenDelPedido(new Headers({ "x-forwarded-for": " , 10.0.0.1" }))).toBe(ORIGEN_DESCONOCIDO);
  });
});
