import { describe, expect, it } from "vitest";
import { ACCIONES, contextoDeAccion, nivelMinimoDeAccion, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { MATRIZ_ESPERADA } from "./matriz-esperada";

/**
 * Guardián de la matriz de fábrica: el contexto (empresa / sucursal), el nivel mínimo (operario / administrador / gerente) y los roles
 * que editan cada acción desde el arranque tienen que coincidir con `MATRIZ_ESPERADA`, que se escribe aparte a mano. Cambiar una acción
 * en el catálogo obliga a cambiarla también acá: el cambio queda en el diff de dos archivos y alguien lo mira.
 */

describe("matriz de fábrica: el catálogo coincide con lo esperado", () => {
  it("tiene exactamente las mismas claves", () => {
    const enCatalogo = ACCIONES.map((a) => a.clave).sort();
    const esperadas = Object.keys(MATRIZ_ESPERADA).sort();
    expect(enCatalogo).toEqual(esperadas);
  });

  it.each(ACCIONES.map((a) => [a.clave, a] as const))("%s: contexto, nivel mínimo y roles de fábrica", (clave, accion) => {
    const esperada = MATRIZ_ESPERADA[clave];
    expect({ contexto: accion.contexto, nivelMinimo: accion.nivelMinimo, roles: [...accion.rolesEditarSemilla] }).toEqual({
      contexto: esperada.contexto,
      nivelMinimo: esperada.nivelMinimo,
      roles: [...esperada.roles],
    });
  });

  it("`contextoDeAccion` y `nivelMinimoDeAccion` leen lo mismo que el catálogo", () => {
    for (const a of ACCIONES) {
      expect(contextoDeAccion(a.clave)).toBe(a.contexto);
      expect(nivelMinimoDeAccion(a.clave)).toBe(a.nivelMinimo);
    }
  });
});

describe("matriz de fábrica: ninguna acción arranca en manos de un nivel inferior a su piso", () => {
  it("si el operador edita una acción desde el arranque, su piso es «operario»", () => {
    const infractoras = ACCIONES.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes("operador") && a.nivelMinimo !== "operario").map((a) => a.clave);
    expect(infractoras, "El operador edita estas acciones de fábrica pero su piso es más alto: se abrirían a un nivel inferior").toEqual([]);
  });

  it("el administrador edita de fábrica todo lo que no es solo del gerente, y nada de lo que sí lo es", () => {
    for (const a of ACCIONES) {
      const adminEdita = (a.rolesEditarSemilla as readonly string[]).includes("admin");
      expect(adminEdita, a.clave).toBe((a.nivelMinimo as NivelDeAccion) !== "gerente");
    }
  });
});
