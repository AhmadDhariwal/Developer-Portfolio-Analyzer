"""Compare full UI fixtures; explicit approvals cover only badge and evidence-disclosure foregrounds."""
import copy
import json
import math
import os
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

root = Path(__file__).resolve().parent.parent / "verification/skill-gap/production-parity"
before_root = Path(os.environ.get("SKILL_GAP_BASELINE", root / "before-stable"))
after_root = Path(os.environ.get("SKILL_GAP_CANDIDATE", root / "after-stable"))
before = json.loads((before_root / "results.json").read_text())
after = json.loads((after_root / "results.json").read_text())
baseline_files = sorted(before_root.glob("*.png"))
assert len(baseline_files) == 30, "Thirty retained baseline screenshots are required; missing images cannot pass parity"
assert {p.name for p in baseline_files} == {p.name for p in after_root.glob("*.png")}, "Screenshot sets differ"
approved = os.environ.get("SKILL_GAP_APPROVED_BADGE_COLORS") == "1"
legend_approved = os.environ.get("SKILL_GAP_APPROVED_LEGEND_COLOR") == "1"
def is_legend(node):
    return node["tag"] == "SUMMARY" and node["classes"] == "" and node["text"] == "Understand the five evidence classifications"
normalized = copy.deepcopy(before["layouts"])
intentional = []
assert len(normalized) == len(after["layouts"]) == 24
for old, new in zip(normalized, after["layouts"]):
    assert len(old["geometry"]) == len(new["geometry"])
    for previous, current in zip(old["geometry"], new["geometry"]):
        if previous["color"] != current["color"] and (approved or legend_approved):
            classes = set(previous["classes"].split())
            assert (approved and classes & {"freshness-badge", "priority-badge"}) or (legend_approved and is_legend(previous)), "Unapproved foreground change"
            intentional.append({"theme": old["theme"], "width": old["width"], "classes": previous["classes"], "before": previous["color"], "after": current["color"]})
            if legend_approved and is_legend(previous) and previous["border"] != current["border"]:
                # A zero-width border is not painted; its default currentColor
                # follows the explicitly approved text color without a CSS border change.
                assert previous["border"] == "0px none " + previous["color"]
                assert current["border"] == "0px none " + current["color"]
                previous["border"] = current["border"]
            previous["color"] = current["color"]
assert normalized == after["layouts"], "Unapproved geometry, content or computed style changed"
comparisons = []
for source in baseline_files:
    left = Image.open(source).convert("RGB")
    right = Image.open(after_root / source.name).convert("RGB")
    assert left.size == right.size, source.name
    difference = ImageChops.difference(left, right)
    mask = Image.new("L", left.size, 255)
    if approved or legend_approved:
        match = re.match(r"(light|dark|system)-(\d+)(?:-fold)?\.png", source.name)
        layout = next(item for item in before["layouts"] if item["theme"] == match[1] and item["width"] == int(match[2]))
        draw = ImageDraw.Draw(mask)
        for node in layout["geometry"]:
            if (approved and set(node["classes"].split()) & {"freshness-badge", "priority-badge"}) or (legend_approved and is_legend(node)):
                draw.rectangle([math.floor(node["x"]), math.floor(node["y"]), math.ceil(node["x"] + node["width"]), math.ceil(node["y"] + node["height"])], fill=0)
        # CSS comparison above still requires identical badge background, border,
        # typography and geometry. Only their approved foreground differs.
        difference.paste((0, 0, 0), (0, 0), ImageChops.invert(mask))
    max_delta = max(channel[1] for channel in difference.getextrema())
    pixels = sum(max(pixel) > 0 for pixel in difference.get_flattened_data())
    ratio = pixels / (left.width * left.height)
    assert max_delta <= 3 and ratio <= 0.002, (source.name, max_delta, ratio)
    comparisons.append({"file": source.name, "size": left.size, "maxChannelDeltaOutsideApprovedBadges": max_delta, "changedPixelsOutsideApprovedBadges": pixels, "changedRatioOutsideApprovedBadges": ratio})
report = {"status": "PASS", "exactGeometryLayouts": len(before["layouts"]), "screenshotPairs": len(comparisons), "pixelTolerance": {"maxChannelDelta": 3, "maxChangedRatio": 0.002}, "approvedBadgeForegroundChanges": [x for x in intentional if x["classes"]], "approvedLegendForegroundChanges": [x for x in intentional if not x["classes"]], "comparisons": comparisons, "interactions": after["interactions"], "consoleErrors": after["consoleErrors"]}
(after_root / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"PASS: {len(before['layouts'])} exact geometry layouts; {len(comparisons)} screenshot pairs; {len(intentional)} approved badge foreground changes; other styles/backgrounds unchanged.")
