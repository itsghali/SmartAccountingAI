import io
import base64
import numpy as np
import cv2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from doctr.models import ocr_predictor

app = FastAPI(title="docTR OCR Microservice")

# Initialize the docTR model at startup (keeps it in memory for fast inference)
# Using lightweight models for speed on CPU
predictor = ocr_predictor(det_arch='db_resnet50', reco_arch='crnn_vgg16_bn', pretrained=True)

class OCRRequest(BaseModel):
    image_base64: str

class OCRResponse(BaseModel):
    raw_text: str
    pages: int

@app.post("/extract", response_model=OCRResponse)
async def extract_text(request: OCRRequest):
    try:
        # Decode base64 image
        image_data = base64.b64decode(request.image_base64)
        
        # Convert to numpy array for docTR
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image data")

        # Run OCR prediction
        # Pass it as a list containing one image
        result = predictor([img])
        
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
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health_check():
    return {"status": "ok", "model": "loaded"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
