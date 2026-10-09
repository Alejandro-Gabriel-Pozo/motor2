import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  mensajeSiNoPuedeAsignarRol,
  mensajeSiNoPuedeDarRolA,
  mensajeSiNoPuedeDarRolSinTechoDeGestion,
  mensajeSiNoPuedeGestionar,
} from "../../src/core/permisos/gestion-de-usuarios";

/**
 * Contrato C2 del RBAC (O.35; Hito 3, Fase II, II.2 de `docs/plan-hito-3-pureza.md`): `mensajeSiNoPuedeDarRolA(actor, rol, objetivo)` reemplaza la composición
 * `mensajeSiNoPuedeAsignarRol(actor, rol) ?? mensajeSiNoPuedeGestionar(actor, objetivo)` que estaba copiada en el alta de usuario (sus dos ramas) y en la aceptación
 * de una invitación de usuario. SIN cambio de comportamiento: para TODO actor, rol y persona, el mensaje (o `null`) es el mismo que daba la composición vieja,
 * incluido cuál de los dos gana cuando fallan los dos. La variante del alta de sucursal (y de la invitación pendiente) es exactamente la primera mitad.
 *
 * O35-D (regla de «uno mismo»: nunca por encima del rango propio en el contexto, salvo el gerente) amplía la equivalencia: vale para todo actor, rol y persona
 * SALVO «uno mismo por encima de su rango» (mismo `usuarioId` en quien actúa y quien recibe, y el techo del rol lo rechaza), que ahora da su propio mensaje. Y en
 * ese caso la composición vieja también rechazaba: hoy la regla no convierte ningún «sí» en «no» (ni al revés), solo nombra el motivo.
 *
 * Los generadores cubren los valores reales (gerente, sin rol de empresa; clave «admin», «operador», nula) y cualquier otro texto: un rol de empresa o una clave
 * desconocidos no pueden cambiar la equivalencia. El `usuarioId` sale de un dominio chico (dos personas y «sin cuenta») para que «uno mismo» aparezca seguido.
 */
const RUNS = { numRuns: 1000 };
const MENSAJE_UNO_MISMO = "No podés darte a vos mismo un rol por encima del que tenés en esta sucursal: pedíselo a un administrador o al gerente de la empresa.";

const rolEmpresa = fc.oneof(fc.constantFrom<string | null>("gerente", null, "usuario", "Gerente", ""), fc.string());
const persona = fc.record({ usuarioId: fc.constantFrom<string | null>("u1", "u2", null), rolEmpresa, esAdminEnElContexto: fc.boolean() });
const rol = fc.record({ clave: fc.oneof(fc.constantFrom<string | null>("admin", "operador", null, "Admin", "administrador"), fc.string()) });

const unoMismo = (actor: { usuarioId: string | null }, objetivo: { usuarioId: string | null }) => actor.usuarioId !== null && actor.usuarioId === objetivo.usuarioId;

describe("dar un rol (C2 y O35-D): equivalente a la composición vieja salvo «uno mismo por encima de su rango»", () => {
  it("mensajeSiNoPuedeDarRolA = mensajeSiNoPuedeAsignarRol ?? mensajeSiNoPuedeGestionar, salvo uno mismo con el techo del rol en contra: ahí, el mensaje de «uno mismo»", () => {
    fc.assert(
      fc.property(persona, rol, persona, (actor, r, objetivo) => {
        const vieja = mensajeSiNoPuedeAsignarRol(actor, r) ?? mensajeSiNoPuedeGestionar(actor, objetivo);
        const porEncima = unoMismo(actor, objetivo) && mensajeSiNoPuedeAsignarRol(actor, r) !== null;
        expect(mensajeSiNoPuedeDarRolA(actor, r, objetivo)).toBe(porEncima ? MENSAJE_UNO_MISMO : vieja);
        // Hoy la regla nunca cambia la respuesta (acepta ⇔ aceptaba): solo el texto del rechazo.
        expect(mensajeSiNoPuedeDarRolA(actor, r, objetivo) === null).toBe(vieja === null);
      }),
      RUNS,
    );
  });

  it("la regla de «uno mismo» nunca frena al gerente ni a quien le da un rol a OTRA persona (o a alguien sin cuenta)", () => {
    fc.assert(
      fc.property(persona, rol, persona, (actor, r, objetivo) => {
        const resultado = mensajeSiNoPuedeDarRolA(actor, r, objetivo);
        if (!unoMismo(actor, objetivo) || actor.rolEmpresa === "gerente") expect(resultado).not.toBe(MENSAJE_UNO_MISMO);
      }),
      RUNS,
    );
  });

  it("la variante sin techo de gestión = la primera mitad (mensajeSiNoPuedeAsignarRol), para todo actor y rol", () => {
    fc.assert(
      fc.property(persona, rol, (actor, r) => {
        expect(mensajeSiNoPuedeDarRolSinTechoDeGestion(actor, r)).toBe(mensajeSiNoPuedeAsignarRol(actor, r));
      }),
      RUNS,
    );
  });

  it("los casos que distinguen el ORDEN: si fallan los dos techos, gana el del rol (no el de «solo el gerente toca al gerente»)", () => {
    const operario = { usuarioId: "u1", rolEmpresa: null, esAdminEnElContexto: false };
    const gerente = { usuarioId: "u2", rolEmpresa: "gerente", esAdminEnElContexto: false };
    const admin = { clave: "admin" };
    expect(mensajeSiNoPuedeAsignarRol(operario, admin)).not.toBeNull();
    expect(mensajeSiNoPuedeGestionar(operario, gerente)).not.toBeNull();
    expect(mensajeSiNoPuedeDarRolA(operario, admin, gerente)).toBe(mensajeSiNoPuedeAsignarRol(operario, admin));
    expect(mensajeSiNoPuedeDarRolA(operario, admin, gerente)).not.toBe(mensajeSiNoPuedeGestionar(operario, gerente));
    expect(mensajeSiNoPuedeDarRolA(gerente, admin, gerente)).toBeNull();
  });
});
