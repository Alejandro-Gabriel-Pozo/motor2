import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONDICIONES_DE_CONTROL, ESTADOS_DE_RECEPCION } from "@/core/compras/public";
import type { EntradaDeConfirmacionDeRecepcion, EntradaDeRegistroDeControl, EntradaDeRecepcion } from "@/core/compras/public";
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
 *  (d) el módulo `recepcion_de_compras` o la acción `compra_recibir` dejaron de ser lo que el oráculo da por cierto (módulo vendible que requiere Compras; acción del módulo, de sucursal y de piso administrador);
 *  (e) N3-b: lo mismo para el control por línea (entradas de `decidirRegistroDeControl`, de `validarControlDeLinea` y de las entradas de stock; la acción `compra_controlar_recepcion` del módulo, de sucursal, de piso operario y con semilla admin y
 *      operador; las condiciones del código y del CHECK de la base son los valores de la dimensión C menos FUERA_DE_LISTA; la dimensión K es la C más SIN_CONTROL).
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

/** Las entradas de la regla de registrar el control (la decisión de estado y la validación de una línea): agregar una al tipo sin sumarla acá no compila. */
const ENTRADAS_DEL_CONTROL: Record<keyof EntradaDeRegistroDeControl | "condicion" | "observacion" | "cantidadSegunRemito", true> = {
  esDeLaSucursalDelActor: true,
  facturaAnulada: true,
  estadoDeLaParte: true,
  condicion: true,
  observacion: true,
  cantidadSegunRemito: true,
};

/** Los campos de una entrada de stock y lo que recibe la regla (renglones): agregar uno al tipo sin sumarlo acá no compila. */
const ENTRADAS_DE_STOCK: Record<keyof EntradaDeRecepcion | "renglones" | "decimales", true> = { renglonId: true, seccionId: true, cantidad: true, renglones: true, decimales: true };

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
    expect(Object.keys(DIMENSIONES).sort()).toEqual(["B", "C", "E", "F", "K", "M", "N", "O", "P", "Q", "R", "S"]);
  });
});

describe("guardián N3-b: el control por línea y las entradas de stock declaran todas sus dimensiones en el oráculo", () => {
  const declaradasDelControl = tablaDeRecepcion("Entradas de la regla de registrar el control y su efecto").filas.map((f) => ({ entrada: (f["Entrada"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));
  const declaradasDeStock = tablaDeRecepcion("Entradas de la regla de las entradas de stock y su efecto").filas.map((f) => ({ entrada: (f["Entrada"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("(e) cada entrada de las reglas del control y de las entradas de stock está declarada (y ninguna declarada sobra)", () => {
    expect(declaradasDelControl.map((d) => d.entrada).sort()).toEqual(Object.keys(ENTRADAS_DEL_CONTROL).sort());
    expect(declaradasDeStock.map((d) => d.entrada).sort()).toEqual(Object.keys(ENTRADAS_DE_STOCK).sort());
  });

  it("(e) cada declaración es una dimensión definida o «no afecta» con motivo", () => {
    for (const { entrada, efecto } of [...declaradasDelControl, ...declaradasDeStock]) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${entrada}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${entrada}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("(e) las condiciones del código y del CHECK de la base son los valores de la dimensión C (menos FUERA_DE_LISTA); K es C más SIN_CONTROL", () => {
    expect([...CONDICIONES_DE_CONTROL].sort()).toEqual((DIMENSIONES["C"] ?? []).filter((v) => v !== "FUERA_DE_LISTA").sort());
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20261117120100_compras_control_de_linea_de_recepcion/migration.sql"), "utf8");
    const check = /ControlDeLineaDeRecepcion_condicion_chk" CHECK \("condicion" IN \(([^)]*)\)\)/.exec(migracion);
    expect(check, "el CHECK de condicion existe en la migración").not.toBeNull();
    expect([...check![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...CONDICIONES_DE_CONTROL].sort());
    expect((DIMENSIONES["K"] ?? []).sort()).toEqual(["SIN_CONTROL", ...CONDICIONES_DE_CONTROL].sort());
  });

  it("(e) la acción de controlar es del módulo, de la sucursal, de piso operario y con semilla admin y operador (lo que el oráculo da por cierto)", () => {
    expect(ACCIONES.find((a) => a.clave === "compra_controlar_recepcion")).toMatchObject({ modulo: "recepcion_de_compras", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] });
  });
});
