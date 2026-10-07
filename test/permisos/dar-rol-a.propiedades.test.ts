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
 * Los generadores cubren los valores reales (gerente, sin rol de empresa; clave «admin», «operador», nula) y cualquier otro texto: un rol de empresa o una clave
 * desconocidos no pueden cambiar la equivalencia.
 */
const RUNS = { numRuns: 1000 };

const rolEmpresa = fc.oneof(fc.constantFrom<string | null>("gerente", null, "usuario", "Gerente", ""), fc.string());
const persona = fc.record({ rolEmpresa, esAdminEnElContexto: fc.boolean() });
const rol = fc.record({ clave: fc.oneof(fc.constantFrom<string | null>("admin", "operador", null, "Admin", "administrador"), fc.string()) });

describe("dar un rol (C2): equivalente a la composición vieja", () => {
  it("mensajeSiNoPuedeDarRolA = mensajeSiNoPuedeAsignarRol ?? mensajeSiNoPuedeGestionar, para todo actor, rol y persona", () => {
    fc.assert(
      fc.property(persona, rol, persona, (actor, r, objetivo) => {
        expect(mensajeSiNoPuedeDarRolA(actor, r, objetivo)).toBe(mensajeSiNoPuedeAsignarRol(actor, r) ?? mensajeSiNoPuedeGestionar(actor, objetivo));
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
    const operario = { rolEmpresa: null, esAdminEnElContexto: false };
    const gerente = { rolEmpresa: "gerente", esAdminEnElContexto: false };
    const admin = { clave: "admin" };
    expect(mensajeSiNoPuedeAsignarRol(operario, admin)).not.toBeNull();
    expect(mensajeSiNoPuedeGestionar(operario, gerente)).not.toBeNull();
    expect(mensajeSiNoPuedeDarRolA(operario, admin, gerente)).toBe(mensajeSiNoPuedeAsignarRol(operario, admin));
    expect(mensajeSiNoPuedeDarRolA(operario, admin, gerente)).not.toBe(mensajeSiNoPuedeGestionar(operario, gerente));
    expect(mensajeSiNoPuedeDarRolA(gerente, admin, gerente)).toBeNull();
  });
});
