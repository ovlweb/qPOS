import { describe, it, expect } from 'vitest';
import PaymentTerminalServer from '../server.js';
import Database from '../database/database.js';

describe('Basic Setup', () => {
  it('should create server instance with all components', () => {
    const server = new PaymentTerminalServer();
    
    expect(server).toBeDefined();
    expect(server.app).toBeDefined();
    expect(server.wss).toBeDefined();
    expect(server.db).toBeDefined();
    expect(server.clients).toBeDefined();
  });

  it('should create database instance', () => {
    const db = new Database(':memory:');
    
    expect(db).toBeDefined();
    expect(db.dbPath).toBe(':memory:');
  });

  it('should have required middleware configured', () => {
    const server = new PaymentTerminalServer();
    
    // Check if Express app is configured
    expect(server.app._router).toBeDefined();
  });
});