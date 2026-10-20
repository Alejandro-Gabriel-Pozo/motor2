import { redondearMoneda } from "@/core/moneda";
import { leerOpcionEnCarta, opcionesDelEje, primeraEnMinuscula, type EjesDeLaCarta, type RolDelGrupoEnCarta, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja»; ADR-035; DEC-06, DEC-07, DEC-10, DEC-11, DEC-34): cómo se LEE en la carta un producto con opciones. Lógica PURA, en el servidor: recibe la tabla de
 * precios que ya calculó la regla de la venta (`tablaDePreciosParaLaCarta` de `core/pos`, la misma cuenta que se cobra) y la traduce a la FORMA que dibuja la carta. No calcula ningún precio: cada
 * número sale de una celda de la tabla. La forma se declara acá, sin importar `core/pos` (este último ya usa la carta para el descuento de producto: sería un ciclo), igual que
 * `ResumenDePreciosParaCarta` en `opciones-en-carta.ts`.
 *
 * LAS FORMAS (decididas acá, desde datos declarados: el modo del producto, el papel de cada grupo, sus ejes y el interruptor «Mostrar el nombre arriba»; nunca comparando nombres):
 *  - `simple`: sin ejes (el bife con guarnición y extras): el nombre y su precio, con las aclaraciones debajo;
 *  - `columnas`: un producto DIRECTO con un tamaño que define el precio (el café): una fila dentro de una TANDA de productos consecutivos de la sección que comparten el MISMO grupo (`grupoId`), con
 *    columnas compartidas (Chico | Mediano | Grande) y «–» (`null`) donde el producto no ofrece ese tamaño. Más de 3 columnas en la tanda: cada producto cae a `lista` (DEC-06, decisión del dueño);
 *  - `tabla`: dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo / De trucha): el nombre arriba, una fila por opción del segundo eje (nunca se juntan aunque cuesten igual: DEC-10). Una
 *    base con dos ejes sale SIEMPRE así (DEC-11). Más de 3 columnas: `lista`, una fila por combinación;
 *  - `lista`: un eje en filas con su precio final. Una BASE de un solo eje (las pizzas) sale OCULTA por defecto (`encabezado: false`: cada opción es una fila con su nombre completo, «Pizza
 *    muzzarella $18.000») y con el nombre arriba si su interruptor está prendido (DEC-11). Un producto directo en lista lleva siempre el nombre arriba.
 * Las ACLARACIONES van debajo del plato, en el orden del producto (DEC-07): lo que se elige sin costo («Guarnición: ensalada, papas fritas o puré»: el nombre del grupo como rótulo y la primera letra de
 * cada opción en minúscula) y, si algo suma o resta, la línea con cada recargo («Extras: papas +$2.000»; el recargo de un adicional NUNCA lleva el descuento de producto). Una sola opción sin costo no
 * tiene línea.
 * Lo agotado hoy ya no llega (lo saca la regla de la venta): su fila no sale, su celda queda «–» y su columna desaparece si está agotada en toda la tanda.
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
  | { forma: "columnas"; celdas: (number | null)[]; aclaraciones: AclaracionCartaV1[] }
  | { forma: "tabla"; columnas: string[]; filas: { rotulo: string; celdas: (number | null)[] }[]; aclaraciones: AclaracionCartaV1[] }
  | { forma: "lista"; encabezado: boolean; filas: { rotulo: string; precio: number }[]; aclaraciones: AclaracionCartaV1[] };

/** Una tanda de una sección: los ítems `primero`…`ultimo` (índices en `items`, inclusive) comparten los rótulos de sus columnas. */
export interface TandaCartaV1 {
  primero: number;
  ultimo: number;
  rotulos: string[];
}

/** Una columna de un producto que todavía no tiene tanda (la arma la sección, con sus vecinos). */
interface ColumnaPendiente {
  opcionId: string;
  orden: number;
  rotulo: string;
  precio: number;
}

/** Lo que resuelve un producto solo: su forma final, o sus columnas a la espera de la tanda, o por qué no toma forma nueva. */
export type PresentacionDelProducto =
  /** `columnasDeMas`: una tabla de dos ejes con más columnas de las que entran cayó a una fila por combinación (cuántas columnas tenía). */
  | { tipo: "lista"; presentacion: PresentacionCartaV1; columnasDeMas?: number }
  | { tipo: "columnas"; grupoId: string; columnas: ColumnaPendiente[]; aclaraciones: AclaracionCartaV1[] }
  | { tipo: "sin-forma"; motivo: string };

/** Hasta cuántas columnas entra una tanda o una tabla (decisión del dueño); con más, cae a lista. */
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
const ejeConRotulos = (g: Grupo) => opcionesDelEje(g).map((o) => ({ opcionId: o.opcionId, orden: o.orden, rotulo: leerOpcionEnCarta(g.prefijoEnCarta, o) }));

/**
 * La forma de UN producto con opciones (sin mirar a sus vecinos: las columnas de un producto directo quedan pendientes de su tanda, `resolverTandas`). `conDescuento`: si rige un descuento de producto
 * en la sucursal (las celdas ya lo traen; decide si un recargo dentro del precio se puede leer exacto).
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

  if (!columnas && !filas) return { tipo: "lista", presentacion: { forma: "simple", aclaraciones } };

  if (columnas && filas) {
    const rotulosDeColumnas = ejeConRotulos(columnas);
    // Una columna o una fila que no se puede pedir en ninguna combinación no sale (agotada en todo el producto).
    const conAlguna = rotulosDeColumnas.map((_, c) => tabla.celdas.some((fila) => fila[c] !== null && fila[c] !== undefined));
    const cols = rotulosDeColumnas.filter((_, c) => conAlguna[c]);
    const fs = ejeConRotulos(filas)
      .map((f, i) => ({ rotulo: f.rotulo, celdas: (tabla.celdas[i] ?? []).filter((_, c) => conAlguna[c]).map((x) => x ?? null) }))
      .filter((f) => f.celdas.some((x) => x !== null));
    if (cols.length <= MAXIMO_DE_COLUMNAS_EN_CARTA) return { tipo: "lista", presentacion: { forma: "tabla", columnas: cols.map((c) => c.rotulo), filas: fs, aclaraciones } };
    // Más de 3 columnas: una fila por combinación («Simple, de carne»), con el nombre arriba.
    const combinadas = fs.flatMap((f) => f.celdas.flatMap((precio, c) => (precio === null ? [] : [{ rotulo: `${cols[c]!.rotulo}, ${primeraEnMinuscula(f.rotulo)}`, precio }])));
    return { tipo: "lista", presentacion: { forma: "lista", encabezado: true, filas: combinadas, aclaraciones }, columnasDeMas: cols.length };
  }

  // Un solo eje.
  const eje = (columnas ?? filas)!;
  const precioDe = (i: number) => (columnas ? tabla.celdas[0]?.[i] : tabla.celdas[i]?.[0]) ?? null;
  const opciones = ejeConRotulos(eje).flatMap((o, i) => {
    const precio = precioDe(i);
    return precio === null ? [] : [{ ...o, precio }];
  });
  if (columnas && !esBase) return { tipo: "columnas", grupoId: columnas.grupoId, columnas: opciones, aclaraciones };
  // Una base de un eje: oculta salvo «Mostrar el nombre arriba» (DEC-11). Un directo con filas solas («De carne», «De pollo»): siempre con el nombre arriba.
  const encabezado = esBase ? entrada.mostrarNombreArriba : true;
  return { tipo: "lista", presentacion: { forma: "lista", encabezado, filas: opciones.map((o) => ({ rotulo: o.rotulo, precio: o.precio })), aclaraciones } };
}

/** Un ítem de una sección para armar sus tandas: sus columnas pendientes (o `null` si no tiene). */
export interface PendienteDeTanda {
  grupoId: string;
  columnas: readonly ColumnaPendiente[];
  aclaraciones: AclaracionCartaV1[];
}

/**
 * Las TANDAS de una sección ya ordenada: los ítems CONSECUTIVOS con columnas del mismo grupo (`grupoId`, un dato declarado: dos grupos distintos con las mismas opciones son dos tandas) comparten
 * columnas: la unión de sus opciones disponibles, en el orden del grupo; donde un producto no ofrece una, `null` («–»). Una columna agotada en toda la tanda no sale (no está en ninguna). Con más de
 * `MAXIMO_DE_COLUMNAS_EN_CARTA` columnas, cada ítem de la tanda cae a `lista` (con el nombre arriba) y la tanda no existe. Devuelve la forma de cada ítem pendiente (por índice) y las tandas.
 */
export function resolverTandas(pendientes: readonly (PendienteDeTanda | null)[]): { porItem: Map<number, PresentacionCartaV1>; tandas: TandaCartaV1[]; caidasALista: { indice: number; columnas: number }[] } {
  const porItem = new Map<number, PresentacionCartaV1>();
  const tandas: TandaCartaV1[] = [];
  const caidasALista: { indice: number; columnas: number }[] = [];
  let i = 0;
  while (i < pendientes.length) {
    const primero = pendientes[i];
    if (!primero) {
      i++;
      continue;
    }
    let ultimo = i;
    while (pendientes[ultimo + 1]?.grupoId === primero.grupoId) ultimo++;
    const grupo = pendientes.slice(i, ultimo + 1) as PendienteDeTanda[];
    const union = new Map<string, ColumnaPendiente>();
    for (const p of grupo) for (const c of p.columnas) if (!union.has(c.opcionId)) union.set(c.opcionId, c);
    const ordenadas = [...union.values()].sort((a, b) => a.orden - b.orden || (a.opcionId < b.opcionId ? -1 : a.opcionId > b.opcionId ? 1 : 0));
    grupo.forEach((p, k) => {
      if (ordenadas.length > MAXIMO_DE_COLUMNAS_EN_CARTA) {
        porItem.set(i + k, { forma: "lista", encabezado: true, filas: p.columnas.map((c) => ({ rotulo: c.rotulo, precio: c.precio })), aclaraciones: p.aclaraciones });
        caidasALista.push({ indice: i + k, columnas: ordenadas.length });
        return;
      }
      const precio = new Map(p.columnas.map((c) => [c.opcionId, c.precio]));
      porItem.set(i + k, { forma: "columnas", celdas: ordenadas.map((c) => precio.get(c.opcionId) ?? null), aclaraciones: p.aclaraciones });
    });
    if (ordenadas.length <= MAXIMO_DE_COLUMNAS_EN_CARTA) tandas.push({ primero: i, ultimo, rotulos: ordenadas.map((c) => c.rotulo) });
    i = ultimo + 1;
  }
  return { porItem, tandas, caidasALista };
}
