"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useGrupoDeFormularios } from "@/components/grupo-de-formularios";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { Boton } from "@/ui/primitivas/boton";

/** Lo que hace un toque: el cambio y, si sale bien, cómo deshacerlo (`null` = no se ofrece «Deshacer»). */
type Ejecutar = (hacer: () => Promise<ResultadoAccion>, deshacer: (() => Promise<ResultadoAccion>) | null) => void;

interface Contexto {
  ejecutar: Ejecutar;
  /** Hay un cambio en curso (los botones se atenúan y no envían otro). */
  ocupado: boolean;
}

const ContextoDeDeshacer = createContext<Contexto | null>(null);

/**
 * El AVISO CON «DESHACER» de una pantalla (OPCIONES-LIMPIEZA; el modelo del prototipo aprobado de Mantenimiento: un toque, sin pantalla de confirmación, y «Deshacer» a la vista).
 * Envuelve la pantalla y dibuja UN aviso pegado al borde de abajo (fijo: en el celular queda a la vista aunque el elemento tocado esté lejos o ya se haya movido a «Archivados»),
 * con el mensaje del servidor y, si salió bien, «Deshacer», que manda el cambio inverso (y ese ya no se deshace). Vive ARRIBA de las filas a propósito: al archivar, la fila
 * se va de la lista (la pantalla se refresca) y un aviso dentro de ella se perdería con su «Deshacer».
 *
 * Lo que se hace lo decide y lo escribe el servidor; acá solo se llama a la acción, se muestra su mensaje y se refresca la pantalla. Mientras un cambio viaja (`ocupado`, el estado de la
 * transición) los botones se atenúan y un toque nuevo no sale (sin refs, como la pantalla de Mantenimiento de la carta; y aunque saliera, archivar y quitar son «llevar al estado»: el
 * segundo no cambia nada). Si la pantalla tiene un `GrupoDeFormularios`, lo ocupa mientras viaja: los formularios esperan y no salen con la versión de antes.
 */
export function AvisoConDeshacer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const grupo = useGrupoDeFormularios();
  const [ultimo, setUltimo] = useState<{ resultado: ResultadoAccion; deshacer: (() => Promise<ResultadoAccion>) | null; vez: number } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const ejecutar = useCallback<Ejecutar>(
    (hacer, deshacer) => {
      if (pendiente) return;
      const liberar = grupo?.ocupar();
      startTransition(async () => {
        try {
          const resultado = await hacer();
          setUltimo((anterior) => ({ resultado, deshacer: resultado.ok ? deshacer : null, vez: (anterior?.vez ?? 0) + 1 }));
          if (resultado.ok) router.refresh();
        } finally {
          liberar?.();
        }
      });
    },
    [grupo, pendiente, router]
  );

  const contexto = useMemo(() => ({ ejecutar, ocupado: pendiente }), [ejecutar, pendiente]);
  const deshacer = ultimo?.deshacer ?? null;

  return (
    <ContextoDeDeshacer.Provider value={contexto}>
      {children}
      {ultimo && (
        <div
          key={ultimo.vez}
          role={ultimo.resultado.ok ? "status" : "alert"}
          data-aviso-con-deshacer=""
          className={`fixed bottom-4 left-1/2 z-50 flex w-[min(398px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 px-3.5 py-3 text-sm text-superficie shadow-lg shadow-sombra ${ultimo.resultado.ok ? "bg-tinta" : "bg-error"}`}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{ultimo.resultado.mensaje}</span>
          {deshacer && (
            <Boton variante="secundario" tamano="compacto" disabled={pendiente} onClick={() => ejecutar(deshacer, null)} className="min-w-11 shrink-0">
              Deshacer
            </Boton>
          )}
          <Boton variante="secundario" tamano="compacto" onClick={() => setUltimo(null)} aria-label="Cerrar el aviso" className="min-w-11 shrink-0">
            ×
          </Boton>
        </div>
      )}
    </ContextoDeDeshacer.Provider>
  );
}

/** El `ejecutar` del aviso, para una pantalla que arma su propio botón (el lote de «Limpiar»): va adentro de un `AvisoConDeshacer`. */
export function useAvisoConDeshacer(): Contexto {
  const contexto = useContext(ContextoDeDeshacer);
  if (!contexto) throw new Error("useAvisoConDeshacer va adentro de un AvisoConDeshacer.");
  return contexto;
}

/**
 * Un botón que hace un cambio con «Deshacer» (archivar o restaurar, quitar o volver a vincular): `accion(valor)` al tocarlo y `accion(!valor)` al deshacer. Va adentro de un
 * `AvisoConDeshacer`. Con la cara de `Boton` (`secundario`; el principal, `primario`) y 44 px de alto en celular.
 */
export function BotonConDeshacer({
  accion,
  valor,
  children,
  etiquetaAccesible,
  principal = false,
}: {
  accion: (valor: boolean) => Promise<ResultadoAccion>;
  valor: boolean;
  children: ReactNode;
  /** El nombre para un lector de pantalla cuando el texto visible solo no alcanza («Archivar» → «Archivar Grande»). */
  etiquetaAccesible?: string;
  /** El botón destacado (relleno oscuro), para la acción principal de una tarjeta. */
  principal?: boolean;
}) {
  const { ejecutar, ocupado } = useAvisoConDeshacer();
  return (
    <Boton
      variante={principal ? "primario" : "secundario"}
      tamano="compacto"
      aria-label={etiquetaAccesible}
      aria-disabled={ocupado || undefined}
      cargando={ocupado}
      onClick={() => ejecutar(() => accion(valor), () => accion(!valor))}
      className="shrink-0"
    >
      {children}
    </Boton>
  );
}
