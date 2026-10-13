import { describe, expect, it } from "vitest";
import { consumoDeLineaConfigurada } from "../../../src/core/movimientos/consumo-de-linea-configurada";
import { componerPrecioDeLinea } from "../../../src/core/opciones/componer-precio-de-linea";
import { huellaDeOpciones } from "../../../src/core/opciones/huella-de-opciones";
import { validarOpcionesElegidas } from "../../../src/core/opciones/validar-opciones-elegidas";
import { claveDeLineaDeVentaConOpciones } from "../../../src/core/pos/clave-de-linea-con-opciones";
import { CAFE, paraConsumo, paraPrecio, permitidosDe } from "./escenarios";

/**
 * El café de GO-0b de punta a punta: lo elegido se valida, se compone el precio, se calcula la huella y la clave de la línea, y se arma el consumo. Cada fila de la tabla
 * es un pedido real; el título dice lo que se cobra y lo que se descuenta del stock. Para verlo en pantalla:
 *
 *   npx vitest run test/core/opciones/cafe-de-punta-a-punta.test.ts --reporter=verbose
 *
 * Base del café: 3000 de precio, 10 g de grano, 60 ml de leche (con 5 % de merma) y un vaso chico. Tamaños: chico 2800 (×1), mediano 3400 (×1,5, vaso mediano),
 * grande 4000 (×2, vaso grande). Tipos: cortado (+0, la leche pasa a 30 ml), con leche (+300, suma 100 ml que también escalan), sin lactosa (+8,5 % del base = 255,
 * leche vegetal en lugar de la leche). Shot extra: adicional de 500, tope 2, suma 9 g de grano.
 */

type Consumo = Array<[string, number]>;

interface Pedido {
  titulo: string;
  elegidas: Array<[string, number]>;
  cantidad: number;
  precioDeLista: number;
  total: number;
  consumo: Consumo;
  adicional?: { cantidad: number; consumo: Consumo };
}

const PEDIDOS: Pedido[] = [
  {
    titulo: "1 café chico: se cobra $2.800 · descuenta grano 10 g, leche 63 ml, vaso chico 1",
    elegidas: [["o-chico", 1]],
    cantidad: 1,
    precioDeLista: 2800,
    total: 2800,
    consumo: [["mp-grano", 10], ["mp-leche", 63], ["mp-vaso-chico", 1]],
  },
  {
    titulo: "2 cafés medianos con leche: $3.700 c/u, $7.400 · grano 30 g, leche 189 ml + 300 ml, vaso mediano 2 (el vaso no se multiplica)",
    elegidas: [["o-mediano", 1], ["o-con-leche", 1]],
    cantidad: 2,
    precioDeLista: 3700,
    total: 7400,
    consumo: [["mp-grano", 30], ["mp-leche", 189], ["mp-vaso-mediano", 2], ["mp-leche", 300]],
  },
  {
    titulo: "1 café grande cortado: $4.000 · grano 20 g, leche 30 ml (el cortado reemplaza la leche), vaso grande 1",
    elegidas: [["o-grande", 1], ["o-cortado", 1]],
    cantidad: 1,
    precioDeLista: 4000,
    total: 4000,
    consumo: [["mp-grano", 20], ["mp-leche", 30], ["mp-vaso-grande", 1]],
  },
  {
    titulo: "1 café grande sin lactosa: $4.255 (4.000 + 8,5 % de 3.000) · grano 20 g, leche vegetal 120 ml, vaso grande 1",
    elegidas: [["o-grande", 1], ["o-sin-lactosa", 1]],
    cantidad: 1,
    precioDeLista: 4255,
    total: 4255,
    consumo: [["mp-grano", 20], ["mp-leche-vegetal", 120], ["mp-vaso-grande", 1]],
  },
  {
    titulo: "3 cafés medianos con 2 shots extra c/u: $3.400 c/u + línea aparte de 6 shots a $500 = $13.200 · grano 45 g, leche 283,5 ml, vaso mediano 3; los shots descuentan 54 g de grano",
    elegidas: [["o-mediano", 1], ["o-shot", 2]],
    cantidad: 3,
    precioDeLista: 3400,
    total: 13200,
    consumo: [["mp-grano", 45], ["mp-leche", 283.5], ["mp-vaso-mediano", 3]],
    adicional: { cantidad: 6, consumo: [["mp-grano", 54]] },
  },
];

function armar(p: Pedido) {
  const validadas = validarOpcionesElegidas(permitidosDe(CAFE), p.elegidas.map(([opcionId, cantidad]) => ({ opcionId, cantidad })));
  if (!validadas.ok) throw new Error(validadas.mensaje);
  const precio = componerPrecioDeLinea({ precioBase: CAFE.precioBase, cantidad: p.cantidad, opciones: paraPrecio(CAFE, validadas.opciones) });
  if (!precio.ok) throw new Error(precio.mensaje);
  const { opciones, adicionales } = paraConsumo(CAFE, validadas.opciones);
  const consumo = consumoDeLineaConfigurada({ cantidad: p.cantidad, sucursalId: CAFE.sucursalId, base: CAFE.base, opciones, adicionales });
  if (!consumo.ok) throw new Error(consumo.mensaje);
  return { precio: precio.precio, consumo };
}

describe("café de punta a punta: precio y consumo de cada pedido", () => {
  // Un `it` por pedido (y no `it.each`): `it.each` recorta el título, y el título es lo que lee quien mira el informe.
  for (const p of PEDIDOS) it(p.titulo, () => {
    const { precio, consumo } = armar(p);
    expect(precio.precioDeLista).toBe(p.precioDeLista);
    expect(precio.total).toBe(p.total);
    expect(consumo.pedidos.map((x) => [x.productoId, x.cantidad])).toEqual(p.consumo);
    if (p.adicional) {
      expect(consumo.pedidosDeAdicionales.map((a) => [a.cantidad, a.pedidos.map((x) => [x.productoId, x.cantidad])])).toEqual([[p.adicional.cantidad, p.adicional.consumo]]);
      expect(precio.adicionales.map((a) => a.cantidad)).toEqual([p.adicional.cantidad]);
    } else {
      expect(consumo.pedidosDeAdicionales).toEqual([]);
      expect(precio.adicionales).toEqual([]);
    }
  });
});

describe("café de punta a punta: dos cafés al mismo precio no se juntan", () => {
  it("mediano a secas y mediano cortado cuestan lo mismo (3.400) pero tienen huella y clave distintas: dos operaciones, y se sabe qué consumió cada uno", () => {
    const mediano = armar({ titulo: "", elegidas: [["o-mediano", 1]], cantidad: 1, precioDeLista: 3400, total: 3400, consumo: [] });
    const cortado = armar({ titulo: "", elegidas: [["o-mediano", 1], ["o-cortado", 1]], cantidad: 1, precioDeLista: 3400, total: 3400, consumo: [] });
    expect(mediano.precio.precioDeLista).toBe(cortado.precio.precioDeLista);
    const claveDe = (r: ReturnType<typeof armar>) => claveDeLineaDeVentaConOpciones({ productoId: "p-cafe", precioUnitario: r.precio.precioDeLista, huellaOpciones: huellaDeOpciones(r.precio.dentroDelPrecio) });
    expect(claveDe(mediano)).not.toBe(claveDe(cortado));
    expect(mediano.consumo.ok && mediano.consumo.pedidos.find((x) => x.productoId === "mp-leche")?.cantidad).toBe(94.5);
    expect(cortado.consumo.ok && cortado.consumo.pedidos.find((x) => x.productoId === "mp-leche")?.cantidad).toBe(30);
  });
});
