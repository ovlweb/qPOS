/**
 * Admin Routes for Payment Terminal System
 * 
 * Provides secure admin endpoints for system management
 */

import express from 'express';
import { AdminAuth, verifyAdminToken } from '../middleware/adminAuth.js';

const router = express.Router();

/**
 * POST /api/admin/auth - Admin authentication
 */
router.post('/auth', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    const result = await AdminAuth.authenticate(username, password);

    if (result.success) {
      // Update session with request info
      AdminAuth.updateSessionActivity(
        result.admin.sessionId,
        req.ip || req.connection.remoteAddress,
        req.get('User-Agent')
      );

      console.log(`✅ Admin login successful: ${username} from ${req.ip}`);
      
      res.json({
        success: true,
        token: result.token,
        expiresIn: result.expiresIn,
        admin: result.admin,
        message: 'Authentication successful'
      });
    } else {
      console.log(`❌ Admin login failed: ${username} from ${req.ip} - ${result.error}`);
      
      res.status(401).json({
        success: false,
        error: result.error,
        code: result.code,
        message: 'Authentication failed'
      });
    }

  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * POST /api/admin/refresh - Refresh admin token
 */
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token required for refresh',
        code: 'NO_TOKEN'
      });
    }

    const result = await AdminAuth.refreshToken(token);

    if (result.success) {
      res.json({
        success: true,
        token: result.token,
        expiresIn: result.expiresIn,
        message: 'Token refreshed successfully'
      });
    } else {
      res.status(401).json({
        success: false,
        error: result.error,
        code: result.code
      });
    }

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * POST /api/admin/logout - Admin logout
 */
router.post('/logout', verifyAdminToken, async (req, res) => {
  try {
    const result = await AdminAuth.logout(req.admin.sessionId);

    console.log(`🚪 Admin logout: ${req.admin.username}`);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * GET /api/admin/dashboard - Admin dashboard data
 */
router.get('/dashboard', verifyAdminToken, async (req, res) => {
  try {
    const db = req.db;
    const result = await AdminAuth.getDashboardStats(db);

    if (result.success) {
      res.json({
        success: true,
        dashboard: result.stats,
        admin: {
          username: req.admin.username,
          loginTime: req.admin.loginTime
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        code: result.code
      });
    }

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * GET /api/admin/sessions - Get active admin sessions
 */
router.get('/sessions', verifyAdminToken, async (req, res) => {
  try {
    const sessions = AdminAuth.getActiveSessions();

    res.json({
      success: true,
      sessions: sessions,
      count: sessions.length,
      currentSession: req.admin.sessionId
    });

  } catch (error) {
    console.error('Sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * POST /api/admin/complete-payment - Complete payment and notify terminal
 */
router.post('/complete-payment', verifyAdminToken, async (req, res) => {
  try {
    const { paymentId, terminalId, status, amount, transactionId, completedBy } = req.body;
    
    if (!paymentId || !terminalId || !status) {
      return res.status(400).json({ 
        success: false, 
        error: 'Payment ID, terminal ID, and status are required',
        code: 'MISSING_PARAMETERS'
      });
    }

    // Update payment status in database
    const now = new Date().toISOString();
    await req.db.run(
      'UPDATE payments SET status = ?, completed_at = ?, bank_transaction_id = ? WHERE id = ?',
      [status, now, transactionId || paymentId, paymentId]
    );

    // Get the updated payment
    const payment = await req.db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!payment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Payment not found',
        code: 'PAYMENT_NOT_FOUND'
      });
    }

    // Send WebSocket notification to terminal
    const client = req.server.clients.get(terminalId);
    let terminalNotified = false;
    let notificationDetails = '';
    
    if (client && client.readyState === 1) { // WebSocket.OPEN = 1
      const notification = {
        type: 'payment_status',
        paymentId: paymentId,
        status: status,
        message: status === 'completed' ? 'Payment successful' : 'Payment failed',
        result: {
          amount: amount || payment.amount,
          transactionId: transactionId || paymentId,
          authCode: 'AUTH' + Math.random().toString(36).substr(2, 6).toUpperCase()
        },
        timestamp: new Date().toISOString()
      };

      try {
        client.send(JSON.stringify(notification));
        terminalNotified = true;
        notificationDetails = 'WebSocket notification sent successfully';
        console.log(`💳 Payment completion notification sent to terminal ${terminalId}: ${paymentId} -> ${status}`);
      } catch (wsError) {
        console.log(`❌ Failed to send WebSocket notification to terminal ${terminalId}:`, wsError.message);
        notificationDetails = `WebSocket send failed: ${wsError.message}`;
      }
    } else {
      const clientStatus = client ? `readyState=${client.readyState}` : 'not found';
      console.log(`⚠️ Terminal ${terminalId} not connected (${clientStatus}), payment ${paymentId} completed but no notification sent`);
      notificationDetails = `Terminal not connected (${clientStatus})`;
    }

    // Log admin action
    console.log(`💳 Admin payment completion: ${paymentId} -> ${status} by ${completedBy || req.admin.username}`);

    res.json({ 
      success: true, 
      message: `Payment ${paymentId} marked as ${status}`,
      paymentId: paymentId,
      terminalId: terminalId,
      status: status,
      terminalNotified: terminalNotified,
      notificationDetails: notificationDetails,
      completedBy: completedBy || req.admin.username,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin complete payment error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * POST /api/admin/send-notification - Send direct WebSocket notification to terminal
 */
router.post('/send-notification', verifyAdminToken, async (req, res) => {
  try {
    const { terminalId, type, data } = req.body;
    
    if (!terminalId || !type) {
      return res.status(400).json({ 
        success: false, 
        error: 'Terminal ID and notification type are required',
        code: 'MISSING_PARAMETERS'
      });
    }

    // Send WebSocket notification to terminal
    const client = req.server.clients.get(terminalId);
    let terminalNotified = false;
    let notificationDetails = '';
    
    if (client && client.readyState === 1) { // WebSocket.OPEN = 1
      const notification = {
        type: type,
        ...data,
        timestamp: new Date().toISOString()
      };

      try {
        client.send(JSON.stringify(notification));
        terminalNotified = true;
        notificationDetails = 'Direct WebSocket notification sent successfully';
        console.log(`📡 Direct notification sent to terminal ${terminalId}: ${type}`);
      } catch (wsError) {
        console.log(`❌ Failed to send direct notification to terminal ${terminalId}:`, wsError.message);
        notificationDetails = `WebSocket send failed: ${wsError.message}`;
      }
    } else {
      const clientStatus = client ? `readyState=${client.readyState}` : 'not found';
      console.log(`⚠️ Terminal ${terminalId} not connected (${clientStatus}), notification not sent`);
      notificationDetails = `Terminal not connected (${clientStatus})`;
    }

    // Log admin action
    console.log(`📡 Admin ${req.admin.username} sent direct notification to terminal ${terminalId}: ${type}`);

    res.json({ 
      success: true, 
      message: `Direct notification sent to terminal ${terminalId}`,
      terminalId: terminalId,
      type: type,
      terminalNotified: terminalNotified,
      notificationDetails: notificationDetails,
      sentBy: req.admin.username,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin send notification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * POST /api/admin/test-payment - Send test payment (requires admin auth)
 */
router.post('/test-payment', verifyAdminToken, async (req, res) => {
  try {
    const { terminalId, amount, method } = req.body;
    
    if (!terminalId || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Terminal ID and amount are required',
        code: 'MISSING_PARAMETERS'
      });
    }

    // Validate amount (should be in kopecks, max 10,000,000 kopecks = 100,000 rubles)
    if (typeof amount !== 'number' || amount <= 0 || amount > 10000000) {
      return res.status(400).json({ 
        success: false, 
        error: 'Amount must be between 1 and 10,000,000 kopecks (1 to 100,000 rubles)',
        code: 'INVALID_AMOUNT'
      });
    }

    // Check if terminal exists and is active
    const terminal = await req.db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ 
        success: false, 
        error: 'Terminal not found',
        code: 'TERMINAL_NOT_FOUND'
      });
    }

    if (terminal.status !== 'active') {
      return res.status(400).json({ 
        success: false, 
        error: 'Terminal is not active',
        code: 'TERMINAL_INACTIVE'
      });
    }

    // Send payment request to terminal via WebSocket
    const client = req.server.clients.get(terminalId);
    if (!client || client.readyState !== 1) { // WebSocket.OPEN = 1
      return res.status(400).json({ 
        success: false, 
        error: 'Terminal is not connected',
        code: 'TERMINAL_OFFLINE'
      });
    }

    // Send payment request to terminal
    client.send(JSON.stringify({
      type: 'payment_request',
      amount: amount,
      method: method || 'nfc',
      testPayment: true,
      adminUser: req.admin.username,
      timestamp: new Date().toISOString()
    }));

    // Log admin action
    console.log(`💳 Admin ${req.admin.username} sent test payment to terminal ${terminalId}: ${amount} ${method || 'nfc'}`);

    res.json({ 
      success: true, 
      message: `Test payment request sent to terminal ${terminalId}`,
      amount: amount,
      method: method || 'nfc',
      terminalId: terminalId,
      adminUser: req.admin.username
    });

  } catch (error) {
    console.error('Admin test payment error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * GET /api/admin/system/status - System status check
 */
router.get('/system/status', verifyAdminToken, async (req, res) => {
  try {
    const db = req.db;
    const server = req.server;

    // Check database connection
    let dbStatus = 'connected';
    try {
      await db.get('SELECT 1');
    } catch (error) {
      dbStatus = 'error';
    }

    // Check WebSocket server
    const wsStatus = server.wss ? 'running' : 'stopped';

    // Get connected terminals
    const connectedTerminals = server.getConnectedTerminals();

    // System uptime
    const uptime = process.uptime();

    // Memory usage
    const memoryUsage = process.memoryUsage();

    res.json({
      success: true,
      system: {
        status: 'operational',
        uptime: uptime,
        database: {
          status: dbStatus,
          type: 'SQLite'
        },
        websocket: {
          status: wsStatus,
          connectedTerminals: connectedTerminals.length,
          terminals: connectedTerminals
        },
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB'
        },
        node: {
          version: process.version,
          platform: process.platform
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('System status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system status',
      code: 'SYSTEM_ERROR'
    });
  }
});

/**
 * POST /api/admin/system/restart - Restart system (requires admin auth)
 */
router.post('/system/restart', verifyAdminToken, async (req, res) => {
  try {
    console.log(`🔄 System restart requested by admin: ${req.admin.username}`);

    res.json({
      success: true,
      message: 'System restart initiated',
      adminUser: req.admin.username,
      timestamp: new Date().toISOString()
    });

    // Restart after sending response
    setTimeout(() => {
      console.log('🔄 Restarting system...');
      process.exit(0); // PM2 or similar process manager should restart
    }, 1000);

  } catch (error) {
    console.error('System restart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restart system',
      code: 'RESTART_ERROR'
    });
  }
});

/**
 * GET /api/admin/logs - Get system logs (requires admin auth)
 */
router.get('/logs', verifyAdminToken, async (req, res) => {
  try {
    const { limit = 100, level = 'all' } = req.query;

    // In a real system, you'd read from log files
    // For now, return mock log data
    const logs = [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'System operational',
        source: 'server'
      },
      {
        timestamp: new Date(Date.now() - 60000).toISOString(),
        level: 'info',
        message: `Admin login: ${req.admin.username}`,
        source: 'auth'
      }
    ];

    res.json({
      success: true,
      logs: logs.slice(0, parseInt(limit)),
      count: logs.length,
      level: level,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Logs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get logs',
      code: 'LOGS_ERROR'
    });
  }
});

export default router;