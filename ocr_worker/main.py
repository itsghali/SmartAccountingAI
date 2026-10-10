from fastapi import FastAPI, UploadFile, File, HTTPException
import uvicorn
from doctr.io import DocumentFile
from doctr.models import ocr_predictor

app = FastAPI(title="SmartAccounting OCR API")

# Initialize the model (downloads weights on first run)
predictor = ocr_predictor(det_arch='db_resnet50', reco_arch='crnn_vgg16_bn', pretrained=True)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "ocr_worker"}

@app.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    try:
        content = await file.read()
        
        # Parse based on extension/type
        if file.filename.lower().endswith(".pdf"):
            doc = DocumentFile.from_pdf(content)
        else:
            doc = DocumentFile.from_images(content)
            
        # Perform inference
        result = predictor(doc)
        
        return {
            "filename": file.filename,
            "status": "success",
            "extraction": result.export()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000)
