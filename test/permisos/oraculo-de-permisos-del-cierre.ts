import type { NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * ORÁCULO de los permisos del cierre del día de la caja (etapa A), escrito APARTE del código (regla «Combinaciones» del dueño, AGENTS.md; tabla de permisos confirmada por el dueño el 2026-11-17, «ok pedernal», en
 * `docs/diseno-caja-cierre-del-dia-acciones-y-permisos-2026-11-17.md` §4). Es una tabla legible: para cada clave, su contexto, su piso, si es solo de ver, su semilla y, para cada ACTOR, si la puerta (`accesoDeSucursal` +
 * `decidirEnSucursal`) la deja pasar. NO se calcula con las funciones del código: se escribe a mano.
 *
 * Dimensiones que cambian quién puede (y por qué):
 *  - CLAVE (siete): fija el piso. Las siete de piso operario (PISOS-65, 2026-11-17: ya no hay claves de piso administrador; `caja_registrar_ajuste` nace de piso operario, semilla solo `admin`).
 *  - ROL: «admin» (administrador de sistema: alcanza el piso administrador), «operador» y un rol propio (los dos, nivel operario).
 *  - FILA de la matriz (`PermisoRol`): con Ver y Editar prendidos, o sin fila (todo nace cerrado).
 *  - MEMBRESÍA en la sucursal: sin ella, ningún actor pasa.
 * NO afectan (declarado, con motivo): la capacidad de la sucursal y el módulo de la empresa (son dimensiones de cualquier acción de sucursal, ya cubiertas por `decision-de-acceso.propiedades.test.ts` y `capacidad-de-sucursal-*`;
 * acá se dejan habilitadas), y la clave del rol propio (cualquier rol que no sea «admin» es operario). El gerente de la empresa no tiene un camino propio en sucursal: entra con su membresía de rol «admin», igual que el administrador.
 */
export interface ClaveDelCierre {
  piso: NivelDeAccion;
  soloVer: boolean;
}

export const CLAVES_DEL_CIERRE: Readonly<Record<string, ClaveDelCierre>> = {
  caja_jornada_ver: { piso: "operario", soloVer: true },
  caja_jornada_iniciar_auditoria: { piso: "operario", soloVer: false },
  caja_jornada_cancelar_auditoria: { piso: "operario", soloVer: false },
  caja_jornada_cerrar: { piso: "operario", soloVer: false },
  caja_corregir_medio_de_cobro: { piso: "operario", soloVer: false },
  caja_declarar_total: { piso: "operario", soloVer: false },
  caja_registrar_ajuste: { piso: "operario", soloVer: false },
};

/** Las seis claves de la caja de PR-B (`caja_ver`…`cobrar_cuenta`): tienen su propia cobertura (`test/caja/*`, `denegacion-por-defecto`); el guardián las reconoce como declaradas en otro lado. */
export const CLAVES_DE_PR_B = ["caja_ver", "caja_abrir_sesion", "caja_cerrar_sesion", "caja_mover_efectivo", "caja_anular_movimiento_ajeno", "cobrar_cuenta"] as const;

export type ActorDelCierre =
  | "gerente (rol admin, fila semilla)"
  | "administrador (rol admin, fila semilla)"
  | "operador con la fila prendida a mano"
  | "operador sin fila"
  | "rol propio con la fila prendida"
  | "rol propio sin fila"
  | "sin membresía";

/** Lo que la puerta responde (ver y editar) a cada actor, por piso de la clave. Escrito a mano. */
export const PUERTA_ESPERADA: Readonly<Record<"operario", Readonly<Record<ActorDelCierre, boolean>>>> = {
  operario: {
    "gerente (rol admin, fila semilla)": true,
    "administrador (rol admin, fila semilla)": true,
    "operador con la fila prendida a mano": true,
    "operador sin fila": false,
    "rol propio con la fila prendida": true,
    "rol propio sin fila": false,
    "sin membresía": false,
  },
};
