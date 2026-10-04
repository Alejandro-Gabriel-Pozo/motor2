import { notFound, redirect } from "next/navigation";
import { formatearCuit } from "@/core/fiscal/cuit";
import { dbPlataforma } from "../../../db";
import { obtenerEmpresa } from "../../../servidor/empresas";
import { administradorEnSesion } from "../../../servidor/sesion";
import { ESTADO_DE_EMPRESA, ESTADO_DE_INVITACION, fechaCorta } from "../textos";
import { AccionesDeInvitacion, InvitarDeNuevo } from "./botones";

export default async function PaginaDeLaEmpresa({ params }: { params: Promise<{ id: string }> }) {
  if (!(await administradorEnSesion())) redirect("/login");
  const { id } = await params;
  const empresa = await obtenerEmpresa(dbPlataforma(), id, new Date());
  if (!empresa) notFound();
  const inv = empresa.invitacion;
  const hayPendiente = inv?.estado === "PENDIENTE" || inv?.estado === "VENCIDA";
  return (
    <section className="tarjeta ancha">
      <div className="barra">
        <h1>{empresa.nombre}</h1>
        <span className="ayuda">{ESTADO_DE_EMPRESA[empresa.estado]}</span>
      </div>
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
                <dd>{formatearCuit(inv.cuitDeclarado)} (la plataforma lo confirma en una etapa posterior)</dd>
              </>
            )}
          </>
        )}
      </dl>
      {empresa.estado === "PROVISIONING" && inv?.estado !== "ACEPTADA" && (
        <>
          <AccionesDeInvitacion empresaId={empresa.id} hayPendiente={hayPendiente} />
          <InvitarDeNuevo empresaId={empresa.id} />
        </>
      )}
      <p className="ayuda">
        <a href="/empresas">Volver a las empresas</a>
      </p>
    </section>
  );
}
