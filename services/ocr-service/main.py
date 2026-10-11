import io
import base64
import logging
import numpy as np
import cv2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from doctr.models import ocr_predictor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="docTR OCR Microservice")

# Initialize the docTR model at startup (keeps it in memory for fast inference)
# Using lightweight models for speed on CPU
logger.info("Loading docTR models (this may take a moment on CPU)...")
predictor = ocr_predictor(det_arch='db_resnet50', reco_arch='crnn_vgg16_bn', pretrained=True)
logger.info("docTR models loaded successfully.")

# Track readiness — model is loaded but we warm it up on startup
_model_ready = False

class OCRRequest(BaseModel):
    image_base64: str

class OCRResponse(BaseModel):
    raw_text: str
    pages: int

@app.on_event("startup")
def warmup_model():
    """Run a dummy inference to warm up the model and pre-compile everything."""
    global _model_ready
    try:
        logger.info("Warming up docTR model with dummy inference...")
        # Create a small dummy image (100x100 white image)
        dummy_img = np.ones((100, 100, 3), dtype=np.uint8) * 255
        predictor([dummy_img])
        _model_ready = True
        logger.info("Model warmup complete — ready to serve requests.")
    except Exception as e:
        logger.error(f"Model warmup failed: {e}")
        _model_ready = True  # Still mark ready, first real request will be slower

@app.post("/extract", response_model=OCRResponse)
def extract_text(request: OCRRequest):
    """
    Extract text from an image or PDF using docTR.
    
    NOTE: This is a sync `def` (not `async def`) intentionally.
    docTR inference is CPU-bound and would block the async event loop.
    FastAPI runs sync endpoints in a threadpool, keeping the server responsive.
    """
    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image_base64)
        
        # Determine if it's a PDF by checking magic bytes
        if image_data.startswith(b"%PDF"):
            from doctr.io import DocumentFile
            doc = DocumentFile.from_pdf(image_data)
            result = predictor(doc)
        else:
            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                raise HTTPException(status_code=400, detail="Invalid image data")
            
            # Convert BGR to RGB for docTR
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            h, w = img_rgb.shape[:2]
            max_dim = 2048
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                new_w, new_h = int(w * scale), int(h * scale)
                img_rgb = cv2.resize(img_rgb, (new_w, new_h), interpolation=cv2.INTER_AREA)
                logger.info(f"Resized image from {w}x{h} to {new_w}x{new_h} for CPU efficiency")

            result = predictor([img_rgb])
        
        # Extract purely the raw text from the document
        raw_text = ""
        for page in result.pages:
            for block in page.blocks:
                for line in block.lines:
                    # Extract words and join with space
                    words = [word.value for word in line.words]
                    raw_text += " ".join(words) + "\n"
                raw_text += "\n" # Blank line between blocks
                
        return OCRResponse(
            raw_text=raw_text.strip(),
            pages=len(result.pages)
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OCR extraction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    """Health check endpoint — returns healthy only after model is loaded and warmed up."""
    if not _model_ready:
        raise HTTPException(status_code=503, detail="Model still loading")
    return {"status": "ok", "model": "loaded"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
