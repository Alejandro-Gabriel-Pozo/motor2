import { colorDeTextoLegible, resolveHeroInk, resolvePrimaryForeground } from "./color-css";
import { variablesDeLaEscala } from "./escala";
import { canalesDeMarcaHex, marcaGuardadaLegible, tintaSobreMarca } from "./marca-derivada";
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
   * "claro"/"oscuro" crudo — eso no es un color CSS válido por sí solo. Más las de la escala de letra única (`--carta-fs-<rol>`, `escala.ts`, DEC-35).
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

const TIPOS_DE_COLOR: ReadonlySet<string> = new Set(["color", "colorHex", "colorHeroInk"]);

/**
 * MODO MARCA (paso 9; `docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md`): con `marca_derivada = "si"` la carta se lee SOLO desde `color_marca` y el sistema deriva el resto. Las demás claves de color
 * guardadas siguen en la base (M6: nunca se borran) pero NO se leen: salen vacías y mandan los tokens del sistema. `color_marca` se lee con la lectura tolerante de `marca-derivada.ts` (hex corto, rgb, hsl u
 * oklch se convierten a `#rrggbb`); si no se puede leer, la carta usa el color del sistema (falla cerrado). Devuelve la tinta del texto sobre la marca (para la portada, que se pinta con la marca), o null.
 */
function aplicarModoMarca(valores: Record<ClaveTema, string>, variablesCss: Record<string, string>): string | null {
  const marcaGuardada = valores.color_marca;
  for (const d of CLAVES_TEMA_V1) {
    if (!TIPOS_DE_COLOR.has(d.tipo)) continue;
    valores[d.clave] = "";
    variablesCss[aVariableCss(d.clave)] = "";
  }
  const marca = marcaGuardadaLegible(marcaGuardada);
  valores.color_marca = marca ?? "";
  variablesCss[aVariableCss("color_marca")] = marca ?? "";
  // La marca es de ELEMENTOS (contraste >= 3:1 con el fondo, decisión del dueño 2026-11-13 «Marca 3:1 y textos con tinta del sistema»): todo TEXTO que sin marcador se pinta con la marca (precios, tags, nombre del ítem
  // especial, etiquetas y números del índice) pasa a la tinta del sistema. Los componentes leen `var(--carta-primary-texto, var(--carta-primary))`: sin esta variable (carta clásica) sigue valiendo la marca.
  variablesCss["--carta-primary-texto"] = "var(--carta-ink)";
  const canales = marca ? canalesDeMarcaHex(marca) : null;
  return canales ? tintaSobreMarca(canales).css : null;
}

export function resolverEstiloCarta(valoresGuardados: unknown): EstiloCarta {
  const obj: Record<string, unknown> =
    typeof valoresGuardados === "object" && valoresGuardados !== null && !Array.isArray(valoresGuardados) ? (valoresGuardados as Record<string, unknown>) : {};

  const valores = {} as Record<ClaveTema, string>;
  const variablesCss: Record<string, string> = {};
  for (const d of CLAVES_TEMA_V1) {
    const v = valorResuelto(obj, d);
    valores[d.clave] = v;
    // El marcador de modo no es CSS: no sale como variable.
    if (d.clave !== "marca_derivada") variablesCss[aVariableCss(d.clave)] = v;
  }

  // Con el marcador `marca_derivada = "si"`, SOLO la marca (ver `aplicarModoMarca`); sin él, todo se lee como siempre.
  // Exacto: solo el texto «si» guardado activa el modo (nada de «Si», « si » ni valores raros: todo nace cerrado).
  const modoMarca = Object.hasOwn(obj, "marca_derivada") && obj.marca_derivada === "si";
  const tintaSobreLaMarca = modoMarca ? aplicarModoMarca(valores, variablesCss) : null;

  const heroInk = valores.hero_ink ? resolveHeroInk(valores.hero_ink) : null;
  if (heroInk) variablesCss[aVariableCss("hero_ink")] = heroInk;

  // DEC-35 (Fase 5): la escala de letra única (`escala.ts`), con el piso de cada rol y el tema de la sucursal mandando solo hacia arriba.
  Object.assign(
    variablesCss,
    variablesDeLaEscala({ nombre: valores.carta_fuente_item_nombre, precio: valores.carta_fuente_item_precio, descripcion: valores.carta_fuente_item_descripcion, tags: valores.carta_fuente_item_tags }),
  );

  // Defecto 2 del ensayo del 2026-11-13: el color de marca se usa también como color de TEXTO (nombre y precio de un plato especial, etiquetas); si no llega a 4,5:1 contra el fondo de la carta
  // (marca #797d62 sobre #181818 = 4,16:1) los textos usan `--carta-primary-texto`, la marca acercada a la tinta lo justo. Con una marca que ya llega no se define y nada cambia.
  const tintaBase = valores.color_fondo_dia ? resolvePrimaryForeground(valores.color_fondo_dia) : null;
  // En modo marca el texto sobre la marca es SIEMPRE la tinta del sistema (`aplicarModoMarca` ya fijó `--carta-primary-texto`): esta corrección es solo del modo clásico.
  if (valores.color_marca && !modoMarca) {
    const marcaLegible = colorDeTextoLegible(valores.color_marca, valores.color_fondo_dia, tintaBase);
    if (marcaLegible !== valores.color_marca) variablesCss["--carta-primary-texto"] = marcaLegible;
  }

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
      colorTexto: o(valores.color_portada_textos) ?? heroInk ?? tintaSobreLaMarca ?? (valores.hero_color_fondo ? resolvePrimaryForeground(valores.hero_color_fondo) : null),
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
    tintaBase,
  };
}

/** El estilo con TODOS los defaults del catálogo, sin ningún valor cargado — lo que ve la carta sin tema aplicado. */
export function estiloCartaPorDefecto(): EstiloCarta {
  return resolverEstiloCarta({});
}
