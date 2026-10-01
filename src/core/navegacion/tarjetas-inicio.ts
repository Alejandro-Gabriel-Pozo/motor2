import type { GrupoNav } from "./estructura";

/** Una línea por módulo para la tarjeta de `/inicio`. Un test comprueba que todo grupo de `GRUPOS_NAV` tiene la suya. */
export const DESCRIPCION_DE_MODULO: Record<string, string> = {
  administracion: "Usuarios, roles, permisos, sucursales y auditoría.",
  catalogo: "Productos, proveedores, clientes, recetas, categorías y unidades.",
  carta: "La carta pública, los ítems agrupados, el portal y el tema.",
  movimientos: "Compras, producción, ventas, mermas, ajustes y conteos físicos.",
  stock: "Stock consolidado, alertas, mínimos y reclasificación.",
  reportes: "Ventas, costos, márgenes, pérdidas y control del negocio.",
  traspasos: "Pedir y enviar mercadería entre sucursales.",
  pos: "El mapa de mesas del salón.",
};

export interface TarjetaInicio {
  id: string;
  label: string;
  /** La primera pantalla del módulo que el usuario puede abrir. */
  href: string;
  descripcion: string;
}

/** Una tarjeta por módulo del menú ya filtrado por permiso (`filtrarMenuPorPermiso`): nunca hay una para un módulo sin pantallas visibles. */
export function tarjetasDeInicio(menuVisible: GrupoNav[]): TarjetaInicio[] {
  return menuVisible
    .filter((g) => g.items.length > 0)
    .map((g) => ({ id: g.id, label: g.label, href: g.items[0].href, descripcion: DESCRIPCION_DE_MODULO[g.id] ?? "" }));
}
