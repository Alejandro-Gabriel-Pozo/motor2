import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest } from "../setup/test-db";
import { getUsuarioActual } from "../../src/core/auth/session";
import { irAlLogin } from "../../src/core/auth/ir-al-login";
import { ENCABEZADO_RUTA_PEDIDA } from "../../src/core/navegacion/volver";
import { conPermiso } from "../../src/server/actions/con-permiso";
import { ok } from "../../src/server/actions/tipos";
// El alias de vitest.config.ts reemplaza `next/headers` por este stub; se importa directo para simular encabezados.
import { __setHeadersDeTest } from "../setup/next-headers-stub";

/**
 * Al vencer la sesión, `irAlLogin` manda a `/login` recordando la pantalla en la que estaba (el Referer), para volver a ella al
 * entrar. El destino viene de un encabezado, así que solo se acepta una ruta interna de este mismo host.
 * `redirect()` de Next lanza un error con `digest: "NEXT_REDIRECT;<tipo>;<url>;<código>;"`.
 */
async function destinoDelRedirect(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion();
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    const partes = digest.split(";");
    if (partes[0] === "NEXT_REDIRECT") return partes[2];
  }
  throw new Error("no hubo redirect");
}

describe("irAlLogin", () => {
  beforeEach(() => {
    __setHeadersDeTest({});
  });
  afterEach(() => {
    __setHeadersDeTest({});
  });

  it("con un Referer de este mismo sitio, manda a /login?volver=<esa pantalla, con su consulta>", async () => {
    __setHeadersDeTest({ host: "motor2-demo.vercel.app", referer: "https://motor2-demo.vercel.app/catalogo/proveedores?editar=abc" });
    expect(await destinoDelRedirect(irAlLogin)).toBe("/login?volver=%2Fcatalogo%2Fproveedores%3Feditar%3Dabc");
  });

  it("detrás de un proxy, compara contra x-forwarded-host", async () => {
    __setHeadersDeTest({ host: "interno:3000", "x-forwarded-host": "motor2-demo.vercel.app", referer: "https://motor2-demo.vercel.app/stock/minimo" });
    expect(await destinoDelRedirect(irAlLogin)).toBe("/login?volver=%2Fstock%2Fminimo");
  });

  it("con la ruta pedida (la pone src/proxy.ts en los pedidos sin cookie de sesión), vuelve a ella aunque no haya Referer: una carga directa", async () => {
    __setHeadersDeTest({ host: "motor2-demo.vercel.app", [ENCABEZADO_RUTA_PEDIDA]: "/reportes/costos?desde=2026-09-01" });
    expect(await destinoDelRedirect(irAlLogin)).toBe("/login?volver=%2Freportes%2Fcostos%3Fdesde%3D2026-09-01");
  });

  it("la ruta pedida manda sobre el Referer (con un enlace, el Referer es la pantalla de origen y no la que se quería abrir)", async () => {
    __setHeadersDeTest({
      host: "motor2-demo.vercel.app",
      referer: "https://motor2-demo.vercel.app/reportes",
      [ENCABEZADO_RUTA_PEDIDA]: "/catalogo/proveedores",
    });
    expect(await destinoDelRedirect(irAlLogin)).toBe("/login?volver=%2Fcatalogo%2Fproveedores");
  });

  it.each(["https://sitio-falso.example.com", "//sitio-falso.example.com", "/login", "/api/auth/signout", "/р", "javascript:alert(1)"])(
    "una ruta pedida que no es una ruta interna segura (%s) se descarta y se usa el Referer o, si no hay, el login a secas",
    async (hostil) => {
      __setHeadersDeTest({ host: "motor2-demo.vercel.app", [ENCABEZADO_RUTA_PEDIDA]: hostil });
      expect(await destinoDelRedirect(irAlLogin)).toBe("/login");
      __setHeadersDeTest({ host: "motor2-demo.vercel.app", [ENCABEZADO_RUTA_PEDIDA]: hostil, referer: "https://motor2-demo.vercel.app/stock/minimo" });
      expect(await destinoDelRedirect(irAlLogin)).toBe("/login?volver=%2Fstock%2Fminimo");
    }
  );

  it.each([
    ["sin Referer (una carga directa)", {}],
    ["un Referer de otro sitio", { host: "motor2-demo.vercel.app", referer: "https://accounts.google.com/reportes/costos" }],
    ["un Referer que es la raíz", { host: "motor2-demo.vercel.app", referer: "https://motor2-demo.vercel.app/" }],
    ["un Referer que ya es el login", { host: "motor2-demo.vercel.app", referer: "https://motor2-demo.vercel.app/login?volver=%2Freportes" }],
  ])("%s: va a /login a secas", async (_motivo, encabezados) => {
    __setHeadersDeTest(encabezados);
    expect(await destinoDelRedirect(irAlLogin)).toBe("/login");
  });
});

describe("conPermiso sin sesión recuerda la pantalla", () => {
  beforeEach(async () => {
    await limpiarBaseDeTest();
    vi.mocked(getUsuarioActual).mockResolvedValue(null);
  });
  afterEach(() => {
    __setHeadersDeTest({});
  });

  it("una escritura sin sesión manda a /login?volver=<la pantalla desde la que se envió el formulario>", async () => {
    __setHeadersDeTest({ host: "motor2-demo.vercel.app", referer: "https://motor2-demo.vercel.app/movimientos/conteo-fisico?seccionId=s1" });
    const fn = vi.fn(async () => ok("no debería llegar acá"));

    expect(await destinoDelRedirect(() => conPermiso("proceso_control", fn))).toBe("/login?volver=%2Fmovimientos%2Fconteo-fisico%3FseccionId%3Ds1");
    expect(fn).not.toHaveBeenCalled();
  });
});
