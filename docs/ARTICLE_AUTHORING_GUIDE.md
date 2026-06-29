# Evan Tarot 文章排版說明

網站文章資料由 Google Sheets 與 Apps Script 提供；GitHub 負責文章渲染與共用圖片索引。

支援二級與三級標題、粗體、清單、引言、表格、分隔線、自動目錄、共用圖片、流程卡、提醒框與可收合內容。

共用圖片標記範例：

    [[image:case-shadow-dialogue|cover]]
    [[image:case-conflict-shadow|portrait]]
    [[image:case-dark-distance|wide]]

其他特殊標記：

    [[flow:第一步 > 第二步 > 第三步]]
    [[note:閱讀提醒|這裡放提醒內容。]]
    [[details:可收合區塊標題]]
    內容
    [[/details]]

圖片版型：cover 是文章首圖；wide 是橫幅圖；portrait 是直式置中圖；inline 是較窄的內文圖。

圖片網址、替代文字、圖說與作者署名統一放在 JS/article-media-library.js。文章只需保存圖片代碼，同一張圖可以被多篇文章共用。

文章標題、日期、作者與摘要維持原本 Google Sheets 欄位。content 欄位可直接貼多行標記，不需要撰寫 HTML。至少三個二級標題時，頁面會自動建立本文導覽。
