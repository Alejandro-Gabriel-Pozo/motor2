/**
 * Colores CSS de la carta pública (docs/plan-tema-carta-2026-09-24.md, M2, D8).
 *
 * COPIA LITERAL de `sanitizeCssColor`, `resolveHeroInk` y `resolvePrimaryForeground` (con sus parsers y helpers de luminancia)
 * de restaurant-menu-design/lib/hero-utils.ts (commit f4529ce). Es la función con la que la carta vuelve a sanear cada color que
 * le llega de motor2, así que motor2 valida en la entrada con EXACTAMENTE el mismo criterio: un color que motor2 acepta nunca lo
 * descarta la carta. No hay paquete compartido (son dos repos): UN CAMBIO SE HACE EN LAS DOS COPIAS, y la tabla de paridad de
 * test/carta/color-css.test.ts fija el comportamiento.
 *
 * Pura, sin Prisma: la importa también el editor de tema (cliente) para la vista previa. Solo se agregó este encabezado; el cuerpo
 * es el de la carta tal cual (sin punto y coma, como en ese repo).
 */
/**
 * Valida que un string sea un color CSS seguro antes de inyectarlo en un <style>.
 * Acepta: hex (#rgb, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla(),
 *         oklch(), oklab(), nombres CSS (solo letras), y los alias 'claro'/'oscuro'.
 * Rechaza cualquier valor con ; { } < > comillas u otros caracteres peligrosos.
 * Devuelve el valor limpio o null si no es válido.
 */
export function sanitizeCssColor(value: string): string | null {
  if (!value) return null
  const v = value.trim()

  // Bloquear caracteres peligrosos para CSS injection
  if (/[;{}"'<>\\]/.test(v)) return null

  // Alias locales
  const lower = v.toLowerCase()
  if (lower === "claro" || lower === "oscuro") return v

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v

  // Funciones de color CSS: rgb(), rgba(), hsl(), hsla(), oklch(), oklab(), color()
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab|color)\([\d\s,./a-zA-Z%+-]+\)$/i.test(v)) return v

  // Nombres CSS: solo letras (ej: "red", "transparent", "currentColor")
  if (/^[a-zA-Z]+$/.test(v)) return v

  return null
}

/** Acepta 'claro', 'oscuro' o cualquier color CSS válido */
export function resolveHeroInk(value: string): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (v === "claro")  return "oklch(0.96 0.005 80)"
  if (v === "oscuro") return "oklch(0.18 0.02 40)"
  return sanitizeCssColor(value)
}

// ─── Helpers de conversión de color ─────────────────────────────────────────

/** Convierte un canal sRGB [0,1] a lineal */
function toLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Luminancia relativa WCAG 2.1 a partir de RGB [0,255] */
function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * toLinear(r / 255) +
    0.7152 * toLinear(g / 255) +
    0.0722 * toLinear(b / 255)
  )
}

/** Elige texto claro u oscuro según contraste WCAG AA */
function inkFromLuminance(L: number): string {
  const contrastDark  = 1.05 / (L + 0.05)   // texto claro sobre fondo
  const contrastLight = (L + 0.05) / 0.05    // texto oscuro sobre fondo
  return contrastDark >= contrastLight
    ? "oklch(0.96 0.005 80)"  // texto claro
    : "oklch(0.18 0.02 40)"   // texto oscuro
}

// ─── Parsers por formato ────────────────────────────────────────────────────

/** Parsea #rgb / #rrggbb → [r,g,b] | null */
function parseHex(v: string): [number, number, number] | null {
  const h6 = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (h6) return [parseInt(h6[1], 16), parseInt(h6[2], 16), parseInt(h6[3], 16)]
  const h3 = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)
  if (h3) return [
    parseInt(h3[1] + h3[1], 16),
    parseInt(h3[2] + h3[2], 16),
    parseInt(h3[3] + h3[3], 16),
  ]
  return null
}

/** Parsea rgb(r, g, b) / rgba() → [r,g,b] | null */
function parseRgb(v: string): [number, number, number] | null {
  const m = v.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i)
  if (!m) return null
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]
}

/**
 * Parsea hsl(H S% L%) o hsla(H S% L% / A) → [r,g,b] | null
 * H en grados [0,360], S y L en % [0,100].
 * Acepta sintaxis moderna (espacios) y clásica (comas).
 */
function parseHsl(v: string): [number, number, number] | null {
  const m = v.match(
    /^hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/i
  )
  if (!m) return null
  const h = parseFloat(m[1]) / 360
  const s = parseFloat(m[2]) / 100
  const l = parseFloat(m[3]) / 100

  if (s === 0) {
    const gray = Math.round(l * 255)
    return [gray, gray, gray]
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h)       * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ]
}

/**
 * Parsea oklch(L C H) o oklch(L C H / A) → [r,g,b] | null
 * Convierte OKLCH → OKLab → XYZ D65 → sRGB lineal → sRGB [0,255].
 * L en [0,1], C ≥ 0, H en grados.
 */
function parseOklch(v: string): [number, number, number] | null {
  const m = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i)
  if (!m) return null
  const Lv = parseFloat(m[1])
  const C  = parseFloat(m[2])
  const H  = parseFloat(m[3]) * (Math.PI / 180)

  // OKLCH → OKLab
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)

  // OKLab → LMS cubo (matrices de Oklab)
  const l_ = Lv + 0.3963377774 * a + 0.2158037573 * b
  const m_ = Lv - 0.1055613458 * a - 0.0638541728 * b
  const s_ = Lv - 0.0894841775 * a - 1.2914855480 * b

  const lc = l_ * l_ * l_
  const mc = m_ * m_ * m_
  const sc = s_ * s_ * s_

  // LMS → sRGB lineal (matriz XYZ D65 → sRGB incluida)
  const rLin =  4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
  const gLin = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
  const bLin = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc

  // sRGB lineal → sRGB gamma [0,255]
  const toGamma = (c: number) =>
    c <= 0 ? 0 : c >= 1 ? 255 : Math.round(
      (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255
    )

  return [toGamma(rLin), toGamma(gLin), toGamma(bLin)]
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Dado un color de marca en cualquier formato soportado, devuelve el color
 * de texto que garantiza contraste WCAG AA sobre ese fondo.
 *
 * Soporta: #rrggbb, #rgb, rgb(), rgba(), hsl(), hsla(), oklch().
 * Para formatos no parseables devuelve null → se usa el valor de globals.css.
 */
export function resolvePrimaryForeground(color: string): string | null {
  if (!color) return null
  const v = color.trim()

  const rgb =
    parseHex(v) ??
    parseRgb(v) ??
    parseHsl(v) ??
    parseOklch(v)

  if (!rgb) return null

  return inkFromLuminance(relativeLuminance(rgb[0], rgb[1], rgb[2]))
}

