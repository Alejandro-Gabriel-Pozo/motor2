import Link from "next/link";
import { IndicadorDeEnlace } from "@/components/indicador-de-enlace";
import { IconoDeModulo } from "@/components/iconos";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { tarjetasDelUsuario } from "@/core/navegacion/inicio";

/**
 * Pantalla de inicio: una tarjeta por módulo que el rol puede abrir en la sucursal activa (la misma consulta de permisos que arma el
 * menú). Es a donde se entra y a donde apunta «Motor2»; solo quien tiene únicamente el salón entra directo al mapa de mesas. Sin ninguna
 * tarjeta, explica por qué (el rol no tiene pantallas habilitadas) en vez de dejar un mensaje de «no tenés permiso» en alguna página.
 */
export default async function InicioPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;
  const tarjetas = await tarjetasDelUsuario(ctx);

  if (tarjetas.length === 0) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-semibold">Todavía no tenés pantallas habilitadas</h1>
        <p className="text-sm text-neutral-500">
          Tu rol no tiene permiso para ver ninguna sección en esta sucursal. Pedile a un admin que te lo habilite desde Administración → Permisos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Hola — estás en {ctx.sucursalNombre}</h1>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tarjetas.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              className="flex h-full items-start gap-3 rounded border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <IconoDeModulo id={t.id} className="mt-0.5 h-5 w-5 shrink-0 text-neutral-600 dark:text-neutral-300" />
              <span>
                <span className="block font-medium">
                  {t.label}
                  <IndicadorDeEnlace />
                </span>
                <span className="block text-sm text-neutral-500 dark:text-neutral-400">{t.descripcion}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
