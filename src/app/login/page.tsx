import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { obtenerSituacionDeAcceso } from "@/core/auth/contexto";
import { rutaInternaSegura } from "@/core/navegacion/volver";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { cambiarEmpresaActiva } from "@/server/actions/auth/empresa-activa";

function CerrarSesion() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut();
      }}
    >
      <button type="submit" className="text-sm text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">
        Cerrar sesión
      </button>
    </form>
  );
}

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 text-center">{children}</div>
    </main>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"volver">> }) {
  // Adónde volver después de entrar (la pantalla en la que estaba cuando venció la sesión). Viene de la URL: solo se acepta una ruta interna.
  const volver = rutaInternaSegura(unicosDeUrl(await searchParams).volver);
  const situacion = await obtenerSituacionDeAcceso();

  // NO redirigir de vuelta a /login desde ninguno de los estados de abajo: el layout de administración exige contexto y rebotaría
  // para acá de nuevo (ERR_TOO_MANY_REDIRECTS). Cada estado tiene una única pantalla final.
  switch (situacion.estado) {
    case "CON_EMPRESA":
      redirect(volver ?? "/"); // sin adónde volver, la raíz decide a qué pantalla mandarlo, según lo que su rol puede abrir

    case "ELEGIR_EMPRESA":
      return (
        <Pantalla>
          <h1 className="text-2xl font-semibold">¿A qué empresa querés entrar?</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Iniciaste sesión como {situacion.email}. Podés cambiar de empresa más tarde desde el encabezado.</p>
          <ul className="space-y-2">
            {situacion.empresas.map((e) => (
              <li key={e.empresaId}>
                <form action={cambiarEmpresaActiva.bind(null, e.empresaId, volver)}>
                  <button type="submit" className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-800">
                    Entrar a {e.empresaNombre}
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <CerrarSesion />
        </Pantalla>
      );

    case "EMPRESA_SUSPENDIDA":
      return (
        <Pantalla>
          <h1 className="text-2xl font-semibold">Motor2</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {situacion.nombres.length === 1
              ? `La empresa «${situacion.nombres[0]}» está suspendida.`
              : `Las empresas ${situacion.nombres.map((n) => `«${n}»`).join(", ")} están suspendidas.`}{" "}
            Comunicate con quien administra Motor2.
          </p>
          <CerrarSesion />
        </Pantalla>
      );

    case "EMPRESA_EN_ALTA":
      return (
        <Pantalla>
          <h1 className="text-2xl font-semibold">Motor2</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {situacion.nombres.length === 1 ? `La empresa «${situacion.nombres[0]}» está en alta.` : `Las empresas ${situacion.nombres.map((n) => `«${n}»`).join(", ")} están en alta.`}{" "}
            La plataforma está verificando sus datos y te avisa por mail cuando esté lista para usar.
          </p>
          <CerrarSesion />
        </Pantalla>
      );

    case "SIN_ACCESO":
      return (
        <Pantalla>
          <h1 className="text-2xl font-semibold">Motor2</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Iniciaste sesión como {situacion.email}, pero todavía no tenés acceso a ninguna
            sucursal. Pedile a un admin que te dé de alta.
          </p>
          <CerrarSesion />
        </Pantalla>
      );

    case "SIN_SESION":
      return (
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-sm space-y-6 text-center">
            <h1 className="text-2xl font-semibold">Motor2</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">Ingresá con tu cuenta de Google del negocio.</p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: volver ?? "/" });
              }}
            >
              <button
                type="submit"
                className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-800"
              >
                Ingresar con Google
              </button>
            </form>
          </div>
        </main>
      );
  }
}
