# C2c construida: hora de corte de la sucursal (2026-11-17)

Nota de construcción. El diseño completo (niveles 1 a 10, tabla «¿qué pasa si…?», oráculo rol × piso) es el apartado «C2c» y «P-CORTE-ESCRIBE» de `docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md` (rama `caja-c2c-diseno`, PR #397). Este documento no lo repite: dice qué se construyó, en qué se apartó del diseño y qué queda sin verificar.

**Pedido y aceptación del dueño.** Orden, chat con el orquestador, 2026-11-17: «quiero que construyas lo que falta, ya. ahora.» Forma y permiso: «5.- recomendado» (2026-11-17): la hora se cambia desde la edición de sucursal existente, con el mismo permiso que el resto de esa edición (`renombrar_sucursal`), sin permiso nuevo, auditando anterior y nuevo, por defecto 00:00.

## Qué se construyó

- Caso de uso `cambiarHoraDeCorteDeSucursalCasoDeUso` (`src/server/actions/auth/casos-de-uso/cambiar-hora-de-corte-de-sucursal.ts`): una transacción SERIALIZABLE (`conTransaccionSerializable`) que lee la sucursal, compara y, si cambia, escribe y audita (`Sucursal.horaDeCorte`, anterior y nuevo «HH:MM»). Mismo valor: ok sin escribir ni auditar (`datos.sinCambios: true`). Ficha: `permiso=renombrar_sucursal transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA`.
- Códigos de resultado: `SUCURSAL_NO_ENCONTRADA`, `HORA_DE_CORTE_INVALIDA` (los dos propuestos por el diseño).
- Server Action `cambiarHoraDeCorteDeSucursal(sucursalId, horaDeCorte)` (`src/server/actions/auth/sucursales.ts`): `conPermisoDeEmpresa("renombrar_sucursal")` → guard de formato dentro del envoltorio → caso de uso → refresco de la vista → `aResultadoAccion`. No se tocó `src/core/permisos/acciones.ts`.
- Guard `guardComandoCambiarHoraDeCorteDeSucursal` (`src/core/features/sucursales/sucursal.guard.ts`) y `horaDeCorteValida` / `horaDeCorteDeColumnaTime` (`src/core/tiempo/fecha-de-negocio.ts`): lista de permitidos `HH:MM` estricta, 00:00 a 23:59 (la misma forma que ya exigía `fechaDeNegocio`). La base conserva su CHECK como tercera barrera.
- Persistencia: `cambiarHoraDeCorteDeSucursalEnBase` (`src/server/persistencia/auth/sucursales.ts`).
- Lectura: `listarSucursales` suma `horaDeCorte` («HH:MM», ya convertida de la columna `TIME(0)`), con el mismo `select` cerrado.
- Pantalla mínima: en `administracion/sucursales`, un campo «Hora de corte» (rótulo mínimo) con `HH:MM` y botón «Guardar» (solo quien tiene `renombrar_sucursal` en editar; los demás ven la hora como texto). Ayuda: «A esta hora empieza el día de negocio de la caja».
- Sin migración de esquema.

## Archivos de zona restringida / inventarios tocados (mínimo, y por qué)

- `src/core/textos/catalogo.ts`: el nuevo caso de uso usa `rechazo.NO_ENCONTRADO`; el catálogo exige registrar cada uso (una línea en `usos`).
- `test/arquitectura/gobierno-envoltorio-y-clave.test.ts`: declara la nueva Server Action (`conPermisoDeEmpresa`, `renombrar_sucursal`).
- `test/arquitectura/ids-de-sucursal-declaran-a-que-se-atan.test.ts`: el id de sucursal de la acción se ata a `EMPRESA_RLS`, igual que `renombrarSucursal`.
- `test/arquitectura/escrituras-en-sucursal-desde-empresa.test.ts`: el caso de uso entra con `ata: EMPRESA_ENTERA`, igual que renombrar (con la misma marca «A CONFIRMAR POR EL DUEÑO»: se puede cambiar desde otra sucursal).
- `test/permisos/lecturas-de-accion-sin-filas-enteras.test.ts`: la lectura de sucursales ahora devuelve también `horaDeCorte` (la pantalla la dibuja); el test fijaba las claves exactas (id, nombre, activo).
- `test/permisos/gobierno-rechaza-sin-permiso.test.ts`: la nueva acción entra a la lista de mutaciones de gobierno (16 pasan a 17; y el conteo de `gobierno-envoltorio-y-clave.test.ts`); es el control de rechazo por permiso y de «no cambia ninguna tabla».
- `test/aislamiento/denegacion/argumentos.ts`: `horaDeCorte: () => "06:00"` (valor por defecto de la matriz de denegación por defecto para el parámetro nuevo; sin él la acción no se ejerce como anónimo ni sin empresa; el control positivo escribe 06:00).
- No se tocaron `.dependency-cruiser-excepciones.cjs`, goldens ni `knip.jsonc`.

## Pruebas

- `test/auth/oraculo-de-hora-de-corte.ts` (oráculo escrito aparte) y `test/auth/hora-de-corte-rol-por-piso.test.ts`: las ocho combinaciones del diseño (2b) y TODAS las de rol de membresía × fila × rol de empresa contra `nivelesEnLaEmpresa` + `decidirEnEmpresa`, y la Server Action real con un usuario real de cada tipo contra Postgres.
- `test/administracion/hora-de-corte-caso-de-uso.test.ts`: las 1440 horas válidas y las inválidas típicas; cambio válido con una auditoría; mismo valor; doble clic; dos cambios simultáneos; hora inválida; sucursal inexistente o de otra empresa; sesión abierta que conserva su sello; sesión nueva que sella la hora nueva; jornada cerrada intacta; cambio contra apertura de sesión a la vez (8 vueltas).
- Mutaciones (rojo, y restauradas): sin la comparación «mismo valor» → rojos «mismo valor» y «doble clic»; sin la auditoría → rojos «cambio válido», «mismo valor», «doble clic» y «dos cambios»; sin `conPermisoDeEmpresa` → rojos seis casos rechazados de rol × piso; sin la validación del guard → rojo el test de las horas; sin la validación del caso de uso → rojo «hora inválida».

## Diferencias con el diseño

- El caso de uso también valida la forma de la hora (defensa en profundidad: guard, caso de uso y CHECK de la base), y devuelve `HORA_DE_CORTE_INVALIDA`.
- La Server Action no revalida la carta pública (la hora de corte no la afecta); solo refresca la vista, como el alta de sucursal.
- Nombres de código: `cambiarHoraDeCorteDeSucursal` / `cambiarHoraDeCorteDeSucursalCasoDeUso`; diferencia de forma con Pedernal (`editar-sucursal.ts`): no hay una edición única de todos los campos, es un comando aparte porque la edición de sucursal de Motor2 ya está dividida (renombrar / activar). A confirmar por el dueño si prefiere una edición unificada.

## NO VERIFICADO

- La pantalla no se probó en un navegador (ver el informe de la sesión). Los tests de pantalla/e2e existentes no se corrieron; el e2e lo corre el CI.
- Un gerente que lo sea por transferencia de gerencia y no tenga el rol `admin` en ninguna sucursal no puede cambiar la hora (consecuencia del piso de `renombrar_sucursal`; ya señalada en el diseño).
- El cambio contra una apertura de sesión a la vez se probó contra Postgres local en 8 vueltas; no es una prueba de ausencia de la carrera, sino de que no apareció un error crudo ni un sello incoherente.
- Contra una base de producción: no verificado.

## Regla de pantallas (2026-11-17): la pantalla es un SUPUESTO sin maqueta

Pedernal NO tiene esta pantalla (respuesta de su orquestadora, ZuluHub-ERP `4fa7f3b8` y ZuluHub-docs `6b0b88d`): la única UI que llama a `editarSucursal` es «Contacto de la sucursal» y no manda la hora de corte; la leyenda sale de `10-ux-ui/01-arquitectura-de-experiencia.md:252` y el permiso es `sucursales.editar` (gerente y administrador). Por eso esta pantalla se declara SUPUESTO (P5) y NO se presenta al dueño como «igual». Textos: «Guardar» y la leyenda «Rige para lo que se cree desde ahora; lo abierto sigue como está.»; el rótulo «Hora de corte» queda en la lista de preguntas pendientes de textos. Se quitó la frase propia «A esta hora empieza el día de negocio de la caja». Queda como diferencia: Pedernal montaría el campo en el grupo y el patrón de «Contacto de la sucursal»; acá va en la fila de la sucursal (tabla de Administración → Sucursales) y NO se verificó contra capturas lado a lado (NO VERIFICADO).
