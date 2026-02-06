import { v4 as uuidv4 } from 'uuid';

class Terminal {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    
    // Validate ID is not just whitespace
    if (typeof this.id === 'string' && this.id.trim() === '') {
      this.id = uuidv4();
    }
    
    this.name = data.name || '';
    this.operator = data.operator || '';
    this.status = data.status || 'active';
    this.location = data.location || '';
    this.createdAt = data.created_at || data.createdAt || new Date();
    this.updatedAt = data.updated_at || data.updatedAt || new Date();
  }

  static async create(db, terminalData) {
    // Validate terminal ID
    if (terminalData.id && (typeof terminalData.id !== 'string' || terminalData.id.trim() === '')) {
      throw new Error('Terminal ID must be a non-empty string');
    }
    
    const terminal = new Terminal(terminalData);
    
    const sql = `
      INSERT INTO terminals (id, name, operator, status, location, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      terminal.id,
      terminal.name,
      terminal.operator,
      terminal.status,
      terminal.location,
      terminal.createdAt.toISOString(),
      terminal.updatedAt.toISOString()
    ];

    await db.run(sql, params);
    return terminal;
  }

  static async findById(db, id) {
    const sql = 'SELECT * FROM terminals WHERE id = ?';
    const row = await db.get(sql, [id]);
    
    if (!row) {
      return null;
    }
    
    return new Terminal(row);
  }

  static async findAll(db) {
    const sql = 'SELECT * FROM terminals ORDER BY created_at DESC';
    const rows = await db.all(sql);
    
    return rows.map(row => new Terminal(row));
  }

  async update(db, updateData) {
    // Update instance properties
    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && key !== 'createdAt' && key !== 'created_at') {
        this[key] = updateData[key];
      }
    });
    
    this.updatedAt = new Date();

    const sql = `
      UPDATE terminals 
      SET name = ?, operator = ?, status = ?, location = ?, updated_at = ?
      WHERE id = ?
    `;
    
    const params = [
      this.name,
      this.operator,
      this.status,
      this.location,
      this.updatedAt.toISOString(),
      this.id
    ];

    const result = await db.run(sql, params);
    return result.changes > 0;
  }

  static async update(db, currentId, updateData) {
    // Find the existing terminal
    const existingTerminal = await Terminal.findById(db, currentId);
    if (!existingTerminal) {
      throw new Error(`Terminal with ID ${currentId} not found`);
    }

    // If ID is being changed, we need to handle it specially
    if (updateData.id && updateData.id !== currentId) {
      // Check if the new ID already exists
      const existingWithNewId = await Terminal.findById(db, updateData.id);
      if (existingWithNewId) {
        throw new Error(`Terminal with ID ${updateData.id} already exists`);
      }

      // Validate new ID
      if (typeof updateData.id !== 'string' || updateData.id.trim() === '') {
        throw new Error('Terminal ID must be a non-empty string');
      }

      // Create new terminal data with the new ID
      const newTerminalData = {
        id: updateData.id,
        name: updateData.name !== undefined ? updateData.name : existingTerminal.name,
        operator: updateData.operator !== undefined ? updateData.operator : existingTerminal.operator,
        status: updateData.status !== undefined ? updateData.status : existingTerminal.status,
        location: updateData.location !== undefined ? updateData.location : existingTerminal.location,
        createdAt: existingTerminal.createdAt,
        updatedAt: new Date()
      };

      // Insert new terminal with new ID
      const sql = `
        INSERT INTO terminals (id, name, operator, status, location, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        newTerminalData.id,
        newTerminalData.name,
        newTerminalData.operator,
        newTerminalData.status,
        newTerminalData.location,
        newTerminalData.createdAt instanceof Date ? newTerminalData.createdAt.toISOString() : newTerminalData.createdAt,
        newTerminalData.updatedAt.toISOString()
      ];

      await db.run(sql, params);
      
      // Delete old terminal
      await db.run('DELETE FROM terminals WHERE id = ?', [currentId]);
      
      return new Terminal(newTerminalData);
    } else {
      // Regular update without ID change
      Object.keys(updateData).forEach(key => {
        if (key !== 'id' && key !== 'createdAt' && key !== 'created_at') {
          existingTerminal[key] = updateData[key];
        }
      });
      
      existingTerminal.updatedAt = new Date();

      const sql = `
        UPDATE terminals 
        SET name = ?, operator = ?, status = ?, location = ?, updated_at = ?
        WHERE id = ?
      `;
      
      const params = [
        existingTerminal.name,
        existingTerminal.operator,
        existingTerminal.status,
        existingTerminal.location,
        existingTerminal.updatedAt.toISOString(),
        currentId
      ];

      await db.run(sql, params);
      return existingTerminal;
    }
  }

  async delete(db) {
    const sql = 'DELETE FROM terminals WHERE id = ?';
    const result = await db.run(sql, [this.id]);
    return result.changes > 0;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      operator: this.operator,
      status: this.status,
      location: this.location,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

export default Terminal;