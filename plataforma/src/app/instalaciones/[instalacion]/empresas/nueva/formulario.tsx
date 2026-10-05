"use client";

import { useActionState } from "react";
import { rutaDeEmpresas } from "../../../../../rutas";
import { darDeAlta } from "../acciones";

/** Alta de una empresa: nace en alta (sin CUIT ni módulos) y le manda la invitación de gerente al email del dueño. */
export function FormularioDeAlta({ instalacion }: { instalacion: string }) {
  const [estado, accion, pendiente] = useActionState(darDeAlta.bind(null, instalacion), null);
  return (
    <form action={accion} className="tarjeta" noValidate>
      <h1>Dar de alta una empresa</h1>
      <p className="ayuda">Queda en alta, sin CUIT ni módulos. El dueño recibe un enlace para ser su gerente y cargar el CUIT.</p>
      <label htmlFor="nombre">Nombre</label>
      <input id="nombre" name="nombre" required maxLength={120} />
      <label htmlFor="slug">Identificador (slug)</label>
      <input id="slug" name="slug" required maxLength={63} placeholder="hosteria-sur" autoCapitalize="none" />
      <label htmlFor="zonaHoraria">Zona horaria</label>
      <input id="zonaHoraria" name="zonaHoraria" required defaultValue="America/Argentina/Buenos_Aires" />
      <label htmlFor="moneda">Moneda (3 letras)</label>
      <input id="moneda" name="moneda" required maxLength={3} defaultValue="ARS" />
      <label htmlFor="nombreSucursal">Primera sucursal</label>
      <input id="nombreSucursal" name="nombreSucursal" required maxLength={120} defaultValue="Central" />
      <label htmlFor="emailDuenio">Email del dueño (será el gerente)</label>
      <input id="emailDuenio" name="emailDuenio" type="email" required autoComplete="off" />
      {estado && (
        <p className={estado.tipo === "error" ? "error" : "aviso"} role={estado.tipo === "error" ? "alert" : "status"}>
          {estado.mensaje}
        </p>
      )}
      <button type="submit" disabled={pendiente}>
        {pendiente ? "Creando…" : "Dar de alta"}
      </button>
      <p className="ayuda">
        <a href={rutaDeEmpresas(instalacion)}>Volver a las empresas</a>
      </p>
    </form>
  );
}
