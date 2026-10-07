import { describe, expect, it } from "vitest";
import type { NivelDeAccion } from "../../src/core/permisos/acciones";
import { etiquetaDelPiso, nivelAlcanzaElPiso, nivelDelRolFrenteAlPiso } from "../../src/core/permisos/jerarquia";
import { nivelesDeLaCelda } from "../../src/core/permisos/matriz";

/**
 * ADR-027 (Hito 3, trabajo 3.4, F1 del RBAC): el piso «administrador de sistema» y la escalera de cuatro rangos de los pisos de una acción,
 * operario < administrador < administrador de sistema < gerente. Puro: sin base.
 *
 * Lo que este archivo fija:
 *  - la tabla 4×4 de `nivelAlcanzaElPiso` (quién llega a qué piso), escrita a mano y no derivada del código: invertir dos rangos la pone en rojo;
 *  - que el rango 2 («administrador», el futuro «encargado» de F3) NO alcanza el piso de gobierno: es la razón de ser del escalón nuevo (D16);
 *  - quién es administrador de sistema hoy: el rol de clave «admin», y nadie más (ningún rol tiene rango 2 hasta que exista `Rol.nivel`);
 *  - las etiquetas que muestran la matriz y el rechazo de `guardarPermisos`.
 */
const NIVELES: readonly NivelDeAccion[] = ["operario", "administrador", "administrador_sistema", "gerente"];

/** Fila = nivel de quien actúa; columna = piso de la acción (en el orden de `NIVELES`). Escrita a mano a propósito. */
const ALCANZA: Record<NivelDeAccion, readonly boolean[]> = {
  operario: [true, false, false, false],
  administrador: [true, true, false, false],
  administrador_sistema: [true, true, true, false],
  gerente: [true, true, true, true],
};

describe("los rangos de los pisos (ADR-027): operario < administrador < administrador de sistema < gerente", () => {
  it.each(NIVELES)("tabla 4×4: lo que alcanza el nivel «%s»", (nivel) => {
    expect(NIVELES.map((piso) => nivelAlcanzaElPiso(nivel, piso))).toEqual(ALCANZA[nivel]);
  });

  it("el rango 2 (administrador) NO alcanza el piso de gobierno, y el de gobierno no alcanza el de gerente", () => {
    expect(nivelAlcanzaElPiso("administrador", "administrador_sistema")).toBe(false);
    expect(nivelAlcanzaElPiso("administrador_sistema", "administrador")).toBe(true);
    expect(nivelAlcanzaElPiso("administrador_sistema", "gerente")).toBe(false);
  });

  it("frente al piso, el rol de clave «admin» es el administrador de sistema y cualquier otro es operario (nadie es de rango 2 hasta F3)", () => {
    expect(nivelDelRolFrenteAlPiso({ clave: "admin" })).toBe("administrador_sistema");
    expect(nivelDelRolFrenteAlPiso({ clave: "operador" })).toBe("operario");
    expect(nivelDelRolFrenteAlPiso({ clave: null })).toBe("operario");
    for (const clave of ["Admin", "administrador", "administrador_sistema", "gerente", "encargado"]) expect(nivelDelRolFrenteAlPiso({ clave }), clave).toBe("operario");
  });

  it("las etiquetas que ve la persona: «administrador de sistema» para el piso nuevo, el resto tal cual", () => {
    expect(NIVELES.map(etiquetaDelPiso)).toEqual(["operario", "administrador", "administrador de sistema", "gerente"]);
  });

  it("el mensaje de una celda fuera de nivel lleva las etiquetas, no los valores internos", () => {
    expect(nivelesDeLaCelda({ clave: "operador" }, "anular_venta")).toEqual({ piso: "administrador", delRol: "operario" });
    expect(nivelesDeLaCelda({ clave: "admin" }, "traspasar_gerencia")).toEqual({ piso: "gerente", delRol: "administrador de sistema" });
    expect(nivelesDeLaCelda({ clave: "admin" }, "no_existe")).toBeNull();
  });
});
