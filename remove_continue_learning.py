import re, sys, pathlib

path = pathlib.Path("dashboard.html")
if not path.exists():
    print("❌ dashboard.html not found in this folder. cd into ~/Desktop/medclarivo-elite first.")
    sys.exit(1)

html = path.read_text()
original_len = len(html)

section_pattern = re.compile(
    r'\s*<!-- ═══ CONTINUE LEARNING ═══ -->\s*<section class="reveal" style="animation-delay:\.05s">.*?</section>\n',
    re.DOTALL
)
html, n1 = section_pattern.subn("\n", html)

func_pattern = re.compile(
    r'\s*// ── Continue Learning — real in-progress chapters, honest empty state ──\s*'
    r'function continueLearningCardHTML\(item\)\{.*?\n  \}\n\n'
    r'  async function loadContinueLearning\(token\)\{.*?\n  \}\n',
    re.DOTALL
)
html, n2 = func_pattern.subn(
    "\n  // Continue Learning card removed from dashboard — loadContinueLearning intentionally deleted.\n",
    html
)

html, n3 = re.subn(r'[ \t]*loadContinueLearning\(token\);\n', "", html)

path.write_text(html)

print(f"✅ Removed {n1} section block(s), {n2} function block(s), {n3} call site(s).")
print(f"   File size: {original_len} → {len(html)} bytes.")
if n1 == 0 or n2 == 0:
    print("⚠️  Something didn't match — check `git diff dashboard.html` before committing.")
