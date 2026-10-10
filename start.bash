#!/bin/bash
echo "Starting SmartAccountingAI Development Environment..."

echo "1. Starting PostgreSQL database container..."
docker compose up -d

echo "2. Ensuring database schema is synced..."
npm run db:push

echo "3. Starting Next.js development server..."
# Opens the browser automatically on macOS/Linux
if which xdg-open > /dev/null; then
  xdg-open http://localhost:3000 &
elif which open > /dev/null; then
  open http://localhost:3000 &
fi

npm run dev
