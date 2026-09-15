import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";

export default async function Home() {
  const ctx = await obtenerContextoUsuario();
  redirect(ctx ? "/administracion/usuarios" : "/login");
}
