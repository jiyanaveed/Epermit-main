/**
 * Renders the first page of a PDF to a PNG image (base64).
 * Used for AI compliance analysis so the Vision API receives an image.
 * Creates a Worker with the worker URL per call so we never assign to
 * GlobalWorkerOptions (which is read-only in the ESM module).
 */
import * as pdfjsLib from "pdfjs-dist";
// Resolve worker from node_modules so we never touch GlobalWorkerOptions
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export async function pdfFirstPageToImageBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const worker = new Worker(pdfjsWorkerUrl, { type: "module" });
  const pdfWorker = new pdfjsLib.PDFWorker({ port: worker });
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    worker: pdfWorker,
  });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(1);
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    worker.terminate();
    throw new Error("Could not get canvas context");
  }
  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
  });
  await renderTask.promise;
  worker.terminate();
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Failed to encode PDF page as image");
  return { base64, mimeType: "image/png" };
}
