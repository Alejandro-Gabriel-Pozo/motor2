import { Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import type { ResultadoAccion } from "@/server/actions/tipos";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, textosDeLaPantallaDePromos } from "@/core/carta/public";
import { Aviso } from "@/ui/primitivas/aviso";
import { Casilla } from "@/ui/primitivas/casilla";

/**
 * «Dónde se ve» una promo (interruptor «solo salón», docs/diseno-promo-solo-salon-2026-10-26.md): con «solo salón» prendido la promo se vende desde el POS pero NO aparece en la carta pública (web, QR ni impresa). Quien puede definir promos
 * (`carta_promo_definir`) ve la casilla y el botón; quien no, el dato de solo lectura. La acción (`guardar`) se define en la página (los closures "use server" solo valen en el archivo que los declara) y lleva la versión que vio la pantalla.
 * Aviso de texto, sin bloquear (P4 del diseño): una promo en «solo salón» SIN cupos es informativa y el POS la ignora, así que no se vería en ningún lado.
 */
export function DondeSeVe({
  titulo,
  soloSalon,
  tieneCupos,
  puedeDefinir,
  guardar,
}: {
  titulo: string;
  soloSalon: boolean;
  tieneCupos: boolean;
  puedeDefinir: boolean;
  guardar: (formData: FormData) => Promise<ResultadoAccion>;
}) {
  const t = textosDeLaPantallaDePromos(ARMADO_DE_PROMO_COMO_PEDERNAL);
  return (
    <div className={ARMADO_DE_PROMO_COMO_PEDERNAL ? "mt-3 flex flex-col gap-2" : "mt-3 flex flex-col gap-1"} data-donde-se-ve={titulo}>
      <h3 className="text-sm font-medium">Dónde se ve</h3>
      {puedeDefinir ? (
        <FormConResultado accion={guardar} ofrecerRecargar className={ARMADO_DE_PROMO_COMO_PEDERNAL ? "flex flex-col gap-3" : "flex flex-col gap-2"}>
          <Casilla
            name="soloSalon"
            defaultChecked={soloSalon}
            etiqueta={t.soloSalonEtiqueta}
            ayuda={t.soloSalonAyuda ?? undefined}
          />
          <div>
            <BotonDeServidor type="submit" tamano="compacto">
              Guardar dónde se ve
            </BotonDeServidor>
          </div>
        </FormConResultado>
      ) : (
        <DatosSoloLectura>
          <Dato etiqueta="Dónde se ve">{soloSalon ? t.soloSalonDato : "Salón y carta pública"}</Dato>
        </DatosSoloLectura>
      )}
      {soloSalon && !tieneCupos && t.avisoSoloSalonSinCupos !== null ? (
        <Aviso variante="advertencia" forma="en-linea" data-aviso-solo-salon-sin-cupos={titulo}>
          {t.avisoSoloSalonSinCupos}
        </Aviso>
      ) : null}
    </div>
  );
}
