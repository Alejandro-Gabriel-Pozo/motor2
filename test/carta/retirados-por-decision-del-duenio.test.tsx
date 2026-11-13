import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { MantenimientoDeCarta } from "../../src/app/(app)/carta/mantenimiento-de-carta";

/**
 * PRUEBAS DE AUSENCIA de lo que se PODÓ de la carta y las promociones (pedido del dueño, 2026-10-28: «cada poda deja una prueba de ausencia»). Si alguien vuelve a mostrar uno de estos, este test queda
 * en rojo y la lista de abajo dice por qué se retiró: volver a tenerlo es una decisión del dueño, con su diseño (docs/diseno-modulo-carta-2026-10-28.md).
 *
 * RETIRADOS POR DECISIÓN DEL DUEÑO:
 *  1. (YA NO RETIRADO) «Sumar un lugar» en los cupos de una promo: se apagó el 2026-10-28 y el dueño lo VOLVIÓ A PRENDER el 2026-11-11 (pedido del «Menú ejecutivo» con «el mozo elige»); su prueba
 *     ahora es `test/carta/sumar-lugar-interruptor.test.tsx` (los dos estados). La numeración de abajo se conserva.
 *  2. El bloque «Vigencia» de una promo (Desde, Hasta, «Días en que vale») — 2026-10-20 (aplicado el 2026-10-28): «la promoción NO tiene vigencia desde/hasta, ni días: se maneja con ACTIVAR/DESACTIVAR».
 *     BORRADO del código el 2026-11-13 (poda de promos, tiempo 1, `docs/diseno-poda-promos-2026-11-12.md`: «OK, poda antes»): ya no hay pantalla, acción, filtro del POS ni constante. Las columnas de la base se borran
 *     en el tiempo 2 (migración con aviso expreso del dueño).
 *  4. El plato del día / menú del día («Plato del día» como lugar de una promo, su pantalla `/movimientos/menu-del-dia`, sus tres acciones, el interruptor `MENU_DEL_DIA_VISIBLE` y el código
 *     `MENU_DEL_DIA_SIN_CARGAR`) — pedido del dueño, confirmado el 2026-11-13 junto con la poda («OK, poda antes (Recomendada)», `docs/diseno-poda-promos-2026-11-12.md` §8). BORRADO del código el
 *     2026-11-13 (poda de promos, tiempo 1). La tabla `EntradaDelDiaDeCupo`, el tipo de cupo `DEL_DIA` en `TIPOS_DE_CUPO` y su CHECK, y el permiso `promo_menu_del_dia` se conservan hasta el tiempo 2
 *     (migración con aviso expreso del dueño); un lugar `DEL_DIA` ya guardado hace que su promo no se ofrezca (falla cerrado).
 *  3. El ajuste MASIVO de precios de la carta («Precios» de Carta › Hoy: por sección o en toda la empresa) — decidido el 2026-10-20 («borrarlo si no se extrañaba»), BORRADO el 2026-10-28: apagado solo
 *     escondía la pantalla y el servidor seguía aceptando `ajustarPreciosDeLaCarta` y `ajustarPreciosDeLaEmpresa`. Los precios se cambian en Catálogo y en Promociones.
 */

describe("2. La vigencia de una promo no existe en el código (borrada el 2026-11-13)", () => {
  const archivosDe = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const ruta = join(dir, n);
      return statSync(ruta).isDirectory() ? archivosDe(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
    });
  const RAIZ = join(__dirname, "../../src");

  it("ningún archivo de src/ nombra la vigencia ni sus columnas, salvo el comentario de auditoría (las filas históricas de la auditoría conservan esos nombres de campo)", () => {
    const permitido = join(RAIZ, "core/permisos/auditoria.ts");
    const quienes = archivosDe(RAIZ).filter((ruta) => ruta !== permitido && /vigenteDesde|vigenteHasta|diasDeSemana|promoVigenteEl|VIGENCIA_DE_PROMO_VISIBLE|guardarVigenciaPromoCarta|BloqueDeVigencia/.test(readFileSync(ruta, "utf8")));
    expect(quienes).toEqual([]);
  });

  it("no existe el archivo de la vigencia ni la acción para guardarla", () => {
    expect(archivosDe(RAIZ).filter((ruta) => /vigencia-de-promo|guardar-vigencia-promo-carta/.test(ruta))).toEqual([]);
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

describe("4. El plato del día no existe en el código (borrado el 2026-11-13)", () => {
  const archivosDe = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const ruta = join(dir, n);
      return statSync(ruta).isDirectory() ? archivosDe(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
    });
  const RAIZ = join(__dirname, "../../src");

  it("ningún archivo de src/ nombra sus acciones, su interruptor, su ruta ni su código de rechazo", () => {
    const quienes = archivosDe(RAIZ).filter((ruta) =>
      /MENU_DEL_DIA_VISIBLE|MENU_DEL_DIA_SIN_CARGAR|lugarDelDiaApagado|validarFechaDeMenuDelDia|DIAS_DE_ANTICIPACION_DEL_MENU|agregarPlatoDelDia|quitarPlatoDelDia|copiarMenuDelDiaAnterior|validarPlatoDelDiaEnTx|crearPlatoDelDia|fijarActivaDePlatoDelDia|entradaDelDiaDeCupo|cargarMenuDelDia|MenuDelDiaDeLaSucursal|movimientos\/menu-del-dia/.test(readFileSync(ruta, "utf8"))
    );
    expect(quienes).toEqual([]);
  });

  it("el tipo de lugar DEL_DIA solo aparece como literal en la lista de tipos de la base (`TIPOS_DE_CUPO`, hasta el tiempo 2)", () => {
    const quienes = archivosDe(RAIZ).filter((ruta) => /["'`]DEL_DIA["'`]/.test(readFileSync(ruta, "utf8")));
    expect(quienes.map((r) => r.slice(RAIZ.length + 1))).toEqual(["core/carta/cupos-de-promo.ts"]);
  });

  it("no existe ninguna pantalla, caso de uso ni consulta del menú del día", () => {
    expect(archivosDe(RAIZ).filter((ruta) => /menu-del-dia|plato-del-dia/.test(ruta))).toEqual([]);
  });
});
