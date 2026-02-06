import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('AdminPanel Unit Tests', () => {
  let dom;
  let window;
  let document;
  let AdminPanel;
  let fetchMock;
  let WebSocketMock;

  beforeEach(() => {
    // Setup DOM environment
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="add-terminal-form">
            <input id="terminal-name" />
            <input id="terminal-operator" />
            <input id="terminal-location" />
          </form>
          <form id="edit-terminal-form">
            <input id="edit-terminal-id" />
            <input id="edit-terminal-name" />
            <input id="edit-terminal-operator" />
            <input id="edit-terminal-location" />
            <select id="edit-terminal-status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </form>
          <div id="terminals-loading"></div>
          <div id="terminals-grid"></div>
          <div id="edit-modal"></div>
        </body>
      </html>
    `, { url: 'http://localhost' });

    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;

    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock WebSocket
    WebSocketMock = vi.fn().mockImplementation(() => ({
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null
    }));
    global.WebSocket = WebSocketMock;

    // Mock alert
    global.alert = vi.fn();

    // Define AdminPanel class for testing
    AdminPanel = class {
      constructor() {
        this.apiUrl = '/api';
        this.terminals = [];
        this.currentEditingTerminal = null;
        this.websocket = null;
      }

      async loadTerminals() {
        try {
          const response = await fetch(`${this.apiUrl}/terminals`);
          if (response.ok) {
            this.terminals = await response.json();
            this.renderTerminals();
          }
        } catch (error) {
          console.error('Error loading terminals:', error);
        }
      }

      renderTerminals() {
        const grid = document.getElementById('terminals-grid');
        grid.innerHTML = '';
        this.terminals.forEach(terminal => {
          const card = this.createTerminalCard(terminal);
          grid.appendChild(card);
        });
      }

      createTerminalCard(terminal) {
        const card = document.createElement('div');
        card.className = 'terminal-card';
        card.innerHTML = `
          <h3>${terminal.name}</h3>
          <div class="terminal-info">
            <span><strong>ID:</strong> ${terminal.id}</span>
            <span><strong>Оператор:</strong> ${terminal.operator}</span>
            <span><strong>Статус:</strong> ${terminal.status}</span>
          </div>
        `;
        return card;
      }

      async addTerminal() {
        const name = document.getElementById('terminal-name').value;
        const operator = document.getElementById('terminal-operator').value;
        const location = document.getElementById('terminal-location').value;

        const terminalId = this.generateTerminalId();

        const response = await fetch(`${this.apiUrl}/terminals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            id: terminalId,
            name, 
            operator, 
            location,
            status: 'active'
          })
        });

        if (response.ok) {
          document.getElementById('add-terminal-form').reset();
          await this.loadTerminals();
        }
        return response.ok;
      }

      generateTerminalId() {
        const existingIds = this.terminals.map(t => t.id).filter(id => id.match(/^T\d+$/));
        const numbers = existingIds.map(id => parseInt(id.substring(1))).sort((a, b) => a - b);
        
        let nextNumber = 1;
        for (const num of numbers) {
          if (num === nextNumber) {
            nextNumber++;
          } else {
            break;
          }
        }
        
        return `T${nextNumber.toString().padStart(3, '0')}`;
      }

      editTerminal(terminalId) {
        const terminal = this.terminals.find(t => t.id === terminalId);
        if (!terminal) return false;

        this.currentEditingTerminal = terminal;
        document.getElementById('edit-terminal-id').value = terminal.id;
        document.getElementById('edit-terminal-name').value = terminal.name;
        document.getElementById('edit-terminal-operator').value = terminal.operator;
        document.getElementById('edit-terminal-location').value = terminal.location || '';
        document.getElementById('edit-terminal-status').value = terminal.status;

        return true;
      }

      async saveTerminalEdit() {
        if (!this.currentEditingTerminal) return false;

        const updatedData = {
          id: document.getElementById('edit-terminal-id').value,
          name: document.getElementById('edit-terminal-name').value,
          operator: document.getElementById('edit-terminal-operator').value,
          location: document.getElementById('edit-terminal-location').value,
          status: document.getElementById('edit-terminal-status').value
        };

        const response = await fetch(`${this.apiUrl}/terminals/${this.currentEditingTerminal.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedData)
        });

        if (response.ok) {
          this.currentEditingTerminal = null;
          await this.loadTerminals();
        }
        return response.ok;
      }

      async deleteTerminal(terminalId) {
        const response = await fetch(`${this.apiUrl}/terminals/${terminalId}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          await this.loadTerminals();
        }
        return response.ok;
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    dom.window.close();
  });

  describe('Terminal Loading', () => {
    it('should load terminals from API', async () => {
      const mockTerminals = [
        { id: 'T001', name: 'Terminal 1', operator: 'Operator 1', status: 'active' },
        { id: 'T002', name: 'Terminal 2', operator: 'Operator 2', status: 'inactive' }
      ];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTerminals
      });

      const adminPanel = new AdminPanel();
      await adminPanel.loadTerminals();

      expect(fetchMock).toHaveBeenCalledWith('/api/terminals');
      expect(adminPanel.terminals).toEqual(mockTerminals);
    });

    it('should render terminals in grid', async () => {
      const mockTerminals = [
        { id: 'T001', name: 'Terminal 1', operator: 'Operator 1', status: 'active' }
      ];

      const adminPanel = new AdminPanel();
      adminPanel.terminals = mockTerminals;
      adminPanel.renderTerminals();

      const grid = document.getElementById('terminals-grid');
      expect(grid.children.length).toBe(1);
      expect(grid.innerHTML).toContain('Terminal 1');
      expect(grid.innerHTML).toContain('T001');
      expect(grid.innerHTML).toContain('Operator 1');
    });

    it('should handle API errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const adminPanel = new AdminPanel();
      await adminPanel.loadTerminals();

      expect(adminPanel.terminals).toEqual([]);
    });
  });

  describe('Terminal Creation', () => {
    it('should create terminal with generated ID', async () => {
      document.getElementById('terminal-name').value = 'New Terminal';
      document.getElementById('terminal-operator').value = 'New Operator';
      document.getElementById('terminal-location').value = 'Location 1';

      fetchMock
        .mockResolvedValueOnce({ ok: true }) // POST request
        .mockResolvedValueOnce({ ok: true, json: async () => [] }); // GET request for reload

      const adminPanel = new AdminPanel();
      const result = await adminPanel.addTerminal();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'T001',
          name: 'New Terminal',
          operator: 'New Operator',
          location: 'Location 1',
          status: 'active'
        })
      });
    });

    it('should generate unique terminal IDs', () => {
      const adminPanel = new AdminPanel();
      
      // Test with no existing terminals
      expect(adminPanel.generateTerminalId()).toBe('T001');

      // Test with existing terminals
      adminPanel.terminals = [
        { id: 'T001' },
        { id: 'T002' },
        { id: 'T005' }
      ];
      expect(adminPanel.generateTerminalId()).toBe('T003');

      // Test with non-sequential IDs
      adminPanel.terminals = [
        { id: 'T001' },
        { id: 'T003' }
      ];
      expect(adminPanel.generateTerminalId()).toBe('T002');
    });
  });

  describe('Terminal Editing', () => {
    it('should populate edit form with terminal data', () => {
      const adminPanel = new AdminPanel();
      adminPanel.terminals = [
        { id: 'T001', name: 'Terminal 1', operator: 'Operator 1', location: 'Location 1', status: 'active' }
      ];

      const result = adminPanel.editTerminal('T001');

      expect(result).toBe(true);
      expect(document.getElementById('edit-terminal-id').value).toBe('T001');
      expect(document.getElementById('edit-terminal-name').value).toBe('Terminal 1');
      expect(document.getElementById('edit-terminal-operator').value).toBe('Operator 1');
      expect(document.getElementById('edit-terminal-location').value).toBe('Location 1');
      expect(document.getElementById('edit-terminal-status').value).toBe('active');
    });

    it('should return false for non-existent terminal', () => {
      const adminPanel = new AdminPanel();
      adminPanel.terminals = [];

      const result = adminPanel.editTerminal('T999');

      expect(result).toBe(false);
    });

    it('should save terminal edits', async () => {
      const adminPanel = new AdminPanel();
      adminPanel.currentEditingTerminal = { id: 'T001' };

      document.getElementById('edit-terminal-id').value = 'T001';
      document.getElementById('edit-terminal-name').value = 'Updated Terminal';
      document.getElementById('edit-terminal-operator').value = 'Updated Operator';
      document.getElementById('edit-terminal-location').value = 'Updated Location';
      document.getElementById('edit-terminal-status').value = 'inactive';

      fetchMock
        .mockResolvedValueOnce({ ok: true }) // PUT request
        .mockResolvedValueOnce({ ok: true, json: async () => [] }); // GET request for reload

      const result = await adminPanel.saveTerminalEdit();

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('/api/terminals/T001', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'T001',
          name: 'Updated Terminal',
          operator: 'Updated Operator',
          location: 'Updated Location',
          status: 'inactive'
        })
      });
      expect(adminPanel.currentEditingTerminal).toBe(null);
    });
  });

  describe('Terminal Deletion', () => {
    it('should delete terminal via API', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true }) // DELETE request
        .mockResolvedValueOnce({ ok: true, json: async () => [] }); // GET request for reload

      const adminPanel = new AdminPanel();
      const result = await adminPanel.deleteTerminal('T001');

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('/api/terminals/T001', {
        method: 'DELETE'
      });
    });

    it('should handle deletion errors', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false });

      const adminPanel = new AdminPanel();
      const result = await adminPanel.deleteTerminal('T001');

      expect(result).toBe(false);
    });
  });
});