import { LOCALES_DEL_IMPORTADOR, type CorreccionNominal, type LocalDelImportador } from "../../../src/core/features/catalogo/importacion/tipos";
import type { ProductoDeFixtura } from "./fixtura-de-catalogo";

/**
 * Un catálogo SINTÉTICO con la misma FORMA que el Excel del dueño (nunca sus precios ni sus nombres), para las pruebas de integración del importador: 207 SKU, 610 filas por local, 430
 * contenidos de carta (con sección y con precio), 50 SKU sin sección en 179 filas, un SKU sin precio y no disponible (como Ventus), 13 filas no disponibles en total, 13 SKU con precios
 * distintos que resuelve la regla del precio único y 1 que resuelve una corrección del dueño. Determinista.
 *
 * Así la confirmación deja: 207 productos, 610 disponibilidades, 430 contenidos, 637 auditorías (207 + 430) y 0 precios locales.
 */
const CON_SECCION = ["Entradas", "Platos Principales", "Clásicos", "Pastas Caseras", "Pizzas", "Postres", "Bebidas sin alcohol", "Bebidas con alcohol", "Vinos Neuquinos", "Tragos", "Jugos y Licuados"];
const SIN_SECCION = ["Minutas", "Menú Infantil", "Viandas", "Confitería"];

const localesDesde = (inicio: number, cantidad: number): LocalDelImportador[] => Array.from({ length: cantidad }, (_, k) => LOCALES_DEL_IMPORTADOR[(inicio + k) % LOCALES_DEL_IMPORTADOR.length]);

export const SKU_CORREGIDO = "ADICIONAL-SINTETICO";

export function catalogoSintetico(): { productos: ProductoDeFixtura[]; correcciones: CorreccionNominal[] } {
  const productos: ProductoDeFixtura[] = [];
  // 50 SKU sin sección: 29 con 4 locales y 21 con 3 = 179 filas; los 5 primeros, no disponibles en su primer local.
  for (let i = 0; i < 50; i++) {
    const locales = localesDesde(i, i < 29 ? 4 : 3);
    productos.push({
      sku: `SIN-SECCION-${i + 1}`,
      categoria: SIN_SECCION[i % SIN_SECCION.length],
      base: "Sin sección",
      variantes: [`N${i + 1}`],
      precios: Object.fromEntries(locales.map((l) => [l, 4000 + i * 100])),
      disponible: i < 5 ? { [locales[0]]: false } : {},
      descripcion: { [locales[0]]: `Descripción que no se carga ${i + 1}` },
    });
  }
  // 156 SKU con sección: 118 con 3 locales y 38 con 2 = 430 filas (430 contenidos); 13 con un precio distinto en su último local (la regla toma el más frecuente) y los 7 primeros, no disponibles
  // en su primer local (llevan igual su contenido visible).
  for (let i = 0; i < 156; i++) {
    const locales = localesDesde(i, i < 118 ? 3 : 2);
    const precio = 10000 + i * 500;
    const precios = Object.fromEntries(locales.map((l) => [l, precio])) as Record<LocalDelImportador, number>;
    if (i >= 20 && i < 33) precios[locales[2]] = precio + 1000;
    productos.push({
      sku: `CON-SECCION-${i + 1}`,
      categoria: CON_SECCION[i % CON_SECCION.length],
      base: "Con sección",
      variantes: [`N${i + 1}`],
      precios,
      disponible: i < 7 ? { [locales[0]]: false } : {},
      descripcion: i % 2 === 0 ? { [locales[0]]: `Descripción ${i + 1}` } : {},
    });
  }
  // El SKU sin precio en ningún local y no disponible (como Ventus): se crea a $0 y sin contenido de carta.
  productos.push({ sku: "VINO-SIN-PRECIO", categoria: "Vinos Neuquinos", base: "Vino", variantes: ["Sin precio"], precios: { "Los Miches": null }, disponible: { "Los Miches": false } });
  // El que corrige el dueño: dos precios distintos (en empate la regla daría el mayor) y la corrección fija el menor. Reemplaza al último SKU con sección de 2 locales (sigue habiendo 156 + 1 + 50).
  const ultimo = productos.findIndex((p) => p.sku === "CON-SECCION-156");
  productos[ultimo] = { sku: SKU_CORREGIDO, categoria: "Pizzas", base: "Adicional", variantes: ["Sintético"], precios: { Huinganco: 3000, "Los Miches": 25000 } };
  const correcciones: CorreccionNominal[] = [
    { tipo: "precioUnico", sku: SKU_CORREGIDO, preciosEnElExcel: { Huinganco: 3000, "Los Miches": 25000 }, valorACargar: 3000, fecha: "2026-10-28", motivo: "Decisión del dueño (sintético): dejar el 3000" },
  ];
  return { productos, correcciones };
}
