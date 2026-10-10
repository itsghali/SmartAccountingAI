# docTR OCR Microservice

This microservice uses [Mindee docTR](https://github.com/mindee/doctr) to perform extremely fast, CPU-friendly OCR on uploaded invoices and financial documents. 

It runs as a standalone FastAPI server that the Next.js backend communicates with. This architecture entirely eliminates the need for an expensive Vision GPU LLM (like LLaVA), allowing the platform to process documents efficiently on any machine.

## Prerequisites
- Python 3.9+
- pip

## Installation

We recommend using [uv](https://github.com/astral-sh/uv) for lightning-fast Python package installation.

1. Create a virtual environment and activate it:
```bash
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

2. Install the dependencies:
```bash
uv pip install -r requirements.txt
```

*(Note: The requirements install the CPU-optimized version of PyTorch by default via `python-doctr[torch]`. If you have a CUDA GPU, you can install the CUDA version of PyTorch for even faster inference).*

## Running the Service

Start the FastAPI server:
```bash
python main.py
```

The service will start on `http://localhost:8000`. 
- **Health Check:** `GET http://localhost:8000/health`
- **Extraction:** `POST http://localhost:8000/extract`

## How it Integrates with Next.js
The `DOCUMENT_PROCESSOR` agent in the Next.js app (`src/server/agents/orchestrator/graph.ts`) is pre-configured to send Base64 images to `http://localhost:8000/extract`. 
It takes the raw text returned by this service and feeds it to your configured text LLM (like Groq or a local Llama-3-8B) to structure it into JSON.
