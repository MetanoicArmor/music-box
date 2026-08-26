import { WebSocket } from "@fastify/websocket";

type WsClient = WebSocket & { readyState?: number };

const clients = new Set<WsClient>();

export function addClient(socket: WsClient): void {
  clients.add(socket);
}

export function removeClient(socket: WsClient): void {
  clients.delete(socket);
}

export function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload });
  for (const client of clients) {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch {
        clients.delete(client);
      }
    }
  }
}

export function getActiveClientCount(): number {
  return clients.size;
}
