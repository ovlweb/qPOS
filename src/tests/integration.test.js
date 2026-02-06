import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import PaymentTerminalServer from '../server.js';
import Database from '../database/database.js';
import request from 'supertest';

// Integration tests for the complete payment terminal system
describe('Payment Terminal System Integration Tests', () => {
  let server;
  let db;
  let app;
  let testTerminalId;

  beforeAll(async () => {
    // Initialize test database
    db = new Database(':memory:');
    await db.initialize();

    // Create test server instance (without starting HTTP server)
    server = new PaymentTerminalServer();
    server.db = db; // Use test database
    app = server.app; // Get Express app for supertest

    // Create test terminal
    const terminalResponse = await request(app)
      .post('/api/terminals')
      .send({
        name: 'Test Terminal',
        operator: 'Test Operator',
        location: 'Test Location'
      });
    
    testTerminalId = terminalResponse.body.id;
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('API Integration Tests', () => {
    test('should handle complete terminal management workflow', async () => {
      // Step 1: Admin loads terminals list
      const terminalsResponse = await request(app).get('/api/terminals');
      expect(terminalsResponse.status).toBe(200);
      
      const terminals = terminalsResponse.body;
      expect(Array.isArray(terminals)).toBe(true);
      
      const testTerminal = terminals.find(t => t.id === testTerminalId);
      expect(testTerminal).toBeDefined();
      expect(testTerminal.name).toBe('Test Terminal');

      // Step 2: Check terminal connection status (should be disconnected initially)
      const statusResponse = await request(app).get(`/api/terminals/${testTerminalId}/status`);
      expect(statusResponse.status).toBe(200);
      
      const status = statusResponse.body;
      expect(status.terminalId).toBe(testTerminalId);
      expect(status.connected).toBe(false); // No WebSocket connection

      // Step 3: Admin updates terminal information
      const updateResponse = await request(app)
        .put(`/api/terminals/${testTerminalId}`)
        .send({
          name: 'Updated Test Terminal',
          operator: 'Updated Operator',
          location: 'Updated Location',
          status: 'active'
        });

      expect(updateResponse.status).toBe(200);
      const updatedTerminal = updateResponse.body;
      expect(updatedTerminal.name).toBe('Updated Test Terminal');
      expect(updatedTerminal.operator).toBe('Updated Operator');

      // Step 4: Verify terminal update persisted
      const finalTerminalResponse = await request(app).get(`/api/terminals/${testTerminalId}`);
      const finalTerminal = finalTerminalResponse.body;
      expect(finalTerminal.name).toBe('Updated Test Terminal');
    });

    test('should handle QR payment generation and processing', async () => {
      // Step 1: Generate QR code for payment
      const qrResponse = await request(app)
        .post('/api/qr/generate')
        .send({
          terminalId: testTerminalId,
          amount: 3000, // 30.00 RUB
          currency: 'RUB'
        });

      expect(qrResponse.status).toBe(200);
      const qrResult = qrResponse.body;
      expect(qrResult.success).toBe(true);
      expect(qrResult.qrCode).toBeDefined();
      expect(qrResult.paymentId).toBeDefined();

      // Step 2: Verify QR code data
      expect(qrResult.data.amount).toBe(3000);
      expect(qrResult.data.terminalId).toBe(testTerminalId);
      expect(qrResult.data.paymentId).toBe(qrResult.paymentId);

      // Step 3: Verify payment is created in database
      const payment = await db.get('SELECT * FROM payments WHERE id = ?', [qrResult.paymentId]);
      expect(payment).toBeDefined();
      expect(payment.status).toBe('pending');
      expect(payment.method).toBe('qr');

      // Step 4: Simulate QR payment processing (customer scans and pays)
      const processResponse = await request(app)
        .post('/api/qr/process')
        .send({
          qrId: qrResult.id,
          paymentConfirmation: {
            customerPhone: '+7900123456',
            bankApp: 'TestBank'
          }
        });

      expect(processResponse.status).toBe(200);
      const processResult = processResponse.body;

      // Step 5: Verify payment completion or failure
      if (processResult.success) {
        expect(processResult.payment.status).toBe('completed');
        expect(processResult.payment.amount).toBe(3000);
        expect(processResult.payment.transactionId).toBeDefined();
      } else {
        // Payment failed - verify error handling
        expect(processResult.error).toBeDefined();
        expect(processResult.payment.status).toBe('failed');
      }

      // Step 6: Verify final payment state in database
      const finalPayment = await db.get('SELECT * FROM payments WHERE id = ?', [qrResult.paymentId]);
      expect(['completed', 'failed']).toContain(finalPayment.status);
      
      if (finalPayment.status === 'completed') {
        expect(finalPayment.bank_transaction_id).toBeDefined();
        expect(finalPayment.completed_at).toBeDefined();
      }
    });

    test('should handle payment processing workflow', async () => {
      // Step 1: Initiate a payment
      const initiateResponse = await request(app)
        .post('/api/payments/initiate')
        .send({
          terminalId: testTerminalId,
          amount: 2500,
          currency: 'RUB',
          method: 'nfc'
        });

      expect(initiateResponse.status).toBe(201);
      const payment = initiateResponse.body;
      expect(payment.status).toBe('pending');
      expect(payment.amount).toBe(2500);

      // Step 2: Process the payment
      const processResponse = await request(app)
        .post('/api/payments/process')
        .send({
          paymentId: payment.id,
          cardData: {
            cardNumber: '**** **** **** 1234',
            cardType: 'visa'
          }
        });

      expect([200, 402, 500]).toContain(processResponse.status);
      const processResult = processResponse.body;

      // Step 3: Verify payment result
      if (processResponse.status === 200) {
        // Payment successful
        expect(processResult.status).toBe('completed');
        expect(processResult.bank_transaction_id).toBeDefined();
      } else {
        // Payment failed
        expect(['failed']).toContain(processResult.status);
        expect(processResult.error_code).toBeDefined();
      }

      // Step 4: Verify payment status via GET endpoint
      const statusResponse = await request(app).get(`/api/payments/${payment.id}`);
      expect(statusResponse.status).toBe(200);
      const finalStatus = statusResponse.body;
      expect(['completed', 'failed']).toContain(finalStatus.status);
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle invalid terminal operations', async () => {
      const nonExistentTerminalId = 'T999';

      // Test 1: Try to get status of non-existent terminal
      const statusResponse = await request(app).get(`/api/terminals/${nonExistentTerminalId}/status`);
      expect(statusResponse.status).toBe(404);

      // Test 2: Try to activate non-existent terminal
      const activationResponse = await request(app)
        .post(`/api/terminals/${nonExistentTerminalId}/activate`)
        .send({
          amount: 1000,
          currency: 'RUB'
        });
      expect(activationResponse.status).toBe(404);

      // Test 3: Try to update non-existent terminal
      const updateResponse = await request(app)
        .put(`/api/terminals/${nonExistentTerminalId}`)
        .send({
          name: 'Updated Name'
        });
      expect(updateResponse.status).toBe(404);
    });

    test('should handle invalid payment operations', async () => {
      // Test 1: Try to process non-existent payment
      const processResponse = await request(app)
        .post('/api/payments/process')
        .send({
          paymentId: 'non-existent-id',
          cardData: {}
        });
      expect(processResponse.status).toBe(404);

      // Test 2: Try to get non-existent payment
      const getResponse = await request(app).get('/api/payments/non-existent-id');
      expect(getResponse.status).toBe(404);

      // Test 3: Try to generate QR for non-existent terminal
      const qrResponse = await request(app)
        .post('/api/qr/generate')
        .send({
          terminalId: 'T999',
          amount: 1000
        });
      expect(qrResponse.status).toBe(404);
    });
  });

  describe('System Health and Monitoring', () => {
    test('should provide system health endpoint', async () => {
      const healthResponse = await request(app).get('/health');
      expect(healthResponse.status).toBe(200);
      
      const health = healthResponse.body;
      expect(health.status).toBe('ok');
      expect(health.timestamp).toBeDefined();
    });

    test('should handle terminal CRUD operations', async () => {
      // Create a new terminal
      const createResponse = await request(app)
        .post('/api/terminals')
        .send({
          name: 'CRUD Test Terminal',
          operator: 'Test Operator',
          location: 'Test Location'
        });

      expect(createResponse.status).toBe(201);
      const newTerminal = createResponse.body;
      expect(newTerminal.name).toBe('CRUD Test Terminal');

      // Read the terminal
      const readResponse = await request(app).get(`/api/terminals/${newTerminal.id}`);
      expect(readResponse.status).toBe(200);
      expect(readResponse.body.name).toBe('CRUD Test Terminal');

      // Update the terminal
      const updateResponse = await request(app)
        .put(`/api/terminals/${newTerminal.id}`)
        .send({
          name: 'Updated CRUD Terminal',
          status: 'maintenance'
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.name).toBe('Updated CRUD Terminal');
      expect(updateResponse.body.status).toBe('maintenance');

      // Delete the terminal
      const deleteResponse = await request(app).delete(`/api/terminals/${newTerminal.id}`);
      expect(deleteResponse.status).toBe(204);

      // Verify deletion
      const verifyResponse = await request(app).get(`/api/terminals/${newTerminal.id}`);
      expect(verifyResponse.status).toBe(404);
    });

    test('should handle payment listing and filtering', async () => {
      // Create multiple payments
      const payment1 = await request(app)
        .post('/api/payments/initiate')
        .send({
          terminalId: testTerminalId,
          amount: 1000,
          method: 'nfc'
        });

      const payment2 = await request(app)
        .post('/api/payments/initiate')
        .send({
          terminalId: testTerminalId,
          amount: 2000,
          method: 'qr'
        });

      // Get all payments
      const allPaymentsResponse = await request(app).get('/api/payments');
      expect(allPaymentsResponse.status).toBe(200);
      const allPayments = allPaymentsResponse.body;
      expect(Array.isArray(allPayments)).toBe(true);
      expect(allPayments.length).toBeGreaterThanOrEqual(2);

      // Filter by terminal
      const terminalPaymentsResponse = await request(app)
        .get(`/api/payments?terminalId=${testTerminalId}`);
      expect(terminalPaymentsResponse.status).toBe(200);
      const terminalPayments = terminalPaymentsResponse.body;
      expect(Array.isArray(terminalPayments)).toBe(true);
      
      // All payments should belong to the test terminal
      terminalPayments.forEach(payment => {
        expect(payment.terminal_id).toBe(testTerminalId);
      });

      // Filter by status
      const pendingPaymentsResponse = await request(app)
        .get('/api/payments?status=pending');
      expect(pendingPaymentsResponse.status).toBe(200);
      const pendingPayments = pendingPaymentsResponse.body;
      expect(Array.isArray(pendingPayments)).toBe(true);
      
      // All payments should be pending
      pendingPayments.forEach(payment => {
        expect(payment.status).toBe('pending');
      });
    });
  });

  describe('Component Integration Verification', () => {
    test('should verify all system components are properly connected', async () => {
      // Test 1: Database integration
      const terminals = await db.all('SELECT * FROM terminals');
      expect(Array.isArray(terminals)).toBe(true);

      // Test 2: API routes integration
      const routesResponse = await request(app).get('/api/terminals');
      expect(routesResponse.status).toBe(200);

      // Test 3: Static file serving
      const adminResponse = await request(app).get('/admin');
      expect(adminResponse.status).toBe(200);
      expect(adminResponse.headers['content-type']).toContain('text/html');

      // Test 4: Terminal interface serving
      const terminalResponse = await request(app).get(`/terminal/${testTerminalId}`);
      expect(terminalResponse.status).toBe(200);
      expect(terminalResponse.headers['content-type']).toContain('text/html');

      // Test 5: Root redirect
      const rootResponse = await request(app).get('/');
      expect([200, 302]).toContain(rootResponse.status);

      // Test 6: Health check
      const healthResponse = await request(app).get('/health');
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body.status).toBe('ok');
    });

    test('should verify data flow between components', async () => {
      // Step 1: Create terminal via API
      const createResponse = await request(app)
        .post('/api/terminals')
        .send({
          name: 'Data Flow Test Terminal',
          operator: 'Test Operator'
        });

      const terminal = createResponse.body;
      expect(terminal.id).toBeDefined();

      // Step 2: Verify terminal exists in database
      const dbTerminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminal.id]);
      expect(dbTerminal).toBeDefined();
      expect(dbTerminal.name).toBe('Data Flow Test Terminal');

      // Step 3: Generate QR payment for terminal
      const qrResponse = await request(app)
        .post('/api/qr/generate')
        .send({
          terminalId: terminal.id,
          amount: 1500
        });

      const qrResult = qrResponse.body;
      expect(qrResult.success).toBe(true);

      // Step 4: Verify payment and QR code in database
      const dbPayment = await db.get('SELECT * FROM payments WHERE id = ?', [qrResult.paymentId]);
      expect(dbPayment).toBeDefined();
      expect(dbPayment.terminal_id).toBe(terminal.id);

      const dbQR = await db.get('SELECT * FROM qr_codes WHERE id = ?', [qrResult.id]);
      expect(dbQR).toBeDefined();
      expect(dbQR.payment_id).toBe(qrResult.paymentId);

      // Step 5: Process QR payment
      const processResponse = await request(app)
        .post('/api/qr/process')
        .send({
          qrId: qrResult.id
        });

      expect(processResponse.status).toBe(200);

      // Step 6: Verify payment status updated in database
      const finalPayment = await db.get('SELECT * FROM payments WHERE id = ?', [qrResult.paymentId]);
      expect(['completed', 'failed']).toContain(finalPayment.status);

      // Clean up
      await request(app).delete(`/api/terminals/${terminal.id}`);
    });
  });
});