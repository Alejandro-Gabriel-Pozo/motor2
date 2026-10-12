/**
 * Aviso C25 «posible factura repetida» al registrar una compra: TODA la empresa, ±7 días, mismo proveedor e importe. Nombra la sucursal y, SOLO para las compras de sucursales que quien carga puede ver, la fecha (nunca el N.º de factura ni el importe: `Operacion.nroFactura` exige piso
 * administrador y quien carga la compra puede ser operario). De una compra de una sucursal que NO puede ver dice solo «en la sucursal X» (el nombre es un dato público, sin día): la verificación abarca toda la empresa pero no muestra datos de otra sucursal (P2, decisión del dueño).
 * NO bloquea (la factura duplicada de verdad —mismo proveedor y mismo N.º en la sucursal— la frena el índice único; esto es solo una pista para quien carga).
 * Módulo PURO (P0): sin reloj, zona horaria ni base. El DÍA de cada compra lo calcula quien lee la base («AAAA-MM-DD»; la fecha de compra es el mediodía argentino
 * del día elegido, P1, y se lee en hora argentina) y acá se compara como TEXTO. Qué sucursales puede ver quien carga también lo decide quien llama (el gate): acá llega como un conjunto de ids.
 */
import { redondearMoneda } from "@/core/moneda";
import { sumarDias } from "@/core/tiempo/zona-horaria";

/** Días de cada lado del día de la compra nueva en los que otra compra igual se considera posible repetición (ventana inclusiva). */
export const DIAS_DE_VENTANA_DE_DUPLICADO = 7;

/** Cuántas compras se nombran en el aviso; el resto se resume como «y N más». */
const MAXIMO_DE_COMPRAS_NOMBRADAS = 3;

export interface CompraCandidata {
  id: string;
  proveedorId: string | null;
  sucursalId: string;
  sucursalNombre: string;
  /** «AAAA-MM-DD». */
  dia: string;
  importe: number;
  anulado: boolean;
}

export interface CompraNueva {
  proveedorId: string;
  /** «AAAA-MM-DD». */
  dia: string;
  importe: number;
  /** Si la compra ya existe (p. ej. al corregirla), su id: no se compara contra sí misma. */
  excluirId?: string;
}

const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Las compras vigentes de otro lado de la empresa que parecen la misma factura, ordenadas por día descendente y después por id. Importe 0 (o negativo o
 * no numérico) nunca avisa: una compra sin precio no es comparable. El importe se compara redondeado a centavos (0,1 + 0,2 es 0,3).
 */
export function posiblesDuplicados(nuevo: CompraNueva, candidatos: readonly CompraCandidata[]): CompraCandidata[] {
  if (!(nuevo.importe > 0)) return [];
  const importe = redondearMoneda(nuevo.importe);
  const desde = sumarDias(nuevo.dia, -DIAS_DE_VENTANA_DE_DUPLICADO);
  const hasta = sumarDias(nuevo.dia, DIAS_DE_VENTANA_DE_DUPLICADO);
  return candidatos
    .filter(
      (c) =>
        !c.anulado &&
        c.id !== nuevo.excluirId &&
        c.proveedorId === nuevo.proveedorId &&
        redondearMoneda(c.importe) === importe &&
        desde <= c.dia &&
        c.dia <= hasta,
    )
    .sort((a, b) => comparar(b.dia, a.dia) || comparar(a.id, b.id));
}

/** «AAAA-MM-DD» → «DD/MM/AAAA». */
const diaLegible = (dia: string): string => dia.split("-").reverse().join("/");

function describir(c: CompraCandidata, sucursalActualId: string, sucursalesVisibles: ReadonlySet<string>): string {
  if (c.sucursalId === sucursalActualId) return `en esta sucursal el ${diaLegible(c.dia)}`;
  // Una sucursal que quien carga no ve: solo su nombre, sin el día (no se muestran datos de otra sucursal).
  return sucursalesVisibles.has(c.sucursalId) ? `en la sucursal ${c.sucursalNombre} el ${diaLegible(c.dia)}` : `en la sucursal ${c.sucursalNombre}`;
}

/**
 * El texto del aviso para las compras que devolvió `posiblesDuplicados` (en ese orden), o «» si no hay ninguna. No repite el importe ni el N.º de factura. `sucursalesVisibles`: los ids de las sucursales donde quien carga
 * puede ver las compras (la activa siempre cuenta); el día solo se nombra para esas, y es OBLIGATORIO para que ninguna llamada dé el día de una sucursal ajena por omisión.
 */
export function avisoDePosibleDuplicado(encontrados: readonly CompraCandidata[], sucursalActualId: string, sucursalesVisibles: ReadonlySet<string>): string {
  if (encontrados.length === 0) return "";
  const nombradas = encontrados.slice(0, MAXIMO_DE_COMPRAS_NOMBRADAS).map((c) => describir(c, sucursalActualId, sucursalesVisibles));
  const resto = encontrados.length - nombradas.length;
  const cuantas = encontrados.length === 1 ? "una compra" : `${encontrados.length} compras`;
  return `Posible factura repetida: ya hay ${cuantas} de este proveedor por el mismo importe (±${DIAS_DE_VENTANA_DE_DUPLICADO} días): ${nombradas.join("; ")}${resto > 0 ? ` y ${resto} más` : ""}. Revisá que no la estés cargando dos veces.`;
}
