// ==============================
// Google Sheets 每日 JSON 備份
// 備份綁定試算表全部工作表至私人 Google Drive
// ==============================
//
// 主要函式複雜度：
// - setupDailyBackups：時間／空間 O(t)，t = 現有專案觸發器數
// - runDailyBackup：時間／空間 O(c + f)，c = 全工作表儲存格數，f = 備份資料夾檔案數
// - buildSpreadsheetBackup_：時間／空間 O(c)
// - cleanupOldBackups_：時間 O(f)，空間 O(1)
//
// 更快替代方案比較：
// - 設定觸發器時立刻做完整備份並顯示試算表 alert：流程會被大量資料與阻塞式對話框拖住。
// - 本實作：設定與首次備份分開；設定只建立觸發器，首次備份由 runDailyBackup 明確執行。
// - 增量備份檔案較小，但還原與一致性更複雜；目前仍採每日完整快照。
// ==============================

const BACKUP_CONFIG = Object.freeze({
  folderIdProperty: "EVAN_BACKUP_FOLDER_ID",
  spreadsheetIdProperty: "EVAN_BACKUP_SPREADSHEET_ID",
  folderName: "Evan Tarot Backups",
  retentionDays: 60,
  maxJsonLength: 20 * 1024 * 1024,
  triggerHour: 3,
});

/**
 * 建立每日備份觸發器，不立即讀取整份試算表，也不使用阻塞式 alert。
 * 時間／空間 O(t)，t = 現有專案觸發器數。
 */
function setupDailyBackups() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(BACKUP_CONFIG.spreadsheetIdProperty, spreadsheet.getId());
  const folder = getOrCreateBackupFolder_();

  const matchingTriggers = ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "runDailyBackup");
  matchingTriggers.forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  const trigger = ScriptApp.newTrigger("runDailyBackup")
    .timeBased()
    .everyDays(1)
    .atHour(BACKUP_CONFIG.triggerHour)
    .create();

  const result = {
    success: true,
    triggerCreated: true,
    replacedTriggerCount: matchingTriggers.length,
    triggerId: trigger.getUniqueId(),
    spreadsheetId: spreadsheet.getId(),
    folderId: folder.getId(),
    folderName: folder.getName(),
    schedule: `每日約 ${String(BACKUP_CONFIG.triggerHour).padStart(2, "0")}:00 執行`,
    nextStep: "請再手動執行 runDailyBackup，確認第一份備份可正常建立。",
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 一次完成觸發器設定與首份備份；資料量大時會比 setupDailyBackups 久。
 * 時間／空間 O(t + c + f)。
 */
function setupDailyBackupsAndRunNow() {
  const setup = setupDailyBackups();
  const firstBackup = runDailyBackup();
  const result = Object.assign({}, setup, { firstBackup });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 建立一份完整 JSON 快照。
 * 時間／空間 O(c + f)，c = 儲存格數，f = 備份檔案數。
 */
function runDailyBackup() {
  const spreadsheet = getBackupSpreadsheet_();
  const folder = getOrCreateBackupFolder_();
  const payload = buildSpreadsheetBackup_(spreadsheet);
  const json = JSON.stringify(payload);
  if (json.length > BACKUP_CONFIG.maxJsonLength) {
    throw new Error("備份超過 20 MB，請先檢查是否有異常大量資料。");
  }

  const timestamp = Utilities.formatDate(new Date(), COMMENTS_CONFIG.timeZone, "yyyyMMdd-HHmmss");
  const safeName = spreadsheet.getName().replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
  const fileName = `${safeName}-${timestamp}.json`;
  const file = folder.createFile(fileName, json, MimeType.PLAIN_TEXT);
  cleanupOldBackups_(folder);

  const result = {
    success: true,
    fileName,
    fileId: file.getId(),
    folderId: folder.getId(),
    spreadsheetId: spreadsheet.getId(),
    sheetCount: payload.sheets.length,
    jsonBytes: json.length,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 時間驅動觸發器沒有瀏覽器作用中工作表，優先用已保存 ID 開啟。
 * 時間／空間 O(1)。
 */
function getBackupSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const storedId = String(properties.getProperty(BACKUP_CONFIG.spreadsheetIdProperty) || "").trim();
  if (storedId) {
    try {
      return SpreadsheetApp.openById(storedId);
    } catch (error) {
      console.warn("[backup] 已保存的試算表 ID 無法開啟，改用目前綁定試算表。", error);
      properties.deleteProperty(BACKUP_CONFIG.spreadsheetIdProperty);
    }
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("找不到備份來源。請先從 Apps Script 編輯器執行 setupDailyBackups。");
  }
  properties.setProperty(BACKUP_CONFIG.spreadsheetIdProperty, spreadsheet.getId());
  return spreadsheet;
}

function buildSpreadsheetBackup_(spreadsheet) {
  return {
    schemaVersion: 1,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    timeZone: spreadsheet.getSpreadsheetTimeZone(),
    createdAt: formatTaipeiDate_(new Date()),
    sheets: spreadsheet.getSheets().map((sheet) => {
      const range = sheet.getDataRange();
      return {
        name: sheet.getName(),
        frozenRows: sheet.getFrozenRows(),
        frozenColumns: sheet.getFrozenColumns(),
        values: range.getValues().map((row) => row.map(serializeBackupCell_)),
      };
    }),
  };
}

function serializeBackupCell_(value) {
  if (value instanceof Date) return { type: "date", value: value.toISOString() };
  return value;
}

function getOrCreateBackupFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const storedId = String(properties.getProperty(BACKUP_CONFIG.folderIdProperty) || "").trim();
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (error) {
      properties.deleteProperty(BACKUP_CONFIG.folderIdProperty);
    }
  }

  const folders = DriveApp.getFoldersByName(BACKUP_CONFIG.folderName);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_CONFIG.folderName);
  properties.setProperty(BACKUP_CONFIG.folderIdProperty, folder.getId());
  return folder;
}

function cleanupOldBackups_(folder) {
  const cutoff = Date.now() - BACKUP_CONFIG.retentionDays * 24 * 60 * 60 * 1000;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated().getTime() < cutoff) file.setTrashed(true);
  }
}

/**
 * 回傳並記錄備份狀態，不開啟阻塞式試算表對話框。
 * 時間 O(t)，空間 O(1)。
 */
function showBackupHealth() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "runDailyBackup");
  const properties = PropertiesService.getScriptProperties();
  const result = {
    success: true,
    triggerCount: triggers.length,
    triggerReady: triggers.length > 0,
    folderConfigured: Boolean(properties.getProperty(BACKUP_CONFIG.folderIdProperty)),
    spreadsheetConfigured: Boolean(properties.getProperty(BACKUP_CONFIG.spreadsheetIdProperty)),
    retentionDays: BACKUP_CONFIG.retentionDays,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
