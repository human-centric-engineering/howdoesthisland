"""
Builds the binary intake fixtures (t-15): the PDFs, the DOCX and the PPTX.

The text fixtures (.html, .md, .txt) are written by hand beside this script.
Re-run only to change a fixture; the tests read the committed files.

    python3 -m venv /tmp/fx && /tmp/fx/bin/pip install python-pptx python-docx reportlab pillow
    /tmp/fx/bin/python tests/fixtures/app/intake/make-fixtures.py

The deck is built the way an edited deck ends up: its slide FILES are not in
presentation order (slide2.xml is shown last), and one slide is hidden. That is
what the PPTX extractor must get right, so the fixture has to carry it.
"""

import io
import os

from docx import Document
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.util import Inches
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))


def out(name):
    return os.path.join(HERE, name)


# ── PPTX ────────────────────────────────────────────────────────────────────
def make_deck():
    prs = Presentation()
    prs.core_properties.title = "Harbour Seed Round"
    layout = prs.slide_layouts[1]  # Title and Content

    def add(title, body, notes=None):
        slide = prs.slides.add_slide(layout)
        slide.shapes.title.text = title
        slide.placeholders[1].text = body
        if notes:
            slide.notes_slide.notes_text_frame.text = notes
        return slide

    # Created in this order → slide1.xml, slide2.xml, slide3.xml, slide4.xml.
    add(
        "The problem",
        "Small ports lose a day per vessel to paperwork.\nNobody owns the handover.",
        notes="Open with the Falmouth story. Pause after the number.",
    )
    add(
        "The ask",
        "We are raising 1.2 million to reach twelve ports.",
        notes="Name the lead investor only if asked.",
    )
    add("Our answer", "One shared berth plan that every agent can edit.")
    hidden = add("Backup appendix", "Unit economics by port size.")
    hidden._element.set("show", "0")

    # Presentation order: problem, answer, ask, appendix (hidden).
    ids = prs.slides._sldIdLst
    entries = list(ids)
    ids.remove(entries[1])
    ids.insert(2, entries[1])

    prs.save(out("deck.pptx"))


# ── DOCX ────────────────────────────────────────────────────────────────────
def make_docx():
    doc = Document()
    doc.core_properties.title = "Quarterly letter"
    doc.add_heading("Quarterly letter to customers", level=1)
    doc.add_paragraph(
        "This quarter we shipped the berth planner to four new harbours. "
        "Turnaround fell by a third where it was used every day."
    )
    doc.add_heading("What changes next", level=2)
    doc.add_paragraph("From January, every agent sees the same plan at the same time.")
    doc.save(out("letter.docx"))


# ── PDFs ────────────────────────────────────────────────────────────────────
def make_text_pdf():
    c = canvas.Canvas(out("report.pdf"), pagesize=A4)
    c.setTitle("Harbour annual report")
    pages = [
        [
            "Harbour annual report",
            "The harbour handled more vessels this year than in any year before it.",
            "Most of the growth came from smaller cargo ships on the coastal route.",
        ],
        [
            "Outlook",
            "Next year we expect steady growth, with two new berths opening in spring.",
            "The board thanks every crew that worked through the winter storms.",
        ],
    ]
    for lines in pages:
        y = 780
        for line in lines:
            c.drawString(72, y, line)
            y -= 20
        c.showPage()
    c.save()


def make_scanned_pdf():
    """A page that is only a picture of text: what a scanner produces."""
    img = Image.new("L", (600, 200), 255)
    ImageDraw.Draw(img).text((20, 80), "This page was scanned, not typed.", fill=0)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    c = canvas.Canvas(out("scanned.pdf"), pagesize=A4)
    c.drawImage(ImageReader(buf), 72, 500, width=450, height=150)
    c.showPage()
    c.save()


def make_empty_pdf():
    c = canvas.Canvas(out("empty.pdf"), pagesize=A4)
    c.showPage()
    c.save()


if __name__ == "__main__":
    make_deck()
    make_docx()
    make_text_pdf()
    make_scanned_pdf()
    make_empty_pdf()
    print("fixtures written to", HERE)
