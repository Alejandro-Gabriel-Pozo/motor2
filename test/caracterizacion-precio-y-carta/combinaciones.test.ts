import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { combinacionesDesdeMostrar } from "../../src/core/pos/combinacion-elegida";
import { armarLineaConfigurada } from "../../src/core/pos/linea-configurada";
import { resumenDePrecios, resumenDePreciosConCombinaciones, vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";
import { ESCENARIOS_CON_COMBINACIONES, PRODUCTOS_CON_COMBINACIONES, type ProductoConCombinaciones } from "../setup/referencia-combinaciones";
import { n, textoDeCarta, textoDeResumen } from "./texto";

/**
 * CARACTERIZACIÓN de las COMBINACIONES (GO-3a: CU-07 y CU-11) en el precio cobrado y mostrado. Aparte de `precios.test.ts` a propósito: la Fase 3 retira GO-3a entero (DEC-02,
 * DEC-16) y borra este archivo y su golden SIN tocar el golden de los demás productos. Foto de hoy: la carta pública no ve las combinaciones (muestra el precio aditivo) mientras la
 * venta cobra el precio propio de la combinación. Regenerar a propósito: `REGENERAR_PRECIOS_PRECIO_Y_CARTA=1 npx vitest run test/caracterizacion-precio-y-carta/combinaciones.test.ts`.
 */
const ARCHIVO = join(__dirname, "combinaciones.golden.txt");

function textoDelProducto(p: ProductoConCombinaciones): string[] {
  const entrada = { grupos: p.grupos, precioBase: p.precioBase, descuentoDeProducto: p.descuentoDeProducto };
  const out = [`##### ${p.nombre} (base ${n(p.precioBase)}, descuento ${p.descuentoDeProducto ?? "-"})`];
  out.push("resumen del POS (con combinaciones):", ...textoDeResumen(resumenDePreciosConCombinaciones({ ...entrada, combinaciones: p.combinaciones })).map((l) => `  ${l}`));
  out.push("resumen de la carta pública (sin combinaciones):", ...textoDeResumen(resumenDePrecios(entrada)).map((l) => `  ${l}`));
  out.push(...textoDeCarta(resumenDePrecios(entrada)));
  return out;
}

function textoDelEscenario(i: number): string[] {
  const e = ESCENARIOS_CON_COMBINACIONES[i]!;
  const p = e.producto;
  const venta = armarLineaConfigurada({ grupos: p.grupos, elegidas: e.elegidas, precioBase: p.precioBase, descuentoDeProducto: p.descuentoDeProducto, cantidad: e.cantidad, combinaciones: combinacionesDesdeMostrar(p.combinaciones) });
  const vista = vistaPreviaDeConfiguracion({ grupos: p.grupos, elegidas: e.elegidas, precioBase: p.precioBase, descuentoDeProducto: p.descuentoDeProducto, cantidad: e.cantidad, combinaciones: p.combinaciones });
  const out = [`===== ${e.caso} · ${e.descripcion} · ${p.nombre} · cantidad ${e.cantidad}`];
  if (!venta.ok) out.push(`venta: RECHAZO ${venta.codigo}`);
  else if (venta.linea === null) out.push("venta: sin línea configurada (se pide como producto simple)");
  else {
    const l = venta.linea;
    out.push(`venta: precioUnitario=${n(l.precioUnitario)} precioCartaUnitario=${n(l.precioCartaUnitario)} huella=${l.huellaOpciones === null ? "-" : "sí"}`);
    for (const f of l.fotos) out.push(`  foto ${f.tipoGrupo} «${f.nombreGrupo}» ${f.nombreOpcion} x${f.cantidad} modo=${f.modoPrecio ?? "-"} dif=${f.tipoDeDiferencia ?? "-"}${f.porcentaje === null ? "" : `(${f.porcentaje}%)`} importe=${n(f.importeUnitario)} sucursal=${f.precioDeSucursal}`);
    if (l.combinacion) out.push(`  combinación: ${JSON.stringify(l.combinacion)}`);
  }
  if (!vista.ok) out.push(`vista previa: RECHAZO ${vista.codigo}`);
  else out.push(`vista previa: precioUnitario=${n(vista.precioUnitario)} precioLista=${n(vista.precioLista)} total=${n(vista.total)}`);
  const igual = venta.ok && venta.linea !== null && vista.ok ? venta.linea.precioUnitario === vista.precioUnitario : venta.ok === vista.ok;
  out.push(`paridad venta/vista previa: ${igual ? "coinciden" : "DIFIEREN"}`);
  return out;
}

function texto(): string {
  const bloques: string[] = ["# Caracterización de las combinaciones GO-3a en el precio cobrado y mostrado (Fase 0). Foto de hoy, no aprobación.", ""];
  for (const p of PRODUCTOS_CON_COMBINACIONES) bloques.push(...textoDelProducto(p), "");
  for (let i = 0; i < ESCENARIOS_CON_COMBINACIONES.length; i++) bloques.push(...textoDelEscenario(i), "");
  return `${bloques.join("\n")}\n`;
}

describe("Caracterización de las combinaciones GO-3a (Fase 0): funciones puras", () => {
  it("el catálogo cubre CU-07 y CU-11", () => {
    const casos = new Set(ESCENARIOS_CON_COMBINACIONES.map((e) => e.caso));
    expect(casos.has("CU-07")).toBe(true);
    expect(casos.has("CU-11")).toBe(true);
  });

  it("lo que se cobra y se muestra hoy con combinaciones es lo congelado en combinaciones.golden.txt", () => {
    const actual = texto();
    if (process.env.REGENERAR_PRECIOS_PRECIO_Y_CARTA === "1" || !existsSync(ARCHIVO)) writeFileSync(ARCHIVO, actual);
    const esperado = readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n");
    expect(actual).toBe(esperado);
  });
});
