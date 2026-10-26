"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import { useRouter } from "next/navigation";
import { CampoNumero } from "@/components/campo-numero";
import { MAX_OPCIONES_EN_UN_ALTA } from "@/core/features/catalogo/opciones-de-venta.guard";
import { LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA, type ComoCambiaElPrecio, type ReferenciaDePrecio } from "@/core/opciones/public";
import { crearGrupoEnElProducto } from "@/server/actions/catalogo/opciones-de-venta";
import { LecturaEnVivo } from "@/ui/componentes/datos/lectura-en-vivo";
import { Dialogo } from "@/ui/componentes/superposiciones/dialogo";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import { LecturaDePrecio } from "./lectura-de-precio";
import {
  admitePrefijo,
  armarComandoDeGrupoNuevo,
  filaNueva,
  formularioInicial,
  llevaImporte,
  lecturaDeLaFilaNueva,
  textoDeLecturaEnCarta,
  type FilaDeOpcionNueva,
  type FormularioDeGrupoNuevo,
} from "./nuevo-grupo-en-el-producto-formulario";

/**
 * La ventana «+ Nuevo grupo» del producto (Fase 6, paso 6.15c; «el espacio del producto», DEC-12): crear un grupo de opciones SIN salir del producto, todo en una ventana. Un botón abre un `Dialogo`
 * ancho con el formulario; «Crear grupo» llama a `crearGrupoEnElProducto` (6.14c: el grupo de la biblioteca, sus opciones y lo que el producto admite de ellas, en UNA transacción, todo o nada).
 *
 * El formulario, de arriba abajo:
 *  - «Nombre del grupo»;
 *  - «¿Cambia el precio?» (`OpcionesExcluyentes` en tarjetas, con su leyenda): «No, va incluido» · «Solo algunas opciones suman un importe» · «Cada opción define el precio final». No hay una respuesta
 *    por defecto y el tipo no se cambia después;
 *  - «Se lee en la carta como» (solo si suma o define el precio) con «En la carta se verá: …»;
 *  - las opciones: nombre y, si la respuesta lleva importe, su importe (`CampoNumero tipo="importe"`) con la lectura del precio debajo (`LecturaDePrecio`); «+ Otra opción» hasta
 *    `MAX_OPCIONES_EN_UN_ALTA`.
 * Todo lo puro (armar el comando, qué se lee) está en `nuevo-grupo-en-el-producto-formulario.ts`.
 *
 * Al salir bien la ventana se cierra, un `Aviso` de éxito queda al lado del botón y la página se refresca (`router.refresh()`); si el servidor rechaza, el `Aviso` de error queda DENTRO de la ventana, que
 * no se cierra (lo tecleado no se pierde). Un doble clic no manda dos envíos: «Crear grupo» queda en `cargando` (`aria-busy`, ignora los clics) y una guarda síncrona frena el reenvío; igual, el
 * servidor es idempotente por estado (un reintento adopta el grupo ya creado). Enter dentro de un campo NO envía (como `FormConResultado`): crear datos de verdad pide tocar el botón.
 *
 * Sin permiso no se dibuja: eso lo decide la PÁGINA en el servidor (necesita Editar de `opciones_definir` además del de las opciones del producto; la acción lo vuelve a exigir). `referencia` y
 * `precioDeLista` son opcionales: con ellos, lo que suma una opción se lee contra el precio del producto («Napolitana con Trucha = $ 25.000 + $ 3.000 = $ 28.000»); sin ellos, esa lectura no se inventa una base.
 */
export function NuevoGrupoEnElProducto({
  productoId,
  productoNombre,
  referencia = null,
  precioDeLista = null,
}: {
  productoId: string;
  productoNombre: string;
  /** Lo más barato guardado del grupo que fija el precio del producto (`referenciaDePrecioDeAdmisiones`), para leer lo que suma una opción. */
  referencia?: ReferenciaDePrecio | null;
  /** El precio de lista del producto si se cobra (`null`: se vende por opción y todavía no tiene precio final). */
  precioDeLista?: number | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [formulario, setFormulario] = useState<FormularioDeGrupoNuevo>(formularioInicial);
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
    setFormulario(formularioInicial());
    setError(null);
    setExito(null);
    setAbierto(true);
  }

  function agregarOpcion() {
    // La clave de la fila nueva sale de las que ya hay (una por encima de la mayor), así dos clics seguidos nunca repiten una.
    setFormulario((f) => (f.filas.length >= MAX_OPCIONES_EN_UN_ALTA ? f : { ...f, filas: [...f.filas, filaNueva(f.filas.reduce((mayor, fila) => Math.max(mayor, fila.clave), -1) + 1)] }));
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando.current) return;
    enviando.current = true;
    setCargando(true);
    setError(null);
    try {
      const resultado = await crearGrupoEnElProducto(armarComandoDeGrupoNuevo(productoId, formulario));
      if (resultado.ok) {
        setAbierto(false);
        setExito(resultado.mensaje);
        router.refresh();
      } else {
        setError(resultado.mensaje);
      }
    } catch {
      setError("No se pudo crear el grupo. Revisá tu conexión y probá de nuevo.");
    } finally {
      enviando.current = false;
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Boton variante="secundario" onClick={abrir}>
          + Nuevo grupo
        </Boton>
      </div>
      {exito ? <Aviso variante="exito">{exito}</Aviso> : null}
      <Dialogo abierto={abierto} titulo={`Nuevo grupo para «${productoNombre}»`} ancho="ancho" onCerrar={() => setAbierto(false)}>
        <FormularioDeGrupoNuevoEnVentana
          formulario={formulario}
          alCambiar={setFormulario}
          alAgregarOpcion={agregarOpcion}
          alEnviar={(e) => void enviar(e)}
          alCancelar={() => setAbierto(false)}
          error={error}
          cargando={cargando}
          refNombre={campoNombre}
          referencia={referencia}
          precioDeLista={precioDeLista}
        />
      </Dialogo>
    </div>
  );
}

const PREGUNTA = "¿Cambia el precio?";

const RESPUESTAS: readonly { valor: ComoCambiaElPrecio; etiqueta: string; ayuda: string }[] = [
  { valor: "INCLUIDO", etiqueta: "No, va incluido", ayuda: "Las opciones no cambian el precio (por ejemplo, el punto de cocción)." },
  { valor: "SUMA", etiqueta: "Solo algunas opciones suman un importe", ayuda: "Lo que suma se agrega al precio del producto (por ejemplo, un extra)." },
  { valor: "PRECIO_FINAL", etiqueta: "Cada opción define el precio final", ayuda: "El producto se cobra según la opción que se elige (por ejemplo, el tamaño)." },
];

/**
 * El formulario de la ventana, solo con lo que recibe (sin estado propio ni llamadas): lo dibuja `NuevoGrupoEnElProducto` adentro del `Dialogo` y lo prueban los tests con `renderToStaticMarkup`, que no
 * puede abrir un diálogo.
 */
export function FormularioDeGrupoNuevoEnVentana({
  formulario,
  alCambiar,
  alAgregarOpcion,
  alEnviar,
  alCancelar,
  error,
  cargando,
  refNombre,
  referencia,
  precioDeLista,
}: {
  formulario: FormularioDeGrupoNuevo;
  alCambiar: (f: FormularioDeGrupoNuevo) => void;
  alAgregarOpcion: () => void;
  alEnviar: (e: FormEvent<HTMLFormElement>) => void;
  alCancelar: () => void;
  error: string | null;
  cargando: boolean;
  refNombre?: Ref<HTMLInputElement>;
  referencia: ReferenciaDePrecio | null;
  precioDeLista: number | null;
}) {
  const { respuesta, filas } = formulario;
  const cambiarFila = (clave: number, parcial: Partial<FilaDeOpcionNueva>) => alCambiar({ ...formulario, filas: filas.map((f) => (f.clave === clave ? { ...f, ...parcial } : f)) });
  // Como `FormConResultado`: Enter dentro de un campo no envía (se crearían datos de verdad sin tocar «Crear grupo»); el botón sigue respondiendo a Enter y Espacio.
  const sinEnviarConEnter = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
  };
  const importeDe = (n: number) => (respuesta === "SUMA" ? `Importe que suma la opción ${n}` : `Precio final de la opción ${n}`);

  return (
    <form onSubmit={alEnviar} onKeyDown={sinEnviarConEnter} aria-busy={cargando || undefined} className="flex flex-col gap-4">
      <Campo etiqueta="Nombre del grupo" ref={refNombre} required autoComplete="off" value={formulario.nombre} onChange={(e) => alCambiar({ ...formulario, nombre: e.target.value })} placeholder="Por ejemplo: Tamaño" />

      <div className="flex flex-col gap-1">
        <OpcionesExcluyentes
          leyenda={PREGUNTA}
          nombre="cambiaElPrecio"
          presentacion="tarjetas"
          valorInicial={respuesta}
          alCambiar={(valor) => alCambiar({ ...formulario, respuesta: valor as ComoCambiaElPrecio })}
          opciones={RESPUESTAS}
        />
        <p className="text-xs text-tinta-suave">Una vez creado, el tipo no se cambia después: si te equivocás, se crea otro grupo.</p>
      </div>

      {admitePrefijo(respuesta) ? (
        <div className="flex flex-col gap-1">
          <Campo
            etiqueta="Se lee en la carta como"
            maxLength={LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA}
            autoComplete="off"
            value={formulario.prefijo}
            onChange={(e) => alCambiar({ ...formulario, prefijo: e.target.value })}
            placeholder="Por ejemplo: De"
            ayuda={`Opcional, hasta ${LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA} caracteres. Solo lo usa la carta: el POS y el ticket muestran el grupo y la opción tal cual.`}
          />
          <LecturaEnVivo>{textoDeLecturaEnCarta(formulario.prefijo, filas.map((f) => f.nombre))}</LecturaEnVivo>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Opciones del grupo</legend>
        <ul className="flex flex-col gap-3">
          {filas.map((fila, i) => {
            const n = i + 1;
            const lectura = lecturaDeLaFilaNueva({ respuesta, fila, precioDeLista, referencia });
            return (
              <li key={fila.clave} data-opcion-nueva={n} className="flex flex-col gap-2 rounded border border-borde p-3">
                <Campo etiqueta={`Nombre de la opción ${n}`} autoComplete="off" value={fila.nombre} onChange={(e) => cambiarFila(fila.clave, { nombre: e.target.value })} />
                {llevaImporte(respuesta) ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`importe-de-la-opcion-${fila.clave}`} className="text-sm font-medium">
                      {importeDe(n)}
                    </label>
                    <CampoNumero
                      id={`importe-de-la-opcion-${fila.clave}`}
                      value={fila.importe}
                      onChange={(v) => cambiarFila(fila.clave, { importe: v })}
                      prefijo="$"
                      tipo="importe"
                      etiqueta={`El importe de la opción ${n}`}
                      className="w-44"
                    />
                    {lectura ? <LecturaDePrecio lectura={lectura} /> : <LecturaEnVivo />}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div>
          <Boton variante="secundario" onClick={alAgregarOpcion} disabled={filas.length >= MAX_OPCIONES_EN_UN_ALTA}>
            + Otra opción
          </Boton>
        </div>
        {filas.length >= MAX_OPCIONES_EN_UN_ALTA ? <p className="text-xs text-tinta-suave">Hasta {MAX_OPCIONES_EN_UN_ALTA} opciones por vez: las demás se agregan después, desde el grupo.</p> : null}
      </fieldset>

      {error ? <Aviso variante="error">{error}</Aviso> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Boton variante="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={cargando}>
          Crear grupo
        </Boton>
      </div>
    </form>
  );
}
