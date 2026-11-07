"""具體驗證成對計分、棄權、時間與重複紀錄，避免資料資格造成假差異。"""
import copy
import unittest
from analyze import analyze,exact_mcnemar,eligibility,POSITIONS,DECK


def row(source,match='M1',prediction='H'):
    """產生明確標記的合成測試輸入；固定P=5，時間／空間 O(P)。"""
    return dict(trial_id=match+source,match_id=match,reader_id='synthetic',protocol_version='1',
                source=source,experiment='P1',block='pilot',drawn_at='2026-11-07T01:00:00+08:00',
                locked_at='2026-11-07T01:10:00+08:00',kickoff='2026-11-08T01:00:00+08:00',
                result_known_at_reading=False,prediction=prediction,actual='H',draw_policy='field_reset_then_4',
                information_snapshot_at='2026-11-07T00:00:00+08:00',original_reading='合成測試文字，非真實解讀',
                falsifying_condition='合成測試反證',confidence_1_5=3,ai_involvement='none_before_lock',
                actual_source_url='https://example.org/synthetic',result_verified_at='2026-11-08T04:00:00+08:00',
                cards=[dict(position=p,name=name,orientation='upright')for p,name in zip(POSITIONS,sorted(DECK)[:5])])


class AnalysisTests(unittest.TestCase):
    def test_exact_known(self):self.assertEqual(exact_mcnemar(5,2),.453125)
    def test_no_discordance(self):self.assertEqual(exact_mcnemar(0,0),1)
    def test_symmetry(self):self.assertEqual(exact_mcnemar(9,2),exact_mcnemar(2,9))
    def test_pairs(self):
        s=analyze([row('manual'),row('website',prediction='A')],100)['strata'][0]
        self.assertEqual((s['manual_hits'],s['website_hits'],s['difference']),(1,0,1))
    def test_missing_result_pending(self):
        r=row('manual');r['actual']=None;self.assertEqual(analyze([r],100)['pending'],1)
    def test_abstain_kept(self):
        s=analyze([row('manual',prediction='ABSTAIN'),row('website')],100)['strata'][0]
        self.assertEqual((s['pairs'],s['manual_coverage'],s['manual_rate']),(1,0,0))
    def test_late_rejected(self):
        r=row('manual');r['locked_at']=r['kickoff'];self.assertIn('not_pre_match',eligibility(r))
    def test_naive_time_rejected(self):
        r=row('manual');r['locked_at']='2026-11-07T01:10:00';self.assertIn('missing_or_naive_time',eligibility(r))
    def test_duplicate_id(self):
        r=row('manual');s=analyze([r,copy.deepcopy(r),row('website')],100)
        self.assertEqual(s['exclusion_reason_counts']['duplicate_trial_id'],2);self.assertEqual(s['strata'],[])
    def test_cross_group_policy(self):
        r=row('manual');r['cards'][0]['name']=r['cards'][1]['name'];self.assertEqual(eligibility(r),[])
        r['draw_policy']='one_deck_5_no_replacement';self.assertIn('duplicate_within_policy',eligibility(r))
    def test_result_conflict(self):
        r=row('website');r['actual']='A';self.assertEqual(analyze([row('manual'),r],100)['result_conflict_groups'],1)
    def test_reader_isolation(self):
        r=row('website');r['reader_id']='another';self.assertEqual(analyze([row('manual'),r],100)['strata'],[])
    def test_invalid_card(self):
        r=row('manual');r['cards'][0]['name']='不存在';self.assertIn('card_input',eligibility(r))
    def test_ai_isolation(self):
        r=row('manual');r['ai_involvement']='ai_rewrite';self.assertIn('ai_involved_before_lock',eligibility(r))
    def test_result_source(self):
        r=row('manual');r['actual_source_url']=None;self.assertIn('missing_actual_source',eligibility(r))
    def test_information_after_draw(self):
        r=row('manual');r['information_snapshot_at']='2026-11-07T03:00:00+08:00';self.assertIn('invalid_information_snapshot_time',eligibility(r))


if __name__=='__main__':unittest.main()
