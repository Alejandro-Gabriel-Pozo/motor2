import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/auth";
import { obtenerSituacionDeAcceso } from "@/server/sesion/contexto";
import { textoDeAvisoDeLogin } from "@/core/auth/avisos-de-login";
import { rutaInternaSegura } from "@/core/navegacion/volver";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { cambiarEmpresaActiva } from "@/server/actions/auth/empresa-activa";
import { emailDeContactoDePlataforma } from "@/core/auth/contacto-plataforma";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { Aviso } from "@/ui/primitivas/aviso";

function CerrarSesion() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut();
      }}
    >
      <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
        Cerrar sesión
      </BotonDeServidor>
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

export default async function LoginPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"volver" | "aviso">> }) {
  // Adónde volver después de entrar (la pantalla en la que estaba cuando venció la sesión). Viene de la URL: solo se acepta una ruta interna.
  const parametros = unicosDeUrl(await searchParams);
  const volver = rutaInternaSegura(parametros.volver);
  const aviso = textoDeAvisoDeLogin(parametros.aviso);
  const situacion = await obtenerSituacionDeAcceso();
  const contacto = emailDeContactoDePlataforma(process.env);

  // NO redirigir de vuelta a /login desde ninguno de los estados de abajo: el layout de administración exige contexto y rebotaría
  // para acá de nuevo (ERR_TOO_MANY_REDIRECTS). Cada estado tiene una única pantalla final.
  switch (situacion.estado) {
    case "CON_EMPRESA":
      redirect(volver ?? "/"); // sin adónde volver, la raíz decide a qué pantalla mandarlo, según lo que su rol puede abrir

    case "ELEGIR_EMPRESA":
      return (
        <Pantalla>
          <h1 className="text-2xl font-semibold">¿A qué empresa querés entrar?</h1>
          <p className="text-sm text-tinta-tenue">Iniciaste sesión como {situacion.email}. Podés cambiar de empresa más tarde desde el encabezado.</p>
          <ul className="space-y-2">
            {situacion.empresas.map((e) => (
              <li key={e.empresaId}>
                <form action={cambiarEmpresaActiva.bind(null, e.empresaId, volver)}>
                  <BotonDeServidor type="submit" className="w-full">
                    Entrar a {e.empresaNombre}
                  </BotonDeServidor>
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
          <p className="text-sm text-tinta-tenue">
            {situacion.nombres.length === 1
              ? `La empresa «${situacion.nombres[0]}» está suspendida.`
              : `Las empresas ${situacion.nombres.map((n) => `«${n}»`).join(", ")} están suspendidas.`}{" "}
            Para reactivarla, contactá a la plataforma de Motor2
            {contacto ? (
              <>
                {" "}
                escribiendo a{" "}
                <a href={`mailto:${contacto}`} className="underline">
                  {contacto}
                </a>
              </>
            ) : null}
            .
          </p>
          <CerrarSesion />
        </Pantalla>
      );

    case "EMPRESA_EN_ALTA":
      return (
        <Pantalla>
          <h1 className="text-2xl font-semibold">Motor2</h1>
          <p className="text-sm text-tinta-tenue">
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
          <p className="text-sm text-tinta-tenue">
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
            <p className="text-sm text-tinta-tenue">Ingresá con tu cuenta de Google del negocio.</p>
            {aviso && (
              // `Aviso` de error: es el único con role="alert" (los avisos de vinculación se anuncian al instante y el spec de invitación los busca así).
              <div className="text-left">
                <Aviso variante="error">{aviso}</Aviso>
              </div>
            )}
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: volver ?? "/" });
              }}
            >
              <BotonDeServidor type="submit" className="w-full">
                Ingresar con Google
              </BotonDeServidor>
            </form>
          </div>
        </main>
      );
  }
}
