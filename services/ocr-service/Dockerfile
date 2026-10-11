FROM python:3.10-slim

# Install system dependencies for OpenCV and docTR
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv for fast dependency resolution
RUN pip install uv

# Copy requirements and install
COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

# Pre-download docTR models during build so they're baked into the image
# This eliminates the 30-60s cold-start delay on first inference
RUN python -c "\
from doctr.models import ocr_predictor; \
predictor = ocr_predictor(det_arch='db_resnet50', reco_arch='crnn_vgg16_bn', pretrained=True); \
print('Models downloaded successfully')"

# Copy source code
COPY . .

# Expose port
EXPOSE 8000

# Start FastAPI server with 2 workers for concurrent request handling
# Timeout set to 300s to handle slow CPU inference without killing workers
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "300"]
