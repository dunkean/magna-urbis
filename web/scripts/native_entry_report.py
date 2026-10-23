"""Compare existing native-entry replays; never generate a city or change plans.

Report v3 keeps successfulAttempt/successfulAttempts for Strip canonical-door
successes, with their historical sequential pose ordinal (1 = initial pose).
An existing-door fallback has no successfulAttempt: canonicalPosesChecked and
alternativeAttempt count work, while successfulPose='initial' states the actual
pose. entrySelections and successfulExistingAlternativeAttempts report these
fallbacks separately. Single final-entry attempts have separate metrics and
never enter the historical Strip pose/alternative counters.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

from native_foundation_compare import surface, foundation_family


def read(path):
    return json.loads(path.read_bytes())


def parse_upgrade(diagnostic):
    """Parse the native trace without calling a failed pose the final pose."""
    alternative = re.search(
        r'(\d+)/4 canonical rigid poses checked, then existing portal (.+?) '
        r'\((\d+)/(\d+) alternatives\) at the initial pose\.', diagnostic)
    if alternative:
        canonical, portal, attempt, count = alternative.groups()
        canonical, attempt, count = int(canonical), int(attempt), int(count)
        if not (1 <= canonical <= 4 and 1 <= attempt <= count <= 4):
            raise ValueError('Invalid bounded existing-portal trace')
        return dict(entrySelection='existing_native_alternative',
                    canonicalPosesChecked=canonical, alternativePortalId=portal,
                    alternativeAttempt=attempt, alternativeCount=count,
                    successfulPose='initial')
    canonical = re.search(r'(\d+)/4 rigid poses checked\.', diagnostic)
    if not canonical or 'existing portal' in diagnostic:
        raise ValueError('Missing bounded-attempt trace')
    attempt = int(canonical[1])
    if not 1 <= attempt <= 4:
        raise ValueError('Invalid bounded canonical-pose trace')
    return dict(entrySelection='canonical', canonicalPosesChecked=attempt,
                successfulAttempt=attempt,
                successfulPose='initial' if attempt == 1 else 'canonical_frontage')


def parse_single(diagnostic):
    """One fixed pose or a failure before admission; never a Strip ordinal."""
    success = 'Native planning entrance upgrade: final Single '
    deferred = 'Native planning entrance deferred: final Single '
    if diagnostic == (success + 'source, dimensions, floors and pose retained; '
            '1/1 existing pose checked. No alternative door, rigid-pose retry, '
            'source selection or dimension search.'):
        return dict(entrySelection='canonical_fixed_single', posesChecked=1,
                    alternativeDoorsChecked=0, successfulPose='initial')
    if diagnostic.startswith(deferred + '1/1 existing pose;'):
        return dict(posesChecked=1, alternativeDoorsChecked=0, failureStage='pose_admission')
    for prefix, stage in [('preparation unsupported:', 'unsupported_before_pose'),
                          ('preparation failed before pose admission:', 'preparation_failed')]:
        if diagnostic.startswith(deferred + prefix):
            return dict(posesChecked=0, alternativeDoorsChecked=0, failureStage=stage)
    raise ValueError('Unknown bounded Single entry trace')


def entry_family(diagnostics, upgrade, deferred):
    family = foundation_family(diagnostics)
    trace = upgrade or deferred or ''
    single = trace.startswith(('Native planning entrance upgrade: final Single ',
                               'Native planning entrance deferred: final Single '))
    if single and family == 'strip':
        raise ValueError('Single entry trace conflicts with Strip foundation')
    if single or family == 'single':
        return 'single'
    if family == 'strip' or upgrade or re.search(r'\d+/4 rigid poses;', trace):
        return 'strip'
    return 'unclassified' if deferred else 'outside_supported_scope'


def compare_batches(batches):
    old, new = [{b['id']: b for b in batch['buildings']} for batch in batches]
    rows = []
    attempts, outcomes = Counter(), Counter()
    selections, poses, alternative_attempts = Counter(), Counter(), Counter()
    all_outcomes, single_outcomes = Counter(), Counter()
    single_rows, unclassified = [], []
    local_changes, area_changes, style_changes = [], [], []
    for rid, building in new.items():
        upgrade = next((d for d in building['diagnostics']
                        if d.startswith('Native planning entrance upgrade:')), None)
        deferred = next((d for d in building['diagnostics']
                         if d.startswith('Native planning entrance deferred:')), None)
        status = 'upgraded' if upgrade else 'deferred' if deferred else 'outside_supported_scope'
        family = entry_family(building['diagnostics'], upgrade, deferred)
        all_outcomes[status] += 1
        outcomes[status if family == 'strip' else 'outside_supported_scope'] += 1
        row = dict(id=rid, status=status, diagnostic=upgrade or deferred, entryFamily=family)
        if family == 'single':
            if not (upgrade or deferred):
                raise ValueError('Single foundation has no typed entry outcome')
            row.update(parse_single(upgrade or deferred))
            single_outcomes[status] += 1
            single_rows.append(row)
        elif family == 'unclassified':
            unclassified.append(rid)
        elif upgrade:
            row.update(parse_upgrade(upgrade))
            selections[row['entrySelection']] += 1
            poses[row['successfulPose']] += 1
            if row['entrySelection'] == 'canonical':
                attempts[row['successfulAttempt']] += 1
            else:
                alternative_attempts[row['alternativeAttempt']] += 1
        if rid in old:
            previous = old[rid]
            row['poseChanged'] = building['transform'] != previous['transform']
            row['bodyAreaDeltaM2'] = surface(building['footprint']).area - surface(previous['footprint']).area
            row['usefulAreaDeltaM2'] = building['useful_area_m2'] - previous['useful_area_m2']
            if abs(row['bodyAreaDeltaM2']) > 0.0001 or abs(row['usefulAreaDeltaM2']) > 0.0001:
                area_changes.append(rid)
            if (building['recipe_id'], building['variant_id']) != (previous['recipe_id'], previous['variant_id']):
                style_changes.append(rid)
            # Archives preserve f64 bits. Version, the newly retained entrance
            # and its explanation may differ; every local architectural field
            # must remain byte-equivalent after JSON parsing.
            a, b = previous['resolved'], building['resolved']
            row['localArchitectureChangedFields'] = [k for k in a.keys() | b.keys()
                if k not in {'generator_version', 'entrance', 'diagnostics'} and a.get(k) != b.get(k)]
            if row['localArchitectureChangedFields']:
                local_changes.append(rid)
        rows.append(row)
    report = dict(
        version='native-entry-replay-comparison-3',
        batchVersions=[b['generator_version'] for b in batches],
        admittedBefore=len(old), admittedAfter=len(new), lost=sorted(old.keys()-new.keys()),
        gained=sorted(new.keys()-old.keys()), entryOutcomes=dict(outcomes),
        legacyEntryMetricsScope='strip', allEntryOutcomes=dict(all_outcomes),
        unclassifiedEntryDiagnostics=unclassified,
        singleEntry=dict(outcomes=dict(single_outcomes),
            posesCheckedTotal=sum(r['posesChecked'] for r in single_rows),
            successfulInitialPoseCount=sum(r['status'] == 'upgraded' for r in single_rows),
            alternativeDoorsCheckedTotal=sum(r['alternativeDoorsChecked'] for r in single_rows),
            preparedBeforePoseFailureCount=sum(r.get('failureStage') == 'preparation_failed' for r in single_rows),
            unsupportedBeforePoseCount=sum(r.get('failureStage') == 'unsupported_before_pose' for r in single_rows),
            sites=[r['id'] for r in single_rows]),
        successfulAttempts=dict(attempts), entrySelections=dict(selections),
        successfulPoseKinds=dict(poses),
        successfulExistingAlternativeAttempts=dict(alternative_attempts),
        changedPoses=sum(r.get('poseChanged', False) for r in rows),
        localArchitectureChanges=local_changes, areaChanges=area_changes, styleChanges=style_changes,
        sites=rows,
        scope='Existing exact request replays only. Historic entryOutcomes and pose/selection/alternative metrics remain a Strip projection: Singles count outside_supported_scope there. allEntryOutcomes and singleEntry expose actual separate outcomes. Single has one fixed pose at most and no alternative door; preparation failures have zero checked poses. Geometry/style/admission changes remain global. Strip canonical successes retain their sequential ordinal; alternatives always use the initial pose. Entry certificates do not certify room subdivision, inhabitants or city-scale speed. Rights and terrain are audited separately by native_foundation_compare.py.',
    )
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    report = compare_batches([read(path) for path in (args.before, args.after)])
    report['inputs'] = [dict(path=str(p), sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                        for p in (args.before, args.after)]
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({k: v for k, v in report.items() if k not in {'sites', 'scope', 'inputs'}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
