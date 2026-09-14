# Dokploy deployment

This project is prepared as one Compose project with two application services plus PostgreSQL:

```text
Browser -> app.example.com -> frontend (Nginx)
                              /api -> backend (Express :3000)
                                           |
                                           v
                                      PostgreSQL
```

The frontend keeps using relative paths such as `/api/auth/login`. Nginx in the frontend container forwards those requests to the backend container, so no `VITE_API_URL` is needed for the same-domain deployment.

In Dokploy, deploy the repository as a Docker Compose project using `docker-compose.yml`. Compose creates and connects all three containers automatically.

## 1. Create PostgreSQL

Create a PostgreSQL service in Dokploy, or use an existing managed PostgreSQL database.

For a Dokploy PostgreSQL service:

- Attach persistent storage to `/var/lib/postgresql/data`.
- Keep the database private; it does not need a public domain.
- Record the internal hostname, database name, username, and password.

The database URL used by the backend must use the internal hostname, not `localhost`:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@POSTGRES_HOST:5432/DATABASE?schema=public"
```

## 2. Configure the Compose project

Create a Docker Compose project in Dokploy and point it at this repository. Use the existing `docker-compose.yml`.

Compose creates these services automatically:

- `db`: PostgreSQL with persistent storage
- `backend`: built from `Dockerfile.backend`, internal port `3000`
- `frontend`: built from `Dockerfile.frontend`, internal port `80`

The Compose file uses `db` as the database hostname, and the frontend Nginx configuration uses `backend` for the API proxy.

The Dockerfile runs `prisma generate`, then the container command runs:

```bash
npx prisma migrate deploy && npm run server
```

This applies existing migrations before starting Express. The admin account is created during backend startup if its email does not already exist.

Set these backend environment variables in Dokploy. Use real production values, not the local `.env` values:

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@POSTGRES_HOST:5432/DATABASE?schema=public
FRONTEND_URL=https://app.example.com
JWT_SECRET=long-random-production-secret

ADMIN_EMAIL=admin@example.com
ADMIN_NAME=Admin
ADMIN_PASSWORD=strong-production-password

WHATSAPP_VERIFY_TOKEN=random-webhook-verification-value
META_SYSTEM_TOKEN=your-meta-system-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_BUSINESS_ACCOUNT_ID=your-business-account-id
META_APP_SECRET=your-meta-app-secret
META_GRAPH_API_VERSION=v26.0
APPOINTMENT_TIMEZONE=Asia/Kolkata
```

The Compose file creates the database URL automatically from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. Set those PostgreSQL variables consistently if you change their defaults.

The frontend image builds the Vite app and serves it with Nginx. The included `nginx.conf` does two things:

- Serves the Vite files and falls back to `index.html` for client-side routes.
- Proxies `/api/*` to `http://backend:3000`.

## 3. Configure the domain

Attach the public domain to the **frontend** service on port `80`:

```text
https://app.example.com
```

Do not attach the public domain to PostgreSQL. The backend can remain private and only needs to be reachable by the frontend service and Dokploy’s internal network.

Traffic will work like this:

```text
https://app.example.com/              -> frontend:80
https://app.example.com/api/auth/...  -> frontend Nginx -> backend:3000
```

The existing frontend API calls and `EventSource('/api/events...')` continue to work because they use the same domain.

## 4. Configure WhatsApp / Meta

After HTTPS is active, set the Meta webhook URL to:

```text
https://app.example.com/api/webhooks/whatsapp
```

Use the same value configured in `WHATSAPP_VERIFY_TOKEN` when Meta asks for the verification token. Meta must be able to reach the domain publicly over HTTPS.

## 5. Deploy

1. Confirm the PostgreSQL volume is attached.
2. Set the backend environment variables in Dokploy.
3. Deploy the Compose project. Backend migrations run before Express starts.
4. Attach the domain to the frontend service on port `80`.
5. Open the domain and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
6. Configure and verify the Meta webhook.

## Troubleshooting

- `P1001` or database connection errors: check `DATABASE_URL`, especially the hostname. Do not use `localhost`.
- Nginx `502 Bad Gateway`: confirm the backend service is named `backend`, is running on port `3000`, and shares the Dokploy network.
- Login requests return `404`: confirm `/api` is reaching the frontend Nginx and that `nginx.conf` is included in the frontend image.
- Login requests return CORS errors: confirm `FRONTEND_URL` exactly matches the browser origin, including `https://` and without a trailing slash.
- Admin login fails after changing environment variables: an existing admin row is not updated automatically. The bootstrap only creates the account when that email is missing.
- Missing data after redeploy: verify PostgreSQL has a persistent volume and that the database URL still points to the same database.

Never commit `.env` or production secrets. Rotate the credentials and Meta tokens if they have been exposed.
