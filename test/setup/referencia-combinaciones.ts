import type { CombinacionesParaMostrar } from "../../src/core/pos/combinacion-elegida";
import { claveDeCombinacion } from "../../src/core/opciones/combinaciones";
import { esc, grupo, monto, opcion, ordenadas, uno, type EscenarioDeReferencia, type ProductoDeReferencia } from "./referencia-precio-y-carta";

/**
 * CATÁLOGO DE REFERENCIA de COMBINACIONES (GO-3a), aparte del resto a propósito: GO-3a se retira entero en la Fase 3 de la ola «precio y carta» (DEC-02, DEC-16; en producción
 * no tiene ninguna fila ni ninguna venta) y este archivo, su caracterización y su golden se retiran con él SIN tocar el golden de los demás productos.
 */
export interface ProductoConCombinaciones extends ProductoDeReferencia {
  combinaciones: CombinacionesParaMostrar;
}

/** CU-07, CU-11 y CU-12 (GO-3): dos ejes (terminación y «de») con combinaciones: una con precio propio, una apagada, una sin fila (aditivo). Producción: sin ninguna combinación. */
export const MILANESA_M3_COMBINACIONES: ProductoConCombinaciones = {
  nombre: "Milanesas (M3: dos ejes con combinaciones)",
  precioBase: 20000,
  descuentoDeProducto: null,
  grupos: [
    grupo({
      grupoId: "g-terminacion",
      nombre: "Terminación",
      tipo: "VARIANTE",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 0,
      ejeDeCombinacion: 1,
      opciones: ordenadas([opcion("o-simple", "Simple"), opcion("o-napolitana", "Napolitana", { diferenciaDeLaVersion: monto(5000) })]),
    }),
    grupo({
      grupoId: "g-de",
      nombre: "De",
      tipo: "VARIANTE",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 1,
      ejeDeCombinacion: 2,
      opciones: ordenadas([opcion("o-carne", "Carne"), opcion("o-pollo", "Pollo", { diferenciaDeLaVersion: monto(2000) })]),
    }),
  ],
  combinaciones: {
    nombreDelProducto: "Milanesas",
    filas: [
      { clave: claveDeCombinacion({ opcionEje1Id: "o-simple", opcionEje2Id: "o-pollo" }), combinacionId: "c-simple-pollo", activa: true, precio: 22000, grupo: null },
      { clave: claveDeCombinacion({ opcionEje1Id: "o-napolitana", opcionEje2Id: "o-carne" }), combinacionId: "c-napolitana-carne", activa: false, precio: null, grupo: null },
      { clave: claveDeCombinacion({ opcionEje1Id: "o-napolitana", opcionEje2Id: "o-pollo" }), combinacionId: "c-napolitana-pollo", activa: true, precio: 27000, grupo: null },
    ],
    locales: { porCombinacion: {}, porGrupo: {} },
  },
};

export const PRODUCTOS_CON_COMBINACIONES: readonly ProductoConCombinaciones[] = [MILANESA_M3_COMBINACIONES];

export const ESCENARIOS_CON_COMBINACIONES: readonly (EscenarioDeReferencia & { producto: ProductoConCombinaciones })[] = [
  esc("CU-07", "M3: simple de carne (sin fila: aditivo)", MILANESA_M3_COMBINACIONES, [uno("o-simple"), uno("o-carne")]) as EscenarioDeReferencia & { producto: ProductoConCombinaciones },
  esc("CU-07", "M3: simple de pollo (precio propio $22.000)", MILANESA_M3_COMBINACIONES, [uno("o-simple"), uno("o-pollo")]) as EscenarioDeReferencia & { producto: ProductoConCombinaciones },
  esc("CU-07", "M3: napolitana de pollo (precio propio $27.000)", MILANESA_M3_COMBINACIONES, [uno("o-napolitana"), uno("o-pollo")]) as EscenarioDeReferencia & { producto: ProductoConCombinaciones },
  esc("CU-11", "M3: napolitana de carne (combinación apagada)", MILANESA_M3_COMBINACIONES, [uno("o-napolitana"), uno("o-carne")]) as EscenarioDeReferencia & { producto: ProductoConCombinaciones },
];
