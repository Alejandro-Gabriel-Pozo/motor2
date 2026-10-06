import { contextoDePagina } from "../../../../../servidor/contexto";
import { FormularioDeAlta } from "./formulario";

export default async function PaginaDeAlta({ params }: { params: Promise<{ instalacion: string }> }) {
  const { instalacion } = await contextoDePagina((await params).instalacion);
  return <FormularioDeAlta instalacion={instalacion.id} />;
}
