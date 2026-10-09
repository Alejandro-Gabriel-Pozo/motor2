/**
 * El INVENTARIO de las puertas que NO abren con `conPermiso*` / `requerirVer*` (S-17 a S-20, T8 del endurecimiento de seguridad; guard GT-10): cada una declara qué pasa con un
 * ANÓNIMO y con un usuario con sesión pero SIN EMPRESA («sinEmpresa»). El método del dueño es denegar por defecto: en este sistema no existen usuarios sin empresa, así que toda puerta
 * que deje pasar a uno es una brecha, salvo que figure acá como `PERMITIDO` con su motivo y su limitador (qué la frena si alguien la golpea en bucle).
 *
 * Lo consumen dos tests: `test/arquitectura/puertas-sin-permiso-inventariadas.test.ts` (estático: lo que el código realmente expone es EXACTAMENTE esta lista, y cada fila es coherente con su
 * guarda) y `test/seguridad/puertas-sin-permiso-anonimo-y-sin-empresa.test.ts` (con base: cada puerta que declara `NIEGA` se invoca así y no hace nada). Una puerta nueva sin fila, o una
 * fila que ya no corresponde a ninguna, pone el primero en rojo.
 *
 * Claves: `accion|<archivo de src/server/actions>|<función>` (Server Action sin envoltorio de permiso), `ruta|<ruta de src/app>` (página o route handler público; `api/cron/*` agrupa los
 * crons, que rechazan el pedido sin el secreto), `consola|<archivo de plataforma/src/app>|<función>` (Server Action de la consola previa a la sesión del administrador) y
 * `sesion|<archivo>|<función>` (el gate de `signIn`, donde se decide quién abre sesión).
 */
export type Postura = "NIEGA" | "PERMITIDO";

export interface PuertaSinPermiso {
  anonimo: Postura;
  sinEmpresa: Postura;
  /** Por qué la puerta es como es: qué autoridad la reemplaza al `conPermiso` (un token, un secreto, ninguna porque no lee nada). */
  motivo: string;
  /** Obligatorio si alguna postura es `PERMITIDO`: qué frena a quien golpea la puerta en bucle (o por qué no hay nada que frenar). */
  limitador?: string;
}

const CUPO_DEL_ORIGEN = "cupo por origen de `abrirInvitacion` (S-27, `server/actions/limitador-anonimo.ts`, best effort por instancia; el cierre real es el firewall de Vercel, E.6)";

export const PUERTAS_SIN_PERMISO: Readonly<Record<string, PuertaSinPermiso>> = {
  "accion|auth/invitacion.ts|abrirInvitacion": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "previa al login: la autoridad es conocer el token de la invitación (256 bits), que se valida contra la base antes de guardar la cookie httpOnly; solo guarda la cookie de quien ya tiene el enlace",
    limitador: CUPO_DEL_ORIGEN,
  },
  "accion|auth/invitacion.ts|aceptarMiInvitacion": {
    anonimo: "NIEGA",
    sinEmpresa: "PERMITIDO",
    motivo: "quien acepta la invitación del primer gerente todavía no tiene empresa a propósito: la autoridad es el token de la cookie httpOnly más el email de su cuenta de Google, que valida el caso de uso; lo pide la sesión primero",
    limitador: "cupo de pruebas de CUIT por usuario e invitación (S-18, decisión B19; `consultaDeCuitSinCupo`): la prueba de un CUIT que llega a mirar la tabla de empresas no se puede repetir en bucle",
  },
  "accion|auth/invitacion.ts|aceptarMiInvitacionDeUsuario": {
    anonimo: "NIEGA",
    sinEmpresa: "PERMITIDO",
    motivo: "quien acepta una invitación de usuario todavía no es miembro a propósito: la autoridad es el token de la cookie httpOnly y el email invitado; el caso de uso revalida el permiso y el techo de quien otorgó. No recibe nada del cliente que pueda sondear",
    limitador: "no hay entrada del cliente que probar (token y email salen de la cookie y de la sesión) y el token es de un solo uso; el alcance es el de la invitación",
  },
  "accion|auth/empresa-activa.ts|cambiarEmpresaActiva": {
    anonimo: "NIEGA",
    sinEmpresa: "NIEGA",
    motivo: "preferencia personal: solo entre las pertenencias activas del usuario, que se verifican contra la base; sin pertenencia no escribe la cookie ni redirige",
  },
  "accion|auth/sucursal-activa.ts|cambiarSucursalActiva": {
    anonimo: "NIEGA",
    sinEmpresa: "NIEGA",
    motivo: "preferencia personal: pide el contexto de empresa (sin empresa es nulo) y solo acepta membresías activas del usuario; sin contexto no escribe la cookie",
  },
  "accion|catalogo/unidades.ts|detectarInsumosConUnidadMezclada": {
    anonimo: "NIEGA",
    sinEmpresa: "NIEGA",
    motivo: "lectura con el gate inline de `insumos_mezclados` (necesita contexto de empresa y el permiso); devuelve datos y no un ResultadoAccion, por eso no usa el envoltorio",
  },

  "ruta|page.tsx": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "raíz `/`: solo redirige (al login sin sesión, a la pantalla de inicio con sesión); no muestra ni lee nada",
    limitador: "no consulta la base ni muestra datos: no hay nada que gastar",
  },
  "ruta|login/page.tsx": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "el formulario de ingreso tiene que poder abrirse sin sesión; el que decide quién entra es el gate de `signIn` (fila `sesion|…`). Sus Server Actions en línea son solo `signIn(\"google\")` y `signOut` de Auth.js (lo fija el test estático)",
    limitador: "es el formulario: no consulta datos de ninguna empresa",
  },
  "ruta|invitacion/page.tsx": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "pantalla de aceptación de una invitación (E5/E8): quien llega aún no tiene sesión ni empresa; el acceso lo dan el token del enlace (cookie httpOnly) y la cuenta de Google del email invitado, y el GET no gasta nada. Sus Server Actions en línea son solo `signIn(\"google\")` y `signOut` de Auth.js (lo fija el test estático)",
    limitador: "el GET solo lee la invitación por el hash del token de la cookie; abrir un enlace nuevo pasa por `abrirInvitacion` (cupo por origen)",
  },
  "ruta|api/auth/[...nextauth]/route.ts": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "Auth.js (login, callback, logout, sesión): su propio protocolo decide qué responde; abrir sesión pasa por el gate de `signIn` (fila `sesion|…`), que exige membresía activa o invitación pendiente (D5)",
    limitador: "el protocolo OAuth de Google (no hay credencial propia que adivinar) y el gate de `signIn`, que rechaza antes de crear `User` o `Session`",
  },
  "ruta|(carta-publica)/carta-publica/[empresa]/page.tsx": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "carta pública de una empresa: lectura aislada de lo que la empresa publica a propósito (lista cerrada de campos), sin sesión",
    limitador: "caché ISR de la carta (revalidate) más el firewall de Vercel (E.6); la lista cerrada de publicación es el guard GT-13 (tanda T9)",
  },
  "ruta|(carta-publica)/carta-publica/[empresa]/[sucursal]/page.tsx": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "carta pública de una sucursal: lectura aislada de lo que se publica a propósito, sin sesión",
    limitador: "caché ISR de la carta (revalidate) más el firewall de Vercel (E.6); la lista cerrada de publicación es el guard GT-13 (tanda T9)",
  },
  "ruta|api/cron/*": {
    anonimo: "NIEGA",
    sinEmpresa: "NIEGA",
    motivo: "los crons de Vercel rechazan el pedido sin el secreto (`CRON_SECRET`) antes de usar la base, en cada método HTTP (`rutas-publicas-inventariadas.test.ts`): una sesión de usuario, con empresa o sin ella, no los abre",
  },

  "consola|login/acciones.ts|pedirCodigo": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "previa a la sesión del administrador de plataforma: pide el código de ingreso por email; responde igual sea o no de un administrador y el tiempo no lo delata (S-08, B11). La consola no tiene empresas: «sin empresa» no la distingue",
    limitador: "cupo por origen y por administrador de la consola (S-08, B8 y B9), contado bajo cerrojo",
  },
  "consola|login/acciones.ts|enviarCodigoDelMail": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "previa a la sesión: verifica el código del mail, que solo sirve en el navegador que lo pidió (cookie `__Host-`, S-08); hace las mismas consultas haya o no administrador",
    limitador: "5 intentos por código y cupo por administrador (S-08)",
  },
  "consola|login/acciones.ts|enviarSegundoFactor": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "previa a la sesión: segundo factor (TOTP) tras el código del mail; sin los dos pasos no hay sesión de administrador",
    limitador: "intentos limitados por código y por administrador (S-08)",
  },
  "consola|login/acciones.ts|salir": {
    anonimo: "PERMITIDO",
    sinEmpresa: "PERMITIDO",
    motivo: "cierra la sesión de la consola: sin sesión no hace nada",
    limitador: "no consulta datos: borra su propia cookie",
  },

  "sesion|lib/auth.ts|signIn": {
    anonimo: "NIEGA",
    sinEmpresa: "NIEGA",
    motivo: "el gate de login (`decidirInicioDeSesion`, S-17/D5): abre sesión solo con membresía activa de empresa y sucursal, o con una invitación pendiente del mismo email (que solo lleva a la pantalla de aceptación); «sin empresa» acá es sin membresía activa ni invitación pendiente, y el dominio del correo no abre nada. Rechaza ANTES de que el adapter de Auth.js cree `User` o `Session`",
  },
};
