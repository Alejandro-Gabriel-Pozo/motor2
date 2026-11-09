"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { aplicarEdicion, contextoDelCampo, errorDelCampo, origenDeLaEdicion, textoEntendido, textoParaEditar, textoParaVer, valorAEmitir, type TipoDeCampoNumerico } from "@/core/datos/campo-numero-logica";
import { AVISO_DEL_PUNTO } from "@/core/datos/numero-tecleado";
import { Aviso } from "@/ui/primitivas/aviso";
import { Campo } from "@/ui/primitivas/campo";

interface Props {
  id?: string;
  /** Modo no-controlado (formularios con <form action={serverAction}>, FormData nativo) — el valor real viaja en un <input type="hidden"> con este name. */
  name?: string;
  /** Modo controlado (la mayoría de los forms del proyecto, que ya manejan estado propio). */
  value?: string;
  /** Valor inicial en modo no-controlado. */
  defaultValue?: string;
  onChange?: (valor: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Foco automático al montar (ej. el primer campo de un diálogo recién abierto) — mismo `autoFocus` nativo de un `<input>`. */
  autoFocus?: boolean;
  /** Nombre accesible del campo cuando no hay un `<label>` asociado (un placeholder desaparece al tipear y no es un nombre confiable para un lector de pantalla). */
  ariaLabel?: string;
  /** Ej. "$" — se muestra al costado del campo, nunca dentro del valor editable (mismo criterio que ERPNext/Dolibarr: el símbolo no es parte de lo que se tipea). */
  prefijo?: string;
  /** El tamaño de `Campo`: "normal" (campo de formulario apilado) o "compacto" (campo dentro de una fila); los dos, de 44 px en celular. */
  tamano?: "normal" | "compacto";
  className?: string;
  /**
   * El TIPO de dato que recibe el campo: OBLIGATORIO (lo bloquea el compilador; cercos de `type="number"` y de `Number(formData.get(…))`). `importe` (plata: 2 decimales, no negativo salvo `permitirNegativo`,
   * validado con `validarImporte`), `cantidad` (hasta `decimales` decimales, los de su unidad; validado con `validarCantidad`), `entero` (sin decimales: minutos, días) y `porcentaje` (una merma, una
   * diferencia: los 4 decimales de su columna salvo que se diga otra cosa). El servidor vuelve a validar todo con las mismas funciones. Serializable (un Server Component puede pasarlo).
   */
  tipo: TipoDeCampoNumerico;
  /** Sujeto del mensaje de error ("El precio total" → "El precio total no es un número válido."). */
  etiqueta?: string;
  /** Solo `tipo="cantidad"` y `tipo="porcentaje"`: decimales que admite la unidad o la columna (sin ellos, los 4 de las columnas `Decimal(14,4)`). */
  decimales?: number;
  permitirNegativo?: boolean;
  /** Ej. "g": la unidad del número, para el «= 60 g» que se muestra junto al campo mientras se edita. */
  unidad?: string;
  /** Texto fijo bajo el campo (lo dibuja `Campo`, atado con `aria-describedby`). */
  ayuda?: ReactNode;
  /** Un error de regla de NEGOCIO que calcula quien usa el campo («No es válido: tiene que ser un número entre 0 y 1»): se dice junto al campo, como el de lo tecleado, y marca el campo. No frena el envío (lo frena el servidor). */
  errorDeRegla?: ReactNode;
  /** No muestra el «= …» junto al campo: solo para quien ya lo muestra por su cuenta (la lectura en vivo de la cantidad de la receta, que además convierte de unidad). */
  sinEntendido?: boolean;
}

/**
 * Reemplazo de `<input type="number">` para plata y cantidades — hallazgo
 * de la diligencia de motor2 ("esto no es propio de un ERP", el spinner
 * nativo del navegador). Verificado contra ERPNext y Dolibarr: ninguno de
 * los dos usa `type="number"` para estos campos — los dos son texto con
 * separador de miles al mostrar, sin flechitas, todo el valor seleccionado
 * al hacer foco.
 *
 * Mientras el campo tiene el foco se ve el número crudo tal cual se tipea
 * (sin reformatear en cada tecla, para no pelear con la posición del
 * cursor); al salir del campo se muestra formateado en es-AR.
 *
 * Seleccionar todo al tomar el foco (así lo que se tipea REEMPLAZA al valor
 * anterior) se hace en dos lugares, porque un `select()` en el `onFocus` se
 * perdía en los dos casos (tocar un precio «0,02» y tipear «1,5» dejaba
 * «1,50.02», y entrando con Tab, «0.021,5», que se leía como 21,5):
 *  - DESPUÉS de que React pone el texto crudo (efecto de layout al pasar a
 *    `enFoco`): cambiar el valor de un `<input>` deja el cursor al final y
 *    borraba la selección hecha en el `onFocus`, con el texto todavía
 *    formateado.
 *  - De nuevo en el `mouseup` del MISMO toque o clic que dio el foco (en
 *    táctil el navegador también dispara mousedown/mouseup), si para
 *    entonces la selección quedó en un cursor: es el patrón de siempre para
 *    Safari/WebKit, que ubica el cursor donde cae el dedo o el puntero
 *    DESPUÉS del `focus`. En Chromium no hace falta (alcanza lo anterior;
 *    test/e2e/campo-numero-tactil.spec.ts corre solo en Chromium). Solo en
 *    ese primer toque y solo si no se arrastró una selección propia: con el
 *    campo ya enfocado, tocar de nuevo ubica el cursor como siempre.
 *
 * Lo tecleado se interpreta con el parser central `interpretarNumeroTecleado` (src/core/datos/numero-tecleado.ts) y el CONTEXTO del campo: un importe admite 2 decimales, una cantidad los de su unidad
 * (`decimales`) y, sin `tipo`, los 4 de las columnas `Decimal(14,4)`. REGLA DE NÚMEROS (dueño, 2026-11-09; docs/diseno-campo-numerico-entrada-2026-11-09.md): se escriben solo dígitos y UNA coma para los decimales;
 * el «.» no se acepta. Una tecla «.» se ignora y se avisa junto al campo («Los decimales van con coma: 0,5»); un pegado, arrastre o autocompletado con «.» se rechaza ENTERO y el campo queda como estaba (`aplicarEdicion`).
 * El sistema agrega el punto de miles al mostrar («1.000,00») y, mientras se edita, dice el número entendido («= 1.000,00», «= 60 g»). Lo que no se entiende se dice junto al campo, con cómo escribirlo; nada se borra en silencio.
 *
 * Lo que el campo EMITE (`onChange` / el `<input type="hidden">`) es el «canal de valor» (`leerNumeroCanonico`):
 *  - vacío → "";
 *  - un número válido → su texto canónico ("1234.56": dígitos y un solo punto, que ACÁ es siempre el decimal);
 *  - un texto que no es número → el texto TAL CUAL (nunca "" ni "0"), y si ese texto PARECE canónico («1.5» en una unidad entera) con una marca que lo vuelve ilegible como canónico
 *    (`marcarNoCanonico`), así nadie lo lee como número en silencio. Un `required` o un `!== ""` lo cuentan como cargado.
 * Con un texto inválido el campo queda `invalido` (`aria-invalid` y borde de error), dice el error debajo y usa `setCustomValidity(mensaje)`: el navegador frena el envío del formulario
 * (validación nativa, antes del evento `submit`). La validez se calcula desde el valor EMITIDO, no desde el texto formateado que se ve.
 */
/** `setSelectionRange` y no `select()`: en Safari de iOS `select()` no siempre selecciona el texto de un campo; `setSelectionRange` sí. */
function seleccionarTodo(el: HTMLInputElement) {
  el.setSelectionRange(0, el.value.length);
}

export function CampoNumero({
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
  placeholder,
  ariaLabel,
  prefijo,
  tamano = "normal",
  className,
  tipo,
  etiqueta,
  decimales,
  permitirNegativo,
  autoFocus,
  unidad,
  sinEntendido,
  ayuda,
  errorDeRegla,
}: Props) {
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(defaultValue ?? "");
  const valorReal = controlado ? (value ?? "") : interno;

  const [texto, setTexto] = useState(() => textoParaVer(valorReal, tipo));
  const [enFoco, setEnFoco] = useState(false);
  // true desde que se ignoró o rechazó un «.» hasta la siguiente edición sin punto o la salida del campo.
  const [avisoDelPunto, setAvisoDelPunto] = useState(false);
  // Reformatea cuando `valorReal` cambia desde AFUERA (ej. reset tras
  // submit) mientras el campo no tiene foco — ajustar estado durante el
  // render en vez de en un efecto (mismo criterio que onFocus/onBlur más
  // abajo, que ya hacen lo mismo de forma directa): evita el round-trip
  // extra de un efecto para lo que es, en los hechos, sincronizar con un
  // prop externo, no con un sistema externo real.
  const [valorRealSincronizado, setValorRealSincronizado] = useState(valorReal);
  if (!enFoco && valorReal !== valorRealSincronizado) {
    setValorRealSincronizado(valorReal);
    setTexto(textoParaVer(valorReal, tipo));
  }

  // Validez nativa: se sincroniza el DOM (setCustomValidity no es estado de React) desde el valor emitido.
  const contexto = contextoDelCampo(tipo, decimales);
  const falla = errorDelCampo(valorReal, contexto, { tipo, etiqueta, permitirNegativo });
  const error = falla?.mensaje ?? null;
  // Lo que se tecleó y no es un número en este contexto se explica junto al campo (el resto de los errores, el signo o el tope, los frena la validez nativa y los dice el servidor).
  const errorTecleado = falla?.origen === "tecleado" ? falla.mensaje : undefined;
  const entrada = useRef<HTMLInputElement>(null);
  // true entre el mousedown que da el foco y su mouseup. Solo se lee y se escribe en manejadores de eventos (nunca en el render).
  const punteroDaElFoco = useRef(false);
  useEffect(() => {
    entrada.current?.setCustomValidity(error ?? "");
  }, [error]);

  // Con el texto crudo ya en el DOM: todo seleccionado (ver el comentario de arriba). Antes de pintar, así nada tecleado llega antes.
  useLayoutEffect(() => {
    const el = entrada.current;
    if (enFoco && el && document.activeElement === el) seleccionarTodo(el);
  }, [enFoco]);

  const entendido = enFoco && !sinEntendido ? textoEntendido(valorReal, tipo, unidad) : null;

  return (
    <div className={className ? `relative ${className}` : "relative"}>
      {name && <input type="hidden" name={name} value={valorReal} onChange={() => {}} />}
      {/* `Campo` dibuja el <input> (aspecto, foco, 44 px en celular). No dibuja `<label>`: el nombre lo pone `ariaLabel` o la etiqueta de afuera que envuelve al campo o se ata por `htmlFor`
          (la regla `campos-con-nombre` lo verifica en cada uso). `etiqueta` NO se le pasa: es el sujeto del mensaje de error, no un rótulo. Lo que se tecleó y no es un número en el
          contexto del campo se dice debajo (`error`, con `role="alert"`); el campo queda `invalido` (`aria-invalid` y borde) y `setCustomValidity` frena el envío. */}
      <Campo
        {...(ariaLabel ? { "aria-label": ariaLabel } : { nombradoPorFuera: true as const })}
        ref={entrada}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={texto}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        invalido={error !== null || Boolean(errorDeRegla)}
        ayuda={ayuda}
        error={errorTecleado ?? errorDeRegla}
        tamano={tamano}
        alinear="fin"
        prefijo={prefijo}
        onFocus={() => {
          setEnFoco(true);
          setTexto(textoParaEditar(valorReal));
        }}
        onMouseDown={(e) => {
          punteroDaElFoco.current = document.activeElement !== e.currentTarget;
        }}
        onMouseUp={(e) => {
          if (!punteroDaElFoco.current) return;
          punteroDaElFoco.current = false;
          const el = e.currentTarget;
          if (document.activeElement === el && el.selectionStart === el.selectionEnd) {
            e.preventDefault();
            seleccionarTodo(el);
          }
        }}
        onChange={(e) => {
          const nativo = e.nativeEvent as Partial<InputEvent>;
          const edicion = aplicarEdicion(texto, e.target.value, origenDeLaEdicion(nativo.inputType, nativo.data), e.target.selectionStart);
          setAvisoDelPunto(edicion.avisoDelPunto);
          const el = e.target;
          const cursor = edicion.avisoDelPunto ? edicion.cursor : null;
          // Tras ignorar un «.» React deja el cursor al final del texto: se lo devuelve a donde estaba la tecla, ya terminado el evento (React restaura el valor del campo controlado al final del manejador).
          if (cursor !== null) queueMicrotask(() => document.activeElement === el && el.setSelectionRange(cursor, cursor));
          setTexto(edicion.texto);
          const emitido = valorAEmitir(edicion.texto, contexto);
          if (controlado) onChange?.(emitido);
          else setInterno(emitido);
        }}
        onBlur={() => {
          punteroDaElFoco.current = false;
          setEnFoco(false);
          setAvisoDelPunto(false);
          setTexto(textoParaVer(valorReal, tipo));
        }}
      />
      {/* El aviso y el «= …» NO ocupan lugar en la página (`absolute`): aparecen al tomar el foco y se van al salir, y si empujaran lo de abajo, el clic en un botón o una casilla que está justo debajo del campo
          (que primero le saca el foco) caería en otro lado. `pointer-events-none`: nunca tapan un clic. */}
      {(avisoDelPunto || entendido) && (
        <div className="pointer-events-none absolute left-0 top-full z-10 mt-0.5 flex flex-col whitespace-nowrap rounded bg-superficie px-1">
          {avisoDelPunto && (
            <Aviso variante="advertencia" forma="en-linea">
              {AVISO_DEL_PUNTO}
            </Aviso>
          )}
          {entendido && (
            <p aria-live="polite" className="text-sm text-tinta-suave">
              {entendido}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
