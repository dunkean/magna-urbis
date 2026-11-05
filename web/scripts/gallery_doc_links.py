"""Add the documentation links to the generated gallery before deployment."""
from pathlib import Path
import sys

LINKS = '''<div class="gallery-doc-links" role="navigation" aria-label="Documentation" style="display:flex;flex-wrap:wrap;gap:12px;margin:0 0 20px;font:14px system-ui,sans-serif">
<a href="../../scientific/fr.html">Atlas des méthodes</a>
<a href="../../scientific/catalogue-architecture.html">Catalogue architectural · 79 cultures</a>
</div>'''


def add_links(path):
    page = Path(path)
    source = page.read_text(encoding="utf-8")
    if 'class="gallery-doc-links"' in source:
        return
    if "<header>" not in source:
        raise ValueError(f"Gallery header not found: {page}")
    page.write_text(source.replace("<header>", "<header>" + LINKS, 1), encoding="utf-8")


if __name__ == "__main__":
    add_links(sys.argv[1])
