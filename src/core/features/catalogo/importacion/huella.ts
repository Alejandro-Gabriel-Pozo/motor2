import { createHash } from "node:crypto";
import { aCentavos } from "@/core/carta/public";
import type { EstadoDeLaBase } from "./estado";
import { VERSION_DEL_NORMALIZADOR } from "./normalizar";
import { LOCALES_DEL_IMPORTADOR, type CorreccionesDelDueno } from "./tipos";

/**
 * HUELLA de una importación (diseño §4.1 y ADENDA A.5): SHA-256 de (sha del archivo ‖ correcciones ‖ versión del normalizador ‖ estado leído de la base). Lo que el dueño vio en la vista
 * previa se confirma solo si la huella recalculada DENTRO de la transacción es la misma (I2); si algo cambió (otra persona cargó un producto, cambió una sección o un contenido), cambia la
 * huella y la confirmación responde `VERSION_DESACTUALIZADA`. Al dueño se le muestran los primeros 12 caracteres.
 *
 * Canónica: las listas se ordenan por su clave y los importes se comparan en centavos (el texto «3000» y «3000.00» de la base son el mismo dinero), así dos lecturas del mismo estado dan
 * la misma huella sin depender del orden de las filas que devuelva la base.
 */
export const LARGO_DE_LA_HUELLA_VISIBLE = 12;

/** JSON con las claves de los objetos ordenadas (lo único que hace falta para que la misma estructura dé el mismo texto). */
function canonico(valor: unknown): string {
  if (typeof valor === "bigint") return JSON.stringify(valor.toString());
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    return `{${Object.keys(valor)
      .sort()
      .filter((k) => (valor as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonico((valor as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(valor);
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");
const centavosDe = (texto: string) => (aCentavos(texto) ?? texto).toString();
const porClave = <T>(lista: readonly T[], clave: (x: T) => string) => [...lista].sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0));

/** El estado de la base en forma canónica (lo que entra en la huella). */
export function estadoCanonico(estado: EstadoDeLaBase): unknown {
  return {
    sucursales: LOCALES_DEL_IMPORTADOR.map((l) => [l, estado.sucursales[l] ?? null]),
    unidadId: estado.unidadId,
    secciones: porClave(estado.secciones, (s) => s.nombre),
    productos: porClave(estado.productos, (p) => p.codigo).map((p) => ({
      ...p,
      precioVenta: centavosDe(p.precioVenta),
      factorConversion: String(Number(p.factorConversion)),
      filasDeDisponibilidad: porClave(p.filasDeDisponibilidad, (d) => d.sucursalId),
      preciosLocales: porClave(p.preciosLocales, (d) => d.sucursalId).map((d) => ({ ...d, precio: centavosDe(d.precio) })),
      contenidos: porClave(p.contenidos, (c) => c.sucursalId),
      agrupadoEn: [...p.agrupadoEn].sort(),
    })),
  };
}

/** Huella (hex de 64) de las correcciones: entra en la huella de la importación y se muestra en la vista previa. */
export function huellaDeLasCorrecciones(correcciones: CorreccionesDelDueno): string {
  return sha256(canonico(correcciones));
}

/** La huella completa (hex de 64) de una importación. */
export function huellaDeLaImportacion(entrada: { shaDelArchivo: string; correcciones: CorreccionesDelDueno; estado: EstadoDeLaBase }): string {
  return sha256(canonico({ version: VERSION_DEL_NORMALIZADOR, archivo: entrada.shaDelArchivo, correcciones: huellaDeLasCorrecciones(entrada.correcciones), estado: estadoCanonico(entrada.estado) }));
}

/** ¿La huella que trae quien confirma (la completa o, como mínimo, los 12 caracteres que vio) es la recalculada? Sin distinguir mayúsculas. */
export function coincideLaHuella(vista: string, recalculada: string): boolean {
  const v = vista.trim().toLowerCase();
  return /^[0-9a-f]+$/.test(v) && v.length >= LARGO_DE_LA_HUELLA_VISIBLE && v.length <= recalculada.length && recalculada.startsWith(v);
}
