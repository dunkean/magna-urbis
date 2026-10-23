"""Bounded report tests, with no native CLI or city generation."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import native_entry_report as report


def canonical(attempt):
    return ('Native planning entrance upgrade: admitted final source, dimensions, '
            f'floors and programme retained; {attempt}/4 rigid poses checked. '
            'No new source selection or dimension search.')


def alternative(canonical_count=4, attempt=2, count=3):
    return ('Native planning entrance upgrade: admitted final source, dimensions, '
            f'floors and programme retained; {canonical_count}/4 canonical rigid poses '
            f'checked, then existing portal unit-0:portal:0 ({attempt}/{count} alternatives) '
            'at the initial pose. No new door, structural graph, source selection or dimension search.')


class EntryReportTest(unittest.TestCase):
    def test_legacy_canonical_pose_ordinals_remain_unchanged(self):
        for attempt in range(1, 5):
            parsed = report.parse_upgrade(canonical(attempt))
            self.assertEqual(parsed['successfulAttempt'], attempt)
            self.assertEqual(parsed['canonicalPosesChecked'], attempt)
            self.assertEqual(parsed['entrySelection'], 'canonical')
            self.assertEqual(parsed['successfulPose'],
                             'initial' if attempt == 1 else 'canonical_frontage')

    def test_existing_portal_uses_initial_pose_after_canonical_failures(self):
        parsed = report.parse_upgrade(alternative())
        self.assertEqual(parsed, dict(entrySelection='existing_native_alternative',
            canonicalPosesChecked=4, alternativePortalId='unit-0:portal:0',
            alternativeAttempt=2, alternativeCount=3, successfulPose='initial'))
        self.assertNotIn('successfulAttempt', parsed)
        # Fewer than four distinct canonical poses may exist; the original
        # pose still remains the alternative's actual pose in that case.
        self.assertEqual(report.parse_upgrade(alternative(1, 1, 1))['successfulPose'], 'initial')

    def test_invalid_or_future_traces_fail_without_invented_metrics(self):
        for trace in [canonical(0), canonical(5), alternative(5), alternative(4, 4, 3),
                      alternative(4, 1, 5), alternative().replace('initial', 'last'),
                      'Native planning entrance upgrade: unknown format']:
            with self.subTest(trace=trace), self.assertRaises(ValueError):
                report.parse_upgrade(trace)

    def test_cli_mixed_report_keeps_legacy_metrics_and_stage_projection(self):
        def building(rid, diagnostic):
            return dict(id=rid, diagnostics=[diagnostic], transform=dict(origin=dict(x=0, y=0)),
                        footprint=[], useful_area_m2=0, recipe_id='source', variant_id='default',
                        resolved=dict(generator_version='version', surfaces=[]))
        buildings = [building('initial', canonical(1)), building('frontage', canonical(3)),
                     building('alternative', alternative()),
                     building('deferred', 'Native planning entrance deferred: 4/4 rigid poses; no access.'),
                     building('outside', 'No native preparation')]
        batch = dict(buildings=buildings, generator_version='version')
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            before, after, output = [base / name for name in ('before.json', 'after.json', 'report.json')]
            for path in (before, after):
                path.write_text(json.dumps(batch), encoding='utf-8')
            with patch.object(sys, 'argv', ['native_entry_report.py', str(before), str(after), str(output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                report.main()
            result = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(result['successfulAttempts'], {'1': 1, '3': 1})
        self.assertEqual(result['successfulExistingAlternativeAttempts'], {'2': 1})
        self.assertEqual(result['successfulPoseKinds'], {'initial': 2, 'canonical_frontage': 1})
        self.assertEqual(result['entrySelections'], {'canonical': 2, 'existing_native_alternative': 1})
        self.assertEqual(result['entryOutcomes'], {'upgraded': 3, 'deferred': 1, 'outside_supported_scope': 1})
        self.assertEqual(result['changedPoses'], 0)
        self.assertEqual(result['lost'], [])
        # native_entry_stage_proof forwards all aggregate fields verbatim; it
        # does not infer an effective pose from successfulAttempts itself.
        stage_projection = {k: v for k, v in result.items() if k not in ('sites', 'scope', 'inputs')}
        self.assertEqual(stage_projection['entrySelections'], result['entrySelections'])
        self.assertEqual(stage_projection['successfulPoseKinds'], result['successfulPoseKinds'])


if __name__ == '__main__':
    unittest.main()
