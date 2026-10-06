"use client";

import { useActionState } from "react";
import { enviarCodigoDelMail, enviarSegundoFactor, pedirCodigo, type EstadoDeIngreso } from "./acciones";

const INICIAL: EstadoDeIngreso = { paso: "email", email: "", error: null };

/** Reintenta desde el paso de la acción que falló: cada paso es un formulario con su propia acción, y el email viaja de uno a otro en el estado. */
function accionDelPaso(estado: EstadoDeIngreso, formData: FormData): Promise<EstadoDeIngreso> {
  if (estado.paso === "email") return pedirCodigo(estado, formData);
  if (estado.paso === "codigo") return enviarCodigoDelMail(estado, formData);
  return enviarSegundoFactor(estado, formData);
}

export function FormularioDeIngreso() {
  const [estado, accion, pendiente] = useActionState(accionDelPaso, INICIAL);

  return (
    <form action={accion} className="tarjeta" noValidate>
      <h1>Consola de plataforma</h1>
      {estado.paso === "email" && (
        <>
          <p className="ayuda">Ingresá tu email: te mandamos un código.</p>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required defaultValue={estado.email} />
        </>
      )}
      {estado.paso === "codigo" && (
        <>
          <p className="ayuda">Si el email corresponde a un administrador, te mandamos un código de 6 dígitos. Vence en 10 minutos.</p>
          <input type="hidden" name="email" value={estado.email} />
          <label htmlFor="codigo">Código del mail</label>
          <input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
        </>
      )}
      {estado.paso === "segundo-factor" && (
        <>
          <p className="ayuda">Ingresá el código de tu aplicación de autenticación, o un código de recuperación.</p>
          <label htmlFor="factor">Código de autenticación</label>
          <input id="factor" name="factor" autoComplete="one-time-code" maxLength={12} required />
        </>
      )}
      {estado.error && (
        <p className="error" role="alert">
          {estado.error}
        </p>
      )}
      <button type="submit" disabled={pendiente}>
        {estado.paso === "email" ? "Pedir código" : "Continuar"}
      </button>
      {estado.paso !== "email" && (
        <p className="ayuda">
          <a href="/login">Empezar de nuevo</a>
        </p>
      )}
    </form>
  );
}
