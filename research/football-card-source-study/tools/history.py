"""從Google Drive文字匯出的多分頁CSV快照重算歷史數字欄，原始明細不對外輸出。
時間 O(R+C)、空間 O(R+C)，R為紀錄、C為牌位；字典取代逐筆跨表搜尋。
"""
import csv
import io
import json
from collections import Counter,defaultdict
from datetime import datetime
from pathlib import Path
import sys
from analyze import exact_mcnemar


def summarize(text):
    """解析三個分頁並依同場配對；時間／空間 O(R+C)。不推測解牌者。"""
    parts=text.split('\f')
    rows=list(csv.DictReader(io.StringIO(parts[0].lstrip('\n'))))
    cards=list(csv.DictReader(io.StringIO(parts[1].lstrip('\n'))))if len(parts)>1 else[]
    groups=defaultdict(lambda:defaultdict(list));eligible=[];conflicts=0
    sign=lambda h,a:'H'if h>a else'A'if h<a else'D'
    for r in rows:
        try:h,a,ph,pa=(int(r[k])for k in ('actualHomeGoals','actualAwayGoals','structureHomeGoals','structureAwayGoals'))
        except(ValueError,TypeError,KeyError):continue
        if r['status']!='completed':continue
        p=sign(ph,pa);r['_hit']=p==sign(h,a);r['_exact']=(h,a)==(ph,pa);eligible.append(r)
        if r.get('structureResult')!=p:conflicts+=1
        key=tuple(r[k]for k in ('competition','kickoff','homeTeam','awayTeam'))
        groups[key][r['cardSource']].append(r)
    out={'total':len(rows),'sources':dict(Counter(r['cardSource']for r in rows)),
         'completed':len(eligible),'unique_fixtures':len({tuple(r[k]for k in ('competition','kickoff','homeTeam','awayTeam'))for r in rows}),
         'cards':len(cards),'duplicate_record_ids':len(rows)-len({r['recordId']for r in rows}),
         'numeric_direction_conflict_count':conflicts,'source_stats':{},'source_reversals':{}}
    source_by_id={r['recordId']:r['cardSource']for r in rows}
    reversal_counts=defaultdict(Counter)
    for c in cards:
        source=source_by_id.get(c['recordId'],'unknown');reversal_counts[source]['n']+=1
        reversal_counts[source]['reversed']+=int(c['orientation']=='逆位')
    for source in ('manual','random'):
        ss=[r for r in eligible if r['cardSource']==source]
        out['source_stats'][source]={'n':len(ss),'direction_hits':sum(r['_hit']for r in ss),'exact_hits':sum(r['_exact']for r in ss)}
        out['source_reversals'][source]=dict(reversal_counts[source])
    pairs=[];duplicate_groups=actual_conflicts=0
    for g in groups.values():
        if any(len(v)>1 for v in g.values()):duplicate_groups+=1;continue
        if not {'manual','random'}<=g.keys():continue
        a,b=g['manual'][0],g['random'][0]
        if (a['actualHomeGoals'],a['actualAwayGoals'])!=(b['actualHomeGoals'],b['actualAwayGoals']):actual_conflicts+=1;continue
        pairs.append((a,b))
    b=sum(a['_hit']and not c['_hit']for a,c in pairs);c=sum(c['_hit']and not a['_hit']for a,c in pairs)
    out['paired']={'n':len(pairs),'manual_hits':sum(a['_hit']for a,_ in pairs),'random_hits':sum(b['_hit']for _,b in pairs),
                   'manual_only':b,'random_only':c,'both':sum(a['_hit']and b['_hit']for a,b in pairs),
                   'neither':sum(not a['_hit']and not b['_hit']for a,b in pairs),'exact_mcnemar_p':exact_mcnemar(b,c)}
    out['duplicate_pair_groups']=duplicate_groups;out['actual_conflict_groups']=actual_conflicts
    out['reader_identity']='原始欄位未獨立記錄，不補造作者'
    out['scope']='歷史數字欄描述統計；非同解牌者前向驗證，非外部官方比分核實'
    return out


if __name__=='__main__':
    print(json.dumps(summarize(Path(sys.argv[1]).read_text()),ensure_ascii=False,indent=2))
