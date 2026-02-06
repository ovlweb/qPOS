import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from './database/database.js';
import { Terminal, Payment } from './models/index.js';
import TestBankAPI from './services/TestBankAPI.js';
import terminalRoutes from './routes/terminals.js';
import paymentRoutes from './routes/payments.js';
import qrRoutes from './routes/qr.js';
import bankRoutes from './routes/bank.js';
import mobileRoutes from './routes/mobile.js';
import paymentSystemsRoutes from './routes/payment-systems.js';
import adminRoutes from './routes/admin.js';
import { verifyAdminToken } from './middleware/adminAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PaymentTerminalServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.db = new Database();
    this.bankAPI = new TestBankAPI();
    this.clients = new Map(); // terminalId -> websocket connection
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  setupRoutes() {
    // Admin routes (must be first to avoid conflicts)
    this.app.use('/api/admin', (req, res, next) => {
      req.server = this;
      req.db = this.db;
      next();
    }, adminRoutes);

    // API routes - pass server instance for database and WebSocket access
    // Note: Only some routes require admin auth, others remain public
    this.app.use('/api/terminals', (req, res, next) => {
      req.server = this;
      req.db = this.db; // Pass database instance
      next();
    }, terminalRoutes);
    this.app.use('/api/payments', (req, res, next) => {
      req.db = this.db; // Pass database instance
      next();
    }, paymentRoutes);
    this.app.use('/api/qr', (req, res, next) => {
      req.db = this.db; // Pass database instance
      next();
    }, qrRoutes);
    this.app.use('/api/bank', (req, res, next) => {
      req.db = this.db; // Pass database instance
      next();
    }, bankRoutes);
    this.app.use('/api/mobile', (req, res, next) => {
      req.server = this;
      req.db = this.db; // Pass database instance
      next();
    }, mobileRoutes);
    this.app.use('/api/payment-systems', (req, res, next) => {
      req.db = this.db; // Pass database instance
      next();
    }, paymentSystemsRoutes);

    // Serve terminal interface with proper routing
    this.app.get('/terminal/:id', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/terminal.html'));
    });

    // Alternative terminal route for compatibility
    this.app.get('/terminal.html', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/terminal.html'));
    });

    // Serve admin panel
    this.app.get('/admin', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/admin.html'));
    });

    // Root route - redirect to admin panel
    this.app.get('/', (req, res) => {
      res.redirect('/admin');
    });

    // Health check (no auth required)
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      console.log('New WebSocket connection');

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        // Remove client from active connections
        for (const [terminalId, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(terminalId);
            console.log(`Terminal ${terminalId} disconnected`);
            break;
          }
        }
      });
    });
  }

  async handleWebSocketMessage(ws, data) {
    try {
      switch (data.type) {
        case 'terminal_ready':
          await this.handleTerminalReady(ws, data);
          break;

        case 'nfc_detected':
          await this.handleNFCDetected(ws, data);
          break;

        case 'payment_completed':
          await this.handlePaymentCompleted(ws, data);
          break;

        default:
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Unknown message type',
            receivedType: data.type 
          }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Internal server error',
        error: error.message 
      }));
    }
  }

  async handleTerminalReady(ws, data) {
    const { terminalId } = data;
    
    if (!terminalId || typeof terminalId !== 'string' || terminalId.trim() === '') {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Valid Terminal ID is required' 
      }));
      return;
    }

    // Verify terminal exists in database
    const terminal = await Terminal.findById(this.db, terminalId);
    if (!terminal) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Terminal not found' 
      }));
      return;
    }

    // Register terminal connection
    this.clients.set(terminalId, ws);
    console.log(`Terminal ${terminalId} connected and ready`);

    // Send terminal configuration
    ws.send(JSON.stringify({ 
      type: 'terminal_config', 
      terminalId: terminalId,
      config: {
        name: terminal.name,
        operator: terminal.operator,
        status: terminal.status,
        location: terminal.location
      },
      status: 'connected',
      timestamp: new Date().toISOString()
    }));
  }

  async handleNFCDetected(ws, data) {
    const { terminalId, paymentId, nfcData } = data;
    
    console.log(`NFC detected on terminal ${terminalId}:`, nfcData);

    // Validate terminal ID
    if (!terminalId || typeof terminalId !== 'string' || terminalId.trim() === '') {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Valid Terminal ID is required' 
      }));
      return;
    }

    // Validate terminal
    if (!this.clients.has(terminalId)) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Terminal not registered' 
      }));
      return;
    }

    try {
      let payment;
      
      // If paymentId is provided, use existing payment, otherwise create new one
      if (paymentId) {
        payment = await Payment.findById(this.db, paymentId);
        if (!payment) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Payment not found'
          }));
          return;
        }
        
        // Update payment with NFC data and set to processing
        await payment.update(this.db, {
          method: 'nfc',
          status: 'processing',
          nfcData: JSON.stringify(nfcData)
        });
      } else {
        // Create new payment record
        const paymentData = {
          terminalId: terminalId,
          amount: nfcData.amount || 1000, // Default amount if not provided
          currency: nfcData.currency || 'RUB',
          method: 'nfc',
          status: 'processing',
          nfcData: JSON.stringify(nfcData)
        };

        payment = await Payment.create(this.db, paymentData);
      }

      // Log transaction for audit (Requirements 3.4)
      await Payment.logTransaction(this.db, payment, 'nfc_detected');

      // Send payment status update
      ws.send(JSON.stringify({
        type: 'payment_status',
        paymentId: payment.id,
        status: 'processing',
        message: 'Processing NFC payment',
        timestamp: new Date().toISOString()
      }));

      // Integrate with bank API for full NFC payment cycle
      await this.processNFCPaymentWithBank(ws, terminalId, payment, nfcData);

    } catch (error) {
      console.error('Error processing NFC payment:', error);
      ws.send(JSON.stringify({
        type: 'payment_status',
        status: 'failed',
        message: 'Failed to process NFC payment',
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  async handlePaymentCompleted(ws, data) {
    const { terminalId, paymentId, result } = data;
    
    console.log(`Payment completed on terminal ${terminalId}:`, paymentId, result);

    // Validate terminal ID
    if (!terminalId || typeof terminalId !== 'string' || terminalId.trim() === '') {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Valid Terminal ID is required'
      }));
      return;
    }

    try {
      // Find and update payment
      const payment = await Payment.findById(this.db, paymentId);
      if (!payment) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Payment not found'
        }));
        return;
      }

      // Update payment status
      const updateData = {
        status: result.status,
        completedAt: new Date()
      };

      if (result.bankTransactionId) {
        updateData.bankTransactionId = result.bankTransactionId;
      }

      if (result.errorCode) {
        updateData.errorCode = result.errorCode;
      }

      await payment.update(this.db, updateData);

      // Log transaction completion
      await Payment.logTransaction(this.db, payment, 'payment_completed');

      // Send confirmation to terminal
      ws.send(JSON.stringify({
        type: 'payment_status',
        paymentId: paymentId,
        status: result.status,
        message: result.status === 'completed' ? 'Payment confirmed' : 'Payment failed',
        result: result,
        timestamp: new Date().toISOString()
      }));

      console.log(`Payment ${paymentId} ${result.status} on terminal ${terminalId}`);

    } catch (error) {
      console.error('Error updating payment completion:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to update payment status',
        error: error.message
      }));
    }
  }

  // Process NFC payment with bank API integration
  async processNFCPaymentWithBank(ws, terminalId, payment, nfcData) {
    try {
      // Prepare payment data for bank API
      const bankPaymentData = {
        amount: payment.amount,
        currency: payment.currency,
        terminalId: payment.terminalId,
        paymentId: payment.id,
        cardData: {
          cardNumber: nfcData.cardNumber || '**** **** **** ****',
          cardType: nfcData.cardType || 'unknown',
          timestamp: nfcData.timestamp
        }
      };

      // Step 1: Authorize payment with bank (Requirements 3.1)
      console.log(`Authorizing NFC payment ${payment.id} with bank...`);
      const authResult = await this.bankAPI.authorizePayment(bankPaymentData);

      if (authResult.success) {
        // Update payment with bank transaction ID
        await payment.update(this.db, {
          bankTransactionId: authResult.transactionId,
          status: 'authorized'
        });

        // Log authorization
        await Payment.logTransaction(this.db, payment, 'bank_authorized');

        // Step 2: Capture payment immediately for NFC (Requirements 3.2)
        console.log(`Capturing NFC payment ${payment.id}...`);
        const captureResult = await this.bankAPI.capturePayment(authResult.transactionId, payment.amount);

        if (captureResult.success) {
          // Payment successful (Requirements 3.2)
          await payment.update(this.db, {
            status: 'completed',
            completedAt: new Date()
          });

          // Log completion
          await Payment.logTransaction(this.db, payment, 'completed');

          // Send success status to terminal
          this.sendPaymentStatusUpdate(terminalId, payment.id, 'completed', 'Payment successful', {
            amount: payment.amount,
            transactionId: authResult.transactionId,
            authCode: authResult.authCode
          });

          console.log(`NFC payment ${payment.id} completed successfully`);
        } else {
          // Capture failed
          await payment.update(this.db, {
            status: 'failed',
            errorCode: captureResult.errorCode
          });

          // Log failure
          await Payment.logTransaction(this.db, payment, 'capture_failed');

          // Send error to terminal (Requirements 3.3)
          this.sendPaymentStatusUpdate(terminalId, payment.id, 'failed', 'Payment capture failed', {
            errorCode: captureResult.errorCode,
            errorMessage: captureResult.errorMessage
          });

          console.log(`NFC payment ${payment.id} capture failed: ${captureResult.errorCode}`);
        }
      } else {
        // Authorization failed (Requirements 3.3)
        await payment.update(this.db, {
          status: 'failed',
          errorCode: authResult.errorCode,
          bankTransactionId: authResult.transactionId
        });

        // Log authorization failure
        await Payment.logTransaction(this.db, payment, 'auth_failed');

        // Send error to terminal (Requirements 3.3)
        this.sendPaymentStatusUpdate(terminalId, payment.id, 'failed', 'Payment authorization failed', {
          errorCode: authResult.errorCode,
          errorMessage: authResult.errorMessage
        });

        console.log(`NFC payment ${payment.id} authorization failed: ${authResult.errorCode}`);
      }
    } catch (error) {
      console.error('Error processing NFC payment with bank:', error);
      
      // Update payment status to failed
      await payment.update(this.db, {
        status: 'failed',
        errorCode: 'E003' // Network error
      });

      // Log error
      await Payment.logTransaction(this.db, payment, 'bank_error');

      // Send error to terminal
      this.sendPaymentStatusUpdate(terminalId, payment.id, 'failed', 'Bank communication error', {
        errorCode: 'E003',
        errorMessage: 'Network connection error'
      });
    }
  }

  sendToTerminal(terminalId, message) {
    const client = this.clients.get(terminalId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Send payment request to terminal
  async sendPaymentRequest(terminalId, paymentData) {
    // Validate terminal ID
    if (!terminalId || typeof terminalId !== 'string' || terminalId.trim() === '') {
      throw new Error('Valid Terminal ID is required');
    }

    try {
      // Create payment record
      const payment = await Payment.create(this.db, {
        terminalId: terminalId,
        amount: paymentData.amount,
        currency: paymentData.currency || 'RUB',
        method: paymentData.method || 'nfc',
        status: 'pending'
      });

      // Log transaction initiation
      await Payment.logTransaction(this.db, payment, 'payment_request');

      // Send to terminal
      const success = this.sendToTerminal(terminalId, {
        type: 'payment_request',
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        testPayment: paymentData.testPayment || false, // Передаем флаг тестового платежа
        timestamp: new Date().toISOString()
      });

      if (!success) {
        // Update payment status if terminal not connected
        await payment.update(this.db, { 
          status: 'failed', 
          errorCode: 'TERMINAL_OFFLINE' 
        });
        throw new Error('Terminal not connected');
      }

      return payment;
    } catch (error) {
      console.error('Error sending payment request:', error);
      throw error;
    }
  }

  // Send payment status update to terminal
  sendPaymentStatusUpdate(terminalId, paymentId, status, message, additionalData = {}) {
    return this.sendToTerminal(terminalId, {
      type: 'payment_status',
      paymentId: paymentId,
      status: status,
      message: message,
      timestamp: new Date().toISOString(),
      ...additionalData
    });
  }

  // Send terminal configuration update
  sendTerminalConfig(terminalId, config) {
    return this.sendToTerminal(terminalId, {
      type: 'terminal_config',
      terminalId: terminalId,
      config: config,
      timestamp: new Date().toISOString()
    });
  }

  // Get all connected terminals
  getConnectedTerminals() {
    return Array.from(this.clients.keys());
  }

  // Check if terminal is connected
  isTerminalConnected(terminalId) {
    if (!terminalId || typeof terminalId !== 'string' || terminalId.trim() === '') {
      return false;
    }
    const client = this.clients.get(terminalId);
    return Boolean(client && client.readyState === 1); // WebSocket.OPEN = 1
  }

  async start(port = 3030) {
    try {
      console.log('[DEBUG] Starting server initialization...');
      console.error('[DEBUG] Starting server initialization...'); // Also to stderr
      await this.db.initialize();
      console.log('[DEBUG] Database initialized');
      console.error('[DEBUG] Database initialized');

      this.server.listen(port, () => {
        console.log(`[DEBUG] Payment Terminal Server running on port ${port}`);
        console.error(`[DEBUG] Payment Terminal Server running on port ${port}`);
        console.log(`Terminal interface: http://localhost:${port}/terminal/{id}`);
        console.log(`Admin panel: http://localhost:${port}/admin`);
      });
    } catch (error) {
      console.error('[DEBUG] Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new PaymentTerminalServer();
  server.start();
}

export default PaymentTerminalServer;