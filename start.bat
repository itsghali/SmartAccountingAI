@echo off
echo Starting SmartAccountingAI Development Environment...

echo.
echo 1. Starting PostgreSQL database container...
docker compose up -d

echo.
echo 2. Ensuring database schema is synced...
call npm run db:push

echo.
echo 3. Starting Next.js development server...
start http://localhost:3000
call npm run dev
