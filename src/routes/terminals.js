import express from 'express';
import { verifyAdminToken } from '../middleware/adminAuth.js';

const router = express.Router();

// GET /api/terminals - Get all terminals (admin auth required)
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const terminals = await db.all('SELECT id, name, operator, status, location, is_locked, created_at, updated_at FROM terminals ORDER BY created_at DESC');
    res.json(terminals);
  } catch (error) {
    console.error('Error fetching terminals:', error);
    res.status(500).json({ error: 'Failed to fetch terminals' });
  }
});

// GET /api/terminals/:id - Get specific terminal
router.get('/:id', async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const terminal = await db.get('SELECT id, name, operator, status, location, is_locked, created_at, updated_at FROM terminals WHERE id = ?', [req.params.id]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }
    res.json(terminal);
  } catch (error) {
    console.error('Error fetching terminal:', error);
    res.status(500).json({ error: 'Failed to fetch terminal' });
  }
});

// POST /api/terminals - Create new terminal (admin auth required)
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const { id, name, operator, location, password } = req.body;
    
    if (!name || !operator) {
      return res.status(400).json({ error: 'Name and operator are required' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required for new terminal' });
    }

    const terminalId = id || generateTerminalId();
    const now = new Date().toISOString();

    // Check if terminal ID already exists
    const existing = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (existing) {
      return res.status(400).json({ error: 'Terminal ID already exists' });
    }

    await db.run(
      'INSERT INTO terminals (id, name, operator, location, password, is_locked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [terminalId, name, operator, location || null, password, 1, now, now]
    );

    const terminal = await db.get('SELECT id, name, operator, location, status, is_locked, created_at, updated_at FROM terminals WHERE id = ?', [terminalId]);
    res.status(201).json(terminal);
  } catch (error) {
    console.error('Error creating terminal:', error);
    res.status(500).json({ error: 'Failed to create terminal' });
  }
});

// PUT /api/terminals/:id - Update terminal (admin auth required)
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const { name, operator, status, location, password } = req.body;
    const terminalId = req.params.id;

    // Check if terminal exists
    const existing = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!existing) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    const now = new Date().toISOString();
    
    // Build update query dynamically
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (operator !== undefined) {
      updates.push('operator = ?');
      params.push(operator);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (location !== undefined) {
      updates.push('location = ?');
      params.push(location);
    }
    if (password !== undefined && password !== '') {
      updates.push('password = ?');
      params.push(password);
    }
    
    updates.push('updated_at = ?');
    params.push(now);
    params.push(terminalId);

    await db.run(
      `UPDATE terminals SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const terminal = await db.get('SELECT id, name, operator, location, status, is_locked, created_at, updated_at FROM terminals WHERE id = ?', [terminalId]);
    res.json(terminal);
  } catch (error) {
    console.error('Error updating terminal:', error);
    res.status(500).json({ error: 'Failed to update terminal' });
  }
});

// DELETE /api/terminals/:id - Delete terminal (admin auth required)
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const terminalId = req.params.id;

    // Check if terminal exists
    const existing = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!existing) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    await db.run('DELETE FROM terminals WHERE id = ?', [terminalId]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting terminal:', error);
    res.status(500).json({ error: 'Failed to delete terminal' });
  }
});

// POST /api/terminals/:id/payment-request - Send payment request to terminal
router.post('/:id/payment-request', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const terminalId = req.params.id;
    const { amount, currency, method } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    // Check if terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    // Check if server instance is available (for WebSocket)
    if (!req.server) {
      return res.status(500).json({ error: 'Server instance not available' });
    }

    // Check if terminal is connected
    if (!req.server.isTerminalConnected(terminalId)) {
      return res.status(400).json({ error: 'Terminal is not connected' });
    }

    // Send payment request via WebSocket
    const payment = await req.server.sendPaymentRequest(terminalId, {
      amount: amount,
      currency: currency || 'RUB',
      method: method || 'nfc',
      testPayment: false // Обычные платежи НЕ тестовые
    });

    res.status(201).json({
      message: 'Payment request sent successfully',
      payment: payment.toJSON()
    });

  } catch (error) {
    console.error('Error sending payment request:', error);
    res.status(500).json({ error: error.message || 'Failed to send payment request' });
  }
});

// POST /api/terminals/:id/activate - Activate terminal for payment (Requirements 7.4)
router.post('/:id/activate', async (req, res) => {
  try {
    const db = req.db; // Use database instance from server
    const terminalId = req.params.id;
    const { amount = 1000, currency = 'RUB', method = 'nfc' } = req.body;

    // Check if terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    // Check if server instance is available (for WebSocket)
    if (!req.server) {
      return res.status(500).json({ error: 'Server instance not available' });
    }

    // Check if terminal is connected
    if (!req.server.isTerminalConnected(terminalId)) {
      return res.status(400).json({ error: 'Terminal is not connected' });
    }

    // Send payment request via WebSocket to activate terminal
    const payment = await req.server.sendPaymentRequest(terminalId, {
      amount: amount,
      currency: currency,
      method: method,
      testPayment: false // Активация терминала тоже НЕ тестовая
    });

    res.status(200).json({
      message: 'Terminal activated successfully',
      payment: payment.toJSON()
    });

  } catch (error) {
    console.error('Error activating terminal:', error);
    res.status(500).json({ error: error.message || 'Failed to activate terminal' });
  }
});

// POST /api/terminals/:id/unlock - Unlock terminal with password
router.post('/:id/unlock', async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const terminalId = req.params.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Check if terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    // Check password
    if (terminal.password !== password) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Unlock terminal
    await db.run('UPDATE terminals SET is_locked = 0 WHERE id = ?', [terminalId]);

    res.json({ 
      success: true, 
      message: 'Terminal unlocked successfully',
      terminal: {
        id: terminal.id,
        name: terminal.name,
        operator: terminal.operator,
        location: terminal.location,
        status: terminal.status
      }
    });

  } catch (error) {
    console.error('Error unlocking terminal:', error);
    res.status(500).json({ error: 'Failed to unlock terminal' });
  }
});

// POST /api/terminals/:id/lock - Lock terminal
router.post('/:id/lock', async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const terminalId = req.params.id;

    // Check if terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    // Lock terminal
    await db.run('UPDATE terminals SET is_locked = 1 WHERE id = ?', [terminalId]);

    res.json({ 
      success: true, 
      message: 'Terminal locked successfully'
    });

  } catch (error) {
    console.error('Error locking terminal:', error);
    res.status(500).json({ error: 'Failed to lock terminal' });
  }
});

// GET /api/terminals/:id/status - Get terminal connection status
router.get('/:id/status', async (req, res) => {
  try {
    const db = req.db; // Use passed database instance
    const terminalId = req.params.id;

    // Check if terminal exists
    const terminal = await db.get('SELECT * FROM terminals WHERE id = ?', [terminalId]);
    if (!terminal) {
      return res.status(404).json({ error: 'Terminal not found' });
    }

    const isConnected = req.server ? req.server.isTerminalConnected(terminalId) : false;

    res.json({
      terminalId: terminalId,
      connected: isConnected,
      terminal: terminal
    });

  } catch (error) {
    console.error('Error checking terminal status:', error);
    res.status(500).json({ error: 'Failed to check terminal status' });
  }
});

function generateTerminalId() {
  // Generate terminal ID in format T001, T002, etc.
  const randomNum = Math.floor(Math.random() * 999) + 1;
  return `T${randomNum.toString().padStart(3, '0')}`;
}

export default router;