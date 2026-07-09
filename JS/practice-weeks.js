// Week-driven configuration for Evan's rolling meditation training.
window.EvanPracticeWeekConfigs = Object.freeze({
  "week-1-v8": {
    key: "week-1-v8",
    weekNumber: 1,
    version: "V8",
    label: "第1週｜V8 基礎訓練",
    title: "基礎穩定、節奏與完整回神",
    objective: "確認是否願意穩定開始、錄音節奏是否合適、身體是否安全，以及能否在練習後清楚回神。",
    audio: "V8 第一週基礎冥想",
    frequency: "每週 3–4 次；至少完成 3 次再判定下一週。",
    nextCriteria: [
      "沒有明顯頭暈、胸悶、噁心或持續性不適",
      "睜眼後能清楚辨識環境，回神時間穩定",
      "能說出哪一段太快、太慢、重複或有效",
      "願意進行下一週練習"
    ],
    fields: [
      {
        key: "breathToFeetHelpful",
        label: "把注意力帶回腳底是否有幫助",
        type: "select",
        options: ["有", "沒有", "不確定"]
      },
      {
        key: "repeatedSection",
        label: "哪一段覺得重複",
        type: "textarea",
        rows: 3,
        maxLength: 500
      },
      {
        key: "speedSection",
        label: "哪一段太快或太慢",
        type: "textarea",
        rows: 3,
        maxLength: 500
      },
      {
        key: "reorientationEffective",
        label: "左右觀看或其他回神步驟是否有效",
        type: "select",
        options: ["有效", "部分有效", "沒有", "不確定"]
      },
      {
        key: "suddenStep",
        label: "有沒有哪一步仍然太突然",
        type: "text",
        maxLength: 240,
        span: 2
      }
    ]
  },
  "week-2-v9": {
    key: "week-2-v9",
    weekNumber: 2,
    version: "V9",
    label: "第2週｜V9 節奏校準與思維辨識",
    title: "辨識思維、雙重錨點與降低飄忽",
    objective: "辨識『現在是想法』，再回到呼吸；觀察眉心時，同時保留腳底接觸感，確認能否降低飄忽。",
    audio: "V9 節奏校準與思維辨識",
    frequency: "每週 3–4 次；塔羅校準最多 1 次。",
    nextCriteria: [
      "音檔實際長度與預定節奏接近",
      "使用『想法』標記後，較能回到呼吸或腳底",
      "雙重錨點不會讓飄忽感明顯升高",
      "能分開記錄原始感受與後來解釋"
    ],
    fields: [
      {
        key: "thoughtLabelEffective",
        label: "用『想法』標記後是否比較容易回來",
        type: "select",
        options: ["是", "否", "不確定", "本次未使用"]
      },
      {
        key: "thoughtStage",
        label: "思緒最常在哪個階段出現",
        type: "select",
        options: ["腳底與身體", "呼吸", "眉心", "安靜觀察", "回神", "不確定"]
      },
      {
        key: "groundingStable",
        label: "腳底是否能成為穩定錨點",
        type: "select",
        options: ["是", "否", "不確定"]
      },
      {
        key: "dualAnchorDifficulty",
        label: "同時注意腳底與眉心的難度",
        type: "select",
        options: ["容易", "普通", "困難", "無法同時注意"]
      },
      {
        key: "groundingReducedFloating",
        label: "保留腳底注意力是否降低飄忽",
        type: "select",
        options: ["有", "沒有", "不確定", "本次沒有飄忽"]
      },
      {
        key: "browChange",
        label: "眉心感覺與第一週相比",
        type: "select",
        options: ["增強", "相近", "減弱", "無感", "無法比較"]
      },
      {
        key: "rawFeeling",
        label: "練習中最先出現的原始感受",
        type: "textarea",
        rows: 3,
        maxLength: 600,
        span: 2
      },
      {
        key: "laterInterpretation",
        label: "後來才加上的解釋或推論",
        type: "textarea",
        rows: 3,
        maxLength: 600,
        span: 2
      }
    ]
  },
  "week-3-v10": {
    key: "week-3-v10",
    weekNumber: 3,
    version: "V10",
    label: "第3週｜V10 原始感受與思緒分流",
    title: "原始感受、思緒分流與安全回神",
    objective: "練習辨認『我正在想』後回到呼吸，並把最先出現的字、畫面、情緒或身體感，和後來補上的解釋分開記錄。",
    audio: "V10 原始感受與思緒分流",
    frequency: "本週共 3 次；音檔 12 分 30 秒至 13 分 30 秒；塔羅校準最多 1 次。",
    nextCriteria: [
      "說『我正在想』後，能回到呼吸而不明顯增加思緒",
      "能分辨最先出現的原始內容與後來補上的解釋",
      "交替觀察腳底與眉心時，沒有讓飄忽或不適明顯增加",
      "完成睜眼前停十秒與睜眼後坐二十秒，並清楚回到正常狀態"
    ],
    fields: [
      {
        key: "openingGoalClear",
        label: "開頭是否清楚知道今天要練什麼",
        type: "select",
        options: ["是", "否"]
      },
      {
        key: "electronicToneImpact",
        label: "電子音是否影響進入狀態",
        type: "select",
        options: ["沒有", "輕微", "明顯"]
      },
      {
        key: "tooFastSection",
        label: "哪一段仍然太快",
        type: "textarea",
        rows: 3,
        maxLength: 500
      },
      {
        key: "tooSlowSection",
        label: "哪一段太慢",
        type: "textarea",
        rows: 3,
        maxLength: 500
      },
      {
        key: "thoughtStage",
        label: "思緒最常在哪個階段出現",
        type: "text",
        maxLength: 240,
        span: 2
      },
      {
        key: "thoughtPhraseReturn",
        label: "說『我正在想』後，是否比較容易回到呼吸",
        type: "select",
        options: ["是", "否", "不確定"]
      },
      {
        key: "thoughtPhraseAddsThoughts",
        label: "『我正在想』這句話本身會不會讓思緒更多",
        type: "select",
        options: ["會", "不會", "不確定"]
      },
      {
        key: "recurringThoughtType",
        label: "最常反覆出現的想法類型",
        type: "textarea",
        rows: 3,
        maxLength: 600,
        span: 2
      },
      {
        key: "footContactClarity",
        label: "腳底接觸感",
        type: "select",
        options: ["清楚", "普通", "不清楚"]
      },
      {
        key: "browPressure",
        label: "眉心脹感",
        type: "select",
        options: ["無", "輕微", "明顯"]
      },
      {
        key: "browThrobbing",
        label: "眉心跳動",
        type: "select",
        options: ["無", "輕微", "明顯"]
      },
      {
        key: "alternatingAnchorEasier",
        label: "交替觀察腳底與眉心是否比同時注意兩者容易",
        type: "select",
        options: ["是", "否", "不確定"]
      },
      {
        key: "firstContentType",
        label: "哪一項是最先出現的",
        type: "select",
        options: ["第一個字", "第一個畫面", "第一個情緒", "第一個身體感", "同時出現", "不確定"]
      },
      {
        key: "pauseBeforeOpenHelpful",
        label: "睜眼前停十秒是否有幫助",
        type: "select",
        options: ["是", "否", "不確定"]
      },
      {
        key: "sitAfterOpenHelpful",
        label: "睜眼後坐二十秒是否有幫助",
        type: "select",
        options: ["是", "否", "不確定"]
      },
      {
        key: "shuffleDrawTimeEnough",
        label: "洗牌與抽牌時間是否足夠（有做塔羅校準才填）",
        type: "select",
        options: ["是", "否"]
      },
      {
        key: "meditationRawContent",
        label: "冥想原始內容（有做塔羅校準才填）",
        type: "textarea",
        rows: 3,
        maxLength: 800,
        span: 2
      },
      {
        key: "cardFirstReaction",
        label: "看牌第一反應（有做塔羅校準才填）",
        type: "textarea",
        rows: 3,
        maxLength: 600,
        span: 2
      },
      {
        key: "basicCardMeaning",
        label: "基本牌義（有做塔羅校準才填）",
        type: "textarea",
        rows: 3,
        maxLength: 600,
        span: 2
      }
    ]
  }
});

window.EvanPracticeDefaultWeekKey = "week-3-v10";
