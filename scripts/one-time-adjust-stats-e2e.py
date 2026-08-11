from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing test anchor: {label}")
    return text.replace(old, new, 1)

# KPI readability test now opens the nested rolling-performance section.
for filename in [
    "tests/e2e/football-performance-clarity.spec.js",
    "tests/e2e/football-kpi-density.spec.js",
]:
    path = Path(filename)
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '  await page.locator("#football-stats-accordion > summary").click();\n  await expect(page.locator("#football-kpis .football-kpi-readable-label").first()).toBeVisible();',
        '  await page.locator("#football-stats-accordion > summary").click();\n  await page.locator("#football-performance-observer > summary").click();\n  await expect(page.locator("#football-kpis .football-kpi-readable-label").first()).toBeVisible();',
        filename,
    )
    path.write_text(text, encoding="utf-8")

# Source comparison now has its own nested <details> and KPIs live inside performance body.
path = Path("tests/e2e/source-comparison.spec.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '  const summary = accordion.locator("summary");',
    '  const summary = accordion.locator(":scope > summary");',
    "source outer summary scope",
)
text = replace_once(
    text,
    '''  await expect(accordion).toHaveAttribute("open", "");\n  await expect(accordion).toContainText("收合數據");\n  await expect(panel).toBeVisible();\n  await expect(panel.locator(".football-source-metric small")).toContainText([\n''',
    '''  await expect(accordion).toHaveAttribute("open", "");\n  await expect(accordion).toContainText("收合數據");\n  await expect(panel).toBeVisible();\n  await expect(panel).not.toHaveAttribute("open", "");\n  await panel.locator(":scope > summary").click();\n  await expect(panel).toHaveAttribute("open", "");\n  await expect(panel.locator(".football-source-metric small")).toContainText([\n''',
    "open nested source comparison",
)
text = replace_once(
    text,
    '''    accordionOpen: document.getElementById("football-stats-accordion")?.open === true,\n    kpisInsideAccordion: document.getElementById("football-kpis")?.parentElement?.id\n      === "football-stats-accordion-content",\n''',
    '''    accordionOpen: document.getElementById("football-stats-accordion")?.open === true,\n    sourceOpen: document.getElementById("football-source-comparison")?.open === true,\n    kpisInsidePerformance: document.getElementById("football-kpis")?.parentElement?.id\n      === "football-performance-body",\n''',
    "source comparison runtime shape",
)
text = replace_once(
    text,
    '''    source: "compare",\n    accordionOpen: true,\n    kpisInsideAccordion: true,\n''',
    '''    source: "compare",\n    accordionOpen: true,\n    sourceOpen: true,\n    kpisInsidePerformance: true,\n''',
    "source comparison runtime expected",
)
path.write_text(text, encoding="utf-8")
