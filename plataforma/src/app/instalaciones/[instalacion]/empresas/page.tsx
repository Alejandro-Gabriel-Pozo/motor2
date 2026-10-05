import Link from "next/link";
import { formatearCuit } from "@/core/fiscal/cuit";
import { rutaDeAlta, rutaDeEmpresa, rutaDeEmpresas } from "../../../../rutas";
import { contextoDePagina } from "../../../../servidor/contexto";
import { FILTROS_DE_EMPRESAS, listarEmpresas, type FiltroDeEmpresas } from "../../../../servidor/empresas";
import { ESTADO_DE_EMPRESA, ESTADO_DE_INVITACION, ETIQUETA_DE_FILTRO, fechaCorta } from "./textos";

export default async function PaginaDeEmpresas({ params, searchParams }: { params: Promise<{ instalacion: string }>; searchParams: Promise<{ filtro?: string | string[] }> }) {
  const { instalacion, db } = await contextoDePagina((await params).instalacion);
  const { filtro: pedido } = await searchParams;
  const crudo = Array.isArray(pedido) ? pedido[0] : pedido;
  const filtro: FiltroDeEmpresas = FILTROS_DE_EMPRESAS.find((f) => f === crudo) ?? "todas";
  const ahora = new Date();
  const empresas = await listarEmpresas(db, ahora, filtro);
  return (
    <section className="tarjeta ancha">
      <div className="barra">
        <h1>Empresas · {instalacion.nombre}</h1>
        <a className="boton" href={rutaDeAlta(instalacion.id)}>
          Dar de alta una empresa
        </a>
      </div>
      <nav aria-label="Filtros" className="filtros">
        {FILTROS_DE_EMPRESAS.map((f) => (
          <Link key={f} href={rutaDeEmpresas(instalacion.id, f)} aria-current={f === filtro ? "page" : undefined}>
            {ETIQUETA_DE_FILTRO[f]}
          </Link>
        ))}
      </nav>
      <div className="tabla-envoltorio">
        <table>
          <caption className="ayuda">{ETIQUETA_DE_FILTRO[filtro]}: {empresas.length === 1 ? "1 empresa" : `${empresas.length} empresas`} de esta instalación, con la última invitación de cada una.</caption>
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
                  {e.cuitRepetidoCon.length > 0 && (
                    <>
                      <br />
                      <span className="error">CUIT repetido: también «{e.cuitRepetidoCon.join("», «")}»</span>
                    </>
                  )}
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
                  <a href={rutaDeEmpresa(instalacion.id, e.id)}>Ver {e.nombre}</a>
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
