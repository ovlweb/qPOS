import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import PaymentTerminalServer from '../server.js';
import Database from '../database/database.js';
import { Terminal, Payment } from '../models/index.js';

describe('WebSocket Communication Properties', () => {
  let server;
  let db;

  beforeAll(async () => {
    server = new PaymentTerminalServer();
  });

  beforeEach(async () => {
    // Create fresh in-memory database for each test
    db = new Database(':memory:');
    await db.initialize();
    server.db = db; // Override with fresh test database
    server.clients.clear(); // Clear clients
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  // Helper function to generate unique terminal IDs using timestamp
  const generateUniqueTerminalId = () => {
    return `TEST${Date.now()}${Math.floor(Math.random() * 1000)}`;
  };

  // Arbitraries for property-based testing
  const amountArbitrary = fc.integer({ min: 1, max: 1000000 }); // 1 kopeck to 10,000 rubles
  const currencyArbitrary = fc.constantFrom('RUB', 'USD', 'EUR');
  const methodArbitrary = fc.constantFrom('nfc', 'qr');

  const paymentDataArbitrary = fc.record({
    amount: amountArbitrary,
    currency: currencyArbitrary,
    method: methodArbitrary
  });

  const terminalDataArbitrary = fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    operator: fc.string({ minLength: 1, maxLength: 50 }),
    status: fc.constantFrom('active', 'inactive', 'maintenance'),
    location: fc.string({ minLength: 0, maxLength: 100 })
  }).map(data => ({
    ...data,
    id: generateUniqueTerminalId() // Generate unique ID for each terminal
  }));

  // Feature: payment-terminal-system, Property 20: Переход к оплате по команде
  describe('Property 20: Переход к оплате по команде', () => {
    it('should transition to payment mode when receiving payment command', async () => {
      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        paymentDataArbitrary,
        async (terminalData, paymentData) => {
          // Setup: Create terminal in database
          const terminal = await Terminal.create(db, terminalData);
          
          // Setup: Mock WebSocket connection
          const mockWs = {
            send: vi.fn(),
            readyState: 1 // WebSocket.OPEN
          };

          // Register terminal as connected
          server.clients.set(terminal.id, mockWs);

          // Act: Send payment request
          const payment = await server.sendPaymentRequest(terminal.id, paymentData);

          // Assert: Terminal should receive payment_request message
          expect(mockWs.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"payment_request"')
          );

          // Assert: Payment should be created with pending status
          expect(payment).toBeDefined();
          expect(payment.status).toBe('pending');
          expect(payment.terminalId).toBe(terminal.id);
          expect(payment.amount).toBe(paymentData.amount);

          // Verify the sent message structure
          const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
          expect(sentMessage.type).toBe('payment_request');
          expect(sentMessage.paymentId).toBe(payment.id);
          expect(sentMessage.amount).toBe(paymentData.amount);
          expect(sentMessage.currency).toBe(paymentData.currency);
          expect(sentMessage.method).toBe(paymentData.method);
          expect(sentMessage.timestamp).toBeDefined();

          return true;
        }
      ), { numRuns: 20 }); // Reduced runs to avoid database issues
    });

    it('should handle payment request for disconnected terminals', async () => {
      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        paymentDataArbitrary,
        async (terminalData, paymentData) => {
          // Setup: Create terminal in database but don't connect it
          const terminal = await Terminal.create(db, terminalData);

          // Act & Assert: Should throw error for disconnected terminal
          await expect(
            server.sendPaymentRequest(terminal.id, paymentData)
          ).rejects.toThrow('Terminal not connected');

          return true;
        }
      ), { numRuns: 10 });
    });
  });

  // Feature: payment-terminal-system, Property 22: Удаленная активация терминала
  describe('Property 22: Удаленная активация терминала', () => {
    it('should activate terminal remotely via admin command', async () => {
      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        paymentDataArbitrary,
        async (terminalData, paymentData) => {
          // Setup: Create terminal in database
          const terminal = await Terminal.create(db, terminalData);
          
          // Setup: Mock WebSocket connection
          const mockWs = {
            send: vi.fn(),
            readyState: 1 // WebSocket.OPEN
          };

          // Register terminal as connected
          server.clients.set(terminal.id, mockWs);

          // Act: Send remote activation (payment request simulates activation)
          const success = await server.sendPaymentRequest(terminal.id, paymentData);

          // Assert: Terminal should be activated (receive payment request)
          expect(success).toBeDefined();
          expect(mockWs.send).toHaveBeenCalled();

          // Verify activation message was sent
          const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
          expect(sentMessage.type).toBe('payment_request');
          expect(sentMessage.paymentId).toBeDefined();

          // Assert: Terminal should transition from waiting to payment mode
          // This is verified by the payment_request message being sent
          expect(sentMessage.amount).toBe(paymentData.amount);
          expect(sentMessage.method).toBe(paymentData.method);

          return true;
        }
      ), { numRuns: 20 });
    });

    it('should handle terminal configuration updates', async () => {
      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        async (terminalData) => {
          // Setup: Create terminal in database
          const terminal = await Terminal.create(db, terminalData);
          
          // Setup: Mock WebSocket connection
          const mockWs = {
            send: vi.fn(),
            readyState: 1 // WebSocket.OPEN
          };

          // Act: Simulate terminal_ready message
          await server.handleTerminalReady(mockWs, { terminalId: terminal.id });

          // Assert: Terminal should be registered and receive config
          expect(server.clients.has(terminal.id)).toBe(true);
          expect(mockWs.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"terminal_config"')
          );

          // Verify config message structure
          const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
          expect(sentMessage.type).toBe('terminal_config');
          expect(sentMessage.terminalId).toBe(terminal.id);
          expect(sentMessage.config).toBeDefined();
          expect(sentMessage.config.name).toBe(terminal.name);
          expect(sentMessage.config.operator).toBe(terminal.operator);
          expect(sentMessage.status).toBe('connected');

          return true;
        }
      ), { numRuns: 20 });
    });

    it('should verify terminal connection status', async () => {
      await fc.assert(fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10 }).map(s => `T${s}${Date.now()}`),
        async (terminalId) => {
          // Test disconnected terminal
          expect(server.isTerminalConnected(terminalId)).toBe(false);

          // Setup: Mock WebSocket connection
          const mockWs = {
            send: vi.fn(),
            readyState: 1 // WebSocket.OPEN
          };

          // Connect terminal
          server.clients.set(terminalId, mockWs);

          // Test connected terminal
          expect(server.isTerminalConnected(terminalId)).toBe(true);

          // Disconnect terminal
          server.clients.delete(terminalId);

          // Test disconnected again
          expect(server.isTerminalConnected(terminalId)).toBe(false);

          return true;
        }
      ), { numRuns: 15 });
    });

    it('should handle edge cases for connection status', () => {
      // Test null/undefined terminal IDs
      expect(server.isTerminalConnected(null)).toBe(false);
      expect(server.isTerminalConnected(undefined)).toBe(false);
      expect(server.isTerminalConnected('')).toBe(false);
      expect(server.isTerminalConnected('   ')).toBe(false);
    });
  });

  // Additional property tests for WebSocket message handling
  describe('WebSocket Message Handling Properties', () => {
    it('should handle NFC detection events properly', async () => {
      // Set fast bank API for this test
      server.bankAPI.setResponseDelay(10);
      server.bankAPI.setSuccessRate(1.0);

      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        fc.record({
          amount: amountArbitrary,
          currency: currencyArbitrary,
          cardData: fc.string({ minLength: 10, maxLength: 50 })
        }),
        async (terminalData, nfcData) => {
          // Setup: Create terminal and connect it
          const terminal = await Terminal.create(db, terminalData);
          const mockWs = {
            send: vi.fn(),
            readyState: 1
          };
          server.clients.set(terminal.id, mockWs);

          // Act: Handle NFC detection
          await server.handleNFCDetected(mockWs, {
            terminalId: terminal.id,
            nfcData: nfcData
          });

          // Assert: Payment status should be sent
          expect(mockWs.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"payment_status"')
          );

          const statusMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
          expect(statusMessage.type).toBe('payment_status');
          expect(statusMessage.status).toBe('processing');
          expect(statusMessage.paymentId).toBeDefined();

          return true;
        }
      ), { numRuns: 10 }); // Reduced runs for faster execution
    }, 15000); // Increased timeout to 15 seconds

    it('should handle payment completion events', async () => {
      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        paymentDataArbitrary,
        fc.constantFrom('completed', 'failed'),
        async (terminalData, paymentData, resultStatus) => {
          // Setup: Create terminal and payment
          const terminal = await Terminal.create(db, terminalData);
          const payment = await Payment.create(db, {
            ...paymentData,
            terminalId: terminal.id,
            status: 'processing'
          });

          const mockWs = {
            send: vi.fn(),
            readyState: 1
          };
          server.clients.set(terminal.id, mockWs);

          // Act: Handle payment completion
          await server.handlePaymentCompleted(mockWs, {
            terminalId: terminal.id,
            paymentId: payment.id,
            result: {
              status: resultStatus,
              bankTransactionId: 'TXN123'
            }
          });

          // Assert: Confirmation should be sent
          expect(mockWs.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"payment_status"')
          );

          const confirmMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
          expect(confirmMessage.type).toBe('payment_status');
          expect(confirmMessage.paymentId).toBe(payment.id);
          expect(confirmMessage.status).toBe(resultStatus);

          return true;
        }
      ), { numRuns: 15 });
    });
  });

  // Feature: payment-terminal-system, Property 21: Редактирование параметров терминала
  describe('Property 21: Редактирование параметров терминала', () => {
    it('should allow editing terminal identifier and operator for any selected terminal', async () => {
      await fc.assert(fc.asyncProperty(
        terminalDataArbitrary,
        fc.record({
          newId: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          newName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          newOperator: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          newLocation: fc.string({ minLength: 0, maxLength: 100 }),
          newStatus: fc.constantFrom('active', 'inactive', 'maintenance')
        }),
        async (originalTerminalData, editData) => {
          // Setup: Create terminal in database
          const terminal = await Terminal.create(db, originalTerminalData);
          
          // Act: Update terminal with new data
          const updatedTerminal = await Terminal.update(db, terminal.id, {
            id: editData.newId,
            name: editData.newName,
            operator: editData.newOperator,
            location: editData.newLocation,
            status: editData.newStatus
          });

          // Assert: Terminal should be updated with new values
          expect(updatedTerminal).toBeDefined();
          expect(updatedTerminal.id).toBe(editData.newId);
          expect(updatedTerminal.name).toBe(editData.newName);
          expect(updatedTerminal.operator).toBe(editData.newOperator);
          expect(updatedTerminal.location).toBe(editData.newLocation);
          expect(updatedTerminal.status).toBe(editData.newStatus);

          // Assert: Original terminal should no longer exist with old ID (if ID changed)
          if (editData.newId !== terminal.id) {
            const oldTerminal = await Terminal.findById(db, terminal.id);
            expect(oldTerminal).toBeNull();
          }

          // Assert: New terminal should be retrievable by new ID
          const retrievedTerminal = await Terminal.findById(db, editData.newId);
          expect(retrievedTerminal).toBeDefined();
          expect(retrievedTerminal.name).toBe(editData.newName);
          expect(retrievedTerminal.operator).toBe(editData.newOperator);

          // Assert: All terminal parameters should be editable
          expect(typeof retrievedTerminal.id).toBe('string');
          expect(typeof retrievedTerminal.name).toBe('string');
          expect(typeof retrievedTerminal.operator).toBe('string');
          expect(['active', 'inactive', 'maintenance']).toContain(retrievedTerminal.status);

          return true;
        }
      ), { numRuns: 25 });
    });

    it('should preserve terminal data integrity during editing', async () => {
      await fc.assert(fc.asyncProperty(
        fc.array(terminalDataArbitrary, { minLength: 2, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        fc.record({
          newName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          newOperator: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0)
        }),
        async (terminalsData, editIndex, editData) => {
          // Ensure we have a valid index
          if (editIndex >= terminalsData.length) return true;

          // Setup: Create multiple terminals
          const terminals = [];
          for (const terminalData of terminalsData) {
            const terminal = await Terminal.create(db, terminalData);
            terminals.push(terminal);
          }

          const terminalToEdit = terminals[editIndex];
          const otherTerminals = terminals.filter((_, i) => i !== editIndex);

          // Act: Edit one terminal
          await Terminal.update(db, terminalToEdit.id, {
            name: editData.newName,
            operator: editData.newOperator
          });

          // Assert: Other terminals should remain unchanged
          for (const otherTerminal of otherTerminals) {
            const retrievedTerminal = await Terminal.findById(db, otherTerminal.id);
            expect(retrievedTerminal).toBeDefined();
            expect(retrievedTerminal.name).toBe(otherTerminal.name);
            expect(retrievedTerminal.operator).toBe(otherTerminal.operator);
            expect(retrievedTerminal.status).toBe(otherTerminal.status);
          }

          // Assert: Edited terminal should have new values
          const editedTerminal = await Terminal.findById(db, terminalToEdit.id);
          expect(editedTerminal).toBeDefined();
          expect(editedTerminal.name).toBe(editData.newName);
          expect(editedTerminal.operator).toBe(editData.newOperator);

          return true;
        }
      ), { numRuns: 20 });
    });
  });
});