import { describe, expect, it } from "vitest";
import { ACCIONES } from "@/core/permisos/acciones";
import { ORACULO_DE_PERMISOS } from "../textos/oraculo-de-permisos";
import { revisarDescripcionesDePermisos } from "./guardas/permisos-descripciones";

/**
 * Guardián de las descripciones de los permisos (F1' del catálogo de textos; reglas P1 a P3 en `guardas/permisos-descripciones.ts`). El primer bloque mira `ACCIONES` real; el segundo ejerce cada regla
 * con una violación inyectada sobre un juego chico: pasa de verde a rojo con SU violación y vuelve a verde al revertirla. El texto NO se movió al catálogo de textos: ver el encabezado de la guarda.
 */
describe("descripciones de los permisos: la lista real", () => {
  it("cumple P1 a P3 (con descripción, sin repetir y exactamente las aprobadas)", () => {
    const problemas = revisarDescripcionesDePermisos(ACCIONES, ORACULO_DE_PERMISOS);
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("no pasa en vacío: hay permisos y el oráculo tiene tantas filas como permisos", () => {
    expect(ACCIONES.length).toBeGreaterThan(100);
    expect(Object.keys(ORACULO_DE_PERMISOS).length).toBe(ACCIONES.length);
  });
});

describe("descripciones de los permisos: cada regla con su violación inyectada", () => {
  const base = [
    { clave: "uno", descripcion: "Hacer uno" },
    { clave: "dos", descripcion: "Hacer dos" },
  ];
  const oraculo = { uno: "Hacer uno", dos: "Hacer dos" };
  const dicen = (acciones: readonly { clave: string; descripcion: string }[], o: Record<string, string> = oraculo) => revisarDescripcionesDePermisos(acciones, o).join("\n");

  it("control: el juego de juguete está limpio", () => {
    expect(revisarDescripcionesDePermisos(base, oraculo)).toEqual([]);
  });

  it("P1: sin descripción, con espacios al borde o dobles", () => {
    expect(dicen([base[0]!, { clave: "dos", descripcion: " " }], { ...oraculo, dos: " " })).toContain("P1");
    expect(dicen([base[0]!, { clave: "dos", descripcion: " Hacer dos" }], { ...oraculo, dos: " Hacer dos" })).toContain("P1");
    expect(dicen([base[0]!, { clave: "dos", descripcion: "Hacer  dos" }], { ...oraculo, dos: "Hacer  dos" })).toContain("P1");
  });

  it("P2: dos permisos con el mismo texto", () => {
    expect(dicen([base[0]!, { clave: "dos", descripcion: "Hacer uno" }], { uno: "Hacer uno", dos: "Hacer uno" })).toContain("P2");
  });

  it("P3: descripción cambiada, permiso nuevo sin fila y fila de un permiso que ya no existe", () => {
    expect(dicen([base[0]!, { clave: "dos", descripcion: "Hacer dos y tres" }])).toContain("la descripción cambió");
    expect(dicen([...base, { clave: "tres", descripcion: "Hacer tres" }])).toContain("permiso nuevo");
    expect(dicen([base[0]!])).toContain("ya no existe como permiso");
  });
});
