import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

// Runtime configuration stays on the server. Never print dotenv values or request contents.
dotenv.config({ quiet: true });
const directory = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === 'production' || directory.endsWith(`${path.sep}dist${path.sep}server`);
const config = { ...loadConfig(), production, clientPath: production ? path.resolve(directory, '../client') : path.resolve('dist/client') };
const app = createApp({ config });
// PORT in a production .env must not make the development API collide with Vite.
const port = Number(production ? process.env.PORT || 3000 : process.env.API_PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => { console.info(`CoFounder server listening on port ${port}`); });
const shutdown = () => { server.close(() => { app.locals.close(); process.exit(0); }); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
