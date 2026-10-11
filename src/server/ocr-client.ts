const OCR_TIMEOUT_MS = 120_000; // 120s — docTR on CPU can be slow, especially on first inference
const OCR_MAX_RETRIES = 2; // up to 3 total attempts (1 initial + 2 retries)
const OCR_RETRY_BASE_DELAY_MS = 2_000;

export async function extractDocumentWithOCR(fileBuffer: Buffer, _filename: string) {
  void _filename;
  const imageBase64 = fileBuffer.toString('base64');
  const ocrUrl = process.env.OCR_SERVICE_URL || 'http://localhost:8000/extract';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= OCR_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = OCR_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[OCR] Retry attempt ${attempt}/${OCR_MAX_RETRIES} after ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    try {
      const response = await fetch(ocrUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR extraction failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === 'AbortError') {
        console.error(`[OCR] Request timed out after ${OCR_TIMEOUT_MS / 1000}s (attempt ${attempt + 1})`);
      } else {
        console.error(`[OCR] Request failed (attempt ${attempt + 1}):`, lastError.message);
      }

      // Don't retry on non-transient errors (4xx)
      if (lastError.message.includes('400') || lastError.message.includes('422')) {
        break;
      }
    }
  }

  throw new Error(
    `OCR service unavailable after ${OCR_MAX_RETRIES + 1} attempts: ${lastError?.message || 'Unknown error'}`
  );
}
