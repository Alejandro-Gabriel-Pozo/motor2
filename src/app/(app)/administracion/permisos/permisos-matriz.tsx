"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { guardarPermisos } from "@/server/actions/permisos/permisos";
import { nivelMinimoDeAccion, claveEnCatalogo } from "@/core/permisos/acciones";
import { etiquetaDelPiso } from "@/core/permisos/jerarquia";
import {
  esCeldaFija,
  esCeldaFueraDeNivel,
  MENSAJE_GUARDADO_EN_CONFLICTO,
  mismoEstado,
  normalizarPermiso,
  PREFIJO_CONFLICTO_DE_EDICION,
  SIN_PERMISO,
  textoEstado,
  type CambioPermiso,
  type EstadoPermiso,
} from "@/core/permisos/matriz";
import { Aviso } from "@/ui/primitivas/aviso";
import { Boton } from "@/ui/primitivas/boton";

interface Accion {
  clave: string;
  descripcion: string;
}
interface Rol {
  id: string;
  nombre: string;
  clave: string | null;
}
interface Permiso {
  rolId: string;
  accionClave: string;
  puedeVer: boolean;
  puedeEditar: boolean;
}

const clave = (rolId: string, accionClave: string) => `${rolId}:${accionClave}`;

/**
 * Matriz de permisos (acción × rol). Se abre en SOLO LECTURA; «Editar permisos» entra en modo edición: los cambios quedan marcados y NO se
 * aplican hasta «Revisar y guardar» → «Confirmar y guardar», que los guarda todos juntos o ninguno (decisión 6 de
 * docs/grounding-lista-ver-editar-2026-09-18.md). Antes cada clic aplicaba al instante: cortaba accesos sin resumen ni vuelta atrás, y
 * dos administradores editando a la vez se pisaban sin enterarse. Ahora el servidor compara contra lo que se VIO al abrir la edición
 * y, si otra persona cambió algo mientras tanto, no guarda nada y lo dice.
 */
export function PermisosMatriz({ acciones, roles, permisosIniciales }: { acciones: Accion[]; roles: Rol[]; permisosIniciales: Permiso[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  // `conflicto`: otra persona cambió lo que se editaba → hay que RECARGAR. `reintentable`: el guardado chocó con otro en curso y no se guardó nada,
  // los cambios siguen marcados → hay que REINTENTAR. Son estados distintos con la acción correctiva opuesta, por eso no se mezclan.
  const [mensaje, setMensaje] = useState<{ texto: string; ok: boolean; conflicto?: boolean; reintentable?: boolean } | null>(null);
  // Lo que se vio al abrir la edición (contra esto compara el servidor) y lo que se está armando.
  const [base, setBase] = useState<Map<string, EstadoPermiso>>(new Map());
  const [borrador, setBorrador] = useState<Map<string, EstadoPermiso>>(new Map());

  const guardados = useMemo(() => new Map(permisosIniciales.map((p) => [clave(p.rolId, p.accionClave), { puedeVer: p.puedeVer, puedeEditar: p.puedeEditar }])), [permisosIniciales]);
  const estadoGuardado = (rolId: string, accionClave: string) => guardados.get(clave(rolId, accionClave)) ?? SIN_PERMISO;
  const estadoActual = (rolId: string, accionClave: string) => (editando ? (borrador.get(clave(rolId, accionClave)) ?? SIN_PERMISO) : estadoGuardado(rolId, accionClave));

  const cambios: (CambioPermiso & { rolNombre: string; descripcion: string })[] = useMemo(() => {
    if (!editando) return [];
    const lista: (CambioPermiso & { rolNombre: string; descripcion: string })[] = [];
    for (const r of roles) {
      for (const a of acciones) {
        const k = clave(r.id, a.clave);
        const anterior = base.get(k) ?? SIN_PERMISO;
        const nuevo = borrador.get(k) ?? SIN_PERMISO;
        if (!mismoEstado(anterior, nuevo)) lista.push({ rolId: r.id, accionClave: a.clave, anterior, nuevo, rolNombre: r.nombre, descripcion: a.descripcion });
      }
    }
    return lista;
  }, [editando, roles, acciones, base, borrador]);

  // Con cambios sin guardar, el navegador avisa antes de cerrar o recargar la pestaña.
  useEffect(() => {
    if (!editando || cambios.length === 0) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [editando, cambios.length]);

  function empezarEdicion() {
    const foto = new Map(guardados);
    setBase(foto);
    setBorrador(new Map(foto));
    setEditando(true);
    setRevisando(false);
    setMensaje(null);
  }

  function salirDeLaEdicion() {
    setEditando(false);
    setRevisando(false);
  }

  function tocar(rol: Rol, accionClave: string, cual: "ver" | "editar") {
    const actual = borrador.get(clave(rol.id, accionClave)) ?? SIN_PERMISO;
    const deseado: EstadoPermiso =
      cual === "ver"
        ? { puedeVer: !actual.puedeVer, puedeEditar: actual.puedeVer ? false : actual.puedeEditar } // sacar «Ver» saca también «Editar»
        : { puedeVer: actual.puedeVer || !actual.puedeEditar, puedeEditar: !actual.puedeEditar }; // poner «Editar» pone también «Ver»
    setBorrador((previo) => new Map(previo).set(clave(rol.id, accionClave), normalizarPermiso(rol, accionClave, deseado)));
    setMensaje(null);
  }

  function guardar() {
    startTransition(async () => {
      const resultado = await guardarPermisos(cambios.map(({ rolId, accionClave, anterior, nuevo }) => ({ rolId, accionClave, anterior, nuevo })));
      if (resultado.ok) {
        setMensaje({ texto: resultado.mensaje, ok: true });
        salirDeLaEdicion();
        router.refresh();
      } else {
        setMensaje({
          texto: resultado.mensaje,
          ok: false,
          conflicto: resultado.mensaje.startsWith(PREFIJO_CONFLICTO_DE_EDICION),
          reintentable: resultado.mensaje === MENSAJE_GUARDADO_EN_CONFLICTO,
        });
        setRevisando(false);
      }
    });
  }

  function recargar() {
    salirDeLaEdicion();
    setMensaje(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!editando ? (
        <div className="flex items-center gap-3">
          <Boton onClick={empezarEdicion}>Editar permisos</Boton>
          <span className="text-xs text-tinta-tenue">Solo lectura. Los cambios se hacen en el modo edición y se guardan todos juntos.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded border border-aviso bg-aviso-tinte px-3 py-2 text-sm text-aviso-tinta">
          <strong>Modo edición</strong>
          <span data-cambios-pendientes>{cambios.length === 0 ? "Sin cambios todavía" : `${cambios.length} cambio(s) sin guardar`} — no se aplican hasta que los guardes.</span>
          <div className="ml-auto flex gap-2">
            <Boton tamano="compacto" disabled={cambios.length === 0 || pending} onClick={() => setRevisando(true)}>
              Revisar y guardar
            </Boton>
            <Boton variante="secundario" tamano="compacto" disabled={pending} onClick={salirDeLaEdicion}>
              {cambios.length === 0 ? "Salir del modo edición" : "Descartar cambios"}
            </Boton>
          </div>
        </div>
      )}

      {revisando && (
        <div role="dialog" aria-label="Resumen de cambios" className="space-y-3 rounded border p-4">
          <h2 className="font-medium">Vas a guardar {cambios.length} cambio(s)</h2>
          <ul className="space-y-1 text-sm">
            {cambios.map((c) => (
              <li key={clave(c.rolId, c.accionClave)}>
                <strong>{c.rolNombre}</strong> · {c.accionClave}: {textoEstado(c.anterior)} → <strong>{textoEstado(c.nuevo)}</strong>
              </li>
            ))}
          </ul>
          <p className="text-xs text-tinta-tenue">Se guardan todos juntos o ninguno. Si otra persona cambió alguno de estos permisos mientras editabas, no se guarda nada.</p>
          <div className="flex gap-2">
            <Boton tamano="compacto" disabled={pending} onClick={guardar}>
              {pending ? "Guardando…" : "Confirmar y guardar"}
            </Boton>
            <Boton variante="secundario" tamano="compacto" disabled={pending} onClick={() => setRevisando(false)}>
              Seguir editando
            </Boton>
          </div>
        </div>
      )}

      {mensaje && (
        // Un rechazo o un conflicto sigue anunciándose con `role="status"`, como antes (el spec de guardar lo espera): `Aviso` de error es `role="alert"`, así que el rechazo va como advertencia.
        <Aviso variante={mensaje.ok ? "exito" : "advertencia"} forma="en-linea">
          <p>{mensaje.texto}</p>
          {mensaje.conflicto && (
            <Boton variante="enlace" tamano="en-fila" className="mt-1" onClick={recargar}>
              Recargar la matriz
            </Boton>
          )}
          {mensaje.reintentable && (
            <Boton variante="enlace" tamano="en-fila" className="mt-1" disabled={pending} onClick={guardar}>
              Reintentar
            </Boton>
          )}
        </Aviso>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2 pr-4">Acción</th>
              {roles.map((r) => (
                <th key={r.id} colSpan={2} className="pr-4 text-center">
                  {r.nombre}
                </th>
              ))}
            </tr>
            <tr className="border-b text-left text-xs text-tinta-tenue">
              <td />
              {roles.map((r) => (
                <Fragment key={r.id}>
                  <th>Ver</th>
                  <th>Editar</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {acciones.map((a) => (
              <tr key={a.clave} className="border-b">
                <td className="py-2 pr-4">
                  <div className="font-medium">{a.clave}</div>
                  <div className="text-xs text-tinta-tenue">{a.descripcion}</div>
                  {claveEnCatalogo(a.clave) && nivelMinimoDeAccion(a.clave) !== "operario" && (
                    <div className="text-xs text-tinta-tenue">Piso: {etiquetaDelPiso(nivelMinimoDeAccion(a.clave))}</div>
                  )}
                </td>
                {roles.map((r) => {
                  const actual = estadoActual(r.id, a.clave);
                  const anterior = base.get(clave(r.id, a.clave)) ?? SIN_PERMISO;
                  const cambiada = editando && !mismoEstado(anterior, actual);
                  const fija = esCeldaFija(r, a.clave);
                  const fueraDeNivel = esCeldaFueraDeNivel(r, a.clave);
                  const marca = (encendido: boolean) => (encendido ? "✅" : "⬜");
                  const celda = (cual: "ver" | "editar", encendido: boolean, difiere: boolean) => {
                    const etiqueta = `${r.nombre}: ${a.clave}, ${cual === "ver" ? "ver" : "editar"}`;
                    const fondo = difiere ? "rounded bg-aviso/30 px-1" : "px-1";
                    if (fueraDeNivel) return <span title="Esta acción es de un nivel más alto que el de este rol: no se le puede dar" aria-label={`${etiqueta}: no aplica`}>🚫</span>;
                    if (!editando) return <span aria-label={`${etiqueta}: ${encendido ? "sí" : "no"}`}>{marca(encendido)}</span>;
                    if (fija) return <span title="El rol administrador siempre conserva este permiso" aria-label={`${etiqueta}: fijo`}>🔒</span>;
                    return (
                      <button
                        type="button"
                        aria-pressed={encendido}
                        aria-label={etiqueta}
                        data-celda={`${r.id}:${a.clave}:${cual}`}
                        disabled={pending}
                        onClick={() => tocar(r, a.clave, cual)}
                        className={`${fondo} disabled:opacity-50`}
                      >
                        {marca(encendido)}
                      </button>
                    );
                  };
                  return (
                    <Fragment key={r.id}>
                      <td>{celda("ver", actual.puedeVer, cambiada && actual.puedeVer !== anterior.puedeVer)}</td>
                      <td>{celda("editar", actual.puedeEditar, cambiada && actual.puedeEditar !== anterior.puedeEditar)}</td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tinta-tenue">
        Tocar «Editar» también prende «Ver», y sacar «Ver» saca «Editar» (Ver ⊇ Editar). «gestion_permisos», «gestion_roles», «gestion_usuarios», «activar_usuario_sucursal», «notas_usuario_sucursal» y «apagar_cuenta_empresa» siempre conservan Editar para el rol administrador (🔒). Las acciones con «Piso» no se le pueden dar a un rol de un nivel más bajo (🚫): las de piso «administrador» y «administrador de sistema» (el gobierno de la empresa: usuarios, roles, permisos, sucursales y auditoría) no se le dan a un rol de nivel operario, y las de piso «gerente» las tiene solo el gerente.
        {editando && " Lo marcado en amarillo es lo que cambiaste."}
      </p>
    </div>
  );
}
