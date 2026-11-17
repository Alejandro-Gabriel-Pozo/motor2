"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { GestionPresentaciones } from "@/components/catalogo/gestion-presentaciones";
import { nombreDelCampo } from "./nombre-del-campo-del-alta";
import { CampoCategoria } from "./campo-categoria"; import { CampoInsumo } from "./campo-insumo"; import { CampoPasoDeVenta } from "./campo-paso-de-venta";
import { BloqueConsignacion } from "./bloque-consignacion"; import { CamposDeUnidad, type OpcionUnidad } from "./campos-de-unidad";
import { AyudaCampo } from "@/components/ayuda-campo";
import { AyudaDeFicha } from "@/components/catalogo/ayuda-de-ficha";
import { ALTA_DE_PRODUCTO_COMO_PEDERNAL, CLASES_DE_ALTA, claseDeAltaDe, OBSERVACIONES_VISIBLES, PRESENTACIONES_VISIBLES, type ClaveDeClaseDeAlta } from "@/core/catalogo/public";
import { CampoPrecioDeVenta } from "./campo-precio-de-venta"; import { CampoQueEs } from "./campo-que-es"; import { CasillaActivoEnTodas } from "./casilla-activo-en-todas";
import { CampoAlicuotaIva, alicuotasDelFormulario } from "./campo-alicuota-iva"; import { CampoNombreDeCocina, nombreDeCocinaDelFormulario } from "./campo-nombre-de-cocina";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { SincronizarPrecioGrupo } from "@/components/carta/sincronizar-precio-grupo";
import { AvisoCamposSensibles, ValorSoloLectura } from "@/components/catalogo/campos-sensibles-solo-lectura";
import { EnlaceInterno } from "@/components/enlace-interno";
import { AreaDeTexto } from "@/ui/primitivas/area-de-texto";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";
import { Campo } from "@/ui/primitivas/campo";
import { Casilla } from "@/ui/primitivas/casilla";
import { OpcionesExcluyentes } from "@/ui/primitivas/opciones-excluyentes";
import type { CampoSensibleDelProducto } from "@/core/features/catalogo/productos.schema";
import { darDeAltaProducto, actualizarProducto, sincronizarPrecioGrupoCarta, type DatosProducto, type PresentacionOpcion } from "@/server/actions/catalogo/productos";
import type { SincronizablePrecioGrupo } from "@/server/actions/tipos";
import { MODO_DE_VENTA, esBaseConfigurable, modoDeVentaDe, type ModoDeVenta } from "@/core/opciones/public";
import type { TipoProducto } from "@/core/datos/enumerados-del-esquema";
import { formatearMonto } from "@/core/formato-de-numero";

interface Opcion {
  id: string;
  nombre: string;
}

export interface ProductoExistente extends DatosProducto {
  id: string;
  codigo: string;
}

/** M.2: los cuatro datos del producto que protege `producto_campos_sensibles` (el precio de venta, el factor de conversión y las dos unidades). */
type DatosSensibles = Pick<DatosProducto, CampoSensibleDelProducto>;

/** Plata siempre con dos decimales ($3.200,00, $1.234,50): es dinero, y «$1.234,5» se lee mal. */
const pesos = formatearMonto;

export function ProductoForm({
  unidades,
  insumosIniciales,
  categoriasIniciales,
  proveedoresIniciales,
  puedeCrear,
  puedeGestionarConsignacion,
  puedeEditarCamposSensibles,
  productoExistente,
  presentacionesIniciales,
  cantidadSucursales,
  nombreSucursalActual,
  venta,
  soloLectura = false, sinEncabezado = false,
  altaComoPedernal = ALTA_DE_PRODUCTO_COMO_PEDERNAL,
}: {
  sinEncabezado?: boolean; soloLectura?: boolean;
  altaComoPedernal?: boolean; // «¿Qué es?» como Pedernal: por defecto el interruptor ALTA_DE_PRODUCTO_COMO_PEDERNAL (diseño del 2026-11-17); false = la pantalla anterior
  unidades: OpcionUnidad[];
  insumosIniciales: Opcion[];
  categoriasIniciales: Opcion[];
  proveedoresIniciales: Opcion[];
  /** Qué botones «+ Nuevo …» de alta rápida se dibujan: cada uno exige su propio permiso de Editar en el servidor. */
  puedeCrear: { categoria: boolean; insumo: boolean; proveedor: boolean };
  /**
   * S-12 (D8 del dueño): el costo de consignación (es consignación, proveedor y precio) es de quien tiene `pagar_consignante` en alguna sucursal de la empresa (P20). Sin la clave la página ni siquiera le manda el precio ni
   * el consignante a este componente (los props viajan al navegador), el formulario no dibuja esos campos y NO los manda al guardar: «no viene» es «no cambia» en el servidor, que además
   * rechaza un valor distinto del guardado. Cortesía de la pantalla; la barrera es la del servidor.
   */
  puedeGestionarConsignacion: boolean;
  /**
   * M.2 (P6): el precio de venta, el factor de conversión y las unidades son de quien tiene `producto_campos_sensibles` (la página lo calcula en el servidor, `puedeEditarCamposSensiblesDelProducto`). Sin la clave el
   * formulario los muestra en SOLO LECTURA con el valor guardado y, en la edición, no los manda (el servidor completa lo que no viene con lo guardado y rechaza un valor distinto). En el alta se comporta como el
   * servidor (D-2): precio 0, factor 1, sin unidad de compra; la unidad de stock del alta queda libre. Cortesía de la pantalla; la barrera es la del servidor.
   */
  puedeEditarCamposSensibles: boolean;
  productoExistente?: ProductoExistente;
  presentacionesIniciales?: PresentacionOpcion[];
  /** Solo para el alta (§4.1, docs/plan-disponibilidad-por-sucursal-2026-09-23.md) — sin esto el tilde no dice nada concreto. */
  cantidadSucursales?: number;
  nombreSucursalActual?: string;
  /**
   * Fase 4 de la ola «precio y carta» (ADR-035): «¿Cómo se vende?», solo en la edición de un PV. `modo`: el guardado; `grupoConPrecioFinal`: el grupo de medida con el precio final de cada opción, si lo
   * tiene (sin él, «Por opción» se ve apagado con el motivo). Cambiarlo es de quien tiene `producto_campos_sensibles` (sin ella, solo lectura). Siendo base, el precio guardado se muestra en solo
   * lectura y el formulario NO lo manda (el servidor lo conserva y rechaza otro). La regla completa la decide el servidor al guardar.
   */
  venta?: { modo: ModoDeVenta; grupoConPrecioFinal: string | null };
}) {
  const router = useRouter();
  const [insumos, setInsumos] = useState(insumosIniciales);
  const [categorias, setCategorias] = useState(categoriasIniciales);
  const [proveedores, setProveedores] = useState(proveedoresIniciales);

  const [tipo, setTipo] = useState<TipoProducto>(productoExistente?.tipo ?? "MP");
  const [clase, setClase] = useState<ClaveDeClaseDeAlta>(productoExistente ? claseDeAltaDe(productoExistente) : "MATERIA_PRIMA"); // «¿Qué es?»: de ella salen el tipo y «se produce»
  const [insumoId, setInsumoId] = useState(productoExistente?.insumoId ?? "");
  const [unidadStockId, setUnidadStockId] = useState(productoExistente?.unidadStockId ?? "");
  const [categoriaId, setCategoriaId] = useState(productoExistente?.categoriaId ?? "");
  const [esConsignacion, setEsConsignacion] = useState(productoExistente?.esConsignacion ?? false);
  const [proveedorConsignacionId, setProveedorConsignacionId] = useState(productoExistente?.proveedorConsignacionId ?? "");
  // Default tildado (decisión 2 del dueño): lo común (insumos/platos compartidos) tiene cero fricción.
  const [activoEnTodas, setActivoEnTodas] = useState(true);
  // Fase 4: el modo elegido en el formulario (decide si se muestra el precio editable o el guardado en solo lectura).
  const [modoDeVenta, setModoDeVenta] = useState<ModoDeVenta>(venta?.modo ?? MODO_DE_VENTA.DIRECTO);
  const esBase = venta !== undefined && esBaseConfigurable(modoDeVenta);

  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // D11/M8 (docs/plan-agrupacion-items-carta-2026-09-24.md): si el producto está en un ítem agrupado de la carta y sus hermanos quedaron a
  // otro precio, en vez de volver enseguida a la ficha se ofrece aplicarles el mismo precio (un bloque aparte; el cambio ya está guardado).
  const [sincronizable, setSincronizable] = useState<SincronizablePrecioGrupo | null>(null);

  const editando = Boolean(productoExistente);
  // M.2: en el alta la unidad de stock queda libre aun sin la clave (sin ella no hay producto); en la edición es de quien tiene `producto_campos_sensibles`.
  const unidadDeStockEditable = puedeEditarCamposSensibles || !editando;
  // M.2-A4: un producto de venta dado de alta SIN la clave nace con precio $0 y el servidor lo deja NO disponible en ninguna sucursal (no se puede vender a $0): el tilde se ve apagado y sin poder cambiarse.
  const naceSinPoderVenderse = !editando && tipo === "PV" && !puedeEditarCamposSensibles; const rotulos = altaComoPedernal && !editando; // rótulo VISIBLE arriba de cada campo (dirección del dueño, 2026-11-17)
  const irALaFicha = (id: string | null) => router.push(id ? `/catalogo/productos/${id}?guardado=${editando ? "cambios" : "alta"}` : "/catalogo/productos");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        // M.2: con la clave van los cuatro campos sensibles del formulario. Sin ella, el alta manda lo único que el servidor acepta (precio 0, factor 1, sin unidad de compra; la unidad de stock es libre) y la
        // edición no los manda: el servidor completa lo que no viene con lo guardado (con o sin la clave), así que ni siquiera una pantalla vieja puede devolver al valor viejo lo que otra persona cambió.
        const delFormulario: DatosSensibles = {
          unidadCompraId: texto(form.get("unidadCompraId")) || null,
          unidadStockId,
          // numeroDelCampo: vacío → undefined (nunca 0 por un campo required sin tocar), texto inválido → NaN (el servidor lo rechaza).
          factorConversion: numeroDelCampo(String(form.get("factorConversion") ?? "")) ?? Number.NaN,
          precioVenta: numeroDelCampo(String(form.get("precioVenta") ?? "")) ?? 0,
        };
        const sensiblesDelAlta: DatosSensibles = puedeEditarCamposSensibles && !rotulos ? delFormulario : { unidadCompraId: null, unidadStockId, factorConversion: 1, precioVenta: 0 };
        // Fase 4: siendo (o pasando a ser) base, el precio de venta NO se manda: el servidor conserva el guardado.
        const { precioVenta: _precioDelFormulario, ...delFormularioSinPrecio } = delFormulario;
        void _precioDelFormulario;
        const sensiblesDeLaEdicion: Partial<DatosSensibles> = puedeEditarCamposSensibles ? (esBase ? delFormularioSinPrecio : delFormulario) : {};
        const datos: Omit<DatosProducto, CampoSensibleDelProducto> = {
          codigo: editando ? undefined : texto(form.get("codigo")) || undefined,
          nombre: texto(form.get("nombre")), ...nombreDeCocinaDelFormulario(form, tipo, editando), // nombre de cocina: solo un PV; vaciado en la edición = null (borra)
          tipo,
          categoriaId: categoriaId || null,
          insumoId: tipo === "MP" ? insumoId || null : null,
          // numeroDelCampo: vacío → undefined (sin paso, comportamiento actual), texto inválido → NaN (el servidor lo rechaza).
          pasoVenta: tipo === "PV" ? (numeroDelCampo(String(form.get("pasoVenta") ?? "")) ?? null) : null,
          ...(altaComoPedernal && !editando ? { claseDeUso: clase } : {}), seProduce: !altaComoPedernal ? form.get("seProduce") === "on" : editando ? productoExistente!.seProduce === true : CLASES_DE_ALTA[clase].seProduce, // como Pedernal: sale de la clase; en la edición no se prende ni se apaga
          // Sin la clave el costo de consignación NO se manda (ver `puedeGestionarConsignacion`).
          ...(puedeGestionarConsignacion && {
            esConsignacion,
            proveedorConsignacionId: esConsignacion ? proveedorConsignacionId || null : null,
            precioConsignacion: numeroDelCampo(String(form.get("precioConsignacion") ?? "")) ?? 0,
          }),
          observaciones: !OBSERVACIONES_VISIBLES ? undefined : texto(form.get("observaciones")) || (editando ? null : undefined), // edición parcial: oculto no se manda; vaciado a la vista = null explícito (borra)
          activoEnTodasLasSucursales: editando ? undefined : activoEnTodas,
        };
        startTransition(async () => {
          const resultado = editando
            ? // El precio que mostraba el formulario (control del valor visto): si otra persona lo cambió mientras se editaba, el servidor no pisa su cambio y pide recargar.
              await actualizarProducto(productoExistente!.id, {
                ...datos,
                ...sensiblesDeLaEdicion, ...alicuotasDelFormulario(form, tipo, productoExistente, puedeEditarCamposSensibles).deLaEdicion,
                precioVentaVisto: productoExistente!.precioVenta,
                // Fase 4: el modo solo lo manda quien puede cambiarlo (sin la clave, «no viene» es «queda como estaba»).
                ...(venta && puedeEditarCamposSensibles ? { modoDeVenta } : {}),
              })
            : await darDeAltaProducto({ ...datos, ...sensiblesDelAlta, ...alicuotasDelFormulario(form, tipo, undefined, puedeEditarCamposSensibles).delAlta });
          setMensaje(resultado.mensaje);
          setSincronizable(null);
          // Al guardar se vuelve a la ficha del producto, que muestra el aviso de que se guardó (antes se volvía a la lista y el cartel se perdía).
          if (resultado.ok) {
            if ("sincronizable" in resultado && resultado.sincronizable) {
              setSincronizable(resultado.sincronizable);
              return;
            }
            const idFicha = editando ? productoExistente!.id : "id" in resultado ? resultado.id : null;
            irALaFicha(idFicha);
          }
        });
      }}
      className="flex max-w-xl flex-col gap-3"
    >
      {sinEncabezado || rotulos ? null : <h2 className="font-medium">{editando ? `Editar "${productoExistente!.nombre}"` : "Nuevo producto"}</h2>}

      {altaComoPedernal ? (
        <CampoQueEs editando={editando} clase={clase} alCambiar={(c) => { setClase(c); setTipo(CLASES_DE_ALTA[c].tipo); }} />
      ) : editando ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm">{tipo === "MP" ? "Materia prima (MP)" : "Producto de venta (PV)"}</p>
          <AyudaDeFicha>
            El tipo no se puede cambiar una vez creado el producto — recetas, ventas y stock ya asumen cuál es. Si te equivocaste de tipo, dá de baja este producto y creá uno nuevo con el tipo correcto.
          </AyudaDeFicha>
        </div>
      ) : (
        <OpcionesExcluyentes
          presentacion="fila"
          leyenda={<span className="sr-only">Tipo de producto</span>}
          nombre="tipoRadio"
          valorInicial={tipo}
          alCambiar={(valor) => setTipo(valor === "PV" ? "PV" : "MP")}
          opciones={[
            { valor: "MP", etiqueta: "Materia prima (MP)" },
            { valor: "PV", etiqueta: "Producto de venta (PV)" },
          ]}
        />
      )}

      {!editando && !rotulos && <Campo name="codigo" {...nombreDelCampo(false, "Código (opcional, se autogenera)")} />}
      <Campo name="nombre" {...nombreDelCampo(rotulos, "Nombre")} defaultValue={productoExistente?.nombre} required /><CampoNombreDeCocina rotuloVisible={rotulos} tipo={tipo} valorInicial={productoExistente?.nombreDeCocina} />
      {rotulos && <Campo name="codigo" {...nombreDelCampo(true, "Código (opcional, se autogenera)")} />}{/* orden de la maqueta de Pedernal: Nombre, Nombre de cocina, Código */}

      {!rotulos && (
        <CampoCategoria categorias={categorias} categoriaId={categoriaId} alElegir={setCategoriaId} alCrear={(item) => { setCategorias((prev) => [...prev, item]); setCategoriaId(item.id); }} puedeCrear={puedeCrear.categoria} />
      )}

      {tipo === "MP" && !rotulos && (
        <CampoInsumo
          insumos={insumos}
          insumoId={insumoId}
          unidadStockId={unidadStockId}
          alElegir={setInsumoId}
          alCrear={(item) => { setInsumos((prev) => [...prev, item]); setInsumoId(item.id); }}
          alResolver={(item) => { setInsumos((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item])); setInsumoId(item.id); }}
          puedeCrear={puedeCrear.insumo}
        />
      )}

      <CamposDeUnidad
        tipo={tipo}
        unidades={unidades}
        unidadStockId={unidadStockId}
        alElegirUnidadStock={setUnidadStockId}
        unidadDeStockEditable={unidadDeStockEditable}
        puedeEditarCamposSensibles={puedeEditarCamposSensibles}
        soloUnidad={rotulos}
        unidadCompraId={productoExistente?.unidadCompraId}
        factorConversion={productoExistente?.factorConversion}
      />

      {tipo === "PV" && venta && (
        <div className="flex flex-col gap-1" data-modo-de-venta={modoDeVenta}>
          {puedeEditarCamposSensibles ? (
            <OpcionesExcluyentes
              leyenda="¿Cómo se vende?"
              nombre="modoDeVenta"
              valorInicial={venta.modo}
              alCambiar={(valor) => setModoDeVenta(modoDeVentaDe(valor))}
              opciones={[
                { valor: MODO_DE_VENTA.DIRECTO, etiqueta: "Directo: tiene su precio" },
                {
                  valor: MODO_DE_VENTA.BASE_CONFIGURABLE,
                  etiqueta: "Por opción: el precio final está en cada opción",
                  ayuda: venta.grupoConPrecioFinal ? `El precio final de cada opción está en «${venta.grupoConPrecioFinal}».` : undefined,
                  deshabilitada: !esBaseConfigurable(venta.modo) && venta.grupoConPrecioFinal === null,
                  motivo: "Para venderlo por opción, primero asignale un grupo de tamaños con el precio final de cada opción (en «Opciones de venta» del producto).",
                },
              ]}
            />
          ) : (
            <ValorSoloLectura campo="modoDeVenta" etiqueta="¿Cómo se vende?">
              {esBaseConfigurable(venta.modo) ? "Por opción: el precio final está en cada opción" : "Directo: tiene su precio"}
            </ValorSoloLectura>
          )}
        </div>
      )}

      {tipo === "PV" && esBase && (
        <div className="flex flex-col gap-1">
          <ValorSoloLectura campo="precioVenta" etiqueta="Precio guardado (no se cobra)">
            {pesos(productoExistente?.precioVenta ?? 0)}
          </ValorSoloLectura>
          <AyudaCampo>
            {venta?.grupoConPrecioFinal ? `El precio final de cada opción está en «${venta.grupoConPrecioFinal}». ` : "El precio final de cada opción está en su grupo de tamaños. "}
            <EnlaceInterno href={`/catalogo/productos/${productoExistente!.id}/opciones`} className="underline">
              Ver las opciones de venta del producto
            </EnlaceInterno>
          </AyudaCampo>
        </div>
      )}

      {tipo === "PV" && !esBase && <CampoPrecioDeVenta editando={editando} altaComoPedernal={altaComoPedernal} puedeEditarCamposSensibles={puedeEditarCamposSensibles} precioGuardado={productoExistente?.precioVenta ?? 0} />}
      {(!rotulos || (tipo === "PV" && puedeEditarCamposSensibles)) && <CampoAlicuotaIva key={tipo} tipo={tipo} existente={productoExistente} puedeEditar={puedeEditarCamposSensibles} sinAyudas={rotulos} />}
      {!puedeEditarCamposSensibles && !rotulos && (
        <AvisoCamposSensibles>
          {editando ? "Se muestran los valores guardados; el resto de los datos del producto se puede editar." : "El producto se crea con precio $0, factor 1 y sin unidad de compra; después lo completa quien tenga ese permiso."}
        </AvisoCamposSensibles>
      )}

      {tipo === "PV" && !rotulos && <CampoPasoDeVenta pasoVenta={productoExistente?.pasoVenta} />}

      {PRESENTACIONES_VISIBLES && editando && tipo === "MP" && (
        <GestionPresentaciones
          productoId={productoExistente!.id}
          unidades={unidades.filter((u) => !u.inactiva)}
          presentacionesIniciales={presentacionesIniciales ?? []}
          unidadStockDecimales={unidades.find((u) => u.id === unidadStockId)?.decimales}
          puedeEditarCamposSensibles={puedeEditarCamposSensibles}
        />
      )}

      {!altaComoPedernal && tipo === "MP" && (
        <Casilla name="seProduce" defaultChecked={productoExistente?.seProduce} etiqueta="Se produce (tiene receta propia, se fabrica por lote)" />
      )}

      {!editando && !altaComoPedernal && <CasillaActivoEnTodas activoEnTodas={activoEnTodas} alCambiar={setActivoEnTodas} naceSinPoderVenderse={naceSinPoderVenderse} cantidadSucursales={cantidadSucursales} nombreSucursalActual={nombreSucursalActual} />}

      {!rotulos && (
        <BloqueConsignacion
          editando={editando}
          puedeGestionar={puedeGestionarConsignacion}
          esConsignacion={esConsignacion}
          alCambiarEsConsignacion={setEsConsignacion}
          proveedores={proveedores}
          proveedorId={proveedorConsignacionId}
          alElegirProveedor={setProveedorConsignacionId}
          alCrearProveedor={(item) => { setProveedores((prev) => [...prev, item]); setProveedorConsignacionId(item.id); }}
          puedeCrearProveedor={puedeCrear.proveedor}
          precioConsignacion={productoExistente?.precioConsignacion}
        />
      )}

      {OBSERVACIONES_VISIBLES && <AreaDeTexto etiqueta="Observaciones" etiquetaOculta name="observaciones" placeholder="Observaciones" defaultValue={productoExistente?.observaciones ?? ""} />}

      {mensaje && (
        <Aviso variante={mensaje.startsWith("Producto") ? "exito" : "error"} forma="en-linea">
          {mensaje}
        </Aviso>
      )}

      {sincronizable && productoExistente && (
        <SincronizarPrecioGrupo sincronizable={sincronizable} aplicar={(hermanos, precio) =>
            sincronizarPrecioGrupoCarta(
              hermanos.map((h) => h.productoId),
              precio,
              Object.fromEntries(hermanos.map((h) => [h.productoId, h.precioActual]))
            )
          } alTerminar={() => irALaFicha(productoExistente.id)} />
      )}

      {soloLectura ? null : <Boton type="submit" disabled={pending}>{pending ? "Guardando..." : editando ? "Guardar cambios" : "Crear producto"}</Boton>}
    </form>
  );
}

function texto(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
