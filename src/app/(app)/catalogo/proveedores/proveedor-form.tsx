"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AyudaCampo } from "@/components/ayuda-campo";
import { altaProveedor, actualizarProveedor, type DatosProveedor } from "@/server/actions/catalogo/proveedores";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";

export interface ProveedorExistente extends DatosProveedor {
  id: string;
  codigo: string;
}

export function ProveedorForm({ proveedorExistente }: { proveedorExistente?: ProveedorExistente }) {
  const router = useRouter();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editando = Boolean(proveedorExistente);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const datos: Omit<DatosProveedor, "nombre"> = {
          contacto: texto(form.get("contacto")) || undefined,
          telefono: texto(form.get("telefono")) || undefined,
          email: texto(form.get("email")) || undefined,
          cuit: texto(form.get("cuit")) || undefined,
          condicionesPago: texto(form.get("condicionesPago")) || undefined,
          notas: texto(form.get("notas")) || undefined,
        };

        startTransition(async () => {
          const resultado = editando
            ? await actualizarProveedor(proveedorExistente!.id, datos)
            : await altaProveedor({ nombre: texto(form.get("nombre")), ...datos });
          setMensaje(resultado.mensaje);
          if (resultado.ok) {
            const idFicha = editando ? proveedorExistente!.id : "id" in resultado ? resultado.id : null;
            router.push(idFicha ? `/catalogo/proveedores/${idFicha}?guardado=${editando ? "cambios" : "alta"}` : "/catalogo/proveedores");
          }
        });
      }}
      className="flex max-w-md flex-col gap-2"
    >
      <h2 className="font-medium">{editando ? `Editar "${proveedorExistente!.nombre}"` : "Nuevo proveedor"}</h2>

      {editando ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm">{proveedorExistente!.nombre}</p>
          <AyudaCampo>El nombre no se edita acá — es el identificador del proveedor, igual que en Productos e Insumos.</AyudaCampo>
        </div>
      ) : (
        <Campo aria-label="Nombre" name="nombre" placeholder="Nombre" required />
      )}

      <Campo aria-label="Contacto" name="contacto" placeholder="Contacto" defaultValue={proveedorExistente?.contacto ?? ""} />
      <Campo aria-label="Teléfono" name="telefono" placeholder="Teléfono" defaultValue={proveedorExistente?.telefono ?? ""} />
      <Campo aria-label="Email" name="email" type="email" placeholder="Email" defaultValue={proveedorExistente?.email ?? ""} />
      <Campo aria-label="CUIT" name="cuit" placeholder="CUIT" defaultValue={proveedorExistente?.cuit ?? ""} />
      <Campo aria-label="Condiciones de pago" name="condicionesPago" placeholder="Condiciones de pago" defaultValue={proveedorExistente?.condicionesPago ?? ""} />
      <AreaDeTexto etiqueta="Notas" etiquetaOculta name="notas" placeholder="Notas" defaultValue={proveedorExistente?.notas ?? ""} />

      {mensaje && (
        <Aviso variante={mensaje.startsWith("Proveedor") ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      <Boton type="submit" disabled={pending} className="self-start">
        {pending ? "Guardando..." : editando ? "Guardar cambios" : "Crear proveedor"}
      </Boton>
    </form>
  );
}

function texto(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
