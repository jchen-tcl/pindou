"""Local algorithm comparison using Pillow sampling (not a WeChat Canvas emulator).

Usage: python scripts/compare-image.py input.webp output_directory [grid ...]
Requires Pillow and node on PATH. The source image is read only.
"""
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageDraw, ImageOps

source = Image.open(sys.argv[1]).convert('RGBA')
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
runner = r"""
const fs = require('node:fs');
const { quantize, normalizeStyle } = require('./utils/quantize');
const { quantizeFlat } = require('./utils/flat');
const { getPalette } = require('./utils/colors');
const palette = getPalette('221').map((c,index) => ({ ...c, index,
  rgb: c.code.slice(1).match(/../g).map(v => parseInt(v,16)) }));
const input = JSON.parse(fs.readFileSync(0,'utf8'));
const start = performance.now();
const before = quantize(input.small.map(rgb => normalizeStyle(...rgb,'cute')), palette,16);
const middle = performance.now();
const after = quantizeFlat(input.large,input.sampleSize,input.grid,palette,16);
const end = performance.now();
process.stdout.write(JSON.stringify({ before: before.map(c=>c.rgb),after: after.map(c=>c.rgb),
  beforeColors: [...new Set(before.map(c=>c.id))],afterColors: [...new Set(after.map(c=>c.id))],
  beforeMs: middle-start,afterMs:end-middle }));
"""

def sample(size):
    resized = ImageOps.contain(source, (size, size), Image.Resampling.BILINEAR)
    canvas = Image.new('RGBA', (size, size), 'white')
    canvas.alpha_composite(resized, ((size-resized.width)//2, (size-resized.height)//2))
    rgb = canvas.convert('RGB')
    return list(rgb.get_flattened_data() if hasattr(rgb, 'get_flattened_data') else rgb.getdata())

report = []
for grid in ([int(value) for value in sys.argv[3:]] or [32, 48, 64, 128]):
    if not 1 <= grid <= 1000:
        raise ValueError('Grid must be between 1 and 1000')
    sample_size = grid * min(3, 1000 // grid)
    data = dict(grid=grid, sampleSize=sample_size, small=sample(grid), large=sample(sample_size))
    result = json.loads(subprocess.run(['node', '-e', runner], input=json.dumps(data),
                        text=True, capture_output=True, check=True, cwd=root).stdout)
    comparison = Image.new('RGB', (1120, 600), '#eef1f5')
    draw = ImageDraw.Draw(comparison)
    for column, name in enumerate(['before', 'after']):
        img = Image.new('RGB', (grid, grid))
        img.putdata([tuple(rgb) for rgb in result[name]])
        img.save(output / f'{name}-{grid}.png')
        comparison.paste(img.resize((512,512), Image.Resampling.NEAREST), (24+560*column,60))
        draw.text((24+560*column,20), f'{name.upper()} | {grid} x {grid} | {len(result[name+"Colors"])} colors', fill='black')
    comparison.save(output / f'comparison-{grid}.png')
    report.append({k:v for k,v in result.items() if k not in ['before','after']} | {'grid':grid})
(output/'report.json').write_text(json.dumps(report,indent=2), encoding='utf8')
print(json.dumps(report,indent=2))
