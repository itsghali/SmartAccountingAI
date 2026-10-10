export async function extractDocumentWithOCR(fileBuffer: Buffer, filename: string) {
  const blob = new Blob([new Uint8Array(fileBuffer)]);
  const formData = new FormData();
  formData.append('file', blob, filename);

  try {
    const response = await fetch('http://127.0.0.1:8000/extract', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OCR extraction failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data.extraction;
  } catch (error) {
    console.error('Error connecting to OCR FastAPI worker:', error);
    throw error;
  }
}
