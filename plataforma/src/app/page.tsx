import { redirect } from "next/navigation";
import { administradorEnSesion } from "../servidor/sesion";
import { salir } from "./login/acciones";

export default async function Inicio() {
  const admin = await administradorEnSesion();
  if (!admin) redirect("/login");
  return (
    <section className="tarjeta">
      <h1>Consola de plataforma</h1>
      <p className="ayuda">Sesión de {admin.email}.</p>
      <p className="ayuda">
        <a href="/empresas">Empresas e invitaciones</a>
      </p>
      <form action={salir}>
        <button type="submit" className="secundario">
          Cerrar sesión
        </button>
      </form>
    </section>
  );
}
