declare module '*.mjs' {
  import type { IncomingMessage, ServerResponse } from 'node:http';
  export function localLibrary(req: IncomingMessage, res: ServerResponse): boolean;
  export function securityHeaders(production?: boolean, encoderWorker?: boolean): Record<string, string>;
}
