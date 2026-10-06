// Catálogo de módulos (ADR-011, corregido por ADR-014 y ADR-015). Qué módulos existen y de qué dependen es CÓDIGO versionado con la
// aplicación; la tabla del registro (bloque 5A, paso P4) solo dirá cuáles tiene cada empresa.
//
// Tres tipos: `fijo` (Administración: nunca se registra ni se apaga), `soporte` (se CALCULAN como clausura por `requiere` de los vendibles
// activos, sin filas) y `vendible` (único tipo que se activa o desactiva por empresa). «Requiere» es dura; «usa si existe» es blanda.

export type TipoDeModulo = "fijo" | "soporte" | "vendible";

/** `en_desarrollo`: aparece como «Próximamente» y no se puede activar ni entrar (ADR-011 §6). */
export type EstadoDeDesarrollo = "disponible" | "en_desarrollo";

export interface ModuloDef {
  id: string;
  nombre: string;
  tipo: TipoDeModulo;
  estado: EstadoDeDesarrollo;
  requiere: readonly string[];
  usaSiExiste: readonly string[];
}

export const MODULOS = [
  { id: "administracion", nombre: "Administración", tipo: "fijo", estado: "disponible", requiere: [], usaSiExiste: [] },
  { id: "catalogo_basico", nombre: "Catálogo básico", tipo: "soporte", estado: "disponible", requiere: [], usaSiExiste: [] },
  { id: "proveedores_basico", nombre: "Proveedores básico", tipo: "soporte", estado: "disponible", requiere: [], usaSiExiste: [] },
  { id: "clientes_basico", nombre: "Clientes básico", tipo: "soporte", estado: "disponible", requiere: [], usaSiExiste: [] },
  { id: "stock", nombre: "Stock", tipo: "vendible", estado: "disponible", requiere: ["catalogo_basico"], usaSiExiste: [] },
  { id: "compras", nombre: "Compras", tipo: "vendible", estado: "disponible", requiere: ["proveedores_basico", "stock"], usaSiExiste: [] },
  { id: "traspasos", nombre: "Traspasos", tipo: "vendible", estado: "disponible", requiere: ["stock"], usaSiExiste: [] },
  { id: "consignacion", nombre: "Consignación", tipo: "vendible", estado: "disponible", requiere: ["proveedores_basico", "stock"], usaSiExiste: ["salon"] },
  { id: "recetas", nombre: "Recetas", tipo: "vendible", estado: "disponible", requiere: ["catalogo_basico"], usaSiExiste: ["stock", "carta"] },
  { id: "produccion", nombre: "Producción", tipo: "vendible", estado: "disponible", requiere: ["stock", "recetas"], usaSiExiste: [] },
  { id: "carta", nombre: "Carta", tipo: "vendible", estado: "disponible", requiere: ["catalogo_basico"], usaSiExiste: ["salon"] },
  { id: "promociones", nombre: "Promociones", tipo: "vendible", estado: "disponible", requiere: ["carta"], usaSiExiste: ["salon"] },
  { id: "salon", nombre: "Salón", tipo: "vendible", estado: "disponible", requiere: ["stock", "clientes_basico"], usaSiExiste: ["carta", "promociones"] },
] as const satisfies readonly ModuloDef[];

export type ModuloId = (typeof MODULOS)[number]["id"];

/** La definición de un módulo del catálogo vigente. Explota si el id no existe: un id desconocido es un bug, no un caso. */
export function moduloDelCatalogo(id: ModuloId): ModuloDef {
  const modulo = MODULOS.find((m) => m.id === id);
  if (!modulo) throw new Error(`Módulo desconocido: ${id}`);
  return modulo;
}

export function esModuloDelCatalogo(id: string): id is ModuloId {
  return MODULOS.some((m) => m.id === id);
}
