import express from 'express';
import { randomUUID } from 'crypto';

const router = express.Router();

// GET /api/payment-systems - Get all payment systems
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const { active_only = false } = req.query;
    
    let sql = 'SELECT * FROM payment_systems';
    const params = [];
    
    if (active_only === 'true') {
      sql += ' WHERE is_active = 1';
    }
    
    sql += ' ORDER BY sort_order ASC, display_name ASC';
    
    const systems = await db.all(sql, params);
    res.json(systems);
  } catch (error) {
    console.error('Error fetching payment systems:', error);
    res.status(500).json({ error: 'Failed to fetch payment systems' });
  }
});

// GET /api/payment-systems/:id - Get specific payment system
router.get('/:id', async (req, res) => {
  try {
    const db = req.db;
    const system = await db.get('SELECT * FROM payment_systems WHERE id = ?', [req.params.id]);
    
    if (!system) {
      return res.status(404).json({ error: 'Payment system not found' });
    }
    
    res.json(system);
  } catch (error) {
    console.error('Error fetching payment system:', error);
    res.status(500).json({ error: 'Failed to fetch payment system' });
  }
});

// POST /api/payment-systems - Create new payment system
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { name, display_name, logo_url, is_active = 1, sort_order = 0 } = req.body;
    
    if (!name || !display_name) {
      return res.status(400).json({ error: 'Name and display_name are required' });
    }
    
    const id = randomUUID();
    const now = new Date().toISOString();
    
    // Check if name already exists
    const existing = await db.get('SELECT * FROM payment_systems WHERE name = ?', [name]);
    if (existing) {
      return res.status(400).json({ error: 'Payment system with this name already exists' });
    }
    
    await db.run(
      'INSERT INTO payment_systems (id, name, display_name, logo_url, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, display_name, logo_url, is_active, sort_order, now, now]
    );
    
    const system = await db.get('SELECT * FROM payment_systems WHERE id = ?', [id]);
    res.status(201).json(system);
  } catch (error) {
    console.error('Error creating payment system:', error);
    res.status(500).json({ error: 'Failed to create payment system' });
  }
});

// PUT /api/payment-systems/:id - Update payment system
router.put('/:id', async (req, res) => {
  try {
    const db = req.db;
    const { name, display_name, logo_url, is_active, sort_order } = req.body;
    const systemId = req.params.id;
    
    // Check if system exists
    const existing = await db.get('SELECT * FROM payment_systems WHERE id = ?', [systemId]);
    if (!existing) {
      return res.status(404).json({ error: 'Payment system not found' });
    }
    
    const now = new Date().toISOString();
    
    // Build update query dynamically
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      // Check if new name conflicts with another system
      const nameConflict = await db.get('SELECT * FROM payment_systems WHERE name = ? AND id != ?', [name, systemId]);
      if (nameConflict) {
        return res.status(400).json({ error: 'Payment system with this name already exists' });
      }
      updates.push('name = ?');
      params.push(name);
    }
    if (display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(display_name);
    }
    if (logo_url !== undefined) {
      updates.push('logo_url = ?');
      params.push(logo_url);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active);
    }
    if (sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(sort_order);
    }
    
    updates.push('updated_at = ?');
    params.push(now);
    params.push(systemId);
    
    await db.run(
      `UPDATE payment_systems SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    const system = await db.get('SELECT * FROM payment_systems WHERE id = ?', [systemId]);
    res.json(system);
  } catch (error) {
    console.error('Error updating payment system:', error);
    res.status(500).json({ error: 'Failed to update payment system' });
  }
});

// DELETE /api/payment-systems/:id - Delete payment system
router.delete('/:id', async (req, res) => {
  try {
    const db = req.db;
    const systemId = req.params.id;
    
    // Check if system exists
    const existing = await db.get('SELECT * FROM payment_systems WHERE id = ?', [systemId]);
    if (!existing) {
      return res.status(404).json({ error: 'Payment system not found' });
    }
    
    await db.run('DELETE FROM payment_systems WHERE id = ?', [systemId]);
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting payment system:', error);
    res.status(500).json({ error: 'Failed to delete payment system' });
  }
});

// POST /api/payment-systems/:id/toggle - Toggle active status
router.post('/:id/toggle', async (req, res) => {
  try {
    const db = req.db;
    const systemId = req.params.id;
    
    // Check if system exists
    const existing = await db.get('SELECT * FROM payment_systems WHERE id = ?', [systemId]);
    if (!existing) {
      return res.status(404).json({ error: 'Payment system not found' });
    }
    
    const newStatus = existing.is_active ? 0 : 1;
    const now = new Date().toISOString();
    
    await db.run(
      'UPDATE payment_systems SET is_active = ?, updated_at = ? WHERE id = ?',
      [newStatus, now, systemId]
    );
    
    const system = await db.get('SELECT * FROM payment_systems WHERE id = ?', [systemId]);
    res.json(system);
  } catch (error) {
    console.error('Error toggling payment system status:', error);
    res.status(500).json({ error: 'Failed to toggle payment system status' });
  }
});

export default router;