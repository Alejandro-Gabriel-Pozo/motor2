import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { listarCandidatosAGerente } from "@/core/permisos/gerencia";
import { TraspasoGerencia } from "./traspaso-gerencia";

export default async function GerenciaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "traspasar_gerencia", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const candidatos = await listarCandidatosAGerente(ctx.db, ctx.empresaId);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Gerencia de la empresa</h1>
      <p className="max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
        La empresa tiene un solo gerente: vos. Traspasar la gerencia se la da a otro administrador y te deja como administrador común; quedan en la
        auditoría de la empresa. Solo la nueva gerencia puede volver a traspasarla.
      </p>
      <TraspasoGerencia candidatos={candidatos} />
    </div>
  );
}
