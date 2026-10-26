"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { useRouter } from "next/navigation";
import { CampoNumero } from "@/components/campo-numero";
import type { ModoDePrecioDeMedida, TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import { crearOpcionEnElProducto } from "@/server/actions/catalogo/opciones-de-venta";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Selector } from "@/ui/primitivas/selector";
import {
  armarComandoDeOpcionNueva,
  ayudaDelImporte,
  etiquetaDelImporte,
  formularioDeOpcionInicial,
  loQueLleva,
  textosDeLaVentana,
  type FormularioDeOpcionNueva,
  type LoQueLleva,
} from "./nueva-opcion-en-el-grupo-formulario";

/**
 * La ventana «+ Opción» (o «+ Extra», en un grupo de adicionales) de la tarjeta de un grupo del producto (bloque 3 del espacio del producto): agregar una opción al grupo SIN salir del producto, todo en una
 * ventana. Un botón abre un `Dialogo` con el formulario; «Agregar la opción» llama a `crearOpcionEnElProducto` (la opción en el grupo de la biblioteca y lo que ESTE producto admite de ella, en UNA
 * transacción, todo o nada). Los otros productos que usan el grupo no admiten la opción nueva.
 *
 * El formulario pide el nombre y, según el grupo (`loQueLleva`): el precio final de la opción (un tamaño en precio propio), lo que suma (una variante o un tamaño en diferencia), lo que cobra el extra y la
 * unidad de su producto de respaldo (un adicional), o nada (un grupo incluido). Sin permiso no se dibuja: eso lo decide la PÁGINA en el servidor (las dos claves que pide «+ Nuevo grupo»; la acción las vuelve a exigir).
 *
 * Al salir bien la ventana se cierra, un `Aviso` de éxito queda al lado del botón y la página se refresca (`router.refresh()`); si el servidor rechaza, el `Aviso` de error queda DENTRO de la ventana (no se
 * cierra: lo tecleado no se pierde). Un doble clic no manda dos envíos (el botón queda en `cargando` y una guarda síncrona frena el reenvío); igual, el servidor es idempotente por estado. Enter dentro de
 * un campo NO envía: agregar datos de verdad pide tocar el botón.
 */
export function NuevaOpcionEnElGrupo({
  productoId,
  productoNombre,
  grupoId,
  grupoNombre,
  tipo,
  modoPrecio,
  versionEsperada,
  unidades,
}: {
  productoId: string;
  productoNombre: string;
  grupoId: string;
  grupoNombre: string;
  tipo: TipoDeGrupoDeOpciones;
  /** El modo de precio de la medida en este producto (`null` en los demás tipos). */
  modoPrecio: ModoDePrecioDeMedida | null;
  /** La `version` de lo que el producto admite del grupo que vio la pantalla (control optimista). */
  versionEsperada: number;
  /** Las unidades activas, para el producto de respaldo de un extra. */
  unidades: readonly { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const lleva = loQueLleva(tipo, modoPrecio);
  const textos = textosDeLaVentana(tipo, grupoNombre);
  const [abierto, setAbierto] = useState(false);
  const [formulario, setFormulario] = useState<FormularioDeOpcionNueva>(() => formularioDeOpcionInicial(lleva));
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const enviando = useRef(false);
  const campoNombre = useRef<HTMLInputElement>(null);

  // Al abrir, el foco va al nombre (el diálogo nativo lo pondría en «Cerrar»). Este efecto corre después del de `Dialogo` (el que llama a `showModal`), con el diálogo ya abierto.
  useEffect(() => {
    if (abierto) campoNombre.current?.focus();
  }, [abierto]);

  function abrir() {
    setFormulario(formularioDeOpcionInicial(lleva));
    setError(null);
    setExito(null);
    setAbierto(true);
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando.current) return;
    enviando.current = true;
    setCargando(true);
    setError(null);
    try {
      const resultado = await crearOpcionEnElProducto(armarComandoDeOpcionNueva({ productoId, grupoId, versionEsperada, lleva }, formulario));
      if (resultado.ok) {
        setAbierto(false);
        setExito(resultado.mensaje);
        router.refresh();
      } else {
        setError(resultado.mensaje);
      }
    } catch {
      setError(textos.errorDeConexion);
    } finally {
      enviando.current = false;
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-nueva-opcion-en={grupoNombre}>
      <div>
        <Boton variante="secundario" onClick={abrir} aria-label={textos.botonAccesible}>
          {textos.boton}
        </Boton>
      </div>
      {exito ? <Aviso variante="exito">{exito}</Aviso> : null}
      <Dialogo abierto={abierto} titulo={`${textos.titulo} de «${productoNombre}»`} onCerrar={() => setAbierto(false)}>
        <FormularioDeOpcionNuevaEnVentana
          lleva={lleva}
          textos={textos}
          unidades={unidades}
          formulario={formulario}
          alCambiar={setFormulario}
          alEnviar={(e) => void enviar(e)}
          alCancelar={() => setAbierto(false)}
          error={error}
          cargando={cargando}
          refNombre={campoNombre}
        />
      </Dialogo>
    </div>
  );
}

/**
 * El formulario de la ventana, solo con lo que recibe (sin estado propio ni llamadas): lo dibuja `NuevaOpcionEnElGrupo` adentro del `Dialogo` y lo prueban los tests con `renderToStaticMarkup`, que no
 * puede abrir un diálogo.
 */
export function FormularioDeOpcionNuevaEnVentana({
  lleva,
  textos,
  unidades,
  formulario,
  alCambiar,
  alEnviar,
  alCancelar,
  error,
  cargando,
  refNombre,
}: {
  lleva: LoQueLleva;
  textos: ReturnType<typeof textosDeLaVentana>;
  unidades: readonly { id: string; nombre: string }[];
  formulario: FormularioDeOpcionNueva;
  alCambiar: (f: FormularioDeOpcionNueva) => void;
  alEnviar: (e: FormEvent<HTMLFormElement>) => void;
  alCancelar: () => void;
  error: string | null;
  cargando: boolean;
  refNombre?: Ref<HTMLInputElement>;
}) {
  // Como `FormConResultado`: Enter dentro de un campo no envía (se agregarían datos de verdad sin tocar el botón); el botón sigue respondiendo a Enter y Espacio.
  const sinEnviarConEnter = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
  };
  const etiquetaImporte = etiquetaDelImporte(lleva);
  const ayudaImporte = ayudaDelImporte(lleva);

  return (
    <form onSubmit={alEnviar} onKeyDown={sinEnviarConEnter} aria-busy={cargando || undefined} className="flex flex-col gap-4">
      <Campo etiqueta={textos.nombre} ref={refNombre} required autoComplete="off" value={formulario.nombre} onChange={(e) => alCambiar({ ...formulario, nombre: e.target.value })} />

      {etiquetaImporte ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="importe-de-la-opcion-nueva" className="text-sm font-medium">
            {etiquetaImporte}
          </label>
          <CampoNumero id="importe-de-la-opcion-nueva" value={formulario.importe} onChange={(v) => alCambiar({ ...formulario, importe: v })} prefijo="$" tipo="importe" etiqueta={`El importe (${etiquetaImporte.toLowerCase()})`} className="w-44" />
          {ayudaImporte ? <p className="text-xs text-tinta-suave">{ayudaImporte}</p> : null}
        </div>
      ) : null}

      {lleva === "cobra" ? (
        <Selector etiqueta="Unidad para el stock del extra" required value={formulario.unidadStockId} onChange={(e) => alCambiar({ ...formulario, unidadStockId: e.target.value })} className="max-w-xs">
          <option value="" disabled>
            Elegí la unidad
          </option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </Selector>
      ) : null}

      {error ? <Aviso variante="error">{error}</Aviso> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={cargando}>
          {textos.enviar}
        </Boton>
      </div>
    </form>
  );
}
