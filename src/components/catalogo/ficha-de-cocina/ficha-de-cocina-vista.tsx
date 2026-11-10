import { CeldaNumerica } from "@/ui/componentes/datos/celda-numerica";
import { PENDIENTE, type FichaDeCocina } from "@/core/catalogo/public";

/**
 * La ficha de cocina dibujada (`docs/diseno-ficha-de-cocina-2026-11-08.md`): SOLO LECTURA, sin enlaces ni botones de edición, pensada para papel A4 vertical. Solo dibuja lo que trae
 * `FichaDeCocina` (sin costos, precios, merma ni sustitutos: el modelo no los tiene). El papel lo resuelve el bloque «Ficha de cocina» de `globals.css` (`data-ficha-cocina` esconde el
 * menú y la barra; cada paso y cada fila `break-inside: avoid`). Lo que falta dice «pendiente de completar»; lo opcional vacío se omite.
 */
function Lista({ titulo, renglones }: { titulo: string; renglones: string[] }) {
  if (renglones.length === 0) return null;
  return (
    <section className="ficha-bloque flex flex-col gap-1">
      <h2 className="font-medium">{titulo}</h2>
      <ul className="list-disc pl-5 text-sm">
        {renglones.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </section>
  );
}

export function FichaDeCocinaVista({ ficha }: { ficha: FichaDeCocina }) {
  return (
    <article data-ficha-cocina="true" className="ficha-cocina flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-borde pb-2">
        <h1 className="text-xl font-semibold">{ficha.titulo}</h1>
        <p className="text-sm">{ficha.versionTexto}</p>
        <p className="text-sm">
          Sucursal {ficha.sucursalNombre} · Impresa el {ficha.impresaEn}
        </p>
      </div>

      <section className="ficha-bloque flex flex-col gap-1">
        <h2 className="font-medium">Datos de la receta</h2>
        {ficha.fichaTecnicaPendiente ? (
          <p className="text-sm">Ficha técnica: {PENDIENTE}.</p>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-sm">
            {ficha.datos.map((d) => (
              <div key={d.rotulo} className="contents">
                <dt className="font-medium">{d.rotulo}</dt>
                <dd>{d.valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="ficha-bloque flex flex-col gap-1">
        <h2 className="font-medium">Ingredientes</h2>
        {ficha.ingredientesPendientes ? (
          <p className="text-sm">Ingredientes: {PENDIENTE}.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-borde">
                <th scope="col" className="py-1">
                  Ingrediente
                </th>
                <th scope="col" className="text-right">
                  Cantidad
                </th>
              </tr>
            </thead>
            <tbody>
              {ficha.ingredientes.map((i, indice) => (
                <tr key={indice} className="border-b border-borde">
                  <td className="py-1">{i.nombre}</td>
                  <CeldaNumerica>
                    {i.cantidad} {i.unidad}
                  </CeldaNumerica>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Método de preparación</h2>
        {ficha.pasosPendientes ? (
          <p className="text-sm">Pasos: {PENDIENTE}.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {ficha.pasos.map((p) => (
              <li key={p.numero} className="ficha-paso flex flex-col gap-0.5">
                <p>
                  <span className="font-medium">
                    {p.numero}. {p.nombre ?? `Paso ${p.numero}`}
                  </span>
                  {p.minutos !== null && <span> — {p.minutos} min</span>}
                </p>
                <p>{p.instruccion}</p>
                {p.ingredientes.length > 0 && <p>Ingredientes: {p.ingredientes.join(", ")}.</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <Lista titulo="Presentación o emplatado" renglones={ficha.presentacion} />
      <Lista titulo="Equipamiento necesario" renglones={ficha.equipamiento} />
      <Lista titulo="Notas adicionales" renglones={ficha.notas} />
      {ficha.comentarios !== null && (
        <section className="ficha-bloque flex flex-col gap-1">
          <h2 className="font-medium">Comentarios</h2>
          <p className="text-sm">{ficha.comentarios}</p>
        </section>
      )}
    </article>
  );
}
