import { notFound, redirect } from "next/navigation";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/server/acceso/gate";
import { cargarAdminCarta } from "@/server/consultas/carta/admin";
import { cargarCombosDeLaCarta } from "@/server/consultas/carta/combos";
import { cargarRepartoDeLasPromos } from "@/server/consultas/carta/reparto-de-las-promos";
import {
  actualizarActivaPromoCarta,
  actualizarActivaPromoCartaEnSucursal,
  guardarParteDePromo,
  guardarPrecioLocalPromoCarta,
  guardarPromoCarta,
  guardarSoloSalonPromoCarta,
} from "@/server/actions/carta/promos";
import { BotonDeServidor } from "@/components/boton-de-servidor";
import { FormConResultado } from "@/components/form-con-resultado";
import { CampoNumero } from "@/components/campo-numero";
import { AvisoSoloLectura, Dato, DatosSoloLectura } from "@/components/carta/datos-solo-lectura";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { ARMADO_DE_PROMO_COMO_PEDERNAL, PESTANAS_DE_PROMOCIONES, armarFilasDeLaPromo, componentesDeLaFicha, filasParaAgregar, loQueLlevaLaPromo, textosDeLaPantallaDePromos } from "@/core/carta/public";
import { formatearMonto } from "@/core/formato-de-numero";
import { EncabezadoDeCarta } from "../../../encabezado-de-carta";
import estilos from "../../../carta-mant.module.css";
import { ComponentesDelCombo } from "../componentes-del-combo";
import { DondeSeVe } from "../donde-se-ve";
import { FichaDelCombo } from "../ficha-del-combo";
import { ComoLoVeElCliente, RepartoDelPrecio } from "../reparto-del-precio";
import { refrescarVistaSiHaceFalta } from "@/server/actions/refrescar";
import type { ResultadoAccion } from "@/server/actions/tipos";

const RUTA_DE_LA_LISTA = "/carta/parametrizacion/promociones";
/** El «id» de la ruta que abre la ficha vacía (no es un id de promo: los ids son cuid). */
const ID_DEL_COMBO_NUEVO = "nuevo";

/** Ayudantes puros de los closures "use server" de esta página (locales a propósito: `use-server-solo-donde-corresponde` solo los acepta definidos en el mismo archivo). */
const texto = (v: unknown) => (typeof v === "string" ? v : "");
const refrescarSiOk = (r: ResultadoAccion) => {
  if (r.ok) refrescarVistaSiHaceFalta();
  return r;
};

/**
 * Ficha de un combo «como la maqueta» (`combos.html` de Pedernal; `docs/combos-como-la-maqueta-diferencias-2026-11-17.md`): `/carta/parametrizacion/promociones/<id>` para uno que existe y `/…/nuevo` para uno nuevo. SOLO existe con el interruptor
 * `ARMADO_DE_PROMO_COMO_PEDERNAL` encendido; apagado responde «no encontrada» (la pantalla de siempre vive en la lista). Mismos permisos que la lista (`carta_ver` para entrar; `carta_promo_definir`, `carta_promo_activar` y `carta_promo_precio_local` para cada formulario;
 * sin permiso, solo lectura) y los MISMOS comandos de servidor: ni comandos ni tablas nuevas. El id de la URL es lo único que viene del navegador: una promo que no es de esta empresa o que no existe da «no encontrada» (la base filtra por empresa).
 */
export default async function FichaDeComboPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta_ver", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  if (!ARMADO_DE_PROMO_COMO_PEDERNAL) notFound();

  const { id } = await params;
  const esNuevo = id === ID_DEL_COMBO_NUEVO;
  const t = textosDeLaPantallaDePromos(true);
  const [nivelPromoDefinir, nivelPromoActivar, nivelPromoPrecio] = await Promise.all([
    obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "carta_promo_definir", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_activar", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "carta_promo_precio_local", ctx.db),
  ]);
  const puedeDefinirPromos = nivelPromoDefinir.editar;
  const puedeActivarPromos = nivelPromoActivar.editar;
  const puedePrecioLocalPromos = nivelPromoPrecio.editar;
  // La hora se fija acá, en el borde (O.22-c).
  const ahora = new Date();
  const [datos, combos] = await Promise.all([cargarAdminCarta(ctx.sucursalId, ctx.db, ahora), cargarCombosDeLaCarta(ctx.db, ctx.sucursalId)]);
  const pr = esNuevo ? null : (datos.promos.find((x) => x.id === id) ?? null);
  if (!esNuevo && pr === null) notFound();
  // Un combo nuevo solo lo arma quien puede definir promos.
  if (esNuevo && !puedeDefinirPromos) notFound();

  const seccionesActivas = datos.secciones.filter((x) => x.activa);
  const combo = pr ? (combos.porPromo[pr.id] ?? { lugares: [], version: 1, soloSalon: false }) : { lugares: [], version: 1, soloSalon: false };
  const filas = armarFilasDeLaPromo({ secciones: datos.secciones, cuposDeSeccion: pr?.cupos ?? [], lugares: combo.lugares });
  const componentes = componentesDeLaFicha(filas, combos.productos);
  const repartoDeLasPromos = pr && componentes.length ? await cargarRepartoDeLasPromos(ctx.db, ctx.sucursalId, ahora) : null;

  const promoId = pr?.id ?? "";
  const precioLocalVisto = pr?.precioLocal ?? null;
  const versionDeLaPromo = combo.version;
  const lecturas =
    pr && componentes.length > 0 ? (
      <>
        <ComoLoVeElCliente titulo={pr.titulo} precio={pr.precioAca} loQueLleva={loQueLlevaLaPromo(componentes.map((c) => c.parte), t.sinComponentes)} />
        {repartoDeLasPromos && <RepartoDelPrecio precio={pr.precioAca} partes={repartoDeLasPromos[pr.id] ?? []} />}
      </>
    ) : null;

  // Lo que sigue en «Más información»: cada formulario con su propio comando y su propio permiso (de un combo que ya existe).
  const extra = pr ? (
    <>
      {puedePrecioLocalPromos ? (
        <FormConResultado
          accion={async (fd: FormData) => {
            "use server";
            const valor = texto(fd.get("precioLocal")).trim();
            return refrescarSiOk(await guardarPrecioLocalPromoCarta(promoId, valor === "" ? null : valor, precioLocalVisto));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="precio-local" className="text-sm font-medium">
              {t.rotuloDelPrecioLocal}
            </label>
            <CampoNumero id="precio-local" name="precioLocal" tipo="importe" etiqueta="El precio en esta sucursal" prefijo="$" defaultValue={pr.precioLocal === null ? "" : String(pr.precioLocal)} />
          </div>
          <BotonDeServidor type="submit" tamano="compacto">
            Guardar precio de esta sucursal
          </BotonDeServidor>
        </FormConResultado>
      ) : (
        <DatosSoloLectura>
          <Dato etiqueta={t.rotuloDelPrecioLocal}>{pr.precioLocal !== null ? `${formatearMonto(pr.precioLocal)}${datos.precioLocalActivo ? "" : " (no rige: precio local apagado)"}` : "El de la empresa"}</Dato>
        </DatosSoloLectura>
      )}
      <DondeSeVe
        titulo={pr.titulo}
        soloSalon={combo.soloSalon}
        tieneCupos={componentes.length > 0}
        puedeDefinir={puedeDefinirPromos}
        guardar={async (fd: FormData) => {
          "use server";
          return refrescarSiOk(await guardarSoloSalonPromoCarta({ promoCartaId: promoId, versionEsperada: versionDeLaPromo, soloSalon: fd.get("soloSalon") !== null }));
        }}
      />
      {puedeActivarPromos && (
        <FormConResultado
          accion={async () => {
            "use server";
            return refrescarSiOk(await actualizarActivaPromoCartaEnSucursal(promoId, !pr.prendidaAca));
          }}
        >
          <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
            {pr.prendidaAca ? `Apagar «${pr.titulo}» en esta sucursal` : `Prender «${pr.titulo}» en esta sucursal`}
          </BotonDeServidor>
        </FormConResultado>
      )}
      {puedeDefinirPromos && (
        <FormConResultado
          accion={async () => {
            "use server";
            return refrescarSiOk(await actualizarActivaPromoCarta(promoId, !pr.activa));
          }}
        >
          <BotonDeServidor type="submit" variante="enlace" tamano="en-fila">
            {pr.activa ? `Apagar «${pr.titulo}» en toda la empresa` : `Prender «${pr.titulo}» en toda la empresa`}
          </BotonDeServidor>
        </FormConResultado>
      )}
    </>
  ) : null;

  return (
    <div className={estilos.raiz}>
      <EncabezadoDeCarta entrada={t.encabezadoDeLaEntrada} pestana={t.encabezadoDeLaPestana} sucursal={ctx.sucursalNombre}>
        <FilaDeCarta ctx={ctx} etiqueta={t.encabezadoDeLaEntrada} pestanas={PESTANAS_DE_PROMOCIONES} ruta={RUTA_DE_LA_LISTA} />
      </EncabezadoDeCarta>
      <div className={estilos.contenido}>
        <div className={estilos.pad}>
          {!(puedeDefinirPromos || puedeActivarPromos || puedePrecioLocalPromos) && <AvisoSoloLectura />}
          <FichaDelCombo
            nuevo={esNuevo}
            inicial={{
              titulo: pr?.titulo ?? "",
              precio: pr ? String(pr.precio) : "",
              seccionCartaId: pr?.seccionCartaId ?? "",
              descripcion: pr?.descripcion ?? "",
              orden: String(pr?.orden ?? 0),
            }}
            secciones={esNuevo ? seccionesActivas : datos.secciones}
            puedeDefinir={puedeDefinirPromos}
            rutaDeLaLista={RUTA_DE_LA_LISTA}
            guardar={async (campos) => {
              "use server";
              const resultado = await guardarPromoCarta({
                ...(esNuevo ? {} : { id: promoId }),
                seccionCartaId: texto(campos?.seccionCartaId),
                titulo: texto(campos?.titulo),
                descripcion: texto(campos?.descripcion),
                precio: texto(campos?.precio),
                orden: texto(campos?.orden),
              });
              refrescarSiOk(resultado);
              // El alta no devuelve el id del combo creado: se vuelve a la lista, donde ya figura (de ahí se abre su ficha para agregarle componentes).
              if (esNuevo && resultado.ok) redirect(RUTA_DE_LA_LISTA);
              return resultado;
            }}
            componentes={
              <ComponentesDelCombo
                componentes={componentes}
                paraAgregar={filasParaAgregar(filas)}
                productos={combos.productos}
                puedeEditar={puedeDefinirPromos}
                sinGuardar={esNuevo}
                guardar={async (comando) => {
                  "use server";
                  return refrescarSiOk(await guardarParteDePromo({ promoCartaId: promoId, ...comando }));
                }}
              />
            }
            lecturas={lecturas}
            extra={extra}
          />
        </div>
      </div>
    </div>
  );
}
