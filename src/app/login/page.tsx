import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { getUsuarioActual } from "@/core/auth/session";

export default async function LoginPage() {
  const usuario = await getUsuarioActual();
  if (usuario) redirect("/administracion/usuarios");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold">Motor2</h1>
        <p className="text-sm text-neutral-500">Ingresá con tu cuenta de Google del negocio.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google");
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
