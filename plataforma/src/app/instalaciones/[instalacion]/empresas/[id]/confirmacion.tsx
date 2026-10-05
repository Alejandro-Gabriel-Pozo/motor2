"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Botón que pide confirmación antes de enviar el formulario que lo contiene (reemplaza a `window.confirm`: no es accesible y no se puede probar). Mismo contrato
 * que `BotonConConfirmacion` de la aplicación de empresas, que la consola no puede importar:
 *  - el aviso se anuncia (`role="alert"`) y el botón de confirmar lo describe;
 *  - el foco pasa a «Cancelar»; Escape cierra y devuelve el foco al botón;
 *  - los botones se deshabilitan mientras la acción está en curso, y el aviso se cierra al terminar.
 * Debe ir dentro de un `<form action={…}>`: «Confirmar» es el `submit`.
 */
export function BotonConConfirmacion({ etiqueta, aviso, enCurso, secundario = false }: { etiqueta: string; aviso: string; enCurso: boolean; secundario?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const idAviso = useId();
  const cancelar = useRef<HTMLButtonElement>(null);
  const disparador = useRef<HTMLButtonElement>(null);
  const estabaEnCurso = useRef(false);

  useEffect(() => {
    if (abierto) cancelar.current?.focus();
  }, [abierto]);

  // Al terminar la acción el aviso se cierra (el resultado se muestra en el formulario).
  useEffect(() => {
    if (estabaEnCurso.current && !enCurso) setAbierto(false);
    estabaEnCurso.current = enCurso;
  }, [enCurso]);

  function cerrar() {
    setAbierto(false);
    disparador.current?.focus();
  }

  return (
    <>
      <button ref={disparador} type="button" className={secundario ? "secundario" : undefined} hidden={abierto} disabled={enCurso} onClick={() => setAbierto(true)}>
        {etiqueta}
      </button>
      {abierto && (
        <div
          role="alert"
          className="confirmacion"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cerrar();
            }
          }}
        >
          <p id={idAviso}>{aviso}</p>
          <div className="fila">
            <button type="submit" aria-describedby={idAviso} disabled={enCurso}>
              {enCurso ? "Enviando…" : `Sí: ${etiqueta.charAt(0).toLowerCase()}${etiqueta.slice(1)}`}
            </button>
            <button ref={cancelar} type="button" className="secundario" disabled={enCurso} onClick={cerrar}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
