import httpx
import asyncio

async def test_api():
    async with httpx.AsyncClient() as client:
        # Check health
        response = await client.get("http://127.0.0.1:8000/health")
        print("Health Check:", response.json())
        
if __name__ == "__main__":
    asyncio.run(test_api())
