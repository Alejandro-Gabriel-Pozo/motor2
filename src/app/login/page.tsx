import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { getUsuarioActual } from "@/core/auth/session";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { rutaInternaSegura } from "@/core/navegacion/volver";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function LoginPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"volver">> }) {
  // Adónde volver después de entrar (la pantalla en la que estaba cuando venció la sesión). Viene de la URL: solo se acepta una ruta interna.
  const volver = rutaInternaSegura(unicosDeUrl(await searchParams).volver);
  const usuario = await getUsuarioActual();

  if (usuario) {
    const ctx = await obtenerContextoUsuario();
    if (ctx) redirect(volver ?? "/"); // sin adónde volver, la raíz decide a qué pantalla mandarlo, según lo que su rol puede abrir

    // Sesión válida pero sin ninguna sucursal asignada todavía. NO
    // redirigir de vuelta a /login desde acá — el layout de administración
    // exige ctx y rebotaría para acá de nuevo (ERR_TOO_MANY_REDIRECTS).
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Motor2</h1>
          <p className="text-sm text-neutral-500">
            Iniciaste sesión como {usuario.email}, pero todavía no tenés acceso a ninguna
            sucursal. Pedile a un admin que te dé de alta.
          </p>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button type="submit" className="text-sm text-neutral-500 underline hover:text-neutral-900">
              Cerrar sesión
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Motor2</h1>
        <p className="text-sm text-neutral-500">Ingresá con tu cuenta de Google del negocio.</p>
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
