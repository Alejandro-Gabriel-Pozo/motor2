import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { BloqueDeVigencia, CamposLugares } from "../../src/app/(app)/carta/parametrizacion/formularios";
import { MantenimientoDeCarta } from "../../src/app/(app)/carta/mantenimiento-de-carta";

/**
 * PRUEBAS DE AUSENCIA de lo que se PODÓ de la carta y las promociones (pedido del dueño, 2026-10-28: «cada poda deja una prueba de ausencia»). Si alguien vuelve a mostrar uno de estos, este test queda
 * en rojo y la lista de abajo dice por qué se retiró: volver a tenerlo es una decisión del dueño, con su diseño (docs/diseno-modulo-carta-2026-10-28.md).
 *
 * RETIRADOS POR DECISIÓN DEL DUEÑO:
 *  1. «Sumar un lugar» (tipo + nombre + mín./máx.) en los cupos de una promo — 2026-10-28: «es algo obsoleto: es más fácil agregar la sección del otro lado y tildarla»; en producción 0 lugares de lista y
 *     0 del día. Oculto con `SUMAR_LUGAR_DE_LISTA_VISIBLE` (reversible; el servidor no cambió).
 *  2. El bloque «Vigencia» de una promo (Desde, Hasta, «Días en que vale») — 2026-10-20 (aplicado el 2026-10-28): «la promoción NO tiene vigencia desde/hasta, ni días: se maneja con ACTIVAR/DESACTIVAR».
 *     Oculto con `VIGENCIA_DE_PROMO_VISIBLE` (reversible; columnas y filtro del POS intactos hasta una migración autorizada).
 *  3. El ajuste MASIVO de precios de la carta («Precios» de Carta › Hoy: por sección o en toda la empresa) — decidido el 2026-10-20 («borrarlo si no se extrañaba»), BORRADO el 2026-10-28: apagado solo
 *     escondía la pantalla y el servidor seguía aceptando `ajustarPreciosDeLaCarta` y `ajustarPreciosDeLaEmpresa`. Los precios se cambian en Catálogo y en Promociones.
 */

describe("1. «Sumar un lugar» no aparece en los cupos de una promo (retirado el 2026-10-28)", () => {
  it("sin lugares, el formulario de cupos no tiene ni la fila ni sus campos", () => {
    const html = renderToStaticMarkup(<CamposLugares lugares={[]} />);
    expect(html).not.toContain("Sumar un lugar");
    for (const campo of ["nuevo_lugar_tipo", "nuevo_lugar_nombre", "nuevo_lugar_min", "nuevo_lugar_max"]) expect(html, campo).not.toContain(`name="${campo}"`);
  });
});

describe("2. El bloque «Vigencia» no aparece en una promo (retirado el 2026-10-20, aplicado el 2026-10-28)", () => {
  it("una promo sin vigencia no muestra el título, las fechas, los días ni «Guardar vigencia»", () => {
    const html = renderToStaticMarkup(
      <BloqueDeVigencia vigencia={{ version: 1, vigenteDesde: null, vigenteHasta: null, diasDeSemana: null }} puedeEditar>
        <form>
          <input name="vigenteDesde" />
          <input name="vigenteHasta" />
          <fieldset>Días en que vale</fieldset>
          <button>Guardar vigencia</button>
        </form>
      </BloqueDeVigencia>
    );
    expect(html).toBe("");
  });
});

describe("3. El ajuste masivo de precios de la carta no existe (borrado el 2026-10-28)", () => {
  it("Carta › Hoy no ofrece el nivel «Precios» ni sus botones", () => {
    const html = renderToStaticMarkup(
      <MantenimientoDeCarta
        pestanaInicial="hoy"
        secciones={[{ id: "s1", nombre: "Platos", activa: true, productos: [{ id: "p1", nombre: "Milanesa", precio: "$ 18.500", disponible: true, visible: true }] }]}
        ocultosSinSeccion={[]}
        fueraDeCarta={[]}
        puede={{ hoy: true, contenido: true, secciones: true }}
        acciones={{
          fijarHoy: async () => ({ ok: true, mensaje: "" }),
          visibleProducto: async () => ({ ok: true, mensaje: "" }),
          activaSeccion: async () => ({ ok: true, mensaje: "" }),
          agregar: async () => ({ ok: true, mensaje: "" }),
          quitar: async () => ({ ok: true, mensaje: "" }),
        }}
      />
    );
    expect(html).toContain(">Hoy</button>");
    expect(html).toContain(">Visibilidad</button>");
    expect(html).not.toContain(">Precios</button>");
    expect(html).not.toContain("Ajustar sección");
    expect(html).not.toContain("data-hoja-de-precios");
  });

  it("ninguna Server Action exporta las acciones del ajuste (ni su aviso de sucursales)", () => {
    const raiz = join(__dirname, "../../src/server/actions");
    const archivos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const ruta = join(dir, n);
        return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
      });
    const exportadas = archivos(raiz).flatMap((ruta) => [...readFileSync(ruta, "utf8").matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]));
    expect(exportadas.length).toBeGreaterThan(100);
    for (const nombre of ["ajustarPreciosDeLaCarta", "ajustarPreciosDeLaEmpresa", "avisoDePrecioDeEmpresa"]) expect(exportadas, nombre).not.toContain(nombre);
  });
});
