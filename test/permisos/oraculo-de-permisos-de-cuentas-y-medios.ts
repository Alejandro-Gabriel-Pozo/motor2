import type { NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * ORÁCULO de los permisos de administración de la caja (etapa B: medios de pago y cuentas de cobro), escrito APARTE del código (regla «Combinaciones» del dueño, AGENTS.md; decisiones Q-B1 y Q-B3 CONFIRMADAS por delegación del dueño en Pedernal el 2026-11-17, en
 * `docs/diseno-caja-cuentas-de-cobro-y-medios-acciones-y-permisos-2026-11-17.md` §4 y §10). Es una tabla legible: para cada clave, su contexto, su piso, si es solo de ver, su semilla y, para cada ACTOR, si la puerta (`accesoDeSucursal` + `decidirEnSucursal`) la deja pasar.
 * NO se calcula con las funciones del código: se escribe a mano.
 *
 * Dimensiones que cambian quién puede (y por qué):
 *  - CLAVE (ocho): fija el piso. Las ocho de piso operario (PISOS-65, 2026-11-17: no hay claves nuevas de piso administrador; la empresa decide fila por fila), semilla solo `admin`.
 *  - ROL: «admin» (administrador de sistema: alcanza cualquier piso), «operador» y un rol propio (los dos, nivel operario).
 *  - FILA de la matriz (`PermisoRol`): con Ver y Editar prendidos, o sin fila (todo nace cerrado).
 *  - MEMBRESÍA en la sucursal: sin ella, ningún actor pasa.
 * NO afectan (declarado, con motivo): la capacidad de la sucursal y el módulo de la empresa (son dimensiones de cualquier acción de sucursal, ya cubiertas por `decision-de-acceso.propiedades.test.ts` y `capacidad-de-sucursal-*`; acá se dejan habilitadas), y la clave del rol propio (cualquier rol
 * que no sea «admin» es operario). El gerente de la empresa no tiene un camino propio en sucursal: entra con su membresía de rol «admin», igual que el administrador. Las TRES lecturas de administración no llevan clave propia: van con `caja_ver` (Q-B2), declarada en el oráculo de PR-B.
 */
export interface ClaveDeCuentasYMedios {
  piso: NivelDeAccion;
  soloVer: boolean;
  /** Qué acción real de `src/server/actions/caja/cuentas-y-medios.ts` la exige. */
  accion: string;
}

export const CLAVES_DE_CUENTAS_Y_MEDIOS: Readonly<Record<string, ClaveDeCuentasYMedios>> = {
  caja_medio_de_pago_crear: { piso: "operario", soloVer: false, accion: "crearMedioDePagoDeCaja" },
  caja_medio_de_pago_editar: { piso: "operario", soloVer: false, accion: "editarMedioDePagoDeCaja" },
  caja_medio_de_pago_reactivar: { piso: "operario", soloVer: false, accion: "reactivarMedioDePagoDeCaja" },
  caja_medio_de_pago_desactivar: { piso: "operario", soloVer: false, accion: "desactivarMedioDePagoDeCaja" },
  caja_cuenta_de_cobro_crear: { piso: "operario", soloVer: false, accion: "crearCuentaDeCobroDeCaja" },
  caja_cuenta_de_cobro_editar: { piso: "operario", soloVer: false, accion: "editarCuentaDeCobroDeCaja" },
  caja_cuenta_de_cobro_reactivar: { piso: "operario", soloVer: false, accion: "reactivarCuentaDeCobroDeCaja" },
  caja_cuenta_de_cobro_desactivar: { piso: "operario", soloVer: false, accion: "desactivarCuentaDeCobroDeCaja" },
};

export type ActorDeCuentasYMedios =
  | "gerente (rol admin, fila semilla)"
  | "administrador (rol admin, fila semilla)"
  | "operador con la fila prendida a mano"
  | "operador sin fila"
  | "rol propio con la fila prendida"
  | "rol propio sin fila"
  | "sin membresía";

/** Lo que la puerta responde (ver y editar) a cada actor, por piso de la clave. Escrito a mano. */
export const PUERTA_ESPERADA_DE_CUENTAS_Y_MEDIOS: Readonly<Record<"operario", Readonly<Record<ActorDeCuentasYMedios, boolean>>>> = {
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
