import { redirect } from "next/navigation";
import Link from "next/link";
import { dbPlataforma } from "../db";
import { contarCuitPendiente } from "../servidor/empresas";
import { administradorEnSesion } from "../servidor/sesion";
import { salir } from "./login/acciones";

export default async function Inicio() {
  const admin = await administradorEnSesion();
  if (!admin) redirect("/login");
  const pendientes = await contarCuitPendiente(dbPlataforma(), new Date());
  return (
    <section className="tarjeta">
      <h1>Consola de plataforma</h1>
      <p className="ayuda">Sesión de {admin.email}.</p>
      <p className="ayuda">
        <Link href="/empresas">Empresas e invitaciones</Link>
      </p>
      {pendientes > 0 && (
        <p className="aviso" role="status">
          <Link href="/empresas?filtro=cuit-pendiente">{pendientes === 1 ? "1 empresa espera" : `${pendientes} empresas esperan`} que confirmes su CUIT</Link>
        </p>
      )}
      <form action={salir}>
        <button type="submit" className="secundario">
          Cerrar sesión
        </button>
      </form>
    </section>
  );
}
