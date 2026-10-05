import { redirect } from "next/navigation";
import Link from "next/link";
import { dbDeInstalacion } from "../db";
import { instalacionesConfiguradas } from "../entorno";
import { rutaDeEmpresas } from "../rutas";
import { contarCuitPendiente } from "../servidor/empresas";
import { resumenDeInstalaciones } from "../servidor/resumen";
import { administradorEnSesion } from "../servidor/sesion";
import { salir } from "./login/acciones";

/** El inicio: una tarjeta por instalación con lo que espera al administrador. Si una base no responde, solo su tarjeta lo dice. */
export default async function Inicio() {
  const admin = await administradorEnSesion();
  if (!admin) redirect("/login");
  const ahora = new Date();
  const resumen = await resumenDeInstalaciones(instalacionesConfiguradas(), (instalacion) => contarCuitPendiente(dbDeInstalacion(instalacion), ahora));
  return (
    <section className="tarjeta">
      <h1>Consola de plataforma</h1>
      <p className="ayuda">Sesión de {admin.email}.</p>
      <h2>Instalaciones</h2>
      <ul className="instalaciones">
        {resumen.map((r) => (
          <li key={r.instalacion.id}>
            <p>
              <Link href={rutaDeEmpresas(r.instalacion.id)}>Empresas de {r.instalacion.nombre}</Link>
            </p>
            {r.estado === "caida" ? (
              <p className="error" role="alert">
                No pudimos leer {r.instalacion.nombre} ahora. Probá de nuevo en un momento.
              </p>
            ) : r.pendientes > 0 ? (
              <p className="aviso" role="status">
                <Link href={rutaDeEmpresas(r.instalacion.id, "cuit-pendiente")}>
                  {r.pendientes === 1 ? "1 empresa espera" : `${r.pendientes} empresas esperan`} que confirmes su CUIT
                </Link>
              </p>
            ) : (
              <p className="ayuda">Nada pendiente.</p>
            )}
          </li>
        ))}
      </ul>
      <form action={salir}>
        <button type="submit" className="secundario">
          Cerrar sesión
        </button>
      </form>
    </section>
  );
}
