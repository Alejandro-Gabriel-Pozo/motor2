import { resolveHeroInk } from "./color-css";
import { CLAVES_TEMA_V1, validarValorTema, type ClaveTema } from "./tema";

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

export interface EstiloCarta {
  /**
   * Una variable CSS por cada una de las 67 claves, lista para setear en la raíz `.carta-shell` (`--carta-<clave-con-
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
}

/**
 * `snake_case` → `kebab-case` con el prefijo `--carta-`, para el nombre de la variable CSS. Casi la mitad de las 67 claves ya
 * arrancan con `carta_` (`carta_banda_alto_mobile`, `carta_fuente_*`…): se lo saca antes de agregar el prefijo, si no
 * quedaría `--carta-carta-banda-alto-mobile`.
 */
function aVariableCss(clave: string): string {
  const sinPrefijo = clave.startsWith("carta_") ? clave.slice("carta_".length) : clave;
  return `--carta-${sinPrefijo.replace(/_/g, "-")}`;
}

/**
 * Valor final de una clave: el del Json si pasa `validarValorTema`, si no (ausente, vacío, o inválido) el `defaultCarta` del
 * catálogo. Mismo criterio que `armarTemaCarta`, salvo que acá el resultado siempre es un string (nunca `null`): una clave
 * sin default queda en `""`, no en `null` — más simple para el consumidor, que de todos modos trataría `null` como "sin
 * valor, usar el default" y volvería a caer en `""`.
 */
function valorResuelto(obj: Record<string, unknown>, clave: string, defaultCarta: string): string {
  const crudo = Object.hasOwn(obj, clave) ? obj[clave] : undefined;
  if (typeof crudo !== "string") return defaultCarta;
  const r = validarValorTema(clave, crudo);
  return r.ok && r.valor !== null ? r.valor : defaultCarta;
}

export function resolverEstiloCarta(valoresGuardados: unknown): EstiloCarta {
  const obj: Record<string, unknown> =
    typeof valoresGuardados === "object" && valoresGuardados !== null && !Array.isArray(valoresGuardados) ? (valoresGuardados as Record<string, unknown>) : {};

  const valores = {} as Record<ClaveTema, string>;
  const variablesCss: Record<string, string> = {};
  for (const d of CLAVES_TEMA_V1) {
    const v = valorResuelto(obj, d.clave, d.defaultCarta);
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
  };
}

/** El estilo con TODOS los defaults del catálogo, sin ningún valor cargado — lo que ve la carta sin tema aplicado. */
export function estiloCartaPorDefecto(): EstiloCarta {
  return resolverEstiloCarta({});
}
