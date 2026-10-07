import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { getUsuarioActual } from "@/core/auth/session";
import { claseDeInvitacion, nombreCookieInvitacion } from "@/core/auth/invitacion";
import { accesosDeLaInvitacion, invitacionDelToken } from "@/server/sesion/invitacion";
import { MENSAJE_ENLACE_NO_VALIDO } from "@/core/features/empresa/aceptar-invitacion";
import { AbrirInvitacion } from "./abrir-invitacion";
import { AceptarDeUsuario } from "./aceptar-de-usuario";
import { FormularioDeAceptacion } from "./formulario-de-aceptacion";

/**
 * Aceptar una invitación (E5 la del primer gerente, ADR-020; E8 la de usuario y la de vinculación, ADR-024). Pública a propósito: quien llega todavía no tiene sesión ni empresa. El
 * acceso lo da el token del enlace (guardado en una cookie por `abrirInvitacion`) más la cuenta de Google del MISMO email invitado; el GET no gasta nada, así que un escáner
 * de mails que abra el enlace no consume la invitación.
 *
 *  - gerente: se carga y se revisa el CUIT de la empresa (empresa en alta).
 *  - usuario: se muestran las sucursales y los roles y se acepta con un botón (empresa activa).
 *  - vinculación: no hay nada que aceptar; entrar con Google vincula la cuenta (lo hace el login) y esta pantalla manda a la app.
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
  const clase = claseDeInvitacion(vista);

  if (vista.estado !== "PENDIENTE" || clase === "inservible") {
    const yaAceptada = vista.estado === "ACEPTADA" && usuario?.email.toLowerCase() === vista.email;
    const mensaje = !yaAceptada
      ? MENSAJE_ENLACE_NO_VALIDO
      : clase === "alta-de-empresa"
        ? `Ya aceptaste esta invitación. La plataforma está verificando los datos de «${vista.nombreEmpresa}» y te avisa por mail cuando esté lista.`
        : `Ya aceptaste esta invitación a «${vista.nombreEmpresa}».`;
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <p className={TEXTO_SUAVE}>{mensaje}</p>
      </Pantalla>
    );
  }

  const quePasaAlEntrar =
    clase === "alta-de-empresa"
      ? `Te invitaron a ser gerente de «${vista.nombreEmpresa}».`
      : clase === "acceso-a-empresa"
        ? `Te dieron acceso a «${vista.nombreEmpresa}».`
        : `Tu usuario de «${vista.nombreEmpresa}» ya está dado de alta.`;

  if (!usuario) {
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <p className={TEXTO_SUAVE}>
          {quePasaAlEntrar} Entrá con la cuenta de Google de <strong>{vista.email}</strong>.
        </p>
        <form
          action={async () => {
            "use server";
            // `login_hint` solo preselecciona la cuenta en Google; quien decide es el gate de login (el email tiene que ser el invitado).
            // La de vinculación vuelve a la app (no hay nada que aceptar); las otras vuelven a esta pantalla para aceptar.
            await signIn("google", { redirectTo: clase === "vinculacion" ? "/" : "/invitacion" }, { login_hint: vista.email });
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

  // La sesión es del email invitado.
  if (clase === "vinculacion") redirect("/");

  if (clase === "acceso-a-empresa") {
    const accesos = await accesosDeLaInvitacion(vista);
    return (
      <Pantalla>
        <h1 className="text-2xl font-semibold">Invitación</h1>
        <p className={TEXTO_SUAVE}>{quePasaAlEntrar} Vas a tener acceso a:</p>
        <ul className="space-y-1 text-left text-sm">
          {accesos.map((a) => (
            <li key={a.sucursal} className="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-600">
              <strong>{a.sucursal}</strong> — {a.rol}
            </li>
          ))}
        </ul>
        <AceptarDeUsuario />
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <h1 className="text-2xl font-semibold">Invitación</h1>
      <p className={TEXTO_SUAVE}>Vas a ser el gerente de «{vista.nombreEmpresa}». Cargá el CUIT de la empresa para aceptar.</p>
      <FormularioDeAceptacion nombreEmpresa={vista.nombreEmpresa} />
    </Pantalla>
  );
}
