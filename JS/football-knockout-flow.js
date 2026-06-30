// 世足賽事驗證 v1.4.0｜淘汰賽分階段預測：90 分鐘 → 延長賽 → PK
// drawCards：O(n+p) 時間／O(n) 空間，n=78、p<=5。
// validateKnockout：O(p) 時間／O(p) 空間，p<=10；evaluateKnockout：O(1) 時間／O(1) 空間。
// 更快替代方案：不在同一階段反覆重抽；只在前一階段預測和局時建立下一階段的一次性牌組。
(function initFootballKnockoutFlow(){
"use strict";
const base=window.FootballLabCore,baseUi=window.FootballLabRender;
if(!base||!baseUi)return;
const ADV="advance",REG="regulation",ET="extra-time-then-penalties",PK="penalties-only";
const validResult=new Set(["H","D","A"]),validWinner=new Set(["H","A"]);
const extraSpecs=[
["extraResult","延長賽結果牌","只問延長賽 30 分鐘主勝、和局或客勝。","direct"],
["extraHomeAttack","主隊延長賽進攻","主隊在延長賽新增進球的能力。","structure"],
["extraHomeDefense","主隊延長賽防守","主隊在延長賽承受失球的風險。","structure"],
["extraAwayAttack","客隊延長賽進攻","客隊在延長賽新增進球的能力。","structure"],
["extraAwayDefense","客隊延長賽防守","客隊在延長賽承受失球的風險。","structure"]
];
const penaltySpecs=[
["homeShooters","主隊罰球穩定度","主隊射手執行、抗壓與失誤風險。"],
["homeKeeper","主隊門將表現","主隊門將判斷、反應與撲救可能性。"],
["awayShooters","客隊罰球穩定度","客隊射手執行、抗壓與失誤風險。"],
["awayKeeper","客隊門將表現","客隊門將判斷、反應與撲救可能性。"],
["penaltyResult","PK 最終結果牌","判斷 PK 最後由哪一隊晉級。"]
];
const $=id=>document.getElementById(id),text=id=>String($(id)?.value||"").trim();
const integer=id=>{const raw=text(id);if(raw==="")return null;const value=Number(raw);return Number.isInteger(value)?value:null;};
const hidden=(el,state)=>el?.classList.toggle("football-hidden",!!state);
const scope=match=>match?.predictionScope===ADV?ADV:REG;
const rule=match=>match?.knockoutRule===PK?PK:ET;
const modeResults=(mode,direct,home,away)=>{
const out=[];
if(base.modeIncludesDirect(mode)&&validResult.has(direct))out.push(direct);
if(base.modeIncludesStructure(mode)&&Number.isInteger(home)&&Number.isInteger(away)&&home>=0&&away>=0)out.push(base.getResult(home,away));
return out;
};
const baseResults=mode=>modeResults(mode,text("football-direct-result"),integer("football-structure-home-goals"),integer("football-structure-away-goals"));
const extraResults=mode=>modeResults(mode,text("football-extra-direct-result"),integer("football-extra-structure-home-goals"),integer("football-extra-structure-away-goals"));
const hasDraw=results=>results.includes("D");
const option=(value,label)=>{const o=document.createElement("option");o.value=value;o.textContent=label;return o;};
function injectStyle(){
if($("football-knockout-style"))return;
const style=document.createElement("style");style.id="football-knockout-style";style.textContent=`
.football-knockout-note{grid-column:1/-1;margin:0;padding:.75rem .9rem;border-left:3px solid rgba(177,143,255,.68);border-radius:8px;background:rgba(131,101,218,.08);font-size:.84rem;line-height:1.6}
.football-knockout-flow{display:grid;gap:1rem;margin:1rem 0}.football-knockout-stage{display:grid;gap:1rem;padding:1rem;border:1px solid rgba(176,145,255,.28);border-radius:15px;background:rgba(255,255,255,.022)}
.football-knockout-heading{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}.football-knockout-heading h4,.football-knockout-heading p{margin:0}.football-knockout-heading p{margin-top:.35rem;font-size:.84rem;opacity:.78}
.football-knockout-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.football-knockout-card{display:grid;gap:.5rem;padding:.85rem;border:1px solid rgba(176,145,255,.22);border-radius:13px}.football-knockout-card h5,.football-knockout-card p{margin:0}.football-knockout-card p{font-size:.78rem;opacity:.72}
.football-knockout-actual{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;padding:1rem;border:1px solid rgba(176,145,255,.2);border-radius:14px}
@media(max-width:760px){.football-knockout-cards,.football-knockout-actual{grid-template-columns:1fr}}
`;document.head.appendChild(style);
}
function ensureMatchFields(){
if($("football-prediction-scope"))return;
const mode=$("football-mode"),label=mode?.closest("label"),grid=mode?.closest(".football-form-grid");if(!label||!grid)return;
const scopeLabel=document.createElement("label");scopeLabel.textContent="預測範圍";
const scopeSelect=document.createElement("select");scopeSelect.id="football-prediction-scope";scopeSelect.append(option(REG,"只預測 90 分鐘"),option(ADV,"一路預測到最終晉級"));scopeLabel.appendChild(scopeSelect);
const ruleLabel=document.createElement("label");ruleLabel.id="football-knockout-rule-field";ruleLabel.textContent="和局後決勝規則";
const ruleSelect=document.createElement("select");ruleSelect.id="football-knockout-rule";ruleSelect.append(option(ET,"90 分鐘 → 延長賽 30 分鐘 → PK"),option(PK,"90 分鐘 → 直接 PK"));ruleLabel.appendChild(ruleSelect);
const note=document.createElement("p");note.id="football-knockout-note";note.className="football-knockout-note";note.textContent="每個階段只抽一次；只有前一階段判斷和局，才開啟下一階段。";
label.after(scopeLabel,ruleLabel);grid.appendChild(note);
const stage=$("football-stage"),knockout=new Set(["32強","16強","8強","準決賽","季軍賽","決賽"]);let touched=false;
const refresh=()=>{hidden(ruleLabel,scopeSelect.value!==ADV);hidden(note,scopeSelect.value!==ADV);};
scopeSelect.addEventListener("change",()=>{touched=true;refresh();});
stage?.addEventListener("change",()=>{if(!touched){scopeSelect.value=knockout.has(stage.value)?ADV:REG;refresh();}});
scopeSelect.value=knockout.has(stage?.value)?ADV:REG;refresh();
}
function randomInt(max){
const range=0x100000000,limit=range-range%max,b=new Uint32Array(1);let value;
do{crypto.getRandomValues(b);value=b[0];}while(value>=limit);return value%max;
}
/** Fisher-Yates 部分洗牌：O(n+p) 時間／O(n) 空間。 */
function drawCards(specs){
const pool=base.data.deck.slice(),cards=[];
for(let i=0;i<specs.length;i+=1){const j=i+randomInt(pool.length-i);[pool[i],pool[j]]=[pool[j],pool[i]];cards.push({position:specs[i][0],title:specs[i][1],name:pool[i],orientation:randomInt(2)?"逆位":"正位"});}
return cards;
}
function specsFor(stage,mode){
if(stage==="penalties")return penaltySpecs;
return extraSpecs.filter(spec=>(spec[3]==="direct"&&base.modeIncludesDirect(mode))||(spec[3]==="structure"&&base.modeIncludesStructure(mode)));
}
function cardInput(stage,spec,source,drawn){
const article=document.createElement("article");article.className="football-knockout-card";
const title=document.createElement("h5");title.textContent=spec[1];const note=document.createElement("p");note.textContent=spec[2];article.append(title,note);
if(source==="random"){
const strong=document.createElement("strong");strong.textContent=`${drawn.name}${drawn.orientation}`;strong.dataset.cardName=drawn.name;strong.dataset.cardOrientation=drawn.orientation;strong.dataset.position=spec[0];article.appendChild(strong);
}else{
const select=document.createElement("select");select.id=`football-${stage}-card-${spec[0]}`;select.appendChild(option("","選擇抽到的牌"));base.data.deck.forEach(name=>select.appendChild(option(name,name)));
const orientation=document.createElement("select");orientation.id=`football-${stage}-orientation-${spec[0]}`;orientation.append(option("正位","正位"),option("逆位","逆位"));article.append(select,orientation);
}
return article;
}
function stageCards(stage,draft){
const specs=specsFor(stage,draft.match.mode),source=draft.match.cardSource;
const cache=draft.knockoutCards||(draft.knockoutCards={});
if(source==="random"&&!cache[stage])cache[stage]=drawCards(specs);
const grid=document.createElement("div");grid.className="football-knockout-cards";grid.id=`football-${stage}-cards`;
specs.forEach((spec,index)=>grid.appendChild(cardInput(stage,spec,source,cache[stage]?.[index])));return grid;
}
function collectCards(stage,draft){
const specs=specsFor(stage,draft.match.mode),source=draft.match.cardSource;
if(source==="random")return (draft.knockoutCards?.[stage]||[]).map(card=>({...card}));
return specs.map(spec=>({position:spec[0],title:spec[1],name:text(`football-${stage}-card-${spec[0]}`),orientation:text(`football-${stage}-orientation-${spec[0]}`)}));
}
function cardsError(stage,draft){
const cards=collectCards(stage,draft),used=new Set();
for(const card of cards){if(!base.data.deck.includes(card.name))return `請完整記錄「${card.title}」。`;if(!["正位","逆位"].includes(card.orientation))return `請選擇「${card.title}」正逆位。`;if(used.has(card.name))return `「${card.name}」在同一階段重複出現。`;used.add(card.name);}
return "";
}
function stageShell(id,title,description){
const section=document.createElement("section");section.id=id;section.className="football-knockout-stage football-hidden";
const heading=document.createElement("div");heading.className="football-knockout-heading";const copy=document.createElement("div");const h=document.createElement("h4");h.textContent=title;const p=document.createElement("p");p.textContent=description;copy.append(h,p);heading.appendChild(copy);section.appendChild(heading);return section;
}
function createExtra(draft){
const section=stageShell("football-extra-stage","C｜延長賽 30 分鐘","90 分鐘模型判斷和局後，重新洗牌並只判斷延長賽階段。");section.appendChild(stageCards("extra",draft));
const grid=document.createElement("div");grid.className="football-form-grid";
if(base.modeIncludesDirect(draft.match.mode)){
const label=document.createElement("label");label.textContent="延長賽單張結果";const select=document.createElement("select");select.id="football-extra-direct-result";select.append(option("","請選擇"),option("H",`${draft.match.homeTeam} 勝`),option("D","和局"),option("A",`${draft.match.awayTeam} 勝`));label.appendChild(select);grid.appendChild(label);
const notes=document.createElement("label");notes.className="football-span-2";notes.textContent="延長賽單張解讀";const area=document.createElement("textarea");area.id="football-extra-direct-notes";area.rows=3;notes.appendChild(area);grid.appendChild(notes);
}
if(base.modeIncludesStructure(draft.match.mode)){
[["football-extra-structure-home-goals",`${draft.match.homeTeam} 延長賽新增進球`],["football-extra-structure-away-goals",`${draft.match.awayTeam} 延長賽新增進球`]].forEach(([id,labelText])=>{const label=document.createElement("label");label.textContent=labelText;const input=document.createElement("input");input.id=id;input.type="number";input.min="0";input.max="20";input.step="1";label.appendChild(input);grid.appendChild(label);});
const notes=document.createElement("label");notes.className="football-span-2";notes.textContent="延長賽攻防解讀";const area=document.createElement("textarea");area.id="football-extra-structure-notes";area.rows=4;notes.appendChild(area);grid.appendChild(notes);
}
section.appendChild(grid);return section;
}
function createPenalty(draft){
const section=stageShell("football-penalty-stage","D｜PK 大戰","延長賽仍判和局，或賽制為 90 分鐘後直接 PK，才建立本階段牌組。");section.appendChild(stageCards("penalty",draft));
const grid=document.createElement("div");grid.className="football-form-grid";const label=document.createElement("label");label.textContent="PK 最終勝者";const select=document.createElement("select");select.id="football-penalty-winner";select.append(option("","請選擇"),option("H",`${draft.match.homeTeam} 晉級`),option("A",`${draft.match.awayTeam} 晉級`));label.appendChild(select);grid.appendChild(label);
const notes=document.createElement("label");notes.className="football-span-2";notes.textContent="PK 牌面解讀";const area=document.createElement("textarea");area.id="football-penalty-notes";area.rows=4;notes.appendChild(area);grid.appendChild(notes);section.appendChild(grid);return section;
}
function refreshFlow(draft){
if(scope(draft.match)!==ADV)return;
const baseDraw=hasDraw(baseResults(draft.match.mode)),directPk=rule(draft.match)===PK;
hidden($("football-extra-stage"),!baseDraw||directPk);
const needPenalty=baseDraw&&(directPk||hasDraw(extraResults(draft.match.mode)));
hidden($("football-penalty-stage"),!needPenalty);
const advance=$("football-advance-prediction");if(advance)advance.required=true;
}
function ensureFlow(draft){
$("football-knockout-flow")?.remove();if(scope(draft.match)!==ADV)return;
const lock=$("football-lock-button"),form=$("football-reading-form");if(!lock||!form)return;
const flow=document.createElement("div");flow.id="football-knockout-flow";flow.className="football-knockout-flow";flow.append(createExtra(draft),createPenalty(draft));lock.before(flow);
["football-direct-result","football-structure-home-goals","football-structure-away-goals","football-extra-direct-result","football-extra-structure-home-goals","football-extra-structure-away-goals"].forEach(id=>{const el=$(id);el?.addEventListener("input",()=>refreshFlow(draft));el?.addEventListener("change",()=>refreshFlow(draft));});refreshFlow(draft);
}
function validateKnockout(prediction,draft){
if(!draft||scope(draft.match)!==ADV)return "";
if(!validWinner.has(prediction.advance))return "請選擇最終晉級隊伍。";
const results=modeResults(draft.match.mode,prediction.directResult,prediction.structureHomeGoals,prediction.structureAwayGoals);
if(!hasDraw(results))return "";
if(rule(draft.match)===ET){
let error=cardsError("extra",draft);if(error)return error;
if(base.modeIncludesDirect(draft.match.mode)&&(!validResult.has(text("football-extra-direct-result"))||!text("football-extra-direct-notes")))return "請完成延長賽單張結果與解讀。";
if(base.modeIncludesStructure(draft.match.mode)){
const h=integer("football-extra-structure-home-goals"),a=integer("football-extra-structure-away-goals");if(h==null||a==null||h<0||a<0)return "請填寫延長賽兩隊新增進球。";if(!text("football-extra-structure-notes"))return "請完成延長賽攻防解讀。";
}
if(!hasDraw(extraResults(draft.match.mode)))return "";
}
const error=cardsError("penalty",draft);if(error)return error;
if(!validWinner.has(text("football-penalty-winner"))||!text("football-penalty-notes"))return "請完成 PK 最終勝者與牌面解讀。";
return "";
}
function buildKnockout(prediction,draft){
if(!draft||scope(draft.match)!==ADV)return null;
const baseStage=modeResults(draft.match.mode,prediction.directResult,prediction.structureHomeGoals,prediction.structureAwayGoals),route=["regulation"],stages={};let resolvedBy="regulation";
if(hasDraw(baseStage)){
if(rule(draft.match)===ET){
route.push("extraTime");const extra={cards:collectCards("extra",draft)};
if(base.modeIncludesDirect(draft.match.mode)){extra.directResult=text("football-extra-direct-result");extra.directNotes=text("football-extra-direct-notes");}
if(base.modeIncludesStructure(draft.match.mode)){extra.structureHomeGoals=integer("football-extra-structure-home-goals");extra.structureAwayGoals=integer("football-extra-structure-away-goals");extra.structureNotes=text("football-extra-structure-notes");}
stages.extraTime=extra;resolvedBy="extraTime";
if(hasDraw(extraResults(draft.match.mode)))resolvedBy="penalties";
}else resolvedBy="penalties";
if(resolvedBy==="penalties"){route.push("penalties");stages.penalties={cards:collectCards("penalty",draft),winner:text("football-penalty-winner"),notes:text("football-penalty-notes")};}
}
return {version:"1.0.0",rule:rule(draft.match),route,stages,finalAdvance:prediction.advance,resolvedBy};
}
function ensureActualFields(){
if($("football-actual-penalty-home"))return;const formGrid=document.querySelector("#football-evaluation-form .football-form-grid");if(!formGrid)return;
const box=document.createElement("div");box.id="football-knockout-actual";box.className="football-knockout-actual football-hidden";
[["football-actual-penalty-home","主隊 PK 進球"],["football-actual-penalty-away","客隊 PK 進球"]].forEach(([id,labelText])=>{const label=document.createElement("label");label.textContent=labelText;const input=document.createElement("input");input.id=id;input.type="number";input.min="0";input.max="30";input.step="1";label.appendChild(input);box.appendChild(label);});formGrid.appendChild(box);
}
function configureActual(record){
const active=scope(record?.match)===ADV;hidden($("football-knockout-actual"),!active);const advance=$("football-actual-advance");if(advance)advance.required=active;
$("football-actual-penalty-home").value=record?.actual?.knockout?.penaltyHomeGoals??"";$("football-actual-penalty-away").value=record?.actual?.knockout?.penaltyAwayGoals??"";
}
function actualRoute(record,actual){
if(!actual||scope(record?.match)!==ADV)return "";
if(actual.homeGoals!==actual.awayGoals)return "regulation";
if(rule(record.match)===PK)return "penalties";
if(Number.isInteger(actual.extraHomeGoals)&&Number.isInteger(actual.extraAwayGoals))return actual.extraHomeGoals===actual.extraAwayGoals?"penalties":"extraTime";
return "";
}
function validateActual(record){
if(!record||scope(record.match)!==ADV)return "";const h=integer("football-actual-home"),a=integer("football-actual-away");if(h==null||a==null)return "";
if(!validWinner.has(text("football-actual-advance")))return "請填寫最終晉級隊伍。";
if(h===a&&rule(record.match)===ET){const eh=integer("football-extra-home"),ea=integer("football-extra-away");if(eh==null||ea==null||eh<h||ea<a)return "90 分鐘和局時，請填寫 120 分鐘總比分。";if(eh===ea){const ph=integer("football-actual-penalty-home"),pa=integer("football-actual-penalty-away");if(ph==null||pa==null||ph===pa)return "請填寫能分出勝負的 PK 比分。";}}
if(h===a&&rule(record.match)===PK){const ph=integer("football-actual-penalty-home"),pa=integer("football-actual-penalty-away");if(ph==null||pa==null||ph===pa)return "請填寫能分出勝負的 PK 比分。";}
return "";
}
function actualKnockout(record,actual){
const decidedBy=actualRoute(record,actual),out={decidedBy};
if(decidedBy==="penalties"){out.penaltyHomeGoals=integer("football-actual-penalty-home");out.penaltyAwayGoals=integer("football-actual-penalty-away");}
return out;
}
function evaluateKnockout(record){
const prediction=record?.prediction?.knockout,actual=record?.actual;if(!prediction||!actual)return null;
const decidedBy=actual.knockout?.decidedBy||actualRoute(record,actual),result={predictedResolvedBy:prediction.resolvedBy,actualDecidedBy:decidedBy,finalAdvanceEligible:validWinner.has(actual.advance),finalAdvanceHit:prediction.finalAdvance===actual.advance,decidedByHit:prediction.resolvedBy===decidedBy};
const extra=prediction.stages?.extraTime;
if(extra&&Number.isInteger(actual.extraHomeGoals)&&Number.isInteger(actual.extraAwayGoals)){
const h=actual.extraHomeGoals-actual.homeGoals,a=actual.extraAwayGoals-actual.awayGoals,r=base.getResult(h,a);result.extraTime={actualHomeGoals:h,actualAwayGoals:a,actualResult:r};
if(validResult.has(extra.directResult))result.extraTime.directResultHit=extra.directResult===r;
if(Number.isInteger(extra.structureHomeGoals)&&Number.isInteger(extra.structureAwayGoals)){result.extraTime.structureResultHit=base.getResult(extra.structureHomeGoals,extra.structureAwayGoals)===r;result.extraTime.structureExactHit=extra.structureHomeGoals===h&&extra.structureAwayGoals===a;result.extraTime.structureAbsoluteError=Math.abs(extra.structureHomeGoals-h)+Math.abs(extra.structureAwayGoals-a);}
}
const penalties=prediction.stages?.penalties,ph=actual.knockout?.penaltyHomeGoals,pa=actual.knockout?.penaltyAwayGoals;
if(penalties&&Number.isInteger(ph)&&Number.isInteger(pa)&&ph!==pa){const winner=ph>pa?"H":"A";result.penalties={actualWinner:winner,winnerHit:penalties.winner===winner,actualHomeGoals:ph,actualAwayGoals:pa};}
return result;
}
function addScore(grid,label,hit,detail){
const item=document.createElement("article");item.className=`football-score-item ${hit?"is-hit":"is-miss"}`;const small=document.createElement("small");small.textContent=label;const strong=document.createElement("strong");strong.textContent=hit?"命中":"未中";const span=document.createElement("span");span.textContent=detail;item.append(small,strong,span);grid.appendChild(item);
}
function appendScorecard(record){
const ev=window.FootballLabCore.calculateEvaluation(record)?.knockout,grid=$("football-scorecard")?.querySelector(".football-score-grid");if(!ev||!grid||grid.dataset.knockout==="1")return;grid.dataset.knockout="1";
addScore(grid,"最終晉級",ev.finalAdvanceHit,`預測 ${record.prediction.knockout.finalAdvance}／實際 ${record.actual.advance}`);addScore(grid,"決勝階段",ev.decidedByHit,`預測 ${ev.predictedResolvedBy}／實際 ${ev.actualDecidedBy}`);
if(ev.extraTime?.directResultHit!=null)addScore(grid,"延長賽單張結果",ev.extraTime.directResultHit,`實際 ${ev.extraTime.actualResult}`);
if(ev.extraTime?.structureResultHit!=null){addScore(grid,"延長賽攻防賽果",ev.extraTime.structureResultHit,`實際新增 ${ev.extraTime.actualHomeGoals}：${ev.extraTime.actualAwayGoals}`);addScore(grid,"延長賽確切比分",ev.extraTime.structureExactHit,`誤差 ${ev.extraTime.structureAbsoluteError} 球`);}
if(ev.penalties)addScore(grid,"PK 最終勝者",ev.penalties.winnerHit,`實際 ${ev.penalties.actualHomeGoals}：${ev.penalties.actualAwayGoals}`);
}
injectStyle();ensureMatchFields();ensureActualFields();
const core=Object.freeze({...base,
createDraft(match){return base.createDraft({...match,predictionScope:text("football-prediction-scope")||REG,knockoutRule:text("football-knockout-rule")||ET});},
validateMatch(match){const error=base.validateMatch(match);if(error)return error;const s=text("football-prediction-scope")||REG,r=text("football-knockout-rule")||ET;if(![REG,ADV].includes(s))return "請選擇預測範圍。";if(s===ADV&&![ET,PK].includes(r))return "請選擇和局後決勝規則。";return "";},
validatePrediction(prediction,mode){return base.validatePrediction(prediction,mode)||validateKnockout(prediction,base.getDraft());},
lockDraft(prediction,cards){const draft=base.getDraft();return base.lockDraft({...prediction,knockout:buildKnockout(prediction,draft)},cards);},
updateActual(id,actual){const record=base.getRecord(id);return base.updateActual(id,scope(record?.match)===ADV?{...actual,knockout:actualKnockout(record,actual)}:actual);},
calculateEvaluation(record){const ev=base.calculateEvaluation(record);return ev?{...ev,knockout:evaluateKnockout(record)}:ev;},
calculateStats(){const stats=base.calculateStats();let advanceEligible=0,advanceHits=0;base.getRecords().forEach(record=>{const ev=core.calculateEvaluation(record)?.knockout;if(ev?.finalAdvanceEligible){advanceEligible+=1;advanceHits+=ev.finalAdvanceHit?1:0;}});return {...stats,advanceEligible,advanceHits};}
});window.FootballLabCore=core;
const ui=Object.freeze({...baseUi,
renderDraft(draft){baseUi.renderDraft(draft);ensureFlow(draft);},
openEvaluation(record){baseUi.openEvaluation(record);configureActual(record);appendScorecard(record);},
renderScorecard(record){baseUi.renderScorecard(record);appendScorecard(record);}
});window.FootballLabRender=ui;
$("football-evaluation-form")?.addEventListener("submit",event=>{const record=core.getRecord(text("football-evaluation-id")),error=validateActual(record);if(!error)return;event.preventDefault();event.stopImmediatePropagation();ui.setMessage("football-evaluation-message",error,"is-error");},true);
})();
