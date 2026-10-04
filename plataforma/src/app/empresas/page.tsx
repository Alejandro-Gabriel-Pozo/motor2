import Link from "next/link";
import { redirect } from "next/navigation";
import { formatearCuit } from "@/core/fiscal/cuit";
import { dbPlataforma } from "../../db";
import { listarEmpresas } from "../../servidor/empresas";
import { administradorEnSesion } from "../../servidor/sesion";
import { ESTADO_DE_EMPRESA, ESTADO_DE_INVITACION, fechaCorta } from "./textos";

export default async function PaginaDeEmpresas() {
  if (!(await administradorEnSesion())) redirect("/login");
  const ahora = new Date();
  const empresas = await listarEmpresas(dbPlataforma(), ahora);
  return (
    <section className="tarjeta ancha">
      <div className="barra">
        <h1>Empresas</h1>
        <a className="boton" href="/empresas/nueva">
          Dar de alta una empresa
        </a>
      </div>
      <div className="tabla-envoltorio">
        <table>
          <caption className="ayuda">Todas las empresas de esta instalación y la última invitación de cada una.</caption>
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col">Estado</th>
              <th scope="col">CUIT</th>
              <th scope="col">Invitación</th>
              <th scope="col">
                <span className="sr-only">Detalle</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id}>
                <td>
                  {e.nombre}
                  <br />
                  <span className="ayuda">{e.slug}</span>
                </td>
                <td>{ESTADO_DE_EMPRESA[e.estado]}</td>
                <td>{e.cuit ? formatearCuit(e.cuit) : e.invitacion?.cuitDeclarado ? `${formatearCuit(e.invitacion.cuitDeclarado)} (declarado)` : "—"}</td>
                <td>
                  {e.invitacion ? (
                    <>
                      {ESTADO_DE_INVITACION[e.invitacion.estado]} · {e.invitacion.email}
                      <br />
                      <span className="ayuda">
                        {e.invitacion.estado === "PENDIENTE" || e.invitacion.estado === "VENCIDA" ? `vence ${fechaCorta(e.invitacion.venceEn)}${e.invitacion.enviada ? "" : " · sin enviar"}` : ""}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <a href={`/empresas/${e.id}`}>Ver {e.nombre}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ayuda">
        <Link href="/">Volver al inicio</Link>
      </p>
    </section>
  );
}
