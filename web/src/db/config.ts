// Where the app connects. Defaults to the shared Maincloud database.
// Override locally in web/.env.development.local (gitignored), e.g. for a local `spacetime start`:
//   VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000
//   VITE_SPACETIMEDB_DB_NAME=handoff-local
export const SPACETIMEDB_HOST: string =
  import.meta.env.VITE_SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';
export const SPACETIMEDB_DB_NAME: string = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'handoff-hackutd26';
