import type { CartaV1, EstiloCarta } from "@/core/carta/public";
import { NavegacionCarta, type PaginaCarta, type RedSocial } from "./navegacion-carta";
import { Portada } from "./portada";
import { Seccion } from "./seccion";

/**
 * ADR-006, Fase 3: compone la carta completa (portada, índice, una página por sección) — reemplaza `CartaView`
 * (`restaurant-menu-design/components/carta-view.tsx`). Las páginas del slider (`paginas`) se calculan acá, en el
 * servidor, a partir de `carta.secciones` — nunca descubiertas del DOM (ver `navegacion-carta.tsx`).
 */
export function CartaVista({ carta, estilo, hrefVolver }: { carta: CartaV1; estilo: EstiloCarta; hrefVolver: string }) {
  const restauranteNombre = estilo.valores.restaurante_nombre || carta.sucursal.nombre;
  const paginas: PaginaCarta[] = [
    { id: "portada", tipo: "portada" },
    { id: "indice", tipo: "indice" },
    ...carta.secciones.map((s) => ({ id: s.id, tipo: "seccion" as const })),
  ];
  const redesSociales = construirRedesSociales(estilo.valores);
  // Pisa los tokens base de `.carta-shell` (src/app/globals.css) con lo cargado en el tema de ESTA sucursal — si algo
  // no está cargado, la clave sale "" en `variablesCss` y el CSS de `.carta-shell` sigue decidiendo (cascada normal).
  const variablesCss: Record<string, string> = { ...estilo.variablesCss };
  if (estilo.valores.color_marca) variablesCss["--carta-primary"] = estilo.valores.color_marca;
  if (estilo.valores.color_fondo_dia) variablesCss["--carta-bg"] = estilo.valores.color_fondo_dia;

  return (
    <NavegacionCarta paginas={paginas} hrefVolver={hrefVolver} redesSociales={redesSociales} variablesCss={variablesCss}>
      <Portada estilo={estilo} restauranteNombre={restauranteNombre} />

      <div className="carta-pagina flex flex-col px-6 pb-16 pt-14 sm:px-10">
        {estilo.valores.carta_texto_indice_etiqueta && (
          <p className="mb-0.5 text-xs font-light uppercase tracking-[0.5em]" style={{ fontSize: estilo.valores.carta_fuente_indice_etiqueta, color: "var(--carta-primary)" }}>
            {estilo.valores.carta_texto_indice_etiqueta}
          </p>
        )}
        <h1 className="font-serif font-medium" style={{ fontSize: estilo.valores.carta_fuente_indice_titulo }}>
          {estilo.valores.carta_texto_indice_titulo || "Índice"}
        </h1>
        <ol className="mt-4 min-h-0 flex-1 overflow-y-auto" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
          {carta.secciones.map((seccion, i) => (
            <li key={seccion.id} className="border-b border-dotted" style={{ borderColor: "var(--carta-border)" }}>
              <button
                type="button"
                data-ir-a={seccion.id}
                className="group flex w-full items-baseline gap-2.5 py-2 text-left transition-opacity hover:opacity-80"
              >
                <span className="w-5 shrink-0 font-light" style={{ fontSize: estilo.valores.carta_fuente_indice_numero, color: "var(--carta-primary)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="flex-1 font-serif font-medium leading-snug"
                  style={{ fontSize: estilo.valores.carta_fuente_indice_item }}
                >
                  {seccion.titulo ?? seccion.nombre}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {carta.secciones.map((seccion, i) => (
        <Seccion key={seccion.id} seccion={seccion} indice={i} total={carta.secciones.length} estilo={estilo} />
      ))}
    </NavegacionCarta>
  );
}

function construirRedesSociales(v: EstiloCarta["valores"]): RedSocial[] {
  const redes: RedSocial[] = [];
  if (v.restaurante_instagram) {
    redes.push({ id: "instagram", label: "Instagram", href: v.restaurante_instagram.startsWith("http") ? v.restaurante_instagram : `https://instagram.com/${v.restaurante_instagram.replace("@", "")}` });
  }
  if (v.restaurante_whatsapp) {
    redes.push({ id: "whatsapp", label: "WhatsApp", href: `https://wa.me/${v.restaurante_whatsapp.replace(/\D/g, "")}` });
  }
  if (v.restaurante_footer_maps_url) {
    redes.push({ id: "maps", label: "Google Maps", href: v.restaurante_footer_maps_url });
  }
  if (v.restaurante_facebook) {
    redes.push({ id: "facebook", label: "Facebook", href: v.restaurante_facebook.startsWith("http") ? v.restaurante_facebook : `https://facebook.com/${v.restaurante_facebook}` });
  }
  return redes;
}
