import {
  LARGO_MAXIMO_ETIQUETA_PORTAL,
  LARGO_MAXIMO_SLUG_TENANT,
  LARGO_MAXIMO_SUBTITULO_PORTAL,
  TAB_MENU_POR_DEFECTO,
  validarDominioPublico,
  validarNombreTabSheet,
  validarPosicionPortal,
  validarSheetId,
  validarSlugTenant,
  validarTextoLibreCarta,
} from "./validaciones";

/**
 * Registro de tenants del portal (docs/plan-registro-tenants-2026-09-24.md, M2): lo que hoy es la tab "tenant" de la sheet
 * maestra de restaurant-menu-design, armado desde `SucursalPublica`. Puro, sin Prisma (la lectura está en
 * `registro-consulta.ts`), mismo reparto que `armar-menu.ts` / `menu-consulta.ts`.
 *
 * Contrato `RegistroTenantsV1` (versionado, camelCase). restaurant-menu-design lo convierte a su `Tenant` con un mapper
 * (lib/tenants-motor2.ts): si la forma cambia, sube `version` y la carta lo rechaza (cae a la sheet) en vez de romperse.
 */

// ---------------------------------------------------------------------------------------------------------------------------
// Slug (tenant_id / URL /carta/<slug>)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Slug de una sucursal a partir de su nombre (decisión D2): sin diacríticos (NFD, mismo criterio que `normalizarNombreGrupo`),
 * minúsculas, todo lo que no sea `[a-z0-9]` pasa a `-`, sin guiones repetidos ni en los extremos, a lo sumo 60 caracteres. Si no
 * queda nada, "sucursal". Se calcula UNA vez al agregar la sucursal al portal y queda guardado: renombrar la sucursal no cambia
 * la URL pública.
 */
export function slugTenant(nombre: string): string {
  const s = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LARGO_MAXIMO_SLUG_TENANT)
    .replace(/-+$/, "");
  return s || "sucursal";
}

/**
 * `base` si está libre; si no, `base-2`, `base-3`… (recortando `base` para no pasar de 60 caracteres). Dos nombres que solo
 * difieren en mayúsculas o tildes ("Villa La Angostura" / "Villa la Angostura") dan el mismo slug base: el segundo lleva `-2`.
 */
export function slugTenantUnico(base: string, ocupados: ReadonlySet<string>): string {
  if (!ocupados.has(base)) return base;
  for (let n = 2; ; n++) {
    const sufijo = `-${n}`;
    const candidato = `${base.slice(0, LARGO_MAXIMO_SLUG_TENANT - sufijo.length).replace(/-+$/, "")}${sufijo}`;
    if (!ocupados.has(candidato)) return candidato;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Contrato v1
// ---------------------------------------------------------------------------------------------------------------------------

export interface PosicionPortalV1 {
  /** Centro en % (0-100) del mapa del portal. */
  x: number;
  y: number;
  w: number;
  /** Opcional: la carta usa 5 si no viene. */
  h: number | null;
}

export interface TenantV1 {
  /** tenant_id de la carta: su URL es /carta/<slug>. */
  slug: string;
  /** `SucursalPublica.etiqueta` o, si no hay, el nombre de la sucursal. */
  etiqueta: string;
  /** Host desnudo (sin esquema ni puerto) o null. */
  dominio: string | null;
  /** PÚBLICO: subtítulo de la tarjeta del portal (en la carta, `notas`). */
  subtitulo: string | null;
  posicion: PosicionPortalV1 | null;
  orden: number;
  /** `publicada && Sucursal.activo`. Las filas no publicadas se emiten igual, con false: así la carta sabe que motor2 las conoce. */
  activo: boolean;
  sucursalId: string;
  /** true = el menú sale de GET /api/carta/[sucursal]; false = de la tab `sheetMenuNombre` de la sheet. */
  menuDesdeMotor2: boolean;
  /**
   * ADITIVO (sin subir `version`; docs/plan-tema-carta-2026-09-24.md, D5): true = el tema visual sale de
   * GET /api/carta/[sucursal]/tema (la sucursal tiene un tema aplicado en motor2); false = de la tab Config de la sheet.
   */
  temaDesdeMotor2: boolean;
  /** TRANSICIÓN: spreadsheet del tenant (tab Config y, si no hay menú de motor2, también el menú). */
  sheetId: string | null;
  /** TRANSICIÓN: tab del menú en esa sheet. */
  sheetMenuNombre: string;
}

export interface RegistroTenantsV1 {
  version: 1;
  generadoEn: string;
  tenants: TenantV1[];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------------------------------------------------------

/** Un `Prisma.Decimal` (o un número): se convierte con `Number()`. */
type ValorDecimal = number | string | { toString(): string };

/** Lo que `resolverRegistroTenants` lee de `SucursalPublica` + su sucursal. */
export interface FilaRegistroTenant {
  slug: string;
  etiqueta: string | null;
  dominio: string | null;
  subtituloPortal: string | null;
  posX: ValorDecimal | null;
  posY: ValorDecimal | null;
  posW: ValorDecimal | null;
  posH: ValorDecimal | null;
  orden: number;
  publicada: boolean;
  menuDesdeMotor2: boolean;
  sheetId: string | null;
  sheetMenuNombre: string;
  /** `temaCarta` es opcional para no obligar a los fixtures puros a traerlo: sin él, o sin fila de tema, `temaDesdeMotor2` es false. */
  sucursal: { id: string; nombre: string; activo: boolean; temaCarta?: { aplicarEnCarta: boolean } | null };
}

const aNumero = (v: ValorDecimal | null): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Convierte una fila a `TenantV1`, SANEANDO lo que no cumple las validaciones de carga (una fila cargada a mano por
 * `db:studio` no pasa por las Server Actions). Según la gravedad:
 *  - slug inválido → `null` (la fila se descarta: es la URL pública y la clave con la que la carta combina con la sheet);
 *  - dominio o sheetId inválidos → ese campo en null; tab del menú inválida → "Menu";
 *  - etiqueta vacía o demasiado larga → el nombre de la sucursal; subtítulo demasiado largo → null;
 *  - posición fuera de 0-100 o incompleta (falta x, y o ancho) → sin posición.
 */
export function filaATenantV1(f: FilaRegistroTenant): TenantV1 | null {
  const slug = validarSlugTenant(f.slug);
  if (!slug.ok || slug.valor !== f.slug) return null;

  const etiqueta = validarTextoLibreCarta(f.etiqueta, "La etiqueta", LARGO_MAXIMO_ETIQUETA_PORTAL);
  const subtitulo = validarTextoLibreCarta(f.subtituloPortal, "El subtítulo", LARGO_MAXIMO_SUBTITULO_PORTAL);
  const dominio = validarDominioPublico(f.dominio);
  const sheetId = validarSheetId(f.sheetId);
  const tab = validarNombreTabSheet(f.sheetMenuNombre);
  const pos = validarPosicionPortal({ x: aNumero(f.posX), y: aNumero(f.posY), w: aNumero(f.posW), h: aNumero(f.posH) });
  const posicion = pos.ok && pos.valor.x !== null && pos.valor.y !== null && pos.valor.w !== null ? { x: pos.valor.x, y: pos.valor.y, w: pos.valor.w, h: pos.valor.h } : null;

  return {
    slug: slug.valor,
    etiqueta: (etiqueta.ok && etiqueta.valor) || f.sucursal.nombre,
    dominio: dominio.ok ? dominio.valor : null,
    subtitulo: subtitulo.ok ? subtitulo.valor : null,
    posicion,
    orden: Number.isInteger(f.orden) ? f.orden : 0,
    activo: f.publicada && f.sucursal.activo,
    sucursalId: f.sucursal.id,
    menuDesdeMotor2: f.menuDesdeMotor2,
    temaDesdeMotor2: f.sucursal.temaCarta?.aplicarEnCarta === true,
    sheetId: sheetId.ok ? sheetId.valor : null,
    sheetMenuNombre: tab.ok ? tab.valor : TAB_MENU_POR_DEFECTO,
  };
}

/** El registro completo: todas las filas (publicadas o no, con `activo` resuelto), ordenadas por `orden` y después `etiqueta`. */
export function armarRegistroTenants(filas: readonly FilaRegistroTenant[], ahora: Date = new Date()): RegistroTenantsV1 {
  const tenants = filas
    .map(filaATenantV1)
    .filter((t): t is TenantV1 => t !== null)
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, "es") || a.slug.localeCompare(b.slug));
  return { version: 1, generadoEn: ahora.toISOString(), tenants };
}
