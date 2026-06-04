import os
import time
import fitz  # pymupdf

ONE_SHOT_PAGE_LIMIT = 100


def count_pages(filepath: str) -> int:
    try:
        doc = fitz.open(filepath)
        n = len(doc)
        doc.close()
        return n
    except Exception:
        return 999


def should_use_oneshot(pdf_paths: list[str]) -> bool:
    if len(pdf_paths) != 1:
        return False
    return count_pages(pdf_paths[0]) <= ONE_SHOT_PAGE_LIMIT


def upload_pdf(client, filepath: str):
    """Upload a PDF to Gemini Files API. Returns file object."""
    for attempt in range(3):
        try:
            f = client.files.upload(file=filepath)
            # Poll until active
            while f.state and f.state.name == "PROCESSING":
                time.sleep(2)
                f = client.files.get(name=f.name)
            return f
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def ocr_page_with_gemini(client, filepath: str, page_num: int, model_name: str) -> str:
    """Gemini vision OCR for a single page — handles handwriting."""
    import base64
    from google.genai import types

    doc = fitz.open(filepath)
    page = doc[page_num - 1]
    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
    img_bytes = pix.tobytes("png")
    doc.close()

    response = client.models.generate_content(
        model=model_name,
        contents=[
            types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
            "Transcribe ALL text from this medical document page exactly as written, "
            "including handwritten content. Mark illegible text as [ILLEGIBLE]. "
            "Preserve structure (tables, lists, sections). Output plain text only."
        ]
    )
    return response.text


def read_document_for_agent(client, filepath: str, model_name: str) -> str:
    """
    Smart extraction: try embedded text first.
    If a page looks handwritten (little embedded text), OCR it with Gemini vision.
    """
    if not os.path.exists(filepath):
        return f"[ERROR: File not found: {filepath}]"

    doc = fitz.open(filepath)
    total_pages = len(doc)
    doc.close()

    pages_text = []
    for page_num in range(1, total_pages + 1):
        doc = fitz.open(filepath)
        embedded = doc[page_num - 1].get_text().strip()
        doc.close()

        if len(embedded) > 100:
            pages_text.append(f"[Page {page_num}]\n{embedded}")
        else:
            try:
                ocr = ocr_page_with_gemini(client, filepath, page_num, model_name)
                pages_text.append(f"[Page {page_num} — OCR]\n{ocr}")
            except Exception as e:
                pages_text.append(f"[Page {page_num} — OCR FAILED: {e}]")

    return "\n\n".join(pages_text)
