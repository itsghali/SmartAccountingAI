import sys
import urllib.request
import urllib.error

def check_health(url: str = "http://localhost:8000/health", timeout: float = 5.0) -> None:
    """
    Check OCR health endpoint.
    Exits with 0 if and only if the endpoint returns HTTP 200 OK.
    Exits with 1 on connection errors, timeouts, or non-200 responses (such as 503 while models load).
    """
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.getcode() == 200:
                sys.exit(0)
            else:
                sys.exit(1)
    except Exception:
        sys.exit(1)

if __name__ == "__main__":
    check_health()
