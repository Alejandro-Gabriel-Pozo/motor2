import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESTADOS_DE_RECEPCION } from "@/core/compras/public";
import type { EntradaDeConfirmacionDeRecepcion } from "@/core/compras/public";
import { moduloDelCatalogo } from "@/core/modulos/catalogo";
import { ACCIONES } from "@/core/permisos/acciones";
import { nivelDe } from "@/core/permisos/jerarquia";
import { dimensionesDeRecepcion, tablaDeRecepcion } from "../setup/oraculo-compras-recepcion";

/**
 * GUARDIÁN de dimensiones nuevas de la recepción separada de compras (regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md` declara las dimensiones y, para cada
 * entrada de la regla pura de confirmar la recepción, la dimensión a la que responde o «no afecta» con su motivo. Falla si:
 *  (a) la regla de confirmar tiene una entrada que el oráculo no declara (el tipo `EntradaDeConfirmacionDeRecepcion` obliga a sumarla acá: `tsc` se pone rojo), o el oráculo declara una que ya no existe, o una entrada «afecta» a una dimensión
 *      que el oráculo no define, o «no afecta» sin motivo;
 *  (b) los estados de recepción del código (y el CHECK de la base) no son exactamente los valores declarados de la dimensión E (menos ANULADA, que sale de la factura);
 *  (c) los niveles de persona que existen no son los valores declarados de la dimensión O;
 *  (d) el módulo `recepcion_de_compras` o la acción `compra_recibir` dejaron de ser lo que el oráculo da por cierto (módulo vendible que requiere Compras; acción del módulo, de sucursal y de piso administrador).
 */
const DIMENSIONES = dimensionesDeRecepcion();
const RAIZ = join(__dirname, "../..");

/** Todas las entradas de la regla, como objeto: agregar una al tipo sin sumarla acá no compila. */
const ENTRADAS: Record<keyof EntradaDeConfirmacionDeRecepcion, true> = {
  esDeLaSucursalDelActor: true,
  facturaAnulada: true,
  estadoDeLaParte: true,
  seccion: true,
  diaFactura: true,
  diaStock: true,
  hoy: true,
};

describe("guardián: la recepción separada de compras declara todas sus dimensiones en el oráculo", () => {
  const declaradas = tablaDeRecepcion("Entradas de la regla de confirmar y su efecto").filas.map((f) => ({ entrada: (f["Entrada"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("(a) cada entrada de la regla está declarada (y ninguna declarada sobra)", () => {
    expect(declaradas.map((d) => d.entrada).sort()).toEqual(Object.keys(ENTRADAS).sort());
  });

  it("(a) cada declaración es una dimensión definida o «no afecta» con motivo", () => {
    for (const { entrada, efecto } of declaradas) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${entrada}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${entrada}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("(b) los estados de recepción del código y del CHECK de la base son los valores declarados de la dimensión E (menos ANULADA)", () => {
    expect([...ESTADOS_DE_RECEPCION].sort()).toEqual((DIMENSIONES["E"] ?? []).filter((v) => v !== "ANULADA").sort());
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20261016101500_factura_proveedor_recepcion/migration.sql"), "utf8");
    const check = /estado_recepcion_chk" CHECK \("estadoRecepcion" IN \(([^)]*)\)\)/.exec(migracion);
    expect(check, "el CHECK de estadoRecepcion existe en la migración").not.toBeNull();
    expect([...check![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...ESTADOS_DE_RECEPCION].sort());
  });

  it("(c) los niveles de persona que existen son los valores declarados de la dimensión O", () => {
    const niveles = new Set([nivelDe({ rolEmpresa: null, esAdminEnElContexto: false }), nivelDe({ rolEmpresa: null, esAdminEnElContexto: true }), nivelDe({ rolEmpresa: "gerente", esAdminEnElContexto: false }), nivelDe({ rolEmpresa: "gerente", esAdminEnElContexto: true })]);
    const declarados = (DIMENSIONES["O"] ?? []).map((v) => (v === "OPERADOR" ? "operario" : v.toLowerCase()));
    expect([...niveles].sort()).toEqual(declarados.sort());
  });

  it("(d) el módulo y la acción son lo que el oráculo da por cierto", () => {
    expect(DIMENSIONES["M"]).toEqual(["APAGADO", "ENCENDIDO"]);
    expect(moduloDelCatalogo("recepcion_de_compras")).toMatchObject({ tipo: "vendible", estado: "disponible", requiere: ["compras"] });
    const accion = ACCIONES.find((a) => a.clave === "compra_recibir");
    expect(accion).toMatchObject({ modulo: "recepcion_de_compras", contexto: "sucursal", nivelMinimo: "administrador" });
  });

  it("control de sanidad: el lector ve las entradas y las dimensiones declaradas", () => {
    expect(declaradas.length).toBe(7);
    expect(Object.keys(DIMENSIONES).sort()).toEqual(["E", "F", "M", "O", "P", "R", "S"]);
  });
});
