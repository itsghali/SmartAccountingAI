import argparse
from pathlib import Path

try:
    import fitz  # type: ignore
except ImportError:
    fitz = None

if fitz is None or not hasattr(fitz, "open"):
    try:
        import pymupdf as fitz  # type: ignore
    except ImportError:
        fitz = None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-pages", type=int, default=3)
    parser.add_argument("--dpi", type=int, default=300)
    args = parser.parse_args()

    if fitz is None or not hasattr(fitz, "open"):
        raise RuntimeError(
            "PyMuPDF is not available. Install a working PyMuPDF package or use the pdftoppm fallback."
        )

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    document = fitz.open(input_path)
    page_count = document.page_count if args.max_pages <= 0 else min(max(1, args.max_pages), document.page_count)

    if page_count <= 0:
        raise RuntimeError("The PDF contains no renderable pages.")

    dpi = max(72, args.dpi)
    scale = dpi / 72
    matrix = fitz.Matrix(scale, scale)
    for page_index in range(page_count):
        page = document.load_page(page_index)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        pixmap.save(output_dir / f"page-{page_index + 1}.png")

    document.close()


if __name__ == "__main__":
    main()
