import { describe, expect, it } from "vitest";
import { mensajeSiNoPuedeDarRolA, type PersonaIdentificada } from "../../src/core/permisos/gestion-de-usuarios";

/**
 * O35-D (O.35; `docs/plan-hito-3-pureza.md` §1 y §9): la regla de «uno mismo», con la redacción aprobada: «nunca por encima del rango propio en el contexto, salvo
 * el gerente». Vive dentro de `mensajeSiNoPuedeDarRolA` (contrato C2), que es por donde se da un rol a una persona (alta y cambio de rol de usuarios, aceptar una
 * invitación). La prueba de propiedades (`dar-rol-a.propiedades.test.ts`) dice que, fuera de este caso, nada cambió; acá van los casos con nombre.
 *
 * Por las acciones hoy no se llega a «uno mismo por encima»: darse un rol en una sucursal exige `gestion_usuarios` ahí (piso administrador de sistema: ya es
 * administrador en esa sucursal). Los flujos que SÍ existen siguen permitidos: un administrador se da (o se deja) el rol admin, se baja a operador (caso (b) de
 * `caracterizacion-supuestos-rbac`), y se nombra primer admin de una sucursal nueva (caso (a); va por la variante sin techo de gestión, ver su docstring).
 */
const MENSAJE_UNO_MISMO = "No podés darte a vos mismo un rol por encima del que tenés en esta sucursal: pedíselo a un administrador o al gerente de la empresa.";
const MENSAJE_TECHO_DE_ADMIN = "Solo un administrador o el gerente de la empresa puede dar el rol de administrador o modificar a un administrador.";

const ADMIN = { clave: "admin" };
const OPERADOR = { clave: "operador" };
const PERSONALIZADO = { clave: null };

const persona = (usuarioId: string | null, nivel: "operario" | "administrador" | "gerente"): PersonaIdentificada => ({
  usuarioId,
  rolEmpresa: nivel === "gerente" ? "gerente" : null,
  esAdminEnElContexto: nivel !== "operario",
});

describe("O35-D: nadie se da a sí mismo un rol por encima de su rango en el contexto, salvo el gerente", () => {
  it("un operario que se da el rol admin a sí mismo: rechazo con el mensaje de «uno mismo» (antes, el del techo del rol)", () => {
    expect(mensajeSiNoPuedeDarRolA(persona("u1", "operario"), ADMIN, persona("u1", "operario"))).toBe(MENSAJE_UNO_MISMO);
  });

  it("el mismo operario dándole el rol admin a OTRA persona sigue chocando con el techo del rol (no es «uno mismo»)", () => {
    expect(mensajeSiNoPuedeDarRolA(persona("u1", "operario"), ADMIN, persona("u2", "operario"))).toBe(MENSAJE_TECHO_DE_ADMIN);
  });

  it("dentro del propio rango, uno mismo sí: el operario se deja un rol de operario o uno personalizado", () => {
    expect(mensajeSiNoPuedeDarRolA(persona("u1", "operario"), OPERADOR, persona("u1", "operario"))).toBeNull();
    expect(mensajeSiNoPuedeDarRolA(persona("u1", "operario"), PERSONALIZADO, persona("u1", "operario"))).toBeNull();
  });

  it("un administrador se da (o se deja) el rol admin y se baja a operador a sí mismo", () => {
    expect(mensajeSiNoPuedeDarRolA(persona("u1", "administrador"), ADMIN, persona("u1", "administrador"))).toBeNull();
    expect(mensajeSiNoPuedeDarRolA(persona("u1", "administrador"), OPERADOR, persona("u1", "administrador"))).toBeNull();
  });

  it("el gerente, salvo explícito: se da cualquier rol a sí mismo", () => {
    for (const r of [ADMIN, OPERADOR, PERSONALIZADO]) {
      expect(mensajeSiNoPuedeDarRolA(persona("u1", "gerente"), r, persona("u1", "gerente"))).toBeNull();
    }
  });

  it("sin cuenta todavía (`usuarioId` null en los dos) no es «uno mismo»", () => {
    expect(mensajeSiNoPuedeDarRolA(persona(null, "operario"), ADMIN, persona(null, "operario"))).toBe(MENSAJE_TECHO_DE_ADMIN);
  });
});
