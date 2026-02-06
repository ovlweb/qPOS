#!/bin/bash
# Start Payment Terminal System

echo "🚀 Starting up qPOS..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Kill any existing node processes on port 3030
echo "🧹 Cleaning up existing processes..."
lsof -ti:3030 | xargs kill -9 2>/dev/null || true
sleep 1

# Start Terminal System
echo "🎯 Terminal System is starting (Port 3030)..."
node start-server-simple.js > logs/terminal-system.log 2>&1 &
TERMINAL_PID=$!
echo "   PID: $TERMINAL_PID"

# Wait for Terminal System to start
sleep 3

# Check if Terminal System is running
if curl -s http://localhost:3030/health > /dev/null; then
    echo "   ✅ Terminal System started successfully"
else
    echo "   ❌ Terminal System failed to start"
    echo "   Check logs/terminal-system.log for details"
    exit 1
fi

echo ""
echo "✅ Terminal System is running!"
echo ""
echo "📍 URLs:"
echo "   Admin Panel:  http://localhost:3030/admin"
echo "   Terminal T900: http://localhost:3030/terminal/T900"
echo "   Terminal T001: http://localhost:3030/terminal/T001"
echo ""
echo "🔐 Credentials:"
echo "   Admin:    admin / admin123"
echo "   T900:     2535"
echo "   T001:     password123"
echo ""
echo "📊 Process ID:"
echo "   Terminal System: $TERMINAL_PID"
echo ""
echo "📝 Logs:"
echo "   Terminal System: logs/terminal-system.log"
echo ""
echo "🛑 To stop server:"
echo "   kill $TERMINAL_PID"
echo "   or run: ./stop-all-servers.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  IMPORTANT: QWallet Server is needed to run separately"
echo ""
echo "If you want to test QR System, you need to start the QWallet server separately."
echo ""
echo "📍 Navigate to your QWallet folder and run:"
echo ""
echo "   cd /path/to/qwallet"
echo "   node qwallet-server-es.mjs"
echo ""
echo "The QWallet server should run on port 3000 for integration to work."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
