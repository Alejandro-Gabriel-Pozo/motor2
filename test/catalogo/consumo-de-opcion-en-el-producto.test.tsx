import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsumosDelGrupo, type OpcionParaConsumo } from "../../src/components/catalogo/consumos-del-grupo";
import { EFECTOS_DE_CONSUMO_DE_OPCION, TIPOS_DE_GRUPO_DE_OPCIONES, vistaDeConsumoDeOpcion } from "../../src/core/opciones/public";
import { formatearCantidad } from "../../src/core/pos/public";
import {
  COLUMNAS_DE_CONSUMO_DE_OPCION,
  COLUMNAS_DE_VERSION_DE_OPCION,
  DIMENSIONES,
  FACTOR_DEL_TAMANO,
  NUNCA,
  esValida,
  esperado,
  type Combinacion,
} from "./consumo-de-opcion-en-el-producto.reglas";

/**
 * Qué consume cada opción en la pestaña Opciones del producto (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`). Sin base ni navegador: las reglas puras y el render de la sección de un grupo contra
 * la tabla escrita aparte (`….reglas.ts`). El guardado (versión esperada, idempotencia, concurrencia, aislamiento) lo prueba `consumo-de-opcion-en-el-producto-guardado.test.ts` con Postgres real.
 */
const POLLO = { efecto: "SUMA" as const, insumoNombre: "Pollo", reemplazaNombre: null, cantidad: 0.15, unidadNombre: "kg", mermaPorcentaje: 0, insumoProductoId: "mp-pollo", reemplazaAProductoId: null };

/** Lo que la pestaña le pasa a la sección de un grupo, para una combinación. El factor se carga en TODAS las opciones para que solo el tipo decida si se muestra. */
function opcionDe(c: Combinacion): OpcionParaConsumo {
  const consumos = c.opcion === "con-consumo" ? [{ ...POLLO, escalaConLaMedida: c.tipo !== "ADICIONAL" }] : [];
  return { opcionId: "o1", nombre: "Pollo", esNinguna: c.opcion === "ninguna", vigente: { numero: 3, diferencia: { tipo: "MONTO", monto: 0 }, factorEscala: FACTOR_DEL_TAMANO, consumos } };
}

function dibujar(c: Combinacion): string {
  return renderToStaticMarkup(
    <ConsumosDelGrupo
      grupo={{
        id: "g1",
        nombre: "Proteína Milanesa",
        tipo: c.tipo,
        productosQueLoUsan: c.compartido === "varios" ? [{ id: "p1", nombre: "Bife" }, { id: "p2", nombre: "Milanesa" }, { id: "p3", nombre: "Pechuga" }] : [{ id: "p2", nombre: "Milanesa" }],
      }}
      opciones={[opcionDe(c)]}
      insumos={[{ id: "mp-pollo", nombre: "Pollo", unidadNombre: "kg", decimales: 3 }]}
      puedeEditarOpciones={c.permiso === "con"}
      puedeVerOpciones={c.permiso === "con"}
      recetasActivas={c.recetas === "con"}
      guardar={async () => ({ ok: true, mensaje: "ok" })}
    />
  );
}

const COMBINACIONES: Combinacion[] = DIMENSIONES.tipo
  .flatMap((tipo) =>
    DIMENSIONES.compartido.flatMap((compartido) =>
      DIMENSIONES.opcion.flatMap((opcion) => DIMENSIONES.permiso.flatMap((permiso) => DIMENSIONES.recetas.map((recetas) => ({ tipo, compartido, opcion, permiso, recetas }) as Combinacion)))
    )
  )
  .filter(esValida);

describe("qué consume cada opción: todas las combinaciones contra la tabla de reglas", () => {
  it("son las 80 combinaciones válidas de las 5 dimensiones declaradas (96 en total, menos las 16 con una «ninguna» donde no existe)", () => {
    expect(COMBINACIONES).toHaveLength(80);
    expect(new Set(COMBINACIONES.map((c) => JSON.stringify(c))).size).toBe(80);
  });

  for (const c of COMBINACIONES) {
    it(`${c.tipo} · grupo de ${c.compartido === "uno" ? "un producto" : "varios productos"} · opción ${c.opcion} · permiso ${c.permiso} · Recetas ${c.recetas}`, () => {
      const html = dibujar(c);
      const { presentes, ausentes } = esperado(c);
      for (const texto of presentes) expect(html, `debe decir «${texto}»`).toContain(texto.replace(/&/g, "&amp;"));
      for (const texto of [...ausentes, ...NUNCA]) expect(html, `NO debe decir «${texto}»`).not.toContain(texto);
    });
  }

  it("la función pura dice lo mismo que lo dibujado: se ofrece editar solo con permiso, Recetas activo y una opción que no sea «ninguna»", () => {
    for (const c of COMBINACIONES) {
      const o = opcionDe(c);
      const vista = vistaDeConsumoDeOpcion({ tipo: c.tipo, esNinguna: o.esNinguna, consumos: o.vigente!.consumos, factorEscala: o.vigente!.factorEscala, puedeEditarOpciones: c.permiso === "con", recetasActivas: c.recetas === "con" }, formatearCantidad);
      expect(vista.puedeEditar, JSON.stringify(c)).toBe(c.opcion !== "ninguna" && c.recetas === "con" && c.permiso === "con");
      expect(vista.estado, JSON.stringify(c)).toBe(c.opcion === "ninguna" ? "NO_CONSUME" : c.opcion === "sin-consumo" ? "PENDIENTE" : "CARGADO");
    }
  });

  it("una línea que REEMPLAZA se lee «Reemplaza X por … de Y», con su merma; nunca inventa una unidad ni un insumo", () => {
    const o = { tipo: "VARIANTE" as const, esNinguna: false, factorEscala: null, puedeEditarOpciones: true, recetasActivas: true };
    const v = vistaDeConsumoDeOpcion({ ...o, consumos: [{ efecto: "REEMPLAZA", insumoNombre: "Bebida de almendras", reemplazaNombre: "Leche", cantidad: 0.2, unidadNombre: "l", mermaPorcentaje: 2, escalaConLaMedida: false }] }, formatearCantidad);
    expect(v.frases).toEqual(["Reemplaza Leche por 0,2 l de Bebida de almendras (merma 2 %)"]);
    const sinUnidad = vistaDeConsumoDeOpcion({ ...o, consumos: [{ efecto: "SUMA", insumoNombre: "Sal", reemplazaNombre: null, cantidad: 1, unidadNombre: "", mermaPorcentaje: 0, escalaConLaMedida: true }] }, formatearCantidad);
    expect(sinUnidad.frases).toEqual(["Descuenta 1 de Sal; escala con el tamaño"]);
  });

  it("dos productos y un solo grupo: con un producto no hay aviso; con dos o más, dice cuántos y cuáles", () => {
    const html = (n: number) =>
      renderToStaticMarkup(
        <ConsumosDelGrupo
          grupo={{ id: "g", nombre: "Guarniciones", tipo: "INCLUIDA", productosQueLoUsan: ["Bife", "Milanesa", "Pechuga"].slice(0, n).map((nombre, i) => ({ id: String(i), nombre })) }}
          opciones={[]}
          insumos={[]}
          puedeEditarOpciones
          puedeVerOpciones
          recetasActivas
          guardar={async () => ({ ok: true, mensaje: "ok" })}
        />
      );
    expect(html(1)).not.toContain("Este grupo lo usan");
    expect(html(2)).toContain("Este grupo lo usan 2 productos (Bife, Milanesa): cambiar el consumo de una opción los afecta a todos.");
    expect(html(3)).toContain("Este grupo lo usan 3 productos (Bife, Milanesa, Pechuga)");
    expect(html(1)).toContain("Este producto todavía no admite ninguna opción de este grupo.");
  });
});

describe("guardián de dimensiones: un tipo, un efecto o una columna nueva se declaran antes de que cambien lo que se ve", () => {
  it("los tipos de grupo de la tabla son los del sistema", () => expect([...DIMENSIONES.tipo].sort()).toEqual([...TIPOS_DE_GRUPO_DE_OPCIONES].sort()));
  it("los efectos de consumo son SUMA y REEMPLAZA (la frase de cada uno está probada arriba)", () => expect([...EFECTOS_DE_CONSUMO_DE_OPCION].sort()).toEqual(["REEMPLAZA", "SUMA"]));
  it("ConsumoDeOpcion", () => expect(Object.keys(Prisma.ConsumoDeOpcionScalarFieldEnum).sort()).toEqual(Object.keys(COLUMNAS_DE_CONSUMO_DE_OPCION).sort()));
  it("VersionDeOpcion", () => expect(Object.keys(Prisma.VersionDeOpcionScalarFieldEnum).sort()).toEqual(Object.keys(COLUMNAS_DE_VERSION_DE_OPCION).sort()));
});
