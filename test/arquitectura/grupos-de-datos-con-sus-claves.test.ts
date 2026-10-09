import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso } from "../../src/core/permisos/jerarquia";
import { CAMPOS, hallarLectores, type Hallado } from "./guardas/campos-sensibles";
import { inventariarFuente } from "./guardas/inventario";

/**
 * GT-2, el tramo «GRUPOS DE DATOS» (tanda T14 del plan de endurecimiento de seguridad; fila O.86b de `docs/pureza-integracion.md`). El otro tramo, los pares «acción equivalente», es
 * `pares-de-piso-equivalentes.test.ts` (T5).
 *
 * El problema: un mismo dato se muestra por VARIAS puertas (S-14 fue exactamente eso: «Historial de un producto» escondía el proveedor y la factura detrás de
 * `reporte_historial_importes` y «Trazabilidad por ID», su hermana, los mostraba con una clave de piso operario). GT-1 mira cada página contra el PISO del campo; este guardián mira cada
 * GRUPO DE DATOS contra SUS CLAVES: para cada grupo (proveedor y factura de una compra, precio por proveedor, costo de consignación, ficha del proveedor), la lista cerrada de las puertas que
 * lo muestran y la clave que cada una pide, en las dos direcciones:
 *  1. Las páginas (y Server Actions de lectura) que el recorrido de GT-1 (`guardas/campos-sensibles.ts`) halla pidiendo los campos del grupo son EXACTAMENTE sus `puertas` más sus
 *     `pordentro` (páginas que usan el dato para calcular y no lo dibujan, cada una con su motivo). Una puerta nueva a ese dato falla hasta que se la declare.
 *  2. Cada puerta pide de verdad (literal en su archivo) la clave que se le declara, y esa clave tiene al menos el piso de la clave PROPIA del grupo (la del dato). Una puerta con una clave
 *     distinta de la propia lleva su motivo (otra pantalla del mismo piso que lo muestra con derecho); una de clave dinámica va con `clave: null` y su motivo.
 *  3. No hay entradas de más: una puerta que ya no alcanza el dato, o un `pordentro` que ahora lo dibuja, sale de la lista.
 * Mutaciones (cada una pone un caso en rojo): bajar la clave de la ficha del proveedor a una de piso operario; quitar `comparar_precios` de la comparativa; una página nueva que muestre el
 * proveedor de una compra; bajar `reporte_historial_importes` a operario; declarar `pordentro` una página que lo dibuja.
 */
const RAIZ = join(__dirname, "../..");

interface Puerta {
  /** La clave que el archivo pide (literal) para esta puerta; `null` = dinámica (no se puede leer). */
  clave: AccionClave | null;
  /** Obligatorio si la clave no es la propia del grupo, o si es dinámica. */
  motivo?: string;
}
interface Grupo {
  dato: string;
  /** La clave PROPIA del dato: la que el dueño le asignó al dato. */
  clave: AccionClave;
  /** El alcance: los campos de GT-1 (`Modelo.campo`) que forman el grupo, y/o los archivos lectores que lo producen. */
  campos?: readonly string[];
  lectores?: readonly string[];
  /** Lectores que piden el campo pero lo usan por dentro (no llega a una pantalla como tal), con su motivo. */
  excluir?: Readonly<Record<string, string>>;
  puertas: Readonly<Record<string, Puerta>>;
  pordentro: Readonly<Record<string, string>>;
}

const APP = "src/app/(app)";
const D_B =
  "Decisión D-B del dueño (2026-10-07, S-42): el último precio de compra de la empresa a un proveedor lo ve quien compra (`proceso_compra`, piso operario) para precargar el carrito; la clave del proceso se elige en tiempo de ejecución (`ACCION_POR_PROCESO`). Se deja (decidido).";
const POR_DENTRO_DEL_PERIODO =
  "Usa el reporte del período (`obtenerReportePorPeriodo`, que arma las compras por proveedor) para sus totales y márgenes y NO dibuja ni proveedor ni factura: falso positivo del recorrido por archivos.";
const COSTEO_INTERNO = "Arma el catálogo en memoria con el consignante para COSTEAR; su pantalla no dibuja el consignante ni el costo de consignación como tal (la clave de su reporte es de piso administrador).";

const GRUPOS: Readonly<Record<string, Grupo>> = {
  "proveedor y N.º de factura de una compra": {
    dato: "Operacion.nroFactura y el proveedor de la operación (S-14)",
    clave: "reporte_historial_importes",
    campos: ["Operacion.nroFactura", "Operacion.proveedor", "Operacion.proveedorId"],
    puertas: {
      [`${APP}/reportes/historial/page.tsx`]: { clave: "reporte_historial_importes" },
      [`${APP}/reportes/compras/page.tsx`]: { clave: "reporte_compras", motivo: "«Compras registradas» ES el listado de las compras con su proveedor y su factura; es de piso administrador, igual que los datos comerciales del historial." },
      [`${APP}/reportes/devoluciones/page.tsx`]: { clave: "reporte_devoluciones", motivo: "«Devoluciones» muestra a qué proveedor se devolvió; es de piso administrador." },
      [`${APP}/reportes/periodo/page.tsx`]: { clave: "reporte_periodo", motivo: "«Período» dibuja «Compras por proveedor»; es de piso administrador." },
      [`${APP}/catalogo/proveedores/[id]/page.tsx`]: { clave: "proveedores", motivo: "La ficha del proveedor lista lo que se le compró (última oferta por producto); es de piso administrador." },
      [`${APP}/catalogo/proveedores/[id]/editar/page.tsx`]: { clave: "proveedores", motivo: "La edición de la ficha del proveedor lista lo que se le compró; es de piso administrador." },
      [`${APP}/catalogo/proveedores/comparativa/page.tsx`]: { clave: "comparar_precios", motivo: "La comparativa de precios por proveedor (D-B: `comparar_precios`, piso administrador)." },
      [`${APP}/movimientos/[proceso]/page.tsx`]: { clave: null, motivo: D_B },
    },
    pordentro: {
      [`${APP}/reportes/categorias/page.tsx`]: POR_DENTRO_DEL_PERIODO,
      [`${APP}/reportes/consolidado/page.tsx`]: POR_DENTRO_DEL_PERIODO,
      [`${APP}/reportes/page.tsx`]: POR_DENTRO_DEL_PERIODO,
      [`${APP}/reportes/ventas-por-seccion/page.tsx`]: POR_DENTRO_DEL_PERIODO,
    },
  },
  "último precio de compra por proveedor": {
    dato: "El último precio por unidad que se le pagó a cada proveedor por cada producto (ofertas del Kardex vigente; D-B, S-42)",
    clave: "comparar_precios",
    lectores: ["src/server/lecturas/catalogo/ofertas-de-proveedor.ts"],
    puertas: {
      [`${APP}/catalogo/proveedores/comparativa/page.tsx`]: { clave: "comparar_precios" },
      [`${APP}/catalogo/proveedores/[id]/page.tsx`]: { clave: "comparar_precios" },
      [`${APP}/catalogo/proveedores/[id]/editar/page.tsx`]: { clave: "proveedores", motivo: "La edición de la ficha del proveedor precarga lo que se le compró; es de piso administrador, igual que la comparativa." },
      [`${APP}/movimientos/[proceso]/page.tsx`]: { clave: null, motivo: D_B },
    },
    pordentro: {},
  },
  "ficha del proveedor (CUIT, correo, teléfono, condiciones, notas)": {
    dato: "Proveedor.{cuit,email,telefono,contacto,condicionesPago,notas} (D-4 de H8)",
    clave: "proveedores",
    campos: ["Proveedor.cuit", "Proveedor.email", "Proveedor.telefono", "Proveedor.contacto", "Proveedor.condicionesPago", "Proveedor.notas"],
    puertas: {
      [`${APP}/catalogo/proveedores/page.tsx`]: { clave: "proveedores" },
      [`${APP}/catalogo/proveedores/[id]/page.tsx`]: { clave: "proveedores" },
      [`${APP}/catalogo/proveedores/[id]/editar/page.tsx`]: { clave: "proveedores" },
      "src/server/actions/catalogo/proveedores.ts": { clave: "proveedores", motivo: "`listarProveedores` es la puerta HTTP del listado (nombre y contacto): pide `proveedores`, como su pantalla." },
    },
    pordentro: {},
  },
  "costo de consignación y consignante": {
    dato: "Producto.precioConsignacion, el consignante y lo pagado (S-12, D8)",
    clave: "pagar_consignante",
    campos: ["Producto.precioConsignacion", "Producto.proveedorConsignacionId", "Producto.proveedorConsignacion", "PagoConsignante.importe"],
    excluir: {
      "src/server/lecturas/reportes/comun.ts": COSTEO_INTERNO,
    },
    puertas: {
      [`${APP}/catalogo/productos/[id]/page.tsx`]: { clave: "pagar_consignante" },
      [`${APP}/reportes/consignacion/page.tsx`]: { clave: "pagar_consignante" },
    },
    pordentro: {},
  },
};

const rutasDeGrupo = (g: Grupo, hallados: readonly Hallado[]): { puertas: string[]; lectoresCont: string[] } => {
  const lectores = hallados.filter((h) => !(g.excluir && h.ruta in g.excluir) && ((g.lectores ?? []).includes(h.ruta) || (g.campos ?? []).some((c) => h.campos.includes(c))));
  const puertas = new Set<string>();
  for (const h of lectores) {
    for (const p of h.paginas) puertas.add(p);
    if (h.esAccionUseServer) puertas.add(h.ruta);
  }
  return { puertas: [...puertas].sort(), lectoresCont: lectores.map((h) => h.ruta) };
};

const clavesLiterales = (archivo: string): Set<string> => {
  const inv = inventariarFuente(archivo, readFileSync(join(RAIZ, archivo), "utf8"));
  return new Set([...inv.usos, ...inv.valoresDeMapa].map((u) => u.clave));
};

const { hallados } = hallarLectores(RAIZ);
const catalogo = new Map<string, NivelDeAccion>(ACCIONES.map((a) => [a.clave, a.nivelMinimo]));
const pisoDe = (k: AccionClave) => nivelMinimoDeAccion(k);

describe("GT-2 — grupos de datos con sus claves (puertas hermanas)", () => {
  it("las claves y los campos de cada grupo existen, y la clave propia es de piso administrador o más", () => {
    for (const [nombre, g] of Object.entries(GRUPOS)) {
      expect(catalogo.has(g.clave), `${nombre}: la clave propia «${g.clave}» no está en el catálogo`).toBe(true);
      expect(nivelAlcanzaElPiso(pisoDe(g.clave), "administrador"), `${nombre}: «${g.clave}» es de piso ${pisoDe(g.clave)}; un dato de dinero o de un proveedor no puede quedar al alcance de un operario`).toBe(true);
      for (const c of g.campos ?? []) expect(c in CAMPOS, `${nombre}: «${c}» no está en la lista de campos sensibles (GT-1)`).toBe(true);
      expect(g.campos?.length || g.lectores?.length, `${nombre}: sin alcance`).toBeGreaterThan(0);
      for (const [r, motivo] of Object.entries(g.excluir ?? {})) expect(motivo.length, `${nombre}: ${r}`).toBeGreaterThan(30);
    }
  });

  it.each(Object.entries(GRUPOS))("«%s»: las puertas que el recorrido halla son exactamente las declaradas (más lo que se usa por dentro)", (nombre, g) => {
    const { puertas, lectoresCont } = rutasDeGrupo(g, hallados);
    expect(lectoresCont.length, `${nombre}: ningún lector (el alcance quedó vacío)`).toBeGreaterThan(0);
    const declaradas = [...Object.keys(g.puertas), ...Object.keys(g.pordentro)].sort();
    expect(puertas, `${nombre}: una puerta nueva a este dato se declara en \`puertas\` con su clave (o en \`pordentro\` con su motivo); una que ya no lo alcanza sale de la lista`).toEqual(declaradas);
  });

  it.each(Object.entries(GRUPOS))("«%s»: cada puerta pide la clave que declara, de un piso que alcanza el de la clave propia, y cada desvío tiene su motivo", (nombre, g) => {
    for (const [archivo, puerta] of Object.entries(g.puertas)) {
      if (puerta.clave === null) {
        expect((puerta.motivo ?? "").length, `${archivo}: una clave dinámica no se compara con el piso: necesita motivo`).toBeGreaterThan(40);
        continue;
      }
      expect(clavesLiterales(archivo), `${nombre}: ${archivo} no pide «${puerta.clave}»`).toContain(puerta.clave);
      expect(nivelAlcanzaElPiso(pisoDe(puerta.clave), pisoDe(g.clave)), `${nombre}: ${archivo} pide «${puerta.clave}» (piso ${pisoDe(puerta.clave)}), por debajo de «${g.clave}» (piso ${pisoDe(g.clave)})`).toBe(true);
      if (puerta.clave !== g.clave) expect((puerta.motivo ?? "").length, `${nombre}: ${archivo} pide «${puerta.clave}» y no la propia «${g.clave}»: falta el motivo`).toBeGreaterThan(30);
    }
    for (const [archivo, motivo] of Object.entries(g.pordentro)) expect(motivo.length, `${nombre}: ${archivo}`).toBeGreaterThan(30);
  });

  it("sanidad: el alcance de cada grupo alcanza lectores y páginas (no pasa en vacío)", () => {
    for (const g of Object.values(GRUPOS)) expect(rutasDeGrupo(g, hallados).puertas.length).toBeGreaterThan(1);
  });
});
