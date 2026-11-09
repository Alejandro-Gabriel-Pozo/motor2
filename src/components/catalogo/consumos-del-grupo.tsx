import { EnlaceInterno } from "@/components/enlace-interno";
import { avisoDeGrupoCompartido, vistaDeConsumoDeOpcion, type LineaDeConsumoParaLeer, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { formatearCantidad } from "@/core/pos/public";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Aviso } from "@/ui/primitivas/aviso";
import { ConsumoDeOpcion } from "./consumo-de-opcion";
import type { InsumoParaConsumo } from "./editor-de-consumos";

/** Una opción que el producto admite, con lo que cobra y consume hoy (su versión vigente). */
export interface OpcionParaConsumo {
  opcionId: string;
  nombre: string;
  esNinguna: boolean;
  vigente: {
    numero: number;
    diferencia: { tipo: "MONTO"; monto: number } | { tipo: "PORCENTAJE"; porcentaje: number };
    factorEscala: number | null;
    consumos: (LineaDeConsumoParaLeer & { insumoProductoId: string; reemplazaAProductoId: string | null })[];
  } | null;
}

/**
 * «Qué consume cada opción» de UN grupo en la pestaña Opciones de un producto (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`): el aviso del grupo compartido (antes de cualquier edición), una fila por opción que el
 * producto admite y, si la persona puede, «Editar consumo». Es un componente de SERVIDOR sin estado: todo lo que decide sale de las reglas puras (`vistaDeConsumoDeOpcion`, `avisoDeGrupoCompartido`); la pieza que dibuja cada fila es
 * `ConsumoDeOpcion`. `guardar` es la Server Action de la página: recibe la opción, el número vigente que se leyó y la diferencia y el factor vigentes (se reenvían tal cual) más el formulario; la página la arma con
 * `agregarVersionDeOpcion`, la MISMA acción que usa la Biblioteca.
 */
export function ConsumosDelGrupo({
  grupo,
  opciones,
  insumos,
  puedeEditarOpciones,
  puedeVerOpciones,
  recetasActivas,
  guardar,
}: {
  grupo: { id: string; nombre: string; tipo: TipoDeGrupoDeOpciones; productosQueLoUsan: { id: string; nombre: string }[] };
  opciones: OpcionParaConsumo[];
  insumos: InsumoParaConsumo[];
  /** Editar de `opciones_definir`: la misma clave que pide la Biblioteca. */
  puedeEditarOpciones: boolean;
  /** Ver de `opciones_definir`: solo con ella se ofrece el enlace a la Biblioteca. */
  puedeVerOpciones: boolean;
  recetasActivas: boolean;
  guardar: (opcionId: string, numeroEsperado: number, tipoDeDiferencia: string, valorDeDiferencia: number, factorEscala: number | null, formData: FormData) => Promise<ResultadoAccion>;
}) {
  const aviso = avisoDeGrupoCompartido(grupo.productosQueLoUsan);
  return (
    <div className="flex flex-col gap-2 border-t border-borde pt-3" data-consumo-del-grupo={grupo.nombre}>
      <h4 className="text-base font-medium">Qué consume cada opción</h4>
      {aviso ? (
        <Aviso variante="advertencia" data-grupo-compartido="">
          {aviso}{" "}
          {puedeVerOpciones ? (
            <EnlaceInterno href={`/catalogo/opciones/${grupo.id}`} className="underline">
              Biblioteca de opciones
            </EnlaceInterno>
          ) : null}
        </Aviso>
      ) : null}
      {opciones.length === 0 ? (
        <p className="text-sm text-tinta-suave">Este producto todavía no admite ninguna opción de este grupo.</p>
      ) : (
        <ul aria-label={`Qué consume cada opción de ${grupo.nombre}`} className="flex flex-col divide-y divide-borde">
          {opciones.map((o) => {
            const vigente = o.vigente;
            const vista = vistaDeConsumoDeOpcion(
              { tipo: grupo.tipo, esNinguna: o.esNinguna, consumos: vigente?.consumos ?? [], factorEscala: vigente?.factorEscala ?? null, puedeEditarOpciones, recetasActivas },
              formatearCantidad
            );
            const numeroEsperado = vigente?.numero ?? 0;
            return (
              <ConsumoDeOpcion
                key={`${o.opcionId}-${numeroEsperado}`}
                nombre={o.nombre}
                tipo={grupo.tipo}
                estado={vista.estado}
                frases={vista.frases}
                factor={vista.factor}
                motivoSinEdicion={vista.motivoSinEdicion}
                edicion={
                  vista.puedeEditar && vigente
                    ? {
                        insumos,
                        inicial: vigente.consumos.map((c) => ({
                          efecto: c.efecto,
                          insumoProductoId: c.insumoProductoId,
                          reemplazaAProductoId: c.reemplazaAProductoId ?? "",
                          cantidad: String(c.cantidad),
                          mermaPorcentaje: c.mermaPorcentaje ? String(c.mermaPorcentaje) : "",
                          escalaConLaMedida: c.escalaConLaMedida,
                        })),
                        accion: guardar.bind(null, o.opcionId, numeroEsperado, vigente.diferencia.tipo, vigente.diferencia.tipo === "PORCENTAJE" ? vigente.diferencia.porcentaje : vigente.diferencia.monto, vigente.factorEscala),
                      }
                    : null
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
