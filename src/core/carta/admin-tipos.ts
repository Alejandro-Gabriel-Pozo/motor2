import type { MenuArmado, ProductoSinSeccion } from "./armar-menu";
import { posicionCompleta, type PosicionPortal } from "./portal";

/**
 * Lectura de las pantallas de admin de la carta (/carta, docs/plan-carta-catalogo-2026-09-24.md, M10, y
 * /carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7, y /carta/tema, docs/plan-tema-carta-2026-09-24.md,
 * M9). Solo lectura (la fija el guardián carta-solo-lectura); la pantalla la llama DESPUÉS de su propio `requierePermisoVer*(..., "carta_ver")`. No es una
 * Server Action a propósito: así no queda expuesta como endpoint.
 */
export interface SeccionCartaAdmin {
  id: string;
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  imagenUrl: string | null;
  orden: number;
  activa: boolean;
  /**
   * Cuántos ítems ya están ubicados en esta sección (docs/plan-carta-seccion-directa-2026-09-25.md, DA6): productos sueltos visibles
   * (sin agrupar) + ítems agrupados prendidos — comparten la misma escala de orden. Es el orden que se sugiere para uno nuevo.
   */
  cantidadItems: number;
}

export interface ProductoCartaAdmin {
  id: string;
  nombre: string;
  /** Nombre de la sección de carta ACTIVA donde está su contenido, o null. */
  seccionCarta: string | null;
  precio: number;
  /** % de descuento CONFIGURADO de este producto EN esta sucursal (producto con descuento, 2026-10-01), o null. Rige solo con `precioLocalActivo` (R1). */
  descuento: number | null;
  contenido:
    | { visibleEnCarta: boolean; seccionCartaId: string | null; descripcion: string | null; tags: string[]; especial: boolean; orden: number; generoCartaId: string | null }
    | null;
  /** Nombre del ítem agrupado donde está (docs/plan-agrupacion-items-carta-2026-09-24.md, M6), o null: si está, sale solo ahí. */
  agrupadoEn: string | null;
  /** Nombre de su género de carta si está ACTIVO (docs/plan-genero-carta-2026-09-26.md), o null: entonces sale suelto en el POS. */
  generoCarta: string | null;
}

/** Un género de carta (docs/plan-genero-carta-2026-09-26.md): carpeta VISUAL del POS, propia de cada sucursal (ADR-009, C3). */
export interface GeneroCartaAdmin {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

/** Un cupo de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1), para el editor del admin. */
export interface CupoPromoCartaAdmin {
  id: string;
  seccionCartaId: string;
  /** Nombre de la sección elegida (aunque esté apagada: el admin necesita verla para poder corregirla). */
  seccionCarta: string;
  cantidadMinima: number;
  cantidadMaxima: number;
  orden: number;
}

export interface PromoCartaAdmin {
  id: string;
  seccionCartaId: string;
  seccionCarta: string;
  titulo: string;
  descripcion: string | null;
  /** Precio de la EMPRESA (el mismo para todas las sucursales salvo que alguna tenga el suyo). */
  precio: number;
  orden: number;
  /** Apagado/prendido GENERAL (de la empresa): apagada, ninguna sucursal la ofrece. */
  activa: boolean;
  /** Prendida en la sucursal activa (sin fila = no la ofrece: opt-in). */
  prendidaAca: boolean;
  /** Precio propio de la sucursal activa, o null si usa el de la empresa. */
  precioLocal: number | null;
  /** Lo que se cobra EN ESTA sucursal (precio local o, si no hay, el de la empresa). */
  precioAca: number;
  /** Vacío = puramente informativa (el POS la ignora). Uno o más = ARMABLE (D1). */
  cupos: CupoPromoCartaAdmin[];
}

/** Otra sucursal de la empresa que ya tiene carta propia armada: se puede copiar a una sucursal sin carta (ADR-009, C3). */
export interface SucursalConCartaPropia {
  id: string;
  nombre: string;
  /** Cuántos productos tienen contenido de carta en ella (informativo, para elegir de dónde copiar). */
  cantidadProductos: number;
}

export interface DatosAdminCarta {
  /**
   * La sucursal activa NO tiene carta propia todavía (ADR-009, C3; familia «opt-in»): ningún contenido de producto, ningún género y ningún
   * ítem agrupado propios. Su carta pública y el selector del POS salen vacíos hasta que la arme o la copie de otra sucursal.
   */
  cartaVacia: boolean;
  /** Otras sucursales ACTIVAS con carta propia, de donde se puede copiar (solo se usa si `cartaVacia`). */
  sucursalesConCarta: SucursalConCartaPropia[];
  secciones: SeccionCartaAdmin[];
  /** TODOS los géneros (activos primero, orden, nombre) — para el select "Género (opcional)" de cada contenido. */
  generos: GeneroCartaAdmin[];
  /** PV disponibles en la sucursal (los únicos que pueden salir en su carta). */
  productos: ProductoCartaAdmin[];
  /**
   * Lo que se le avisa al admin para que no pase desapercibido (D3): disponibles acá SIN fila de contenido de carta. No incluye a
   * los que están en un ítem agrupado: esos salen en la carta a través del grupo, sin contenido propio.
   */
  sinContenido: ProductoCartaAdmin[];
  /** Visibles y disponibles que igual no salen porque no tienen sección de carta, o la suya está apagada. */
  visiblesSinSeccion: ProductoSinSeccion[];
  promos: PromoCartaAdmin[];
  /**
   * La capacidad `precio_local` de la sucursal (R1, 2026-10-01): apagada, NO rigen el precio local de las promos ni los descuentos de producto
   * configurados (siguen guardados; el admin los ve y los edita igual). Los precios `precioAca` ya la consideran.
   */
  precioLocalActivo: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Ítems agrupados de la carta (/carta/agrupados, docs/plan-agrupacion-items-carta-2026-09-24.md, M6/M7)
// ---------------------------------------------------------------------------------------------------------------------------

export interface OpcionItemAgrupadoAdmin {
  /** Id de la fila de opción (para reordenar o quitar). */
  id: string;
  productoId: string;
  nombre: string;
  orden: number;
  disponibleAca: boolean;
  /** Precio en esta sucursal, con la regla de la carta (`precioDeCarta`). */
  precioAca: number;
}

export interface ItemAgrupadoAdmin {
  id: string;
  nombre: string;
  /** La sección de carta donde se ubica, directo (docs/plan-carta-seccion-directa-2026-09-25.md). */
  seccionCartaId: string;
  /** Nombre de su sección de carta si está ACTIVA, o null (entonces no sale). */
  seccionCarta: string | null;
  descripcion: string | null;
  tags: string[];
  especial: boolean;
  orden: number;
  activo: boolean;
  /** Su género de carta (docs/plan-genero-carta-2026-09-26.md), para preseleccionarlo en el form; null = sin género. */
  generoCartaId: string | null;
  /** Nombre de su género si está ACTIVO, o null (entonces sale suelto en el POS). */
  generoCarta: string | null;
  opciones: OpcionItemAgrupadoAdmin[];
  /** Cuántas opciones están disponibles en esta sucursal. */
  disponiblesAca: number;
  /** Rango de precios de las opciones disponibles acá (null si no hay ninguna). */
  precio: { minimo: number; maximo: number } | null;
  avisos: {
    /** D5 (red de seguridad): las opciones disponibles acá no cuestan lo mismo; la carta muestra `mostrado` (el mayor). */
    preciosDistintos: { minimo: number; maximo: number; mostrado: number } | null;
    /** Ninguna opción disponible acá: el ítem no sale en la carta de esta sucursal. */
    sinOpcionesAca: boolean;
    /** Su sección de carta está apagada: el ítem no sale. */
    sinSeccion: boolean;
  };
}

export interface DatosAdminItemsAgrupados {
  items: ItemAgrupadoAdmin[];
  /** Todas las secciones de carta (para el select del ítem), con cuántos ítems ya tiene cada una (orden sugerido, DA6). */
  secciones: SeccionCartaAdmin[];
  /** Todos los géneros (activos primero, orden, nombre) — para el select "Género (opcional)" del ítem. */
  generos: GeneroCartaAdmin[];
  /** PV disponibles acá que no están en ningún ítem agrupado (para el select "Agregar producto"). */
  productosSinGrupo: { id: string; nombre: string; precioAca: number }[];
  diagnostico: Pick<MenuArmado["diagnostico"], "agrupadosSinSeccion" | "agrupadosSinOpciones" | "agrupadosConPreciosDistintos">;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Portal de sucursales (/carta/portal, docs/plan-registro-tenants-2026-09-24.md, M7)
// ---------------------------------------------------------------------------------------------------------------------------

export interface RegistroPublicoAdmin {
  slug: string;
  etiqueta: string | null;
  subtituloPortal: string | null;
  posX: number | null;
  posY: number | null;
  posW: number | null;
  posH: number | null;
  orden: number;
  publicada: boolean;
}

export interface SucursalPortalAdmin {
  id: string;
  nombre: string;
  activo: boolean;
  /** null = la sucursal no está en el registro de motor2 (no sale en el portal). */
  publica: RegistroPublicoAdmin | null;
  /** true = tiene un tema aplicado en motor2 (/carta/tema): el registro emite `temaDesdeMotor2` (docs/plan-tema-carta-2026-09-24.md, M6). */
  temaDesdeMotor2: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tema de la carta (/carta/tema, docs/plan-tema-carta-2026-09-24.md, M4/M9)
// ---------------------------------------------------------------------------------------------------------------------------

export interface TemaAdmin {
  sucursalId: string;
  nombre: string;
  /** null = la sucursal todavía no tiene tema en motor2 (la carta usa el estilo por defecto). */
  tema: {
    /**
     * Lo guardado TAL CUAL (sin volver a validar), solo las claves del catálogo con valor de texto: si alguien cargó algo inválido
     * por `db:studio`, el formulario lo muestra para corregirlo (el endpoint, en cambio, lo emite como null).
     */
    valores: Record<string, string>;
    aplicarEnCarta: boolean;
    actualizadoEn: Date;
  } | null;
  /** null = la sucursal no está en el portal: el tema se puede preparar igual, pero no tiene efecto hasta agregarla. */
  publica: { slug: string; publicada: boolean } | null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Apariencia del portal de la empresa (/carta/portal, ADR-006)
// ---------------------------------------------------------------------------------------------------------------------------

export interface PortalEmpresaAdmin {
  /**
   * Lo guardado TAL CUAL (sin volver a validar), solo las claves del catálogo del portal con valor de texto: si alguien cargó algo
   * inválido por `db:studio`, el formulario lo muestra para corregirlo (el portal público, en cambio, cae al default).
   */
  valores: Record<string, string>;
  /** null = todavía no se guardó nada (el portal usa los defaults). Sirve de `key` del formulario para que se reinicie al guardar. */
  actualizadoEn: Date | null;
}

export interface EntradaVistaPreviaPortal {
  id: string;
  slug: string;
  etiqueta: string;
  subtitulo: string | null;
  posicion: PosicionPortal | null;
}

/**
 * Lo que el portal público mostraría hoy (publicada y con la sucursal activa), en el mismo orden (`orden`, después etiqueta): la
 * vista previa del admin dibuja con esto. Solo lo guardado: cambiar una posición o publicar una sucursal se ve al guardarla.
 */
export function entradasVistaPreviaPortal(sucursales: readonly SucursalPortalAdmin[]): EntradaVistaPreviaPortal[] {
  return sucursales
    .flatMap((s) => (s.publica?.publicada && s.activo ? [{ s, p: s.publica }] : []))
    .map(({ s, p }) => ({
      id: s.id,
      slug: p.slug,
      etiqueta: p.etiqueta ?? s.nombre,
      subtitulo: p.subtituloPortal,
      posicion: posicionCompleta(p.posX, p.posY, p.posW, p.posH),
      orden: p.orden,
    }))
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta, "es"))
    .map(({ id, slug, etiqueta, subtitulo, posicion }) => ({ id, slug, etiqueta, subtitulo, posicion }));
}