"""Draw a fixed before/after geometric review of changed foundation witnesses."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as Patch
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1] / "out/strip-initial-budget-proof"


def load(path):
    return json.loads(path.read_bytes())


def area(surface):
    return unary_union([Polygon([(p['x'], p['y']) for p in s['outer']],
                               [[(p['x'], p['y']) for p in h] for h in s['holes']])
                        for s in surface]).area


def draw(ax, surface, color, *, alpha=1., outline=None):
    for shape in surface:
        ax.add_patch(Patch([(p['x'], p['y']) for p in shape['outer']],
                          facecolor=color, edgecolor=outline or color,
                          linewidth=.7, alpha=alpha))
        for hole in shape['holes']:
            ax.add_patch(Patch([(p['x'], p['y']) for p in hole],
                              facecolor='white', edgecolor=outline or color, linewidth=.5))


def main():
    after_dir = ROOT / 'after-native-foundation'
    report = load(after_dir / 'foundation-comparison.json')
    requests = {r['id']: r for r in load(ROOT / 'requests.json')['requests']}
    phases = [report['beforePhase'], report['afterPhase']]
    buildings = {p: {b['id']: b for b in load(ROOT / p / 'plans.json')['buildings']} for p in phases}
    changed = [s for s in report['sites'] if not s.get('samePlanJson', False)
               and (s['before']['status'] == 'accepted' or s['after']['status'] == 'accepted')]
    changed.sort(key=lambda s: (s['id'] in report['lost'], s['id'] in report['gained'],
                               abs(s.get('bodyAreaDeltaM2', 0))), reverse=True)
    selected = changed[:8]
    if not selected:
        raise SystemExit('No changed geometric witness to draw')
    fig, axes = plt.subplots(len(selected), 2, figsize=(10, 3.25 * len(selected)), squeeze=False)
    for row, witness in enumerate(selected):
        rid = witness['id']
        req = requests[rid]
        points = [p for s in req['cadastral'] for p in s['outer']]
        x0, x1 = min(p['x'] for p in points), max(p['x'] for p in points)
        y0, y1 = min(p['y'] for p in points), max(p['y'] for p in points)
        pad = max(x1-x0, y1-y0) * .09
        for col, phase in enumerate(phases):
            ax = axes[row][col]
            draw(ax, req['cadastral'], '#faf9f3', outline='#555555')
            draw(ax, req['buildable'], 'none', outline='#aeb5a1')
            draw(ax, req.get('reserves', []), '#bd546b', alpha=.35)
            b = buildings[phase].get(rid)
            if b:
                draw(ax, b['roof_footprint'], '#dcc2a3', alpha=.7)
                draw(ax, b.get('courtyards', []), '#a9c4a4', alpha=.65)
                draw(ax, b.get('circulation', []), '#d5caab', alpha=.7)
                draw(ax, b['footprint'], '#765547', alpha=.95)
                for f in b.get('structural_features', []):
                    draw(ax, f['surface'], '#c17f36', alpha=.8)
                desc = f"{b['recipe_id']} / {area(b['footprint']):.1f} m²"
            else:
                desc = 'Refus'
            for access in req.get('accesses', []):
                ax.plot([p['x'] for p in access['segment']], [p['y'] for p in access['segment']],
                        color='#448ca6', linewidth=2.2)
            ax.set(xlim=(x0-pad, x1+pad), ylim=(y0-pad, y1+pad))
            ax.set_aspect('equal')
            ax.tick_params(labelsize=6)
            ax.ticklabel_format(useOffset=False, style='plain')
            target = (req.get('programme') or {}).get('built_area_m2')
            ax.set_title(f"{'Avant' if col == 0 else 'Après'} — témoin {witness['sourceIndex']}\n"
                         f"{desc} ; cible {target} m²", fontsize=9)
    fig.suptitle('Fondations natives — mêmes cadastres et cadrages\n'
                 'Corps brun · cour verte · appuis ocre · accès bleu', fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .97))
    path = after_dir / 'geometry-review.png'
    if path.exists():
        raise SystemExit('Refusing to overwrite the review')
    fig.savefig(path, dpi=140)
    (after_dir / 'geometry-review-selection.json').write_text(json.dumps({
        'selection': [s['id'] for s in selected],
        'rule': 'Lost, gained, then largest absolute body-area changes; at most eight.',
        'scope': 'Geometric plot of exported plans, not rendered architectural detail.'
    }, indent=2), encoding='utf-8')
    print(path)


if __name__ == '__main__':
    main()
