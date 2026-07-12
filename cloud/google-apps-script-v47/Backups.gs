// ==============================
// Google Sheets 每日 JSON 備份
// 備份綁定試算表全部工作表至私人 Google Drive
// ==============================
//
// 主要函式複雜度：
// - buildSpreadsheetBackup_：時間／空間 O(c)，c = 全工作表儲存格數
// - cleanupOldBackups_：時間 O(f)，空間 O(1)
//
// 更快替代方案比較：
// - 每次只備份變更列：檔案較小，但還原邏輯與一致性複雜。
// - 本實作：每日完整快照，適合目前資料量；單檔可直接檢查與完整還原。
// ==============================

const BACKUP_CONFIG = Object.freeze({
  folderIdProperty: "EVAN_BACKUP_FOLDER_ID",
  folderName: "Evan Tarot Backups",
  retentionDays: 60,
  maxJsonLength: 20 * 1024 * 1024,
});

function setupDailyBackups() {
  const folder = getOrCreateBackupFolder_();
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "runDailyBackup")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("runDailyBackup")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  const result = runDailyBackup();
  SpreadsheetApp.getUi().alert(`每日備份已建立。\n資料夾：${folder.getName()}\n首份備份：${result.fileName}`);
  return result;
}

function runDailyBackup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("找不到綁定的 Google 試算表。");
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
  return { success: true, fileName, fileId: file.getId(), sheetCount: payload.sheets.length };
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

function showBackupHealth_() {
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === "runDailyBackup");
  const folderId = PropertiesService.getScriptProperties().getProperty(BACKUP_CONFIG.folderIdProperty) || "";
  SpreadsheetApp.getUi().alert(
    `每日備份觸發器：${triggers.length ? "已建立" : "尚未建立"}\n備份資料夾：${folderId ? "已設定" : "尚未設定"}\n保留天數：${BACKUP_CONFIG.retentionDays}`
  );
}
