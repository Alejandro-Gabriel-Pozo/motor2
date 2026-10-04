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
      <p className="ayuda">Las funciones de administración de empresas se suman en las etapas siguientes.</p>
      <form action={salir}>
        <button type="submit" className="secundario">
          Cerrar sesión
        </button>
      </form>
    </section>
  );
}
