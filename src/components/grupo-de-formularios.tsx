"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Un GRUPO de formularios que guardan sobre lo mismo (O.2 de docs/pureza-integracion.md; Revisión #93 (5)): mientras uno guarda, los demás no envían.
 *
 * Por qué: en el editor de recetas cada formulario lleva, en su acción, la versión que la pantalla mostraba (H7). Si la persona toca «Quitar» en un
 * ingrediente y, mientras eso guarda, toca «Quitar» en otro, el segundo envío salía con la versión VIEJA (Next encola la segunda acción y la manda al
 * terminar la primera) y recibía «cambió mientras la editabas… Recargá», aunque la pantalla se refrescara sola un instante después. Con el grupo, el segundo
 * formulario no envía y avisa «Esperá a que termine de guardarse el cambio anterior.»; cuando el primero termina, la respuesta de su acción ya trajo la
 * pantalla refrescada (la versión nueva en las acciones de cada formulario) y el segundo cambio entra. No cambia nada en el servidor ni el mensaje del
 * rechazo (que sigue protegiendo de otra persona u otra pestaña).
 *
 * Es OPCIONAL: `FormConResultado` lo usa solo si está adentro de un grupo; sin grupo se comporta exactamente como siempre. El grupo envuelve su contenido en
 * un `<div>` (con `className`) que lleva `aria-busy` mientras algún formulario del grupo guarda, y `data-grupo-de-formularios` para ubicarlo.
 *
 * Cómo cuenta: un contador en un `ref` (la pregunta «¿hay otro guardando?» se responde en el mismo click, sin esperar un render: dos clicks seguidos no se
 * cuelan) y un estado para lo que se pinta (`aria-busy` y la `ronda`: cuántas veces el grupo quedó libre; un aviso de espera vale solo para la ronda en la
 * que se dio, así se va solo cuando el otro termina).
 */
interface GrupoDeFormulariosContexto {
  /** ¿Hay algún formulario del grupo guardando? Lectura síncrona (ver arriba). */
  hayOtroGuardando: () => boolean;
  /** Marca un formulario del grupo como guardando; devuelve con qué liberarlo (llamarla más de una vez no descuenta de más). */
  ocupar: () => () => void;
  /** Cuántas veces el grupo quedó libre (ver arriba). */
  ronda: number;
}

const Contexto = createContext<GrupoDeFormulariosContexto | null>(null);

export function GrupoDeFormularios({ children, className }: { children: ReactNode; className?: string }) {
  const ocupados = useRef(0);
  const [estado, setEstado] = useState({ ocupado: false, ronda: 0 });

  const contexto = useMemo<GrupoDeFormulariosContexto>(
    () => ({
      hayOtroGuardando: () => ocupados.current > 0,
      ocupar: () => {
        ocupados.current += 1;
        setEstado((e) => (e.ocupado ? e : { ...e, ocupado: true }));
        let liberado = false;
        return () => {
          if (liberado) return;
          liberado = true;
          ocupados.current -= 1;
          if (ocupados.current === 0) setEstado((e) => ({ ocupado: false, ronda: e.ronda + 1 }));
        };
      },
      ronda: estado.ronda,
    }),
    [estado.ronda]
  );

  return (
    <Contexto.Provider value={contexto}>
      <div className={className} aria-busy={estado.ocupado || undefined} data-grupo-de-formularios="">
        {children}
      </div>
    </Contexto.Provider>
  );
}

/** El grupo en el que está el formulario, o `null` si no está en ninguno. */
export function useGrupoDeFormularios(): GrupoDeFormulariosContexto | null {
  return useContext(Contexto);
}
