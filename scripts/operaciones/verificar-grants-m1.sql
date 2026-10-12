-- Verificación de SOLO LECTURA del estado de permisos de M.1 «Grants de la consola» (S-35 / M-10 / M-33). Se corre ANTES y DESPUÉS de crear-rol-motor2-plataforma.sql (con restringir) y de
-- devolver-escritura-de-empresa-a-motor2-app.sql, una vez por base, y se comparan las salidas: la HUELLA de la matriz (consulta 9) cambia si cambió cualquier privilegio de tabla de los dos roles.
-- Una guarda (test/arquitectura/rol-plataforma-separado.test.ts) exige que acá solo haya SELECT y SET, y un test lo corre dentro de BEGIN READ ONLY: no escribe nada, no crea nada, no cambia ningún rol.
-- No imprime claves ni hashes de contraseña: solo nombres de rol, atributos y privilegios.
-- Uso (como el dueño o como cualquier rol que pueda leer el catálogo; con psql o con el ejecutor):
--   psql <conexión a la base> -f scripts/operaciones/verificar-grants-m1.sql
--   node scripts/operaciones/ejecutar-sql-de-psql.mjs <archivo.env> scripts/operaciones/verificar-grants-m1.sql --simular --host-esperado <host>
-- Sale de las consultas del diagnóstico M-33 (¿con qué rol corre la app y rige la RLS?), más la matriz de privilegios por rol, la ACL exacta de «Empresa» y los privilegios por columna.

-- 1) Rol con el que estás conectado y sus atributos. Lo que importa: rolsuper = f y rolbypassrls = f
SELECT current_user AS rol_actual, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
FROM pg_roles WHERE rolname = current_user;

-- 2) Roles de aplicación existentes y si pueden saltear la RLS
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('motor2_app', 'motor2_plataforma', 'motor2')
   OR rolname LIKE 'neon%' OR rolname LIKE '%owner%'
ORDER BY rolname;

-- 3) Dueño de las tablas (el dueño saltea la RLS salvo FORCE ROW LEVEL SECURITY)
SELECT tableowner, count(*) AS tablas
FROM pg_tables WHERE schemaname = 'public'
GROUP BY tableowner ORDER BY tablas DESC;

-- 4) Tablas con RLS activada y con RLS forzada (relforcerowsecurity)
SELECT count(*) FILTER (WHERE relrowsecurity)      AS con_rls,
       count(*) FILTER (WHERE relforcerowsecurity) AS con_rls_forzada,
       count(*)                                     AS tablas
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- 5) La ACL EXACTA de «Empresa» (la tabla sin RLS que M.1 recorta), tal como está guardada: dueño y relacl
SELECT pg_get_userbyid(c.relowner) AS dueno_de_empresa, c.relacl::text AS relacl_de_empresa
FROM pg_class c
WHERE c.relname = 'Empresa' AND c.relnamespace = 'public'::regnamespace;

-- 6) Lo mismo desglosado por quien lo tiene (PUBLIC incluido: es lo que un REVOKE a un rol no quita)
SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS quien,
       string_agg(x.privilege_type, ', ' ORDER BY x.privilege_type) AS privilegios_sobre_empresa
FROM pg_class c, aclexplode(c.relacl) x
WHERE c.relname = 'Empresa' AND c.relnamespace = 'public'::regnamespace
GROUP BY 1 ORDER BY 1;

-- 7) Privilegios POR COLUMNA (attacl) de las tablas de public: un REVOKE de tabla los quita, pero un GRANT por columna posterior no lo ve nadie si no se mira acá
SELECT c.relname AS tabla, a.attname AS columna, a.attacl::text AS attacl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
ORDER BY 1, 2;

-- 8) La matriz de privilegios EFECTIVOS (has_table_privilege: suma lo dado al rol, a PUBLIC y a los roles de los que es miembro) de motor2_app y motor2_plataforma sobre cada tabla de public
SELECT r.rolname AS rol, c.relname AS tabla,
       has_table_privilege(r.oid, c.oid, 'SELECT')     AS puede_select,
       has_table_privilege(r.oid, c.oid, 'INSERT')     AS puede_insert,
       has_table_privilege(r.oid, c.oid, 'UPDATE')     AS puede_update,
       has_table_privilege(r.oid, c.oid, 'DELETE')     AS puede_delete,
       has_table_privilege(r.oid, c.oid, 'TRUNCATE')   AS puede_truncate,
       has_table_privilege(r.oid, c.oid, 'REFERENCES') AS puede_references,
       has_table_privilege(r.oid, c.oid, 'TRIGGER')    AS puede_trigger
FROM pg_roles r
CROSS JOIN pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname IN ('motor2_app', 'motor2_plataforma') AND n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY 1, 2;

-- 9) La HUELLA de esa matriz: un md5 de «rol tabla privilegios» ordenado. Si antes y después de un paso da lo mismo, no cambió ningún privilegio de tabla de los dos roles.
SELECT count(*) AS filas,
       md5(coalesce(string_agg(m.linea, '|' ORDER BY m.linea), '')) AS huella_de_la_matriz
FROM (
  SELECT r.rolname || ' ' || c.relname || ' ' || concat_ws(',',
           CASE WHEN has_table_privilege(r.oid, c.oid, 'SELECT')     THEN 'SELECT' END,
           CASE WHEN has_table_privilege(r.oid, c.oid, 'INSERT')     THEN 'INSERT' END,
           CASE WHEN has_table_privilege(r.oid, c.oid, 'UPDATE')     THEN 'UPDATE' END,
           CASE WHEN has_table_privilege(r.oid, c.oid, 'DELETE')     THEN 'DELETE' END,
           CASE WHEN has_table_privilege(r.oid, c.oid, 'TRUNCATE')   THEN 'TRUNCATE' END,
           CASE WHEN has_table_privilege(r.oid, c.oid, 'REFERENCES') THEN 'REFERENCES' END,
           CASE WHEN has_table_privilege(r.oid, c.oid, 'TRIGGER')    THEN 'TRIGGER' END) AS linea
  FROM pg_roles r
  CROSS JOIN pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE r.rolname IN ('motor2_app', 'motor2_plataforma') AND n.nspname = 'public' AND c.relkind IN ('r', 'p')
) m;

-- 10) Privilegios por defecto (lo que heredan las tablas nuevas)
SELECT pg_get_userbyid(defaclrole) AS creador, defaclobjtype AS tipo, defaclacl::text AS acl
FROM pg_default_acl;

-- 11) Membresías entre roles (un rol que hereda de otro con BYPASSRLS o con escritura sobre «Empresa» también la tiene)
SELECT r.rolname AS rol, m.rolname AS miembro_de
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.member
JOIN pg_roles m ON m.oid = am.roleid
WHERE r.rolname IN ('motor2_app', 'motor2_plataforma', current_user);
