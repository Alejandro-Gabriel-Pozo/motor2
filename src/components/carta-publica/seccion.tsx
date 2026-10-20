import { Fragment } from "react";
import type { AclaracionCartaPublica, EstiloCarta, ItemCartaPublico, PromoCartaPublica, SeccionCartaPublica, TandaCartaPublica } from "@/core/carta/public";
import { formatearPrecioCarta, recargoEnPesos, textoDeLaAclaracion } from "@/core/carta/public";
import { TagIcon } from "./iconos";

/**
 * ADR-006, Fase 3: banda + ítems + promos de UNA sección de la carta — desenredado de `carta-view.tsx` (el `BandaContenido`
 * del original vivía DEFINIDO DENTRO del render de todo el componente, remontándose en cada render; acá es su propia
 * función a nivel de módulo). Sin la duplicación banda mobile/banda desktop del original: un solo bloque, con Tailwind
 * responsive. La imagen de sección es siempre el fondo de la banda: un `<img>` de fondo con `object-fit`, sin la lógica de
 * posicionamiento fino del original (nivel (a) del diagnóstico: correcto y accesible, no pixel-a-pixel idéntico).
 */
export function Seccion({ seccion, indice, total, estilo }: { seccion: SeccionCartaPublica; indice: number; total: number; estilo: EstiloCarta }) {
  const img = estilo.imagenSeccion;
  const c = estilo.colores;
  return (
    <div className="carta-pagina flex flex-col">
      <div
        data-carta-banda
        className="relative h-[var(--banda-alto-m)] shrink-0 overflow-hidden border-b sm:h-[var(--banda-alto-d)]"
        style={{ "--banda-alto-m": estilo.banda.altoMobile, "--banda-alto-d": estilo.banda.altoDesktop, borderColor: "var(--carta-border)" } as React.CSSProperties}
      >
        {seccion.imagenUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seccion.imagenUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" style={{ opacity: img.opacidadPct / 100, objectPosition: `${img.posicionX} ${img.posicionY}` }} />
        )}
        {seccion.imagenUrl && img.overlay && <div className="absolute inset-0" style={{ background: "linear-gradient(to right, var(--carta-bg), transparent 60%)" }} aria-hidden />}

        <div className="absolute inset-0 flex flex-col justify-end gap-0.5 px-6 pb-3 sm:justify-center sm:px-10 sm:pt-12 sm:pb-4">
          <p className="overflow-hidden text-ellipsis whitespace-nowrap font-light uppercase tracking-[0.4em]" style={{ fontSize: estilo.valores.carta_fuente_banda_etiqueta, color: c.bandaEtiqueta ?? "var(--carta-primary)" }}>
            {String(indice + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </p>
          <h2
            className="line-clamp-2 text-[length:var(--banda-titulo-fs)] carta-titulo font-medium leading-tight tracking-tight sm:text-[length:calc(var(--banda-titulo-fs)*1.5)]"
            style={{ "--banda-titulo-fs": estilo.valores.carta_fuente_banda_titulo, color: c.bandaTitulo ?? undefined } as React.CSSProperties}
          >
            {seccion.titulo ?? seccion.nombre}
          </h2>
          {seccion.descripcion && (
            <p className={`line-clamp-1 font-light leading-snug${c.bandaDescripcion ? "" : " opacity-70"}`} style={{ fontSize: estilo.valores.carta_fuente_banda_descripcion, color: c.bandaDescripcion ?? undefined }}>
              {seccion.descripcion}
            </p>
          )}
        </div>
      </div>

      <ul data-carta-scroll className="min-h-0 flex-1 divide-y overflow-y-auto px-6 sm:px-10" style={{ borderColor: "var(--carta-border)" }}>
        {/* S-25: las `key` son la posición, no el id de la fila: React serializa la `key` de cada elemento en el payload RSC que baja al navegador. */}
        {seccion.items.map((item, i) => {
          // Fase 5: una TANDA (productos consecutivos que comparten columnas, Chico | Mediano | Grande) se dibuja UNA vez, en su primer ítem, como una tabla; los demás de la tanda van adentro.
          const tanda = seccion.tandas?.find((t) => i >= t.primero && i <= t.ultimo);
          if (tanda) return i === tanda.primero ? <TandaFila key={`item-${i}`} tanda={tanda} items={seccion.items.slice(tanda.primero, tanda.ultimo + 1)} estilo={estilo} /> : null;
          return <ItemFila key={`item-${i}`} item={item} estilo={estilo} />;
        })}
        {seccion.promos.map((promo, i) => (
          <PromoFila key={`promo-${i}`} promo={promo} />
        ))}
      </ul>
    </div>
  );
}

/** Los colores del tema para un ítem (los de siempre; el especial, con los suyos). */
function coloresDelItem(especial: boolean, v: EstiloCarta["valores"]) {
  return {
    nombre: especial ? (v.color_especial_item_nombre || "var(--carta-primary)") : v.color_item_nombre || undefined,
    precio: especial ? (v.color_especial_item_precio || "var(--carta-primary)") : v.color_item_precio || "var(--carta-primary)",
    descripcion: especial ? v.color_especial_item_descripcion || undefined : v.color_item_descripcion || undefined,
    tags: especial ? (v.color_especial_item_tags || "var(--carta-primary)") : v.color_item_tags || "var(--carta-primary)",
    estrella: v.color_especial_item_nombre || "var(--carta-primary)",
  };
}
type ColoresDelItem = ReturnType<typeof coloresDelItem>;

/** La ★ de un plato especial (un glifo: no depende solo del color). */
function Estrella({ color }: { color: string }) {
  return (
    <span className="ml-1" style={{ color }} aria-label="Especial">
      {" ★"}
    </span>
  );
}

/** El nombre de un plato, en el rol Producto (un `h3`: la carta se recorre por sus títulos). */
function NombreDelItem({ item, colores }: { item: ItemCartaPublico; colores: ColoresDelItem }) {
  return (
    <h3 data-rol="producto" className="carta-rol-producto min-w-0 flex-1 carta-titulo" style={{ color: colores.nombre, overflowWrap: "anywhere" }}>
      {item.nombre}
      {item.especial && <Estrella color={colores.estrella} />}
    </h3>
  );
}

/** El precio a la derecha del nombre (rol Precio). Con descuento de producto: el de lista tachado, el que se cobra y «−x %» (en texto: no depende del color). */
function PrecioDelRenglon({ item, color }: { item: ItemCartaPublico; color: string }) {
  if (item.precioLista === undefined) {
    return (
      <span data-rol="precio" className="carta-rol-precio shrink-0 carta-titulo" style={{ color }}>
        {formatearPrecioCarta(item.precio)}
      </span>
    );
  }
  return (
    <span data-rol="precio" className="carta-rol-precio shrink-0 flex flex-col items-end carta-titulo" style={{ color }} data-descuento-producto>
      <span className="sr-only">{`Antes ${formatearPrecioCarta(item.precioLista)}, ahora ${formatearPrecioCarta(item.precio)}, ${item.descuentoPorcentaje} por ciento de descuento`}</span>
      <s aria-hidden="true" data-rol="aclaracion" className="carta-rol-aclaracion">
        {formatearPrecioCarta(item.precioLista)}
      </s>
      <span aria-hidden="true">
        {formatearPrecioCarta(item.precio)}
        <span data-rol="aclaracion" className="carta-rol-aclaracion ml-1">{`−${item.descuentoPorcentaje} %`}</span>
      </span>
    </span>
  );
}

/** El aviso del descuento de un producto cuyos precios (varios: una lista, una tabla) ya lo traen: «−10 %», sin tachar celda por celda (decisión del dueño). */
function AvisoDeDescuento({ porcentaje, color }: { porcentaje: number; color: string }) {
  return (
    <span data-rol="aclaracion" className="carta-rol-aclaracion shrink-0" style={{ color }} data-descuento-producto>
      <span className="sr-only">{`${porcentaje} por ciento de descuento en todos los precios`}</span>
      <span aria-hidden="true">{`−${porcentaje} %`}</span>
    </span>
  );
}

/** La descripción (rol Aclaración) y los tags (rol Etiqueta, con su ícono). */
function DescripcionYTags({ item, colores }: { item: ItemCartaPublico; colores: ColoresDelItem }) {
  return (
    <>
      {item.descripcion && (
        <p data-rol="aclaracion" className="carta-rol-aclaracion mt-0.5" style={{ color: colores.descripcion }}>
          {item.descripcion}
        </p>
      )}
      {item.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span key={tag} data-rol="etiqueta" className="carta-rol-etiqueta inline-flex items-center gap-0.5 uppercase tracking-wider" style={{ color: colores.tags }}>
              <TagIcon tag={tag} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Lo que se lee DEBAJO del plato (DEC-07), una línea por grupo en el orden del producto: «Guarnición: ensalada, papas fritas o puré», «Extras: extra de papas +$2.000, huevo frito +$1.500». El
 * rótulo (el nombre del grupo) en Aclaración 600 y el resto en Aclaración: el mismo texto que la vista previa de la administración (`textoDeLaAclaracion`).
 */
function Aclaraciones({ aclaraciones, color }: { aclaraciones: readonly AclaracionCartaPublica[]; color: string | undefined }) {
  return aclaraciones.map((a, i) => (
    <p key={`aclaracion-${i}`} data-aclaracion={a.rotulo} data-rol="aclaracion" className="carta-rol-aclaracion mt-0.5" style={{ color, overflowWrap: "anywhere" }}>
      <span data-rol="aclaracion-rotulo" className="carta-rol-aclaracion-rotulo" style={{ color: "var(--carta-ink)" }}>{`${a.rotulo}:`}</span> {textoDeLaAclaracion(a)}
    </p>
  ));
}

/**
 * Un ítem de la sección. Fase 5 (DEC-35): cada texto con su ROL de la escala única (`carta-rol-*`, `src/core/carta/escala.ts`): el nombre y el precio en Producto, la descripción y lo que se lee
 * debajo en Aclaración, los tags en Etiqueta. El mismo tamaño para todo ítem, con o sin opciones; el tema solo puede pedir más. `data-rol` marca el rol en el HTML (lo miden los tests: un solo
 * tamaño y un solo peso por rol).
 *
 * Con opciones, el ítem se DIBUJA SEGÚN SU FORMA (`presentacion`, que resuelve el servidor: `core/carta/presentacion-en-carta.ts`; ADR-035): `simple` (el nombre y su precio, con las aclaraciones
 * debajo); `tabla` (dos ejes: el nombre arriba y una tabla real); `lista` (un eje en filas: con el nombre arriba, o la base OCULTA, cada opción como un plato); `columnas` va dentro de
 * su tanda (`TandaFila`). Sin `presentacion` (un producto sin opciones, o una carta guardada por el código anterior) se dibuja como antes.
 */
function ItemFila({ item, estilo }: { item: ItemCartaPublico; estilo: EstiloCarta }) {
  const colores = coloresDelItem(item.especial, estilo.valores);
  const p = item.presentacion;
  if (p?.forma === "simple") {
    return (
      <li data-forma="simple" className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
        <div className="flex items-baseline justify-between gap-3">
          <NombreDelItem item={item} colores={colores} />
          <PrecioDelRenglon item={item} color={colores.precio} />
        </div>
        <DescripcionYTags item={item} colores={colores} />
        <Aclaraciones aclaraciones={p.aclaraciones} color={colores.descripcion} />
      </li>
    );
  }
  if (p?.forma === "tabla") {
    // Dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo; DEC-06, DEC-10, DEC-11): una tabla real con el nombre arriba, en la esquina (un h3 en una celda común: el HTML no admite
    // títulos dentro de un th), los rótulos de las columnas como encabezados de columna y una fila por opción del otro eje (nunca se juntan aunque cuesten igual), cada una con su precio.
    return (
      <li data-forma="tabla" className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
        <table data-tabla-carta className="w-full border-collapse">
          <thead>
            <tr>
              <td className="pb-0.5 pr-1 text-left align-bottom">
                <NombreDelItem item={item} colores={colores} />
                {item.descuentoPorcentaje !== undefined && <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />}
              </td>
              <EncabezadosDeColumna rotulos={p.columnas} />
            </tr>
          </thead>
          <tbody>
            {p.filas.map((f, i) => (
              <tr key={`fila-${i}`}>
                <th scope="row" data-rol="opcion" className="carta-rol-opcion py-0.5 pr-1 text-left align-baseline" style={{ overflowWrap: "anywhere" }}>
                  {f.rotulo}
                </th>
                {f.celdas.map((precio, c) => (
                  <td key={`celda-${c}`} className="whitespace-nowrap py-0.5 pl-3 text-right align-baseline">
                    <CeldaDePrecio precio={precio} color={colores.precio} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <DescripcionYTags item={item} colores={colores} />
        <Aclaraciones aclaraciones={p.aclaraciones} color={colores.descripcion} />
      </li>
    );
  }
  if (p?.forma === "lista" && p.encabezado) {
    // Un eje en filas con el nombre arriba (un producto directo con filas, o una base con «Mostrar el nombre arriba»; DEC-11): el nombre sin precio y una fila por opción con su precio final.
    return (
      <li data-forma="lista" className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
        <div className="flex items-baseline justify-between gap-3">
          <NombreDelItem item={item} colores={colores} />
          {item.descuentoPorcentaje !== undefined && <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />}
        </div>
        <DescripcionYTags item={item} colores={colores} />
        <FilasDeOpcion nombre={item.nombre} filas={p.filas} colorPrecio={colores.precio} />
        <Aclaraciones aclaraciones={p.aclaraciones} color={colores.descripcion} />
      </li>
    );
  }
  if (p?.forma === "lista") {
    // Una BASE de un eje, OCULTA (DEC-11, el default: las pizzas): cada opción se lee como un plato, con su nombre completo (h3, rol Producto) y su precio (rol Precio): «Pizza muzzarella $18.000».
    // El producto base no se nombra (su descripción, sus tags y su ★ no salen: lo avisa el diagnóstico interno); la lista lleva su nombre para el lector de pantalla.
    return (
      <li data-forma="lista-sin-encabezado" style={{ borderColor: "var(--carta-border)" }}>
        <ul aria-label={item.nombre} data-filas-carta className="flex flex-col divide-y" style={{ borderColor: "var(--carta-border)" }}>
          {p.filas.map((f, i) => (
            <li key={`fila-${i}`} className="flex items-baseline justify-between gap-3 py-2.5" style={{ borderColor: "var(--carta-border)" }}>
              <h3 data-rol="producto" className="carta-rol-producto min-w-0 flex-1 carta-titulo" style={{ color: colores.nombre, overflowWrap: "anywhere" }}>
                {f.rotulo}
              </h3>
              <span data-rol="precio" className="carta-rol-precio shrink-0 carta-titulo" style={{ color: colores.precio }}>
                {formatearPrecioCarta(f.precio)}
              </span>
            </li>
          ))}
        </ul>
        {(item.descuentoPorcentaje !== undefined || p.aclaraciones.length > 0) && (
          <div className="pb-2.5">
            {item.descuentoPorcentaje !== undefined && <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />}
            <Aclaraciones aclaraciones={p.aclaraciones} color={colores.descripcion} />
          </div>
        )}
      </li>
    );
  }
  return <ItemComoAntes item={item} colores={colores} />;
}

/**
 * Las filas de un eje bajo el nombre del plato (rol Opción): «Chico ........ $2.500», siempre a la vista (sin desplegable), con el precio FINAL de cada una. Una lista (`ul`) con el nombre del plato
 * para el lector de pantalla; los puntitos son decoración (`aria-hidden`).
 */
function FilasDeOpcion({ nombre, filas, colorPrecio }: { nombre: string; filas: readonly { rotulo: string; precio: number }[]; colorPrecio: string }) {
  return (
    <ul aria-label={nombre} data-filas-carta className="mt-1.5 flex flex-col">
      {filas.map((f, i) => (
        <li key={`fila-${i}`} className="flex items-baseline gap-1.5 py-0.5">
          <span data-rol="opcion" className="carta-rol-opcion min-w-0" style={{ overflowWrap: "anywhere" }}>
            {f.rotulo}
          </span>
          <span aria-hidden="true" className="min-w-3 flex-1 -translate-y-1 border-b-[1.5px] border-dotted" style={{ borderColor: "color-mix(in oklch, var(--carta-ink-soft) 55%, transparent)" }} />
          <span data-rol="opcion-precio" className="carta-rol-opcion-precio shrink-0 carta-titulo" style={{ color: colorPrecio }}>
            {formatearPrecioCarta(f.precio)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Una celda de precio de una tabla (rol Opción, 600), o «–» donde el producto no ofrece esa opción (con «no se ofrece» para el lector de pantalla: no depende de ver la raya). */
function CeldaDePrecio({ precio, color }: { precio: number | null; color: string }) {
  if (precio === null) {
    return (
      <>
        <span aria-hidden="true" data-rol="opcion" className="carta-rol-opcion" style={{ color: "var(--carta-ink-soft)" }}>
          –
        </span>
        <span className="sr-only">no se ofrece</span>
      </>
    );
  }
  return (
    <span data-rol="opcion-precio" className="carta-rol-opcion-precio carta-titulo" style={{ color }}>
      {formatearPrecioCarta(precio)}
    </span>
  );
}

/** Los rótulos de las columnas de una tabla (rol Aclaración 600), como encabezados de columna reales. */
function EncabezadosDeColumna({ rotulos }: { rotulos: readonly string[] }) {
  return rotulos.map((r, i) => (
    <th key={`columna-${i}`} scope="col" data-rol="aclaracion-rotulo" className="carta-rol-aclaracion-rotulo pb-0.5 pl-3 text-right align-bottom" style={{ color: "var(--carta-ink-soft)" }}>
      {r}
    </th>
  ));
}

/**
 * Una TANDA (DEC-06, forma `columnas`): los productos consecutivos de la sección que comparten el grupo que define el precio (el café y el cortado: Chico | Mediano | Grande) en UNA tabla real
 * (`<table>`, con `<th scope="col">` en los rótulos y `<th scope="row">` en cada producto: el HTML no admite un título dentro de una celda de encabezado, así que acá el nombre no es un `h3`), con
 * «–» donde un producto no ofrece un tamaño. Debajo de cada producto, en una fila que ocupa todo el ancho, su descripción, sus tags y sus aclaraciones. Sin «desde»: cada celda dice su precio.
 */
function TandaFila({ tanda, items, estilo }: { tanda: TandaCartaPublica; items: readonly ItemCartaPublico[]; estilo: EstiloCarta }) {
  return (
    <li data-tanda className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
      <table data-tabla-carta className="w-full border-collapse">
        <thead>
          <tr>
            <td />
            <EncabezadosDeColumna rotulos={tanda.rotulos} />
          </tr>
        </thead>
        <tbody>
          {items.map((item, k) => (
            <FilaDeTanda key={`fila-${k}`} item={item} columnas={tanda.rotulos.length} primera={k === 0} estilo={estilo} />
          ))}
        </tbody>
      </table>
    </li>
  );
}

function FilaDeTanda({ item, columnas, primera, estilo }: { item: ItemCartaPublico; columnas: number; primera: boolean; estilo: EstiloCarta }) {
  const colores = coloresDelItem(item.especial, estilo.valores);
  const celdas = item.presentacion?.forma === "columnas" ? item.presentacion.celdas : Array.from({ length: columnas }, () => null);
  const aclaraciones = item.presentacion?.aclaraciones ?? [];
  const conDetalle = item.descripcion !== null || item.tags.length > 0 || aclaraciones.length > 0;
  const borde = primera ? undefined : { borderTopWidth: 1, borderColor: "var(--carta-border)" };
  return (
    <>
      <tr style={borde}>
        <th scope="row" className="py-1 pr-1 text-left align-baseline font-normal">
          <span data-rol="producto" className="carta-rol-producto carta-titulo" style={{ color: colores.nombre, overflowWrap: "anywhere" }}>
            {item.nombre}
            {item.especial && <Estrella color={colores.estrella} />}
          </span>
          {item.descuentoPorcentaje !== undefined && (
            <>
              {" "}
              <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />
            </>
          )}
        </th>
        {celdas.map((precio, c) => (
          <td key={`celda-${c}`} className="whitespace-nowrap py-1 pl-3 text-right align-baseline">
            <CeldaDePrecio precio={precio} color={colores.precio} />
          </td>
        ))}
      </tr>
      {conDetalle && (
        <tr>
          <td colSpan={columnas + 1} className="pb-1.5">
            <DescripcionYTags item={item} colores={colores} />
            <Aclaraciones aclaraciones={aclaraciones} color={colores.descripcion} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Un ítem sin forma: sin opciones (el renglón de siempre) o con las listas de antes (`grupos` y `opcionesSinCosto`), mientras falte `presentacion`. */
function ItemComoAntes({ item, colores }: { item: ItemCartaPublico; colores: ColoresDelItem }) {
  // CARTA-B: lo que llega en `grupos` ya es SOLO lo que cambia el precio (lo decide el servidor): los tamaños con su precio final y lo que suma o resta una variante o un adicional.
  const tamanos = (item.grupos ?? []).map((g) => ({ nombre: g.nombre, filas: g.opciones.flatMap((o) => (o.tipo === "final" ? [{ nombre: o.nombre, precio: o.precio }] : [])) })).filter((g) => g.filas.length > 0);
  const recargos = (item.grupos ?? []).flatMap((g) => g.opciones.flatMap((o) => (o.tipo === "recargo" ? [{ nombre: o.nombre, recargo: o.recargo }] : [])));
  // CARTA-C: lo que NO cambia el precio (preparación, guarnición, punto de cocción) también llega, aparte y solo con nombres, para dibujarlo como pastillas bajo el nombre de su grupo.
  const sinCosto = (item.opcionesSinCosto ?? []).filter((g) => g.opciones.length > 0);
  // Con una lista de tamaños el renglón del nombre va SIN precio (cada tamaño lo dice); sin ella, el precio base queda a la derecha como siempre.
  const tamanosEnLista = tamanos.length > 0;

  return (
    <li className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <NombreDelItem item={item} colores={colores} />
        {tamanosEnLista ? (
          item.descuentoPorcentaje !== undefined && <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />
        ) : (
          <PrecioDelRenglon item={item} color={colores.precio} />
        )}
      </div>
      <DescripcionYTags item={item} colores={colores} />
      {item.opciones && item.opciones.length > 0 && (
        <p data-rol="aclaracion" className="carta-rol-aclaracion mt-0.5">
          {item.opciones.map((o) => o.nombre).join(" · ")}
        </p>
      )}
      {tamanos.map((g, i) => (
        <TamanosDelItem key={`tamanos-${i}`} nombre={g.nombre} filas={g.filas} colorNombre={colores.descripcion} colorPrecio={colores.precio} />
      ))}
      {sinCosto.map((g, i) => (
        <OpcionesSinCostoDelItem key={`sin-costo-${i}`} grupo={g.grupo} opciones={g.opciones} />
      ))}
      {recargos.length > 0 && <RecargosDelItem recargos={recargos} color={colores.descripcion} />}
    </li>
  );
}

/**
 * CARTA-B (decisión del dueño, variante B «lista clásica»): los tamaños de un producto como un renglón por tamaño, «Chico ........ $2.500», SIEMPRE a la vista (sin desplegable ni botón),
 * con el precio FINAL de cada uno. Es una lista (`ul`) con el nombre del grupo como etiqueta para el lector de pantalla; los puntitos son decoración (`aria-hidden`) y usan el color de
 * borde del tema. Solo presentación: los precios vienen calculados del servidor. Rol Opción de la escala única (16 px; el precio en 600).
 */
function TamanosDelItem({ nombre, filas, colorNombre, colorPrecio }: { nombre: string; filas: { nombre: string; precio: number }[]; colorNombre: string | undefined; colorPrecio: string }) {
  return (
    <ul aria-label={nombre} data-tamanos-carta={nombre} className="mt-1.5 flex flex-col">
      {filas.map((f, i) => (
        <li key={`tamano-${i}`} className="flex items-baseline gap-1.5 py-0.5" style={{ color: colorNombre }}>
          <span data-rol="opcion" className="carta-rol-opcion min-w-0" style={{ overflowWrap: "anywhere" }}>
            {f.nombre}
          </span>
          <span aria-hidden="true" className="min-w-3 flex-1 -translate-y-1 border-b-[1.5px] border-dotted" style={{ borderColor: "color-mix(in oklch, var(--carta-ink-soft) 55%, transparent)" }} />
          <span data-rol="opcion-precio" className="carta-rol-opcion-precio shrink-0 carta-titulo" style={{ color: colorPrecio }}>
            {formatearPrecioCarta(f.precio)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * CARTA-C (decisión del dueño, variante B «pastillas»): las opciones que NO cambian el precio (preparación «Solo» · «Flat white» · «Cortado», guarnición, punto de cocción), siempre a la vista, bajo el
 * nombre de su grupo: una etiqueta en negrita y cada opción en una cajita redondeada. NO son botones (no se eligen acá: las elige el mozo en el POS), así que no llevan `role` ni `tabindex`. Es una lista
 * (`ul`) con el nombre del grupo como etiqueta para el lector de pantalla (la etiqueta visible se oculta del lector para que no lo lea dos veces); las pastillas pasan a la línea siguiente si no entran
 * (sin desborde horizontal). Los nombres son texto del negocio y se escapan como cualquier otro texto de React. Colores del tema de la sucursal (borde y fondo derivados de `--carta-ink-soft`).
 * Rol Aclaración de la escala única (14 px; la etiqueta en 600).
 */
function OpcionesSinCostoDelItem({ grupo, opciones }: { grupo: string; opciones: string[] }) {
  return (
    <div data-opciones-sin-costo={grupo} className="mt-2.5">
      <p aria-hidden="true" data-rol="aclaracion-rotulo" className="carta-rol-aclaracion-rotulo" style={{ color: "var(--carta-ink)", overflowWrap: "anywhere" }}>
        {grupo}
      </p>
      <ul aria-label={grupo} className="flex flex-wrap gap-x-1.5">
        {opciones.map((nombre, i) => (
          <li
            key={`pastilla-${i}`}
            data-rol="aclaracion"
            className="carta-rol-aclaracion mt-1 max-w-full rounded-full border px-3 py-[3px]"
            style={{
              color: "var(--carta-ink)",
              overflowWrap: "anywhere",
              borderColor: "color-mix(in oklch, var(--carta-ink-soft) 40%, transparent)",
              background: "color-mix(in oklch, var(--carta-ink-soft) 7%, transparent)",
            }}
          >
            {nombre}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CARTA-B: lo que suma (o resta) una variante o un adicional, en UNA línea: «Adicionales: Con leche +$400 · Medialuna +$600 · Shot +$500», siempre visible. Cada opción es un bloque en línea para
 * que su nombre y su monto no queden en renglones distintos. Rol Aclaración de la escala única (14 px).
 */
function RecargosDelItem({ recargos, color }: { recargos: { nombre: string; recargo: number }[]; color: string | undefined }) {
  return (
    <p data-suma-carta data-rol="aclaracion" className="carta-rol-aclaracion mt-1.5" style={{ color: color ?? "var(--carta-ink-soft)" }}>
      <strong data-rol="aclaracion-rotulo" className="carta-rol-aclaracion-rotulo" style={{ color: "var(--carta-ink)" }}>
        Adicionales:
      </strong>{" "}
      {recargos.map((r, i) => (
        <Fragment key={`suma-${i}`}>
          {i > 0 && " · "}
          <span className="inline-block max-w-full" style={{ overflowWrap: "anywhere" }}>{`${r.nombre} ${recargoEnPesos(r.recargo)}`}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** Una promo: con los mismos roles que un plato (DEC-35: antes no tenía piso). */
function PromoFila({ promo }: { promo: PromoCartaPublica }) {
  return (
    <li className="py-2.5" style={{ borderColor: "var(--carta-border)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 data-rol="producto" className="carta-rol-producto min-w-0 flex-1 carta-titulo">
          {promo.titulo}
        </h3>
        <span data-rol="precio" className="carta-rol-precio shrink-0 carta-titulo" style={{ color: "var(--carta-primary)" }}>
          {formatearPrecioCarta(promo.precio)}
        </span>
      </div>
      {promo.descripcion && (
        <p data-rol="aclaracion" className="carta-rol-aclaracion mt-0.5">
          {promo.descripcion}
        </p>
      )}
    </li>
  );
}
