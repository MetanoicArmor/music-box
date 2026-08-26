declare module "httpolyglot" {
  import type { Server } from "node:http";

  export function createServer(
    tlsconfig: { key: Buffer | string; cert: Buffer | string },
    requestListener?: (...args: unknown[]) => void
  ): Server;
}
