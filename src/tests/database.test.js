import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from '../database/database.js';

describe('Database', () => {
  let db;

  beforeEach(async () => {
    // Use in-memory database for testing
    db = new Database(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  it('should initialize database with tables', async () => {
    // Check if tables exist by trying to query them
    const terminals = await db.all('SELECT * FROM terminals');
    const payments = await db.all('SELECT * FROM payments');
    const qrCodes = await db.all('SELECT * FROM qr_codes');

    expect(terminals).toEqual([]);
    expect(payments).toEqual([]);
    expect(qrCodes).toEqual([]);
  });

  it('should insert and retrieve terminal data', async () => {
    const terminalData = {
      id: 'T001',
      name: 'Test Terminal',
      operator: 'Test Operator',
      status: 'active',
      location: 'Test Location'
    };

    await db.run(
      'INSERT INTO terminals (id, name, operator, status, location) VALUES (?, ?, ?, ?, ?)',
      [terminalData.id, terminalData.name, terminalData.operator, terminalData.status, terminalData.location]
    );

    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalData.id]);
    
    expect(terminal.id).toBe(terminalData.id);
    expect(terminal.name).toBe(terminalData.name);
    expect(terminal.operator).toBe(terminalData.operator);
    expect(terminal.status).toBe(terminalData.status);
    expect(terminal.location).toBe(terminalData.location);
  });

  it('should insert and retrieve payment data', async () => {
    // First insert a terminal
    await db.run(
      'INSERT INTO terminals (id, name, operator) VALUES (?, ?, ?)',
      ['T001', 'Test Terminal', 'Test Operator']
    );

    const paymentData = {
      id: 'pay_123',
      terminal_id: 'T001',
      amount: 10000,
      currency: 'RUB',
      method: 'nfc',
      status: 'pending'
    };

    await db.run(
      'INSERT INTO payments (id, terminal_id, amount, currency, method, status) VALUES (?, ?, ?, ?, ?, ?)',
      [paymentData.id, paymentData.terminal_id, paymentData.amount, paymentData.currency, paymentData.method, paymentData.status]
    );

    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [paymentData.id]);
    
    expect(payment.id).toBe(paymentData.id);
    expect(payment.terminal_id).toBe(paymentData.terminal_id);
    expect(payment.amount).toBe(paymentData.amount);
    expect(payment.currency).toBe(paymentData.currency);
    expect(payment.method).toBe(paymentData.method);
    expect(payment.status).toBe(paymentData.status);
  });
});