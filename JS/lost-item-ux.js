// ==============================
// lost-item-ux.js
// 塔羅尋物：把技術結果轉成可直接執行的搜尋指令
// ==============================
// 主要函式複雜度：
// - readRankingRows：O(a)，a <= 5
// - collectRawClues：O(c + e)，c <= 3、e <= 8
// - buildActionClues：O(r × k)，r = 固定規則數、k = 線索字串長度
// - renderGuide：O(a + c + e)
// 空間複雜度：O(a + c + e)
//
// 更快替代方案比較：
// - 暴力法：要求使用者自行閱讀牌面、表格與空間特徵後再整合。
// - 本實作：只掃描一次現有結果，建立前三區域與具體搜尋動作，技術資料收合備查。
// ==============================

(function initLostItemUxModule() {
  "use strict";

  const GUIDE_ID = "lost-item-action-guide";
  const DETAILS_ID = "lost-item-technical-details";
  const STYLE_ID = "lost-item-ux-style";
  let initialized = false;
  let lastSignature = "";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    return [...new Set(values.map(clean).filter(Boolean))];
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .lost-ux-guide {
        display: grid;
        gap: 1rem;
        padding: clamp(1rem, 3vw, 1.45rem);
        border: 1px solid rgba(255, 215, 128, 0.52);
        border-radius: 18px;
        background: linear-gradient(145deg, rgba(255, 211, 105, 0.12), rgba(112, 89, 211, 0.08));
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.16);
      }
      .lost-ux-kicker {
        margin: 0;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #ffe0a0;
      }
      .lost-ux-guide h4 {
        margin: 0.25rem 0 0;
        font-size: clamp(1.25rem, 3vw, 1.65rem);
      }
      .lost-ux-intro,
      .lost-ux-rule {
        margin: 0;
        line-height: 1.7;
      }
      .lost-ux-steps {
        display: grid;
        gap: 0.8rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .lost-ux-step {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.75rem;
        padding: 0.95rem;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        background: rgba(5, 5, 24, 0.34);
      }
      .lost-ux-step-number {
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        font-weight: 900;
        background: rgba(255, 211, 105, 0.16);
        border: 1px solid rgba(255, 211, 105, 0.45);
      }
      .lost-ux-step h5 {
        margin: 0;
        font-size: 1.06rem;
      }
      .lost-ux-step p {
        margin: 0.35rem 0 0;
        line-height: 1.62;
      }
      .lost-ux-subarea {
        opacity: 0.78;
        font-size: 0.92rem;
      }
      .lost-ux-clue-box {
        padding: 0.95rem 1rem;
        border-radius: 14px;
        background: rgba(90, 166, 255, 0.09);
        border: 1px solid rgba(143, 206, 255, 0.3);
      }
      .lost-ux-clue-box strong {
        display: block;
        margin-bottom: 0.55rem;
      }
      .lost-ux-clue-box ul {
        display: grid;
        gap: 0.45rem;
        margin: 0;
        padding-left: 1.2rem;
      }
      .lost-ux-clue-box li {
        line-height: 1.55;
      }
      .lost-ux-other {
        margin: 0;
        opacity: 0.72;
        font-size: 0.9rem;
      }
      .lost-ux-details {
        border: 1px solid rgba(175, 166, 255, 0.2);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.025);
        overflow: hidden;
      }
      .lost-ux-details > summary {
        cursor: pointer;
        padding: 1rem 1.1rem;
        font-weight: 800;
        list-style-position: inside;
        background: rgba(87, 72, 160, 0.12);
      }
      .lost-ux-details-content {
        display: grid;
        gap: 1.1rem;
        padding: 1rem;
      }
      .lost-ux-details-content > h4 {
        margin: 0.35rem 0 0;
      }
      @media (max-width: 680px) {
        .lost-ux-step {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /** 時間複雜度 O(a)，a <= 5；空間複雜度 O(a)。 */
  function readRankingRows() {
    return Array.from(document.querySelectorAll("#lost-item-ranking-body tr"))
      .map((row) => {
        const cells = Array.from(row.children).map((cell) => clean(cell.textContent));
        return {
          rank: cells[0],
          area: cells[1],
          confidence: cells[3],
          evidence: cells[4],
          subAreas: cells[5],
          firstAction: cells[6],
        };
      })
      .filter((item) => item.area && item.area !== "—");
  }

  function readDefinitionList(card) {
    const values = [];
    const terms = Array.from(card.querySelectorAll("dt"));
    terms.forEach((term) => {
      const detail = term.nextElementSibling;
      const value = clean(detail?.textContent);
      if (value && value !== "—") values.push(`${clean(term.textContent)}：${value}`);
    });
    return values;
  }

  /** 時間複雜度 O(c + e)，空間複雜度 O(c + e)。 */
  function collectRawClues() {
    const spatial = Array.from(document.querySelectorAll("#lost-item-spatial-cards .lost-v50-spatial-card"))
      .flatMap(readDefinitionList);

    const cardHints = Array.from(document.querySelectorAll("#lost-item-cards .lost-v47-card p"))
      .filter((element) => !element.classList.contains("lost-v50-muted"))
      .map((element) => clean(element.textContent));

    const events = Array.from(document.querySelectorAll("#lost-item-events .lost-v47-event"))
      .flatMap((event) => Array.from(event.querySelectorAll("h5, p")).map((element) => clean(element.textContent)));

    return unique([...spatial, ...cardHints, ...events]);
  }

  /**
   * 將技術線索轉成使用者可執行的動作。
   * 時間複雜度 O(r × k)，r 為固定規則數；空間複雜度 O(r)。
   */
  function buildActionClues(rawClues) {
    const source = rawClues.join("｜");
    const rules = [
      [/低處|地面|下方|底部|腳邊|靠下/, "蹲下查看地面、牆腳、家具底部與物品下方。"],
      [/高處|上方|頂部|架上|靠上/, "抬頭查看櫃頂、層架上方與較高的平台。"],
      [/容器|箱子|箱內|袋子|抽屜|收納|內部/, "打開其他箱子、袋子、抽屜與臨時收納，確認是否放錯容器。"],
      [/夾縫|縫隙|壓住|覆蓋|遮住|遮蔽|隱藏|不可見|背後/, "翻開覆蓋物，檢查家具縫隙、物品背後與被壓住的位置。"],
      [/邊界|邊緣|牆邊|角落|門邊|門後|入口|出口|外圍/, "沿牆邊、門後、房間角落與家具外緣完整掃一圈。"],
      [/移動|滑動|滾動|掉落|掃到|掃走|踢到|搬動|推動/, "沿最近的打掃與行走動線，查找可能被掃走、踢開或移動到的位置。"],
      [/陰暗|暗處|陰影|光線不足/, "開燈或用手機手電筒照家具底下、陰影與深處。"],
      [/表面|顯眼|可見|明亮/, "先清空桌面、平台與顯眼表面，確認是否被其他物品壓住。"],
      [/舊物|過去|兒童|玩具|家人|他人|共用/, "檢查舊物、其他玩具箱及家人共用的收納位置。"],
      [/水邊|潮濕|浴室|洗手台|廚房/, "查看洗手台、浴室、廚房及潮濕區域周邊。"],
    ];

    const actions = rules
      .filter(([pattern]) => pattern.test(source))
      .map(([, action]) => action);

    return unique(actions).slice(0, 5);
  }

  function createText(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function createSearchStep(item, index) {
    const step = document.createElement("li");
    step.className = "lost-ux-step";

    const number = createText("span", "lost-ux-step-number", String(index + 1));
    const body = document.createElement("div");
    const title = createText("h5", "", item.area);
    const subarea = createText(
      "p",
      "lost-ux-subarea",
      item.subAreas && item.subAreas !== "—" ? `區域內先看：${item.subAreas}` : "先完整巡查這個大型區域。"
    );
    const action = createText(
      "p",
      "",
      item.firstAction && item.firstAction !== "—" ? item.firstAction : "由入口開始，沿邊緣到中央完整搜尋一次。"
    );

    body.append(title, subarea, action);
    step.append(number, body);
    return step;
  }

  function prepareTechnicalDetails() {
    const result = document.getElementById("lost-item-result");
    if (!result || document.getElementById(DETAILS_ID)) return;

    const cards = document.getElementById("lost-item-cards");
    const rankingWrap = result.querySelector(".lost-v47-table-wrap");
    const spatialNote = result.querySelector(".lost-v50-layer-note:not(#lost-item-area-notice)");
    const spatialCards = document.getElementById("lost-item-spatial-cards");
    const events = document.getElementById("lost-item-events-section");
    const feedback = result.querySelector(".tool-feedback");

    const headings = Array.from(result.querySelectorAll(":scope > h4"));
    const cardHeading = headings.find((heading) => heading.nextElementSibling === cards);
    const rankingHeading = headings.find((heading) => heading.nextElementSibling === rankingWrap);
    const spatialHeading = headings.find((heading) => heading.textContent.includes("空間特徵"));

    const details = document.createElement("details");
    details.id = DETAILS_ID;
    details.className = "lost-ux-details";
    const summary = createText("summary", "", "查看抽到的牌、Top 5 分數與完整判讀依據");
    const content = document.createElement("div");
    content.className = "lost-ux-details-content";

    [cardHeading, cards, rankingHeading, rankingWrap, spatialHeading, spatialNote, spatialCards, events]
      .filter(Boolean)
      .forEach((node) => content.appendChild(node));

    details.append(summary, content);
    result.insertBefore(details, feedback || null);
  }

  /** 時間複雜度 O(a + c + e)，空間複雜度 O(a + c + e)。 */
  function renderGuide() {
    const result = document.getElementById("lost-item-result");
    if (!result || result.classList.contains("hidden")) return;

    const rankings = readRankingRows();
    if (rankings.length === 0) return;

    const rawClues = collectRawClues();
    const actions = buildActionClues(rawClues);
    const signature = JSON.stringify({ rankings, rawClues, actions });
    if (signature === lastSignature) return;
    lastSignature = signature;

    let guide = document.getElementById(GUIDE_ID);
    if (!guide) {
      guide = document.createElement("section");
      guide.id = GUIDE_ID;
      guide.className = "lost-ux-guide";
      const technicalDetails = document.getElementById(DETAILS_ID);
      result.insertBefore(guide, technicalDetails || result.querySelector(".tool-feedback") || null);
    }

    const kicker = createText("p", "lost-ux-kicker", "現在就這樣找");
    const heading = createText("h4", "", `先找「${rankings[0].area}」`);
    const intro = createText(
      "p",
      "lost-ux-intro",
      "不要先研究牌義。依照下面順序行動；每個大型區域都先做指定動作，再換下一區。"
    );

    const steps = document.createElement("ol");
    steps.className = "lost-ux-steps";
    rankings.slice(0, 3).forEach((item, index) => steps.appendChild(createSearchStep(item, index)));

    const clueBox = document.createElement("div");
    clueBox.className = "lost-ux-clue-box";
    clueBox.appendChild(createText("strong", "", "進入上述區域後，優先做這些檢查"));
    const clueList = document.createElement("ul");
    const visibleActions = actions.length > 0
      ? actions
      : ["由區域入口開始，沿牆邊、家具外緣與常用收納逐一排除。"];
    visibleActions.forEach((action) => clueList.appendChild(createText("li", "", action)));
    clueBox.appendChild(clueList);

    const remaining = rankings.slice(3).map((item) => item.area).filter(Boolean);
    const other = createText(
      "p",
      "lost-ux-other",
      remaining.length > 0 ? `前三區都沒有，再補查：${remaining.join("、")}。` : ""
    );
    const rule = createText(
      "p",
      "lost-ux-rule",
      "大型區域決定要去哪裡找；邊緣、低處、箱內等特徵只用來縮小該區域，不代表另一個新地點。"
    );

    guide.replaceChildren(kicker, heading, intro, steps, clueBox, other, rule);
  }

  function init() {
    if (initialized || !document.getElementById("lost-item-tool")) return;
    initialized = true;
    injectStyles();
    prepareTechnicalDetails();

    const result = document.getElementById("lost-item-result");
    if (!result) return;

    const observer = new MutationObserver(() => window.requestAnimationFrame(renderGuide));
    observer.observe(result, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    renderGuide();
  }

  window.EvanLostItemUx = Object.freeze({ init, render: renderGuide });
})();