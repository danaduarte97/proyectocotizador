# Supabase limpio

Supabase es la base activa para empezar a cargar datos reales desde cero.
No se deben copiar cotizaciones, usuarios, comentarios ni archivos desde SQLite.

`database.db` queda solamente como respaldo local viejo. El servidor no lo usa por omision.

## 1. Ejecutar el schema en Supabase

1. Entrar al proyecto en Supabase.
2. Ir a **SQL Editor**.
3. Abrir `sql/schema.postgres.sql`.
4. Copiar todo el contenido.
5. Pegarlo en el SQL Editor.
6. Ejecutar el script.

Esto crea las tablas:

- `usuarios`
- `cotizaciones`
- `archivos`
- `comentarios_cotizacion`

Tambien crea indices basicos para busquedas y listados.

## 2. Crear el archivo `.env` local

Crear un archivo `.env` en la raiz del proyecto con este formato:

```env
DATABASE_URL=postgresql://usuario:password@host:5432/base_de_datos?sslmode=require
JWT_SECRET=cambiar_este_secreto
PORT=3000
```

Usar el connection string del proyecto Supabase. No commitear `.env`.

## 3. Crear el primer usuario admin real

Crear un usuario nuevo directamente en Supabase.
La contrasena debe guardarse con bcrypt.

Ejemplo de SQL, reemplazando los valores por credenciales reales:

```sql
INSERT INTO usuarios (usuario, password, rol)
VALUES ('admin', '<bcrypt_hash>', 'admin')
ON CONFLICT (usuario) DO NOTHING;
```

Una forma simple de generar el hash desde el proyecto:

```powershell
node -e "const bcrypt=require('bcrypt'); bcrypt.hash('1234', 10).then(console.log)"
```

## 4. Empezar a cargar datos reales

1. Reiniciar el servidor despues de crear `.env`.
2. Entrar a `http://localhost:3000`.
3. Iniciar sesion con el usuario admin nuevo.
4. Cargar cotizaciones reales desde cero.

## Notas

- No ejecutar `scripts/migrate-sqlite-to-postgres.js`; esta deshabilitado para evitar importar datos falsos.
- No se migran datos desde SQLite.
- No se migran imagenes ni adjuntos desde SQLite.
- Los archivos adjuntos siguen guardandose en `public/uploads`.
- Si falta `DATABASE_URL`, el servidor se detiene para no usar `database.db` por accidente.
- Para abrir el respaldo viejo de forma intencional, usar `USE_LEGACY_SQLITE_BACKUP=true`.
