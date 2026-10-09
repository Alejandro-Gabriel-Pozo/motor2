import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, prismaAdmin, sembrarBase } from "../setup/test-db";
import { __cookiesDeTest, __limpiarCookiesDeTest } from "../setup/next-headers-stub";
import { PUERTAS_SIN_PERMISO } from "../arquitectura/guardas/puertas-sin-permiso";
import { aceptarMiInvitacion, aceptarMiInvitacionDeUsuario } from "../../src/server/actions/auth/invitacion";
import { cambiarEmpresaActiva } from "../../src/server/actions/auth/empresa-activa";
import { cambiarSucursalActiva } from "../../src/server/actions/auth/sucursal-activa";
import { detectarInsumosConUnidadMezclada } from "../../src/server/actions/catalogo/unidades";
import { decidirInicioDeSesion } from "../../src/server/sesion/acceso";
import { MENSAJE_ENLACE_NO_VALIDO } from "../../src/core/features/empresa/aceptar-invitacion";

/**
 * GT-10 (T8 del endurecimiento; S-17, S-18), la mitad CON BASE: cada puerta del inventario (`test/arquitectura/guardas/puertas-sin-permiso.ts`) que declara `NIEGA` ante un ANÓNIMO o ante un
 * usuario con sesión pero SIN EMPRESA se invoca así y no obtiene nada, no escribe nada y no deja cookie. El inventario estático (`puertas-sin-permiso-inventariadas.test.ts`) dice que la
 * lista es exacta; esto prueba que la postura declarada es verdad. Una puerta `NIEGA` sin control acá —o con control y declarada `PERMITIDO`— pone el test de cobertura en rojo.
 *
 * «Sin empresa» = una cuenta con sesión, sin ninguna membresía y sin invitación (en este sistema no existen: toda puerta que la deje pasar a algo es una brecha). Hay una empresa real con
 * una sucursal a la mano para que, si una puerta mirara «hacia afuera», encontrara algo.
 *
 * Mutaciones (cada una pone un control en rojo): quitar la verificación de pertenencia de `cambiarEmpresaActiva`; quitar el contexto de `cambiarSucursalActiva`; volver al gate de login una
 * vía que abra sesión a quien no tiene membresía ni invitación (p. ej. por el dominio del correo).
 */
type Control = () => Promise<void>;
type Controles = { anonimo?: Control; sinEmpresa?: Control };

let base: Awaited<ReturnType<typeof sembrarBase>>;

async function comoAnonimo() {
  const { getUsuarioActual } = await import("../../src/core/auth/session");
  vi.mocked(getUsuarioActual).mockResolvedValue(null);
}

/** Una cuenta con sesión que no es de ninguna empresa y no tiene invitación. */
async function comoSinEmpresa() {
  const { getUsuarioActual } = await import("../../src/core/auth/session");
  const u = await prismaAdmin.user.create({ data: { email: "sin-empresa@dominio-workspace.com" } });
  vi.mocked(getUsuarioActual).mockResolvedValue({ id: u.id, email: u.email, nombre: null });
  return u;
}

const sinCookies = () => expect(__cookiesDeTest().escritas.size, "no escribe ninguna cookie").toBe(0);
const unaCuentaDeGoogle = { providerAccountId: "google-sin-empresa", type: "oidc", id_token: "id-token-de-prueba" };

/** Controles por puerta: lo que pasa al invocarla como anónimo y como sin-empresa. Solo para las que declaran `NIEGA`. */
const CONTROLES: Record<string, Controles> = {
  "accion|auth/invitacion.ts|aceptarMiInvitacion": {
    anonimo: async () => {
      await comoAnonimo();
      const r = await aceptarMiInvitacion(new FormData());
      expect(r).toMatchObject({ ok: false });
      expect(r.mensaje).toMatch(/sesión venció/);
    },
  },
  "accion|auth/invitacion.ts|aceptarMiInvitacionDeUsuario": {
    anonimo: async () => {
      await comoAnonimo();
      const r = await aceptarMiInvitacionDeUsuario();
      expect(r).toMatchObject({ ok: false });
      expect(r.mensaje).toMatch(/sesión venció/);
    },
  },
  "accion|auth/empresa-activa.ts|cambiarEmpresaActiva": {
    anonimo: async () => {
      await comoAnonimo();
      await expect(cambiarEmpresaActiva(base.sucursal.empresaId)).resolves.toBeUndefined();
      sinCookies();
    },
    sinEmpresa: async () => {
      await comoSinEmpresa();
      // Una empresa real, activa y con sucursal: sin pertenencia no la elige (ni la cookie ni la redirección).
      await expect(cambiarEmpresaActiva(base.sucursal.empresaId)).resolves.toBeUndefined();
      sinCookies();
    },
  },
  "accion|auth/sucursal-activa.ts|cambiarSucursalActiva": {
    anonimo: async () => {
      await comoAnonimo();
      await expect(cambiarSucursalActiva(base.sucursal.id)).resolves.toBeUndefined();
      sinCookies();
    },
    sinEmpresa: async () => {
      await comoSinEmpresa();
      await expect(cambiarSucursalActiva(base.sucursal.id)).resolves.toBeUndefined();
      sinCookies();
    },
  },
  "accion|catalogo/unidades.ts|detectarInsumosConUnidadMezclada": {
    anonimo: async () => {
      await comoAnonimo();
      expect(await detectarInsumosConUnidadMezclada()).toMatchObject({ ok: false });
    },
    sinEmpresa: async () => {
      await comoSinEmpresa();
      expect(await detectarInsumosConUnidadMezclada()).toMatchObject({ ok: false });
    },
  },
  // El gate de `signIn`: sin membresía activa ni invitación pendiente no hay sesión, y no queda ningún `User` ni `Session` (el adapter de Auth.js ni se entera).
  "sesion|lib/auth.ts|signIn": {
    anonimo: async () => {
      // Sin cuenta de Google verificada (el perfil no la confirma, o no hay cuenta): rechazo.
      const base0 = { emailUsuario: "nadie@dominio-workspace.com", emailPerfil: "nadie@dominio-workspace.com", tokenDeSesionAbierta: undefined, tokenDeInvitacion: undefined };
      expect(await decidirInicioDeSesion({ ...base0, emailVerificado: false, cuenta: unaCuentaDeGoogle })).toBe(false);
      expect(await decidirInicioDeSesion({ ...base0, emailVerificado: true, cuenta: null })).toBe(false);
    },
    sinEmpresa: async () => {
      const email = "sin-empresa@dominio-workspace.com";
      const entrada = { emailUsuario: email, emailPerfil: email, emailVerificado: true, tokenDeSesionAbierta: undefined, tokenDeInvitacion: undefined, cuenta: unaCuentaDeGoogle };
      // Una cuenta de Google verificada, del dominio Workspace de la empresa, sin membresía ni invitación: no abre sesión (D5, S-17).
      expect(await decidirInicioDeSesion(entrada)).toBe(false);
      // Ni siquiera con un token de invitación que no corresponde a nadie.
      expect(await decidirInicioDeSesion({ ...entrada, tokenDeInvitacion: "A".repeat(43) })).toBe(false);
      expect(await prismaAdmin.user.count({ where: { email } })).toBe(0);
      expect(await prismaAdmin.session.count()).toBe(0);
    },
  },
};

/** Las puertas que declaran `NIEGA` y se controlan en OTRO test (con el motivo de por qué ese test las cubre). */
const CUBIERTAS_POR_OTRO_TEST: Record<string, string> = {
  "ruta|api/cron/*": "test/arquitectura/rutas-publicas-inventariadas.test.ts (todo cron rechaza el pedido sin el secreto, antes de usar la base) y test/core/secreto-cron.test.ts",
};

beforeEach(async () => {
  __limpiarCookiesDeTest();
  await limpiarBaseDeTest();
  base = await sembrarBase();
});

describe("GT-10: las puertas que declaran NIEGA niegan de verdad (anónimo y sin empresa)", () => {
  it("cobertura: toda postura NIEGA del inventario tiene su control (o está cubierta por otro test que existe), y ningún control es de una postura PERMITIDO", () => {
    const sinControl: string[] = [];
    const sobra: string[] = [];
    for (const [clave, p] of Object.entries(PUERTAS_SIN_PERMISO)) {
      for (const quien of ["anonimo", "sinEmpresa"] as const) {
        const tiene = Boolean(CONTROLES[clave]?.[quien]);
        if (p[quien] === "NIEGA" && !tiene && !(clave in CUBIERTAS_POR_OTRO_TEST)) sinControl.push(`${clave} (${quien})`);
        if (p[quien] === "PERMITIDO" && tiene) sobra.push(`${clave} (${quien})`);
      }
    }
    expect(sinControl, `Posturas NIEGA sin control con base:\n${sinControl.join("\n")}`).toEqual([]);
    expect(sobra, `Controles de una postura que el inventario declara PERMITIDO:\n${sobra.join("\n")}`).toEqual([]);
    expect(Object.keys(CONTROLES).filter((k) => !(k in PUERTAS_SIN_PERMISO)), "controles de puertas que ya no están en el inventario").toEqual([]);
  });

  it("las puertas cubiertas por otro test apuntan a archivos que existen", () => {
    for (const [clave, motivo] of Object.entries(CUBIERTAS_POR_OTRO_TEST)) {
      expect(clave in PUERTAS_SIN_PERMISO, `${clave} no está en el inventario`).toBe(true);
      for (const ruta of motivo.match(/test\/[\w./-]+\.test\.ts/g) ?? []) expect(existsSync(join(__dirname, "../..", ruta)), `${clave}: ${ruta} no existe`).toBe(true);
    }
  });

  for (const [clave, controles] of Object.entries(CONTROLES)) {
    for (const quien of ["anonimo", "sinEmpresa"] as const) {
      const control = controles[quien];
      if (!control) continue;
      it(`${clave}: ${quien === "anonimo" ? "un anónimo" : "una cuenta sin empresa"} no obtiene nada`, control);
    }
  }

  it("las puertas que dejan pasar a una cuenta sin empresa (PERMITIDO) no le dan nada sin el token: sin cookie de invitación no hay enlace que aceptar", async () => {
    await comoSinEmpresa();
    for (const aceptar of [() => aceptarMiInvitacion(new FormData()), () => aceptarMiInvitacionDeUsuario()]) {
      const r = await aceptar();
      expect(r).toMatchObject({ ok: false });
      expect(r.mensaje).toBe(MENSAJE_ENLACE_NO_VALIDO);
    }
    expect(await prismaAdmin.usuarioEmpresa.count({ where: { usuario: { email: "sin-empresa@dominio-workspace.com" } } })).toBe(0);
    expect(await prismaAdmin.usuarioSucursal.count({ where: { usuario: { email: "sin-empresa@dominio-workspace.com" } } })).toBe(0);
  });
});
