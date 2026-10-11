@echo off
echo Checking Sprint 0.1 deployment and release freeze status...
node scripts/release-freeze-guard.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [BLOCKED] Production deployment halted by release freeze policy.
    pause
    exit /b 1
)

echo Starting SmartAccountingAI Production Stack...
docker compose -f docker-compose.prod.yml up -d --build
echo.
echo Application is starting. Waiting for health checks to pass.
echo Available at http://localhost:3000 once healthy.
echo.
echo To view logs: docker compose -f docker-compose.prod.yml logs -f nextjs
pause
