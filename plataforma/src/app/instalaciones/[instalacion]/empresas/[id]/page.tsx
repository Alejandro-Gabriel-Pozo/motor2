import Link from "next/link";
import { notFound } from "next/navigation";
import { accionesDeCicloDeVida } from "@/core/features/empresa/ciclo-de-vida";
import { formatearCuit } from "@/core/fiscal/cuit";
import { empresaTieneFacturaAutorizada, MENSAJE_CUIT_INMUTABLE } from "@/core/fiscal/factura-autorizada";
import { rutaDeEmpresa, rutaDeEmpresas } from "../../../../../rutas";
import { contextoDePagina } from "../../../../../servidor/contexto";
import { historialDeEmpresa, obtenerEmpresa } from "../../../../../servidor/empresas";
import { ACCION_DE_AUDITORIA, ESTADO_DE_EMPRESA, ESTADO_DE_INVITACION, fechaCorta, textoDeLoQueAcabaDePasar } from "../textos";
import { AccionesDeInvitacion, ConfirmarAlta, CorregirCuit, InvitarDeNuevo, Reactivar, ReenviarAviso, Suspender } from "./botones";

export default async function PaginaDeLaEmpresa({ params, searchParams }: { params: Promise<{ instalacion: string; id: string }>; searchParams: Promise<{ hecho?: string | string[] }> }) {
  const { instalacion: instalacionId, id } = await params;
  const { instalacion, db } = await contextoDePagina(instalacionId);
  const { hecho } = await searchParams;
  const empresa = await obtenerEmpresa(db, id, new Date());
  if (!empresa) notFound();
  const inv = empresa.invitacion;
  const hayPendiente = inv?.estado === "PENDIENTE" || inv?.estado === "VENCIDA";
  const tieneFactura = await empresaTieneFacturaAutorizada(db, empresa.id);
  const acciones = accionesDeCicloDeVida(empresa, { tieneFacturaAutorizada: tieneFactura });
  const historial = await historialDeEmpresa(db, empresa.id);
  const operativa = empresa.estado === "ACTIVE" || empresa.estado === "SUSPENDED";
  return (
    <section className="tarjeta ancha">
      <div className="barra">
        <h1>{empresa.nombre}</h1>
        <span className="ayuda">{ESTADO_DE_EMPRESA[empresa.estado]}</span>
      </div>
      {textoDeLoQueAcabaDePasar(Array.isArray(hecho) ? hecho[0] : hecho, empresa) && (
        <p className="aviso" role="status">
          {textoDeLoQueAcabaDePasar(Array.isArray(hecho) ? hecho[0] : hecho, empresa)}
        </p>
      )}
      {empresa.cuitRepetidoCon.length > 0 && (
        <p className="error" role="alert">
          CUIT repetido: también lo tienen o lo declararon {empresa.cuitRepetidoCon.map((n) => `«${n}»`).join(", ")}.
        </p>
      )}
      <dl>
        <dt>Identificador</dt>
        <dd>{empresa.slug}</dd>
        <dt>CUIT</dt>
        <dd>{empresa.cuit ? formatearCuit(empresa.cuit) : "Sin confirmar"}</dd>
        {inv && (
          <>
            <dt>Invitación del gerente</dt>
            <dd>
              {ESTADO_DE_INVITACION[inv.estado]} · {inv.email}
              {hayPendiente && ` · vence ${fechaCorta(inv.venceEn)}${inv.enviada ? "" : " · el mail no salió"}`}
            </dd>
            {inv.cuitDeclarado && (
              <>
                <dt>CUIT declarado por el gerente</dt>
                <dd>{formatearCuit(inv.cuitDeclarado)}</dd>
              </>
            )}
          </>
        )}
      </dl>

      {acciones.confirmar && inv?.cuitDeclarado && <ConfirmarAlta instalacion={instalacion.id} empresaId={empresa.id} nombre={empresa.nombre} cuitDeclarado={inv.cuitDeclarado} repetidoCon={empresa.cuitRepetidoCon} />}

      {empresa.estado === "PROVISIONING" && inv?.estado !== "ACEPTADA" && (
        <>
          <AccionesDeInvitacion instalacion={instalacion.id} empresaId={empresa.id} hayPendiente={hayPendiente} />
          <InvitarDeNuevo instalacion={instalacion.id} empresaId={empresa.id} />
        </>
      )}

      {operativa && acciones.corregirCuit && <CorregirCuit instalacion={instalacion.id} empresaId={empresa.id} cuitActual={empresa.cuit} puedeQuitar={acciones.vaciarCuit} />}
      {operativa && !acciones.corregirCuit && tieneFactura && <p className="ayuda">{MENSAJE_CUIT_INMUTABLE}</p>}
      {acciones.suspender && <Suspender instalacion={instalacion.id} empresaId={empresa.id} nombre={empresa.nombre} />}
      {acciones.reactivar && <Reactivar instalacion={instalacion.id} empresaId={empresa.id} nombre={empresa.nombre} />}
      {acciones.reenviarAviso && <ReenviarAviso instalacion={instalacion.id} empresaId={empresa.id} />}

      <p>
        <Link href={rutaDeEmpresa(instalacion.id, empresa.id, "modulos")}>Administrar módulos</Link>
      </p>

      <h2>Historial</h2>
      {historial.length === 0 ? (
        <p className="ayuda">Todavía no hay movimientos.</p>
      ) : (
        <ul className="historial">
          {historial.map((h) => (
            <li key={h.id}>
              {fechaCorta(h.creadoEn)} · {ACCION_DE_AUDITORIA[h.accion] ?? h.accion} · {h.adminEmail}
            </li>
          ))}
        </ul>
      )}
      <p className="ayuda">
        <Link href={rutaDeEmpresas(instalacion.id)}>Volver a las empresas</Link>
      </p>
    </section>
  );
}
