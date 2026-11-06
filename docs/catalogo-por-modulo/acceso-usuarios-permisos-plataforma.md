# Catálogo del módulo ACCESO, USUARIOS, PERMISOS, CLIENTES Y PLATAFORMA (2026-11-06)

**Estado:** inventario de SOLO LECTURA (orden del dueño: sin implementar). Rama `alegp/catalogo-acceso-usuarios-permisos-plataforma`, base `main`. Diseño de partida: `origin/alegp/diseno-flujos-y-pasos:docs/diseno-flujos-y-pasos-2026-11-06.md`. Pasos y finalidades = PROPUESTA; lo que depende del dueño = PENDIENTE. No se corrió ningún test ni el gate. Las clases del guardián salen de `test/arquitectura/guardas/columnas-de-significado.ts:28-33` (este módulo está FUERA de alcance salvo `Empresa` y `Cliente`).

## 1. FLUJOS
| Flujo | Finalidad | Pasos (columnas) |
|---|---|---|
| F1 Alta de empresa y primer gerente | Que una empresa nueva exista y su gerente pueda entrar | P1 Empresa en alta: `Empresa.nombre/slug/zonaHoraria/moneda/estado=PROVISIONING` (existe). P2 Datos fiscales (plataforma): `cuit`, `condicionIva`, `llevaIvaDeCompras` (saber cómo se computa el IVA). P3 Módulos: `ModuloEmpresa.modulo/estado`. P4 Invitación: `Invitacion.email/rolEmpresa/hashToken/venceEn/enviadaEn` (que llegue el enlace). P5 Aceptación: `aceptadaEn/aceptadaPorId/cuitDeclarado` (validar identidad). P6 Activa: `Empresa.estado=ACTIVE`, `UsuarioEmpresa.rolEmpresa="gerente"`, primera `Sucursal` + `UsuarioSucursal`+`Rol`. Salida: `revocadaEn` |
| F2 Alta de usuario en sucursal | Dar acceso a una persona con rol | P1 Invitación `usuario`/`vinculacion`: `Invitacion` + `InvitacionSucursal.sucursalId/rolId/invitadoPorId`. P2 Aceptación: revalida permiso de `invitadoPorId`, crea `UsuarioEmpresa` y `UsuarioSucursal`. P3 Vigente: `activo`, `notas`. Salida: baja (`UsuarioSucursal.activo=false`, `UsuarioEmpresa.activo`, `User.activoGlobal`) |
| F3 Sesión y contexto | Saber quién es, en qué empresa y sucursal | P1 Login Auth.js (`User`, `Account`, `Session`) + gate `emailPuedeIniciarSesion`. P2 Elegir empresa (cookie). P3 Contexto `ContextoUsuario` con RLS por empresa y sucursal. P4 Revalidación cada 5 min (`sesionSigueVigente`) |
| F4 Permisos | Qué puede hacer cada rol y dónde | P1 Rol (`nombre`, `clave`). P2 Matriz `PermisoRol.puedeVer/puedeEditar` por `Accion`. P3 Capacidad por sucursal `CapacidadSucursal.habilitado`. P4 Política de empresa `permisosEditables/dosPaneles` (la fija la plataforma) |
| F5 Gobierno (gerente/admin) | Nunca queda la empresa sin admin ni gerente sin sucursal | Invariantes de `src/core/permisos/invariantes.ts`; traspaso de gerencia |
| F6 Cliente con descuento | Dar un % fijo a un cliente en el POS | P1 `Cliente.nombre/descuentoPorcentaje`. P2 Asignación a cuenta: el % se COPIA a `Cuenta.descuentoPorcentaje` (snapshot, `asignar-cliente-a-cuenta.ts:68`). P3 Cierre usa el snapshot (`cerrar-cuenta.ts:81-83`). Baja: `activo` |
| F7 Consola de plataforma | Operar las instalaciones | P1 Primer factor: `CodigoDeIngresoPlataforma` (mail). P2 Segundo factor TOTP (`secretoTotp`). P3 `SesionPlataforma`. P4 Acciones → `AuditoriaPlataforma`. Alta de admin: `scripts/plataforma/crear-primer-admin.ts` |

## 2. COLUMNAS (solo las con observación; el resto cumple el uso de su flujo y no está en el guardián)
| modelo.columna | flujo/paso | para qué | escritor | lectores | clase | observación |
|---|---|---|---|---|---|---|
| `Sucursal.maxMesasAbiertas` | — | cupo de mesas retirado 2026-10-29 | nadie (`schema.prisma:133-134`) | solo comentarios (`pos/cuenta-apertura.ts:34`, `core/permisos/auditoria.ts:25`) | fuera | **colgada, sin lector ni escritor**; borrado = migración destructiva sin autorizar |
| `Cliente.activo` | F6 baja | ocultar cliente | `clientes/casos-de-uso/actualizar-activo-cliente.ts` | `clientes/*`, asignación POS | deuda (`sin-declarar`, baseline `columnas-de-significado.json:19`) | modelo en alcance dinero (`guardas:41`) sin declarar |
| `Cliente.descuentoPorcentaje` | F6 P1 | % a aplicar | `alta-cliente.ts`, `actualizar-cliente.ts` | `asignar-cliente-a-cuenta.ts`, `cuenta-apertura.ts` | dinero (modelo en alcance) | **doble fuente** con `Cuenta.descuentoPorcentaje` (snapshot intencional, D7) |
| `Empresa.estado` | F1 P1→P6 | PROVISIONING/ACTIVE/suspendida | plataforma (`plataforma/src/servidor/ciclo-de-vida.ts`) | `sesion/contexto.ts:86`, login | deuda (`sin-declarar`, baseline :58) | decide acceso, no está declarada |
| `Empresa.dosPaneles` | F4 P4 | layout de UI | `operaciones-de-plataforma/cambiar-politica-de-empresa.ts` | `components/app-shell.tsx:58`, sidebars | deuda (`sin-declarar`, baseline :55) | solo presentación; candidata a clase «ninguna» |
| `Empresa.permisosEditables` | F4 P4 | congela edición de permisos | idem | `actions/con-permiso.ts`, páginas roles/permisos | ninguna (`guardas:181`) | permisos sí cambian quién puede hacer qué: **la clase «ninguna» es discutible (doble sentido: su motivo dice «no toca dinero», pero gobierna permisos)** |
| `Empresa.condicionIva` / `llevaIvaDeCompras` | F1 P2 | IVA compras | plataforma | compras | dinero (`guardas:179-180`) | cruza a módulo Compras |
| `Empresa.moneda` | F1 P1 | moneda | alta de empresa | solo `app/(app)/administracion/empresa/page.tsx` (grep) | sin clase | **un solo lector de pantalla; el dinero no la lee** (NO VERIFICADO que otros módulos usen moneda fija) |
| `Empresa.zonaHoraria` | F1 P1 | cortes de día | alta | consultas POS/reportes/invitaciones (8 archivos) | sin clase | dato de fecha; sin guardián |
| `Empresa.nombre` y `slug` | F1 P1 | identidad | alta | todo | — | dos identificadores únicos (nombre y slug): fuente doble de identidad, NO VERIFICADO cuál manda |
| `Invitacion.rolEmpresa` vs `UsuarioEmpresa.rolEmpresa` | F1/F2 | rol de empresa | invitaciones / `transferir-gerencia*.ts` | `core/permisos/rol-empresa.ts` | — | **doble sentido**: en `Invitacion` guarda el rol que dará («gerente»); el TIPO de invitación (`gerente/usuario/vinculacion`) va en otra constante (`core/auth/invitacion.ts:43`) |
| `Invitacion.cuitDeclarado` | F1 P5 | validar CUIT | `aceptar-invitacion-de-gerente.ts` | consola (`plataforma/.../empresas/[id]/page.tsx`) | — | solo lo lee la consola |
| `User.activoGlobal` / `UsuarioEmpresa.activo` / `UsuarioSucursal.activo` / `Sucursal.activo` / `Rol.activo` | F2 baja | 5 interruptores de «activo» en 5 niveles | acciones de `auth/casos-de-uso/actualizar-activo-*` | `acceso.ts`, `contexto.ts:131`, `gobierno.ts` | — | **múltiples fuentes de «puede entrar»** (ver §4) |
| `RegistroAuditoria.entidad` | transversal | texto libre con lista en comentario (`schema.prisma:301`) | `core/permisos/auditoria.ts` | pantalla de auditoría | — | **sin CHECK ni enum**: la lista de entidades vive en un comentario |
| `ModuloEmpresa.modulo` | F1 P3 | módulos vendibles | solo `motor2_plataforma` | `server/acceso/modulos-de-empresa.ts` | — | TEXT validado en código (decisión ADR-014/015) |
| `AuditoriaPlataforma.empresaAfectadaId` | F7 P4 | trazabilidad | consola | consola | — | sin FK a propósito |

## 3. FUNCIONES Y PRIMITIVAS
| nombre | archivo | qué hace | copias / variantes | ¿fuente única? |
|---|---|---|---|---|
| `tieneSucursalActiva` (A) | `server/lecturas/permisos/gobierno.ts:28` | membresía activa en sucursal **activa** (`sucursal:{activo:true}`) | variante B | No: mismo nombre, criterio distinto |
| `tieneSucursalActiva` (B) | `server/sesion/acceso.ts:89` | `UsuarioEmpresa` activo + `UsuarioSucursal` activo, **sin mirar `Sucursal.activo` ni `Empresa.estado`** | A | No |
| normalizar email (`trim().toLowerCase()`) | `core/plataforma/email-reservado.ts:5` (`normalizarEmail`) | normaliza | 9 copias en línea: `core/auth/cuentas-vinculadas.ts:14,37`, `server/sesion/acceso.ts:34,51`, `sesion/invitacion.ts:94`, `sesion/vincular-cuenta.ts:27`, `transferir-gerencia.ts:56`, `aceptar-invitacion-de-gerente.ts:85`, `aceptar-invitacion-de-usuario.ts:85`, `invitaciones-de-usuario-en-tx.ts:49` | **No** (primitiva existe y casi nadie la usa) |
| hash de token | `core/seguridad/tokens.ts:15` (`hashDeToken`) | SHA-256 | `core/plataforma/codigos.ts` (HMAC), `core/auth/secreto-cron.ts`, `core/movimientos/idempotencia.ts` | Parcial (propósitos distintos; NO VERIFICADO si `codigos.ts` reusa `tokens.ts`) |
| `politicaDeEmpresa` | `server/acceso/politica-de-empresa.ts:10` | lee `permisosEditables/dosPaneles` | perfiles en `core/permisos/politica-de-empresa.ts:23` | Sí |
| `sucursalTieneCapacidad` / `resolverCapacidad` | `server/acceso/capacidades-sucursal.ts:26` / `core/permisos/capacidades-sucursal.ts:11` | capacidad por sucursal | — | Sí (par puro+IO) |
| `filtroAdminEfectivo`, `filtroDelGerente` | `core/permisos/filtros.ts` | quién es admin/gerente | usados por `gobierno.ts` | Sí (declarado `gobierno.ts:14`) |
| `esRolAdmin`, `nivelDeRolPorClave`, `nivelDe` | `core/permisos/jerarquia.ts:51,59,86` | jerarquía operario/admin/gerente | 3 niveles repartidos en 2 tipos (`NivelDePersona` y `NivelDeAccion`) | Sí |
| duración de sesión | `core/auth/duracion-sesion.ts:9` (12 h), `core/plataforma/sesion.ts:6` (8 h) | dos sesiones | app vs consola | Intencional |
| `crearRegistroDeRevalidacion` | `core/auth/revalidacion-de-sesion.ts` | marca en MEMORIA por instancia | — | la marca no se comparte entre instancias serverless (`acceso.ts:97-105` lo dice) |
| `MODULOS` catálogo | `core/modulos/catalogo.ts:21` | módulos vendibles | `modulo-de-la-accion.ts` (acción→módulo) | Sí |

## 4. FUENTES DE VERDAD
| hecho | lugares | quién manda | tipo |
|---|---|---|---|
| «Puede entrar» | `User.activoGlobal`, `UsuarioEmpresa.activo`, `UsuarioSucursal.activo`, `Sucursal.activo`, `Empresa.estado`, `Rol.activo`; evaluado en `acceso.ts:45`, `acceso.ts:121`, `contexto.ts:112-131`, `gobierno.ts:28` | `contexto.ts` (único que da `ctx.db`) | Accidental en parte: el login (B) es más laxo a propósito (`acceso.ts:103`) |
| Quién es el gerente | `UsuarioEmpresa.rolEmpresa="gerente"` y `Rol.clave="admin"` en la sucursal | `rolEmpresa` | Intencional (ADR) |
| Descuento del cliente | `Cliente.descuentoPorcentaje` y `Cuenta.descuentoPorcentaje` | snapshot en la cuenta | Intencional (D7) |
| Módulos activos | `ModuloEmpresa` + catálogo en código + `modulo-de-la-accion.ts` | código ∩ tabla | Intencional |
| Política de permisos | `Empresa.permisosEditables` + matriz `PermisoRol` + `CapacidadSucursal` + `jerarquia.ts` (clave "admin" fija) | `decision-de-acceso.ts` | NO VERIFICADO si el orden es único |
| Lista de entidades auditables | comentario `schema.prisma:301`, `core/permisos/auditoria.ts` | ninguno | Accidental |
| Zona horaria / moneda | `Empresa.zonaHoraria/moneda` vs constantes de Argentina en `core` | NO VERIFICADO | — |

## 5. ESCRITURAS
| caso de uso | qué escribe | ¿de más? | tipo |
|---|---|---|---|
| `crear-sucursal-con-admin.ts` | `Sucursal`, `UsuarioSucursal`, `UsuarioEmpresa` | no | Intencional |
| `agregar-o-actualizar-usuario.ts`, `aceptar-invitacion-de-usuario.ts` | `User`, `UsuarioEmpresa`, `UsuarioSucursal`, `RegistroAuditoria` | NO VERIFICADO si se escribe dos veces la pertenencia | — |
| `guardar-permisos.ts` | `PermisoRol` (SERIALIZABLE + reintento) + auditoría | no | Intencional |
| `transferir-gerencia*.ts` | `UsuarioEmpresa.rolEmpresa` (x2) | no | Intencional |
| `asignar-cliente-a-cuenta.ts` | `Cuenta.clienteId` + `Cuenta.descuentoPorcentaje` + 2 auditorías | copia del % | Intencional |
| `sesionSigueVigente` | solo memoria; no escribe `Session` (`acceso.ts:104`) | no | Intencional |
| Consola: ingreso | `CodigoDeIngresoPlataforma`, `SesionPlataforma`, `AuditoriaPlataforma` | NO VERIFICADO | — |

## 6. INVARIANTES
| regla | documento | test |
|---|---|---|
| Siempre queda un admin activo | `core/permisos/invariantes.ts:35` | `test/permisos/invariantes-de-gobierno.test.ts` |
| Gerente con sucursal activa y admin efectivo | `invariantes.ts:40,45` | idem |
| Rol de sistema intacto (clave estable) | `invariantes.ts:63`, `schema.prisma` `Rol.clave` | NO VERIFICADO (probable en `invariantes-de-gobierno`) |
| Toda acción con `sucursal…Id` declara a qué se ata | cabecera del guardián | `test/arquitectura/ids-de-sucursal-declaran-a-que-se-atan.test.ts` |
| Ver ⊇ Editar | `schema.prisma` `PermisoRol` | NO VERIFICADO |
| Aislamiento por empresa y sucursal | RLS | `test/aislamiento/`, `test/invariantes/aislamiento-sucursal.test.ts` |
| Un token de invitación sirve una vez; hash, no token | `schema.prisma` `Invitacion` | `test/auth/invitacion-gate.test.ts` |
| TOTP no reutilizable (`ultimoPasoTotp`) | `schema.prisma` `AdminPlataforma` | NO VERIFICADO (hay `probar-actor-de-plataforma.test.ts`) |
| `0 ≤ % < 100` del descuento | `clientes.schema.ts` | `test/clientes/cliente.test.ts` (NO VERIFICADO el caso 100) |
| Duplicados de `tieneSucursalActiva` coinciden | — | **sin test** |

## 7. DEUDA
| ítem | ¿vencimiento? | dónde |
|---|---|---|
| `Cliente.activo`, `Empresa.dosPaneles`, `Empresa.estado` sin declarar | meta «bajar a 0», sin fecha (la línea de base tiene 82 entradas, `columnas-de-significado.json:3`) | baseline |
| `Sucursal.maxMesasAbiertas` columna muerta | no; espera autorización destructiva | `schema.prisma:133` |
| Marca de revalidación en memoria por instancia | no | `acceso.ts:97` |
| Guardián de ids de sucursal sin mirar ids anidadas | no | ver §9 |
| Cercos de `.dependency-cruiser-excepciones.cjs` | NO VERIFICADO | — |

## 8. INTERFACES
- **Cruces del cruiser que tocan el módulo** (`.dependency-cruiser-excepciones.cjs`): `sesion/contexto.ts:29`, `sesion/ir-al-login.ts:34` (Next en sesión); `sesion/base.ts:49`, `sesion/acceso.ts:53`, `lib/auth.ts:57` y `carta-publica/sin-sesion.ts:61` (cliente de base global); lista de importadores de `dbDeEmpresa/dbDeUsuario` (`:72-79`: contexto, alcance, acceso, invitacion, sin-sesion, empresa-activa, 2 crons); migradas a casos de uso: `actions/auth/invitacion.ts:144`, `permisos/capacidades-sucursal.ts:219`, `permisos/roles.ts:224`, `permisos/permisos.ts:229`, `auth/sucursales.ts:234`, `auth/usuarios.ts:239`, `clientes/cliente.ts:294`. NO conté los 35 uno a uno.
- Cruces de datos: `Cliente`→`Cuenta`/`Operacion` (POS, Ventas); `RegistroAuditoria` lo escribe todo el sistema; `Empresa.condicionIva/llevaIvaDeCompras`→Compras; `UsuarioSucursal`/`Rol`→todas las acciones vía `conPermiso`; `Sucursal`→ 40+ relaciones (`schema.prisma:127-185`); `Empresa.permisosEditables`→UI de roles; `plataforma/` escribe `Empresa`, `ModuloEmpresa`, `Invitacion` (rol `motor2_plataforma`).

## 9. NO VERIFICADO / HALLAZGOS
1. **`tieneSucursalActiva` duplicada: CONFIRMADA la divergencia, DESCARTADO que deje entrar a datos.** (B) `acceso.ts:89-95` no exige `Sucursal.activo` ni `Empresa.estado`, pero el contexto (`contexto.ts:131`) sí (`sucursal:{activo:true}`, y `:86` empresa ACTIVE). El login pasa y `/login` lo explica (`acceso.ts:103`). El riesgo real es de mantenimiento: mismo nombre y dos criterios, **sin test** que lo fije.
2. **Guardián de ids de sucursal: CONFIRMADO ciego a ids anidadas en listas.** `propiedadesDeUnTipo` (`test/arquitectura/ids-de-sucursal-declaran-a-que-se-atan.test.ts:180-191`) lista solo nombres de propiedades de primer nivel; `reparto.partes[].sucursalId` no se ve. Hoy lo cubre un chequeo a mano en el caso de uso (`facturas-proveedor.ts:25`). Otras listas con ids: NO VERIFICADO.
3. Email normalizado a mano en 9 lugares aunque existe `normalizarEmail`.
4. `Empresa.permisosEditables` clasificada «ninguna» pero gobierna permisos; `Empresa.estado` y `dosPaneles` sin declarar; `Cliente` en alcance dinero con `activo` sin declarar.
5. `Sucursal.maxMesasAbiertas`: columna muerta; `RegistroAuditoria.entidad` sin catálogo; revalidación de sesión solo en memoria.
- NO VERIFICADO: las 135 claves de `acciones.ts` y su mapeo a módulo (`modulo-de-la-accion.ts`), los 35 cruces uno a uno, concurrencia de `agregar-o-actualizar-usuario`, y el flujo completo de la consola (`plataforma/src/servidor/*`).
