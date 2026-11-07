// 現行 GitHub 原碼的離線抽牌檢查；不呼叫網站、不寫入使用者資料。
// 主流程時間 O(T×(D+P))、空間 O(D×P)，D=78、P=5；不保留 T 次牌陣。
// 比較：保存所有抽牌再分組需 O(T×P) 空間；本版逐次累計查表，僅保存首筆供核對。
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');

/** 載入已下載的原碼，時間／空間 O(L)，L 為檔案長度。 */
function loadCore(root) {
  const storage = new Map();
  const window = {crypto:webcrypto, localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
  const context = vm.createContext({window,console,Uint32Array,Intl,Date,Map,Set,Math,JSON});
  const data = fs.readFileSync(path.join(root,'src/football/data.js'),'utf8').replace(/^export /gm,'');
  const core = fs.readFileSync(path.join(root,'src/football/core.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(data+'\nconst data = footballData;\n'+core,context);
  return {core:window.FootballLabCore,window,context};
}

/** T 次原始抽牌，時間 O(T×D)、額外空間 O(D×P)。 */
function audit(root, trials=100000) {
  const {core,window,context}=loadCore(root);
  const names=core.data.deck;
  assert.equal(names.length,78); assert.equal(new Set(names).size,78);
  const positions=['directResult','homeAttack','awayDefense','awayAttack','homeDefense'];
  const index=new Map(names.map((name,i)=>[name,i]));
  const counts=positions.map(()=>Array(78).fill(0));
  let reversed=0,duplicatesAcrossGroups=0,roundTrips=0;
  let firstCards=null;
  for(let i=0;i<trials;i++){
    const draft=core.createDraft({mode:'dual',cardSource:'random'});
    assert.deepEqual(Array.from(draft.cards,c=>c.position),positions);
    assert.equal(core.validateCards(draft.cards,'dual'),'');
    assert.equal(new Set(draft.cards.slice(1).map(c=>c.name)).size,4);
    if(draft.cards.slice(1).some(c=>c.name===draft.cards[0].name))duplicatesAcrossGroups++;
    for(let j=0;j<5;j++){
      const card=draft.cards[j]; counts[j][index.get(card.name)]++;
      if(card.orientation==='逆位')reversed++;
    }
    if(i<1000){assert.equal(JSON.stringify(JSON.parse(JSON.stringify(draft.cards))),JSON.stringify(draft.cards));roundTrips++;}
    if(!firstCards)firstCards=JSON.parse(JSON.stringify(draft.cards));
    core.clearDraft();
  }
  // 明確測試跨群組同牌可通過；不把「允許」誤記成驗證錯誤。
  const cross=JSON.parse(JSON.stringify(firstCards));cross[0].name=cross[1].name;
  assert.equal(core.validateCards(cross,'dual'),'');
  const within=JSON.parse(JSON.stringify(firstCards));within[2].name=within[1].name;
  assert.notEqual(core.validateCards(within,'dual'),'');
  const seq=[0xffffffff,0];let calls=0;
  window.crypto={getRandomValues:buffer=>{buffer[0]=seq[calls++]??0;return buffer;}};
  assert.equal(vm.runInContext('secureRandomInt(78)',context),0);assert.equal(calls,2);
  return {trials,positions,counts,reversed,totalCards:5*trials,duplicatesAcrossGroups,expectedCrossDuplicateRate:4/78,roundTrips,structuralChecks:'passed',scope:'離線核心與JSON序列化；未宣稱完成手機畫面或正式Apps Script往返驗證'};
}
const root=process.argv[2];if(!root)throw new Error('用法：node audit-draw.cjs <repo-root> [trials]');
const trials=Number(process.argv[3]||100000);if(!Number.isInteger(trials)||trials<1)throw new Error('trials 必須為正整數');
process.stdout.write(JSON.stringify(audit(root,trials),null,2)+'\n');
