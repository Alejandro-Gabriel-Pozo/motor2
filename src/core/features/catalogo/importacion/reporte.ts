import type { PlanDeCarta } from "./planificar-carta";
import type { DiferenciaPorLocal, OrigenDelPrecio, PlanDeProductos } from "./planificar-productos";
import type { ConteosDeLaImportacion } from "./resumen";
import { LOCALES_DEL_IMPORTADOR, type AvisoDeImportacion, type CatalogoNormalizado, type ErrorDeImportacion } from "./tipos";

/**
 * El REPORTE de la importación (ADENDA v2 A.7 del diseño del importador): las 12 hojas de la vista previa (y del resultado de la confirmación), como datos. Puro: lo escribe a .xlsx el comando
 * con `generarExcelDeVariasHojas` (`src/core/excel.ts`, que guarda todo texto como texto: nada se evalúa como fórmula). Tiene precios: lo guarda el dueño, nunca el repositorio.
 */
export type CeldaDelReporte = string | number | null;

export interface HojaDelReporte {
  nombre: string;
  etiquetas: string[];
  filas: CeldaDelReporte[][];
}

export interface DatosDelReporte {
  tipo: "VISTA_PREVIA" | "RESULTADO";
  archivo: { nombre: string; sha256: string };
  correcciones: { nombre: string; sha256: string };
  /** Cuándo se generó (la pone el comando). */
  fecha: string;
  /** Host y base de destino (sin credenciales). */
  destino: string;
  empresa: string;
  actor: string;
  huella: string;
  confirmable: boolean;
  catalogo: CatalogoNormalizado;
  productos: PlanDeProductos;
  carta: PlanDeCarta;
  errores: readonly ErrorDeImportacion[];
  avisos: readonly AvisoDeImportacion[];
  conteos: ConteosDeLaImportacion;
  escrituras: { productos: number; filasDeDisponibilidad: number; contenidos: number; auditorias: number } | null;
}

const CIEN = BigInt(100);
const CERO = BigInt(0);
const DIEZ = BigInt(10);

/** Centavos → «$3.000» o «$3.000,50» (separador de miles «.», decimal «,»). */
export function pesos(centavos: bigint): string {
  const signo = centavos < CERO ? "-" : "";
  const abs = centavos < CERO ? -centavos : centavos;
  const enteros = (abs / CIEN).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const resto = abs % CIEN;
  return `${signo}$${enteros}${resto === CERO ? "" : `,${resto.toString().padStart(2, "0")}`}`;
}

/** Centavos → pesos como número (solo para mostrar en la planilla: los importes del reporte son enteros o con 2 decimales, exactos en `number`). */
const comoNumero = (centavos: bigint) => Number(centavos) / 100;

/** «+$3.000 (+10,0 %) cobrará MÁS» / «−$8.000 (−28,6 %) cobrará MENOS» / «igual». */
export function textoDeDiferencia(d: DiferenciaPorLocal): string {
  if (d.sentido === "IGUAL") return "igual";
  const signo = d.sentido === "MAS" ? "+" : "−";
  const abs = d.diferencia < CERO ? -d.diferencia : d.diferencia;
  const pct = d.porcentajeEnDecimas < CERO ? -d.porcentajeEnDecimas : d.porcentajeEnDecimas;
  return `${signo}${pesos(abs)} (${signo}${pct / DIEZ},${pct % DIEZ} %) cobrará ${d.sentido === "MAS" ? "MÁS" : "MENOS"}`;
}

const ORIGEN: Record<OrigenDelPrecio, string> = {
  UNICO_EN_EL_EXCEL: "único en el Excel",
  CORRECCION: "corrección del dueño",
  REGLA: "regla: el más frecuente (si empatan, el mayor)",
  SIN_PRECIO_EN_EL_EXCEL: "sin precio en el Excel ($0)",
};

/** Las 12 hojas, en el orden de A.7. */
export function armarReporte(d: DatosDelReporte): HojaDelReporte[] {
  const productoPorSku = new Map(d.catalogo.productos.map((p) => [p.sku, p]));
  const filasPorSku = new Map<string, typeof d.catalogo.filas>();
  for (const f of d.catalogo.filas) filasPorSku.set(f.sku, [...(filasPorSku.get(f.sku) ?? []), f]);
  const planPorSku = new Map(d.productos.productos.map((p) => [p.sku, p]));
  const regla = d.catalogo.correcciones.reglaDePrecioUnico;

  const conPrecioUnico = d.productos.productos.filter((p) => p.precio && (p.precio.origen === "REGLA" || p.precio.origen === "CORRECCION" || p.diferencias.some((x) => x.sentido !== "IGUAL")));
  const noDisponibles = d.catalogo.filas.filter((f) => !f.disponible);
  const filasDeAvisos: CeldaDelReporte[][] = [
    ...d.catalogo.inconsistenciasDelExcel.map((i) => [`Excel: ${i.tipo}`, i.sku, i.detalle]),
    ...d.avisos.map((a) => [a.tipo, a.sku, a.detalle]),
    ...conPrecioUnico.map((p) => ["PRECIO_UNICO", p.sku, `precios distintos entre locales: se carga ${pesos(p.precio!.centavos)} (${ORIGEN[p.precio!.origen]}); ver la hoja «Precio único»`]),
    ...noDisponibles.map((f) => ["NO_DISPONIBLE", f.sku, `${f.local}: no disponible${f.precioCentavos === null ? " y sin precio" : ""}`]),
    ...d.productos.productos.filter((p) => p.precio?.origen === "SIN_PRECIO_EN_EL_EXCEL").map((p) => ["SIN_PRECIO", p.sku, "ningún local tiene precio: se crea a $0, no disponible y sin contenido de carta (activarlo lo mostraría a $0)"]),
    ["SIN_RECETA", null, `la carta va a mostrar ${d.conteos.contenidos.CREAR + d.conteos.contenidos.SIN_CAMBIOS} contenidos de productos sin receta: no se pueden cobrar hasta tener receta (ADR-033)`],
    ["CARTA_PUBLICA", null, "la carta pública solo se ve con la sucursal publicada en el portal (SucursalPublica) y tiene caché de 60 s; dentro de la app se ve en /carta"],
  ];

  const resumen: HojaDelReporte = {
    nombre: "Resumen",
    etiquetas: ["Dato", "Valor"],
    filas: [
      ["Tipo de reporte", d.tipo === "VISTA_PREVIA" ? "Vista previa (no escribió nada)" : "Resultado de la confirmación"],
      ["Estado", d.confirmable ? "CONFIRMABLE" : "NO CONFIRMABLE"],
      ["Huella (la que se confirma)", d.huella.slice(0, 12)],
      ["Huella completa", d.huella],
      ["Archivo", d.archivo.nombre],
      ["SHA-256 del archivo", d.archivo.sha256],
      ["Correcciones", d.correcciones.nombre],
      ["Huella de las correcciones (SHA-256 de su contenido)", d.correcciones.sha256],
      ["Regla del precio único", regla ? `aceptada el ${regla.fecha}: ${regla.motivo}` : "NO aceptada (los SKU con precios distintos sin corrección son error)"],
      ["Fecha", d.fecha],
      ["Base destino", d.destino],
      ["Empresa", d.empresa],
      ["Actor", d.actor],
      ["Productos a crear", d.conteos.productos.CREAR],
      ["Productos sin cambios", d.conteos.productos.SIN_CAMBIOS],
      ["Productos con error", d.conteos.productos.ERROR],
      ["Filas de disponibilidad a crear", d.conteos.filasDeDisponibilidad],
      ["Contenidos de carta a crear", d.conteos.contenidos.CREAR],
      ["Contenidos de carta sin cambios", d.conteos.contenidos.SIN_CAMBIOS],
      ["Filas fuera de la carta (sin sección o sin precio)", d.conteos.contenidos.FUERA_DE_CARTA],
      ["Filas de carta con error", d.conteos.contenidos.ERROR],
      ["Auditorías", d.conteos.auditorias],
      ["Precios locales", d.conteos.preciosLocales],
      ["Errores", d.errores.length],
      ["Avisos (filas de la hoja «Avisos»)", filasDeAvisos.length],
      ...(d.escrituras
        ? [
            ["ESCRITO: productos", d.escrituras.productos],
            ["ESCRITO: disponibilidades", d.escrituras.filasDeDisponibilidad],
            ["ESCRITO: contenidos de carta", d.escrituras.contenidos],
            ["ESCRITO: auditorías", d.escrituras.auditorias],
          ]
        : []),
    ],
  };

  const productos: HojaDelReporte = {
    nombre: "Productos",
    etiquetas: ["SKU", "Nombre a cargar", "Nombre en el Excel", "Categoría del Excel", "Precio único", "Origen del precio", "Acción", "Motivo"],
    filas: d.productos.productos.map((p) => {
      const n = productoPorSku.get(p.sku)!;
      return [p.sku, p.nombre, n.nombreEnElExcel, p.categoria, p.precio ? comoNumero(p.precio.centavos) : null, p.precio ? ORIGEN[p.precio.origen] : "PENDIENTE", p.accion, p.errores.map((e) => `${e.codigo}: ${e.motivo}`).join(" | ")];
    }),
  };

  const pendientes = d.productos.productos.filter((p) => !p.precio);
  const precioUnico: HojaDelReporte = {
    nombre: "Precio único",
    etiquetas: ["SKU", "Nombre", ...LOCALES_DEL_IMPORTADOR.map((l) => `${l} (Excel)`), "Precio único", "Origen", "Empate", ...LOCALES_DEL_IMPORTADOR.map((l) => `Diferencia en ${l}`)],
    filas: [...conPrecioUnico, ...pendientes].map((p) => {
      const delExcel = new Map((filasPorSku.get(p.sku) ?? []).map((f) => [f.local, f.precioCentavos]));
      const dif = new Map(p.diferencias.map((x) => [x.local, x]));
      return [
        p.sku,
        p.nombre,
        ...LOCALES_DEL_IMPORTADOR.map((l) => {
          const c = delExcel.get(l);
          return c === undefined || c === null ? null : comoNumero(c);
        }),
        p.precio ? comoNumero(p.precio.centavos) : "PENDIENTE",
        p.precio ? ORIGEN[p.precio.origen] : "sin corrección ni regla aceptada",
        p.precio?.empate ? "sí (se tomó el mayor)" : "no",
        ...LOCALES_DEL_IMPORTADOR.map((l) => (dif.get(l) ? textoDeDiferencia(dif.get(l)!) : null)),
      ];
    }),
  };

  const disponibilidad: HojaDelReporte = {
    nombre: "Disponibilidad por local",
    etiquetas: ["SKU", "Local", "Precio en el Excel", "Precio que rige", "De dónde sale", "Disponible", "Acción"],
    filas: d.catalogo.filas.map((f) => {
      const p = planPorSku.get(f.sku);
      return [f.sku, f.local, f.precioCentavos === null ? null : comoNumero(f.precioCentavos), p?.precio ? comoNumero(p.precio.centavos) : null, "precio de la empresa (uno solo)", f.disponible ? "TRUE" : "FALSE", p?.accion ?? null];
    }),
  };

  const carta: HojaDelReporte = {
    nombre: "Carta",
    etiquetas: ["SKU", "Local", "Sección", "Descripción", "Orden", "Visible", "Disponible", "Acción", "Motivo"],
    filas: d.carta.contenidos
      .filter((c) => c.accion !== "FUERA_DE_CARTA")
      .map((c) => [c.sku, c.local, c.seccion, c.descripcion, c.orden, "sí", c.disponible ? "sí" : "no (no se ve hasta marcarlo disponible)", c.accion, c.accion === "ERROR" ? `${c.codigo}: ${c.motivo}` : c.motivo]),
  };

  const sinSeccion: HojaDelReporte = {
    nombre: "Sin sección",
    etiquetas: ["SKU", "Nombre", "Categoría", "Local", "Descripción que no se carga"],
    filas: d.carta.contenidos.filter((c) => c.codigo === "SIN_SECCION").map((c) => [c.sku, productoPorSku.get(c.sku)?.nombre ?? null, c.categoria, c.local, c.descripcionNoCargada]),
  };

  const nombresDeCarta: HojaDelReporte = {
    nombre: "Nombre de carta por local",
    etiquetas: ["SKU", "Nombre a cargar", "Con sección", ...LOCALES_DEL_IMPORTADOR],
    filas: [...filasPorSku.entries()]
      .filter(([, filas]) => new Set(filas.map((f) => f.nombreEnCarta)).size > 1)
      .map(([sku, filas]) => {
        const porLocal = new Map(filas.map((f) => [f.local, f.nombreEnCarta]));
        const categoria = productoPorSku.get(sku)?.categoria ?? "";
        return [sku, productoPorSku.get(sku)?.nombre ?? null, d.catalogo.correcciones.mapeoDeSecciones[categoria] ? "sí" : "no", ...LOCALES_DEL_IMPORTADOR.map((l) => porLocal.get(l) ?? null)];
      }),
  };

  const usadas = new Set([...d.catalogo.preciosUnicosCorregidos.keys()].map((s) => `precioUnico|${s}`));
  for (const p of d.catalogo.productos) if (p.nombreCorregido) usadas.add(`nombre|${p.sku}`);
  const correcciones: HojaDelReporte = {
    nombre: "Correcciones del dueño",
    etiquetas: ["Tipo", "SKU", "Lo que trae el Excel", "Lo que se carga", "Fecha", "Motivo", "¿Se aplicó?"],
    filas: [
      ...(regla ? [["reglaDePrecioUnico", "(todos los SKU con precios distintos sin corrección)", "precios distintos entre locales", "el más frecuente; si empatan, el mayor", regla.fecha, regla.motivo, "sí"]] : []),
      ...d.catalogo.correcciones.correcciones.map((c) => [
        c.tipo,
        c.sku,
        c.tipo === "precioUnico" ? Object.entries(c.preciosEnElExcel).map(([l, v]) => `${l}: ${pesos(BigInt(v) * CIEN)}`).join(" / ") : c.valorEnElExcel,
        c.tipo === "precioUnico" ? pesos(BigInt(c.valorACargar) * CIEN) : c.valorACargar,
        c.fecha,
        c.motivo,
        usadas.has(`${c.tipo}|${c.sku}`) ? "sí" : productoPorSku.has(c.sku) ? "NO: el Excel trae otro valor (error)" : "no: el SKU no está en el Excel (aviso)",
      ]),
    ],
  };

  const avisos: HojaDelReporte = { nombre: "Avisos", etiquetas: ["Tipo", "SKU", "Detalle"], filas: filasDeAvisos };

  const sinSeccionSkus = new Set(d.carta.contenidos.filter((c) => c.codigo === "SIN_SECCION").map((c) => c.sku));
  const noSeImporta: HojaDelReporte = {
    nombre: "No se importa",
    etiquetas: ["Qué", "Por qué"],
    filas: [
      ["Nombre en la carta por local", "No existe nombre por sucursal (`ContenidoCartaProducto` no lo tiene): la carta muestra el nombre del producto. Ver la hoja «Nombre de carta por local»."],
      ["Precio por local", "Un precio por empresa (decisión del dueño del 2026-10-28): no se escribe ningún precio local."],
      ["Categoría del Excel como rubro (CategoriaProducto)", "Las categorías de producto son rubros, no secciones: la categoría solo decide la sección de carta."],
      ["Marca / bodega", "No se carga (S4)."],
      ["Ejes y variantes como opciones de venta", "Cada SKU es un producto suelto; pasar a opciones es la Etapa 2 (P2)."],
      ["Oficinas NQNTUR", "No vende: no recibe filas."],
      [`Descripciones de las filas sin sección (${d.carta.contenidos.filter((c) => c.codigo === "SIN_SECCION" && c.descripcionNoCargada).length})`, "Sus categorías no tienen sección de carta todavía (Minutas, Menú Infantil, Viandas, Confitería)."],
      ["Contenido de carta de un SKU sin precio", "Se mostraría a $0."],
    ],
  };

  const errores: HojaDelReporte = {
    nombre: "Errores",
    etiquetas: ["Hoja", "Fila", "Columna", "Valor", "SKU", "Código", "Motivo"],
    filas: d.errores.map((e) => [e.hoja, e.fila, e.columna, e.valor, e.sku, e.codigo, e.motivo]),
  };

  const pendiente: HojaDelReporte = {
    nombre: "Pendiente de completar",
    etiquetas: ["Qué", "Cuántos", "Detalle"],
    filas: [
      ["Receta", d.productos.productos.length, "Sin receta no se vende (ADR-033): los productos aparecen en el POS y en la carta pero no se pueden cobrar."],
      ["Alícuota de IVA", d.productos.productos.length, "Queda «sin declarar» (NULL): nunca se inventa."],
      ["Categoría de producto (rubro)", d.productos.productos.length, "No se carga."],
      ["Carta de los SKU sin sección", sinSeccionSkus.size, "Falta decidir dónde van Minutas, Menú Infantil, Viandas y Confitería (E3)."],
      ["Contenido de carta de los SKU sin precio", d.productos.productos.filter((p) => p.precio?.origen === "SIN_PRECIO_EN_EL_EXCEL").length, "Cuando tengan precio."],
      ["Nombre de carta por local", nombresDeCarta.filas.length, "No existe en el sistema (E3)."],
      ["Publicación en el portal por sucursal", LOCALES_DEL_IMPORTADOR.length, "Para que la carta se vea en la web (SucursalPublica publicada y módulo Carta activo)."],
    ],
  };

  return [resumen, productos, precioUnico, disponibilidad, carta, sinSeccion, nombresDeCarta, correcciones, avisos, noSeImporta, errores, pendiente];
}
