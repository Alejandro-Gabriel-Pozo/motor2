import { describe, expect, it } from "vitest";
import {
  CLAVE_ROL_ADMIN,
  CLAVE_ROL_OPERADOR,
  esRolAdmin,
  nivelDe,
  nivelDeRolPorClave,
  puedeAsignarRol,
  puedeGestionarA,
  type NivelDePersona,
  type PersonaParaJerarquia,
} from "../../src/core/permisos/jerarquia";

const PERSONAS: Record<NivelDePersona, PersonaParaJerarquia> = {
  gerente: { rolEmpresa: "gerente", esAdminEnElContexto: true },
  administrador: { rolEmpresa: null, esAdminEnElContexto: true },
  operario: { rolEmpresa: null, esAdminEnElContexto: false },
};
const NIVELES: NivelDePersona[] = ["operario", "administrador", "gerente"];

describe("esRolAdmin: el administrador es el rol con la clave «admin», no el que se llama «admin»", () => {
  it("la clave decide", () => {
    expect(esRolAdmin({ clave: CLAVE_ROL_ADMIN })).toBe(true);
    expect(esRolAdmin({ clave: CLAVE_ROL_OPERADOR })).toBe(false);
    expect(esRolAdmin({ clave: null })).toBe(false);
  });

  it("un rol que solo se llama «admin» (sin clave) no es administrador", () => {
    const creadoAMano = { nombre: "admin", clave: null };
    expect(esRolAdmin(creadoAMano)).toBe(false);
    expect(nivelDeRolPorClave(creadoAMano)).toBe("operario");
  });

  it("un rol con la clave «admin» sigue siendo administrador aunque se llame distinto", () => {
    expect(nivelDeRolPorClave({ clave: CLAVE_ROL_ADMIN })).toBe("administrador");
  });
});

describe("nivelDe: gerente por rolEmpresa, administrador por rol en el contexto, el resto operario", () => {
  it("las tres personas tipo", () => {
    expect(nivelDe(PERSONAS.gerente)).toBe("gerente");
    expect(nivelDe(PERSONAS.administrador)).toBe("administrador");
    expect(nivelDe(PERSONAS.operario)).toBe("operario");
  });

  it("el gerente lo es aunque en esta sucursal no tenga el rol admin", () => {
    expect(nivelDe({ rolEmpresa: "gerente", esAdminEnElContexto: false })).toBe("gerente");
  });
});

describe("puedeGestionarA: se gestiona a quien está en el mismo nivel o más abajo (3×3)", () => {
  const ESPERADO: Record<NivelDePersona, Record<NivelDePersona, boolean>> = {
    operario: { operario: true, administrador: false, gerente: false },
    administrador: { operario: true, administrador: true, gerente: false },
    gerente: { operario: true, administrador: true, gerente: true },
  };
  for (const actor of NIVELES) {
    for (const objetivo of NIVELES) {
      it(`${actor} → ${objetivo}: ${ESPERADO[actor][objetivo] ? "puede" : "no puede"}`, () => {
        expect(puedeGestionarA(PERSONAS[actor], PERSONAS[objetivo])).toBe(ESPERADO[actor][objetivo]);
      });
    }
  }
});

describe("puedeAsignarRol: dar el rol administrador es de un administrador o del gerente", () => {
  const ADMIN = { clave: CLAVE_ROL_ADMIN };
  const OPERADOR = { clave: CLAVE_ROL_OPERADOR };
  const PERSONALIZADO = { clave: null };

  it("el operario solo asigna roles de operario", () => {
    expect(puedeAsignarRol(PERSONAS.operario, OPERADOR)).toBe(true);
    expect(puedeAsignarRol(PERSONAS.operario, PERSONALIZADO)).toBe(true);
    expect(puedeAsignarRol(PERSONAS.operario, ADMIN)).toBe(false);
  });

  it("el administrador y el gerente asignan también el rol administrador", () => {
    for (const quien of ["administrador", "gerente"] as const) {
      expect(puedeAsignarRol(PERSONAS[quien], ADMIN)).toBe(true);
      expect(puedeAsignarRol(PERSONAS[quien], OPERADOR)).toBe(true);
    }
  });
});
