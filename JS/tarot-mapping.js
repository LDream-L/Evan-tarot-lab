// ==============================
// tarot-mapping.js（純前端靜態版）
// 失物占卜：內建 Mapping，不再連 Google Sheet
// ==============================
//
// 設計說明：
// - 原本版本：第一次使用時，會透過 CORS Proxy 讀取 Google Sheet（GViz JSON）。
//   → 受限於第三方 Proxy 不穩定，容易出現 Failed to fetch。
// - 現在版本：直接把整份 Mapping 寫死在前端 JS，部署在 GitHub Pages 就能穩定使用。
//   → 無外部依賴，載入速度穩定、失敗率更低。
//
// 時間複雜度：
// - 初始化：O(n) 一次性建立 mappingEngine（n = 牌數）
// - 抽牌：O(1)（固定抽 3 張）
//
// 空間複雜度：O(n) 儲存全部牌的 Mapping。
//
// 暴力法 vs 優化法：
// - 暴力法：每次占卜都重新打 API 抓 Google Sheet → 網路延遲 + 失敗風險高。
// - 本實作：把資料直接放在 JS 陣列中，只在載入腳本時建立一次 → 之後所有占卜都在本機 O(1) 抽牌。
// ==============================

// ==============================
// 1. 內建 Mapping 資料
// ==============================
//
// 欄位對照：
//   code         = CardCode
//   name         = CardName
//   statusHint   = StatusHint
//   locationHint = LocationHint
//   areaHint     = AreaHint
//   actionHint   = ActionHint
//
// 若未來想調整內容，只要修改這個陣列即可。

const TAROT_MAPPING_DATA = [
  {
    code: "MA00",
    name: "The Fool",
    statusHint: "可能在移動路徑上遺落或暫放",
    locationHint: "玄關、門口、樓梯口、外出包旁",
    areaHint: "移動路線 / 半戶外",
    actionHint: "沿著你最後走過的路線再走一次，檢查所有隨手可放置的平台"
  },
  {
    code: "MA01",
    name: "The Magician",
    statusHint: "還在你掌控範圍，被遮住",
    locationHint: "書桌、電腦旁、充電線、文具堆",
    areaHint: "室內 / 工作區",
    actionHint: "整理桌面，一層一層移開所有物品，檢查螢幕後與鍵盤下"
  },
  {
    code: "MA02",
    name: "The High Priestess",
    statusHint: "藏在深層或夾層",
    locationHint: "包包內袋、抽屜深層、小盒子、書堆間",
    areaHint: "室內 / 私人物品區",
    actionHint: "清空包包與抽屜，把內容物完全倒出後重新整理"
  },
  {
    code: "MA03",
    name: "The Empress",
    statusHint: "靠近柔軟與生活區物品",
    locationHint: "床上、棉被間、枕頭邊、沙發縫、衣服堆",
    areaHint: "臥室 / 客廳",
    actionHint: "翻開所有軟物，檢查靠墊下、棉被中、衣物堆中間"
  },
  {
    code: "MA04",
    name: "The Emperor",
    statusHint: "在固定、安全、正式的位置",
    locationHint: "文件櫃、公事包、分類抽屜、工作檯",
    areaHint: "辦公區 / 書房",
    actionHint: "檢查你平常固定收納的重要位置，一格一格翻找"
  },
  {
    code: "MA05",
    name: "The Hierophant",
    statusHint: "靠近書籍或文件",
    locationHint: "書架、講義堆、資料夾、宗教物附近",
    areaHint: "室內 / 書房",
    actionHint: "翻開書堆與資料夾，每一本之間都檢查"
  },
  {
    code: "MA06",
    name: "The Lovers",
    statusHint: "在共用空間或他人附近",
    locationHint: "客廳、餐桌、朋友車上、家人房間",
    areaHint: "共用區 / 他人空間",
    actionHint: "詢問最近有接觸的對象，並檢查客廳桌面與附近地板"
  },
  {
    code: "MA07",
    name: "The Chariot",
    statusHint: "在交通工具或外出裝備裡",
    locationHint: "汽車、機車置物箱、背包主袋、外套口袋",
    areaHint: "交通工具 / 外出裝備",
    actionHint: "檢查所有交通工具與出門用的大包與外套口袋"
  },
  {
    code: "MA08",
    name: "Strength",
    statusHint: "靠近運動、寵物、堅固家具",
    locationHint: "啞鈴邊、瑜伽墊、寵物窩、厚家具旁",
    areaHint: "運動區 / 客廳",
    actionHint: "檢查運動區與大型家具旁邊的角落"
  },
  {
    code: "MA09",
    name: "The Hermit",
    statusHint: "在隱密、不常用、高處",
    locationHint: "頂層櫃子、儲藏室、高書架、角落桌",
    areaHint: "隱蔽角落 / 高處",
    actionHint: "用椅子站高檢查頂層，翻開久未整理的盒子"
  },
  {
    code: "MA10",
    name: "Wheel of Fortune",
    statusHint: "位置多次被移動，可能在意外地方",
    locationHint: "洗衣籃、其他外套口袋、被搬動的箱子上、不同房間",
    areaHint: "室內多處 / 混亂區",
    actionHint: "沿著你最近整理或搬動物品的動線檢查"
  },
  {
    code: "MA11",
    name: "Justice",
    statusHint: "靠近證件、錢包、紙本資料",
    locationHint: "錢包附近、文件袋、公文夾、印章區",
    areaHint: "室內 / 辦公區",
    actionHint: "檢查帳單、文件與你放證件的抽屜"
  },
  {
    code: "MA12",
    name: "The Hanged Man",
    statusHint: "懸掛、夾住、壓在下面",
    locationHint: "椅背、門後掛鉤、晾衣架、桌邊、物品下方",
    areaHint: "室內 / 掛物區",
    actionHint: "檢查所有掛鉤、椅背、門後，並翻起壓住物品的底層"
  },
  {
    code: "MA13",
    name: "Death",
    statusHint: "被歸類成垃圾或舊物",
    locationHint: "垃圾袋、回收箱、舊衣袋、紙箱堆",
    areaHint: "丟棄區 / 儲藏區",
    actionHint: "檢查最近要丟的東西與舊衣紙箱"
  },
  {
    code: "MA14",
    name: "Temperance",
    statusHint: "靠近水源、混合物、液體",
    locationHint: "流理台、水槽、飲水機、浴室台面",
    areaHint: "廚房 / 浴室",
    actionHint: "查看你倒水、沖洗或調飲品的地方"
  },
  {
    code: "MA15",
    name: "The Devil",
    statusHint: "被卡在雜亂、線材、電器縫隙",
    locationHint: "電視櫃後、線材堆、電腦主機旁、遊戲機附近",
    areaHint: "雜物區 / 電器區",
    actionHint: "整理線材、搬開雜物，檢查後面與下面狹縫"
  },
  {
    code: "MA16",
    name: "The Tower",
    statusHint: "掉到難以看見的縫隙或家具後",
    locationHint: "床後、櫃後、沙發底、桌下角落",
    areaHint: "家具縫隙 / 地面",
    actionHint: "用手電筒照床底與櫃後"
  },
  {
    code: "MA17",
    name: "The Star",
    statusHint: "靠近光亮、美容、香氛",
    locationHint: "化妝台、檯燈、窗邊、香氛蠟燭處",
    areaHint: "臥室 / 浴室 / 窗邊",
    actionHint: "檢查保養品托盤、鏡子周圍與小盒子"
  },
  {
    code: "MA18",
    name: "The Moon",
    statusHint: "暗處、混亂、你記錯的位置",
    locationHint: "床底、衣櫃深處、黑包包、陰暗走廊",
    areaHint: "室內 / 暗角",
    actionHint: "用手電筒掃所有暗角與黑色袋子"
  },
  {
    code: "MA19",
    name: "The Sun",
    statusHint: "非常顯眼但被忽略",
    locationHint: "桌面中央、餐桌、茶几、陽光照到的地方",
    areaHint: "開放區域 / 主要房間",
    actionHint: "站在房間中央掃視所有平面"
  },
  {
    code: "MA20",
    name: "Judgement",
    statusHint: "在你已經找過但漏掉的地方",
    locationHint: "包包夾層、抽屜角落、桌面下層、小袋子",
    areaHint: "室內 / 重複區",
    actionHint: "回頭再檢查你找過的地方，這次更徹底一層一層翻"
  },
  {
    code: "MA21",
    name: "The World",
    statusHint: "在跨場景、多功能收納中",
    locationHint: "行李箱、旅行包、多用途收納盒",
    areaHint: "室內 / 玄關 / 旅行區",
    actionHint: "檢查你最近出門或旅行時的包袋，尤其是未整理完的"
  },
  {
    code: "W01",
    name: "Ace of Wands",
    statusHint: "剛使用後隨手一放",
    locationHint: "剛站過、坐過的地方、門邊平台",
    areaHint: "室內 / 活動區",
    actionHint: "回到你最後操作或站立的位置，檢查附近平面"
  },
  {
    code: "W02",
    name: "Two of Wands",
    statusHint: "在你規劃事情的地方",
    locationHint: "筆記本旁、電腦桌、窗邊工作點",
    areaHint: "室內 / 書桌",
    actionHint: "到你會坐著規劃事情的地方翻找筆記與紙張"
  },
  {
    code: "W03",
    name: "Three of Wands",
    statusHint: "靠近窗口或遠眺區域",
    locationHint: "陽台、窗邊架子、欄杆上",
    areaHint: "半戶外 / 窗邊",
    actionHint: "檢查曬衣區、窗口台、陽台桌面"
  },
  {
    code: "W04",
    name: "Four of Wands",
    statusHint: "在放鬆或聚會的位置",
    locationHint: "客廳茶几、餐桌、沙發座位區",
    areaHint: "客廳 / 餐廳",
    actionHint: "翻找沙發縫、桌面下、靠枕下"
  },
  {
    code: "W05",
    name: "Five of Wands",
    statusHint: "在雜亂或多人動過的空間",
    locationHint: "雜物堆、遊戲區、共用櫃",
    areaHint: "混亂區 / 共用區",
    actionHint: "整理散亂物品，逐一移開小物檢查底層"
  },
  {
    code: "W06",
    name: "Six of Wands",
    statusHint: "在高處或展示位置",
    locationHint: "層架中上層、展示櫃、牆面板",
    areaHint: "室內 / 高處",
    actionHint: "抬頭檢查牆面、櫃頂、層板"
  },
  {
    code: "W07",
    name: "Seven of Wands",
    statusHint: "在難以取得或邊緣處",
    locationHint: "櫃頂邊緣、箱子上方、門框附近",
    areaHint: "室內 / 高邊緣",
    actionHint: "使用椅子查看高邊緣、牆邊堆物後面"
  },
  {
    code: "W08",
    name: "Eight of Wands",
    statusHint: "快速移動中遺落",
    locationHint: "走廊、樓梯平台、門邊、快遞箱上",
    areaHint: "移動路線",
    actionHint: "沿著你急著走的動線檢查所有可暫放平面"
  },
  {
    code: "W09",
    name: "Nine of Wands",
    statusHint: "堆疊後面的角落",
    locationHint: "箱子後、門後、牆邊堆物區",
    areaHint: "儲藏區 / 角落",
    actionHint: "拉開靠牆物品，檢查背後與底層"
  },
  {
    code: "W10",
    name: "Ten of Wands",
    statusHint: "壓在大量物品底部",
    locationHint: "衣物山、書堆底、購物袋底部",
    areaHint: "堆疊區",
    actionHint: "移開整堆物品，從最底部開始找"
  },
  {
    code: "W11",
    name: "Page of Wands",
    statusHint: "靠近新嘗試或新物品",
    locationHint: "新買的東西旁、旅遊指南區、小背包",
    areaHint: "興趣區 / 外出包",
    actionHint: "找最近剛開始的新活動或興趣相關物品旁"
  },
  {
    code: "W12",
    name: "Knight of Wands",
    statusHint: "戶外／交通工具中",
    locationHint: "機車、腳踏車、小背包主袋",
    areaHint: "交通 / 戶外",
    actionHint: "檢查運動或快速移動時使用的所有包袋"
  },
  {
    code: "W13",
    name: "Queen of Wands",
    statusHint: "社交／溫暖核心區域",
    locationHint: "客廳沙發、茶几、電視附近",
    areaHint: "客廳",
    actionHint: "翻靠枕、沙發縫與茶几下方"
  },
  {
    code: "W14",
    name: "King of Wands",
    statusHint: "你主控的位置附近",
    locationHint: "主工作桌、大椅子周邊、小主管桌",
    areaHint: "書房 / 辦公區",
    actionHint: "檢查你最常指揮或決策的椅子與桌面"
  },
  {
    code: "C01",
    name: "Ace of Cups",
    statusHint: "靠近飲品、水源",
    locationHint: "飲水機、咖啡桌、流理台、水杯旁",
    areaHint: "廚房 / 客廳",
    actionHint: "查看你最近喝水、喝咖啡的地方"
  },
  {
    code: "C02",
    name: "Two of Cups",
    statusHint: "在與他人互動的位置",
    locationHint: "咖啡店桌、餐桌、雙人沙發",
    areaHint: "用餐區 / 社交區",
    actionHint: "返回你與某人一起坐的位置找"
  },
  {
    code: "C03",
    name: "Three of Cups",
    statusHint: "在聚會或放鬆的小空間",
    locationHint: "聚餐桌、酒杯區、客廳茶几、派對角落",
    areaHint: "客廳 / 聚會區",
    actionHint: "回到最近的聚會地點，檢查桌下與角落"
  },
  {
    code: "C04",
    name: "Four of Cups",
    statusHint: "在固定但被忽略的位置",
    locationHint: "床邊小桌、老位置、角落桌",
    areaHint: "臥室 / 個人角落",
    actionHint: "翻找你常固定放東西但不看它的地方"
  },
  {
    code: "C05",
    name: "Five of Cups",
    statusHint: "與失落或中斷行為相關的地方",
    locationHint: "你生氣離開的房間、掉落在地面邊",
    areaHint: "臥室 / 工作區",
    actionHint: "找你感到懊惱的場景，檢查附近地面"
  },
  {
    code: "C06",
    name: "Six of Cups",
    statusHint: "與舊物、回憶相關",
    locationHint: "舊箱子、紀念品盒、收藏櫃",
    areaHint: "儲藏區 / 回憶區",
    actionHint: "翻開老盒子與紀念品堆"
  },
  {
    code: "C07",
    name: "Seven of Cups",
    statusHint: "多選項、堆滿小物的地方",
    locationHint: "化妝桌、保養品區、雜物抽屜",
    areaHint: "雜物區",
    actionHint: "逐一挪開瓶罐，查看底層與後方"
  },
  {
    code: "C08",
    name: "Eight of Cups",
    statusHint: "在你「離開時遺留」的地方",
    locationHint: "你轉身離開的房間、外面店家、舊房間",
    areaHint: "過渡區 / 他人空間",
    actionHint: "回想你最後一次離開時手上拿了什麼"
  },
  {
    code: "C09",
    name: "Nine of Cups",
    statusHint: "享受、滿足、晚餐後的地方",
    locationHint: "沙發、零食桌、床邊、沙發杯架",
    areaHint: "放鬆區",
    actionHint: "翻找你吃飽耍廢時所在的位置"
  },
  {
    code: "C10",
    name: "Ten of Cups",
    statusHint: "家庭共用物品附近",
    locationHint: "客廳桌、餐廳、全家使用的空間",
    areaHint: "家庭共用區",
    actionHint: "詢問家人是否移動過，並檢查共用桌面"
  },
  {
    code: "C11",
    name: "Page of Cups",
    statusHint: "靠近創意或小驚喜物品",
    locationHint: "小禮物盒、創作角、手作材料旁",
    areaHint: "創作區",
    actionHint: "打開小收納盒與抽屜"
  },
  {
    code: "C12",
    name: "Knight of Cups",
    statusHint: "移動飲品與交通結合的地方",
    locationHint: "外帶飲料袋、車上杯架、沙發飲料架",
    areaHint: "交通 / 客廳",
    actionHint: "查看你最近帶著飲料到處走的地方"
  },
  {
    code: "C13",
    name: "Queen of Cups",
    statusHint: "情緒安撫角落、柔軟區域",
    locationHint: "床頭櫃、化妝台、香氛蠟燭旁",
    areaHint: "臥室 / 梳妝台",
    actionHint: "查看床頭與保養櫃的小盒子"
  },
  {
    code: "C14",
    name: "King of Cups",
    statusHint: "穩定、舒適主座位附近",
    locationHint: "閱讀椅、主沙發、床頭椅",
    areaHint: "主要座位區",
    actionHint: "翻找座位旁邊的小桌與靠枕下"
  },
  {
    code: "S01",
    name: "Ace of Swords",
    statusHint: "科技、金屬、思考集中區",
    locationHint: "電腦桌、鍵盤下、剪刀附近、螢幕後",
    areaHint: "桌面 / 工具區",
    actionHint: "挪動金屬物品，檢查底部與後方"
  },
  {
    code: "S02",
    name: "Two of Swords",
    statusHint: "卡在兩物之間、夾層中",
    locationHint: "書縫、盒縫、文件堆中間、兩包袋間",
    areaHint: "夾縫 / 盲區",
    actionHint: "打開你的「不想整理」的角落一片片翻"
  },
  {
    code: "S03",
    name: "Three of Swords",
    statusHint: "與負面情緒或尖銳物附近",
    locationHint: "垃圾桶旁、剪刀區、床邊（吵架後）",
    areaHint: "情緒區",
    actionHint: "找你最近心情差的位置周邊"
  },
  {
    code: "S04",
    name: "Four of Swords",
    statusHint: "休息、睡眠周邊",
    locationHint: "枕頭下、被子裡、床頭旁、床底",
    areaHint: "臥室 / 睡眠區",
    actionHint: "掀開所有寢具並檢查床底"
  },
  {
    code: "S05",
    name: "Five of Swords",
    statusHint: "他人持有或被拿走可能",
    locationHint: "他人口袋、共用桌、借出去未還的物品",
    areaHint: "他人空間 / 共用區",
    actionHint: "詢問曾借過物品的人"
  },
  {
    code: "S06",
    name: "Six of Swords",
    statusHint: "在移動路途中或交通中",
    locationHint: "捷運、公車、車上、過夜包",
    areaHint: "交通區",
    actionHint: "回想你的通勤動線，檢查包袋和座位"
  },
  {
    code: "S07",
    name: "Seven of Swords",
    statusHint: "被偷偷放、藏、塞在不明顯位置",
    locationHint: "抽屜深處、床底角落、個人暗格",
    areaHint: "隱藏點",
    actionHint: "檢查你平常藏小東西的私密位置"
  },
  {
    code: "S08",
    name: "Eight of Swords",
    statusHint: "卡在狹窄夾縫、看不見的小空間",
    locationHint: "沙發縫、包內小夾層、口袋深處",
    areaHint: "夾層 / 狹縫",
    actionHint: "用手伸進縫隙與夾層摸一遍"
  },
  {
    code: "S09",
    name: "Nine of Swords",
    statusHint: "夜間、焦慮、黑暗區域",
    locationHint: "床邊、手機充電區、深夜工作桌",
    areaHint: "臥室 / 夜間區",
    actionHint: "檢查床邊地板、充電線下方"
  },
  {
    code: "S10",
    name: "Ten of Swords",
    statusHint: "可能已丟棄或損壞",
    locationHint: "垃圾袋、回收堆、壞物品區、維修櫃",
    areaHint: "丟棄 / 回收區",
    actionHint: "查看你最近剛整理丟東西的袋子"
  },
  {
    code: "S11",
    name: "Page of Swords",
    statusHint: "靠近學習、查資料、資訊流處",
    locationHint: "書桌、平板、手機旁、筆電鍵盤附近",
    areaHint: "書桌 / 資訊區",
    actionHint: "翻動草稿紙堆與筆電下方、螢幕後"
  },
  {
    code: "S12",
    name: "Knight of Swords",
    statusHint: "匆忙時遺落，靠近出入口或交通",
    locationHint: "門口、走廊、車上座位、通勤包",
    areaHint: "交通 / 出入口",
    actionHint: "重走出門與回家的路線，檢查所有口袋"
  },
  {
    code: "S13",
    name: "Queen of Swords",
    statusHint: "辦公、裁切、分類處附近",
    locationHint: "辦公桌、剪刀區、切割墊、文件分類盤",
    areaHint: "辦公區",
    actionHint: "整理文書堆，逐一翻開紙張與文件夾"
  },
  {
    code: "S14",
    name: "King of Swords",
    statusHint: "正式工作區、權責核心位置",
    locationHint: "主辦公桌、主管椅、會議桌、文件櫃",
    areaHint: "正式辦公區",
    actionHint: "檢查你處理最重要事情的位置周邊"
  },
  {
    code: "P01",
    name: "Ace of Pentacles",
    statusHint: "靠近金錢、地面或入口處",
    locationHint: "錢包、地板、玄關、置物籃、鞋旁",
    areaHint: "玄關 / 地面",
    actionHint: "檢查地板、鞋櫃旁、小托盤"
  },
  {
    code: "P02",
    name: "Two of Pentacles",
    statusHint: "忙亂切換中放錯位置",
    locationHint: "你一邊忙一邊移動的桌面、兩工作區之間",
    areaHint: "多工區",
    actionHint: "回想你手忙腳亂的路徑，逐段檢查"
  },
  {
    code: "P03",
    name: "Three of Pentacles",
    statusHint: "工作坊、工具、修繕區",
    locationHint: "工具箱、修理桌、螺絲工具附近",
    areaHint: "工具區 / 工作室",
    actionHint: "翻找工具盒與正在施工的位置"
  },
  {
    code: "P04",
    name: "Four of Pentacles",
    statusHint: "被收得很緊、深層、安全點",
    locationHint: "保險箱、深層抽屜、私房收納盒、床底箱",
    areaHint: "安全收納區",
    actionHint: "檢查最隱蔽、最不想被人看到的地方"
  },
  {
    code: "P05",
    name: "Five of Pentacles",
    statusHint: "戶外邊界、冷處或被忽略的角落",
    locationHint: "玄關外、樓梯間、陽台地板、門後地面",
    areaHint: "半戶外 / 邊界區",
    actionHint: "查看門外或樓梯邊是否掉落"
  },
  {
    code: "P06",
    name: "Six of Pentacles",
    statusHint: "他人持有 / 借出去 / 店家",
    locationHint: "朋友車上、別人桌、櫃檯、收銀台",
    areaHint: "他人空間",
    actionHint: "詢問最近接觸過你物品的人"
  },
  {
    code: "P07",
    name: "Seven of Pentacles",
    statusHint: "長期堆放或等待中的區域",
    locationHint: "儲藏室、陽台角落、放舊箱子的區域",
    areaHint: "儲藏區 / 陽台",
    actionHint: "打開長期未整理的箱子與袋子"
  },
  {
    code: "P08",
    name: "Eight of Pentacles",
    statusHint: "工作台、反覆操作的區域",
    locationHint: "手作桌、修理台、焊接台、畫畫桌",
    areaHint: "工具台 / 工作室",
    actionHint: "逐一翻找桌面工具下、紙張下"
  },
  {
    code: "P09",
    name: "Nine of Pentacles",
    statusHint: "個人享受區、優雅角落",
    locationHint: "陽台小桌、閱讀椅、私人小角落",
    areaHint: "私人空間",
    actionHint: "檢查你獨自享受的那個角落與小桌"
  },
  {
    code: "P10",
    name: "Ten of Pentacles",
    statusHint: "家庭財務集中區",
    locationHint: "存摺櫃、重要證件抽屜、印章盒",
    areaHint: "財務區",
    actionHint: "檢查所有重要物品收納點"
  },
  {
    code: "P11",
    name: "Page of Pentacles",
    statusHint: "新技能、新投資、新工具附近",
    locationHint: "新買的工具、課程教材、投資筆記",
    areaHint: "學習 / 財務角",
    actionHint: "查看你最近開始研究的主題物品旁"
  },
  {
    code: "P12",
    name: "Knight of Pentacles",
    statusHint: "固定路線、穩定的通勤位置",
    locationHint: "上班包、公文包、通勤座位周邊",
    areaHint: "交通 / 通勤",
    actionHint: "檢查你上下班固定經過與坐著的點"
  },
  {
    code: "P13",
    name: "Queen of Pentacles",
    statusHint: "家務、生活必需品、實用物附近",
    locationHint: "廚房收納、家事間、雜物籃、小工具抽屜",
    areaHint: "家事區",
    actionHint: "查看你放橡皮筋、膠帶、電池的小抽屜"
  },
  {
    code: "P14",
    name: "King of Pentacles",
    statusHint: "資產管理、貴重物集中處",
    locationHint: "保險櫃、辦公室重要櫃、金庫、資產文件旁",
    areaHint: "資產管理區",
    actionHint: "系統性檢查存放貴重物的所有抽屜與盒子"
  }
];

// ==============================
// 2. 全域狀態（掛在 window 上）
// ==============================
//
// 初始化：O(n) 把常數陣列複製一份，避免不小心改到常數。
// 空間：O(n)

window.mappingEngine = TAROT_MAPPING_DATA.slice();
window.mappingLoaded = true;

// 讓其他模組如果有 await，也能拿到一個已完成的 Promise。
// 時間複雜度：O(1)，空間複雜度：O(1)
let mappingLoadingPromise = Promise.resolve(window.mappingEngine);

// ==============================
// 3. 載入函式（介面相容舊版）
// ==============================
//
// 介面：window.loadMappingFromSheet() → Promise<Mapping[]>
//
// 暴力法：重新實作一個假的 fetch 流程、加 setTimeout 模擬延遲再回傳。
// 本實作：資料已在前端，直接回傳已完成的 Promise。
//
// 時間複雜度：O(1)
// 空間複雜度：O(1)

window.loadMappingFromSheet = function loadMappingFromSheet() {
  return mappingLoadingPromise;
};

// ==============================
// 4. 抽出 3 張不同的牌
// ==============================
//
// 時間複雜度：O(1)（固定最多抽 3 張）
// 空間複雜度：O(1)
//
// 暴力法：每次都把整副牌打亂（Fisher–Yates shuffle O(n)），再拿前三張。
// 本實作：使用 Set 直接隨機挑出 3 個 index，因為張數是常數 → 抽牌成本固定。

window.drawThreeFromEngine = function drawThreeFromEngine() {
  const n = window.mappingEngine.length;
  if (n === 0) {
    throw new Error("MappingEngine 尚未載入或沒有資料。");
  }

  const indices = new Set();
  // 最多抽到 3 張，或是牌數不足時抽到 n 張
  while (indices.size < 3 && indices.size < n) {
    const idx = Math.floor(Math.random() * n);
    indices.add(idx);
  }

  return Array.from(indices).map((i) => window.mappingEngine[i]);
};
