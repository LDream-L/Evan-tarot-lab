"""牌源成對分析；只使用 Python 標準函式庫。

主要流程：時間 O(N + B×M)、空間 O(N+B)，M 為有效成對賽事數。
比較：每場掃描全部紀錄找配對為 O(N²)；本版以 tuple 查表單次建立索引。
Bootstrap 預先建立每對差值，不在內層重算命中、時間與欄位驗證。
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime
import json
import math
from pathlib import Path
import random

POSITIONS = ['field','homeAttack','awayDefense','awayAttack','homeDefense']
DECK = frozenset(json.loads((Path(__file__).parent.parent/'deck.json').read_text()))


def parse_time(value):
    """解析帶時區時間；固定長度輸入時間／空間 O(1)。"""
    try:
        t = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return t if t.tzinfo is not None else None
    except (ValueError, AttributeError, TypeError):
        return None


def exact_mcnemar(b, c):
    """雙尾精確 McNemar；O(b+c) 算術操作，大整數位元成本另計；空間 O(b+c) bits。"""
    n = b+c
    if not n:
        return 1.0
    term = total = 1
    for k in range(1, min(b,c)+1):
        term = term * (n-k+1) // k
        total += term
    return min(1.0, (2*total)/(1 << n))


def paired_ci(diffs, repeats=5000, seed=20261107):
    """成對差值 percentile bootstrap；時間 O(B×M)、空間 O(M+B)。近似區間。"""
    if not diffs:
        return None
    rng = random.Random(seed)
    n = len(diffs)
    scale = 1/n
    samples = [sum(rng.choices(diffs,k=n))*scale for _ in range(repeats)]
    samples.sort()
    return [samples[int(.025*(repeats-1))], samples[int(.975*(repeats-1))]]


def eligibility(row):
    """前向資格與輸入檢查；時間／空間 O(P)，P=5；不自動補牌或補時間。"""
    reasons=[]
    for key in ['trial_id','match_id','reader_id','protocol_version','source','experiment','block','original_reading']:
        if not row.get(key):reasons.append('missing_'+key)
    if row.get('source') not in ('manual','website'):reasons.append('invalid_source')
    lock, kickoff, drawn = (parse_time(row.get(k)) for k in ('locked_at','kickoff','drawn_at'))
    if not lock or not kickoff or not drawn:reasons.append('missing_or_naive_time')
    elif not drawn <= lock < kickoff:reasons.append('not_pre_match')
    if row.get('result_known_at_reading') is not False:reasons.append('result_knowledge_not_cleared')
    info=parse_time(row.get('information_snapshot_at'))
    if not info or (drawn and info>drawn):reasons.append('invalid_information_snapshot_time')
    confidence=row.get('confidence_1_5')
    if confidence is not None and (type(confidence) is not int or not 1<=confidence<=5):reasons.append('invalid_confidence')
    if row.get('ai_involvement')!='none_before_lock':reasons.append('ai_involved_before_lock')
    if row.get('prediction') not in ('H','D','A','ABSTAIN'):reasons.append('invalid_prediction')
    cards=row.get('cards')
    if not isinstance(cards,list) or len(cards)!=5:
        reasons.append('invalid_cards')
    else:
        if [c.get('position') for c in cards]!=POSITIONS:reasons.append('position_order')
        if any(c.get('name') not in DECK or c.get('orientation') not in ('upright','reversed') for c in cards):reasons.append('card_input')
        policy=row.get('draw_policy')
        if policy not in ('one_deck_5_no_replacement','field_reset_then_4'):reasons.append('unknown_draw_policy')
        checked=cards if policy=='one_deck_5_no_replacement' else cards[1:]
        if len({c.get('name') for c in checked})!=len(checked):reasons.append('duplicate_within_policy')
    actual=row.get('actual')
    if actual is not None and actual not in ('H','D','A'):reasons.append('invalid_actual')
    if actual is not None:
        verified=parse_time(row.get('result_verified_at'))
        if not str(row.get('actual_source_url')or'').startswith(('https://','http://')):reasons.append('missing_actual_source')
        if not verified or (kickoff and verified<=kickoff):reasons.append('invalid_result_verification_time')
    return reasons


def analyze(rows, repeats=5000):
    """前向資料逐項檢查並同場配對；時間 O(N+B×M)、空間 O(N+B)。"""
    ids=Counter(r.get('trial_id')for r in rows)
    exclusions=Counter();pending=0;groups=defaultdict(lambda:defaultdict(list));counts=Counter()
    for row in rows:
        reasons=eligibility(row)
        if ids[row.get('trial_id')]>1:reasons.append('duplicate_trial_id')
        if reasons:
            exclusions.update(reasons);continue
        if row.get('actual') is None:pending+=1;continue
        key=tuple(row[k]for k in ('experiment','block','protocol_version','reader_id','match_id'))
        groups[key][row['source']].append(row)
    results=defaultdict(list);unpaired=duplicate_pairs=result_conflicts=0
    for key,sources in groups.items():
        if any(len(v)>1 for v in sources.values()):duplicate_pairs+=1;continue
        if set(sources)!= {'manual','website'}:unpaired+=1;continue
        a,b=sources['manual'][0],sources['website'][0]
        if a['actual']!=b['actual'] or a['kickoff']!=b['kickoff']:result_conflicts+=1;continue
        # ABSTAIN 在全體預測率分母中算未命中，另報覆蓋率；不默默刪掉。
        results[key[:4]].append((int(a['prediction']==a['actual']),int(b['prediction']==b['actual']),a['prediction']=='ABSTAIN',b['prediction']=='ABSTAIN'))
    summary=[]
    for stratum,pairs in sorted(results.items()):
        n=len(pairs);manual=sum(x[0]for x in pairs);website=sum(x[1]for x in pairs)
        manual_called=n-sum(x[2]for x in pairs);website_called=n-sum(x[3]for x in pairs)
        b=sum(x[0]and not x[1]for x in pairs);c=sum(x[1]and not x[0]for x in pairs)
        summary.append({'stratum':stratum,'pairs':n,'manual_hits':manual,'website_hits':website,
                        'manual_rate':manual/n,'website_rate':website/n,'difference':(manual-website)/n,
                        'manual_only':b,'website_only':c,'both':sum(x[0]and x[1]for x in pairs),
                        'neither':sum(not x[0]and not x[1]for x in pairs),'exact_mcnemar_p':exact_mcnemar(b,c),
                        'paired_bootstrap_95ci':paired_ci([x[0]-x[1]for x in pairs],repeats),
                        'manual_coverage':manual_called/n,'website_coverage':website_called/n,
                        'manual_selective_rate':manual/manual_called if manual_called else None,
                        'website_selective_rate':website/website_called if website_called else None})
    return {'rows':len(rows),'pending':pending,'exclusion_reason_counts':dict(exclusions),
            'unpaired_groups':unpaired,'duplicate_pair_groups':duplicate_pairs,'result_conflict_groups':result_conflicts,
            'strata':summary,'note':'不同實驗、區塊、版本與解牌者不混算；bootstrap為近似區間，p值不證明機制。'}


def main():
    """檔案讀取與CLI；時間／空間 O(N+輸出大小)，加上 analyze 成本。"""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('jsonl');parser.add_argument('--bootstrap',type=int,default=5000)
    args=parser.parse_args()
    if args.bootstrap<100:parser.error('--bootstrap 至少100次')
    rows=[json.loads(line)for line in Path(args.jsonl).read_text().splitlines()if line.strip()]
    print(json.dumps(analyze(rows,args.bootstrap),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
