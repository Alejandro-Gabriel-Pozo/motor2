"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useGrupoDeFormularios } from "@/components/grupo-de-formularios";
import type { ResultadoAccion } from "@/server/actions/tipos";

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
 * Lo que se hace lo decide y lo escribe el servidor; acá solo se llama a la acción, se muestra su mensaje y se refresca la pantalla. Un segundo toque mientras el primero viaja no
 * se manda (cerrojo en un `ref`). Si la pantalla tiene un `GrupoDeFormularios`, lo ocupa mientras viaja: los formularios esperan y no salen con la versión de antes.
 */
export function AvisoConDeshacer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const grupo = useGrupoDeFormularios();
  const [ultimo, setUltimo] = useState<{ resultado: ResultadoAccion; deshacer: (() => Promise<ResultadoAccion>) | null; vez: number } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const enviando = useRef(false);
  const veces = useRef(0);

  const ejecutar = useCallback<Ejecutar>(
    (hacer, deshacer) => {
      if (enviando.current) return;
      enviando.current = true;
      const liberar = grupo?.ocupar();
      startTransition(async () => {
        try {
          const resultado = await hacer();
          veces.current += 1;
          setUltimo({ resultado, deshacer: resultado.ok ? deshacer : null, vez: veces.current });
          if (resultado.ok) router.refresh();
        } finally {
          enviando.current = false;
          liberar?.();
        }
      });
    },
    [grupo, router]
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
          className={`fixed bottom-4 left-1/2 z-50 flex w-[min(398px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 px-3.5 py-3 text-sm shadow-[0_6px_24px_rgba(0,0,0,0.35)] ${ultimo.resultado.ok ? "bg-[#1b2735] text-[#f3f6f9] dark:bg-[#0f1822] dark:text-[#eef2f6]" : "bg-[#a23a3a] text-white"}`}
        >
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{ultimo.resultado.mensaje}</span>
          {deshacer && (
            <button
              type="button"
              disabled={pendiente}
              onClick={() => ejecutar(deshacer, null)}
              className="min-h-[44px] min-w-[44px] shrink-0 border border-white/50 bg-transparent px-3 py-2 font-semibold disabled:opacity-60"
            >
              Deshacer
            </button>
          )}
          <button type="button" onClick={() => setUltimo(null)} aria-label="Cerrar el aviso" className="min-h-[44px] min-w-[44px] shrink-0 text-lg leading-none opacity-80">
            ×
          </button>
        </div>
      )}
    </ContextoDeDeshacer.Provider>
  );
}

/**
 * Un botón que hace un cambio con «Deshacer» (archivar o restaurar, quitar o volver a vincular): `accion(valor)` al tocarlo y `accion(!valor)` al deshacer. Va adentro de un
 * `AvisoConDeshacer`. Con la cara de los botones secundarios del prototipo (borde fino, cuadrado, 44 px de alto).
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
  const contexto = useContext(ContextoDeDeshacer);
  if (!contexto) throw new Error("BotonConDeshacer va adentro de un AvisoConDeshacer.");
  const { ejecutar, ocupado } = contexto;
  return (
    <button
      type="button"
      aria-label={etiquetaAccesible}
      aria-disabled={ocupado || undefined}
      onClick={() => ejecutar(() => accion(valor), () => accion(!valor))}
      className={`min-h-[44px] shrink-0 border px-3.5 py-2 text-sm aria-disabled:cursor-progress aria-disabled:opacity-60 ${
        principal
          ? "border-[#1b2735] bg-[#1b2735] font-semibold text-white dark:border-neutral-200 dark:bg-neutral-200 dark:text-neutral-900"
          : "border-[#cdd5dd] bg-white font-medium text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}
