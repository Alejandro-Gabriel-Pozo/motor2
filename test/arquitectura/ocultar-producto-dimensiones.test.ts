import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { OPERACIONES_DE_ADMINISTRACION, OPERACIONES_DE_PRODUCTO } from "@/core/catalogo/ocultar-producto";

/**
 * GUARDIÁN DE DIMENSIONES de «Ocultar» (docs/diseno-ocultar-como-pedernal-2026-11-15.md §10.2, regla de combinaciones del 2026-10-28).
 * Falla si aparece una dimensión NUEVA sin declarar si afecta o no, en tres lugares:
 *  (a) una clave nueva en la entrada de `decidirSobreProducto` (`HechosDelProducto`, o los campos extra de las operaciones de
 *      administración) o un valor nuevo de operación (D6);
 *  (b) una columna o relación nueva en `DisponibilidadProducto` (Desactivar) o en `OcultamientoProducto` (Ocultar, cuando exista);
 *  (c) un archivo de `src/` que lee la disponibilidad (`productoDisponibleEn`, `whereDisponibleEn`, `resolverDisponibilidad`…) y no figura
 *      en la tabla de §8.5.
 * Cada declaración lleva su motivo. Declarar «afecta: false» sin motivo no pasa.
 *
 * LÍMITES (alarma para errores honestos, no un límite de seguridad): (a) lee el TEXTO del núcleo, no los tipos de TypeScript; (c) solo ve
 * los nombres de lectura de la lista de abajo: un lector que arme el filtro a mano con otro nombre lo caza `disponibilidad-en-un-solo-lugar.test.ts`.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

interface Declaracion {
  afecta: boolean | "a_decidir";
  motivo: string;
}

/** (a) Claves de la entrada del núcleo. */
const CLAVES_DE_ENTRADA: Record<string, Declaracion> = {
  desactivar: { afecta: true, motivo: "D1: la marca de Desactivar (activo / desactivado); cambia qué aparece y qué se permite." },
  ocultar: { afecta: true, motivo: "D2: las marcas de Ocultar (empresa y local); cambia qué aparece y qué suma existencia." },
  saldo: { afecta: true, motivo: "D3: el saldo final de la operación; decide ocultar, desactivar, entrada que suma y anular." },
  conteoSinResolver: { afecta: false, motivo: "D4: no cambia nada todavía (diseño §4.6 y decisión técnica 9: no se implementa hasta verificar EstadoConteo.PENDIENTE); el test de D4 lo fija." },
  enRecetaVigente: { afecta: true, motivo: "D5: solo Desactivar mira la receta vigente (R-16); Ocultar no (R-17)." },
  hechos: { afecta: true, motivo: "el contenedor de D1 a D5." },
  operacion: { afecta: true, motivo: "D6: la operación." },
  quien: { afecta: true, motivo: "D7: quién pide (permiso y alcance de las operaciones de administración)." },
  alcance: { afecta: true, motivo: "alcance de ocultar / mostrar (local o empresa); decide el permiso (O-10) y «la empresa lo oculta»." },
};

/** (a) Operaciones (D6): cada una declarada. */
const OPERACIONES_DECLARADAS: Record<string, Declaracion> = Object.fromEntries(
  [...OPERACIONES_DE_PRODUCTO, ...OPERACIONES_DE_ADMINISTRACION].map((o) => [o, { afecta: true, motivo: "recorrida por el oráculo (test/catalogo/ocultar-producto-oraculo.ts)." } as Declaracion]),
);

/** (b) Columnas de los modelos de las dos marcas. */
const COLUMNAS: Record<string, Record<string, Declaracion>> = {
  DisponibilidadProducto: {
    id: { afecta: false, motivo: "identidad de la fila." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    sucursalId: { afecta: true, motivo: "el alcance de Desactivar (por sucursal)." },
    sucursal: { afecta: false, motivo: "relación de sucursalId." },
    productoId: { afecta: false, motivo: "a qué producto." },
    producto: { afecta: false, motivo: "relación de productoId." },
    disponible: { afecta: true, motivo: "D1: Desactivar." },
  },
  OcultamientoProducto: {
    id: { afecta: false, motivo: "identidad de la fila (la manda la aplicación: idempotencia del alta)." },
    empresaId: { afecta: false, motivo: "aislamiento por empresa." },
    empresa: { afecta: false, motivo: "relación de empresaId." },
    productoId: { afecta: false, motivo: "a qué producto." },
    producto: { afecta: false, motivo: "relación de productoId." },
    sucursalId: { afecta: true, motivo: "D2: el alcance de Ocultar (nulo = toda la empresa; con valor = esa sucursal)." },
    sucursal: { afecta: false, motivo: "relación de sucursalId." },
    oculto: { afecta: true, motivo: "D2: la marca de Ocultar (sin fila = visible)." },
    actualizadoPorId: { afecta: false, motivo: "trazabilidad: quién cambió el estado por última vez." },
    actualizadoPor: { afecta: false, motivo: "relación de actualizadoPorId." },
    actualizadoEn: { afecta: false, motivo: "trazabilidad: cuándo cambió el estado por última vez." },
    version: { afecta: false, motivo: "control de versión (optimistic locking) de la acción de ocultar; no cambia qué se ve ni qué opera." },
    creadoEn: { afecta: false, motivo: "trazabilidad: cuándo se creó la fila." },
  },
};

/** (c) Lectores de la disponibilidad, según la tabla de §8.5 del diseño. */
const LECTORES: Record<string, Declaracion> = {
  "src/server/lecturas/carta/menu.ts": { afecta: true, motivo: "§8.5: carta pública; E4 agrega `whereNoOcultoEn`." },
  "src/server/lecturas/pos/selector-carta.ts": { afecta: true, motivo: "§8.5: selector del salón y buscador del POS; E4." },
  "src/server/actions/pos/casos-de-uso/agregar-items.ts": { afecta: true, motivo: "§8.5: línea nueva en salón, cuenta y mostrador-cuenta; E4." },
  "src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts": { afecta: true, motivo: "§8.5 y decisión técnica 6: venta directa nueva sí; cierre de una cuenta con lo ya cargado no (hay que separar los dos usos); E4." },
  "src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico.ts": { afecta: true, motivo: "§8.5: contar un oculto se rechaza; E5." },
  "src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts": { afecta: true, motivo: "§8.5: movimientos que suman existencia; E5." },
  "src/server/actions/stock/casos-de-uso/reclasificar-stock.ts": { afecta: true, motivo: "§8.5: suma existencia al destino; E5." },
  "src/server/actions/traspasos/casos-de-uso/producto-transferible.ts": { afecta: true, motivo: "§8.5: traspaso entrante suma existencia; E5." },
  "src/server/actions/movimientos/casos-de-uso/aceptar-propuesta-de-factura.ts": { afecta: true, motivo: "§8.5: la compra suma existencia; E5." },
  "src/server/actions/movimientos/casos-de-uso/confirmar-recepcion-de-factura.ts": { afecta: true, motivo: "§8.5: confirmar la recepción de una compra pendiente suma existencia (igual que aceptar una propuesta); un producto oculto no entra: «no está disponible en …». Compras N3-a." },
  "src/server/consultas/stock/consolidado.ts": { afecta: false, motivo: "§8.5 «No cambian»: consolidado." },
  "src/server/consultas/reportes/valuacion.ts": { afecta: false, motivo: "§8.5 «No cambian»: valuación." },
  "src/server/consultas/reportes/rendimiento-recetas.ts": { afecta: false, motivo: "§8.5 «No cambian»: rendimiento de recetas." },
  "src/server/lecturas/catalogo/ofertas-de-proveedor.ts": { afecta: false, motivo: "§8.5 «No cambian»: ofertas de proveedor." },
  "src/server/actions/catalogo/casos-de-uso/actualizar-disponibilidad-producto.ts": { afecta: false, motivo: "es Desactivar mismo (I-14: no cambia salvo el nombre visible)." },
  "src/server/lecturas/catalogo/dependencias-para-desactivar.ts": { afecta: false, motivo: "regla de Desactivar (R-16): receta y saldo; no cambia." },
  "src/server/lecturas/catalogo/disponibilidad.ts": { afecta: false, motivo: "lector de la fila de Desactivar; no cambia (I-1)." },
  "src/core/carta/armar-menu.ts": { afecta: "a_decidir", motivo: "arma el menú de la carta con la disponibilidad: lo decide E4 junto con `menu.ts` (§8.5 no lo lista)." },
  "src/server/actions/catalogo/productos.ts": { afecta: "a_decidir", motivo: "lista de productos con «disponible acá»; el diseño dice que no se agrega filtro de ocultos (nivel 9); confirmar en E3." },
  "src/server/consultas/carta/admin.ts": { afecta: "a_decidir", motivo: "administración de la carta; §8.5 no lo lista: decidir en E4." },
  "src/server/consultas/carta/mantenimiento.ts": { afecta: "a_decidir", motivo: "«Sin stock hoy» sigue con Desactivar (O-12); decidir en E4 si debe mostrar los ocultos." },
  "src/server/consultas/catalogo/opciones-por-sucursal.ts": { afecta: "a_decidir", motivo: "opciones por sucursal; §8.5 no lo lista: decidir en E4." },
  "src/server/lecturas/catalogo/filtros-de-productos.ts": { afecta: "a_decidir", motivo: "estado de la lista (Activo / Desactivado); el filtro de ocultos no se pidió (nivel 9): confirmar en E3." },
  "src/server/consultas/carta/reparto-de-las-promos.ts": { afecta: true, motivo: "«Reparto del precio» de la administración de promos (Frente 6): elige el primer producto DISPONIBLE de cada parte con la regla del POS (`cargarSelectorCartaPos`: `whereDisponibleEn` + `whereNoOcultoEn`, y `cargarEntradasDePromoParaVender`), así que un producto oculto en la sucursal no es el ejemplo del reparto." },
  "src/server/lecturas/pos/entradas-de-promo-para-vender.ts": { afecta: "a_decidir", motivo: "entradas de promo en el POS: probable E4 (línea nueva); §8.5 no lo lista." },
  "src/core/reportes/comun.ts": { afecta: false, motivo: "§8.5 «No cambian»: reportes (filtro «disponible en la sucursal»)." },
  "src/server/lecturas/reportes/comun.ts": { afecta: false, motivo: "§8.5 «No cambian»: reportes." },
  "src/server/consultas/reportes/resumen-consolidado.ts": { afecta: false, motivo: "§8.5 «No cambian»: consolidado." },
  "src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto.ts": { afecta: false, motivo: "el alta marca el producto como disponible en las sucursales elegidas (Desactivar); un producto nuevo nace visible (I-2)." },
  "src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto-rapido.ts": { afecta: false, motivo: "ídem alta: fija Desactivar; no toca Ocultar (I-1)." },
  "src/server/actions/catalogo/unidades.ts": { afecta: false, motivo: "cambio de unidad: usa la disponibilidad para ubicar sucursales con el producto; Ocultar no cambia (§4.5)." },
  "src/server/lecturas/catalogo/datos-de-producto.ts": { afecta: false, motivo: "lectura de la ficha del producto: muestra Desactivar; la columna «Oculto» la suma E3 sin cambiar este filtro." },
  "src/server/lecturas/catalogo/unidad-de-insumo.ts": { afecta: false, motivo: "unidad de insumo: Ocultar no mira recetas ni insumos (R-17, §4.5)." },
  "src/server/consultas/catalogo/disponibilidad.ts": { afecta: false, motivo: "lector de la fila de Desactivar para la ficha; no cambia (I-1)." },
  "src/server/consultas/catalogo/limpieza-de-opciones.ts": { afecta: false, motivo: "limpieza de opciones: Ocultar no es de opciones (diseño nivel 1, fuera de alcance)." },
  "src/server/consultas/catalogo/recetas.ts": { afecta: false, motivo: "editor de recetas: Ocultar no mira recetas (R-17)." },
  "src/server/persistencia/catalogo/cargar-datos-para-validar-receta.ts": { afecta: false, motivo: "valida recetas contra Desactivar; Ocultar no mira recetas (R-17)." },
  "src/server/consultas/movimientos/stock-para-conteo.ts": { afecta: true, motivo: "§8.5 Conteos: la lista de qué contar no debe ofrecer un oculto; E5." },
  "src/server/lecturas/movimientos/saldos.ts": { afecta: "a_decidir", motivo: "saldos por sucursal; §8.5 no lo lista: decidir en E5." },
  "src/server/persistencia/movimientos/cargar-origen-de-venta.ts": { afecta: "a_decidir", motivo: "origen de stock de una venta; §8.5 no lo lista: decidir en E4." },
};

const LECTURA = /\b(productoDisponibleEn|whereDisponibleEn|whereDisponibleEnAlguna|disponibilidadDeProductos|disponibilidadDeProductosEnSucursales|disponibilidadEnAlgunaSucursal|resolverDisponibilidad|resolverDisponibilidadPorSucursal)\b/;
const NO_ES_LECTOR = new Set(["src/core/catalogo/disponibilidad-producto.ts", "src/core/catalogo/disponibilidad-producto-consulta.ts", "src/core/catalogo/public.ts"]);

function archivosDeSrc(dir: string, acumulado: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosDeSrc(ruta, acumulado);
    else if (/\.(ts|tsx)$/.test(nombre)) acumulado.push(relative(RAIZ, ruta));
  }
  return acumulado;
}

function camposDelModelo(nombre: string): string[] | null {
  const m = new RegExp(`^model ${nombre} \\{([\\s\\S]*?)^\\}`, "m").exec(leer("prisma/schema.prisma"));
  if (!m) return null;
  return m[1]!.split("\n").map((l) => /^\s{2}([A-Za-z]\w*)\s/.exec(l)?.[1]).filter((c): c is string => !!c);
}

const conMotivo = (d: Declaracion) => d.motivo.trim().length >= 8;

describe("guardián de dimensiones de Ocultar (regla de combinaciones, 2026-10-28)", () => {
  it("(a) cada clave de la entrada del núcleo está declarada, y toda declaración tiene motivo", () => {
    const fuente = leer("src/core/catalogo/ocultar-producto.ts");
    const hechos = /export interface HechosDelProducto \{([\s\S]*?)\n\}/.exec(fuente)?.[1] ?? "";
    const entrada = /export type EntradaDeDecision =([\s\S]*?)\n\n/.exec(fuente)?.[1] ?? "";
    const claves = new Set([...hechos.matchAll(/readonly (\w+):/g), ...entrada.matchAll(/readonly (\w+):/g)].map((m) => m[1]!));
    expect(claves.size, "no se pudieron leer las claves del núcleo: ¿cambió la forma del archivo?").toBeGreaterThan(5);
    const sinDeclarar = [...claves].filter((c) => !(c in CLAVES_DE_ENTRADA));
    expect(sinDeclarar, `dimensión nueva sin declarar si afecta o no: ${sinDeclarar.join(", ")} (agregala a CLAVES_DE_ENTRADA con su motivo y a la tabla del oráculo)`).toEqual([]);
    const sobrantes = Object.keys(CLAVES_DE_ENTRADA).filter((c) => !claves.has(c));
    expect(sobrantes, "declarada pero ya no existe en el núcleo").toEqual([]);
    for (const d of [...Object.values(CLAVES_DE_ENTRADA), ...Object.values(OPERACIONES_DECLARADAS)]) expect(conMotivo(d)).toBe(true);
  });

  it("(a) las operaciones del núcleo son exactamente las declaradas (D6)", () => {
    expect([...OPERACIONES_DE_PRODUCTO, ...OPERACIONES_DE_ADMINISTRACION].sort()).toEqual(Object.keys(OPERACIONES_DECLARADAS).sort());
  });

  it("(b) cada columna de DisponibilidadProducto (y de OcultamientoProducto, si existe) está declarada", () => {
    for (const modelo of ["DisponibilidadProducto", "OcultamientoProducto"]) {
      const campos = camposDelModelo(modelo);
      if (campos === null) {
        expect(modelo, "el único modelo que puede faltar es el de Ocultar, que llega con E3").toBe("OcultamientoProducto");
        continue;
      }
      const declaradas = COLUMNAS[modelo];
      expect(declaradas, `el modelo ${modelo} existe pero no tiene sus columnas declaradas en COLUMNAS (E3 debe declararlas)`).toBeDefined();
      const sinDeclarar = campos.filter((c) => !(c in declaradas!));
      expect(sinDeclarar, `columna nueva de ${modelo} sin declarar si afecta o no: ${sinDeclarar.join(", ")}`).toEqual([]);
      const sobrantes = Object.keys(declaradas!).filter((c) => !campos.includes(c));
      expect(sobrantes, `declarada pero ya no existe en ${modelo}`).toEqual([]);
      for (const d of Object.values(declaradas!)) expect(conMotivo(d)).toBe(true);
    }
  });

  it("(c) todo archivo de src/ que lee la disponibilidad figura en la tabla de lectores, y no sobra ninguno", () => {
    const lectores = archivosDeSrc(join(RAIZ, "src")).filter((f) => !NO_ES_LECTOR.has(f) && LECTURA.test(leer(f)));
    const sinDeclarar = lectores.filter((f) => !(f in LECTORES));
    expect(sinDeclarar, `lector nuevo de la disponibilidad sin declarar si Ocultar lo afecta: ${sinDeclarar.join(", ")} (agregalo a LECTORES con su motivo, ver §8.5)`).toEqual([]);
    const sobrantes = Object.keys(LECTORES).filter((f) => !lectores.includes(f));
    expect(sobrantes, "declarado pero ya no lee la disponibilidad: sacalo de LECTORES").toEqual([]);
    for (const d of Object.values(LECTORES)) expect(conMotivo(d)).toBe(true);
  });
});
