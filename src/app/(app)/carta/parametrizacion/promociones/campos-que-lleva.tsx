import { CampoNumero } from "@/components/campo-numero";
import { esCantidadExacta } from "@/core/carta/public";
import { Casilla } from "@/ui/primitivas/casilla";

/**
 * Armado de promos «como Pedernal» (`ARMADO_DE_PROMO_COMO_PEDERNAL`, primer paso, solo pantalla): «Qué lleva» con lo que la promo YA lleva arriba y, plegado en «Agregar un componente», el resto de las
 * secciones de la carta. Son los MISMOS campos que `CamposCupos` (`incluir_{id}`, `min_{id}`, `max_{id}`) y se guardan con la misma acción: lo que cambia es el orden en la pantalla. Los campos de lo plegado se
 * mandan igual (un `<details>` cerrado no los quita del formulario). Todo nace cerrado: una sección sin tildar no entra en la promo.
 */
const CLASE_FILA = "grid grid-cols-2 gap-2 rounded border p-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:rounded-none sm:border-0 sm:p-0";
const CLASE_NOMBRE = "col-span-2 sm:min-w-[10rem] [overflow-wrap:anywhere]";
const CLASE_CANTIDAD = "flex flex-col gap-1 sm:flex-row sm:items-center";
const CLASE_NUMERO = "w-full sm:w-20";

type SeccionParaElegir = { id: string; nombre: string; activa: boolean };
type CupoGuardado = { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number };

function Fila({ s, g }: { s: SeccionParaElegir; g: CupoGuardado | undefined }) {
  return (
    <div data-cupo-seccion={s.nombre} className={CLASE_FILA}>
      <div className={CLASE_NOMBRE}>
        <Casilla etiqueta={`${s.nombre}${s.activa ? "" : " (apagada)"}`} name={`incluir_${s.id}`} defaultChecked={!!g} />
      </div>
      {g && !esCantidadExacta(g.cantidadMinima, g.cantidadMaxima) ? (
        <>
          <label className={CLASE_CANTIDAD}>
            mín.
            <CampoNumero tipo="entero" etiqueta="El mínimo" name={`min_${s.id}`} defaultValue={String(g.cantidadMinima)} className={CLASE_NUMERO} />
          </label>
          <label className={CLASE_CANTIDAD}>
            máx.
            <CampoNumero tipo="entero" etiqueta="El máximo" name={`max_${s.id}`} defaultValue={String(g.cantidadMaxima)} className={CLASE_NUMERO} />
          </label>
        </>
      ) : (
        <label className={`${CLASE_CANTIDAD} col-span-2`}>
          Cantidad
          <CampoNumero tipo="entero" etiqueta="La cantidad exacta" name={`cantidad_${s.id}`} defaultValue={String(g?.cantidadMaxima ?? 1)} className={CLASE_NUMERO} />
        </label>
      )}
    </div>
  );
}

export function CamposQueLleva({ secciones, guardados }: { secciones: SeccionParaElegir[]; guardados: CupoGuardado[] }) {
  const porSeccion = new Map(guardados.map((c) => [c.seccionCartaId, c]));
  const queLleva = secciones.filter((s) => porSeccion.has(s.id));
  const restantes = secciones.filter((s) => !porSeccion.has(s.id));
  return (
    <div className="flex flex-col gap-2">
      {queLleva.length > 0 && (
        <div className="flex flex-col gap-1" data-que-lleva>
          {queLleva.map((s) => (
            <Fila key={s.id} s={s} g={porSeccion.get(s.id)} />
          ))}
          <p className="text-xs text-tinta-tenue">Para quitar un componente, destildalo y guardá.</p>
        </div>
      )}
      {restantes.length > 0 && (
        <details className="rounded border p-2" data-agregar-componente>
          <summary className="cursor-pointer text-sm font-medium max-md:min-h-11 max-md:py-2">Agregar un componente</summary>
          <p className="mt-2 text-sm text-tinta-tenue">Tildá la sección de la carta de la que el mozo elige y poné cuántos productos (mín. y máx.).</p>
          <div className="mt-2 flex flex-col gap-1">
            {restantes.map((s) => (
              <Fila key={s.id} s={s} g={undefined} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
