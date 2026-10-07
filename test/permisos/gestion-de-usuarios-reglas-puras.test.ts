import { describe, expect, it } from "vitest";
import { personaEnSucursal, reactivaLaMembresiaDeUnAdmin } from "../../src/core/permisos/gestion-de-usuarios";

/**
 * Las dos reglas PURAS que quedaron en `core/permisos/gestion-de-usuarios.ts` cuando sus lecturas salieron a `server/lecturas/permisos/gestion-de-usuarios.ts`
 * (Hito 3, Fase II, II.4 de `docs/plan-hito-3-pureza.md`). Eran la parte de regla de `objetivoEnSucursal` y de `reactivaAUnAdmin`; los tests de integración las
 * cubrían solo a medias: con la mutación «una membresía YA activa de un admin también "se reactiva"» (sin mirar `activo`) ningún test se ponía en rojo.
 */
describe("reglas puras del techo de privilegio (II.4)", () => {
  it("personaEnSucursal: administrador en el contexto si y solo si el rol de ESA membresía es el de administrador (por clave); sin membresía, operario", () => {
    expect(personaEnSucursal("gerente", { clave: "admin" })).toEqual({ rolEmpresa: "gerente", esAdminEnElContexto: true });
    expect(personaEnSucursal(null, { clave: "admin" })).toEqual({ rolEmpresa: null, esAdminEnElContexto: true });
    expect(personaEnSucursal(null, { clave: "operador" })).toEqual({ rolEmpresa: null, esAdminEnElContexto: false });
    expect(personaEnSucursal(null, { clave: null })).toEqual({ rolEmpresa: null, esAdminEnElContexto: false });
    expect(personaEnSucursal("gerente", null)).toEqual({ rolEmpresa: "gerente", esAdminEnElContexto: false });
  });

  it("reactivaLaMembresiaDeUnAdmin: solo una membresía APAGADA con el rol administrador", () => {
    expect(reactivaLaMembresiaDeUnAdmin({ activo: false, rol: { clave: "admin" } })).toBe(true);
    expect(reactivaLaMembresiaDeUnAdmin({ activo: true, rol: { clave: "admin" } })).toBe(false);
    expect(reactivaLaMembresiaDeUnAdmin({ activo: false, rol: { clave: "operador" } })).toBe(false);
    expect(reactivaLaMembresiaDeUnAdmin({ activo: false, rol: { clave: null } })).toBe(false);
    expect(reactivaLaMembresiaDeUnAdmin(null)).toBe(false);
    expect(reactivaLaMembresiaDeUnAdmin(undefined)).toBe(false);
  });
});
