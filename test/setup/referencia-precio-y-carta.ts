import type { GrupoParaVender, OpcionParaVender } from "../../src/core/pos/linea-configurada";
import type { DiferenciaDePrecio } from "../../src/core/opciones/public";

/**
 * CATÁLOGO DE REFERENCIA de precio y carta (Fase 0 de la ola «precio y carta», 2026-10-19). Datos PUROS: sin base ni red. Reproduce las configuraciones reales de
 * producción (pizzas con precio absoluto, milanesas con terminación absoluta y variante «Milanesas de», café con tamaño absoluto y variante de preparación, bife con
 * guarnición incluida) más los casos del paquete de auditoría (CU-01 a CU-12) que producción todavía no usa (adicionales, porcentajes, precio de sucursal). Las COMBINACIONES (GO-3a: CU-07, CU-11) vivían aparte, en `referencia-combinaciones.ts`, para que
 * retirarlas no tocara los goldens del resto: se retiraron en la Fase 3, paso 3.3, sin mover ni un byte de ellos.
 *
 * Lo usan las caracterizaciones de `test/caracterizacion-precio-y-carta/`: congelan lo que se cobra y lo que se muestra HOY, para poder demostrar en las fases
 * siguientes que «el precio cobrado no cambió». Un cambio en estos datos cambia los goldens: se declara en `caracterizaciones-congeladas.test.ts`.
 */

const monto = (m: number): DiferenciaDePrecio => ({ tipo: "MONTO", monto: m });
const porcentaje = (p: number): DiferenciaDePrecio => ({ tipo: "PORCENTAJE", porcentaje: p });

function opcion(opcionId: string, nombre: string, extra: Partial<OpcionParaVender> = {}): OpcionParaVender {
  return {
    opcionId,
    nombre,
    orden: 0,
    activa: true,
    admitida: true,
    apagadaEnSucursal: false,
    cantidadMaxima: 3,
    versionVigenteId: `v-${opcionId}`,
    esNinguna: false,
    productoAnclaId: null,
    diferenciaDeLaVersion: monto(0),
    factorEscala: null,
    consumos: [],
    precioAbsoluto: null,
    diferenciaDelProducto: null,
    precioDeSucursal: null,
    ...extra,
  };
}

/** Las opciones con su `orden` en la lista (el orden del grupo es el de la lista). */
const ordenadas = (opciones: OpcionParaVender[]): OpcionParaVender[] => opciones.map((o, i) => ({ ...o, orden: i }));

function grupo(g: Omit<GrupoParaVender, "activo" | "admitido" | "orden" | "modoPrecio"> & Partial<Pick<GrupoParaVender, "orden" | "modoPrecio">>): GrupoParaVender {
  return { activo: true, admitido: true, orden: 0, modoPrecio: null, ...g };
}

export interface ProductoDeReferencia {
  /** Cómo se llama en producción o en el paquete de auditoría. */
  nombre: string;
  /** El precio base del producto en la sucursal (`resolverPrecioVenta`). */
  precioBase: number;
  descuentoDeProducto: number | null;
  grupos: GrupoParaVender[];
}

export interface EscenarioDeReferencia {
  /** CU-xx del paquete, o `PROD` si es una configuración real de producción. */
  caso: string;
  descripcion: string;
  producto: ProductoDeReferencia;
  cantidad: number;
  elegidas: { opcionId: string; cantidad: number }[];
}

const uno = (opcionId: string) => ({ opcionId, cantidad: 1 });

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Productos

/** CU-01: producto directo sin opciones. */
const GASEOSA: ProductoDeReferencia = { nombre: "Gaseosa 500 cc", precioBase: 4000, descuentoDeProducto: null, grupos: [] };

/** CU-02 y CU-03: bife con guarnición incluida (INCLUIDA, obligatoria) y extras (ADICIONAL, línea hija). Producción: «Bife a la criolla» ($20.000, grupo «Guarnicion»). */
const BIFE: ProductoDeReferencia = {
  nombre: "Bife a la criolla",
  precioBase: 20000,
  descuentoDeProducto: null,
  grupos: [
    grupo({
      grupoId: "g-guarnicion",
      nombre: "Guarnición",
      tipo: "INCLUIDA",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 0,
      opciones: ordenadas([opcion("o-ensalada", "Ensalada"), opcion("o-papas", "Papas fritas"), opcion("o-pure", "Puré")]),
    }),
    grupo({
      grupoId: "g-extras",
      nombre: "Extras",
      tipo: "ADICIONAL",
      cantidadMinima: 0,
      cantidadMaxima: 3,
      orden: 1,
      opciones: ordenadas([
        opcion("o-extra-papas", "Extra de papas", { productoAnclaId: "p-extra-papas", diferenciaDeLaVersion: monto(2000) }),
        opcion("o-huevo", "Huevo frito", { productoAnclaId: "p-huevo", diferenciaDeLaVersion: monto(1500) }),
      ]),
    }),
  ],
};

/** CU-04 y CU-08: pizzas. Producción: «Pizzas» ($18.000) con el tamaño-absoluto «Tipos de Pizza» y 6 opciones (el precio base repite el de la más barata). */
const PIZZAS: ProductoDeReferencia = {
  nombre: "Pizzas",
  precioBase: 18000,
  descuentoDeProducto: null,
  grupos: [
    grupo({
      grupoId: "g-tipos-de-pizza",
      nombre: "Tipos de Pizza",
      tipo: "MEDIDA",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 0,
      modoPrecio: "ABSOLUTO",
      opciones: ordenadas([
        opcion("o-pizza-muzzarella", "Pizza muzzarella", { precioAbsoluto: 18000 }),
        opcion("o-pizza-verduras", "Pizza de verduras asadas", { precioAbsoluto: 20000 }),
        opcion("o-pizza-fugazzeta", "Pizza fugazzeta", { precioAbsoluto: 22000 }),
        opcion("o-pizza-napolitana", "Pizza napolitana", { precioAbsoluto: 22000 }),
        opcion("o-pizza-papas", "Pizza con papas fritas", { precioAbsoluto: 25000 }),
        opcion("o-pizza-bomba", "Pizza bomba", { precioAbsoluto: 25000 }),
      ]),
    }),
  ],
};

const milanesasDe = (orden: number, grupoId: string): GrupoParaVender =>
  grupo({
    grupoId,
    nombre: "Milanesas de",
    tipo: "VARIANTE",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    orden,
    opciones: ordenadas([opcion("o-carne", "Carne"), opcion("o-pollo", "Pollo")]),
  });

/** CU-05 y CU-06, modelado M1 (el de producción): «Tipo de Milanesa» es un tamaño con precio absoluto (Simple $20.000, Napolitana $25.000) y «Milanesas de» una variante sin diferencia. */
const MILANESA_M1: ProductoDeReferencia = {
  nombre: "Milanesas (M1: terminación con precio absoluto)",
  precioBase: 20000,
  descuentoDeProducto: null,
  grupos: [
    grupo({
      grupoId: "g-tipo-de-milanesa",
      nombre: "Tipo de Milanesa",
      tipo: "MEDIDA",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 0,
      modoPrecio: "ABSOLUTO",
      opciones: ordenadas([opcion("o-simple", "Simple", { precioAbsoluto: 20000 }), opcion("o-napolitana", "Napolitana", { precioAbsoluto: 25000 })]),
    }),
    milanesasDe(1, "g-milanesas-de"),
  ],
};

/** CU-04, modelado M2 (la trampa del paquete, §3.3): la terminación como VARIANTE con diferencia sobre el precio base. Con base $20.000 suma; con base 0 daría el precio final. */
const MILANESA_M2: ProductoDeReferencia = {
  nombre: "Milanesas (M2: terminación como variante con diferencia)",
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
      opciones: ordenadas([opcion("o-simple", "Simple"), opcion("o-napolitana", "Napolitana", { diferenciaDeLaVersion: monto(5000) })]),
    }),
    milanesasDe(1, "g-milanesas-de"),
  ],
};

/** CU-04 con la trampa cargada a propósito: base $18.000 por error y la diferencia de la terminación cargada como precio final (Simple $20.000, Napolitana $25.000): se SUMAN a la base y dan $38.000 y $43.000. */
const MILANESA_M2_TRAMPA: ProductoDeReferencia = {
  ...MILANESA_M2,
  nombre: "Milanesas (M2 con base cargada por error)",
  precioBase: 18000,
  grupos: [
    grupo({
      grupoId: "g-terminacion",
      nombre: "Terminación",
      tipo: "VARIANTE",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      orden: 0,
      opciones: ordenadas([opcion("o-simple", "Simple", { diferenciaDeLaVersion: monto(20000) }), opcion("o-napolitana", "Napolitana", { diferenciaDeLaVersion: monto(25000) })]),
    }),
  ],
};

const cafeGrupos = (extra: { medianoDeSucursal?: number } = {}): GrupoParaVender[] => [
  grupo({
    grupoId: "g-tamano-del-cafe",
    nombre: "Tamaño del Café",
    tipo: "MEDIDA",
    cantidadMinima: 1,
    cantidadMaxima: 1,
    orden: 0,
    modoPrecio: "ABSOLUTO",
    opciones: ordenadas([
      opcion("o-chico", "Chico", { precioAbsoluto: 4000 }),
      opcion("o-mediano", "Mediano", { precioAbsoluto: 4100, precioDeSucursal: extra.medianoDeSucursal ?? null }),
      opcion("o-grande", "Grande", { precioAbsoluto: 4300 }),
    ]),
  }),
  grupo({
    grupoId: "g-preparacion",
    nombre: "Preparación del café",
    tipo: "VARIANTE",
    cantidadMinima: 0,
    cantidadMaxima: 1,
    orden: 1,
    opciones: ordenadas([
      opcion("o-solo", "Solo"),
      opcion("o-cortado", "Cortado"),
      opcion("o-lagrima", "Lágrima", { diferenciaDeLaVersion: monto(200) }),
      opcion("o-con-leche", "Con leche", { diferenciaDeLaVersion: monto(300) }),
    ]),
  }),
  grupo({
    grupoId: "g-intensidad",
    nombre: "Intensidad",
    tipo: "VARIANTE",
    cantidadMinima: 0,
    cantidadMaxima: 1,
    orden: 2,
    opciones: ordenadas([opcion("o-doble", "Doble", { diferenciaDeLaVersion: porcentaje(10) })]),
  }),
  grupo({
    grupoId: "g-extras-cafe",
    nombre: "Extras",
    tipo: "ADICIONAL",
    cantidadMinima: 0,
    cantidadMaxima: 2,
    orden: 3,
    opciones: ordenadas([opcion("o-shot", "Shot", { productoAnclaId: "p-shot", diferenciaDeLaVersion: monto(600) })]),
  }),
];

/** CU-10: café con tamaño de precio absoluto, preparación y adicional. Producción: «Café» ($4.000) con «Tamaño del Café» (Chico 4.000, Mediano 4.100, Grande 4.300) y «Preparación del café». */
const CAFE: ProductoDeReferencia = { nombre: "Café", precioBase: 4000, descuentoDeProducto: null, grupos: cafeGrupos() };

/** El mismo café con un precio local del producto (el base de la sucursal) y la grilla de la sucursal para el tamaño mediano. */
const CAFE_CON_PRECIOS_DE_SUCURSAL: ProductoDeReferencia = { nombre: "Café (precio local y grilla de sucursal)", precioBase: 4500, descuentoDeProducto: null, grupos: cafeGrupos({ medianoDeSucursal: 4200 }) };

/** El mismo café con un descuento de producto del 10 % (va sobre la lista compuesta, nunca sobre el adicional). */
const CAFE_CON_DESCUENTO: ProductoDeReferencia = { nombre: "Café (descuento de producto 10 %)", precioBase: 4000, descuentoDeProducto: 10, grupos: cafeGrupos() };

/** Un producto con precio base 0 y una variante sin costo: es lo que el paquete llamaba «producto sin precio propio». Hoy la composición lo rechaza (PRECIO_DE_LISTA_INVALIDO). */
const BASE_EN_CERO_CON_VARIANTE_SIN_COSTO: ProductoDeReferencia = {
  nombre: "Base en 0 con variante sin costo",
  precioBase: 0,
  descuentoDeProducto: null,
  grupos: [
    grupo({ grupoId: "g-sabor", nombre: "Sabor", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, opciones: ordenadas([opcion("o-a", "A"), opcion("o-b", "B")]) }),
  ],
};

/** Un producto con precio base 0 cuyo tamaño trae precio absoluto: el precio sale del tamaño. */
const BASE_EN_CERO_CON_TAMANO_ABSOLUTO: ProductoDeReferencia = {
  nombre: "Base en 0 con tamaño absoluto",
  precioBase: 0,
  descuentoDeProducto: null,
  grupos: [
    grupo({
      grupoId: "g-tamano",
      nombre: "Tamaño",
      tipo: "MEDIDA",
      cantidadMinima: 1,
      cantidadMaxima: 1,
      modoPrecio: "ABSOLUTO",
      opciones: ordenadas([opcion("o-chico", "Chico", { precioAbsoluto: 1500 }), opcion("o-grande", "Grande", { precioAbsoluto: 2500 })]),
    }),
  ],
};

export const PRODUCTOS_DE_REFERENCIA: readonly ProductoDeReferencia[] = [
  GASEOSA,
  BIFE,
  PIZZAS,
  MILANESA_M1,
  MILANESA_M2,
  MILANESA_M2_TRAMPA,
  CAFE,
  CAFE_CON_PRECIOS_DE_SUCURSAL,
  CAFE_CON_DESCUENTO,
  BASE_EN_CERO_CON_VARIANTE_SIN_COSTO,
  BASE_EN_CERO_CON_TAMANO_ABSOLUTO,
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Escenarios: una elección concreta sobre un producto (lo que arma el mozo)

const esc = (caso: string, descripcion: string, producto: ProductoDeReferencia, elegidas: { opcionId: string; cantidad: number }[], cantidad = 1): EscenarioDeReferencia => ({
  caso,
  descripcion,
  producto,
  cantidad,
  elegidas,
});

export const ESCENARIOS_DE_REFERENCIA: readonly EscenarioDeReferencia[] = [
  esc("CU-01", "gaseosa directa, sin opciones", GASEOSA, []),
  esc("CU-01", "gaseosa directa, 3 unidades", GASEOSA, [], 3),
  esc("CU-02", "bife con guarnición incluida (papas fritas)", BIFE, [uno("o-papas")]),
  esc("CU-03", "bife con puré y un extra de papas", BIFE, [uno("o-pure"), uno("o-extra-papas")]),
  esc("CU-03", "bife con ensalada, extra de papas y huevo frito, 2 unidades", BIFE, [uno("o-ensalada"), uno("o-extra-papas"), uno("o-huevo")], 2),
  esc("CU-02", "bife sin elegir la guarnición obligatoria (rechazo)", BIFE, []),
  esc("CU-04", "pizza de verduras asadas (tamaño absoluto)", PIZZAS, [uno("o-pizza-verduras")]),
  esc("CU-08", "pizza muzzarella (tamaño absoluto)", PIZZAS, [uno("o-pizza-muzzarella")]),
  esc("CU-08", "pizza bomba, 2 unidades", PIZZAS, [uno("o-pizza-bomba")], 2),
  esc("CU-05", "M1: milanesa simple de carne", MILANESA_M1, [uno("o-simple"), uno("o-carne")]),
  esc("CU-06", "M1: milanesa napolitana de pollo", MILANESA_M1, [uno("o-napolitana"), uno("o-pollo")]),
  esc("CU-04", "M2: milanesa simple de carne (terminación como diferencia)", MILANESA_M2, [uno("o-simple"), uno("o-carne")]),
  esc("CU-06", "M2: milanesa napolitana de pollo (base 20.000 + 5.000)", MILANESA_M2, [uno("o-napolitana"), uno("o-pollo")]),
  esc("CU-04", "M2 con base cargada por error: simple (la trampa de $38.000)", MILANESA_M2_TRAMPA, [uno("o-simple")]),
  esc("CU-04", "M2 con base cargada por error: napolitana", MILANESA_M2_TRAMPA, [uno("o-napolitana")]),
  esc("CU-10", "café chico solo", CAFE, [uno("o-chico"), uno("o-solo")]),
  esc("CU-10", "café grande con leche y un shot", CAFE, [uno("o-grande"), uno("o-con-leche"), uno("o-shot")]),
  esc("CU-10", "café mediano doble (+10 % sobre la base), 2 unidades", CAFE, [uno("o-mediano"), uno("o-doble")], 2),
  esc("CU-10", "café mediano con precio local y grilla de sucursal", CAFE_CON_PRECIOS_DE_SUCURSAL, [uno("o-mediano"), uno("o-lagrima")]),
  esc("CU-10", "café grande con descuento de producto 10 %, con un shot", CAFE_CON_DESCUENTO, [uno("o-grande"), uno("o-shot")]),
  esc("CU-04", "base en 0 con variante sin costo (rechazo por precio de lista)", BASE_EN_CERO_CON_VARIANTE_SIN_COSTO, [uno("o-a")]),
  esc("CU-04", "base en 0 con tamaño absoluto (el precio sale del tamaño)", BASE_EN_CERO_CON_TAMANO_ABSOLUTO, [uno("o-grande")]),
];
