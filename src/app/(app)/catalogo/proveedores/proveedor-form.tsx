"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { altaProveedor, actualizarProveedor, type DatosProveedor } from "@/server/actions/catalogo/proveedores";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";

export interface ProveedorExistente extends DatosProveedor {
  id: string;
  codigo: string;
  ofreceProductos: boolean;
  ofreceServicios: boolean;
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
        const nombre = texto(form.get("nombre"));
        const oferta = { ofreceProductos: form.get("ofreceProductos") === "on", ofreceServicios: form.get("ofreceServicios") === "on" };
        const datos: Omit<DatosProveedor, "nombre" | "ofreceProductos" | "ofreceServicios"> = {
          contacto: texto(form.get("contacto")) || undefined,
          telefono: texto(form.get("telefono")) || undefined,
          email: texto(form.get("email")) || undefined,
          cuit: texto(form.get("cuit")) || undefined,
          condicionesPago: texto(form.get("condicionesPago")) || undefined,
          notas: texto(form.get("notas")) || undefined,
        };

        startTransition(async () => {
          const resultado = editando
            ? await actualizarProveedor(proveedorExistente!.id, { ...datos, ...oferta, nombre, nombreEsperado: proveedorExistente!.nombre })
            : await altaProveedor({ nombre, ...oferta, ...datos });
          setMensaje(resultado.mensaje);
          if (resultado.ok) {
            const idFicha = editando ? proveedorExistente!.id : "id" in resultado ? resultado.id : null;
            router.push(idFicha ? `/catalogo/proveedores/${idFicha}?guardado=${editando ? "cambios" : "alta"}` : "/catalogo/proveedores");
          }
        });
      }}
      className="flex max-w-md flex-col gap-2"
    >
      <h1 className="text-lg font-medium">{editando ? `Editar "${proveedorExistente!.nombre}"` : "Nuevo proveedor"}</h1>

      <Campo aria-label="Nombre" name="nombre" placeholder="Nombre" defaultValue={proveedorExistente?.nombre ?? ""} required />
      {editando && <p className="text-xs text-tinta-tenue">Código {proveedorExistente!.codigo}: no cambia. Las compras y facturas del proveedor siguen siendo las mismas aunque corrijas el nombre.</p>}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">¿Qué le comprás?</legend>
        <Casilla name="ofreceProductos" etiqueta="Productos" defaultChecked={proveedorExistente?.ofreceProductos ?? true} />
        <Casilla name="ofreceServicios" etiqueta="Servicios (luz, gas, alquiler…)" defaultChecked={proveedorExistente?.ofreceServicios ?? false} />
      </fieldset>

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
