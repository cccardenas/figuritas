# Figuritas API

Backend para guardar figuritas por usuario. Las rutas de autenticacion devuelven un token JWT y todas las rutas de figuritas deben llamarse con ese token para que los datos no se mezclen entre usuarios.

## Base URL

En desarrollo:

```txt
http://localhost:3001
```

Si el frontend usa proxy de Vite, puede llamar directo a `/api/...`.

## Autenticacion

### Registrar usuario

```http
POST /api/auth/register
Content-Type: application/json
```

Body:

```json
{
  "email": "usuario@example.com",
  "password": "password123",
  "name": "Nombre opcional"
}
```

Respuesta `201`:

```json
{
  "token": "JWT_AQUI",
  "user": {
    "id": 1,
    "email": "usuario@example.com",
    "name": "Nombre opcional"
  }
}
```

Errores comunes:

```json
{ "error": "Email invalido" }
```

```json
{ "error": "La contrasena debe tener entre 8 y 128 caracteres" }
```

```json
{ "error": "Ya existe un usuario con ese email" }
```

### Login

```http
POST /api/auth/login
Content-Type: application/json
```

Body:

```json
{
  "email": "usuario@example.com",
  "password": "password123"
}
```

Respuesta `200`:

```json
{
  "token": "JWT_AQUI",
  "user": {
    "id": 1,
    "email": "usuario@example.com",
    "name": "Nombre opcional"
  }
}
```

Error de credenciales:

```json
{ "error": "Email o contrasena incorrectos" }
```

### Usuario actual

Sirve para validar si el token guardado en el frontend sigue siendo valido.

```http
GET /api/auth/me
Authorization: Bearer JWT_AQUI
```

Respuesta `200`:

```json
{
  "user": {
    "id": 1,
    "email": "usuario@example.com",
    "name": "Nombre opcional"
  }
}
```

Si falta el token o expiro:

```json
{ "error": "Token requerido" }
```

```json
{ "error": "Token invalido o vencido" }
```

## Uso del token en el frontend

Guardar el `token` que devuelve `register` o `login` y mandarlo en todas las llamadas a figuritas:

```js
const token = localStorage.getItem("authToken");

const response = await fetch("/api/stickers", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

Para requests con JSON:

```js
const response = await fetch("/api/stickers/ARG-1", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ count: 2 }),
});
```

## Rutas de figuritas protegidas

Todas estas rutas requieren:

```http
Authorization: Bearer JWT_AQUI
```

### Obtener figuritas del usuario

```http
GET /api/stickers
```

Respuesta:

```json
{
  "albumId": "worldcup-2026",
  "counts": {
    "ARG-1": 2,
    "COL-7": 1
  }
}
```

### Descargar CSV de faltantes y repetidas

Usar desde la vista de perfil para los botones de descarga. Requiere token como las demas rutas.

```http
GET /api/stickers/export/missing.csv
Authorization: Bearer JWT_AQUI
```

Descarga `figuritas-faltantes-worldcup-2026.csv` con columnas:

```csv
figurita,pais
ARG-1,ARG
```

Las faltantes se calculan contra las figuritas conocidas en la base para el `ALBUM_ID` actual.

```http
GET /api/stickers/export/duplicates.csv
Authorization: Bearer JWT_AQUI
```

Descarga `figuritas-repetidas-worldcup-2026.csv` con columnas:

```csv
figurita,pais,cantidad,repetidas_disponibles
COL-7,COL,3,2
```

Ejemplo para dispararlo desde un boton del frontend:

```js
async function downloadStickerCsv(type) {
  const token = localStorage.getItem("authToken");
  const response = await fetch(`/api/stickers/export/${type}.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw new Error("No se pudo descargar el CSV");

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = type === "missing" ? "figuritas-faltantes.csv" : "figuritas-repetidas.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
```

### Ajustar una figurita

```http
POST /api/stickers/:stickerKey/adjust
Content-Type: application/json
Authorization: Bearer JWT_AQUI
```

Body:

```json
{ "delta": 1 }
```

`delta` solo puede ser `1` o `-1`.

`:stickerKey` acepta IDs simples como `00`, `1`, `638` y tambien codigos con guion como `ARG-1`.

Respuesta:

```json
{
  "stickerKey": "ARG-1",
  "count": 3
}
```

### Setear cantidad exacta

```http
PUT /api/stickers/:stickerKey
Content-Type: application/json
Authorization: Bearer JWT_AQUI
```

Body:

```json
{ "count": 2 }
```

Respuesta:

```json
{
  "stickerKey": "ARG-1",
  "count": 2
}
```

### Reemplazar todas las figuritas del usuario

```http
PUT /api/stickers
Content-Type: application/json
Authorization: Bearer JWT_AQUI
```

Body:

```json
{
  "counts": {
    "ARG-1": 2,
    "COL-7": 1
  }
}
```

Respuesta:

```json
{
  "albumId": "worldcup-2026",
  "counts": {
    "ARG-1": 2,
    "COL-7": 1
  }
}
```

### Borrar album del usuario

```http
DELETE /api/stickers
Authorization: Bearer JWT_AQUI
```

Respuesta:

```http
204 No Content
```

### Buscador rapido de pais/equipo

Devuelve resumen por prefijo de figurita. Por ejemplo, para `ARG-1`, el `countryKey` es `ARG`.

```http
GET /api/stickers/countries?q=ARG
Authorization: Bearer JWT_AQUI
```

Respuesta:

```json
{
  "albumId": "worldcup-2026",
  "countries": [
    {
      "countryKey": "ARG",
      "label": "ARG",
      "ownedStickers": 12,
      "duplicateStickers": 3,
      "duplicateCopies": 4,
      "friendDuplicateStickers": 2
    }
  ]
}
```

`friendDuplicateStickers` sirve para destacar paises donde algun amigo tiene repetidas que al usuario le faltan.

## Amigos

Todas las rutas de amigos requieren:

```http
Authorization: Bearer JWT_AQUI
```

### Buscar usuarios

Usar en la vista "Agregar amigos". Busca por email o nombre. El backend responde vacio si `q` tiene menos de 2 caracteres.

```http
GET /api/users/search?q=juan
```

Respuesta:

```json
{
  "users": [
    {
      "user": {
        "id": 2,
        "email": "juan@example.com",
        "name": "Juan"
      },
      "friendshipStatus": "none",
      "requestId": null
    }
  ]
}
```

Valores de `friendshipStatus`:

```txt
none
pending_outgoing
pending_incoming
friends
```

### Enviar solicitud de amistad

```http
POST /api/friend-requests
Content-Type: application/json
Authorization: Bearer JWT_AQUI
```

Body:

```json
{ "userId": 2 }
```

Respuesta `201`:

```json
{
  "request": {
    "id": 10,
    "status": "pending",
    "direction": "outgoing",
    "friend": {
      "id": 2,
      "email": "juan@example.com",
      "name": "Juan"
    }
  }
}
```

### Ver solicitudes pendientes

```http
GET /api/friend-requests
Authorization: Bearer JWT_AQUI
```

Respuesta:

```json
{
  "incoming": [
    {
      "id": 11,
      "status": "pending",
      "direction": "incoming",
      "friend": {
        "id": 3,
        "email": "ana@example.com",
        "name": "Ana"
      }
    }
  ],
  "outgoing": []
}
```

### Aceptar o rechazar solicitud

Solo puede aceptar o rechazar el usuario que recibio la solicitud.

```http
POST /api/friend-requests/:requestId/accept
Authorization: Bearer JWT_AQUI
```

```http
POST /api/friend-requests/:requestId/reject
Authorization: Bearer JWT_AQUI
```

Respuesta:

```json
{
  "request": {
    "id": 11,
    "status": "accepted",
    "direction": "incoming",
    "friend": {
      "id": 3,
      "email": "ana@example.com",
      "name": "Ana"
    }
  }
}
```

### Cancelar solicitud enviada

```http
DELETE /api/friend-requests/:requestId
Authorization: Bearer JWT_AQUI
```

Respuesta:

```http
204 No Content
```

### Listar amigos aceptados

```http
GET /api/friends
Authorization: Bearer JWT_AQUI
```

Respuesta:

```json
{
  "friends": [
    {
      "requestId": 11,
      "friendsSince": "2026-05-05T22:00:00.000Z",
      "user": {
        "id": 3,
        "email": "ana@example.com",
        "name": "Ana"
      }
    }
  ]
}
```

### Eliminar amigo

```http
DELETE /api/friends/:friendId
Authorization: Bearer JWT_AQUI
```

Respuesta:

```http
204 No Content
```

## Intercambio

La vista "Intercambio" debe consumir:

```http
GET /api/exchange
Authorization: Bearer JWT_AQUI
```

Respuesta:

```json
{
  "albumId": "worldcup-2026",
  "friendsCount": 2,
  "missingForMe": [
    {
      "stickerKey": "ARG-1",
      "countryKey": "ARG",
      "friends": [
        {
          "user": {
            "id": 3,
            "email": "ana@example.com",
            "name": "Ana"
          },
          "count": 3,
          "available": 2
        }
      ]
    }
  ],
  "myDuplicatesNeededByFriends": [
    {
      "stickerKey": "COL-7",
      "countryKey": "COL",
      "count": 2,
      "available": 1,
      "friends": [
        {
          "id": 2,
          "email": "juan@example.com",
          "name": "Juan"
        }
      ]
    }
  ]
}
```

`missingForMe` son figuritas que el usuario no tiene y algun amigo tiene repetidas. `myDuplicatesNeededByFriends` son repetidas del usuario que algun amigo no tiene.

### Crear propuesta de intercambio

Crea una propuesta pendiente. Todavia no descuenta ni suma figuritas; solo valida que ambos usuarios sean amigos y que, en ese momento, tengan suficientes repetidas.

`give` y `receive` aceptan varias laminas y no tienen que tener la misma cantidad. Puedes proponer, por ejemplo, entregar 3 laminas normales por 1 escudo.

```http
POST /api/exchanges
Content-Type: application/json
Authorization: Bearer JWT_AQUI
```

Body:

```json
{
  "friendId": 2,
  "give": [
    { "stickerKey": "COL-2", "quantity": 1, "friendId": 2 }
  ],
  "receive": [
    { "stickerKey": "ARG-3", "quantity": 1, "friendId": 2 }
  ]
}
```

Respuesta `201`:

```json
{
  "albumId": "worldcup-2026",
  "exchange": {
    "id": 25,
    "albumId": "worldcup-2026",
    "status": "pending",
    "direction": "outgoing",
    "participantRole": "requester",
    "awaitingUserId": 2,
    "lastOfferedByUserId": 1,
    "canRespond": false,
    "canCounter": false,
    "requester": {
      "id": 1,
      "email": "usuario@example.com",
      "name": "Nombre opcional"
    },
    "friend": {
      "id": 2,
      "email": "juan@example.com",
      "name": "Juan"
    },
    "awaitingUser": {
      "id": 2,
      "email": "juan@example.com",
      "name": "Juan"
    },
    "lastOfferedBy": {
      "id": 1,
      "email": "usuario@example.com",
      "name": "Nombre opcional"
    },
    "createdAt": "2026-05-06T22:00:00.000Z",
    "updatedAt": "2026-05-06T22:00:00.000Z",
    "respondedAt": null,
    "give": [
      { "stickerKey": "COL-2", "quantity": 1, "friendId": 2 }
    ],
    "receive": [
      { "stickerKey": "ARG-3", "quantity": 1, "friendId": 2 }
    ]
  },
  "counts": {
    "COL-2": 2
  }
}
```

`friendId` puede ir arriba para todo el intercambio o repetido en cada item. Por seguridad, cada propuesta debe ser con un solo amigo.

En las respuestas, `give` y `receive` describen la ultima oferta: `give` es lo que entrega `lastOfferedBy` y `receive` es lo que `lastOfferedBy` pide recibir.

`POST /api/exchanges/complete` sigue existiendo como alias compatible, pero ahora tambien crea una propuesta pendiente.

### Listar propuestas

```http
GET /api/exchanges?status=pending
Authorization: Bearer JWT_AQUI
```

`status` acepta `pending`, `confirmed`, `rejected`, `cancelled` o `all`. Si no se envia, usa `pending`.

Respuesta:

```json
{
  "albumId": "worldcup-2026",
  "incoming": [],
  "outgoing": [
    {
      "id": 25,
      "status": "pending",
      "direction": "outgoing",
      "awaitingUserId": 2,
      "lastOfferedByUserId": 1,
      "canRespond": false,
      "canCounter": false,
      "requester": {
        "id": 1,
        "email": "usuario@example.com",
        "name": "Nombre opcional"
      },
      "friend": {
        "id": 2,
        "email": "juan@example.com",
        "name": "Juan"
      },
      "give": [
        { "stickerKey": "COL-2", "quantity": 1, "friendId": 2 }
      ],
      "receive": [
        { "stickerKey": "ARG-3", "quantity": 1, "friendId": 2 }
      ]
    }
  ],
  "exchanges": [
    {
      "id": 25,
      "status": "pending",
      "direction": "outgoing"
    }
  ]
}
```

### Confirmar propuesta

Solo confirma quien tiene el turno de responder (`canRespond: true`). Este es el unico endpoint que mueve figuritas: descuenta las repetidas de ambos usuarios, suma lo recibido a ambos y marca el intercambio como `confirmed` en una sola transaccion.

```http
POST /api/exchanges/:exchangeId/confirm
Authorization: Bearer JWT_AQUI
```

Respuesta:

```json
{
  "albumId": "worldcup-2026",
  "exchange": {
    "id": 25,
    "status": "confirmed",
    "direction": "incoming"
  },
  "counts": {
    "ARG-3": 1,
    "COL-2": 1
  }
}
```

### Hacer contraoferta

Quien tiene el turno de responder (`canCounter: true`) puede reemplazar la propuesta con una contraoferta. Despues de esto, el otro usuario queda como `awaitingUser` y debe confirmar, rechazar o hacer otra contraoferta.

```http
POST /api/exchanges/:exchangeId/counter
Content-Type: application/json
Authorization: Bearer JWT_AQUI
```

Body:

```json
{
  "give": [
    { "stickerKey": "ARG-3", "quantity": 1 }
  ],
  "receive": [
    { "stickerKey": "COL-2", "quantity": 2 },
    { "stickerKey": "COL-5", "quantity": 1 }
  ]
}
```

En una contraoferta, `give` es lo que entrega el usuario que hace la contraoferta y `receive` es lo que pide recibir. El backend guarda esa nueva version como la ultima oferta y no mueve inventario hasta que el otro usuario confirme.

### Rechazar o cancelar propuesta

Quien tiene el turno de responder puede rechazarla:

```http
POST /api/exchanges/:exchangeId/reject
Authorization: Bearer JWT_AQUI
```

Quien hizo la ultima oferta puede cancelarla:

```http
POST /api/exchanges/:exchangeId/cancel
Authorization: Bearer JWT_AQUI
```

Errores comunes:

```json
{ "error": "Solo puedes intercambiar con amigos aceptados" }
```

```json
{ "error": "No tienes suficientes repetidas de COL-2" }
```

```json
{ "error": "El intercambio ya no esta pendiente" }
```

## Integracion sugerida en frontend

1. Crear pantallas o modal de registro y login.
2. Al recibir `token`, guardarlo en `localStorage` o estado global.
3. Mandar `Authorization: Bearer ${token}` en cada request a `/api/stickers`.
4. Al cargar la app, llamar `GET /api/auth/me` si hay token guardado.
5. Si cualquier request responde `401`, borrar el token y mostrar login.
6. En logout, borrar el token local y limpiar el estado de figuritas.
7. En el menu agregar vistas "Agregar amigos" e "Intercambio".
8. En "Agregar amigos", usar `/api/users/search`, `/api/friend-requests` y `/api/friends`.
9. En "Intercambio", usar `/api/exchange` para sugerencias y `/api/exchanges` para crear, listar, confirmar, contraofertar, rechazar o cancelar propuestas.

## Variables de entorno importantes

```env
JWT_SECRET=cambia-esto-por-una-clave-larga-y-aleatoria
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://slategray-eel-392201.hostingersite.com
```

En Hostinger configura `JWT_SECRET` en el backend. Si no existe, la API arranca con una clave temporal insegura, pero los tokens pueden dejar de servir si cambias la clave despues.

Si frontend y backend estan en dominios distintos, `CORS_ORIGIN` debe ser el origin exacto del frontend, sin slash final. Para varios frontends:

```env
CORS_ORIGIN=https://slategray-eel-392201.hostingersite.com,https://otro-frontend.com
```

## Chequeo rapido en Hostinger

Despues de redeployar el backend, abre:

```txt
https://sienna-camel-479807.hostingersite.com/api/health
```

Si responde `ok: true`, la API y MySQL estan listos.

Si responde `503` con JSON, la app ya esta levantando pero hay que revisar las variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` o `DB_NAME`.

Si el navegador muestra `ERR_HTTP2_PROTOCOL_ERROR` incluso en `/api/health`, el proceso Node no esta arrancando o Hostinger no reinstalo dependencias. En ese caso revisa que se haya ejecutado `npm install` y que esten desplegados `package.json`, `package-lock.json`, `auth.js`, `db.js` e `index.js`.
