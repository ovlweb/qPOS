#!/usr/bin/env node

/**
 * Simple Server Starter - Bypasses class structure to avoid initialization issues
 */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from './src/database/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3030;

console.log('🚀 Starting Payment Terminal System...');

// Create Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const db = new Database();
const clients = new Map();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Initialize database and start server
console.log('📦 Initializing database...');
await db.initialize();
console.log('✅ Database initialized');

// Import and setup routes after database is ready
console.log('🔧 Setting up routes...');

// Import routes dynamically
const adminRoutes = (await import('./src/routes/admin.js')).default;
const terminalRoutes = (await import('./src/routes/terminals.js')).default;
const paymentRoutes = (await import('./src/routes/payments.js')).default;
const qrRoutes = (await import('./src/routes/qr.js')).default;
const bankRoutes = (await import('./src/routes/bank.js')).default;
const mobileRoutes = (await import('./src/routes/mobile.js')).default;
const paymentSystemsRoutes = (await import('./src/routes/payment-systems.js')).default;

// Setup admin routes
app.use('/api/admin', (req, res, next) => {
  req.server = { clients, wss, getConnectedTerminals: () => Array.from(clients.keys()) };
  req.db = db;
  next();
}, adminRoutes);

// Setup other routes
app.use('/api/terminals', (req, res, next) => {
  req.server = { clients, wss };
  req.db = db;
  next();
}, terminalRoutes);

app.use('/api/payments', (req, res, next) => {
  req.db = db;
  next();
}, paymentRoutes);

app.use('/api/qr', (req, res, next) => {
  req.db = db;
  next();
}, qrRoutes);

app.use('/api/bank', (req, res, next) => {
  req.db = db;
  next();
}, bankRoutes);

app.use('/api/mobile', (req, res, next) => {
  req.server = { clients, wss };
  req.db = db;
  next();
}, mobileRoutes);

app.use('/api/payment-systems', (req, res, next) => {
  req.db = db;
  next();
}, paymentSystemsRoutes);

// Serve terminal interface
app.get('/terminal/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/terminal.html'));
});

app.get('/terminal.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/terminal.html'));
});

// Serve admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

console.log('✅ Routes configured');

// Setup WebSocket
console.log('🔌 Setting up WebSocket...');
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'terminal_ready') {
        const { terminalId } = data;
        clients.set(terminalId, ws);
        console.log(`Terminal ${terminalId} connected`);
        
        ws.send(JSON.stringify({
          type: 'terminal_config',
          terminalId,
          status: 'connected',
          timestamp: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    for (const [terminalId, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(terminalId);
        console.log(`Terminal ${terminalId} disconnected`);
        break;
      }
    }
  });
});

console.log('✅ WebSocket configured');

// Start server
server.listen(PORT, () => {
  console.log('\n✅ Payment Terminal Server Started!');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`🖥️  Terminal interface: http://localhost:${PORT}/terminal/{id}`);
  console.log(`⚙️  Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔐 Default admin login: admin / admin123\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    db.close().then(() => {
      console.log('✅ Server shut down gracefully');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    db.close().then(() => {
      console.log('✅ Server shut down gracefully');
      process.exit(0);
    });
  });
});
