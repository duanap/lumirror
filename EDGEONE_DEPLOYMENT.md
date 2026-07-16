# EdgeOne Pages Deployment

Applies to Lumirror `v1.2.4`.

## Build Settings

In EdgeOne Pages, import the repository and configure:

```text
Framework: Vite
Root directory: ./
Install command: npm ci
Build command: npm run build
Output directory: dist
Node.js: 22.11.0
```

The EdgeOne Function entry is `edge-functions/api/[[default]].js`. Do not configure `EVALUATION_KV` as a plain text environment variable.

## KV Binding

Create or select a KV namespace, then bind it to the Pages project's Functions runtime using exactly this binding name:

```text
EVALUATION_KV
```

The binding must be applied to the production environment. A missing or invalid binding now returns `KV_NOT_BOUND`, `KV_READ_FAILED`, or `KV_WRITE_FAILED` instead of a generic login error.

## Functions Environment Variables

Configure the following values in the Functions runtime for production:

```env
APP_ENV=production
INITIAL_ADMIN_PASSWORD=<temporary strong first-login password>
ADMIN_TOKEN_SECRET=<unique random secret, 32+ characters>
PUBLIC_TOKEN_SECRET=<different unique random secret, 32+ characters>
ALLOWED_ORIGINS=https://your-domain.example
SESSION_COOKIE_SECURE=true
ADMIN_SESSION_SECONDS=28800
PUBLIC_SESSION_SECONDS=7200
```

`INITIAL_ADMIN_PASSWORD` is needed only until the first database bootstrap succeeds. Do not commit real values to this repository.

## Verify Deployment

After redeploying, open:

```text
https://your-domain.example/api/health
```

The response must report `ready: true`, `kvBound: true`, and `kvReadable: true`. Before the first login, `databasePresent` may be `false`; `bootstrapReady` must still be `true` because `INITIAL_ADMIN_PASSWORD` is configured.

If login fails, use the returned error code to fix the corresponding binding or environment variable, then redeploy Functions.
