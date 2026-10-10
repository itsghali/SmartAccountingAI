@echo off
echo Starting SmartAccountingAI...
docker-compose -f docker-compose.prod.yml up -d --build
echo.
echo Application is starting. Please wait for the database and web server to initialize.
echo Once running, the application will be available at http://localhost:3000
echo.
echo To view logs, run: docker-compose -f docker-compose.prod.yml logs -f app
pause
