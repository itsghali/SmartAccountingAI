import io
import base64
import logging
import numpy as np
import cv2
import threading
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from doctr.models import ocr_predictor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="docTR OCR Microservice")

# Global model state
predictor = None
_model_ready = False
_model_init_error: str | None = None
_init_lock = threading.Lock()

def initialize_and_warmup():
    """Load docTR models and execute warmup inference. Keeps service non-ready if anything fails."""
    global predictor, _model_ready, _model_init_error
    with _init_lock:
        if _model_ready:
            return
        try:
            logger.info("Loading docTR models (this may take a moment on CPU)...")
            loaded_predictor = ocr_predictor(det_arch='db_resnet50', reco_arch='crnn_vgg16_bn', pretrained=True)
            logger.info("docTR models loaded. Warming up with dummy inference...")
            dummy_img = np.ones((100, 100, 3), dtype=np.uint8) * 255
            loaded_predictor([dummy_img])
            predictor = loaded_predictor
            _model_ready = True
            _model_init_error = None
            logger.info("Model warmup complete — ready to serve requests.")
        except Exception as e:
            logger.error(f"Model initialization or warmup failed: {e}", exc_info=True)
            _model_ready = False
            _model_init_error = str(e)

@app.on_event("startup")
def startup_event():
    """Start model initialization and warmup in background thread so FastAPI listens immediately for healthchecks."""
    t = threading.Thread(target=initialize_and_warmup, daemon=True, name="OCR-Initializer")
    t.start()

class OCRRequest(BaseModel):
    image_base64: str

class OCRResponse(BaseModel):
    raw_text: str
    pages: int

@app.post("/extract", response_model=OCRResponse)
def extract_text(request: OCRRequest):
    """
    Extract text from an image or PDF using docTR.
    
    NOTE: This is a sync `def` (not `async def`) intentionally.
    docTR inference is CPU-bound and would block the async event loop.
    FastAPI runs sync endpoints in a threadpool, keeping the server responsive.
    """
    if not _model_ready or predictor is None:
        if _model_init_error:
            raise HTTPException(status_code=503, detail=f"OCR model initialization failed: {_model_init_error}")
        raise HTTPException(status_code=503, detail="OCR service is still initializing")

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
        if _model_init_error:
            raise HTTPException(status_code=503, detail=f"Model initialization failed: {_model_init_error}")
        raise HTTPException(status_code=503, detail="Model still loading")
    return {"status": "ok", "model": "loaded"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
