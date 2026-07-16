# Repository Guidelines

## Project Structure & Module Organization

Lumirror is a Vue 3 + TypeScript + Vite app with an EdgeOne Functions backend.

- `src/` contains the frontend application.
- `src/views/public/` contains public invite and evaluation flows.
- `src/views/admin/` contains the admin console pages.
- `src/components/`, `src/layouts/`, `src/lib/`, and `src/styles/` hold shared UI, layout, helpers, and global styles.
- `edge-functions/api/[[default]].js` is the EdgeOne API entrypoint.
- `scripts/` contains local API and smoke-test utilities.
- `public/` contains static assets and routing files.
- `dist/` is generated output and should not be edited directly.

## Build, Test, and Development Commands

Run commands from the repository root:

- `npm run dev`: start the Vite dev server on `127.0.0.1`.
- `npm run dev:api`: start the local API shim from `scripts/local-api.mjs`.
- `npm run check:functions`: syntax-check the EdgeOne function file.
- `npm run test:api`: run API smoke tests for auth, invites, tasks, scoring, and deletion flows.
- `npm run build`: run `vue-tsc --noEmit` and build production assets.
- `npm run preview`: preview the built frontend.

## Coding Style & Naming Conventions

Use TypeScript for frontend code and keep Vue files in `<script setup lang="ts">` style. Prefer existing helper modules in `src/lib/` before adding new utilities. Use two-space indentation in Vue, TypeScript, JavaScript, JSON, and Markdown files. Name Vue components in PascalCase, route views by feature name, and helper files in lower camel or short descriptive names such as `batch.ts` and `columns.ts`.

Keep backend changes scoped inside `edge-functions/api/[[default]].js` unless a new script is clearly needed.

## Testing Guidelines

There is no separate unit-test framework configured. Treat `npm run test:api`, `npm run check:functions`, and `npm run build` as the required validation set before packaging or deployment. Update `scripts/api-smoke.mjs` when API behavior intentionally changes, especially around invitation links, scoring, deletion, or RBAC.

## Commit & Pull Request Guidelines

No local Git history was available in this environment. Use concise imperative commit messages, for example `Fix invite code display` or `Add dashboard team grouping`. Pull requests should include a short summary, validation commands run, screenshots for visible admin/public UI changes, and notes for EdgeOne deployment or data migration risks.

## Deployment & Packaging Notes

For EdgeOne upload packages, include source/config files only: `src`, `public`, `edge-functions`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, and `edgeone.json`. Exclude `node_modules`, `dist`, `.git`, `.codex`, `.agents`, docs, scripts unless specifically required, and old zip files. Package names should follow `Lumirror-v<version>.zip`.
