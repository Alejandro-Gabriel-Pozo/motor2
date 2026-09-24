"use client";

import type { CSSProperties } from "react";
import { resolveHeroInk, sanitizeCssColor } from "@/core/carta/color-css";
import { CLAVES_FIJAS_DEL_SISTEMA, CLAVES_TEMA_V1, validarValorTema, type ClaveTema } from "@/core/carta/tema";

/**
 * Vista previa esquemática del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M9, D11). Copia las reglas de
 * restaurant-menu-design/components/carta-view.tsx (y carta-topbar/carta-nav) y los defaults de su app/globals.css (A.15):
 * portada (colores, textos, tamaños, separador, CTA y la posición del bloque y del CTA), índice, banda (colores, tamaños y alto
 * mobile), un ítem común y uno especial, y las barras superior e inferior. NO simula los modos, anchos, posiciones, overlay ni
 * opacidad de la imagen de sección (lo dice en una nota).
 *
 * Cada valor se resuelve como en la carta: si pasa la validación del catálogo se usa normalizado; si está vacío o es inválido, el
 * default de la carta. Los precios usan la convención fija del sistema (es-AR, "$" a la izquierda).
 *
 * `data-vista-previa-tema`: el contenedor que el chequeo de axe excluye (con los defaults de la carta —ámbar sobre casi blanco— no
 * cumple contraste; es un problema conocido de la carta, fuera de este plan).
 */

/** Defaults de restaurant-menu-design/app/globals.css (A.15 del plan). */
const PRIMARY = "oklch(0.76 0.14 80)";
const BACKGROUND = "oklch(0.985 0.006 90)";
const FOREGROUND = "oklch(0.18 0.02 40)";
const MUTED_FOREGROUND = "oklch(0.50 0.02 50)";
const BORDER = "oklch(0.88 0.018 78)";

/** `normFuente` de la carta (lib/format-utils.ts): un número solo pasa a px. */
function normFuente(v: string): string {
  if (!v) return "";
  return /^\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v.trim();
}

/** `formatPrecio` de la carta con la convención fija del sistema. */
function formatoPrecio(n: number): string {
  const numero = n.toLocaleString(CLAVES_FIJAS_DEL_SISTEMA.precio_locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${CLAVES_FIJAS_DEL_SISTEMA.precio_simbolo}${numero}`;
}

/** El valor que la carta usaría para cada clave: el cargado si es válido (normalizado), si no el default de la carta. */
export function valoresEfectivos(valores: Readonly<Record<string, string>>): Record<ClaveTema, string> {
  const r = {} as Record<ClaveTema, string>;
  for (const d of CLAVES_TEMA_V1) {
    const v = validarValorTema(d.clave, valores[d.clave] ?? "");
    r[d.clave] = v.ok && v.valor !== null ? v.valor : d.defaultCarta;
  }
  return r;
}

const conAlfa = (variable: string, alfa: number) => `oklch(from var(${variable}) l c h / ${alfa})`;

export function VistaPreviaTema({ valores }: { valores: Readonly<Record<string, string>> }) {
  const t = valoresEfectivos(valores);
  const color = (c: string) => (c ? sanitizeCssColor(c) : null);

  // Variables como las de buildCssVars (lib/utils.ts de la carta), con los defaults de globals.css.
  const heroInk = resolveHeroInk(t.hero_ink) ?? FOREGROUND;
  const variables = {
    "--primary": color(t.color_marca) ?? PRIMARY,
    "--background": color(t.color_fondo_dia) ?? BACKGROUND,
    "--foreground": FOREGROUND,
    "--muted-foreground": MUTED_FOREGROUND,
    "--border": BORDER,
    "--hero-ink": heroInk,
    ...(color(t.color_portada_textos) ? { "--portada-textos": color(t.color_portada_textos) } : {}),
    ...(color(t.color_portada_cta) ? { "--portada-cta": color(t.color_portada_cta) } : {}),
  } as CSSProperties;

  const acento = t.hero_color_fondo;
  const bgUrl = t.hero_imagen_fondo_url;
  const textos = "var(--portada-textos, var(--hero-ink))";
  const textosAlfa = (a: number) => `oklch(from var(--portada-textos, var(--hero-ink)) l c h / ${a})`;
  const bandaAlto = /^\d+(\.\d+)?$/.test(t.carta_banda_alto_mobile) ? `${t.carta_banda_alto_mobile}px` : t.carta_banda_alto_mobile;

  const especial = { nombre: color(t.color_especial_item_nombre) ?? "var(--primary)", precio: color(t.color_especial_item_precio) ?? "var(--primary)", descripcion: color(t.color_especial_item_descripcion) ?? conAlfa("--muted-foreground", 0.75), tags: color(t.color_especial_item_tags) ?? "var(--primary)" };
  const comun = { nombre: color(t.color_item_nombre) ?? "var(--foreground)", precio: color(t.color_item_precio) ?? "var(--primary)", descripcion: color(t.color_item_descripcion) ?? conAlfa("--muted-foreground", 0.75), tags: color(t.color_item_tags) ?? conAlfa("--primary", 0.5) };

  const redes = [
    t.restaurante_instagram && { etiqueta: "Instagram", sigla: "IG" },
    t.restaurante_whatsapp && { etiqueta: "WhatsApp", sigla: "WA" },
    t.restaurante_footer_maps_url && { etiqueta: "Google Maps", sigla: "Maps" },
    t.restaurante_facebook && { etiqueta: "Facebook", sigla: "FB" },
  ].filter((r): r is { etiqueta: string; sigla: string } => Boolean(r));

  return (
    <div data-vista-previa-tema className="overflow-hidden rounded border" style={{ ...variables, backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      {/* Barra superior (carta-topbar.tsx) */}
      <div className="flex h-10 items-center justify-between px-3" style={{ borderBottom: `1px solid ${conAlfa("--border", 0.3)}` }}>
        <span data-preview="topbar" className="font-light uppercase tracking-[0.3em]" style={{ fontSize: normFuente(t.topbar_back_size || "12px"), color: color(t.topbar_back_color) ?? conAlfa("--foreground", 0.5) }}>
          {t.topbar_back_label || "← Menú"}
        </span>
        <span aria-hidden style={{ color: conAlfa("--foreground", 0.4) }}>⎙</span>
      </div>

      {/* Portada (carta-view.tsx, portada mobile) */}
      <div
        data-preview="portada"
        className="relative isolate overflow-hidden"
        style={{
          height: 260,
          backgroundColor: !bgUrl && acento ? acento : "var(--background)",
          ...(bgUrl ? { backgroundImage: `url("${bgUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}),
        }}
      >
        {bgUrl && acento && <div className="absolute inset-0" style={{ backgroundColor: `${acento}BF` }} aria-hidden />}
        <div className="absolute z-10 flex w-3/4 flex-col items-center text-center" style={{ top: `${t.carta_pos_bloque || "50"}%`, left: "50%", transform: "translate(-50%, -50%)" }}>
          {t.restaurante_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa ya validada (https, sin comillas ni paréntesis); la carta usa <img> igual.
            <img src={t.restaurante_logo_url} alt="" className="mb-2 h-10 w-10 object-contain" />
          )}
          {t.hero_etiqueta_superior && (
            <p className="font-light uppercase tracking-[0.45em]" style={{ fontSize: normFuente(t.carta_fuente_portada_etiqueta), color: textosAlfa(0.6) }}>
              {t.hero_etiqueta_superior}
            </p>
          )}
          <p data-preview="portada-nombre" className="font-serif font-medium leading-tight" style={{ fontSize: normFuente(t.carta_fuente_portada_nombre), color: textos }}>
            {t.restaurante_nombre || "Nombre del restaurante"}
          </p>
          {t.restaurante_subtitulo && (
            <p className="mt-0.5 font-light uppercase tracking-[0.22em]" style={{ fontSize: normFuente(t.carta_fuente_portada_subtitulo), color: textosAlfa(0.55) }}>
              {t.restaurante_subtitulo}
            </p>
          )}
          {t.restaurante_descripcion && (
            <p className="mt-1 font-light leading-snug" style={{ fontSize: normFuente(t.carta_fuente_portada_descripcion), color: textosAlfa(0.7) }}>
              {t.restaurante_descripcion}
            </p>
          )}
          {t.carta_texto_portada_separador && (
            <div className="mt-3 flex items-center gap-2">
              <span className="block h-px w-8" style={{ backgroundColor: textosAlfa(0.18) }} />
              <span style={{ fontSize: "7px", color: textosAlfa(0.25) }}>{t.carta_texto_portada_separador}</span>
              <span className="block h-px w-8" style={{ backgroundColor: textosAlfa(0.18) }} />
            </div>
          )}
        </div>
        {t.carta_texto_portada_cta && (
          <p
            data-preview="portada-cta"
            className="absolute z-10 whitespace-nowrap font-light uppercase tracking-[0.35em]"
            style={{ left: "50%", transform: "translateX(-50%)", bottom: `${t.carta_pos_cta || "18"}%`, fontSize: normFuente(t.carta_fuente_portada_cta), color: `oklch(from var(--portada-cta, var(--hero-ink)) l c h / 0.45)` }}
          >
            {t.carta_texto_portada_cta}
          </p>
        )}
      </div>

      {/* Índice */}
      <div className="px-4 py-3" style={{ borderTop: `1px solid ${conAlfa("--border", 0.4)}` }}>
        {t.carta_texto_indice_etiqueta && (
          <p className="font-light uppercase tracking-[0.5em]" style={{ fontSize: normFuente(t.carta_fuente_indice_etiqueta), color: "var(--primary)" }}>
            {t.carta_texto_indice_etiqueta}
          </p>
        )}
        {t.carta_texto_indice_titulo && (
          <p className="font-serif font-medium" style={{ fontSize: normFuente(t.carta_fuente_indice_titulo), color: color(t.color_indice_titulo) ?? "var(--foreground)" }}>
            {t.carta_texto_indice_titulo}
          </p>
        )}
        <ol className="mt-1">
          {["Entradas", "Del fuego"].map((seccion, i) => (
            <li key={seccion} className="flex items-baseline gap-2.5 py-1.5" style={{ borderBottom: `1px dotted ${conAlfa("--border", 0.4)}` }}>
              <span className="w-5 font-light" style={{ fontSize: normFuente(t.carta_fuente_indice_numero), color: color(t.color_indice_numeros) ?? "var(--primary)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1">
                <span className="block font-light uppercase tracking-widest" style={{ fontSize: normFuente(t.carta_fuente_indice_categoria), color: "var(--muted-foreground)" }}>
                  Cocina
                </span>
                <span className="block font-serif font-medium leading-snug" style={{ fontSize: normFuente(t.carta_fuente_indice_item), color: color(t.color_indice_titulos) ?? "var(--foreground)" }}>
                  {seccion}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Banda de sección (alto mobile) */}
      <div data-preview="banda" className="relative overflow-hidden" style={{ height: bandaAlto, borderBottom: `1px solid ${conAlfa("--primary", 0.2)}` }}>
        <div className="absolute inset-0 flex flex-col justify-end overflow-hidden px-4 pb-2 pt-2">
          <p className="overflow-hidden font-light uppercase tracking-[0.4em]" style={{ fontSize: normFuente(t.carta_fuente_banda_etiqueta), lineHeight: 1.3, color: color(t.color_banda_etiqueta) ?? "var(--primary)" }}>
            Cocina · 02 / 02
          </p>
          <p className="shrink-0 font-serif font-medium leading-tight tracking-tight" style={{ fontSize: normFuente(t.carta_fuente_banda_titulo), color: color(t.color_banda_titulo) ?? "var(--foreground)" }}>
            Del fuego
          </p>
          <p className="overflow-hidden font-light leading-snug" style={{ fontSize: normFuente(t.carta_fuente_banda_descripcion), lineHeight: 1.35, color: color(t.color_banda_descripcion) ?? "var(--muted-foreground)" }}>
            A la parrilla y al horno de barro
          </p>
        </div>
      </div>

      {/* Ítems: uno común y uno especial */}
      <ul className="px-4">
        {[
          { nombre: "Bife de chorizo", descripcion: "Con papas rústicas", precio: 12500, tags: ["Sin TACC"], esp: false, c: comun },
          { nombre: "Cordero patagónico", descripcion: "Al asador, para compartir", precio: 38900.5, tags: ["Regional"], esp: true, c: especial },
        ].map((item) => (
          <li key={item.nombre} className="py-2.5" style={{ borderBottom: `1px dotted ${conAlfa("--border", 0.4)}` }} data-preview={item.esp ? "item-especial" : "item"}>
            <div className="flex items-baseline justify-between gap-3">
              <span data-preview={item.esp ? "item-especial-nombre" : "item-nombre"} className="min-w-0 flex-1 font-serif font-semibold leading-tight" style={{ fontSize: normFuente(t.carta_fuente_item_nombre), color: item.c.nombre }}>
                {item.nombre}
                {item.esp && <span className="ml-1 text-[8px]"> ★</span>}
              </span>
              <span data-preview={item.esp ? "item-especial-precio" : "item-precio"} className="shrink-0 font-serif font-semibold" style={{ fontSize: normFuente(t.carta_fuente_item_precio), color: item.c.precio }}>
                {formatoPrecio(item.precio)}
              </span>
            </div>
            <p className="mt-0.5 font-light leading-snug" style={{ fontSize: normFuente(t.carta_fuente_item_descripcion), color: item.c.descripcion }}>
              {item.descripcion}
            </p>
            <div className="mt-1 flex gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="font-light uppercase tracking-wider" style={{ fontSize: normFuente(t.carta_fuente_item_tags), color: item.c.tags }}>
                  {tag}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* Barra de navegación inferior (carta-nav.tsx) */}
      <div className="flex h-12 items-center justify-between px-3" style={{ borderTop: `1px solid ${conAlfa("--border", 0.4)}` }}>
        <span data-preview="nav-flecha" aria-hidden style={{ color: color(t.color_nav_flechas) ?? conAlfa("--foreground", 0.6) }}>
          ‹
        </span>
        <span className="flex gap-3 text-xs">
          {redes.map((r) => (
            <span key={r.sigla} title={r.etiqueta} data-preview="nav-icono" style={{ color: color(t.color_nav_iconos) ?? conAlfa("--foreground", 0.55) }}>
              {r.sigla}
            </span>
          ))}
        </span>
        <span aria-hidden style={{ color: color(t.color_nav_flechas) ?? conAlfa("--foreground", 0.6) }}>
          ›
        </span>
      </div>
    </div>
  );
}
