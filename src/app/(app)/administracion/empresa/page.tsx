import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { formatearCuit } from "@/core/fiscal/public";
import { requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { obtenerPerfilDeEmpresa } from "@/server/consultas/empresa/perfil";

export default async function PerfilDeLaEmpresaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  // Se abre con la clave de la gerencia (piso gerente, sin migración): es la única de contexto empresa que ya existe y que solo tiene quien es gerente. Si más adelante
  // el perfil se abre a los administradores, va con una clave propia (y la migración que eso pide).
  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "traspasar_gerencia", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const perfil = await obtenerPerfilDeEmpresa(ctx.empresaId, ctx.db);
  if (!perfil) return <p className="text-red-600">No se encontró la empresa.</p>;

  const filas: { etiqueta: string; valor: string }[] = [
    { etiqueta: "Nombre", valor: perfil.nombre },
    { etiqueta: "CUIT", valor: perfil.cuit ? formatearCuit(perfil.cuit) : "Todavía no cargado" },
    { etiqueta: "Zona horaria", valor: perfil.zonaHoraria },
    { etiqueta: "Moneda", valor: perfil.moneda },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Perfil de la empresa</h1>
      <p className="max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">
        Los datos con los que la empresa figura en el sistema. Esta pantalla es solo de consulta: los define la plataforma al dar de alta la empresa y, si hay que corregir el
        CUIT, lo corrige ella.
      </p>
      <dl className="grid max-w-xl grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
        {filas.map((f) => (
          <div key={f.etiqueta} className="contents">
            <dt className="text-neutral-500">{f.etiqueta}</dt>
            <dd className="font-medium">{f.valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
