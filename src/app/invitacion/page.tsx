import { cookies } from "next/headers";
import { signIn, signOut } from "@/lib/auth";
import { getUsuarioActual } from "@/core/auth/session";
import { invitacionDelToken, nombreCookieInvitacion } from "@/core/auth/invitacion";
import { MENSAJE_ENLACE_NO_VALIDO } from "@/core/features/empresa/aceptar-invitacion";
import { AbrirInvitacion } from "./abrir-invitacion";
import { FormularioDeAceptacion } from "./formulario-de-aceptacion";

/**
 * Aceptar la invitación del primer gerente (E5, ADR-020). Pública a propósito: quien llega todavía no tiene sesión ni empresa. El acceso lo da el token del
 * enlace (guardado en una cookie por `abrirInvitacion`) más la cuenta de Google del MISMO email invitado; el GET no gasta nada, así que un escáner de mails
 * que abra el enlace no consume la invitación.
 */

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 text-center">{children}</div>
    </main>
  );
}

const TEXTO_SUAVE = "text-sm text-neutral-500 dark:text-neutral-400";
const BOTON = "w-full rounded-md bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-800";

export default async function InvitacionPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(nombreCookieInvitacion(process.env))?.value;
  const vista = await invitacionDelToken(token);

  // Sin cookie (o con una que no corresponde a nada): el token puede estar todavía en el fragmento de la URL, que solo ve el navegador.
  if (!vista) {
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <AbrirInvitacion />
      </Pantalla>
    );
  }

  const usuario = await getUsuarioActual();

  if (vista.estado !== "PENDIENTE" || vista.estadoEmpresa !== "PROVISIONING") {
    const mensaje =
      vista.estado === "ACEPTADA" && usuario?.email.toLowerCase() === vista.email
        ? `Ya aceptaste esta invitación. La plataforma está verificando los datos de «${vista.nombreEmpresa}» y te avisa por mail cuando esté lista.`
        : MENSAJE_ENLACE_NO_VALIDO;
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <p className={TEXTO_SUAVE}>{mensaje}</p>
      </Pantalla>
    );
  }

  if (!usuario) {
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <p className={TEXTO_SUAVE}>
          Te invitaron a ser gerente de «{vista.nombreEmpresa}». Entrá con la cuenta de Google de <strong>{vista.email}</strong>.
        </p>
        <form
          action={async () => {
            "use server";
            // `login_hint` solo preselecciona la cuenta en Google; quien decide es el gate de login (el email tiene que ser el invitado).
            await signIn("google", { redirectTo: "/invitacion" }, { login_hint: vista.email });
          }}
        >
          <button type="submit" className={BOTON}>
            Ingresar con Google
          </button>
        </form>
      </Pantalla>
    );
  }

  if (usuario.email.toLowerCase() !== vista.email) {
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <p className={TEXTO_SUAVE}>
          Iniciaste sesión como {usuario.email}, pero la invitación a «{vista.nombreEmpresa}» es para <strong>{vista.email}</strong>. Cerrá sesión y entrá con esa cuenta.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/invitacion" });
          }}
        >
          <button type="submit" className={BOTON}>
            Cerrar sesión
          </button>
        </form>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <h1 className="text-2xl font-semibold">Invitación</h1>
      <p className={TEXTO_SUAVE}>
        Vas a ser el gerente de «{vista.nombreEmpresa}». Cargá el CUIT de la empresa para aceptar.
      </p>
      <FormularioDeAceptacion />
    </Pantalla>
  );
}
