"""Compare retained deterministic UI fixtures. Requires the existing Pillow runtime."""
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path(__file__).resolve().parent.parent / "verification/skill-gap/production-parity"
before = json.loads((root / "before-stable/results.json").read_text())
after = json.loads((root / "after-stable/results.json").read_text())
assert before["layouts"] == after["layouts"], "Visible DOM geometry/computed styles changed"
comparisons = []
for source in sorted((root / "before-stable").glob("*.png")):
    left = Image.open(source).convert("RGB")
    right = Image.open(root / "after-stable" / source.name).convert("RGB")
    assert left.size == right.size, source.name
    difference = ImageChops.difference(left, right)
    max_delta = max(channel[1] for channel in difference.getextrema())
    pixels = sum(max(pixel) > 0 for pixel in difference.get_flattened_data())
    ratio = pixels / (left.width * left.height)
    # Chromium shadow-edge rasterization can differ by tiny channel values after
    # stylesheet extraction. Never permit displacement, typography or content drift.
    assert max_delta <= 3 and ratio <= 0.002, (source.name, max_delta, ratio)
    comparisons.append({"file": source.name, "size": left.size, "maxChannelDelta": max_delta,
                        "changedPixels": pixels, "changedRatio": ratio})
report = {"status": "PASS", "exactVisibleLayouts": len(before["layouts"]),
          "screenshotPairs": len(comparisons), "pixelTolerance": {"maxChannelDelta": 3,
          "maxChangedRatio": 0.002}, "comparisons": comparisons,
          "interactions": after["interactions"], "consoleErrors": after["consoleErrors"]}
(root / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"PASS: {len(before['layouts'])} exact visible layouts; {len(comparisons)} screenshot pairs within strict rasterization tolerance.")
