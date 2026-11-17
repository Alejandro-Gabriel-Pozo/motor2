import { armarFilasDeLaPromo, type ComandoDeFila, type FilaDeParte, type LugarDeCombo, type ProductoParaEntrada } from "@/core/carta/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { ParteDePromo } from "./parte-de-promo";

/**
 * «Qué lleva» de una promo con el armado «como Pedernal» (E2b, `docs/diseno-promo-parte-de-seccion-2026-11-11.md`): una fila por parte, cada una con su propio «Guardar» (una sola acción por parte, todo o nada). Arriba lo que la promo YA lleva; plegado en «Agregar un componente»
 * el resto de las secciones y la fila «No está en la carta» (siempre «Solo estos platos»); y, si hay, las «otras partes» ya cargadas con «Sumar un lugar» (listas que no se llaman como ninguna sección). Todo nace cerrado: nada viene tildado. La fila se vuelve a montar
 * cuando cambia lo guardado (la clave lleva su estado), así lo que se ve es siempre lo que hay en la base.
 */
const firma = (f: FilaDeParte) => `${f.clave}|${f.modo}|${f.cantidadMinima}|${f.cantidadMaxima}|${f.entradas.map((e) => e.id).join(",")}`;

export function PartesDeLaPromo({
  secciones,
  cuposDeSeccion,
  lugares,
  productos,
  puedeEditar,
  guardar,
}: {
  secciones: { id: string; nombre: string; activa: boolean }[];
  cuposDeSeccion: { seccionCartaId: string; cantidadMinima: number; cantidadMaxima: number }[];
  lugares: LugarDeCombo[];
  productos: ProductoParaEntrada[];
  puedeEditar: boolean;
  guardar: (comando: ComandoDeFila) => Promise<ResultadoAccion>;
}) {
  const filas = armarFilasDeLaPromo({ secciones, cuposDeSeccion, lugares });
  const queLleva = [...filas.deSecciones, filas.fueraDeLaCarta, ...filas.otras].filter((f) => f.modo !== "NO_ENTRA");
  const restantes = [...filas.deSecciones, filas.fueraDeLaCarta].filter((f) => f.modo === "NO_ENTRA");
  const fila = (f: FilaDeParte) => <ParteDePromo key={firma(f)} fila={f} productos={productos} puedeEditar={puedeEditar} guardar={guardar} />;
  return (
    <div className="flex flex-col gap-2">
      {queLleva.length > 0 && (
        <div className="flex flex-col gap-2" data-que-lleva>
          {queLleva.map(fila)}
        </div>
      )}
      {restantes.length > 0 && (
        <details className="rounded border p-2" data-agregar-componente>
          <summary className="cursor-pointer text-sm font-medium max-md:min-h-11 max-md:py-2">Agregar un componente</summary>
          <p className="mt-2 text-sm text-tinta-tenue">Tildá la sección de la carta (o «No está en la carta»), elegí si entra toda la sección o solo ciertos platos y poné la cantidad. Ninguna viene tildada: cada decisión es tuya.</p>
          <div className="mt-2 flex flex-col gap-2">{restantes.map(fila)}</div>
        </details>
      )}
    </div>
  );
}
