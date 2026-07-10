// ==============================
// timeflow-astrology-energy.js
// 占星背景：行星 × 星座 × 運行／相位的能量解讀
// ==============================
// 主要函式：
// - findEventForModal：時間 O(E)，空間 O(1)。
// - buildEnergyReading：時間 O(P)，空間 O(P)，P 為事件涉及行星數，通常 <= 2。
// - enhanceModal：時間 O(E + P)，空間 O(P)。
//
// 更快替代方案比較：
// - 每筆年度資料直接存完整文案：讀取 O(1)，但 583 筆以上內容重複、難以統一修正。
// - 本版以行星、星座、運行類型、相位查表組合；新增年度資料不需逐筆補文案。
// - 若未來事件量達數萬筆，可在年度資料載入後建立 title+date Map，將找尋由 O(E) 降低為 O(1)。
// ==============================
(function initTimeflowAstrologyEnergy() {
  "use strict";

  const STYLE_ID = "timeflow-astrology-energy-style";
  const ENHANCED_ATTR = "data-astro-energy-enhanced";
  const WAIT_MS = 80;

  const PLANETS = Object.freeze({
    Sun: {
      name: "太陽",
      domain: "自我認同、意志、目標、能見度與權威感",
      life: "個人定位、領導方式、創作表現與人生方向",
      shadow: "過度自我中心、逞強，或把價值綁在外界認可上",
      use: "重新確認真正想主導的方向，讓行動與核心價值一致",
    },
    Moon: {
      name: "月亮",
      domain: "情緒、安全感、習慣、家庭與內在需求",
      life: "情緒反應、居住感受、照顧關係與日常節奏",
      shadow: "情緒化、防衛、依賴舊習慣，或因不安而反覆",
      use: "先辨識身體與情緒需求，再決定是否需要立即行動",
    },
    Mercury: {
      name: "水星",
      domain: "思考、溝通、資訊、學習、交通、契約與設備",
      life: "訊息往來、文件、談判、行程、學習與工作流程",
      shadow: "誤解、資訊過載、反覆修改，或太快做出結論",
      use: "重新檢查資料、定義與溝通流程，重要事項留下書面紀錄",
    },
    Venus: {
      name: "金星",
      domain: "關係、吸引力、價值感、金錢、享受與審美",
      life: "情感互動、合作條件、消費選擇、自我價值與品味",
      shadow: "討好、逃避衝突、過度消費，或把感情當成價值證明",
      use: "重新衡量關係與資源交換是否對等，辨認自己真正重視什麼",
    },
    Mars: {
      name: "火星",
      domain: "行動、慾望、競爭、界線、衝突與身體動能",
      life: "執行力、性與欲望、競爭、憤怒處理及體力配置",
      shadow: "衝動、攻擊、急於證明，或把壓力轉成身體緊繃",
      use: "把力量導向可完成的具體行動，先設定界線再處理衝突",
    },
    Jupiter: {
      name: "木星",
      domain: "擴張、信念、機會、教育、法律、旅行與視野",
      life: "長期規劃、學習進修、跨域發展、海外與價值信念",
      shadow: "過度樂觀、承諾過多、放大風險，或用大道理掩蓋細節",
      use: "擴大選項前先確認承受能力，讓成長建立在可持續的基礎上",
    },
    Saturn: {
      name: "土星",
      domain: "責任、限制、結構、紀律、時間與長期成果",
      life: "工作責任、制度、承諾、邊界、延遲與成熟課題",
      shadow: "僵化、恐懼失敗、過度壓抑，或只看限制而看不到方法",
      use: "拆解責任與期限，建立能長期執行的規則而非只靠意志力",
    },
    Uranus: {
      name: "天王星",
      domain: "改變、自由、創新、突發事件、科技與集體改革",
      life: "制度更新、科技工具、群體關係、自由需求與生活模式",
      shadow: "為反對而反對、突然切斷，或在追求自由時忽略後果",
      use: "保留試驗空間，以小規模測試取代一次性全面翻盤",
    },
    Neptune: {
      name: "海王星",
      domain: "理想、想像、直覺、慈悲、界線模糊與逃避",
      life: "創作、靈性、情感投射、睡眠、成癮與理想化關係",
      shadow: "自我欺騙、界線不清、過度犧牲，或把期待誤認為事實",
      use: "保留感受與想像，同時用具體證據、期限與界線做現實校正",
    },
    Pluto: {
      name: "冥王星",
      domain: "權力、控制、深層恐懼、淘汰、重生與集體結構",
      life: "權力關係、秘密、資源控制、制度轉型與難以迴避的核心議題",
      shadow: "控制、極端化、執著、權力鬥爭，或因害怕失去而不肯鬆手",
      use: "辨認真正需要結束或重組的部分，停止用表面修補掩蓋根本問題",
    },
  });

  const SIGNS = Object.freeze({
    "牡羊座": { style: "直接、快速、主動開創", area: "自我主張、起步、競爭與立即反應", shadow: "急躁、先做後想、只顧自己的節奏" },
    "白羊座": { style: "直接、快速、主動開創", area: "自我主張、起步、競爭與立即反應", shadow: "急躁、先做後想、只顧自己的節奏" },
    "金牛座": { style: "穩定、務實、緩慢累積", area: "金錢、物質、安全感、身體與既有價值", shadow: "固執、抗拒改變、因害怕失去而拖延" },
    "雙子座": { style: "靈活、好奇、多線並行", area: "資訊、溝通、學習、移動與人際網絡", shadow: "分心、資訊碎片化、說得多但缺乏整合" },
    "巨蟹座": { style: "敏感、保護、依循情緒與記憶", area: "家庭、歸屬、安全感、照顧與過去經驗", shadow: "過度防衛、情緒勒索、退回熟悉模式" },
    "獅子座": { style: "自信、創造、需要被看見", area: "自我表達、創作、戀愛、舞台與尊嚴", shadow: "自尊過高、戲劇化、過度依賴掌聲" },
    "處女座": { style: "分析、分類、修正與追求有效", area: "工作流程、健康、細節、技能與服務", shadow: "過度挑剔、焦慮、把改善變成否定自己" },
    "天秤座": { style: "協調、比較、重視公平與關係", area: "伴侶、合作、談判、界線與公共形象", shadow: "猶豫、討好、為維持和平而壓下真實需求" },
    "天蠍座": { style: "深入、集中、追求真相與完全投入", area: "親密、權力、秘密、共享資源與信任", shadow: "猜疑、控制、情緒極端、難以放手" },
    "射手座": { style: "擴張、探索、追求意義與自由", area: "信念、遠行、教育、出版、法律與人生觀", shadow: "過度樂觀、說教、忽略現實細節" },
    "摩羯座": { style: "務實、克制、以成果與責任為導向", area: "事業、制度、階級、長期目標與責任", shadow: "冷硬、過度工作、只看成果而忽略感受" },
    "水瓶座": { style: "理性、抽離、創新與集體導向", area: "社群、科技、制度改革、群體與未來模式", shadow: "情感疏離、理想化群體、為創新而否定人性需求" },
    "雙魚座": { style: "感受、想像、融合與放下界線", area: "直覺、療癒、藝術、信仰、夢境與集體情緒", shadow: "逃避、混亂、過度投射、界線消失" },
  });

  const ASPECTS = Object.freeze({
    conjunction: { name: "合相", dynamic: "兩股能量融合並被放大，容易開啟新週期", risk: "能量過度集中，較難保持客觀距離", action: "確認兩種需求如何共存，避免只讓其中一方完全吞沒另一方" },
    sextile: { name: "六分相", dynamic: "出現可利用的合作機會，但需要主動採取行動", risk: "因為阻力不大而沒有真正把機會落地", action: "選擇一個具體切入點，將資源轉成實際成果" },
    square: { name: "四分相", dynamic: "摩擦與壓力迫使原有模式調整", risk: "急著排除不舒服，反而讓衝突變成互相消耗", action: "找出兩股需求真正卡住的地方，以新規則取代硬撐" },
    trine: { name: "三分相", dynamic: "能量流動較自然，能力與資源容易被調動", risk: "太順而缺乏警覺，可能把優勢當成理所當然", action: "主動使用既有優勢，不要只等待事情自然發生" },
    opposition: { name: "對分相", dynamic: "兩端需求互相拉扯，常透過關係或外部事件被看見", risk: "把自己不願承認的部分投射到別人身上", action: "承認兩端都真實存在，尋找可輪替或分工的平衡方式" },
    quincunx: { name: "梅花相", dynamic: "兩股能量缺乏共同語言，需要持續微調", risk: "不斷補救症狀，卻沒有改變不相容的結構", action: "重新設計流程與期待，不要求兩邊用同一種方式運作" },
  });

  const MOTIONS = Object.freeze({
    retrograde: {
      lead: "能量由外在推進轉向內部回收、檢查與重整",
      timing: "事情較容易延遲、反覆、回頭處理，舊議題或未完成事項可能重新出現",
      action: "適合複盤、修正、重新談條件與清理舊問題，不宜只因焦躁而強行加速",
    },
    stationRetrograde: {
      lead: "行星準備轉為逆行，相關議題會進入明顯的減速與轉向點",
      timing: "事件感受可能比一般逆行期間更集中，原本順推的事情開始暴露需要重做之處",
      action: "先暫停擴張，記錄異常與反覆點，等方向釐清後再決定是否推進",
    },
    stationDirect: {
      lead: "行星由內部整理逐步恢復外在推進，但不等於立刻完全順暢",
      timing: "卡住的事情開始有答案，仍可能需要一段時間處理逆行期間留下的修正",
      action: "先驗證新方向是否可行，再分階段恢復速度，避免一次補回所有進度",
    },
    ingress: {
      lead: "行星議題切換到新的表達環境，集體注意力與處理方式開始轉調",
      timing: "剛換座時常先出現不適應或放大反差，之後才逐漸形成穩定模式",
      action: "觀察新星座要求的能力，調整方法而不是沿用上一階段的慣性",
    },
    newMoon: {
      lead: "新月象徵週期起點，能量偏向內聚、播種與設定意圖",
      timing: "外在成果尚不明顯，重點是選擇方向並開始累積",
      action: "設定一個可追蹤的起點，避免一次許下太多互相衝突的目標",
    },
    fullMoon: {
      lead: "滿月象徵累積結果浮現、情緒與矛盾被照亮",
      timing: "事件容易到達高點、完成或必須做出取捨",
      action: "盤點成果與代價，完成該完成的部分並釋放不再適用的安排",
    },
    eclipse: {
      lead: "日月食在占星傳統中被視為放大版的新月或滿月，轉折感與後續效應較長",
      timing: "當下未必立即看清全貌，事件可能在前後數週至數月逐步展開",
      action: "保留調整空間，不以單一情緒做不可逆決定，持續觀察後續事實",
    },
    aspect: {
      lead: "兩顆行星的議題同時被啟動，結果取決於相位帶來的合作或張力",
      timing: "精確相位日前後通常較明顯，慢速行星相位的背景期會更長",
      action: "分辨兩股需求各自在保護什麼，再決定如何協調或重新配置資源",
    },
  });

  function esc(value) {
    const TF = window.EvanTimeflowV5;
    return TF?.esc ? TF.esc(value) : String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    return String(value || "").replaceAll("-", "/");
  }

  function formatExact(value) {
    if (!value) return "";
    const normalized = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return String(value).replace("T", " ");
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function eventDateText(event) {
    if (event.endDay > event.startDay) return `${formatDate(event.startDate)}～${formatDate(event.endDate)}`;
    return formatExact(event.exactTime) || formatDate(event.exactDate || event.startDate);
  }

  function allEvents() {
    const years = window.EvanTimeflowV5?.astrology?.years;
    if (!(years instanceof Map)) return [];
    const result = [];
    for (const events of years.values()) {
      if (Array.isArray(events)) result.push(...events);
    }
    return result;
  }

  /** 時間 O(E)，空間 O(1)。 */
  function findEventForModal(modal) {
    const title = modal.querySelector(".map-modal-header h3")?.textContent?.trim() || "";
    if (!title || title === "占星背景資料說明" || title.startsWith("同區共有")) return null;

    const dateCell = [...modal.querySelectorAll(".map-astro-detail-grid div")].find(
      (item) => item.querySelector("span")?.textContent?.trim() === "日期／期間"
    );
    const dateText = dateCell?.querySelector("strong")?.textContent?.trim() || "";
    let fallback = null;

    for (const event of allEvents()) {
      if (event.title !== title) continue;
      if (!fallback) fallback = event;
      if (!dateText || eventDateText(event) === dateText) return event;
    }
    return fallback;
  }

  function detectAspect(event) {
    const raw = `${event.aspect || ""} ${event.subtype || ""} ${event.title || ""}`.toLowerCase();
    if (/conjunction|合相|合$/.test(raw)) return ASPECTS.conjunction;
    if (/sextile|六分相|六合/.test(raw)) return ASPECTS.sextile;
    if (/square|四分相|刑相|刑克/.test(raw)) return ASPECTS.square;
    if (/trine|三分相|拱相|拱$/.test(raw)) return ASPECTS.trine;
    if (/opposition|對分相|沖相|對沖/.test(raw)) return ASPECTS.opposition;
    if (/quincunx|梅花相|150/.test(raw)) return ASPECTS.quincunx;
    return null;
  }

  function detectMotion(event) {
    const raw = `${event.type || ""} ${event.subtype || ""} ${event.title || ""}`;
    if (event.type === "retrograde") return { key: "retrograde", value: MOTIONS.retrograde };
    if (event.type === "ingress") return { key: "ingress", value: MOTIONS.ingress };
    if (event.type === "eclipse") return { key: "eclipse", value: MOTIONS.eclipse };
    if (event.type === "aspect") return { key: "aspect", value: MOTIONS.aspect };
    if (event.type === "moon_phase") {
      if (/新月/.test(raw)) return { key: "newMoon", value: MOTIONS.newMoon };
      return { key: "fullMoon", value: MOTIONS.fullMoon };
    }
    if (event.type === "station") {
      if (/順行|direct/i.test(raw)) return { key: "stationDirect", value: MOTIONS.stationDirect };
      return { key: "stationRetrograde", value: MOTIONS.stationRetrograde };
    }
    return { key: "aspect", value: MOTIONS.aspect };
  }

  function planetData(event) {
    return (event.planets || []).map((key) => PLANETS[key]).filter(Boolean);
  }

  function signData(event) {
    return (event.signs || []).map((key) => ({ name: key, ...(SIGNS[key] || {}) })).filter((item) => item.style);
  }

  function joinNatural(items) {
    const values = items.filter(Boolean);
    if (values.length <= 1) return values[0] || "";
    return `${values.slice(0, -1).join("、")}與${values.at(-1)}`;
  }

  function specificRetrogradeNote(event, primaryPlanet, primarySign) {
    if (!primaryPlanet) return "相關議題容易回到內部整理，外在推進感下降。";
    const planetName = primaryPlanet.name;
    const signArea = primarySign?.area || "目前所在星座所代表的生活領域";

    const notes = {
      水星: `溝通、合約、行程與資訊處理可能反覆；在${signArea}上，舊話題、舊資料或未釐清的定義容易再次出現。`,
      金星: `感情、合作、金錢與自我價值的推進可能延滯；在${signArea}上，舊關係、舊偏好或交換是否公平會重新被檢視。`,
      火星: `行動力不一定能直接向外發揮，容易感到卡住、煩躁或改變戰術；在${signArea}上，需要重整慾望、衝突與界線。`,
      木星: `擴張計畫、信念與長期方向進入校正期；在${signArea}上，過度承諾或被忽略的風險會被放大檢查。`,
      土星: `責任、制度與限制需要重新定義；在${signArea}上，舊結構的漏洞與尚未承擔的代價會變得明顯。`,
      天王星: `改革與自由需求轉為內部醞釀，外在變化可能先停頓再改道；在${signArea}上，需要分辨真正的創新與單純反叛。`,
      海王星: `理想、直覺與界線進入去幻化階段；在${signArea}上，模糊期待、投射與逃避較容易被看見。`,
      冥王星: `權力、控制與深層轉型轉入內部清算；在${signArea}上，表面平靜下的權力分配、恐懼與淘汰需求會重新浮現。`,
    };
    return notes[planetName] || `${planetName}所代表的${primaryPlanet.domain}進入回顧期，在${signArea}上較容易反覆與重整。`;
  }

  function specificIngressNote(primaryPlanet, primarySign) {
    if (!primaryPlanet || !primarySign) return "行星換座後，相關議題會以新的方式被表達與處理。";
    return `${primaryPlanet.name}掌管的${primaryPlanet.domain}，開始以${primarySign.style}的方式運作；焦點會移向${primarySign.area}。`;
  }

  function buildCore(event, motion, planets, signs, aspect) {
    const primaryPlanet = planets[0];
    const primarySign = signs[0];
    if (motion.key === "retrograde" || motion.key === "stationRetrograde" || motion.key === "stationDirect") {
      return `${motion.value.lead}。${specificRetrogradeNote(event, primaryPlanet, primarySign)}`;
    }
    if (motion.key === "ingress") return `${motion.value.lead}。${specificIngressNote(primaryPlanet, primarySign)}`;
    if (motion.key === "newMoon" || motion.key === "fullMoon" || motion.key === "eclipse") {
      const signText = primarySign ? `事件透過${primarySign.style}的方式，集中在${primarySign.area}` : "事件集中顯示一個週期的開始、結果或轉折";
      return `${motion.value.lead}。${signText}。`;
    }
    if (motion.key === "aspect") {
      const planetText = joinNatural(planets.map((item) => `${item.name}（${item.domain}）`));
      const aspectText = aspect ? `${aspect.name}使${aspect.dynamic}` : motion.value.lead;
      return `${planetText || "相關行星議題"}同時被啟動；${aspectText}。`;
    }
    return motion.value.lead;
  }

  function buildManifestations(event, motion, planets, signs, aspect) {
    const items = [];
    const primarySign = signs[0];
    const primaryPlanet = planets[0];

    if (primaryPlanet) items.push(`${primaryPlanet.life}成為主要觀察區。`);
    if (primarySign) items.push(`事情較常以${primarySign.style}的方式呈現，並落在${primarySign.area}。`);
    items.push(`${motion.value.timing}。`);
    if (aspect) items.push(`${aspect.dynamic}；現實中可能透過事件、關係或決策壓力被感受到。`);

    return [...new Set(items)].slice(0, 4);
  }

  function buildRisks(planets, signs, aspect) {
    const risks = [];
    planets.forEach((item) => risks.push(item.shadow));
    signs.forEach((item) => risks.push(item.shadow));
    if (aspect) risks.push(aspect.risk);
    return [...new Set(risks)].slice(0, 4);
  }

  function buildActions(motion, planets, aspect) {
    const actions = [motion.value.action];
    planets.forEach((item) => actions.push(item.use));
    if (aspect) actions.push(aspect.action);
    return [...new Set(actions)].slice(0, 4);
  }

  /** 時間 O(P)，空間 O(P)。 */
  function buildEnergyReading(event) {
    const motion = detectMotion(event);
    const planets = planetData(event);
    const signs = signData(event);
    const aspect = detectAspect(event);

    return {
      core: buildCore(event, motion, planets, signs, aspect),
      manifestations: buildManifestations(event, motion, planets, signs, aspect),
      risks: buildRisks(planets, signs, aspect),
      actions: buildActions(motion, planets, aspect),
      intensity: event.importance >= 3
        ? "集體背景強度高；若同時觸發個人本命行星、四軸或重要宮位，主觀感受通常會更明顯。"
        : event.importance === 2
          ? "屬中等背景能量，通常需要與個人本命盤或其他同期天象疊加，才會形成明顯事件感。"
          : "偏短期或輔助背景，較適合用來理解當日氣氛，不宜單獨推論重大事件。",
    };
  }

  function listHtml(items) {
    return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .map-astro-energy{margin-top:16px;padding:15px;border-radius:16px;border:1px solid rgba(183,148,255,.28);background:linear-gradient(180deg,rgba(183,148,255,.075),rgba(125,228,255,.035))}
      .map-astro-energy-header h4,.map-astro-energy-header p{margin:0}.map-astro-energy-header h4{font-size:.96rem}.map-astro-energy-header p{margin-top:5px;color:var(--text-muted);font-size:.72rem;line-height:1.5}
      .map-astro-energy-core{margin-top:12px;padding:12px 13px;border-radius:12px;border:1px solid rgba(255,211,122,.24);background:rgba(255,211,122,.055);font-size:.84rem;line-height:1.72;color:var(--text-main)}
      .map-astro-energy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:11px}.map-astro-energy-card{padding:11px 12px;border-radius:12px;border:1px solid rgba(139,123,255,.18);background:rgba(7,8,27,.66)}
      .map-astro-energy-card h5{margin:0;font-size:.79rem;color:var(--accent-strong)}.map-astro-energy-card ul{margin:7px 0 0;padding-left:1.15rem}.map-astro-energy-card li{margin-top:5px;color:var(--text-muted);font-size:.75rem;line-height:1.55}.map-astro-energy-card li:first-child{margin-top:0}
      .map-astro-energy-intensity{margin:10px 0 0;padding:9px 11px;border-left:3px solid rgba(125,228,255,.52);background:rgba(125,228,255,.04);color:var(--text-muted);font-size:.73rem;line-height:1.55}
      .map-astro-energy-disclaimer{margin:9px 0 0;color:rgba(220,220,245,.62);font-size:.68rem;line-height:1.5}
      @media(max-width:680px){.map-astro-energy-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  /** 時間 O(E+P)，空間 O(P)。 */
  function enhanceModal(modal) {
    if (!(modal instanceof HTMLElement) || modal.hasAttribute(ENHANCED_ATTR)) return;
    const event = findEventForModal(modal);
    if (!event) return;

    modal.setAttribute(ENHANCED_ATTR, "true");
    const reading = buildEnergyReading(event);
    const section = document.createElement("section");
    section.className = "map-astro-energy";
    section.innerHTML = `
      <div class="map-astro-energy-header">
        <h4>這段行星運行的能量</h4>
        <p>依行星主題、所在星座、逆順行／月相／相位動力組合解讀。</p>
      </div>
      <div class="map-astro-energy-core">${esc(reading.core)}</div>
      <div class="map-astro-energy-grid">
        <article class="map-astro-energy-card"><h5>可能出現的表現</h5>${listHtml(reading.manifestations)}</article>
        <article class="map-astro-energy-card"><h5>較容易失衡的地方</h5>${listHtml(reading.risks)}</article>
        <article class="map-astro-energy-card"><h5>適合使用的方向</h5>${listHtml(reading.actions)}</article>
        <article class="map-astro-energy-card"><h5>影響強度怎麼看</h5><p class="map-astro-energy-intensity">${esc(reading.intensity)}</p></article>
      </div>
      <p class="map-astro-energy-disclaimer">此處是占星傳統的象徵詮釋，不是經科學驗證的因果預測，也不代表每個人必然發生相同事件。個人感受仍需看本命盤受觸發的位置與現實條件。</p>
    `;

    const sourceNote = modal.querySelector(".map-astro-source-note");
    if (sourceNote) sourceNote.insertAdjacentElement("beforebegin", section);
    else modal.querySelector(".map-modal-actions")?.insertAdjacentElement("beforebegin", section);
  }

  function scan(root) {
    if (!(root instanceof Element || root instanceof Document)) return;
    if (root.matches?.(".map-modal")) enhanceModal(root);
    root.querySelectorAll?.(".map-modal").forEach(enhanceModal);
  }

  function install() {
    injectStyles();
    scan(document);

    const observer = new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.EvanTimeflowV5.astrology.energyObserver = observer;
  }

  function waitForAstrology() {
    if (!window.EvanTimeflowV5?.astrology?.installed || !document.body) {
      window.setTimeout(waitForAstrology, WAIT_MS);
      return;
    }
    if (window.EvanTimeflowV5.astrology.energyObserver) return;
    install();
  }

  waitForAstrology();
})();
