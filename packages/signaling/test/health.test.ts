import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('GET /health', () => {
  it('reports ok with uptime', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');

    await app.close();
  });
});

describe('GET /metrics', () => {
  it('reports session and counter metrics', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { activeSessions: number; created: number };
    expect(body.activeSessions).toBe(0);
    expect(body.created).toBe(0);

    await app.close();
  });
});
