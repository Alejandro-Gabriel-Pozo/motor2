import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (docs/plan-validacion-de-datos-2026-09-25.md): los circuitos ya MIGRADOS al módulo central de validación de
 * datos (`src/core/datos/`) no vuelven a validar ni a convertir datos de entrada "a mano". Si alguien vuelve a escribir un
 * `esNumeroFinito(x)` o un `validarLargoTexto(x, …)` en uno de estos archivos, o convierte con `Number(…)` lo que viene de un
 * CampoNumero, reaparecen las dos reglas distintas para el mismo dato (y los bugs de "texto basura → 0" que este plan cerró).
 *
 * Alcance: SOLO la lista `MIGRADOS`. Cada fase siguiente del plan agrega los archivos que migra. `movimientos.ts` queda afuera a
 * propósito: los 7 procesos que no pasan por la rama `aplicaFactorConversion` siguen usando `esNumeroFinito`.
 *
 * Qué se prohíbe, fuera de comentarios:
 *  - En todos: `esNumeroFinito(` y `validarLargoTexto(` → usar validarImporte / validarCantidad / validarNroFactura / validarNombreCatalogo.
 *  - En las pantallas (los que usan CampoNumero): `Number(` → usar `numeroDelCampo` (vacío → undefined, inválido → NaN, nunca 0).
 */
const RAIZ = join(__dirname, "../../src");

type Regla = "esNumeroFinito(" | "validarLargoTexto(" | "Number(";
const DEL_SERVIDOR: Regla[] = ["esNumeroFinito(", "validarLargoTexto("];
const DE_PANTALLA: Regla[] = [...DEL_SERVIDOR, "Number("];

const MIGRADOS: { archivo: string; prohibido: Regla[] }[] = [
  { archivo: "server/actions/movimientos/precio-local.ts", prohibido: DEL_SERVIDOR },
  // Hito 4, H4C-4: la validación y la escritura del precio local se mudaron al guard, a los casos de uso, al paso compartido y a la persistencia.
  { archivo: "core/features/movimientos/precio-local.guard.ts", prohibido: DEL_SERVIDOR },
  { archivo: "server/actions/movimientos/casos-de-uso/set-precio-local-producto.ts", prohibido: DEL_SERVIDOR },
  { archivo: "server/actions/movimientos/casos-de-uso/sincronizar-precio-local-grupo-carta.ts", prohibido: DEL_SERVIDOR },
  { archivo: "server/actions/movimientos/casos-de-uso/guardar-precio-local-en-tx.ts", prohibido: DEL_SERVIDOR },
  { archivo: "server/persistencia/movimientos/precio-local.ts", prohibido: DEL_SERVIDOR },
  { archivo: "core/compras/correccion.ts", prohibido: DEL_SERVIDOR },
  { archivo: "app/(app)/movimientos/precio-local/precio-local-form.tsx", prohibido: DE_PANTALLA },
  { archivo: "app/(app)/movimientos/[proceso]/panel-movimiento-form.tsx", prohibido: DE_PANTALLA },
];

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/** `Number(` como llamada (no `Number.NaN`, ni `numeroDelCampo(`, ni un identificador que termine en "Number("). */
function patron(regla: Regla): RegExp {
  const escapada = regla.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.$])${escapada}`);
}

/** Las líneas (1-based) que usan alguna de las reglas prohibidas fuera de un comentario, como "línea: regla". */
function usosProhibidos(fuente: string, prohibido: readonly Regla[]): string[] {
  const lineas = fuente.replace(/\r\n/g, "\n").split("\n");
  const malas: string[] = [];
  lineas.forEach((linea, i) => {
    if (esComentario(linea)) return;
    const sinComentarioFinal = linea.replace(/\/\/.*$/, "");
    for (const regla of prohibido) if (patron(regla).test(sinComentarioFinal)) malas.push(`${i + 1}: ${regla}`);
  });
  return malas;
}

describe("validación de datos: los circuitos migrados usan src/core/datos, no validaciones a mano", () => {
  it.each(MIGRADOS)("$archivo", ({ archivo, prohibido }) => {
    const problemas = usosProhibidos(readFileSync(join(RAIZ, archivo), "utf8"), prohibido);
    expect(
      problemas,
      `${archivo} volvió a validar o convertir a mano (usá validarImporte / validarCantidad / validarNroFactura / numeroDelCampo de src/core/datos):\n${problemas.join("\n")}`
    ).toEqual([]);
  });

  describe("el detector (con fuentes sintéticas)", () => {
    it("marca un esNumeroFinito y un validarLargoTexto", () => {
      const fuente = ["if (!esNumeroFinito(precio)) return error('x');", "const e = validarLargoTexto(nro, 'El número', 60);"].join("\n");
      expect(usosProhibidos(fuente, DEL_SERVIDOR)).toEqual(["1: esNumeroFinito(", "2: validarLargoTexto("]);
    });

    it("marca un Number( en una pantalla, también dentro de una expresión", () => {
      expect(usosProhibidos("await setPrecio(id, Number(precio), true);", DE_PANTALLA)).toEqual(["1: Number("]);
      expect(usosProhibidos("cantidad: Number(f.cantidad),", DE_PANTALLA)).toEqual(["1: Number("]);
    });

    it("no marca Number.NaN, numeroDelCampo( ni comentarios", () => {
      const fuente = [
        "const n = numeroDelCampo(precio) ?? Number.NaN;",
        "// antes: Number(precio) daba 0",
        " * esNumeroFinito(x) ya no se usa acá",
        "const x = validarImporte(v, op); // en vez de esNumeroFinito(v)",
      ].join("\n");
      expect(usosProhibidos(fuente, DE_PANTALLA)).toEqual([]);
    });

    it("en un archivo del servidor, Number( no está prohibido (convertir un Decimal de Prisma es legítimo)", () => {
      expect(usosProhibidos("valorNuevo: Number(existente.precio),", DEL_SERVIDOR)).toEqual([]);
    });
  });
});
