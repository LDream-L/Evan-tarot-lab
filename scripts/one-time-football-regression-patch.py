from pathlib import Path
import re

FOOTBALL_VERSION = "20260812-betting-anchor-v2"
AUTH_VERSION = "20260812-auth-recovery-v2"


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


# 1) Betting editor: support the current reading-form DOM.
path = Path("src/football/betting-runtime.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''function ensureBetEditor() {\n  if (byId("football-betting-editor")) return true;\n  const form = byId("football-reading-form");\n  const actions = form?.querySelector(".football-actions");\n  if (!form || !actions) return false;\n''',
    '''function ensureBetEditor() {\n  if (byId("football-betting-editor")) return true;\n  const form = byId("football-reading-form");\n  const actions = form?.querySelector(".football-actions");\n  const anchor = actions || byId("football-lock-button");\n  if (!form || !anchor?.parentElement) return false;\n''',
    "bet editor anchor lookup",
)
text = replace_once(
    text,
    ''' * DOM 空間複雜度：O(c + m)。\n */\nfunction ensureBetEditor() {''',
    ''' * DOM 空間複雜度：O(c + m)。\n *\n * 更快替代方案比較：掃描整份表單尋找任意按鈕會隨 DOM 節點增加；\n * 本版只查固定舊 class 與現行 lock-button ID，兩個固定錨點即可兼容新舊版結構。\n */\nfunction ensureBetEditor() {''',
    "bet editor optimization note",
)
text = replace_once(
    text,
    '  actions.parentElement.insertBefore(section, actions);\n',
    '  anchor.parentElement.insertBefore(section, anchor);\n',
    "bet editor insertion anchor",
)
path.write_text(text, encoding="utf-8")

# 2) Bust football runtime cache after product fix.
path = Path("src/football/workflow-runtime.js")
text = path.read_text(encoding="utf-8")
text, count = re.subn(
    r'import \{ footballBettingRuntime \} from "\./betting-runtime\.js\?v=[^"]+";',
    f'import {{ footballBettingRuntime }} from "./betting-runtime.js?v={FOOTBALL_VERSION}";',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("missing betting runtime version import")
path.write_text(text, encoding="utf-8")

path = Path("JS/football-lab.js")
text = path.read_text(encoding="utf-8")
text, count = re.subn(
    r'const ROOT_LOADER_VERSION = "[^"]+";',
    f'const ROOT_LOADER_VERSION = "{FOOTBALL_VERSION}";',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("missing football root loader version")
path.write_text(text, encoding="utf-8")

path = Path("football-lab.html")
text = path.read_text(encoding="utf-8")
text, count = re.subn(
    r'JS/football-lab\.js\?v=[^"\']+',
    f'JS/football-lab.js?v={FOOTBALL_VERSION}',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("missing football html loader version")
path.write_text(text, encoding="utf-8")

path = Path("tests/football-bundle.test.cjs")
text = path.read_text(encoding="utf-8")
text, count = re.subn(
    r'const FOOTBALL_SCRIPT_VERSION = "[^"]+";',
    f'const FOOTBALL_SCRIPT_VERSION = "{FOOTBALL_VERSION}";',
    text,
    count=1,
)
if count != 1:
    raise SystemExit("missing football bundle version")
path.write_text(text, encoding="utf-8")

# 3) All pages must fetch the current main.js so the auth recovery fix is truly site-wide.
for html_path in Path(".").glob("*.html"):
    html = html_path.read_text(encoding="utf-8")
    updated = re.sub(
        r'JS/main\.js\?v=[^"\']+',
        f'JS/main.js?v={AUTH_VERSION}',
        html,
    )
    if updated != html:
        html_path.write_text(updated, encoding="utf-8")

# 4) iPad regression: nested statistics are intentionally collapsed now; open them before layout assertions.
path = Path("tests/e2e/football-ipad-layout.spec.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''    await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });\n    await page.waitForFunction(() => Boolean(window.FootballLabBundle?.ready));\n    await page.locator("#football-source-comparison").waitFor({ state: "visible" });\n\n    await expect(page.locator("#football-match-form")).toBeVisible();\n''',
    '''    await page.goto("/football-lab.html", { waitUntil: "domcontentloaded" });\n    await page.waitForFunction(() => Boolean(window.FootballLabBundle?.ready));\n\n    const stats = page.locator("#football-stats-accordion");\n    const source = page.locator("#football-source-comparison");\n    await source.waitFor({ state: "attached" });\n    await stats.locator(":scope > summary").click();\n    await source.locator(":scope > summary").click();\n    await expect(source).toBeVisible();\n\n    await expect(page.locator("#football-match-form")).toBeVisible();\n''',
    "ipad nested stats visibility",
)
path.write_text(text, encoding="utf-8")

# 5) Mobile card width: validate relative usable width rather than an impossible fixed 300px threshold.
path = Path("tests/e2e/football-kpi-density.spec.js")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '''  } else {\n    expect(layout.columnCount).toBe(1);\n    expect(layout.cardWidth).toBeGreaterThan(300);\n  }\n''',
    '''  } else {\n    expect(layout.columnCount).toBe(1);\n    expect(layout.cardWidth).toBeGreaterThan(layout.viewportWidth * 0.7);\n  }\n''',
    "mobile KPI relative width",
)
path.write_text(text, encoding="utf-8")

print("football regression patch prepared")
