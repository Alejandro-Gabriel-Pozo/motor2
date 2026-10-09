import type { PuertaInventariada } from "./inventario-de-puertas";

/**
 * Las FAMILIAS de la matriz de denegación por defecto (GT-3b): cada archivo `test/aislamiento/denegacion-por-defecto-<familia>.test.ts` ejerce una, para que ninguno corra demasiado ni deje la base sucia.
 * Las familias PARTICIONAN el inventario: toda puerta cae en exactamente una (lo verifica `denegacion-por-defecto.test.ts`). Una carpeta nueva de acciones, consultas o lecturas que no entre en ninguna
 * deja la cobertura en rojo hasta que se le asigne familia (falla cerrado).
 */
export interface Familia {
  nombre: string;
  filtro: (p: PuertaInventariada) => boolean;
}

export const FAMILIAS = {
  gobierno: { nombre: "gobierno (auth, permisos, clientes)", filtro: (p) => p.tipo === "accion" && /^actions\/(auth|permisos|clientes)\//.test(p.archivo) },
  catalogo: { nombre: "catálogo", filtro: (p) => p.tipo === "accion" && p.archivo.startsWith("actions/catalogo/") },
  carta: { nombre: "carta", filtro: (p) => p.tipo === "accion" && p.archivo.startsWith("actions/carta/") },
  stock: { nombre: "stock y movimientos", filtro: (p) => p.tipo === "accion" && /^actions\/(movimientos|stock|traspasos|reportes)\//.test(p.archivo) },
  pos: { nombre: "POS", filtro: (p) => p.tipo === "accion" && p.archivo.startsWith("actions/pos/") },
  consultas: { nombre: "consultas de las páginas", filtro: (p) => p.tipo === "consulta" },
  lecturas: { nombre: "lecturas de los casos de uso", filtro: (p) => p.tipo === "lectura" },
} as const satisfies Record<string, Familia>;
