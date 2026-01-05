#!/bin/bash

# Prime Champs - Start All Services
# This script starts both the Python agent server and the Next.js dashboard

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Prime Champs - Starting Services    ${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if we're in the right directory
if [ ! -f "backend/server.py" ] || [ ! -d "dashboard" ]; then
    echo -e "${YELLOW}Error: Run this script from the Prime Champs root directory${NC}"
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    kill $AGENT_PID 2>/dev/null || true
    kill $DASHBOARD_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start Python Agent Server
echo -e "\n${GREEN}Starting Python Agent Server on port 8000...${NC}"
cd backend
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 &
AGENT_PID=$!
cd ..

# Wait a moment for Python server to start
sleep 2

# Check if Python server is running
if ! kill -0 $AGENT_PID 2>/dev/null; then
    echo -e "${YELLOW}Warning: Agent server may have failed to start${NC}"
fi

# Start Next.js Dashboard
echo -e "\n${GREEN}Starting Next.js Dashboard on port 3000...${NC}"
cd dashboard
npm run dev &
DASHBOARD_PID=$!
cd ..

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}   Services Started Successfully!       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "  Agent Server: ${BLUE}http://localhost:8000${NC}"
echo -e "  Dashboard:    ${BLUE}http://localhost:3000${NC}"
echo -e ""
echo -e "  Press Ctrl+C to stop all services"
echo -e ""

# Wait for processes
wait
