'use strict';
// Requires reportlab, pypdf and Pillow in the selected Python runtime.
// All generated documents are synthetic. Expected facts live in fixtures/resume/expected.json.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = String.raw`"""Synthetic, deterministic PDF fixtures; gold expectations are authored separately."""
from pathlib import Path
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader, simpleSplit
import os
ROOT = Path(os.environ['RESUME_FIXTURE_ROOT'])
ROOT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('FixtureUnicode', os.environ.get('RESUME_FIXTURE_FONT', 'C:/Windows/Fonts/arial.ttf')))
LEFT = [
    'Zoë Núñez',
    'zoe@example.invalid',
    '+1 (202) 555-0142',
    'https://github.com/fixture-resume',
    'SUMMARY',
    'Software engineer building reliable customer applications.',
    'EXPERIENCE',
    'Engineer Jan 2020 - Jan 2022',
    'Engineer Jul 2021 - Jul 2023',
    'Built Python services and reduced latency by 30% for 100 users.',
    'Developed automated deployment workflows with Docker.',
    'PROJECTS',
    'Created an Angular dashboard with TypeScript and SQL.',
    'Built reliable application monitoring for customer support teams.',
]
RIGHT = [
    'SKILLS',
    'Python, Angular, TypeScript, SQL, Docker, Node.js',
    'EDUCATION',
    'Bachelor of Computer Science completed in 2019.',
    'CERTIFICATIONS',
    'AWS Certified Developer',
    'ACHIEVEMENTS',
    'Improved test coverage by 25% across customer APIs.',
    'Maintained technical documentation and reviewed team changes.',
]

def draw(name, columns=False, shift=0, pages=1, blank=False):
    c = Canvas(str(ROOT / name), pagesize=(612, 792), invariant=1, pageCompression=1)
    for _ in range(pages):
        if not blank:
            c.setFont('FixtureUnicode', 9 if columns else 11)
            if columns:
                for x, lines in [(35 + shift, LEFT), (325 + shift, RIGHT)]:
                    y = 750
                    for line in lines:
                        for part in simpleSplit(line, 'FixtureUnicode', 9, 250):
                            c.drawString(x, y, part)
                            y -= 14
                        y -= 9
            else:
                for i, line in enumerate(LEFT + RIGHT):
                    c.drawString(35 + shift, 750 - i * 24, line)
            c.linkURL('https://hidden.example.invalid/profile', (35, 35, 150, 50), relative=0)
        c.showPage()
    c.save()


draw('standard.pdf')
draw('layout-shift.pdf', shift=10)
draw('columns.pdf', columns=True)
draw('empty.pdf', blank=True)
draw('page-limit.pdf', pages=51, blank=True)
image = Image.new('RGB', (600, 800), 'white')
ImageDraw.Draw(image).text((30, 40), 'Synthetic scanned resume: Python Engineer', fill='black')
c = Canvas(str(ROOT / 'scanned.pdf'), invariant=1)
c.drawImage(ImageReader(image), 0, 0, width=600, height=800)
c.showPage()
c.save()
writer = PdfWriter()
writer.append(PdfReader(ROOT / 'standard.pdf'))
writer.encrypt('fixture-only-password')
with (ROOT / 'encrypted.pdf').open('wb') as f:
    writer.write(f)
(ROOT / 'corrupt.pdf').write_bytes(b'%PDF-1.4\ncorrupt synthetic fixture')
`;
const result = spawnSync(process.env.RESUME_FIXTURE_PYTHON || 'python', ['-c', source], {
  env: {
    ...process.env,
    RESUME_FIXTURE_ROOT: path.resolve(__dirname, '../src/tests/fixtures/resume')
  },
  encoding: 'utf8',
  windowsHide: true
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || 'Synthetic PDF generation failed.');
