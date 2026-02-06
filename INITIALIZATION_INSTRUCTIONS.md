# Startup Instructions

## Quick Start

### 1. Start Terminal System

```bash
./initialization.sh
```

This will start the POS System on port 3030.

### 2. Start QWallet Server (Separately)

**Important:** The QWallet server must be started in its own folder.

Navigate to your QWallet folder and run:

```bash
cd /path/to/qwallet
node qwallet-server-es.mjs
```

The QWallet server should run on port 3000 for integration to work.

## What Gets Started

### Terminal System (Port 3030)
- Admin Panel: http://localhost:3030/admin
- Terminal T900: http://localhost:3030/terminal/T900
- Terminal T001: http://localhost:3030/terminal/T001

**Credentials:**
- Admin: `admin` / `admin123`
- T900: `2535`
- T001: `password123`

### QWallet Server (Port 3000)
Must be started separately in the QWallet folder.

## Why Separate Servers?

The Terminal System and QWallet server are kept separate because:

1. **Different Repositories**: QWallet is typically in its own repository
2. **Independent Deployment**: Each can be deployed and scaled independently
3. **Flexibility**: QWallet can serve multiple terminal systems
4. **Development**: Easier to develop and test each component separately

## Integration

Once both servers are running:

1. Terminal System listens on port 3030
2. QWallet Server listens on port 3000
3. Terminal System connects to QWallet via HTTP
4. QWallet notifies Terminal System via admin API
5. Terminal System updates terminals via WebSocket

## Stopping Servers

### Stop Terminal System
```bash
./stop-all-servers.sh
```

Or find and kill the process:
```bash
lsof -ti:3030 | xargs kill -9
```

### Stop QWallet Server
In the QWallet folder:
```bash
pkill -f "qwallet-server-es.mjs"
```

Or:
```bash
lsof -ti:3000 | xargs kill -9
```

## Troubleshooting

### Terminal System Won't Start

Check the logs:
```bash
tail -f logs/terminal-system.log
```

Common issues:
- Port 3030 already in use
- Database locked
- Missing dependencies

### QWallet Server Won't Start

Check if port 3000 is available:
```bash
lsof -i :3000
```

Make sure you're in the correct QWallet folder.

### Integration Not Working

1. Verify both servers are running:
   ```bash
   curl http://localhost:3030/health
   curl http://localhost:3000/api/health
   ```

2. Check QWallet can reach Terminal System:
   ```bash
   # From QWallet folder
   curl http://localhost:3030/api/admin/auth \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   ```

3. Check logs for errors

## Development Mode

For development, you can run each server in separate terminals:

**Terminal 1 - Terminal System:**
```bash
node start-server-simple.js
```

**Terminal 2 - QWallet Server:**
```bash
cd /path/to/qwallet
node qwallet-server-es.mjs
```

This allows you to see logs in real-time and restart servers independently.

## Production Deployment

For production, consider using:

- **PM2** for process management
- **Nginx** for reverse proxy
- **Docker** for containerization
- **Environment variables** for configuration

Example PM2 setup:

```bash
# Terminal System
pm2 start start-server-simple.js --name terminal-system

# QWallet Server (in QWallet folder)
pm2 start qwallet-server-es.mjs --name qwallet-server

# Save configuration
pm2 save
pm2 startup
```

## Summary

1. ✅ Start Terminal System: `./start-both-servers.sh`
2. ✅ Start QWallet Server: `cd /path/to/qwallet && node qwallet-server-es.mjs`
3. ✅ Access Admin Panel: http://localhost:3030/admin
4. ✅ Access Terminal: http://localhost:3030/terminal/T900
5. ✅ Both servers must be running for full functionality
