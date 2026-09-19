import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { pantallaDeInicio } from "@/core/navegacion/inicio";

export default async function Home() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) redirect("/login");
  redirect(await pantallaDeInicio(ctx));
}
