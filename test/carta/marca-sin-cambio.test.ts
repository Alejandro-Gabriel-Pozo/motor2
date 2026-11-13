import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolverEstiloCarta } from "@/core/carta/estilo";
import { resolverEstiloPortal } from "@/core/carta/portal";
import { PORTAL_REAL, TEMAS_REALES } from "./marca-sin-cambio-fixtures";

/**
 * PRUEBA «SIN CAMBIO» (opción A del diseño de la marca: «conservan hasta que se reediten», 2026-11-13): el estilo resuelto de las cinco cartas reales de hoy y del portal real, SIN el marcador `marca_derivada`, tiene que
 * ser EXACTAMENTE el de antes de que existiera la marca derivada. El archivo `.golden.json` se generó con el código de `main` SIN modo marca (`resolverEstiloCarta`/`resolverEstiloPortal`; regenerado sobre el PR-A de celular #265, cuya única diferencia declarada es `--carta-primary-texto` en violeta y oliva): si esta prueba
 * se pone roja, una carta publicada cambió de aspecto sin que nadie la reeditara.
 */
const GOLDEN: Record<string, unknown> = JSON.parse(readFileSync(join(__dirname, "marca-sin-cambio.golden.json"), "utf8"));
const comoJson = (valor: unknown) => JSON.parse(JSON.stringify(valor));
/** La ÚNICA diferencia permitida respecto del golden: la clave nueva `marca_derivada` en `valores` (vacía mientras nadie apriete el botón). */
function sinElMarcador(estilo: { valores: Record<string, string> }) {
  const copia = comoJson(estilo);
  expect(copia.valores.marca_derivada, "sin marcador, la clave nueva sale vacía").toBe("");
  delete copia.valores.marca_derivada;
  return copia;
}

describe("sin el marcador `marca_derivada`, ninguna carta publicada cambia", () => {
  it("el golden trae las cartas reales, el portal real y el estilo por defecto", () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(["amarillo", "celeste", "coral", "oliva", "portal", "portal sin config", "sin tema", "violeta"]);
  });

  it("sin tema (`{}`): igual que antes", () => {
    expect(sinElMarcador(resolverEstiloCarta({}))).toEqual(GOLDEN["sin tema"]);
  });

  it.each(Object.keys(TEMAS_REALES))("la carta real «%s»: igual que antes", (nombre) => {
    expect(sinElMarcador(resolverEstiloCarta(TEMAS_REALES[nombre]))).toEqual(GOLDEN[nombre]);
  });

  it("el portal real y el portal sin configurar: igual que antes", () => {
    expect(comoJson(resolverEstiloPortal(PORTAL_REAL))).toEqual(GOLDEN.portal);
    expect(comoJson(resolverEstiloPortal({}))).toEqual(GOLDEN["portal sin config"]);
  });

  it("un marcador que no es exactamente «si» (vacío, «no», «SI», «sí», espacios, basura) tampoco cambia nada", () => {
    for (const marcador of ["", "no", "SI", "Si", "sí", " ", " si ", "true", "1"]) {
      const con = comoJson(resolverEstiloCarta({ ...TEMAS_REALES.violeta, marca_derivada: marcador }));
      const sin = comoJson(resolverEstiloCarta(TEMAS_REALES.violeta));
      expect(con.colores, marcador).toEqual(sin.colores);
      expect(con.portada, marcador).toEqual(sin.portada);
      expect(con.tintaBase, marcador).toEqual(sin.tintaBase);
    }
  });
});
