import { SUMAR_LUGAR_DE_LISTA_VISIBLE, type LugarDeCombo, type ProductoParaMantener } from "@/core/carta/public";
import { CampoNumero } from "@/components/campo-numero";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { Selector } from "@/ui/primitivas/selector";

/**
 * CARTA-MANT (prototipo aprobado): los formularios de PARAMETRIZACIÓN de la carta —lo que se cambia pocas veces— que antes iban apilados en `/carta` y ahora viven detrás de cada tarjeta del hub
 * (`/carta/parametrizacion/{secciones,generos,promociones}`). Son los MISMOS formularios, con las mismas Server Actions y los mismos permisos (movidos tal cual). La ficha de cada producto (descripción, tags, ★, género, sección y orden,
 * descuento y «Quitar de la carta») ya no vive acá: es `ContenidoDelProducto` (`src/components/carta/contenido-del-producto.tsx`), que comparte con el espacio del producto (Fase 6, 6.17a).
 */
// MOVIL (O.461): los campos y los botones salen de las primitivas del sistema (`Campo`, `Selector`, `Boton`…): 44 px de alto como mínimo en celular y el texto de los campos a 16 px (iOS hace zoom con menos).
/** Un número corto (mín./máx.…): a todo el ancho de su columna en celular, de 5 rem desde `sm`. */
const CLASE_NUMERO = "w-full sm:w-20";
/**
 * Una fila del bloque «Cupos» (una sección o un lugar de entradas). En celular es una tarjetita: el nombre con su casilla arriba, a todo el ancho, y «mín.» y «máx.» abajo, lado a lado
 * (antes los cinco campos se rompían de a uno por renglón y no se sabía de quién era cada uno); desde `sm`, la fila de siempre.
 */
const CLASE_FILA_DE_CUPO = "grid grid-cols-2 gap-2 rounded border p-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:rounded-none sm:border-0 sm:p-0";
const CLASE_NOMBRE_DE_CUPO = "col-span-2 sm:min-w-[10rem] [overflow-wrap:anywhere]";
const CLASE_CANTIDAD_DE_CUPO = "flex flex-col gap-1 sm:flex-row sm:items-center";

/**
 * CARTA-MANT: un grupo plegado de la carta (una sección, los ocultos sin sección o los que están dentro de un agrupado): el nombre con cuántos productos tiene (y cuántos ocultos) en el resumen,
 * y adentro el renglón de cada uno. Plegado por defecto, como en el prototipo («tocá una sección para ver sus productos»).
 */
export function GrupoDeLaCarta({
  nombre,
  detalle,
  productos,
  vacio,
  fila,
}: {
  nombre: string;
  detalle: string | null;
  productos: ProductoParaMantener[];
  vacio: string;
  fila: (p: ProductoParaMantener) => React.ReactNode;
}) {
  const ocultos = productos.filter((p) => p.contenido && !p.contenido.visibleEnCarta).length;
  return (
    <details className="rounded border" data-grupo-de-la-carta={nombre}>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2">
        <span className="font-medium [overflow-wrap:anywhere]">{nombre}</span>
        <span className="text-sm text-tinta-suave">
          {productos.length} producto{productos.length === 1 ? "" : "s"}
          {ocultos ? ` · ${ocultos} oculto${ocultos === 1 ? "" : "s"}` : ""}
          {detalle ? ` · ${detalle}` : ""}
        </span>
      </summary>
      <ul className="flex flex-col gap-2 border-t p-3">
        {productos.map(fila)}
        {!productos.length && vacio && <li className="text-sm text-tinta-tenue">{vacio}</li>}
      </ul>
    </details>
  );
}

export function CamposSeccion({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; titulo: string | null; descripcion: string | null; imagenUrl: string | null; orden: number };
  /** Alta (DA5): el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      {/* El «Nombre» de la sección lleva su rótulo atado por afuera (y no el `etiqueta` de Campo): con `required` Campo le suma un asterisco al texto y esta pantalla la fotografía la línea de base de navegador (el golden no cambia). */}
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Nombre</span>
        <Campo nombradoPorFuera name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Platos Principales" />
      </label>
      <Campo etiqueta="Título (opcional, si no se usa el nombre)" name="titulo" defaultValue={valores?.titulo ?? ""} placeholder="Del fuego" />
      <div className="sm:col-span-2">
        <AreaDeTexto etiqueta="Descripción (opcional)" name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} />
      </div>
      <Campo etiqueta="Imagen (URL https, opcional)" name="imagenUrl" type="url" defaultValue={valores?.imagenUrl ?? ""} placeholder="https://…" />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Orden</span>
        <CampoNumero tipo="entero" etiqueta="El orden" name="orden" defaultValue={String(valores?.orden ?? ordenSugerido)} permitirNegativo />
      </label>
    </>
  );
}

export function CamposGenero({
  valores,
  ordenSugerido = 0,
}: {
  valores?: { nombre: string; orden: number };
  /** Alta: el orden inicial; al editar se muestra el guardado. */
  ordenSugerido?: number;
}) {
  return (
    <>
      <Campo etiqueta="Nombre" name="nombre" required defaultValue={valores?.nombre ?? ""} placeholder="Cerveza" />
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Orden</span>
        <CampoNumero tipo="entero" etiqueta="El orden" name="orden" defaultValue={String(valores?.orden ?? ordenSugerido)} permitirNegativo />
      </label>
    </>
  );
}

export function CamposPromo({
  secciones,
  valores,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  valores?: { seccionCartaId: string; titulo: string; descripcion: string | null; precio: number; orden: number };
}) {
  return (
    <>
      <Campo etiqueta="Título" name="titulo" required defaultValue={valores?.titulo ?? ""} placeholder="1 pizza + coca 1,5 L" />
      <Selector etiqueta="Sección de carta" name="seccionCartaId" required defaultValue={valores?.seccionCartaId ?? ""}>
        {!valores && <option value="">— elegí una —</option>}
        {secciones.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
            {s.activa ? "" : " (apagada)"}
          </option>
        ))}
      </Selector>
      <div className="sm:col-span-2">
        <AreaDeTexto etiqueta="Descripción (opcional)" name="descripcion" rows={2} defaultValue={valores?.descripcion ?? ""} />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          Precio<span aria-hidden="true"> *</span>
        </span>
        <CampoNumero tipo="importe" etiqueta="El precio" name="precio" prefijo="$" required defaultValue={valores ? String(valores.precio) : ""} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Orden</span>
        <CampoNumero tipo="entero" etiqueta="El orden" name="orden" defaultValue={String(valores?.orden ?? 0)} permitirNegativo />
      </label>
    </>
  );
}

/**
 * Cupos de una promo ARMABLE (Task #16, docs/plan-promo-combo-2026-09-26.md, D1): una fila por CADA sección de carta, con un
 * checkbox "incluir" + mínimo/máximo — full-replace al guardar (`guardarCuposPromoCarta`): la sección tildada con sus
 * cantidades entra, la que no queda tildada se borra si ya era un cupo. Sin cliente propio: los checkboxes e inputs son HTML
 * nativo, `FormConResultado` ya resetea el form entero cuando la acción sale bien (vuelve a los `defaultValue`/`defaultChecked`
 * de lo recién guardado, en el próximo render del servidor).
 */
/** GO-3b: ¿un lugar LISTA viene FIJO? (una sola entrada activa y mínimo = máximo, de 1 o más: lo completa el servidor). Una entrada «el mozo elige» no es fija: el mozo elige entre sus opciones. */
export function esFijo(l: LugarDeCombo): boolean {
  return l.tipo === "LISTA" && l.entradas.filter((e) => e.activa).length === 1 && l.entradas.every((e) => !e.activa || e.modoDeOpciones === "FIJAS") && l.cantidadMinima >= 1 && l.cantidadMinima === l.cantidadMaxima;
}

/**
 * GO-3b (U1): los lugares de ENTRADAS de la promo en el formulario de cupos: cada uno con «incluir» (destildado, se da de baja: sus entradas quedan guardadas por si vuelve) y su mínimo y máximo;
 * el nombre es su identidad (cambiarlo es otro lugar). Abajo, una fila para sumar un lugar nuevo: una LISTA («Bebida»).
 */
export function CamposLugares({ lugares }: { lugares: LugarDeCombo[] }) {
  return (
    <div className="flex flex-col gap-1">
      {lugares.map((l) => (
        <div key={l.id} data-cupo-lugar={l.nombre} className={CLASE_FILA_DE_CUPO}>
          <input type="hidden" name="lugar_id" value={l.id} />
          <input type="hidden" name={`lugar_tipo_${l.id}`} value={l.tipo} />
          <input type="hidden" name={`lugar_nombre_${l.id}`} value={l.nombre} />
          <div className={CLASE_NOMBRE_DE_CUPO}>
            <Casilla etiqueta={`${l.nombre} (lista)`} name={`lugar_incluir_${l.id}`} defaultChecked />
          </div>
          <label className={CLASE_CANTIDAD_DE_CUPO}>
            mín.
            <CampoNumero tipo="entero" etiqueta="El mínimo" name={`lugar_min_${l.id}`} defaultValue={String(l.cantidadMinima)} className={CLASE_NUMERO} />
          </label>
          <label className={CLASE_CANTIDAD_DE_CUPO}>
            máx.
            <CampoNumero tipo="entero" etiqueta="El máximo" name={`lugar_max_${l.id}`} defaultValue={String(l.cantidadMaxima)} className={CLASE_NUMERO} />
          </label>
        </div>
      ))}
      {/* «Sumar un lugar» (`SUMAR_LUGAR_DE_LISTA_VISIBLE`: apagado el 2026-10-28, vuelto a prender el 2026-11-11 por el pedido del «Menú ejecutivo»); aparece solo con su interruptor. */}
      {SUMAR_LUGAR_DE_LISTA_VISIBLE && (
        <fieldset className="mt-1 grid min-w-0 grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap sm:items-end">
          <legend className="mb-1 text-sm">Sumar un lugar (opcional)</legend>
          <div className="col-span-2">
            <Selector etiqueta="Tipo" name="nuevo_lugar_tipo" defaultValue="LISTA">
              <option value="LISTA">Lista de productos</option>
            </Selector>
          </div>
          <div className="col-span-2">
            <Campo etiqueta="Nombre" name="nuevo_lugar_nombre" maxLength={80} placeholder="Ej.: Bebida" />
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">mín.</span>
            <CampoNumero tipo="entero" etiqueta="El mínimo" name="nuevo_lugar_min" defaultValue="1" className={CLASE_NUMERO} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">máx.</span>
            <CampoNumero tipo="entero" etiqueta="El máximo" name="nuevo_lugar_max" defaultValue="1" className={CLASE_NUMERO} />
          </label>
        </fieldset>
      )}
    </div>
  );
}

export function CamposCupos({
  secciones,
  guardados,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  guardados: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
}) {
  const porSeccion = new Map(guardados.map((c) => [c.seccionCartaId, c]));
  return (
    <div className="flex flex-col gap-1">
      {secciones.map((s) => {
        const g = porSeccion.get(s.id);
        return (
          <div key={s.id} data-cupo-seccion={s.nombre} className={CLASE_FILA_DE_CUPO}>
            <div className={CLASE_NOMBRE_DE_CUPO}>
              <Casilla etiqueta={`${s.nombre}${s.activa ? "" : " (apagada)"}`} name={`incluir_${s.id}`} defaultChecked={!!g} />
            </div>
            <label className={CLASE_CANTIDAD_DE_CUPO}>
              mín.
              <CampoNumero tipo="entero" etiqueta="El mínimo" name={`min_${s.id}`} defaultValue={String(g?.cantidadMinima ?? 0)} className={CLASE_NUMERO} />
            </label>
            <label className={CLASE_CANTIDAD_DE_CUPO}>
              máx.
              <CampoNumero tipo="entero" etiqueta="El máximo" name={`max_${s.id}`} defaultValue={String(g?.cantidadMaxima ?? 1)} className={CLASE_NUMERO} />
            </label>
          </div>
        );
      })}
    </div>
  );
}
