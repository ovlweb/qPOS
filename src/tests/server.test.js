import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import PaymentTerminalServer from '../server.js';
import Database from '../database/database.js';

describe('Payment Terminal Server', () => {
  let server;
  let db;

  beforeAll(async () => {
    // Use in-memory database for testing
    db = new Database(':memory:');
    await db.initialize();
    
    server = new PaymentTerminalServer();
    server.db = db; // Override with test database
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  it('should create server instance', () => {
    expect(server).toBeDefined();
    expect(server.app).toBeDefined();
    expect(server.wss).toBeDefined();
  });

  it('should have required routes configured', () => {
    const routes = server.app._router.stack.map(layer => layer.regexp.source);
    
    // Check if API routes are configured
    expect(routes.some(route => route.includes('terminals'))).toBe(true);
    expect(routes.some(route => route.includes('payments'))).toBe(true);
    expect(routes.some(route => route.includes('qr'))).toBe(true);
  });

  it('should handle WebSocket message correctly', async () => {
    // Create a test terminal in the database first
    const { Terminal } = await import('../models/index.js');
    await Terminal.create(db, {
      id: 'T001',
      name: 'Test Terminal',
      operator: 'Test Operator',
      status: 'active'
    });

    const mockWs = {
      send: vi.fn()
    };

    const testMessage = {
      type: 'terminal_ready',
      terminalId: 'T001'
    };

    await server.handleWebSocketMessage(mockWs, testMessage);
    
    expect(server.clients.has('T001')).toBe(true);
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"terminal_config"')
    );
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"terminalId":"T001"')
    );
    expect(mockWs.send).toHaveBeenCalledWith(
      expect.stringContaining('"status":"connected"')
    );
  });
});