# MCD-Level-1 3.docx — mining report (step 1)

Source: Drive file `1e7d-bCZz8wlz1bZ9DGZgV0NBMPT45pTO`, certshero dump "MuleSoft MCD-Level-1, 226 questions, v13.0".
Docx: 15,029,022 bytes, 309 media (288 jpeg, 21 png), 226 questions numbered 1..226 (sequential).

## Structure
`Question: N` → stem (text + exhibit images) → options → `Explanation:` → `Answer: X` → explanation text/images.
Options come in 3 styles: `A. text`, `A)` + image, or unlabeled lines (no letters).

## Images
- 280 images are referenced in order of appearance; the other 29 are VML fallback copies of the same figures (ignored).
- Many "Refer to the exhibit" questions have image options (A)/B)/C)/D) + image).
- Some images sit in the explanation (kept as explanation images, not question images).

## Status of `mined.json` (intermediate format, not yet the app format)
- 192 questions: 4 options parsed cleanly.
- ~19 questions still need manual fix-up (options glued in one paragraph, or options inside an image):
  20, 52, 62, 94, 96, 102, 112, 156, 174, 187, 191, 194, 196, 197, 202, 205 (+ 46, 169, 172 have no answer).
- Missing answer: 46, 169, 172.
- Multi-answer: 216 ("B C"). The app needs `selectCount` for it; no other "choose N" in stems.
- 22 answers carry a contributor name: Q1 "(Pablo)", Q206–226 "(Marco)" → treat as unverified.

## Explanation reliability signals
- 63 questions have no explanation at all.
- Explanations cite "option N" by position in a different order than the answer letter in 5 cases (13, 27, 52, 55, 103) → positional refs are from a shuffled source, not reliable.
- Typos from OCR/PDF conversion in text ("Therecordsprocessedbyall...", "application/] son", "[1,2,31"): need cleanup.
