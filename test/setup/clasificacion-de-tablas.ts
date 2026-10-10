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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Las FK entre tablas POR EMPRESA que declara el esquema de Prisma (`@relation(fields: [...])` de un modelo por empresa hacia otro modelo por empresa): origen, destino y columnas (ordenadas). Es la
 * lista que la base tiene que reproducir (`multiempresa-estructura.test.ts`): derivarla del esquema reemplaza al contador fijo «105» y ADEMÁS detecta que una migración QUITE una FK compuesta
 * (con el contador solo se veía el total; con esta lista, cuál faltó o sobró).
 */
export function fkEntreTablasPorEmpresaDelEsquema(): { origen: string; destino: string; columnas: string[] }[] {
  const esquema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const porEmpresa = new Set(tablasDeClase("POR_EMPRESA"));
  const fks: { origen: string; destino: string; columnas: string[] }[] = [];
  for (const [, modelo, cuerpo] of esquema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (!porEmpresa.has(modelo)) continue;
    for (const linea of cuerpo.split(/\r?\n/)) {
      const relacion = /@relation\((?:"[^"]*",\s*)?fields:\s*\[([^\]]*)\]/.exec(linea);
      const destino = linea.trim().split(/\s+/)[1]?.replace("?", "").replace("[]", "");
      if (relacion && destino && porEmpresa.has(destino)) fks.push({ origen: modelo, destino, columnas: relacion[1].split(",").map((c) => c.trim()).sort() });
    }
  }
  return fks;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// SEGUNDA DIMENSIÓN: el ALCANCE POR SUCURSAL (M.3, Fase A, paso A1; plan `_planes/plan-m3-rls-por-sucursal-2026-10-10.md` §2).
//
// La primera dimensión (arriba) dice de qué EMPRESA es una tabla. Esta dice de qué SUCURSAL son sus filas, y de ahí se DERIVAN las políticas de RLS por sucursal
// (`test/setup/politicas-de-alcance-de-sucursal.ts`): es la única fuente de verdad, nadie escribe a mano una política por tabla. Es una capacidad general («alcance por sucursal»),
// válida para cualquier rubro: no depende de qué vende ni de qué guarda cada tabla.
// `test/arquitectura/alcance-de-sucursal.test.ts` cruza esta declaración con `prisma/schema.prisma` y con la primera dimensión, sin base de datos.
//
// Los alcances:
//  - `PROPIA`: `sucursalId` NOT NULL. Una fila es de UNA sucursal y solo se ve/escribe con esa sucursal en el alcance de la transacción.
//  - `PROPIA_O_EMPRESA`: `sucursalId` NULLABLE. NULL = la fila es de la empresa entera (receta central, auditoría de empresa) y se ve desde cualquier sucursal con alcance; con valor, es como PROPIA.
//  - `HEREDADA`: no tiene `sucursalId`; su sucursal sale de una FK obligatoria hacia un padre que sí tiene alcance (`padre` + `columna`; el padre puede ser a su vez HEREDADA).
//  - `ENTRE_SUCURSALES`: la fila liga dos sucursales (`columnaOrigen`, `columnaDestino`, ambas NOT NULL) y es de las dos: se ve y se escribe desde cualquiera de ellas.
//  - `GOBIERNO`: lleva `sucursalId` o es la tabla de sucursales misma, pero se LEE para decidir el acceso (membresías, capacidades, invitaciones, slug público), o sea antes de que exista un
//    alcance. Queda fuera de la RLS por sucursal y se protege con la RLS por empresa y con el gate. Cada una lleva su `motivo`.
//  - `DE_EMPRESA`: tiene `empresaId` y ninguna noción de sucursal (catálogo, proveedores, roles, ...): fuera de la RLS por sucursal.
//  - `SIN_EMPRESA`: sin `empresaId` (globales, `Empresa`, consola): fuera de la RLS por sucursal. Tiene que coincidir con las clases GLOBAL, EMPRESA y CONSOLA de la primera dimensión.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export type AlcanceDeSucursal = "PROPIA" | "PROPIA_O_EMPRESA" | "HEREDADA" | "ENTRE_SUCURSALES" | "GOBIERNO" | "DE_EMPRESA" | "SIN_EMPRESA";

export type DeclaracionDeAlcance =
  | { readonly alcance: "PROPIA" | "PROPIA_O_EMPRESA" | "DE_EMPRESA" | "SIN_EMPRESA" }
  | { readonly alcance: "HEREDADA"; readonly padre: string; readonly columna: string }
  | { readonly alcance: "ENTRE_SUCURSALES"; readonly columnaOrigen: string; readonly columnaDestino: string }
  | { readonly alcance: "GOBIERNO"; readonly motivo: string };

/** `sucursalId` NOT NULL con FK a `Sucursal`: la fila es de una sola sucursal. */
const ALCANCE_PROPIA = [
  "ConteoFisico", "ContenidoCartaProducto", "DescuentoProductoSucursal", "DisponibilidadProducto", "EjemplarTicket", "FrecuenciaConteoProducto", "GeneroCarta", "ItemAgrupadoCarta", "Mesa",
  "Operacion", "OpcionItemAgrupadoCarta", "PagoConsignante", "PrecioLocalProducto", "PromoCartaSucursal", "RecetaSucursal", "RendimientoLocalIngrediente", "Seccion", "SeccionHabitualProducto",
  "StockMinimoProducto", "TemaCartaSucursal",
] as const;

/** `sucursalId` NULLABLE: NULL = de la empresa entera. */
const ALCANCE_PROPIA_O_EMPRESA = ["RecetaVersion", "RegistroAuditoria"] as const;

/** Sin `sucursalId`: la sucursal sale de la FK obligatoria `columna` hacia `padre`. */
const ALCANCE_HEREDADA: Readonly<Record<string, { padre: string; columna: string }>> = {
  Cuenta: { padre: "Mesa", columna: "mesaId" },
  CuentaItem: { padre: "Cuenta", columna: "cuentaId" },
  MovimientoStock: { padre: "Seccion", columna: "seccionId" },
  PromoCuenta: { padre: "Cuenta", columna: "cuentaId" },
  RecetaIngrediente: { padre: "RecetaVersion", columna: "recetaVersionId" },
  RecetaPaso: { padre: "RecetaVersion", columna: "recetaVersionId" },
  RecetaPasoIngrediente: { padre: "RecetaPaso", columna: "recetaPasoId" },
  SustitutoRecetaIngrediente: { padre: "RecetaIngrediente", columna: "recetaIngredienteId" },
};

/** Fila de dos sucursales: visible y escribible desde cualquiera de las dos puntas. */
const ALCANCE_ENTRE_SUCURSALES: Readonly<Record<string, { columnaOrigen: string; columnaDestino: string }>> = {
  TraspasoSucursal: { columnaOrigen: "origenSucursalId", columnaDestino: "destinoSucursalId" },
};

/** Fuera de la RLS por sucursal porque se LEEN antes de tener alcance (login, elegir empresa, aceptar invitación, carta pública, gate). Cada una con su motivo. */
const ALCANCE_GOBIERNO: Readonly<Record<string, string>> = {
  Sucursal: "La tabla de sucursales misma: el login, el contexto y el gate la leen para decidir en qué sucursal se está, así que no puede depender del alcance que ellos mismos calculan.",
  UsuarioSucursal: "Las membresías DEFINEN el alcance: el login, elegir empresa y el contexto las leen (con la base de la empresa y sin alcance) para calcularlo; filtrarlas por alcance sería circular.",
  CapacidadSucursal: "La lee el gate para decidir el permiso (fila por defecto con `sucursalId` NULL más una por sucursal) antes de que haya alcance; la autoridad fina por clave sigue en el gate.",
  InvitacionSucursal: "La lee la aceptación de invitaciones (lectura previa al contexto, con la base de la empresa y sin alcance) y la escribe el alta de gobierno para sucursales que el actor no tiene activas.",
  SucursalPublica: "Resuelve el slug de la carta pública a su sucursal: se lee ANTES de saber de qué sucursal es la carta (paso A7); su alcance es el slug público, no el de una sesión.",
};

const ALCANCE_DE_EMPRESA = [
  "CategoriaProducto", "Cliente", "DestinoConsumo", "Grupo", "Insumo", "Invitacion", "MargenObjetivo", "ModuloEmpresa", "MotivoMerma", "PermisoRol", "PortalCartaEmpresa", "Presentacion", "Producto",
  "PromoCarta", "PromoCartaCupo", "Proveedor", "ProveedorPorProducto", "Rol", "SeccionCarta", "Unidad", "UsuarioEmpresa",
] as const;

/** Declarada a mano (no derivada de `GLOBALES`/`CONSOLA`) a propósito: el guard cruza las dos listas y se pone en rojo si no coinciden. */
const ALCANCE_SIN_EMPRESA = [
  "Account", "Accion", "AdminPlataforma", "AuditoriaPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "CotizacionDolar", "Empresa", "IndicePrecio", "SesionPlataforma",
  "Session", "User", "VerificationToken",
] as const;

export const ALCANCE_DE_TABLAS: Readonly<Record<string, DeclaracionDeAlcance>> = Object.freeze({
  ...Object.fromEntries(ALCANCE_PROPIA.map((t) => [t, { alcance: "PROPIA" } as const])),
  ...Object.fromEntries(ALCANCE_PROPIA_O_EMPRESA.map((t) => [t, { alcance: "PROPIA_O_EMPRESA" } as const])),
  ...Object.fromEntries(Object.entries(ALCANCE_HEREDADA).map(([t, h]) => [t, { alcance: "HEREDADA", ...h } as const])),
  ...Object.fromEntries(Object.entries(ALCANCE_ENTRE_SUCURSALES).map(([t, e]) => [t, { alcance: "ENTRE_SUCURSALES", ...e } as const])),
  ...Object.fromEntries(Object.entries(ALCANCE_GOBIERNO).map(([t, motivo]) => [t, { alcance: "GOBIERNO", motivo } as const])),
  ...Object.fromEntries(ALCANCE_DE_EMPRESA.map((t) => [t, { alcance: "DE_EMPRESA" } as const])),
  ...Object.fromEntries(ALCANCE_SIN_EMPRESA.map((t) => [t, { alcance: "SIN_EMPRESA" } as const])),
});

/** Las tablas de un alcance, ordenadas. */
export function tablasConAlcance(alcance: AlcanceDeSucursal): string[] {
  return Object.entries(ALCANCE_DE_TABLAS)
    .filter(([, d]) => d.alcance === alcance)
    .map(([t]) => t)
    .sort();
}

/** Las tablas que llevan políticas de RLS por sucursal: PROPIA, PROPIA_O_EMPRESA, HEREDADA y ENTRE_SUCURSALES. */
export const TABLAS_CON_POLITICA_DE_SUCURSAL: readonly string[] = (["PROPIA", "PROPIA_O_EMPRESA", "HEREDADA", "ENTRE_SUCURSALES"] as const).flatMap((a) => tablasConAlcance(a)).sort();
