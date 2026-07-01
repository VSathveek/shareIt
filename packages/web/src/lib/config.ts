/** Signaling server WebSocket URL. Set VITE_SIGNALING_URL in production (Vercel env). */
export const SIGNALING_URL: string =
  import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080/ws';
