import { Fragment } from "react";
import type { AclaracionCartaPublica, BloqueDeOpciones, EstiloCarta, ItemCartaPublico, ParteDeIncluye, PromoCartaPublica, SeccionCartaPublica } from "@/core/carta/public";
import { cantidadDeLaParte, conectorDeLaParte, detalleDelBloque, formatearPrecioCarta, incluyeDeLaSeccion, partirLaAclaracion, recargoEnPesos, textoDeIncluye, textoDeLaAclaracion, textoDeLasOpciones, nombresDeLosPlatosDelItem, textoDeVaCon, textoDelTitulo, restoDeLaParte, vaConDelBloque } from "@/core/carta/public";
import { TagIcon } from "./iconos";
import { ListaDeLaSeccion } from "./lista-de-la-seccion";

/**
 * ADR-006, Fase 3: banda + ítems + promos de UNA sección de la carta — desenredado de `carta-view.tsx` (el `BandaContenido`
 * del original vivía DEFINIDO DENTRO del render de todo el componente, remontándose en cada render; acá es su propia
 * función a nivel de módulo). Sin la duplicación banda mobile/banda desktop del original: un solo bloque, con Tailwind
 * responsive. La imagen de sección es siempre el fondo de la banda: un `<img>` de fondo con `object-fit`, sin la lógica de
 * posicionamiento fino del original (nivel (a) del diagnóstico: correcto y accesible, no pixel-a-pixel idéntico).
 */
export function Seccion({
  seccion,
  indice,
  total,
  estilo,
  soloPantalla = false,
}: {
  seccion: SeccionCartaPublica;
  indice: number;
  total: number;
  estilo: EstiloCarta;
  /** Fase 5, paso 10b: la página es solo de pantalla (hoy hay algo agotado y el papel lleva la carta completa, `seccionesImpresas`). */
  soloPantalla?: boolean;
}) {
  const img = estilo.imagenSeccion;
  const c = estilo.colores;
  // Carta «B»: qué incluye cada plato y los bloques del pie de ESTA sección (la misma función en la carta pública, la impresa, la vista previa y «Va a mostrar»).
  const incluye = incluyeDeLaSeccion(seccion.items.map((i) => i.presentacion?.aclaraciones ?? []));
  // Invitación «5+2» (E2): lo que dice cada bloque mientras está iluminado («Va con: …»), con los nombres de los platos que lo incluyen.
  // Una base con la medida oculta se dibuja como varios platos (uno por renglón): «Va con» los nombra con lo que el cliente LEE, nunca con el nombre interno de la base (`nombresDeLosPlatosDelItem`).
  const platosConNombre = seccion.items.map((i, k) => ({ nombre: i.nombre, nombres: nombresDeLosPlatosDelItem(i), partes: incluye.platos[k] ?? [] }));
  // Un grupo que pertenece a UN SOLO plato de la sección va DEBAJO de ese plato (decisión del dueño, 2026-11-05: «los sabores quedaron al pie y son del jugo»), con cualquier cantidad de opciones y sin
  // «Con los platos que incluyen…» ni «Lo incluyen: …» (no hay otros platos). Los que usan varios platos siguen al pie, como antes.
  // (Un ítem que la carta dibuja como VARIOS platos —una base con la medida oculta, un renglón por opción— no es «un solo plato»: su grupo sigue al pie, como antes.)
  const esPropio = (b: BloqueDeOpciones) => b.platos.length === 1 && nombresDeLosPlatosDelItem(seccion.items[b.platos[0]!]!).length === 1;
  const compartidos = incluye.bloques.filter((b) => !esPropio(b));
  const vaCon = compartidos.map((b) => textoDeVaCon(vaConDelBloque(b, platosConNombre)));
  return (
    <div className={`carta-pagina flex flex-col${soloPantalla ? " carta-solo-pantalla" : ""}`}>
      <div
        data-carta-banda
        className="carta-borde relative h-[var(--banda-alto-m)] shrink-0 overflow-hidden border-b sm:h-[var(--banda-alto-d)]"
        style={{ "--banda-alto-m": estilo.banda.altoMobile, "--banda-alto-d": estilo.banda.altoDesktop } as React.CSSProperties}
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
          {/* Piso de 14 px (decisión del dueño): la descripción de la banda sigue al tema SOLO hacia arriba, como todo texto de la carta (`--carta-fs-aclaracion`: el piso del rol Aclaración). */}
          {seccion.descripcion && (
            <p className={`line-clamp-1 font-light leading-snug${c.bandaDescripcion ? "" : " opacity-70"}`} style={{ fontSize: `max(var(--carta-fs-aclaracion), ${estilo.valores.carta_fuente_banda_descripcion})`, color: c.bandaDescripcion ?? undefined }}>
              {seccion.descripcion}
            </p>
          )}
        </div>
      </div>

      {/* `tabIndex={0}`: la lista tiene scroll propio y con la carta «B» (platos + bloques al pie) casi siempre desborda; sin foco, quien navega con teclado no podría llegar a los bloques (axe: scrollable-region-focusable). */}
      <ListaDeLaSeccion nombre={seccion.titulo ?? seccion.nombre} className="carta-divisor min-h-0 flex-1 divide-y overflow-y-auto px-6 sm:px-10">
        {/* S-25: las `key` son la posición, no el id de la fila: React serializa la `key` de cada elemento en el payload RSC que baja al navegador. */}
        {seccion.items.map((item, i) => {
          const propios = incluye.bloques.filter((b) => esPropio(b) && b.platos[0] === i);
          return (
            <Fragment key={`item-${i}`}>
              <ItemFila item={item} estilo={estilo} incluye={(incluye.platos[i] ?? []).filter((x) => !propios.some((b) => b.titulo === x.grupo))} posicion={i} sinLineaAbajo={propios.length > 0} />
              <BloquesDeOpciones bloques={propios} propio />
            </Fragment>
          );
        })}
        {seccion.promos.map((promo, i) => (
          <PromoFila key={`promo-${i}`} promo={promo} />
        ))}
        <BloquesDeOpciones bloques={compartidos} vaCon={vaCon} />
      </ListaDeLaSeccion>
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
 * Carta «B» (decisión del dueño, 2026-11-04): lo que se elige SIN COSTO, dicho por el plato: «Incluye guarnición y salsa» (o, si admite solo algunas opciones del bloque, «Incluye guarnición: puré o
 * ensalada»). Rol Aclaración, con el color de la descripción del tema (o la tinta suave del tema): nunca un color fijo. El texto lo arma `textoDeIncluye` (`incluye-en-carta.ts`), el mismo de «Va a mostrar».
 */
function LineaIncluye({ partes, colores, interactiva = false }: { partes: readonly ParteDeIncluye[]; colores: ColoresDelItem; interactiva?: boolean }) {
  const texto = textoDeIncluye(partes);
  if (texto === null) return null;
  const estilo = { color: colores.descripcion ?? "var(--carta-ink-soft)", overflowWrap: "anywhere" } as const;
  if (!interactiva) {
    return (
      <p data-incluye data-rol="aclaracion" className="carta-rol-aclaracion mt-1" style={estilo}>
        {texto}
      </p>
    );
  }
  // Invitación «5+2» (E2): la palabra del grupo es un botón real que baja al bloque de ese grupo (`lista-de-la-seccion.tsx`), y la línea termina en «elegí abajo ↓» (la flecha rebota dos veces y queda quieta; con
  // «movimiento reducido» no se anima). En papel no hay interacción: el cue no sale (`carta-solo-pantalla`) y la palabra pierde el subrayado.
  const palabras = partes.map((x) => `${cantidadDeLaParte(x)}${x.palabraEnLinea}`);
  return (
    <p data-incluye data-rol="aclaracion" className="carta-rol-aclaracion mt-1" style={estilo}>
      {"Incluye "}
      {partes.map((x, k) => (
        <span key={`parte-${k}`}>
          {conectorDeLaParte(palabras, k)}
          {cantidadDeLaParte(x)}
          <button type="button" data-ir-al-bloque={x.grupo} aria-label={`Ir a las opciones de ${x.palabra}`} className="carta-palabra-tocable">
            {x.palabraEnLinea}
          </button>
          {restoDeLaParte(x)}
        </span>
      ))}
      <span className="carta-solo-pantalla" data-cue-abajo>
        {" · ver opciones "}
        <span aria-hidden="true" className="carta-flecha">
          ↓
        </span>
      </span>
    </p>
  );
}

/**
 * Los BLOQUES al pie de la sección (carta «B»), uno por grupo libre que usan sus platos: el título en Etiqueta («GUARNICIÓN · elegís 1»), las opciones en texto separadas por « · » (sin chips ni botones),
 * y a qué platos va («Con los platos que dicen «Incluye guarnición»»). Son filas de la misma lista que los platos (`li`), así se desplazan con ellos y la línea divisoria los separa. Todo con los tokens
 * del tema (`--carta-ink`, `--carta-ink-soft`): ni un color fijo. Lo comparte la carta pública, la impresa y la vista previa del producto.
 */
export function BloquesDeOpciones({ bloques, vaCon, propio = false }: { bloques: readonly BloqueDeOpciones[]; vaCon?: readonly (string | null)[]; propio?: boolean }) {
  // Con `vaCon` (la carta, no la vista previa del administrador) el bloque es el destino de la invitación «5+2»: recibe el foco al llegar, sabe qué platos lo incluyen y dice «Va con: …» mientras está iluminado.
  const destino = vaCon !== undefined;
  return bloques.map((b, i) => (
    <li key={`bloque-${i}`} data-bloque-de-opciones={b.titulo} {...(destino ? { "data-platos": b.platos.join(","), tabIndex: -1 } : {})} className="py-3" style={propio ? { borderTopWidth: 0 } : undefined}>
      <h4 data-rol="etiqueta" className="carta-rol-etiqueta uppercase tracking-wider" style={{ color: "var(--carta-ink-soft)", overflowWrap: "anywhere" }}>
        {textoDelTitulo(b)}
      </h4>
      <p data-rol="eleccion" className="carta-rol-eleccion mt-1" style={{ color: "var(--carta-ink)", overflowWrap: "anywhere" }}>
        {textoDeLasOpciones(b)}
      </p>
      {!propio && (
        <p data-rol="aclaracion" className="carta-rol-aclaracion mt-1" style={{ color: "var(--carta-ink-soft)", overflowWrap: "anywhere" }}>
          {b.paraLosPlatos}
        </p>
      )}
      <DetalleDelBloque bloque={b} />
      {destino && vaCon[i] && (
        <p data-va-con data-rol="aclaracion" className="carta-rol-aclaracion mt-1" style={{ color: "var(--carta-ink-soft)", overflowWrap: "anywhere" }}>
          {vaCon[i]}
        </p>
      )}
    </li>
  ));
}

/**
 * Carta «B», E3: las descripciones de las opciones de UN bloque. En pantalla, un desplegable nativo (`details`/`summary`: anda sin JavaScript y se maneja con teclado y lector de pantalla) con el rótulo genérico
 * «Ver detalle ▾» (nunca el nombre del grupo: un grupo de tamaños no «lleva» nada), que solo existe si alguna opción tiene descripción; los nombres de las opciones siguen siempre a la vista arriba. En papel
 * las descripciones van SIEMPRE visibles: el desplegable es solo de pantalla (`carta-solo-pantalla`) y una lista igual, solo de papel (`carta-solo-papel`), la reemplaza. Texto plano: React lo escapa.
 */
function DetalleDelBloque({ bloque }: { bloque: BloqueDeOpciones }) {
  const detalle = detalleDelBloque(bloque);
  if (detalle.length === 0) return null;
  const filas = detalle.map((d, i) => (
    <p key={`detalle-${i}`} data-rol="aclaracion" className="carta-rol-aclaracion mt-1" style={{ color: "var(--carta-ink-soft)", overflowWrap: "anywhere" }}>
      <span data-rol="aclaracion-rotulo" className="carta-rol-aclaracion-rotulo" style={{ color: "var(--carta-ink)" }}>
        {d.nombre}
      </span>
      {` · ${d.descripcion}`}
    </p>
  ));
  return (
    <>
      <details data-detalle-del-bloque className="carta-solo-pantalla mt-1">
        <summary data-rol="aclaracion" className="carta-rol-aclaracion min-h-[44px] cursor-pointer py-2" style={{ color: "var(--carta-ink)" }}>
          Qué lleva cada opción ▾
        </summary>
        {filas}
      </details>
      <div data-detalle-en-papel className="carta-solo-papel">
        {filas}
      </div>
    </>
  );
}

/**
 * Lo que se lee DEBAJO del plato (DEC-07), un GRUPO por aclaración en el orden del producto, en «P1»: la etiqueta del grupo (rol Aclaración 600, sin dos puntos); lo que NO cuesta en UNA línea
 * («ensalada · papas fritas · puré» si todo es gratis; «Sin cargo: solo · cortado» cuando el grupo mezcla gratis y con recargo; rol Elección); y cada opción que SÍ suma o resta en su PROPIA fila, con el recargo
 * a la derecha («+$200»; rol Opción). La partición es la de `partirLaAclaracion`, la misma que usa la vista previa de la administración.
 */
function GruposDeOpciones({ aclaraciones, colores }: { aclaraciones: readonly AclaracionCartaPublica[]; colores: ColoresDelItem }) {
  // Carta «B»: lo que se elige sin costo (`eleccion`) ya no se dibuja acá: lo dice la línea «Incluye …» del plato y el bloque al pie de la sección. Quedan los grupos con precio.
  return aclaraciones.filter((a) => a.tipo === "extras").map((a, i) => {
    const { libres, conRecargo } = partirLaAclaracion(a);
    return (
      <div key={`aclaracion-${i}`} data-aclaracion={a.rotulo} className="mt-3">
        <p data-rol="aclaracion-rotulo" className="carta-rol-aclaracion-rotulo" style={{ color: "var(--carta-ink)", overflowWrap: "anywhere" }}>
          {a.rotulo}
        </p>
        {libres && (
          <p data-rol="eleccion" className="carta-rol-eleccion mt-0.5" style={{ color: colores.descripcion, overflowWrap: "anywhere" }}>
            {libres}
          </p>
        )}
        {conRecargo.length > 0 && (
          <ul aria-label={a.rotulo} data-recargos-carta className="carta-divisor mt-0.5 flex flex-col divide-y">
            {conRecargo.map((r, k) => (
              <li key={`recargo-${k}`} className="flex items-baseline justify-between gap-3 py-1.5">
                <span data-rol="opcion" className="carta-rol-opcion min-w-0" style={{ overflowWrap: "anywhere" }}>
                  {r.nombre}
                </span>
                <span data-rol="opcion-precio" className="carta-rol-opcion-precio shrink-0 carta-titulo" style={{ color: colores.precio }}>
                  {recargoEnPesos(r.recargo)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  });
}

/**
 * Una aclaración del respaldo de `ItemComoAntes`: lo que llega en `opcionesSinCosto` no trae los límites del grupo (`cantidadMinima`/`cantidadMaxima`), así que no puede ir al bloque de la carta «B»
 * (que dice «elegís N») y sigue como línea de texto.
 */
type AclaracionDelRespaldo = { tipo: "eleccion"; rotulo: string; opciones: readonly string[] } | Extract<AclaracionCartaPublica, { tipo: "extras" }>;

/**
 * La línea ÚNICA de siempre, «Guarnición: ensalada, papas fritas o puré»: el rótulo en Aclaración 600 y el resto en Aclaración (`textoDeLaAclaracion`). Queda SOLO en `ItemComoAntes`: lo que la
 * carta no puede leer exacto sale como antes (no se le arma la jerarquía de grupos y filas).
 */
function Aclaraciones({ aclaraciones, color }: { aclaraciones: readonly AclaracionDelRespaldo[]; color: string | undefined }) {
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
 * debajo) o `tabla` (uno o dos ejes: el nombre como título, los encabezados de las columnas, una fila por opción; la base de un eje OCULTA, `titulo: false`, es cada opción como un plato). Sin
 * `presentacion` (un producto sin opciones, o uno cuya forma la carta no puede leer exacta) va `ItemComoAntes`.
 *
 * UNA sola jerarquía (decisión del dueño, 2026-10-29): el nombre del producto es el título (rol Producto, con su línea fina) y las filas son sus opciones (rol Opción); solo la base oculta, que no tiene
 * título, dibuja sus opciones como platos (rol Producto).
 */
export function ItemFila({ item, estilo, incluye, posicion, sinLineaAbajo = false }: { item: ItemCartaPublico; estilo: EstiloCarta; incluye: readonly ParteDeIncluye[]; posicion?: number; sinLineaAbajo?: boolean }) {
  // Con opciones propias debajo (2026-11-05) la línea divisoria no va entre el plato y SU bloque: se lee como parte del mismo plato.
  // (Con `style` y no con una clase de ancho: el contrato `borde-propio-de-carta` vigila las clases `border-*` con ancho, y esto no dibuja un borde, lo quita.)
  const sinLinea = sinLineaAbajo ? ({ borderBottomWidth: 0 } as const) : undefined;
  const colores = coloresDelItem(item.especial, estilo.valores);
  const p = item.presentacion;
  if (p?.forma === "simple") {
    return (
      <li data-forma="simple" data-plato={posicion} className="py-2.5" style={sinLinea}>
        <div className="flex items-baseline justify-between gap-3">
          <NombreDelItem item={item} colores={colores} />
          <PrecioDelRenglon item={item} color={colores.precio} />
        </div>
        <DescripcionYTags item={item} colores={colores} />
        <LineaIncluye partes={incluye} colores={colores} interactiva={posicion !== undefined} />
        <GruposDeOpciones aclaraciones={p.aclaraciones} colores={colores} />
      </li>
    );
  }
  if (p?.forma === "tabla" && p.titulo) return <TablaDelItem item={item} p={p} colores={colores} incluye={incluye} posicion={posicion} sinLinea={sinLinea} />;
  if (p?.forma === "tabla") {
    // Una BASE de un eje, OCULTA (DEC-11, el default: las pizzas): cada opción se lee como un plato, con su nombre completo (h3, rol Producto) y su precio (rol Precio): «Pizza muzzarella $18.000».
    // El producto base no se nombra (su descripción, sus tags y su ★ no salen: lo avisa el diagnóstico interno); la lista lleva su nombre para el lector de pantalla.
    const platos = p.filas.flatMap((f) => {
      const [precio] = f.celdas;
      return f.rotulo !== null && typeof precio === "number" ? [{ rotulo: f.rotulo, precio }] : [];
    });
    return (
      <li data-forma="lista-sin-encabezado" data-plato={posicion} style={sinLinea}>
        <FilasComoPlatos nombre={item.nombre} filas={platos} colores={colores} incluye={incluye} interactiva={posicion !== undefined} />
        {(item.descuentoPorcentaje !== undefined || p.aclaraciones.some((a) => a.tipo === "extras")) && (
          <div className="pb-2.5">
            {item.descuentoPorcentaje !== undefined && <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />}
            {platos.length >= 2 && p.aclaraciones.some((a) => a.tipo === "extras") ? (
              // Con 2 o más platos arriba, los grupos con precio valen para TODOS (no solo para el último): una línea más gruesa los separa de las filas. El rótulo «En todos» se retiró con la carta «B»
              // (2026-11-04): lo que se elige sin costo ya lo dice cada plato («Incluye …»).
              <div className="carta-borde border-t-2 pt-1.5">
                <GruposDeOpciones aclaraciones={p.aclaraciones} colores={colores} />
              </div>
            ) : (
              <GruposDeOpciones aclaraciones={p.aclaraciones} colores={colores} />
            )}
          </div>
        )}
      </li>
    );
  }
  return <ItemComoAntes item={item} colores={colores} />;
}

/**
 * Las filas de un eje como PLATOS (rol Producto en un h3, precio en rol Precio): «Pizza muzzarella $18.000». Una lista (`ul`) con el nombre del producto base para el lector de pantalla. Cada plato dice
 * lo que incluye (carta «B»): todos los de la base comparten las mismas elecciones sin costo, y la línea se repite bajo cada uno.
 */
function FilasComoPlatos({ nombre, filas, colores, incluye, interactiva }: { nombre: string; filas: readonly { rotulo: string; precio: number }[]; colores: ColoresDelItem; incluye: readonly ParteDeIncluye[]; interactiva: boolean }) {
  return (
    <ul aria-label={nombre} data-filas-carta className="carta-divisor flex flex-col divide-y">
      {filas.map((f, i) => (
        <li key={`fila-${i}`} className="py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 data-rol="producto" className="carta-rol-producto min-w-0 flex-1 carta-titulo" style={{ color: colores.nombre, overflowWrap: "anywhere" }}>
              {f.rotulo}
            </h3>
            <span data-rol="precio" className="carta-rol-precio shrink-0 carta-titulo" style={{ color: colores.precio }}>
              {formatearPrecioCarta(f.precio)}
            </span>
          </div>
          <LineaIncluye partes={incluye} colores={colores} interactiva={interactiva} />
        </li>
      ))}
    </ul>
  );
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

/**
 * Una celda de precio de una tabla (rol Opción precio), o «–» donde el producto no ofrece esa opción (con «no se ofrece» para el lector de pantalla: no depende de ver la raya). Las clases van escritas
 * enteras: el cerco de tipografía y Tailwind las necesitan visibles.
 */
function CeldaDePrecio({ precio, color }: { precio: number | null; color: string }) {
  return (
    <>
      <span aria-hidden={precio === null ? "true" : undefined} data-rol="opcion-precio" className="carta-rol-opcion-precio carta-titulo" style={{ color: precio === null ? "var(--carta-ink-soft)" : color }}>
        {precio === null ? "–" : formatearPrecioCarta(precio).replace("\u00a0", " ")}
      </span>
      {precio === null && <span className="sr-only">no se ofrece</span>}
    </>
  );
}

/**
 * La TABLA de un producto con uno o dos ejes (forma `tabla` con título): el nombre es el título (un `h3`, rol Producto, con su línea fina y el aviso del descuento a la derecha: el HTML no admite títulos
 * dentro de un `th`), los encabezados de las columnas (rol Columna) se REPITEN en cada producto, y cada fila es una opción (rol Opción) con el precio de cada celda (rol Opción precio, «–» donde no se
 * ofrece). Una fila sin rótulo es la única de un producto sin variantes (el lector de pantalla lee el nombre del producto). Las columnas de precio miden LO MISMO en toda la carta y van alineadas a la
 * derecha (`carta-col-precio`, `globals.css`): un Chico, un Mediano y un Grande quedan en la misma vertical aunque sean de productos distintos. Sin columnas con encabezado, una sola de precios.
 * Debajo, la descripción, los tags y las aclaraciones.
 */
function TablaDelItem({ item, p, colores, incluye, posicion, sinLinea }: { sinLinea?: { readonly borderBottomWidth: 0 }; item: ItemCartaPublico; p: Extract<NonNullable<ItemCartaPublico["presentacion"]>, { forma: "tabla" }>; colores: ColoresDelItem; incluye: readonly ParteDeIncluye[]; posicion?: number }) {
  return (
    <li data-forma="tabla" data-plato={posicion} className="carta-tabla pb-2.5 pt-3.5" style={sinLinea}>
      <div className="carta-linea-fina flex items-baseline justify-between gap-3 pb-1.5">
        <NombreDelItem item={item} colores={colores} />
        {item.descuentoPorcentaje !== undefined && <AvisoDeDescuento porcentaje={item.descuentoPorcentaje} color={colores.precio} />}
      </div>
      <table data-tabla-carta aria-label={item.nombre} className="mb-0.5 w-full table-fixed border-collapse">
        <colgroup>
          <col />
          {Array.from({ length: Math.max(1, p.columnas.length) }, (_, c) => (
            <col key={`ancho-${c}`} className="carta-col-precio" />
          ))}
        </colgroup>
        {p.columnas.length > 0 && (
          <thead>
            <tr>
              <td />
              {p.columnas.map((r, c) => (
                <th key={`col-${c}`} scope="col" data-rol="columna" className="carta-rol-columna pb-1 pl-1 pt-1 text-right align-bottom">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {p.filas.map((f, i) => (
            <tr key={`fila-${i}`} className={i > 0 ? "carta-borde border-t" : undefined}>
              <th scope="row" className="py-1.5 pr-1 text-left align-baseline font-normal">
                {f.rotulo === null ? (
                  <span className="sr-only">{item.nombre}</span>
                ) : (
                  <span data-rol="opcion" className="carta-rol-opcion" style={{ overflowWrap: "anywhere" }}>
                    {f.rotulo}
                  </span>
                )}
              </th>
              {f.celdas.map((precio, c) => (
                <td key={`celda-${c}`} className="py-1.5 pl-1 text-right align-baseline">
                  <CeldaDePrecio precio={precio} color={colores.precio} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <DescripcionYTags item={item} colores={colores} />
      <LineaIncluye partes={incluye} colores={colores} interactiva={posicion !== undefined} />
      <GruposDeOpciones aclaraciones={p.aclaraciones} colores={colores} />
    </li>
  );
}

/**
 * Un ítem SIN FORMA: sin opciones (el renglón de siempre), o con opciones que la carta no puede leer con el precio exacto (un tercer grupo que cambia el precio; un recargo dentro del precio con
 * descuento de producto: los avisa el diagnóstico interno) o de una carta guardada por el código anterior. Paso 9 (retiro de lo viejo): ya no hay listas, pastillas ni línea propias; lo que llega
 * en `grupos` y `opcionesSinCosto` se dibuja con las MISMAS piezas que las formas: los tamaños con su precio final como filas de opción y lo demás como aclaraciones debajo del plato.
 */
function ItemComoAntes({ item, colores }: { item: ItemCartaPublico; colores: ColoresDelItem }) {
  const respaldo = respaldoDeLasOpciones(item);
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <NombreDelItem item={item} colores={colores} />
        {respaldo.filas.length > 0 ? (
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
      {respaldo.filas.map((g, i) => (
        <FilasDeOpcion key={`filas-${i}`} nombre={g.nombre} filas={g.filas} colorPrecio={colores.precio} />
      ))}
      <Aclaraciones aclaraciones={respaldo.aclaraciones} color={colores.descripcion} />
    </li>
  );
}

/**
 * Lo que llega en `grupos` y `opcionesSinCosto` (sin forma) llevado a las piezas de las formas: cada grupo con precios FINALES (un tamaño), sus filas; lo que suma o resta, una aclaración
 * «Adicionales: con leche +$400, medialuna +$600»; lo que no cambia nada, una aclaración por grupo con sus opciones («Guarnición: papas fritas o puré»). Solo presentación: los precios vienen del
 * servidor.
 */
function respaldoDeLasOpciones(item: ItemCartaPublico): { filas: { nombre: string; filas: { rotulo: string; precio: number }[] }[]; aclaraciones: AclaracionDelRespaldo[] } {
  const filas = (item.grupos ?? [])
    .map((g) => ({ nombre: g.nombre, filas: g.opciones.flatMap((o) => (o.tipo === "final" ? [{ rotulo: o.nombre, precio: o.precio }] : [])) }))
    .filter((g) => g.filas.length > 0);
  const recargos = (item.grupos ?? []).flatMap((g) => g.opciones.flatMap((o) => (o.tipo === "recargo" ? [{ nombre: o.nombre, recargo: o.recargo }] : [])));
  const aclaraciones: AclaracionDelRespaldo[] = [
    ...(item.opcionesSinCosto ?? []).filter((g) => g.opciones.length > 0).map((g): AclaracionDelRespaldo => ({ tipo: "eleccion", rotulo: g.grupo, opciones: g.opciones })),
    ...(recargos.length > 0 ? [{ tipo: "extras" as const, rotulo: "Adicionales", opciones: recargos }] : []),
  ];
  return { filas, aclaraciones };
}

/** Una promo: con los mismos roles que un plato (DEC-35: antes no tenía piso). */
function PromoFila({ promo }: { promo: PromoCartaPublica }) {
  return (
    <li className="py-2.5">
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
