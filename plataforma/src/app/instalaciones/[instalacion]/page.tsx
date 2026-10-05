import { redirect } from "next/navigation";
import { rutaDeEmpresas } from "../../../rutas";
import { contextoDePagina } from "../../../servidor/contexto";

/** `/instalaciones/<id>` lleva a la lista de empresas de esa instalación (y valida la instalación: una desconocida es un 404). */
export default async function InicioDeInstalacion({ params }: { params: Promise<{ instalacion: string }> }) {
  const { instalacion } = await contextoDePagina((await params).instalacion);
  redirect(rutaDeEmpresas(instalacion.id));
}
