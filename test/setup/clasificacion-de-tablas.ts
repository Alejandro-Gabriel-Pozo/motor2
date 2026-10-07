/**
 * CLASIFICACIÓN DECLARADA de TODAS las tablas de `public` (Pureza, Hito 2, trabajo 2.6; Fase 0, ítem 8 del mínimo imprescindible): en lugar de contadores fijos («57 tablas», «54», «61 políticas»,
 * que cada migración obligaba a retocar a mano y que un cambio equivocado podía «arreglar» sin que nadie mirara qué tabla se había sumado), cada tabla del esquema está DECLARADA acá con su clase, y
 * los tests de estructura y de RLS (`test/persistencia/multiempresa-estructura.test.ts`, `test/aislamiento/rls-empresa.test.ts`) comparan la base real contra esta declaración. Una tabla nueva
 * (o una que cambia de clase) rompe esos tests hasta que se la declare acá, a propósito: decidir de quién es una tabla es una decisión de seguridad, no un número a ajustar.
 * `test/arquitectura/clasificacion-de-tablas.test.ts` cruza esta declaración con `prisma/schema.prisma` (sin base de datos).
 *
 * Las clases:
 *  - `POR_EMPRESA`: lleva `empresaId` NOT NULL con default `app_empresa_actual()`, RLS habilitado (sin FORCE) y UNA política `aislamiento_empresa`.
 *  - `DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA`: lleva `empresaId` pero lo escribe la plataforma indicando la empresa (sin default); tiene RLS y las políticas de `POLITICAS_ESPECIALES`.
 *  - `GLOBAL`: datos compartidos por todas las empresas (usuarios, sesiones de la persona, catálogo de acciones, cotizaciones, índices): sin RLS y sin políticas.
 *  - `EMPRESA`: la tabla de empresas misma: sin RLS ni políticas.
 *  - `CONSOLA`: la identidad y la auditoría de la consola de plataforma: RLS con UNA política `solo_plataforma` atada al rol, y sin `empresaId`.
 */
export type ClaseDeTabla = "POR_EMPRESA" | "DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA" | "GLOBAL" | "EMPRESA" | "CONSOLA";

const POR_EMPRESA = [
  "CapacidadSucursal", "CategoriaProducto", "Cliente", "ContenidoCartaProducto", "ConteoFisico", "Cuenta", "CuentaItem", "DescuentoProductoSucursal", "DestinoConsumo", "DisponibilidadProducto",
  "EjemplarTicket", "FrecuenciaConteoProducto", "GeneroCarta", "Grupo", "Insumo", "InvitacionSucursal", "ItemAgrupadoCarta", "MargenObjetivo", "Mesa", "MotivoMerma", "MovimientoStock",
  "OpcionItemAgrupadoCarta", "Operacion", "PagoConsignante", "PermisoRol", "PortalCartaEmpresa", "PrecioLocalProducto", "Presentacion", "Producto", "PromoCarta", "PromoCartaCupo",
  "PromoCartaSucursal", "PromoCuenta", "Proveedor", "ProveedorPorProducto", "RecetaIngrediente", "RecetaPaso", "RecetaPasoIngrediente", "RecetaSucursal", "RecetaVersion", "RegistroAuditoria",
  "RendimientoLocalIngrediente", "Rol", "Seccion", "SeccionCarta", "SeccionHabitualProducto", "StockMinimoProducto", "Sucursal", "SucursalPublica", "SustitutoRecetaIngrediente",
  "TemaCartaSucursal", "TraspasoSucursal", "Unidad", "UsuarioSucursal",
] as const;

/** Con `empresaId`, pero escritas por la plataforma (ModuloEmpresa, Invitacion) o con una política de lectura propia del usuario (UsuarioEmpresa): sus políticas son las de `POLITICAS_ESPECIALES`. */
const DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA = ["Invitacion", "ModuloEmpresa", "UsuarioEmpresa"] as const;

const GLOBALES = ["Account", "Accion", "CotizacionDolar", "IndicePrecio", "Session", "User", "VerificationToken"] as const;

const CONSOLA = ["AdminPlataforma", "AuditoriaPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma"] as const;

/** Las políticas de las tablas que NO tienen la política única `aislamiento_empresa` (por nombre, ordenadas). */
const POLITICAS_ESPECIALES: Readonly<Record<string, readonly string[]>> = {
  UsuarioEmpresa: ["aislamiento_empresa", "lectura_propia_usuario"],
  ModuloEmpresa: ["aislamiento_empresa", "escritura_plataforma"],
  Invitacion: ["aislamiento_empresa", "escritura_plataforma", "lectura_por_token"],
};

export const CLASIFICACION_DE_TABLAS: Readonly<Record<string, ClaseDeTabla>> = Object.freeze({
  ...Object.fromEntries(POR_EMPRESA.map((t) => [t, "POR_EMPRESA" as const])),
  ...Object.fromEntries(DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA.map((t) => [t, "DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA" as const])),
  ...Object.fromEntries(GLOBALES.map((t) => [t, "GLOBAL" as const])),
  Empresa: "EMPRESA" as const,
  ...Object.fromEntries(CONSOLA.map((t) => [t, "CONSOLA" as const])),
});

export function tablasDeClase(clase: ClaseDeTabla): string[] {
  return Object.entries(CLASIFICACION_DE_TABLAS)
    .filter(([, c]) => c === clase)
    .map(([t]) => t)
    .sort();
}

/** Las tablas que llevan `empresaId`, de cualquiera de las dos clases. */
export const TABLAS_CON_EMPRESA_ID = [...tablasDeClase("POR_EMPRESA"), ...tablasDeClase("DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA")].sort();

/** Las políticas que tiene que tener cada tabla de la base según su clase (una `aislamiento_empresa` salvo las especiales; `solo_plataforma` en la consola; ninguna en las globales y en `Empresa`). */
export function politicasEsperadas(tabla: string): readonly string[] {
  const clase = CLASIFICACION_DE_TABLAS[tabla];
  if (clase === "POR_EMPRESA") return ["aislamiento_empresa"];
  if (clase === "DE_EMPRESA_ESCRITA_POR_LA_PLATAFORMA") return POLITICAS_ESPECIALES[tabla]!;
  if (clase === "CONSOLA") return ["solo_plataforma"];
  return [];
}

/** La cantidad de políticas que tiene que haber en `public`, derivada de la declaración (no un número escrito a mano). */
export const CANTIDAD_DE_POLITICAS_ESPERADAS = Object.keys(CLASIFICACION_DE_TABLAS).reduce((n, t) => n + politicasEsperadas(t).length, 0);
