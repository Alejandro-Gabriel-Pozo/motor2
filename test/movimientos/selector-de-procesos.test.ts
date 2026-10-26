import { describe, expect, it } from "vitest";
import { PROCESOS_DEL_SELECTOR, PROCESOS_DIRECTOS, PROCESOS_UI, type ProcesoDelSelector } from "../../src/core/movimientos/ui-config";
import { ACCION_POR_PROCESO } from "../../src/core/movimientos/transiciones";
import { GRUPOS_NAV } from "../../src/core/navegacion/estructura";

/**
 * Fase 7 (módulo Movimientos, decisión DEC-25), P3: la fuente de lo que ofrece el selector «Registrar movimiento» y de lo que tiene acceso directo. Todavía no la consume ninguna pantalla ni el menú:
 * este guardián la fija para que la entrada del menú (`algunaDe`) y su página salgan de la MISMA lista y ningún proceso se pierda ni quede en dos lugares.
 */

/** Los procesos que tienen su propia ruta y no pasan por el panel genérico `/movimientos/[proceso]`. */
const PROCESOS_CON_RUTA_PROPIA = ["venta", "conteo-fisico"] as const;
/** Reclasificar es una pantalla de Stock (`/stock/reclasificar`): está en el selector pero no es un proceso del panel genérico. */
const RECLASIFICAR = "reclasificar";

const slugDe = (p: ProcesoDelSelector) => p.href.split("/").pop() as string;

/** Dónde está cada slug: la lista de lugares en los que aparece (tiene que ser exactamente uno). */
function lugaresDe(slug: string, directos: readonly string[], selector: readonly ProcesoDelSelector[], propios: readonly string[]): string[] {
  return [directos.includes(slug) ? "directos" : null, selector.some((p) => slugDe(p) === slug) ? "selector" : null, propios.includes(slug) ? "aparte" : null].filter((l): l is string => l !== null);
}

/** Todo slug conocido (los de PROCESOS_UI, venta, conteo-fisico y reclasificar) que NO está en exactamente un lugar, con dónde está. */
function slugsMalUbicados(directos: readonly string[], selector: readonly ProcesoDelSelector[], propios: readonly string[]): string[] {
  const todos = [...Object.keys(PROCESOS_UI), ...PROCESOS_CON_RUTA_PROPIA, RECLASIFICAR];
  return todos.filter((slug) => lugaresDe(slug, directos, selector, propios).length !== 1).map((slug) => `${slug}: ${lugaresDe(slug, directos, selector, propios).join(" + ") || "(ninguno)"}`);
}

/** De los ítems con `algunaDe` cuya ruta es `entrada`, los que NO llevan exactamente las claves del selector. */
function entradasConOtrasClaves(items: readonly { href: string; algunaDe?: readonly string[] }[], entrada: string, selector: readonly ProcesoDelSelector[]): string[] {
  const esperadas = [...new Set(selector.map((p) => p.accion))].sort();
  return items
    .filter((i) => i.href === entrada && i.algunaDe)
    .filter((i) => JSON.stringify([...(i.algunaDe ?? [])].sort()) !== JSON.stringify(esperadas))
    .map((i) => `${i.href}: [${(i.algunaDe ?? []).join(", ")}]`);
}

describe("PROCESOS_DIRECTOS y PROCESOS_DEL_SELECTOR", () => {
  it("los directos son Merma y Compra, y siguen siendo procesos del panel genérico", () => {
    expect([...PROCESOS_DIRECTOS].sort()).toEqual(["compra", "merma"]);
    for (const slug of PROCESOS_DIRECTOS) expect(PROCESOS_UI[slug], slug).toBeDefined();
  });

  it("el selector ofrece los 7 procesos restantes más Reclasificar, con la etiqueta corta, la ruta y la acción acordadas (en este orden)", () => {
    expect(PROCESOS_DEL_SELECTOR).toEqual([
      { href: "/movimientos/produccion", etiquetaCorta: "Producción", accion: "proceso_produccion" },
      { href: "/movimientos/consumo", etiquetaCorta: "Consumo", accion: "proceso_consumo" },
      { href: "/movimientos/ajuste", etiquetaCorta: "Ajuste", accion: "proceso_ajuste" },
      { href: "/movimientos/transferencia", etiquetaCorta: "Traslado entre depósitos", accion: "proceso_transferencia" },
      { href: "/movimientos/devolucion-consignacion", etiquetaCorta: "Devolución al consignante", accion: "proceso_devolucion_consignacion" },
      { href: "/movimientos/devolucion-cliente", etiquetaCorta: "Devolución de cliente", accion: "proceso_devolucion_cliente" },
      { href: "/movimientos/devolucion-proveedor", etiquetaCorta: "Devolución a proveedor", accion: "proceso_devolucion_proveedor" },
      { href: "/stock/reclasificar", etiquetaCorta: "Reclasificar", accion: "stock_reclasificar" },
    ]);
  });

  it("todo slug de PROCESOS_UI, más venta, conteo-fisico y reclasificar, está en EXACTAMENTE un lugar (directos, selector o aparte)", () => {
    expect(slugsMalUbicados(PROCESOS_DIRECTOS, PROCESOS_DEL_SELECTOR, PROCESOS_CON_RUTA_PROPIA)).toEqual([]);
    // Y el selector no trae nada que no sea uno de esos slugs.
    const conocidos = new Set([...Object.keys(PROCESOS_UI), ...PROCESOS_CON_RUTA_PROPIA, RECLASIFICAR]);
    expect(PROCESOS_DEL_SELECTOR.map(slugDe).filter((s) => !conocidos.has(s))).toEqual([]);
  });

  it("cada acción del selector es la de ACCION_POR_PROCESO de su proceso, o stock_reclasificar; ninguna se repite", () => {
    const deProcesos = new Set(Object.values(ACCION_POR_PROCESO));
    for (const p of PROCESOS_DEL_SELECTOR) {
      if (slugDe(p) === RECLASIFICAR) expect(p.accion).toBe("stock_reclasificar");
      else {
        expect(deProcesos.has(p.accion), `${p.href}: ${p.accion} no está en ACCION_POR_PROCESO`).toBe(true);
        expect(p.accion, p.href).toBe(ACCION_POR_PROCESO[PROCESOS_UI[slugDe(p)].proceso]);
      }
    }
    expect(new Set(PROCESOS_DEL_SELECTOR.map((p) => p.accion)).size).toBe(PROCESOS_DEL_SELECTOR.length);
  });

  it("cada ruta es la del panel genérico de su proceso (o la de Reclasificar) y cada etiqueta corta es un texto no vacío distinto", () => {
    for (const p of PROCESOS_DEL_SELECTOR) {
      expect(p.href).toBe(slugDe(p) === RECLASIFICAR ? "/stock/reclasificar" : `/movimientos/${slugDe(p)}`);
      expect(p.etiquetaCorta.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(PROCESOS_DEL_SELECTOR.map((p) => p.etiquetaCorta)).size).toBe(PROCESOS_DEL_SELECTOR.length);
  });

  it("las claves de `algunaDe` de la entrada «/movimientos» (cuando exista en el menú) son exactamente las del selector", () => {
    expect(entradasConOtrasClaves(GRUPOS_NAV.flatMap((g) => g.items), "/movimientos", PROCESOS_DEL_SELECTOR)).toEqual([]);
  });
});

describe("los guardianes de la lista agarran los desvíos (sobre datos sintéticos)", () => {
  it("un proceso en directos y en el selector a la vez, o en ninguno, o sin Reclasificar", () => {
    expect(slugsMalUbicados([...PROCESOS_DIRECTOS, "ajuste"], PROCESOS_DEL_SELECTOR, PROCESOS_CON_RUTA_PROPIA)).toEqual(["ajuste: directos + selector"]);
    expect(slugsMalUbicados(PROCESOS_DIRECTOS, PROCESOS_DEL_SELECTOR.filter((p) => slugDe(p) !== "consumo"), PROCESOS_CON_RUTA_PROPIA)).toEqual(["consumo: (ninguno)"]);
    expect(slugsMalUbicados(PROCESOS_DIRECTOS, PROCESOS_DEL_SELECTOR.filter((p) => slugDe(p) !== RECLASIFICAR), PROCESOS_CON_RUTA_PROPIA)).toEqual(["reclasificar: (ninguno)"]);
    expect(slugsMalUbicados(PROCESOS_DIRECTOS, PROCESOS_DEL_SELECTOR, ["venta"])).toEqual(["conteo-fisico: (ninguno)"]);
  });

  it("una entrada `algunaDe` con una clave de más, de menos o cambiada", () => {
    const claves = PROCESOS_DEL_SELECTOR.map((p) => p.accion);
    expect(entradasConOtrasClaves([{ href: "/movimientos", algunaDe: claves }], "/movimientos", PROCESOS_DEL_SELECTOR)).toEqual([]);
    expect(entradasConOtrasClaves([{ href: "/movimientos", algunaDe: [...claves, "proceso_venta"] }], "/movimientos", PROCESOS_DEL_SELECTOR)).toHaveLength(1);
    expect(entradasConOtrasClaves([{ href: "/movimientos", algunaDe: claves.slice(1) }], "/movimientos", PROCESOS_DEL_SELECTOR)).toHaveLength(1);
    expect(entradasConOtrasClaves([{ href: "/movimientos", algunaDe: claves.map((c) => (c === "stock_reclasificar" ? "ver_stock" : c)) }], "/movimientos", PROCESOS_DEL_SELECTOR)).toHaveLength(1);
    // Un ítem de otra ruta, o sin `algunaDe`, no se mira.
    expect(entradasConOtrasClaves([{ href: "/otra", algunaDe: ["ver_stock"] }, { href: "/movimientos" }], "/movimientos", PROCESOS_DEL_SELECTOR)).toEqual([]);
  });
});
