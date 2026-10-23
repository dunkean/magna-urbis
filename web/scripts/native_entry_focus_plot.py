"""Two-panel comparison of one retained plan, using existing native detail results."""
import argparse
import json
from pathlib import Path

from native_entry_plot import (plt, Patch, Line2D, COLORS, detail_records,
                               load, panel, sha, surface)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--after', type=Path, required=True)
    parser.add_argument('--parcel', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    request_path = root / 'web/out/native-foundation-detail-proof/requests.json'
    selection = load(root / 'web/out/native-foundation-detail-proof/selection.json')['sites']
    requests = load(request_path)['requests']
    request, = [r for r in requests if r['parcel_id'].endswith(args.parcel)]
    selected, = [s for s in selection if s['id'] == request['id']]
    inputs = {'requests': request_path}
    for phase, directory in [('before', args.before), ('after', args.after)]:
        for kind in ['plans', 'details']:
            inputs[f'{phase}_{kind}'] = directory / f'eight-{kind}.json'
    plans = [next(b for b in load(inputs[f'{phase}_plans'])['buildings'] if b['id'] == request['id'])
             for phase in ['before', 'after']]
    details = [detail_records(inputs[f'{phase}_details']) for phase in ['before', 'after']]
    x0, y0, x1, y1 = surface(request['cadastral']).bounds
    center = [(x0+x1)/2, (y0+y1)/2]
    half = max(x1-x0, y1-y0)*.58 + .5
    camera = dict(origin_m=center, extent_relative_m=[-half, half, -half, half])
    fig, axes = plt.subplots(1, 2, figsize=(12, 6.5))
    results = [panel(axes[i], request, plans[i], details[i], camera,
                     ['Avant', 'Après'][i], selected['sourceIndex']) for i in range(2)]
    fig.suptitle('Raccord à la rue — même maison et même cadrage', fontsize=14)
    fig.legend(handles=[Patch(facecolor=COLORS['body'], label='Corps'),
                        Patch(facecolor=COLORS['court'], label='Cour'),
                        Patch(facecolor=COLORS['structure'], label='Appuis'),
                        Patch(facecolor=COLORS['public'], label='Raccord public'),
                        Line2D([], [], color=COLORS['portal'], lw=3, label='Porte native')],
               loc='lower center', ncol=5, frameon=False)
    fig.tight_layout(rect=(0, .08, 1, .95))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    assert not args.output.exists()
    fig.savefig(args.output, dpi=160, facecolor='white')
    plt.close(fig)
    manifest = dict(id=request['id'], camera=camera,
                    inputs={k: dict(path=str(p), sha256=sha(p)) for k, p in inputs.items()},
                    phases=results, imageSha256=sha(args.output),
                    scope='Exported geometry and recorded native detail outcomes, not a screenshot of the running city.')
    with args.output.with_suffix('.json').open('x', encoding='utf-8') as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
    print(args.output)


if __name__ == '__main__':
    main()
