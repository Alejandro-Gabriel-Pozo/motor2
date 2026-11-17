import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { agruparAccionesPorModulo, GRUPO_OTRAS } from "../../src/core/permisos/agrupar-acciones-por-modulo";
import { esModuloDelCatalogo } from "../../src/core/modulos/catalogo";

/**
 * Oráculo del agrupado por módulo de las matrices de administración (Frente 6, paso 3). La tabla esperada sale del catálogo real de acciones (cada acción declara su módulo): si mañana
 * entra una acción o un módulo nuevo (Roles, Planes, Caja), tiene que caer sola en su grupo, ninguna se pierde y ninguna se repite.
 */
describe("agruparAccionesPorModulo", () => {
  const entradas = ACCIONES.map((a) => ({ clave: a.clave }));
  const grupos = agruparAccionesPorModulo(entradas);

  it("cada acción del catálogo cae en exactamente un grupo, el de su módulo", () => {
    const vistas = grupos.flatMap((g) => g.acciones.map((a) => a.clave));
    expect(vistas.length).toBe(ACCIONES.length);
    expect(new Set(vistas).size).toBe(ACCIONES.length);
    for (const a of ACCIONES) {
      const g = grupos.find((x) => x.acciones.some((y) => y.clave === a.clave));
      expect(g?.id, a.clave).toBe(a.modulo);
    }
  });

  it("no hay grupos repetidos ni vacíos, y todo grupo es un módulo del catálogo con nombre legible", () => {
    expect(new Set(grupos.map((g) => g.id)).size).toBe(grupos.length);
    for (const g of grupos) {
      expect(g.acciones.length, g.id).toBeGreaterThan(0);
      expect(esModuloDelCatalogo(g.id), g.id).toBe(true);
      expect(g.nombre.trim(), g.id).not.toBe("");
    }
  });

  it("conserva el orden de primera aparición y el orden de las acciones dentro de cada grupo", () => {
    const orden = [...new Set(ACCIONES.map((a) => a.modulo))];
    expect(grupos.map((g) => g.id)).toEqual(orden);
    for (const g of grupos) expect(g.acciones.map((a) => a.clave)).toEqual(ACCIONES.filter((a) => a.modulo === g.id).map((a) => a.clave));
  });

  it("una clave que no está en el catálogo va a «Otras» y no rompe nada", () => {
    const r = agruparAccionesPorModulo([{ clave: ACCIONES[0].clave }, { clave: "clave_que_no_existe" }]);
    expect(r.map((g) => g.id)).toEqual([ACCIONES[0].modulo, GRUPO_OTRAS]);
    expect(r[1]).toMatchObject({ nombre: "Otras", acciones: [{ clave: "clave_que_no_existe" }] });
  });

  it("sin acciones, sin grupos", () => {
    expect(agruparAccionesPorModulo([])).toEqual([]);
  });

  it("conserva el resto de los campos de cada acción (la descripción de «Permisos»)", () => {
    const r = agruparAccionesPorModulo([{ clave: ACCIONES[0].clave, descripcion: "x" }]);
    expect(r[0].acciones[0]).toEqual({ clave: ACCIONES[0].clave, descripcion: "x" });
  });
});
