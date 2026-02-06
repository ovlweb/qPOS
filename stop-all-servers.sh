#!/bin/bash

# Payment Terminal System - Stop All Servers Script
# This script stops all running services gracefully

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to kill process by PID file
kill_by_pid_file() {
    local service_name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            print_status "Stopping $service_name (PID: $pid)..."
            kill -TERM "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
            sleep 2
            
            # Check if process is still running
            if kill -0 "$pid" 2>/dev/null; then
                print_warning "Force killing $service_name (PID: $pid)..."
                kill -9 "$pid" 2>/dev/null || true
            fi
            
            print_success "✅ $service_name stopped"
        else
            print_warning "$service_name PID file exists but process is not running"
        fi
        rm -f "$pid_file"
    else
        print_status "$service_name PID file not found, checking by port..."
    fi
}

# Function to kill process by port
kill_by_port() {
    local service_name=$1
    local port=$2
    
    local pid=$(lsof -ti:$port 2>/dev/null || echo "")
    if [ ! -z "$pid" ]; then
        print_status "Stopping $service_name on port $port (PID: $pid)..."
        kill -TERM "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
        sleep 1
        print_success "✅ $service_name stopped"
    else
        print_status "$service_name is not running on port $port"
    fi
}

print_status "🛑 Stopping Payment Terminal System Services..."
print_status "==============================================="

# Create directories if they don't exist
mkdir -p pids logs

# Stop services in reverse order (opposite of startup)

# Step 1: Stop QWallet Notification Service (Port 3003)
print_status "Step 1: Stopping QWallet Notification Service..."
kill_by_pid_file "QWallet Notification Service" "pids/notification-service.pid"
kill_by_port "QWallet Notification Service" "3003"

# Step 2: Stop QWallet Server (Port 3000)
print_status "Step 2: Stopping QWallet Server..."
kill_by_pid_file "QWallet Server" "pids/qwallet-server.pid"
kill_by_port "QWallet Server" "3000"

# Step 3: Stop Payment Terminal System (Port 3030)
print_status "Step 3: Stopping Payment Terminal System..."
kill_by_pid_file "Payment Terminal System" "pids/terminal-system.pid"
kill_by_port "Payment Terminal System" "3030"

# Step 4: Clean up any remaining processes
print_status "Step 4: Cleaning up any remaining processes..."

# Kill any node processes that might be related to our services
for process in $(ps aux | grep -E "(src/server\.js|qwallet-server-es\.js|qwallet-notification-service\.js)" | grep -v grep | awk '{print $2}' 2>/dev/null || echo ""); do
    if [ ! -z "$process" ]; then
        print_warning "Killing remaining process: $process"
        kill -9 "$process" 2>/dev/null || true
    fi
done

# Step 5: Verify all services are stopped
print_status "Step 5: Verifying all services are stopped..."

services_stopped=true

if lsof -Pi :3030 -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "❌ Port 3030 is still in use"
    services_stopped=false
fi

if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "❌ Port 3000 is still in use"
    services_stopped=false
fi

if lsof -Pi :3003 -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "❌ Port 3003 is still in use"
    services_stopped=false
fi

if [ "$services_stopped" = true ]; then
    print_success "🎉 All services stopped successfully!"
    print_status "📁 Log files preserved in logs/ directory"
    print_status "🔄 You can restart services using: ./start-all-servers.sh"
else
    print_error "❌ Some services may still be running. Check manually with:"
    print_error "    lsof -i :3030,3000,3003"
fi

# Clean up PID files
rm -f pids/*.pid

print_status "✅ Cleanup complete!"