"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { interpretarNumero, textoCanonico } from "@/core/datos/numero-tecleado";
import { validarImporte } from "@/core/datos/importe";
import { validarCantidad } from "@/core/datos/cantidad";
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
   * Opcionales y serializables (un Server Component puede pasarlas). Sin `tipo`, el campo solo valida el formato del número. Con
   * `tipo="importe"` valida con `validarImporte` (2 decimales, no negativo salvo `permitirNegativo`); con `tipo="cantidad"` con
   * `validarCantidad` (hasta `decimales` decimales). El servidor vuelve a validar todo con las mismas funciones.
   */
  tipo?: "importe" | "cantidad";
  /** Sujeto del mensaje de error ("El precio total" → "El precio total no es un número válido."). */
  etiqueta?: string;
  /** Solo `tipo="cantidad"`: decimales que admite la unidad. */
  decimales?: number;
  permitirNegativo?: boolean;
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
 * Lo tecleado se interpreta con el parser central `interpretarNumero`
 * (src/core/datos/numero-tecleado.ts, docs/plan-validacion-de-datos-2026-09-25.md):
 * coma o punto como decimal, miles bien agrupados ("1.000.000"), y nada de
 * borrar caracteres en silencio. Lo que el campo EMITE (`onChange` / el
 * `<input type="hidden">`):
 *  - vacío → "";
 *  - un número válido → su texto canónico ("1234.56": dígitos y un solo punto);
 *  - un texto que no es número → el texto TAL CUAL (nunca "" ni "0"), así un
 *    `required` o un `!== ""` lo cuentan como cargado y no se manda un 0 falso.
 * Con un texto inválido el campo queda `invalido` (`aria-invalid` y borde de error, sin mensaje en pantalla) y con
 * `setCustomValidity(mensaje)`: el navegador frena el envío del formulario
 * (validación nativa, antes del evento `submit`). La validez se calcula desde
 * el valor EMITIDO, no desde el texto formateado que se ve.
 */
function valorAEmitir(texto: string): string {
  const r = interpretarNumero(texto);
  if (!r.ok) return texto;
  return r.valor === null ? "" : textoCanonico(r.valor);
}

function formatear(valor: string): string {
  const r = interpretarNumero(valor);
  if (!r.ok || r.valor === null) return r.ok ? "" : valor;
  return r.valor.toLocaleString("es-AR", { maximumFractionDigits: 4 });
}

/** `setSelectionRange` y no `select()`: en Safari de iOS `select()` no siempre selecciona el texto de un campo; `setSelectionRange` sí. */
function seleccionarTodo(el: HTMLInputElement) {
  el.setSelectionRange(0, el.value.length);
}

/** Sin `decimales` explícitos, una cantidad admite los 4 de las columnas Decimal(14,4). */
const DECIMALES_CANTIDAD_SIN_UNIDAD = 4;

/** Mensaje de error del valor emitido, o null si es válido. Con `tipo` usa la MISMA función que la Server Action. */
function mensajeDeError(valor: string, { tipo, etiqueta, decimales, permitirNegativo }: Pick<Props, "tipo" | "etiqueta" | "decimales" | "permitirNegativo">): string | null {
  if (tipo === "importe") {
    const r = validarImporte(valor, { etiqueta: etiqueta ?? "El importe", permitirNegativo });
    return r.ok ? null : r.mensaje;
  }
  if (tipo === "cantidad") {
    // El cero lo decide cada proceso en el servidor (Ajuste lo admite): acá solo formato, signo, tope y decimales.
    const r = validarCantidad(valor, { nombre: "", decimales: decimales ?? DECIMALES_CANTIDAD_SIN_UNIDAD }, { etiqueta: etiqueta ?? "La cantidad", permitirNegativo, permitirCero: true });
    return r.ok ? null : r.mensaje;
  }
  const r = interpretarNumero(valor);
  return r.ok ? null : r.mensaje;
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
}: Props) {
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(defaultValue ?? "");
  const valorReal = controlado ? (value ?? "") : interno;

  const [texto, setTexto] = useState(() => formatear(valorReal));
  const [enFoco, setEnFoco] = useState(false);
  // Reformatea cuando `valorReal` cambia desde AFUERA (ej. reset tras
  // submit) mientras el campo no tiene foco — ajustar estado durante el
  // render en vez de en un efecto (mismo criterio que onFocus/onBlur más
  // abajo, que ya hacen lo mismo de forma directa): evita el round-trip
  // extra de un efecto para lo que es, en los hechos, sincronizar con un
  // prop externo, no con un sistema externo real.
  const [valorRealSincronizado, setValorRealSincronizado] = useState(valorReal);
  if (!enFoco && valorReal !== valorRealSincronizado) {
    setValorRealSincronizado(valorReal);
    setTexto(formatear(valorReal));
  }

  // Validez nativa: se sincroniza el DOM (setCustomValidity no es estado de React) desde el valor emitido.
  const error = mensajeDeError(valorReal, { tipo, etiqueta, decimales, permitirNegativo });
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

  return (
    <div className={className}>
      {name && <input type="hidden" name={name} value={valorReal} onChange={() => {}} />}
      {/* `Campo` dibuja el <input> (aspecto, foco, 44 px en celular). No dibuja `<label>`: el nombre lo pone `ariaLabel` o la etiqueta de afuera que envuelve al campo o se ata por `htmlFor`
          (la regla `campos-con-nombre` lo verifica en cada uso). `etiqueta` NO se le pasa: es el sujeto del mensaje de error, no un rótulo. El mensaje de error NO se muestra: el campo solo
          queda `invalido` (`aria-invalid` y borde) y `setCustomValidity` frena el envío. */}
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
        invalido={error !== null}
        tamano={tamano}
        alinear="fin"
        prefijo={prefijo}
        onFocus={() => {
          setEnFoco(true);
          setTexto(valorReal);
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
          setTexto(e.target.value);
          const emitido = valorAEmitir(e.target.value);
          if (controlado) onChange?.(emitido);
          else setInterno(emitido);
        }}
        onBlur={() => {
          punteroDaElFoco.current = false;
          setEnFoco(false);
          setTexto(formatear(valorReal));
        }}
      />
    </div>
  );
}
