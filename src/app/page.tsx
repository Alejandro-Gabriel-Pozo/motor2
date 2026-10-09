import { redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { pantallaDeInicio } from "@/server/acceso/menu";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";

export default async function Home() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) redirect("/login");
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes de leer el menú para decidir a dónde ir.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  redirect(await pantallaDeInicio(ctx));
}
