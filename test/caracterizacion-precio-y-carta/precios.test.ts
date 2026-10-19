import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armarLineaConfigurada } from "../../src/core/pos/linea-configurada";
import { resumenDePrecios, resumenDePreciosConCombinaciones, vistaPreviaDeConfiguracion } from "../../src/core/pos/precio-de-configuracion";
import { ESCENARIOS_DE_REFERENCIA, PRODUCTOS_DE_REFERENCIA, type ProductoDeReferencia } from "../setup/referencia-precio-y-carta";
import { n, textoDeCarta, textoDeResumen } from "./texto";

/**
 * CARACTERIZACIÓN del precio que se COBRA y del precio que se MUESTRA hoy (Fase 0 de la ola «precio y carta», 2026-10-19). Funciones puras, sin base: congela, para el catálogo
 * de referencia (`test/setup/referencia-precio-y-carta.ts`, que reproduce producción y los casos CU-01 a CU-12 del paquete de auditoría), lo que dan:
 *  - la VENTA (`armarLineaConfigurada`: precio unitario, precio de carta, fotos de opciones, adicionales o el código del rechazo);
 *  - la VISTA PREVIA del diálogo del POS (`vistaPreviaDeConfiguracion`);
 *  - el RESUMEN de precios del POS y el de la CARTA PÚBLICA (`resumenDePrecios`, lo que usa `src/server/lecturas/carta/menu.ts`), y lo que la carta dibuja con él
 *    (`opcionesParaLaCarta`).
 *
 * Es una FOTO de hoy, no una aprobación: lo que hoy está mal (por ejemplo, el precio doble de $38.000 de la milanesa M2 con base cargada por error) queda escrito tal cual y se
 * corrige en las fases siguientes declarando la regeneración en `test/arquitectura/caracterizaciones-congeladas.test.ts`. Para regenerarla A PROPÓSITO:
 * `REGENERAR_PRECIOS_PRECIO_Y_CARTA=1 npx vitest run test/caracterizacion-precio-y-carta/precios.test.ts`.
 *
 * Las COMBINACIONES (GO-3a) se caracterizan aparte (`combinaciones.test.ts`): retirarlas en la Fase 3 no mueve ni un byte de este golden, y esa es la prueba de que el
 * retiro no cambió el precio de nadie. Los rótulos de acá son neutros a propósito, por lo mismo.
 */
const ARCHIVO = join(__dirname, "precios.golden.txt");

function textoDelProducto(p: ProductoDeReferencia): string[] {
  const entrada = { grupos: p.grupos, precioBase: p.precioBase, descuentoDeProducto: p.descuentoDeProducto };
  const delPos = resumenDePreciosConCombinaciones(entrada);
  const delaCarta = resumenDePrecios(entrada);
  const out = [`##### ${p.nombre} (base ${n(p.precioBase)}, descuento ${p.descuentoDeProducto ?? "-"})`];
  out.push("resumen del POS:", ...textoDeResumen(delPos).map((l) => `  ${l}`));
  out.push("resumen de la carta pública:", ...textoDeResumen(delaCarta).map((l) => `  ${l}`));
  out.push(...textoDeCarta(delaCarta));
  return out;
}

function textoDelEscenario(i: number): string[] {
  const e = ESCENARIOS_DE_REFERENCIA[i]!;
  const p = e.producto;
  const venta = armarLineaConfigurada({ grupos: p.grupos, elegidas: e.elegidas, precioBase: p.precioBase, descuentoDeProducto: p.descuentoDeProducto, cantidad: e.cantidad });
  const vista = vistaPreviaDeConfiguracion({ grupos: p.grupos, elegidas: e.elegidas, precioBase: p.precioBase, descuentoDeProducto: p.descuentoDeProducto, cantidad: e.cantidad });
  const out = [`===== ${e.caso} · ${e.descripcion} · ${p.nombre} · cantidad ${e.cantidad}`];
  if (!venta.ok) out.push(`venta: RECHAZO ${venta.codigo}`);
  else if (venta.linea === null) out.push("venta: sin línea configurada (se pide como producto simple)");
  else {
    const l = venta.linea;
    out.push(`venta: precioUnitario=${n(l.precioUnitario)} precioCartaUnitario=${n(l.precioCartaUnitario)} huella=${l.huellaOpciones === null ? "-" : "sí"}`);
    for (const f of l.fotos) out.push(`  foto ${f.tipoGrupo} «${f.nombreGrupo}» ${f.nombreOpcion} x${f.cantidad} modo=${f.modoPrecio ?? "-"} dif=${f.tipoDeDiferencia ?? "-"}${f.porcentaje === null ? "" : `(${f.porcentaje}%)`} importe=${n(f.importeUnitario)} sucursal=${f.precioDeSucursal}`);
    for (const a of l.adicionales) out.push(`  adicional ${a.foto.nombreOpcion} x${a.cantidad} precioUnitario=${n(a.precioUnitario)}`);
  }
  if (!vista.ok) out.push(`vista previa: RECHAZO ${vista.codigo}`);
  else out.push(`vista previa: precioUnitario=${n(vista.precioUnitario)} precioLista=${n(vista.precioLista)} total=${n(vista.total)} adicionales=[${vista.adicionales.map((a) => `${a.nombre} x${a.cantidad} ${n(a.precioUnitario)}`).join(", ")}]`);
  const igual = venta.ok && venta.linea !== null && vista.ok ? venta.linea.precioUnitario === vista.precioUnitario : venta.ok === vista.ok;
  out.push(`paridad venta/vista previa: ${igual ? "coinciden" : "DIFIEREN"}`);
  return out;
}

function texto(): string {
  const bloques: string[] = ["# Caracterización del precio cobrado y mostrado (Fase 0). Foto de hoy, no aprobación.", ""];
  bloques.push("# PRODUCTOS (lo que muestran el POS y la carta pública)", "");
  for (const p of PRODUCTOS_DE_REFERENCIA) bloques.push(...textoDelProducto(p), "");
  bloques.push("# ESCENARIOS (lo que se cobra y lo que muestra la vista previa)", "");
  for (let i = 0; i < ESCENARIOS_DE_REFERENCIA.length; i++) bloques.push(...textoDelEscenario(i), "");
  return `${bloques.join("\n")}\n`;
}

describe("Caracterización del precio y la carta (Fase 0): funciones puras sobre el catálogo de referencia", () => {
  it("el catálogo cubre los casos CU-01 a CU-12 del paquete", () => {
    const casos = new Set(ESCENARIOS_DE_REFERENCIA.map((e) => e.caso));
    for (let k = 1; k <= 12; k++) {
      const cu = `CU-${String(k).padStart(2, "0")}`;
      // CU-07 y CU-11 (combinaciones) los cubre `combinaciones.test.ts`; CU-09 (carta de milanesas con encabezado) y CU-12 (receta propia por combinación) no son del precio:
      // los cubren la proyección de la carta y la caracterización integrada.
      if (cu === "CU-07" || cu === "CU-09" || cu === "CU-11" || cu === "CU-12") continue;
      expect(casos.has(cu), `${cu} sin escenario`).toBe(true);
    }
  });

  it("lo que se cobra y se muestra hoy es lo congelado en precios.golden.txt", () => {
    const actual = texto();
    if (process.env.REGENERAR_PRECIOS_PRECIO_Y_CARTA === "1" || !existsSync(ARCHIVO)) writeFileSync(ARCHIVO, actual);
    const esperado = readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n");
    expect(actual).toBe(esperado);
  });
});
