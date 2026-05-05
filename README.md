# Figuritas 2026

App React + API Node/Express + MySQL para marcar figuritas desde varios celulares contra la misma base de datos.

## Configuracion

1. Instala dependencias:

```bash
npm install
```

2. Crea un archivo `.env` copiando `.env.example` y ajusta tus datos de MySQL:

```bash
PORT=3001
ALBUM_ID=worldcup-2026

DB_HOST=srv1026.hstgr.io
DB_PORT=3306
DB_USER=tu_usuario_mysql
DB_PASSWORD=tu_password_mysql
DB_NAME=tu_base_de_datos
```

Para MySQL local o Docker usa:

```bash
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=figuritas_root
DB_NAME=figuritas_2026
```

En el panel de MySQL remoto debes autorizar la IP publica de la maquina donde corre `npm run dev` o `npm start`. Los celulares no se conectan directo a MySQL; los celulares entran a la app web y la app llama al backend Node.

3. Si no tienes MySQL instalado, puedes levantarlo con Docker:

```bash
npm run db:up
```

4. Si tu usuario de MySQL tiene permisos, el servidor crea la base y la tabla automaticamente. Si no, ejecuta:

```bash
mysql -u root -p < database/schema.sql
```

## Desarrollo

```bash
npm run dev
```

Esto levanta:

- API MySQL en `http://localhost:3001`
- Web app en `http://localhost:5173`

Desde celulares en la misma red abre la URL de red que imprime Vite, por ejemplo:

```text
http://192.168.2.3:5173
```

## Produccion local

```bash
npm run build
npm start
```

Luego abre:

```text
http://localhost:3001
```

Desde otros celulares usa la IP de la PC con el puerto `3001`.

## Despliegue en Hostinger Node.js App

Este proyecto necesita Node.js porque el backend Express es el que habla con MySQL. No lo despliegues como sitio estatico solamente.

En hPanel:

1. Ve a `Websites` -> `Add Website` -> `Node.js Web App`.
2. Elige importar desde GitHub o subir un ZIP del proyecto.
3. Usa estos valores:

```text
Framework: Other o Express.js
Build command: npm run build
Start command: npm start
Entry file: server/index.js
Output directory: dist
Node version: 20.x o 22.x
```

4. En `Environment variables`, agrega:

```text
PORT=3001
ALBUM_ID=worldcup-2026
DB_HOST=srv1026.hstgr.io
DB_PORT=3306
DB_USER=tu_usuario_mysql
DB_PASSWORD=tu_password_mysql
DB_NAME=tu_base_de_datos
VITE_API_BASE_URL=
```

5. Despliega y prueba:

```text
https://tu-dominio.com/api/health
```

Debe responder con `ok: true`.
