"""Render actual native roof meshes; no procedural geometry is invented here."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
import numpy as np

out = Path(__file__).parent / 'java-data-native'
fig, axes = plt.subplots(1, 2, figsize=(10, 7), constrained_layout=True)
summary = []
for ax, number, name in zip(axes, (14, 15), ('Kampung', 'Limasan')):
    recipe_id = f'AS-ISL-B{number}'
    batch = json.loads((out / f'{recipe_id}.json').read_text(encoding='utf-8-sig'))
    unit = batch['units'][0]
    mesh = unit['roofs']
    vertices = np.array([[v['x'], v['y'], v['z']] for v in mesh['vertices']])
    light = np.array([-0.4, -0.55, 0.8])
    light /= np.linalg.norm(light)
    for face in sorted(mesh['faces'], key=lambda f: np.mean(vertices[f['vertices'], 2])):
        pts = vertices[face['vertices'], :2]
        # Vertical gables have no projected area and must not hide the roof.
        projected = abs(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1))) / 2
        if projected < 1e-6 or face['normal'][2] < 1e-3:
            continue
        shade = 0.58 + 0.32 * max(0, np.dot(np.array(face['normal']), light))
        ax.add_patch(Polygon(pts, closed=True, facecolor=np.array([0.82, 0.49, 0.31]) * shade,
                             edgecolor='none', antialiased=False))
    for edge in mesh['edges']:
        if edge['kind'] in ('ridge', 'hip', 'valley', 'eave'):
            pts = vertices[edge['vertices'], :2]
            ax.plot(pts[:, 0], pts[:, 1], color='#352820', linewidth=1.05)
    center = (vertices[:, :2].min(axis=0) + vertices[:, :2].max(axis=0)) / 2
    ax.set_xlim(center[0] - 7.5, center[0] + 7.5)
    ax.set_ylim(center[1] - 7.5, center[1] + 7.5)
    ax.set_aspect('equal')
    ax.grid(alpha=0.13)
    ax.set_xlabel('m')
    ax.set_ylabel('m')
    ax.set_title(f'{recipe_id} · {name}\n' + ('Deux pans natifs' if number == 14 else 'Quatre pans natifs'))
    spans = (vertices[:, :2].max(axis=0) - vertices[:, :2].min(axis=0)).tolist()
    summary.append({'recipe_id': recipe_id, 'native_roof_extent_m': spans,
                    'bodies': len(unit['bodies']), 'rooms': len(unit['rooms']),
                    'roof_faces': len(mesh['faces']), 'generator_version': batch['generator_version'],
                    'catalogue_version': batch['catalogue_version']})
fig.suptitle('Profils javanais inspirés — maillage du générateur natif\nMême échelle ; paramètres artistiques, aucune maison mesurée reproduite', fontsize=12)
fig.savefig(out / 'native-roofs.png', dpi=170)
(out / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary))
