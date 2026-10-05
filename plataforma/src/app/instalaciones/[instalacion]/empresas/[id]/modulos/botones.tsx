"use client";

import { useActionState } from "react";
import { activarTodosLosModulos, cambiarModulo, type EstadoDeFormulario } from "../../acciones";
import { BotonConConfirmacion } from "../confirmacion";

function Mensaje({ estado }: { estado: EstadoDeFormulario }) {
  if (!estado) return null;
  return (
    <p className={estado.tipo === "error" ? "error" : "aviso"} role={estado.tipo === "error" ? "alert" : "status"}>
      {estado.mensaje}
    </p>
  );
}

/** Un botón por módulo y operación. El aviso de confirmación lo arma el servidor (qué se suma o se pierde). */
export function CambiarModulo({ instalacion, empresaId, modulo, operacion, etiqueta, aviso }: { instalacion: string; empresaId: string; modulo: string; operacion: "activar" | "desactivar"; etiqueta: string; aviso: string }) {
  const [estado, accion, enCurso] = useActionState(cambiarModulo.bind(null, instalacion, empresaId, modulo, operacion), null);
  return (
    <form action={accion}>
      <BotonConConfirmacion etiqueta={etiqueta} aviso={aviso} enCurso={enCurso} secundario={operacion === "desactivar"} />
      <Mensaje estado={estado} />
    </form>
  );
}

export function ActivarTodos({ instalacion, empresaId, aviso }: { instalacion: string; empresaId: string; aviso: string }) {
  const [estado, accion, enCurso] = useActionState(activarTodosLosModulos.bind(null, instalacion, empresaId), null);
  return (
    <form action={accion}>
      <BotonConConfirmacion etiqueta="Activar todos los disponibles" aviso={aviso} enCurso={enCurso} />
      <Mensaje estado={estado} />
    </form>
  );
}
