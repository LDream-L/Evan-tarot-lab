// 世足賽事驗證 v1.4.0｜淘汰賽雲端相容與紀錄顯示
// decorateRows／syncAll：O(r) 時間；摘要建立：O(p) 時間／O(p) 空間，p<=10。
// 更快替代方案：沿用既有 Sheets 欄位寫入階段摘要，避免為本次升級逐欄改表並重新部署後端。
(function initFootballKnockoutEnhancements(){
"use strict";
const core=window.FootballLabCore,cloud=window.FootballLabCloud;
if(!core)return;
const $=id=>document.getElementById(id),clean=value=>String(value==null?"":value).trim();
const stageLabel=value=>({regulation:"90 分鐘",extraTime:"延長賽",penalties:"PK"}[value]||"—");
const winner=(record,value)=>value==="H"?record.match.homeTeam:value==="A"?record.match.awayTeam:"—";
function cardText(cards){return Array.isArray(cards)?cards.map(card=>`${card.title||card.position}：${card.name}${card.orientation}`).join("；"):"";}
function predictionSummary(record){
const knockout=record?.prediction?.knockout;if(!knockout)return "";const lines=["【淘汰賽分階段預測】",`最終晉級：${winner(record,knockout.finalAdvance)}`,`預測決勝階段：${stageLabel(knockout.resolvedBy)}`];
const extra=knockout.stages?.extraTime;if(extra){if(extra.directResult)lines.push(`延長賽單張：${core.data.resultLabels[extra.directResult]||extra.directResult}`);if(Number.isInteger(extra.structureHomeGoals)&&Number.isInteger(extra.structureAwayGoals))lines.push(`延長賽新增比分：${extra.structureHomeGoals}：${extra.structureAwayGoals}`);const cards=cardText(extra.cards);if(cards)lines.push(`延長賽牌面：${cards}`);}
const penalties=knockout.stages?.penalties;if(penalties){lines.push(`PK 勝者：${winner(record,penalties.winner)}`);const cards=cardText(penalties.cards);if(cards)lines.push(`PK 牌面：${cards}`);}
return lines.join("\n");
}
function actualSummary(actual){
if(!actual?.knockout)return "";const lines=["【淘汰賽實際結果】",`決勝階段：${stageLabel(actual.knockout.decidedBy)}`];if(Number.isInteger(actual.extraHomeGoals)&&Number.isInteger(actual.extraAwayGoals))lines.push(`120 分鐘總比分：${actual.extraHomeGoals}：${actual.extraAwayGoals}`);if(Number.isInteger(actual.knockout.penaltyHomeGoals)&&Number.isInteger(actual.knockout.penaltyAwayGoals))lines.push(`PK 比分：${actual.knockout.penaltyHomeGoals}：${actual.knockout.penaltyAwayGoals}`);return lines.join("\n");
}
function appendOnce(original,summary){const source=clean(original);if(!summary||source.includes("【淘汰賽分階段預測】")||source.includes("【淘汰賽實際結果】"))return source;return source?`${source}\n\n${summary}`:summary;}
function cloudRecord(record){
const summary=predictionSummary(record);if(!summary)return record;const clone=structuredClone(record),p=clone.prediction||{};
if(core.modeIncludesStructure(core.getMode(record)))p.structureNotes=appendOnce(p.structureNotes,summary);else p.directNotes=appendOnce(p.directNotes,summary);clone.prediction=p;return clone;
}
function cloudActual(actual){const summary=actualSummary(actual);return summary?{...actual,notes:appendOnce(actual.notes,summary)}:actual;}
if(cloud){
const wrapped=Object.freeze({...cloud,
async saveRecord(record){return cloud.saveRecord(cloudRecord(record));},
async updateActual(id,actual){return cloud.updateActual(id,cloudActual(actual));},
async syncAll(records,onProgress){let synced=0,completed=0;for(let i=0;i<records.length;i+=1){const record=records[i];await wrapped.saveRecord(record);synced+=1;if(record.actual){await wrapped.updateActual(record.id,record.actual);completed+=1;}onProgress?.(i+1,records.length);}return {synced,completed};}
});window.FootballLabCloud=wrapped;
const button=$("football-sync-all");button?.addEventListener("click",async event=>{event.preventDefault();event.stopImmediatePropagation();const records=core.getRecords();if(!records.length)return wrapped.setStatus("目前沒有本機紀錄需要同步。","is-warning");if(!wrapped.hasToken())return wrapped.setStatus("請先從右上角登入資料庫擁有者帳號。","is-warning");button.disabled=true;try{const result=await wrapped.syncAll(records,(done,total)=>wrapped.setStatus(`正在同步 ${done}／${total} 筆……`,"is-warning"));wrapped.setStatus(`同步完成：${result.synced} 筆賽事，其中 ${result.completed} 筆包含賽果。`,"is-success");}catch(error){wrapped.setStatus(`同步失敗：${error.message}`,"is-error");}finally{button.disabled=!wrapped.hasToken();}},true);
}
function addLine(card,label,value){
if(!card||card.querySelector(`[data-knockout-line="${label}"]`))return;const line=document.createElement("div");line.dataset.knockoutLine=label;line.className="football-prediction-line";const kind=document.createElement("span");kind.className="football-prediction-kind";kind.textContent=label;const content=document.createElement("span");content.className="football-prediction-value";content.textContent=value;line.append(kind,content);(card.querySelector(".football-prediction-lines")||card).appendChild(line);
}
function decorateRow(row,record){
const knockout=record?.prediction?.knockout;if(!knockout)return;const prediction=row.children[2]?.querySelector(".football-outcome-card"),actual=row.children[3]?.querySelector(".football-outcome-card");addLine(prediction,"晉級",winner(record,knockout.finalAdvance));addLine(prediction,"決勝",stageLabel(knockout.resolvedBy));
if(record.actual){addLine(actual,"晉級",winner(record,record.actual.advance));if(Number.isInteger(record.actual.extraHomeGoals)&&Number.isInteger(record.actual.extraAwayGoals))addLine(actual,"120 分",`${record.actual.extraHomeGoals}：${record.actual.extraAwayGoals}`);const ph=record.actual.knockout?.penaltyHomeGoals,pa=record.actual.knockout?.penaltyAwayGoals;if(Number.isInteger(ph)&&Number.isInteger(pa))addLine(actual,"PK",`${ph}：${pa}`);}
}
function addKpi(){
const grid=$("football-kpis");if(!grid||grid.querySelector("[data-knockout-kpi='1']"))return;const stats=core.calculateStats(),total=stats.advanceEligible||0,hits=stats.advanceHits||0,card=document.createElement("article");card.className="football-kpi";card.dataset.knockoutKpi="1";const small=document.createElement("small");small.textContent="最終晉級";const strong=document.createElement("strong");strong.textContent=total?`${Math.round(hits/total*1000)/10}%`:"—";const span=document.createElement("span");span.textContent=`${hits}／${total}`;card.append(small,strong,span);grid.appendChild(card);
}
/** 單次依排序映射現有列：O(r) 時間／O(1) 額外空間。 */
function decorateRows(){
const body=$("football-records-body");if(!body)return;const records=core.getRecords().sort((a,b)=>String(b.match?.kickoff||"").localeCompare(String(a.match?.kickoff||"")));Array.from(body.children).forEach((row,index)=>decorateRow(row,records[index]));addKpi();
}
const body=$("football-records-body");if(body){new MutationObserver(()=>requestAnimationFrame(()=>requestAnimationFrame(decorateRows))).observe(body,{childList:true});requestAnimationFrame(()=>requestAnimationFrame(decorateRows));}
$("football-evaluation-form")?.addEventListener("submit",()=>setTimeout(decorateRows,0));
})();
