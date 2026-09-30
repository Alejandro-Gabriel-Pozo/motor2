import { resolveHeroInk, resolvePrimaryForeground } from "./color-css";
import { CLAVES_TEMA_V1, validarValorTema, type ClaveTema, type DefinicionClaveTema, type FamiliaTipografica } from "./tema";

/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: resuelve el Json guardado de `TemaCartaSucursal.valores`
 * a algo listo para dibujar — variables CSS más los campos que un componente necesita leer en JS (no solo poner en un
 * `<style>`). Reemplaza, adentro del mismo repo, lo que hacían juntos `get-config.ts` + `tema-motor2.ts#combinarConfig` +
 * `utils.buildCssVars` del lado de `restaurant-menu-design` — sin el viaje por un contrato HTTP versionado de por medio.
 *
 * PURO — sin Prisma. Vuelve a validar cada valor con `validarValorTema` (igual que `armarTemaCarta`, `./tema.ts`): una carga
 * hecha a mano por `db:studio` no pasa por las Server Actions, así que nunca hay que confiar en que el Json ya es válido.
 */

export interface ImagenSeccionEstilo {
  posicionX: "left" | "center" | "right";
  posicionY: "top" | "center" | "bottom";
  overlay: boolean;
  opacidadPct: number;
}

/** Colores por zona: `null` = la clave no está cargada y el componente usa su color de siempre (los `color_*` no tienen default). */
export interface ColoresCartaEstilo {
  indiceTitulo: string | null;
  indiceNumeros: string | null;
  indiceTitulos: string | null;
  bandaEtiqueta: string | null;
  bandaTitulo: string | null;
  bandaDescripcion: string | null;
  navFlechas: string | null;
  navIconos: string | null;
}

export interface PortadaEstilo {
  /** `hero_color_fondo`: fondo sólido de la portada (y velo sobre la imagen de fondo). `null` = los tokens de siempre. */
  fondo: string | null;
  /**
   * Color del texto de la portada, por prioridad: `color_portada_textos` (explícito) > `hero_ink` > derivado por contraste de
   * `hero_color_fondo` (sin esto, un fondo oscuro cargado dejaba la tinta oscura de siempre). `null` = decide el componente.
   */
  colorTexto: string | null;
  colorCta: string | null;
  /** `carta_pos_bloque`: % desde arriba donde va el bloque de la portada en mobile (0–100). */
  posBloquePct: number;
  /** `carta_pos_cta`: % de distancia del CTA al pie de la portada en mobile (0–100). */
  posCtaPct: number;
}

/** Botón "volver" del topbar. `etiqueta` nunca sale vacía (el default del catálogo es "← Menú"); `tamano` ya lleva unidad. */
export interface VolverEstilo {
  etiqueta: string;
  color: string | null;
  tamano: string;
}

/** Alto de la banda de cada sección; ambos ya con unidad (o función CSS), listos para `height`. */
export interface BandaEstilo {
  altoMobile: string;
  altoDesktop: string;
}

/**
 * `font-family` CSS de cada familia de `carta_fuente_familia`: la variable que define `next/font` en `fuente-carta.ts` (con el
 * respaldo genérico por si la fuente no llega) — serif o sans según corresponda. Es un mapa cerrado: el valor guardado nunca
 * llega al CSS como texto libre.
 */
const FAMILIA_CSS: Readonly<Record<FamiliaTipografica, string>> = {
  playfair: "var(--font-carta-serif, ui-serif, serif), serif",
  lora: "var(--font-carta-lora, ui-serif, serif), serif",
  cormorant: "var(--font-carta-cormorant, ui-serif, serif), serif",
  montserrat: "var(--font-carta-montserrat, ui-sans-serif, sans-serif), sans-serif",
  geist: "var(--font-geist-sans, ui-sans-serif, sans-serif), sans-serif",
};

export interface EstiloCarta {
  /**
   * Una variable CSS por cada una de las 64 claves, lista para setear en la raíz `.carta-shell` (`--carta-<clave-con-
   * guiones>`). Valor validado si lo hay, si no el default de `CLAVES_TEMA_V1` (`""` = sin default: la variable queda vacía
   * y el CSS base de `.carta-shell` decide). `--carta-hero-ink` lleva el valor YA RESUELTO (`resolveHeroInk`), no el
   * "claro"/"oscuro" crudo — eso no es un color CSS válido por sí solo.
   */
  variablesCss: Readonly<Record<string, string>>;
  /** Acceso directo por clave a los mismos valores resueltos (validado o default) — para lo que un componente necesita leer como dato, no como CSS. */
  valores: Readonly<Record<ClaveTema, string>>;
  /** `hero_ink` ya resuelto a un color CSS real, o `null` si no hay valor cargado ni default (el CSS base decide). */
  heroInk: string | null;
  imagenSeccion: ImagenSeccionEstilo;
  colores: ColoresCartaEstilo;
  portada: PortadaEstilo;
  volver: VolverEstilo;
  banda: BandaEstilo;
  /** `carta_fuente_familia` ya validada (un valor inválido o ausente cae a la de siempre, Playfair). Con su `font-family` en `--carta-fuente-familia` de `variablesCss`. */
  familiaTipografica: FamiliaTipografica;
  /** Tinta base (`--carta-ink`) derivada de `color_fondo_dia` por contraste WCAG; `null` si no hay fondo cargado (o no se puede leer) y manda el token de `.carta-shell`. */
  tintaBase: string | null;
}

const o = (v: string): string | null => (v === "" ? null : v);

/**
 * `snake_case` → `kebab-case` con el prefijo `--carta-`, para el nombre de la variable CSS. Casi la mitad de las 64 claves ya
 * arrancan con `carta_` (`carta_banda_alto_mobile`, `carta_fuente_*`…): se lo saca antes de agregar el prefijo, si no
 * quedaría `--carta-carta-banda-alto-mobile`.
 */
function aVariableCss(clave: string): string {
  const sinPrefijo = clave.startsWith("carta_") ? clave.slice("carta_".length) : clave;
  return `--carta-${sinPrefijo.replace(/_/g, "-")}`;
}

/**
 * Un tamaño de fuente guardado como número pelado ("14") necesita su unidad para ser CSS válido — `validarTamanoFuente`
 * (`css-valores.ts`) lo acepta tal cual a propósito (es el mismo criterio que la carta original), y era `normFuente`
 * (`restaurant-menu-design/lib/format-utils.ts`) quien le agregaba "px" recién al dibujar. Acá se hace en el mismo lugar
 * que el resto de la normalización, para que `variablesCss`/`valores` ya salgan listos para usar como `font-size`.
 */
function normalizarFuente(v: string): string {
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
}

/**
 * Valor final de una clave: el del Json si pasa `validarValorTema`, si no (ausente, vacío, o inválido) el `defaultCarta` del
 * catálogo. Mismo criterio que `armarTemaCarta`, salvo que acá el resultado siempre es un string (nunca `null`): una clave
 * sin default queda en `""`, no en `null` — más simple para el consumidor, que de todos modos trataría `null` como "sin
 * valor, usar el default" y volvería a caer en `""`. Un `tamanoFuente` y el alto de banda mobile (que el validador deja como
 * número pelado, "90") salen ya normalizados con su unidad, listos para usar como `height`.
 */
function valorResuelto(obj: Record<string, unknown>, d: DefinicionClaveTema): string {
  const crudo = Object.hasOwn(obj, d.clave) ? obj[d.clave] : undefined;
  const valido = typeof crudo === "string" ? validarValorTema(d.clave, crudo) : null;
  const v = valido && valido.ok && valido.valor !== null ? valido.valor : d.defaultCarta;
  return d.tipo === "tamanoFuente" || d.tipo === "altoBandaMobile" ? normalizarFuente(v) : v;
}

export function resolverEstiloCarta(valoresGuardados: unknown): EstiloCarta {
  const obj: Record<string, unknown> =
    typeof valoresGuardados === "object" && valoresGuardados !== null && !Array.isArray(valoresGuardados) ? (valoresGuardados as Record<string, unknown>) : {};

  const valores = {} as Record<ClaveTema, string>;
  const variablesCss: Record<string, string> = {};
  for (const d of CLAVES_TEMA_V1) {
    const v = valorResuelto(obj, d);
    valores[d.clave] = v;
    variablesCss[aVariableCss(d.clave)] = v;
  }

  const heroInk = valores.hero_ink ? resolveHeroInk(valores.hero_ink) : null;
  if (heroInk) variablesCss[aVariableCss("hero_ink")] = heroInk;

  const familiaTipografica = valores.carta_fuente_familia as FamiliaTipografica;
  variablesCss[aVariableCss("carta_fuente_familia")] = FAMILIA_CSS[familiaTipografica];

  const posicionX = valores.carta_imagen_pos_x as ImagenSeccionEstilo["posicionX"];
  const posicionY = valores.carta_imagen_pos_y as ImagenSeccionEstilo["posicionY"];

  return {
    variablesCss,
    valores,
    heroInk,
    imagenSeccion: {
      posicionX,
      posicionY,
      overlay: valores.carta_imagen_overlay === "si",
      opacidadPct: Number(valores.carta_imagen_opacidad),
    },
    colores: {
      indiceTitulo: o(valores.color_indice_titulo),
      indiceNumeros: o(valores.color_indice_numeros),
      indiceTitulos: o(valores.color_indice_titulos),
      bandaEtiqueta: o(valores.color_banda_etiqueta),
      bandaTitulo: o(valores.color_banda_titulo),
      bandaDescripcion: o(valores.color_banda_descripcion),
      navFlechas: o(valores.color_nav_flechas),
      navIconos: o(valores.color_nav_iconos),
    },
    portada: {
      fondo: o(valores.hero_color_fondo),
      colorTexto: o(valores.color_portada_textos) ?? heroInk ?? (valores.hero_color_fondo ? resolvePrimaryForeground(valores.hero_color_fondo) : null),
      colorCta: o(valores.color_portada_cta),
      posBloquePct: Number(valores.carta_pos_bloque),
      posCtaPct: Number(valores.carta_pos_cta),
    },
    volver: {
      etiqueta: valores.topbar_back_label || "← Menú",
      color: o(valores.topbar_back_color),
      tamano: valores.topbar_back_size || "12px",
    },
    banda: {
      altoMobile: valores.carta_banda_alto_mobile,
      altoDesktop: valores.carta_banda_alto_desktop,
    },
    familiaTipografica,
    tintaBase: valores.color_fondo_dia ? resolvePrimaryForeground(valores.color_fondo_dia) : null,
  };
}

/** El estilo con TODOS los defaults del catálogo, sin ningún valor cargado — lo que ve la carta sin tema aplicado. */
export function estiloCartaPorDefecto(): EstiloCarta {
  return resolverEstiloCarta({});
}
