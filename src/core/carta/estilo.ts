import { resolveHeroInk, resolvePrimaryForeground } from "./color-css";
import { CLAVES_TEMA_V1, validarValorTema, type ClaveTema, type DefinicionClaveTema } from "./tema";

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
  modo: "fondo" | "miniatura" | "ambos";
  /**
   * `carta_imagen_ancho_mobile` en la base: pese al nombre ("ancho"), es el ALTO de la miniatura en mobile, en % del alto de
   * la banda (confirmado en `CLAVES_TEMA_V1`, etiqueta real: "Alto de la miniatura en mobile"). Nombre honesto acá.
   */
  altoMiniaturaMobilePct: number;
  /**
   * `carta_imagen_ancho_desktop` en la base: es el `background-size` de la imagen en modo "fondo" (ej. "auto 100%"), no un
   * ancho de miniatura — la miniatura de escritorio no tiene tamaño configurable propio.
   */
  tamanoFondoDesktop: string;
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
  /** `color_portada_textos`: gana sobre `hero_ink` y sobre cualquier color derivado. */
  colorTexto: string | null;
  colorCta: string | null;
}

/** Botón "volver" del topbar. `etiqueta` nunca sale vacía (el default del catálogo es "← Menú"); `tamano` ya lleva unidad. */
export interface VolverEstilo {
  etiqueta: string;
  color: string | null;
  tamano: string;
}

export interface EstiloCarta {
  /**
   * Una variable CSS por cada una de las 66 claves, lista para setear en la raíz `.carta-shell` (`--carta-<clave-con-
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
  /** Tinta base (`--carta-ink`) derivada de `color_fondo_dia` por contraste WCAG; `null` si no hay fondo cargado (o no se puede leer) y manda el token de `.carta-shell`. */
  tintaBase: string | null;
}

const o = (v: string): string | null => (v === "" ? null : v);

/**
 * `snake_case` → `kebab-case` con el prefijo `--carta-`, para el nombre de la variable CSS. Casi la mitad de las 66 claves ya
 * arrancan con `carta_` (`carta_banda_alto_mobile`, `carta_fuente_*`…): se lo saca antes de agregar el prefijo, si no
 * quedaría `--carta-carta-banda-alto-mobile`.
 */
function aVariableCss(clave: string): string {
  const sinPrefijo = clave.startsWith("carta_") ? clave.slice("carta_".length) : clave;
  return `--carta-${sinPrefijo.replace(/_/g, "-")}`;
}

/**
 * Un tamaño de fuente guardado como número pelado ("14") necesita su unidad para ser CSS válido — `validarTamanoFuente`
 * (`css-valores.ts`) lo acepta tal cual a propósito (es el mismo criterio que la sheet vieja), y era `normFuente`
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
 * valor, usar el default" y volvería a caer en `""`. Un `tamanoFuente` sale ya normalizado con su unidad.
 */
function valorResuelto(obj: Record<string, unknown>, d: DefinicionClaveTema): string {
  const crudo = Object.hasOwn(obj, d.clave) ? obj[d.clave] : undefined;
  const valido = typeof crudo === "string" ? validarValorTema(d.clave, crudo) : null;
  const v = valido && valido.ok && valido.valor !== null ? valido.valor : d.defaultCarta;
  return d.tipo === "tamanoFuente" ? normalizarFuente(v) : v;
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

  const modo = valores.carta_imagen_modo as ImagenSeccionEstilo["modo"];
  const posicionX = valores.carta_imagen_pos_x as ImagenSeccionEstilo["posicionX"];
  const posicionY = valores.carta_imagen_pos_y as ImagenSeccionEstilo["posicionY"];

  return {
    variablesCss,
    valores,
    heroInk,
    imagenSeccion: {
      modo,
      altoMiniaturaMobilePct: Number(valores.carta_imagen_ancho_mobile),
      tamanoFondoDesktop: valores.carta_imagen_ancho_desktop,
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
      colorTexto: o(valores.color_portada_textos),
      colorCta: o(valores.color_portada_cta),
    },
    volver: {
      etiqueta: valores.topbar_back_label || "← Menú",
      color: o(valores.topbar_back_color),
      tamano: valores.topbar_back_size || "12px",
    },
    tintaBase: valores.color_fondo_dia ? resolvePrimaryForeground(valores.color_fondo_dia) : null,
  };
}

/** El estilo con TODOS los defaults del catálogo, sin ningún valor cargado — lo que ve la carta sin tema aplicado. */
export function estiloCartaPorDefecto(): EstiloCarta {
  return resolverEstiloCarta({});
}
