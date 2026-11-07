// One shared SpacetimeDB connection for every route. Use the hooks from 'spacetimedb/react'
// (useSpacetimeDB, useTable) inside pages; this file only builds the connection.
import { DbConnection } from '../module_bindings';
import { SPACETIMEDB_DB_NAME, SPACETIMEDB_HOST } from './config';

const TOKEN_KEY = `${SPACETIMEDB_HOST}/${SPACETIMEDB_DB_NAME}/auth_token`;

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function makeConnectionBuilder() {
  return DbConnection.builder()
    .withUri(SPACETIMEDB_HOST)
    .withDatabaseName(SPACETIMEDB_DB_NAME)
    .withToken(readToken())
    .withAutomaticReconnect()
    .onConnect((_conn, identity, token) => {
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        // private mode: fine, a new identity next time
      }
      console.log('SpacetimeDB connected as', identity.toHexString());
    })
    .onConnectError((_ctx, err) => console.error('SpacetimeDB connect error', err));
}

export { DbConnection };
