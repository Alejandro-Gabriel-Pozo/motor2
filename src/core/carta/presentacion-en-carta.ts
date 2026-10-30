import { redondearMoneda } from "@/core/moneda";
import { leerOpcionEnCarta, opcionesDelEje, primeraEnMinuscula, type EjesDeLaCarta, type RolDelGrupoEnCarta, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja»; ADR-035; DEC-07, DEC-10, DEC-11, DEC-34) y modelo unificado de la carta (decisión del dueño, 2026-10-29): cómo se LEE en la carta un producto con
 * opciones. Lógica PURA, en el servidor: recibe la tabla de precios que ya calculó la regla de la venta (`tablaDePreciosParaLaCarta` de `core/pos`, la misma cuenta que se cobra) y la traduce a la
 * FORMA que dibuja la carta. No calcula ningún precio: cada número sale de una celda de la tabla. La forma se declara acá, sin importar `core/pos` (este último ya usa la carta para el descuento de
 * producto: sería un ciclo), igual que `ResumenDePreciosParaCarta` en `opciones-en-carta.ts`.
 *
 * UN SOLO MODELO (decidido desde datos declarados: el modo del producto, el papel de cada grupo, sus ejes y el interruptor «Mostrar el nombre arriba»; nunca comparando nombres):
 *  - `simple`: sin ejes (el bife con guarnición y extras): el nombre y su precio, con las aclaraciones debajo;
 *  - `tabla`: con 1 o 2 ejes. El nombre del producto es el TÍTULO (`titulo`), las columnas son los encabezados que se repiten en cada producto (nunca se juntan con los de un vecino), y cada fila es una
 *    opción (`rotulo`; `null` = la única fila de un producto sin variantes) con el precio final de cada celda. Las filas NUNCA se juntan aunque cuesten igual (DEC-10). Cuántas columnas y filas sale de los ejes:
 *      · dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo / De trucha): el primero en columnas y el otro en filas; siempre con título (DEC-11);
 *      · un eje de tamaños de un producto DIRECTO (el café): columnas con una sola fila; un eje en filas (De carne / De pollo; las pizzas de un directo), una columna de precios sin encabezado;
 *      · MÁS de 3 columnas: se TRANSPONE (el eje largo pasa a las filas y el otro, si hay, a las columnas); si los dos ejes tienen más de 3, una fila por combinación («Simple, de carne»);
 *      · una BASE de un solo eje (las pizzas) sale OCULTA por defecto (`titulo: false`: cada opción es una fila con su nombre completo, «Pizza muzzarella $18.000») y con el nombre arriba si su
 *        interruptor está prendido (DEC-11).
 * Las ACLARACIONES van debajo del plato, en el orden del producto (DEC-07): lo que se elige sin costo («Guarnición: ensalada, papas fritas o puré»: el nombre del grupo como rótulo y la primera letra de
 * cada opción en minúscula) y, si algo suma o resta, la línea con cada recargo («Extras: papas +$2.000»; el recargo de un adicional NUNCA lleva el descuento de producto). Una sola opción sin costo no
 * tiene línea.
 * Lo agotado hoy ya no llega (lo saca la regla de la venta): su fila no sale, su celda queda «–» y su columna desaparece si está agotada en todo el producto.
 * Lo que la carta no puede leer con el precio exacto (un tercer grupo que cambia el precio; un recargo dentro del precio con descuento de producto) NO toma forma nueva: sale como antes y queda en el
 * diagnóstico interno.
 */

/** Lo que este módulo lee de la tabla de precios de un producto (estructural: `TablaDePreciosParaLaCarta` de `core/pos` cumple esta forma). */
export interface TablaDePreciosParaCarta {
  grupos: readonly {
    grupoId: string;
    nombre: string;
    tipo: TipoDeGrupoDeOpciones;
    cantidadMinima: number;
    cantidadMaxima: number;
    prefijoEnCarta: string | null;
    papel: RolDelGrupoEnCarta;
    opciones: readonly { opcionId: string; nombre: string; esNinguna: boolean; orden: number; precioFinal: number | null; diferencia: number }[];
  }[];
  ejes: EjesDeLaCarta;
  /** `celdas[fila][columna]`, con el descuento de producto; `null` = esa combinación no se compone. */
  celdas: readonly (readonly (number | null)[])[];
}

/**
 * Una línea debajo del plato, una por grupo: lo que se elige sin costo (solo nombres) o, si algo suma o resta, cada opción con su recargo sobre lo que el precio ya incluye (0 = no suma; en un
 * adicional solo van las que suman).
 */
export type AclaracionCartaV1 = { tipo: "eleccion"; rotulo: string; opciones: string[] } | { tipo: "extras"; rotulo: string; opciones: { nombre: string; recargo: number }[] };

/** La forma con que la carta lee un producto con opciones (ver arriba). `null` en una celda = no se ofrece (se dibuja «–», con «no se ofrece» para el lector de pantalla). */
export type PresentacionCartaV1 =
  | { forma: "simple"; aclaraciones: AclaracionCartaV1[] }
  | {
      forma: "tabla";
      /** El nombre del producto va de título. `false` solo en una base de un eje oculta (cada fila es un plato entero). */
      titulo: boolean;
      /** Los encabezados de las columnas de precio; vacío = una sola columna de precios sin encabezado. */
      columnas: string[];
      /** Una fila por opción, con un precio por columna (o uno solo si no hay encabezados). `rotulo: null` = la única fila de un producto sin variantes. */
      filas: { rotulo: string | null; celdas: (number | null)[] }[];
      aclaraciones: AclaracionCartaV1[];
    };

/** Lo que resuelve un producto: su forma, o por qué no toma forma nueva. */
export type PresentacionDelProducto =
  /** `columnasDeMas`: tenía más columnas de las que entran y se transpuso o cayó a una fila por combinación (cuántas columnas tenía). */
  | { tipo: "forma"; presentacion: PresentacionCartaV1; columnasDeMas?: number }
  | { tipo: "sin-forma"; motivo: string };

/** Hasta cuántas columnas entra una tabla (decisión del dueño); con más, se transpone. */
const MAXIMO_DE_COLUMNAS_EN_CARTA = 3;

/** Más filas que esto: se dibujan todas (nunca «desde» ni colapso) y el producto queda en el diagnóstico interno (la administración sugiere dividirlo). */
export const FILAS_SUGERIDAS_EN_CARTA = 8;

type Grupo = TablaDePreciosParaCarta["grupos"][number];

/** Las aclaraciones de los grupos que no son ejes, en el orden del producto. */
function aclaracionesDe(tabla: TablaDePreciosParaCarta, conDescuento: boolean): AclaracionCartaV1[] | { motivo: string } {
  const ejes = new Set([tabla.ejes.columnas, tabla.ejes.filas]);
  const salida: AclaracionCartaV1[] = [];
  for (const g of tabla.grupos) {
    if (ejes.has(g.grupoId)) continue;
    const reales = g.opciones.filter((o) => !o.esNinguna);
    // Un grupo obligatorio que no es adicional ya está en el precio con su opción más barata (cada celda la incluye): lo que suma cada una se cuenta sobre esa.
    const obligatorio = g.tipo !== "ADICIONAL" && g.cantidadMinima > 0 && g.opciones.length > 0;
    const incluido = obligatorio && g.tipo !== "MEDIDA" ? Math.min(...g.opciones.map((o) => o.diferencia)) : 0;
    const conRecargo = reales.map((o) => ({ nombre: primeraEnMinuscula(o.nombre), recargo: g.tipo === "MEDIDA" ? 0 : redondearMoneda(o.diferencia - incluido) }));
    if (conRecargo.some((o) => o.recargo !== 0)) {
      // Un recargo DENTRO del precio (no es un adicional) con descuento de producto: el que se cobra lleva el descuento y el «+$» no lo diría exacto. La carta no lo inventa: sale como antes.
      if (g.tipo !== "ADICIONAL" && conDescuento) return { motivo: `«${g.nombre}» suma al precio y el producto tiene descuento: el recargo no se puede leer exacto` };
      // UNA línea por grupo, en el orden del grupo: lo que suma con su recargo y lo que no, con recargo 0 («solo, cortado, lágrima +$200 o con leche +$300»). Lo que no suma de un adicional no se pide: no va.
      salida.push({ tipo: "extras", rotulo: g.nombre, opciones: g.tipo === "ADICIONAL" ? conRecargo.filter((o) => o.recargo !== 0) : conRecargo });
    } else if (reales.length > 1) {
      salida.push({ tipo: "eleccion", rotulo: g.nombre, opciones: reales.map((o) => primeraEnMinuscula(o.nombre)) });
    }
  }
  return salida;
}

/** Las opciones de un eje con su rótulo («De carne»: el prefijo de la carta y la primera letra en minúscula; sin prefijo, tal cual). */
const ejeConRotulos = (g: Grupo) => opcionesDelEje(g).map((o) => ({ rotulo: leerOpcionEnCarta(g.prefijoEnCarta, o) }));

/**
 * La forma de UN producto con opciones. `conDescuento`: si rige un descuento de producto en la sucursal (las celdas ya lo traen; decide si un recargo dentro del precio se puede leer exacto).
 */
export function presentacionDelProducto(entrada: { tabla: TablaDePreciosParaCarta; esBase: boolean; mostrarNombreArriba: boolean; conDescuento: boolean }): PresentacionDelProducto {
  const { tabla, esBase } = entrada;
  if (tabla.ejes.sinLugar.length > 0) {
    const nombres = tabla.grupos.filter((g) => tabla.ejes.sinLugar.includes(g.grupoId)).map((g) => `«${g.nombre}»`);
    return { tipo: "sin-forma", motivo: `más de dos grupos cambian el precio (${nombres.join(", ")} no cabe en la tabla)` };
  }
  const aclaraciones = aclaracionesDe(tabla, entrada.conDescuento);
  if (!Array.isArray(aclaraciones)) return { tipo: "sin-forma", motivo: aclaraciones.motivo };
  const grupoDe = (grupoId: string | null) => tabla.grupos.find((g) => g.grupoId === grupoId);
  const columnas = grupoDe(tabla.ejes.columnas);
  const filas = grupoDe(tabla.ejes.filas);
  const forma = (t: { titulo: boolean; columnas: string[]; filas: { rotulo: string | null; celdas: (number | null)[] }[] }, columnasDeMas?: number): PresentacionDelProducto => ({
    tipo: "forma",
    presentacion: { forma: "tabla", ...t, aclaraciones },
    ...(columnasDeMas !== undefined ? { columnasDeMas } : {}),
  });

  if (!columnas && !filas) return { tipo: "forma", presentacion: { forma: "simple", aclaraciones } };

  if (columnas && filas) {
    const rotulosDeColumnas = ejeConRotulos(columnas);
    // Una columna o una fila que no se puede pedir en ninguna combinación no sale (agotada en todo el producto).
    const conAlguna = rotulosDeColumnas.map((_, c) => tabla.celdas.some((fila) => fila[c] !== null && fila[c] !== undefined));
    const cols = rotulosDeColumnas.filter((_, c) => conAlguna[c]);
    const fs = ejeConRotulos(filas)
      .map((f, i) => ({ rotulo: f.rotulo, celdas: (tabla.celdas[i] ?? []).filter((_, c) => conAlguna[c]).map((x) => x ?? null) }))
      .filter((f) => f.celdas.some((x) => x !== null));
    if (cols.length <= MAXIMO_DE_COLUMNAS_EN_CARTA) return forma({ titulo: true, columnas: cols.map((c) => c.rotulo), filas: fs });
    // Más de 3 columnas: el eje largo pasa a las filas (las variantes, a las columnas) y, si las variantes también son más de 3, una fila por combinación («Simple, de carne»).
    if (fs.length <= MAXIMO_DE_COLUMNAS_EN_CARTA) return forma({ titulo: true, columnas: fs.map((f) => f.rotulo), filas: cols.map((c, i) => ({ rotulo: c.rotulo, celdas: fs.map((f) => f.celdas[i] ?? null) })) }, cols.length);
    const combinadas = fs.flatMap((f) => f.celdas.flatMap((precio, c) => (precio === null ? [] : [{ rotulo: `${cols[c]!.rotulo}, ${primeraEnMinuscula(f.rotulo)}`, celdas: [precio] }])));
    return forma({ titulo: true, columnas: [], filas: combinadas }, cols.length);
  }

  // Un solo eje.
  const eje = (columnas ?? filas)!;
  const precioDe = (i: number) => (columnas ? tabla.celdas[0]?.[i] : tabla.celdas[i]?.[0]) ?? null;
  const opciones = ejeConRotulos(eje).flatMap((o, i) => {
    const precio = precioDe(i);
    return precio === null ? [] : [{ rotulo: o.rotulo, precio }];
  });
  // Los tamaños de un directo (el café): sus encabezados y una sola fila de precios, con el nombre arriba.
  const comoColumnas = columnas !== undefined && !esBase;
  if (comoColumnas && opciones.length <= MAXIMO_DE_COLUMNAS_EN_CARTA) return forma({ titulo: true, columnas: opciones.map((o) => o.rotulo), filas: [{ rotulo: null, celdas: opciones.map((o) => o.precio) }] });
  // Lo demás (un eje en filas, más de 3 tamaños, una base): una columna de precios, una fila por opción. Una base de un eje: oculta salvo «Mostrar el nombre arriba» (DEC-11); un directo, con el nombre arriba.
  return forma({ titulo: esBase ? entrada.mostrarNombreArriba : true, columnas: [], filas: opciones.map((o) => ({ rotulo: o.rotulo, celdas: [o.precio] })) }, comoColumnas ? opciones.length : undefined);
}

/**
 * La forma de UN producto mirado SOLO, sin sus vecinos de sección (la vista previa «Va a mostrar» de «Agregar a la carta» y la de la ficha del producto): la misma que da la carta. `null` si la carta
 * no lo puede leer con el precio exacto (sale como antes).
 */
export function presentacionDeUnProductoSolo(entrada: Parameters<typeof presentacionDelProducto>[0]): PresentacionCartaV1 | null {
  const r = presentacionDelProducto(entrada);
  return r.tipo === "forma" ? r.presentacion : null;
}
