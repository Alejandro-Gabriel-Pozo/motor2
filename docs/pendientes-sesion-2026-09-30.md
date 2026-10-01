# Pendientes de la sesión del 2026-09-30

Historial de lo que falta, en el formato del `docs/pendientes-sesion-2026-09-27.md`. El tracker de tareas de Claude Code
(`TaskCreate`/`TaskList`) no está disponible en esta sesión y no es visible desde otra, así que el historial vive acá. Cada
pendiente lleva su estado; al cerrar uno se actualiza este archivo en el mismo commit.

Rama de trabajo: `multitenancy-fase-a`. `origin/main` = `72acca5` y no se toca. Commits/push se habilitan por hash y por
commit, siempre con OK expreso del dueño.

## Hecho en esta sesión (ya en `origin/multitenancy-fase-a`)

- `9e72c9f` Reportes de dinero: sumar solo las sucursales donde el rol puede ver el dinero.
- `6d07fd1` Flaky e2e `multiempresa-selector`.
- `3664052` Precio local: la capacidad `precio_local` gobierna de verdad; "la carta acompañó" mide el precio efectivo.
- `2ef74f4` Tres fugas de alcance de permisos: cuenta apagada por empresa, alta de usuario en la sucursal destino y techo de
  admin (admin de la sucursal o gerente de empresa), auditoría filtrada por sucursal con las filas de empresa solo para el gerente.

## Decisiones del dueño que ordenan lo que sigue (2026-09-30)

- Una clave de permiso por acción, y una clave por reporte (reemplaza la agrupación `ver_reportes_*` del 2026-09-19).
- RBAC = acción + contexto (empresa vs sucursal): campo `contexto` en el catálogo, wrapper `conPermisoDeEmpresa`, test guardián.
- Visión de plataforma: el superadmin elige los permisos desde el inicio; como add-on, la empresa puede o no editar/otorgar permisos.
- Una migración de datos de permisos no cambia el schema; cualquier cambio de schema requiere autorización expresa.

## En curso

1. **Partición de claves de permisos** (autorizada el 2026-09-30). Tres planes en paralelo, sin código todavía:
   reportes (una clave por reporte), operaciones/POS/carta/transferencias/stock, y administración + infraestructura
   (`contexto`, `conPermisoDeEmpresa`, guardianes, claves sin consumidor `ejecutar_tests`/`sincronizar_proveedores`/`notificar_alertas`).
   Estado: los tres planes están entregados y reconciliados; esperan las decisiones del dueño (ver el resumen de la sesión). Orden
   propuesto: (1) infraestructura (tipo estrecho de `AccionClave`, inventario AST, `contexto`, `conPermisoDeEmpresa`, molde de migración
   con `empresaId`), (2) reportes, (3) operaciones/POS/carta/catálogo, (4) administración, (5) contract que borra las claves madre en un
   deploy posterior. Sin cambios de schema: `contexto` vive solo en código. Hallazgo: ningún usuario migrado tiene `rolEmpresa = "gerente"`.

### Avance de la partición (2026-10-01, sin commitear)

- Infraestructura (lote 1): hecha y verificada con el gate de 7 comandos (317 archivos / 3704 tests; e2e 406).
- Reportes: hecho y verificado con el gate completo (318 archivos / 3737 tests; e2e 406). 26 claves `reporte_*` reemplazan a las 4
  `ver_reportes_*`; migración de datos `20261001100000_particion_permisos_reportes` (con `empresaId` explícito, idempotente, probada con 2
  empresas); guardián «una clave por pantalla» con demo de mutación. Consignación y Promociones no se parten (son gestión). No se creó
  `pos_ver_importes` (el POS usa `reporte_boletas`).
- Jerarquía, paso 1 (piso `nivelMinimo` HECHO CUMPLIR): `guardarPermisos` rechaza dar una acción por encima del nivel del rol (todo o nada), el
  gate ignora la fila de un rol por debajo del piso (permiso, menú y lecturas), y la matriz marca esas celdas con 🚫 y muestra el «Piso». Un rol
  personalizado es de nivel operario; solo «admin» es de nivel administrador; las de piso gerente las tiene solo el gerente de la empresa
  (`esGerenteDeEmpresa`, sin matriz ni capacidad de la Central; hoy no existe ninguna, se prueba con un mock). Las filas viejas por encima del
  piso quedan en la base pero el gate las ignora (no se limpian).
- Jerarquía, paso 2 (sin schema): un solo gerente por empresa en código (`core/permisos/gerencia.ts`, `conGerenteDeEmpresa`; nadie más que el
  gerente lo toca, no puede desactivar su cuenta ni su última sucursal; el bootstrap no crea un segundo), acción `transferirGerencia` con
  auditoría y migración de datos `20261001120000_gerente_unico_por_empresa` (un gerente por empresa: el más antiguo, o el admin activo más
  antiguo). Falta: la UI del traspaso de gerencia, el índice único en la base (schema, requiere autorización expresa; hoy la asignación
  concurrente en una empresa SIN gerente no está protegida) y el ADR-008 (paso 3).
- Fase de contract (borrar las `Accion` padre, incluidas `ver_reportes_*`) en un deploy posterior.
- Siguiente en el orden: operaciones/POS/carta/catálogo, después administración.

## Sin empezar (necesitan visto bueno del dueño antes de implementar)

2. Add-on de plataforma: catálogo/«plan» de permisos por empresa e interruptor «puede editar/otorgar permisos». Siguiente peldaño
   de la partición; probablemente necesita schema (autorización expresa).
3. Permisos de carta (corrida 1, sin schema) y recetas (corrida 1, sin schema), según
   `motor2-recetas-carta-por-sucursal-decisiones`.
4. Auditoría de traspasos, compras, clientes, api y cron (hoy no dejan rastro en `RegistroAuditoria`).
5. Iconos lucide en el menú, con medición de bundle antes de decidir.
6. `/inicio` real (hoy no es una pantalla propia).
7. Plan de cambio de sucursal / salida del salón (navegación decidida, sin implementar).
8. Dos paneles, Empresa y Sucursal.
9. Módulo de margen objetivo.
10. Unificar la semántica de «sin fila» (sin precio local, sin receta propia, sin carta propia).
