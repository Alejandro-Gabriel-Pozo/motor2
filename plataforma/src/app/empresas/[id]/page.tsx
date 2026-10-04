import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { accionesDeCicloDeVida } from "@/core/features/empresa/ciclo-de-vida";
import { formatearCuit } from "@/core/fiscal/cuit";
import { empresaTieneFacturaAutorizada, MENSAJE_CUIT_INMUTABLE } from "@/core/fiscal/factura-autorizada";
import { dbPlataforma } from "../../../db";
import { historialDeEmpresa, obtenerEmpresa } from "../../../servidor/empresas";
import { administradorEnSesion } from "../../../servidor/sesion";
import { ACCION_DE_AUDITORIA, ESTADO_DE_EMPRESA, ESTADO_DE_INVITACION, fechaCorta } from "../textos";
import { AccionesDeInvitacion, ConfirmarAlta, CorregirCuit, InvitarDeNuevo, Reactivar, ReenviarAviso, Suspender } from "./botones";

export default async function PaginaDeLaEmpresa({ params }: { params: Promise<{ id: string }> }) {
  if (!(await administradorEnSesion())) redirect("/login");
  const { id } = await params;
  const db = dbPlataforma();
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

      {acciones.confirmar && inv?.cuitDeclarado && <ConfirmarAlta empresaId={empresa.id} nombre={empresa.nombre} cuitDeclarado={inv.cuitDeclarado} repetidoCon={empresa.cuitRepetidoCon} />}

      {empresa.estado === "PROVISIONING" && inv?.estado !== "ACEPTADA" && (
        <>
          <AccionesDeInvitacion empresaId={empresa.id} hayPendiente={hayPendiente} />
          <InvitarDeNuevo empresaId={empresa.id} />
        </>
      )}

      {operativa && acciones.corregirCuit && <CorregirCuit empresaId={empresa.id} cuitActual={empresa.cuit} puedeQuitar={acciones.vaciarCuit} />}
      {operativa && !acciones.corregirCuit && tieneFactura && <p className="ayuda">{MENSAJE_CUIT_INMUTABLE}</p>}
      {acciones.suspender && <Suspender empresaId={empresa.id} nombre={empresa.nombre} />}
      {acciones.reactivar && <Reactivar empresaId={empresa.id} nombre={empresa.nombre} />}
      {acciones.reenviarAviso && <ReenviarAviso empresaId={empresa.id} />}

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
        <Link href="/empresas">Volver a las empresas</Link>
      </p>
    </section>
  );
}
