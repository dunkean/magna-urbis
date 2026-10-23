"""Four focused additive-report regressions; no native generation or browser."""
import copy
import unittest

import native_entry_report as entry
import native_foundation_compare as foundation


SUCCESS = ('Native planning entrance upgrade: final Single source, dimensions, '
           'floors and pose retained; 1/1 existing pose checked. No alternative door, '
           'rigid-pose retry, source selection or dimension search.')
DEFERRED = 'Native planning entrance deferred: final Single '


def rectangle(x, y, width, depth):
    return [dict(outer=[dict(x=x, y=y), dict(x=x+width, y=y),
                        dict(x=x+width, y=y+depth), dict(x=x, y=y+depth)], holes=[])]


def building(rid, x, diagnostic):
    body = rectangle(x, 0, 1, 1)
    return dict(id=rid, diagnostics=[diagnostic], transform=dict(origin=dict(x=0, y=0), orientation_deg=0),
                footprint=body, roof_footprint=body, courtyards=[], circulation=[], structural_features=[],
                ground_z_m=0, useful_area_m2=1, recipe_id='source', variant_id='default',
                resolved=dict(generator_version='version', surfaces=[body, []],
                    bodies=[dict(levels=[0])], courts=1, paths=1, features=[]))


def request(rid, x):
    return dict(id=rid, cadastral=rectangle(x-1, -1, 3, 3), buildable=rectangle(x-1, -1, 3, 3),
                reserves=[], neighbors=[], terrain=dict(origin=dict(x=x, y=0), gradient=[0, 0],
                    ground_z_m=0, water_z_m=None, max_foundation_step_m=.75))


class SingleReportingTest(unittest.TestCase):
    def test_single_success_failure_stages_and_unknown_formats_are_distinct(self):
        parsed = entry.parse_single(SUCCESS)
        self.assertEqual(parsed, dict(entrySelection='canonical_fixed_single', posesChecked=1,
            alternativeDoorsChecked=0, successfulPose='initial'))
        for text, poses, stage in [
                ('1/1 existing pose; blocked', 1, 'pose_admission'),
                ('preparation unsupported: gallery', 0, 'unsupported_before_pose'),
                ('preparation failed before pose admission: graph', 0, 'preparation_failed')]:
            with self.subTest(text=text):
                self.assertEqual(entry.parse_single(DEFERRED+text),
                    dict(posesChecked=poses, alternativeDoorsChecked=0, failureStage=stage))
        for malformed in [SUCCESS.replace('1/1', '2/2'), SUCCESS.replace('No alternative', 'An alternative'),
                          DEFERRED+'2/1 existing pose; bad', DEFERRED+'future format']:
            with self.subTest(text=malformed), self.assertRaises(ValueError):
                entry.parse_single(malformed)

    def test_single_metrics_do_not_pollute_strip_pose_or_alternative_counters(self):
        canonical = ('Native planning entrance upgrade: admitted final source, dimensions, '
            'floors and programme retained; 2/4 rigid poses checked. No new source selection or dimension search.')
        bs = [building('strip', 0, canonical), building('single', 4, SUCCESS),
              building('blocked', 8, DEFERRED+'1/1 existing pose; blocked'),
              building('unsupported', 12, DEFERRED+'preparation unsupported: gallery'),
              building('failed', 16, DEFERRED+'preparation failed before pose admission: graph'),
              building('outside', 20, 'No preparation')]
        batch = dict(buildings=bs, generator_version='version')
        report = entry.compare_batches([batch, batch])
        self.assertEqual(report['successfulAttempts'], {2: 1})
        self.assertEqual(report['entrySelections'], {'canonical': 1})
        self.assertEqual(report['successfulExistingAlternativeAttempts'], {})
        self.assertEqual(report['successfulPoseKinds'], {'canonical_frontage': 1})
        self.assertEqual(report['entryOutcomes'], {'upgraded': 1, 'outside_supported_scope': 5})
        self.assertEqual(report['allEntryOutcomes'], {'upgraded': 2, 'deferred': 3, 'outside_supported_scope': 1})
        self.assertEqual(report['singleEntry'], dict(outcomes={'upgraded': 1, 'deferred': 3},
            posesCheckedTotal=2, successfulInitialPoseCount=1, alternativeDoorsCheckedTotal=0,
            preparedBeforePoseFailureCount=1, unsupportedBeforePoseCount=1,
            sites=['single', 'blocked', 'unsupported', 'failed']))
        self.assertEqual(report['changedPoses'], 0)

    def test_terrain_single_is_audited_separately_while_legacy_strip_fields_remain(self):
        strip = building('strip', 0, foundation.NATIVE_MARKER+' prepared')
        single = building('single', 4, foundation.NATIVE_SINGLE_MARKER+' prepared')
        rs = [request('strip', 0), request('single', 4)]
        rs[1]['terrain']['gradient'] = [1, 0]
        single['ground_z_m'] = 1
        old = foundation.audit_phase(rs[:1], dict(buildings=[strip]))
        new = foundation.audit_phase(rs, dict(buildings=[strip, single]))
        for field in ['nativeFoundationBuildings', 'nativeTerrainViolationBuildings',
                      'nativeGroundMaxErrorM', 'retainedPlanWouldExceedStepCount', 'retainedPlanTerrainErrorCount']:
            self.assertEqual(new[field], old[field], field)
        self.assertEqual(new['preparedFoundationBuildings'], 2)
        self.assertEqual(new['singleFoundation']['buildings'], 1)
        self.assertEqual(new['singleFoundation']['terrainViolationBuildings'], ['single'])
        self.assertEqual(new['allPreparedTerrainViolationBuildings'], ['single'])
        row = new['sites'][1]
        self.assertFalse(row['nativeFoundation'])  # historical Strip boolean
        self.assertEqual(row['nativeFoundationFamily'], 'single')
        self.assertTrue(row['preparedFoundation'])
        self.assertIn('foundation_step', row['terrain']['violations'])
        self.assertIn('slope', row['terrain']['violations'])

    def test_deferred_single_has_no_physical_certificate_and_conflicts_fail(self):
        b = building('deferred', 0, DEFERRED+'1/1 existing pose; blocked')
        audit = foundation.audit_phase([request('deferred', 0)], dict(buildings=[b]))
        self.assertEqual(audit['preparedFoundationBuildings'], 0)
        self.assertEqual(audit['singleFoundation']['buildings'], 0)
        self.assertNotIn('terrain', audit['sites'][0])
        bad = copy.deepcopy(b)
        bad['diagnostics'] = [foundation.NATIVE_MARKER, foundation.NATIVE_SINGLE_MARKER]
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            foundation.audit_phase([request('deferred', 0)], dict(buildings=[bad]))
        bad['diagnostics'] = [foundation.NATIVE_MARKER, SUCCESS]
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            entry.compare_batches([dict(buildings=[], generator_version='v'),
                                   dict(buildings=[bad], generator_version='v')])


if __name__ == '__main__':
    unittest.main()
