import { formatearPrecioCarta, textoDeLaAclaracion, type AclaracionCartaV1, type PresentacionCartaV1, type VistaPreviaDeLaCarta } from "@/core/carta/public";
import { Aviso } from "@/ui/primitivas/aviso";

/**
 * La VISTA PREVIA de un producto en la carta (Fase 6, bloque 3, 6.18): cómo lo va a leer la carta pública, dentro del espacio del producto (pasos 2 y 4). Es un componente de SERVIDOR que SOLO DIBUJA lo que
 * recibe: el servidor ya calculó la forma y los precios con la regla de la venta (`cargarVistaPreviaDeLaCarta`). Acá no se compone ni se redondea ningún precio, no se aplica ningún descuento ni se
 * arma un resumen: el archivo no puede importar `core/pos` (regla de dependency-cruiser `vista-previa-sin-calculo-de-precio`), así que no tiene con qué. Es de solo lectura, sin formularios.
 *
 * Las formas son las de la carta: el producto con su precio (`simple`), en columnas, en tabla, o en lista (con el nombre arriba o cada opción como un plato), y debajo lo que se elige o se suma.
 * Una celda sin precio dice «–» y, para el lector de pantalla, «no se ofrece». Solo tokens del sistema visual y sin modo oscuro (DEC-04).
 */
const SIN_PRECIO = (
  <>
    <span aria-hidden="true">–</span>
    <span className="sr-only">no se ofrece</span>
  </>
);

const precio = (x: number | null) => (x === null ? SIN_PRECIO : formatearPrecioCarta(x));

function Aclaraciones({ lista }: { lista: AclaracionCartaV1[] }) {
  if (lista.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-tinta-suave">
      {lista.map((a) => (
        <li key={a.rotulo}>
          <span className="font-medium text-tinta">{a.rotulo}:</span> {textoDeLaAclaracion(a)}
        </li>
      ))}
    </ul>
  );
}

const CELDA = "px-2 py-1 text-right tabular-nums";

function Forma({ nombre, presentacion, rotulos }: { nombre: string; presentacion: PresentacionCartaV1; rotulos: readonly string[] }) {
  switch (presentacion.forma) {
    case "simple":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="font-medium">{nombre}</span> con su precio.
          </p>
          <Aclaraciones lista={presentacion.aclaraciones} />
        </div>
      );
    case "columnas":
      return (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="pb-1 text-left font-medium">{nombre}</caption>
              <thead>
                <tr className="border-b border-borde text-tinta-suave">
                  {rotulos.map((r) => (
                    <th key={r} scope="col" className={`${CELDA} font-normal`}>
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {presentacion.celdas.map((c, i) => (
                    <td key={rotulos[i] ?? i} className={CELDA}>
                      {precio(c)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <Aclaraciones lista={presentacion.aclaraciones} />
        </div>
      );
    case "tabla":
      return (
        <div className="flex flex-col gap-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="pb-1 text-left font-medium">{nombre}</caption>
              <thead>
                <tr className="border-b border-borde text-tinta-suave">
                  <td />
                  {presentacion.columnas.map((c) => (
                    <th key={c} scope="col" className={`${CELDA} font-normal`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {presentacion.filas.map((f) => (
                  <tr key={f.rotulo} className="border-b border-borde last:border-b-0">
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      {f.rotulo}
                    </th>
                    {f.celdas.map((c, i) => (
                      <td key={presentacion.columnas[i] ?? i} className={CELDA}>
                        {precio(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Aclaraciones lista={presentacion.aclaraciones} />
        </div>
      );
    case "lista":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{presentacion.encabezado || presentacion.protagonista === "nombre" ? nombre : "Cada opción se lee como un plato:"}</p>
          <ul className="flex flex-col text-sm">
            {presentacion.filas.map((f) => (
              <li key={f.rotulo} className="flex justify-between gap-3 border-b border-borde py-1 last:border-b-0">
                <span>{f.rotulo}</span>
                <span className="tabular-nums">{formatearPrecioCarta(f.precio)}</span>
              </li>
            ))}
          </ul>
          <Aclaraciones lista={presentacion.aclaraciones} />
        </div>
      );
  }
}

export function VistaPreviaDeLaCarta({ nombre, sucursalNombre, vista }: { nombre: string; sucursalNombre: string; vista: VistaPreviaDeLaCarta }) {
  return (
    <section aria-labelledby="titulo-vista-previa-de-la-carta" className="flex flex-col gap-2 rounded border border-borde p-4" data-vista-previa-de-la-carta="">
      <h3 id="titulo-vista-previa-de-la-carta" className="text-base font-medium">
        Cómo se va a ver en la carta
      </h3>
      <p className="text-xs text-tinta-suave">Con el precio de lista de «{sucursalNombre}», sin descuentos. Es la forma que le da la carta pública; si cambia algo arriba, se actualiza al guardar.</p>
      {vista.tipo === "sin-opciones" ? (
        <p className="text-sm">
          <span className="font-medium">{nombre}</span> sin opciones: sale con su nombre y su precio.
        </p>
      ) : vista.tipo === "no-se-puede-pedir" ? (
        <Aviso variante="advertencia">Hoy no se puede pedir: le falta una opción obligatoria disponible o con precio. No sale en la carta hasta que la tenga.</Aviso>
      ) : vista.tipo === "texto" ? (
        <p className="text-sm">{vista.texto}</p>
      ) : (
        <Forma nombre={nombre} presentacion={vista.presentacion} rotulos={vista.rotulos} />
      )}
    </section>
  );
}
