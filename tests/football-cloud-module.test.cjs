const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "cloud.js");

/**
 * 以 esbuild 解析具名雲端模組，避免整頁 E2E 才發現 API 契約錯誤。
 * 時間／空間複雜度 O(B)，B 為 cloud source 大小。
 */
function loadModule() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "football-cloud-esm-"));
  const bundlePath = path.join(temporaryDirectory, "cloud.bundle.cjs");
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: bundlePath,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    logLevel: "silent",
  });
  delete require.cache[bundlePath];
  return { api: require(bundlePath), temporaryDirectory };
}

/** 固定回應 stub：時間／空間 O(1)。 */
function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
  };
}

/**
 * 驗證既有三個 action、動態登入、循序補傳與錯誤處理。
 * 時間 O(r)、額外空間 O(r)，r 為固定測試呼叫數。
 */
async function run() {
  const runtime = loadModule();
  const { api } = runtime;

  try {
    assert.deepEqual(
      api.prepareActualForCloud({ reviewAnalysis: "判讀成立", notes: "下半場紅牌", homeGoals: 2 }),
      {
        reviewAnalysis: "判讀成立",
        notes: "【回顧與分析】\n判讀成立\n\n【賽事事件／特殊狀況】\n下半場紅牌",
        homeGoals: 2,
      }
    );

    assert.deepEqual(await api.parseCloudResponse(response({ ok: true, result: { id: "R-1" } })), {
      ok: true,
      result: { id: "R-1" },
    });
    await assert.rejects(
      () => api.parseCloudResponse(response("not-json", { status: 502 })),
      /不是有效 JSON/
    );
    await assert.rejects(
      () => api.parseCloudResponse(response({ ok: false, error: "後端拒絕" }, { ok: false, status: 403 })),
      /後端拒絕/
    );

    const records = [
      {
        id: "R-1",
        match: { homeTeam: "主隊", awayTeam: "客隊" },
        actual: { homeGoals: 2, awayGoals: 1, reviewAnalysis: "命中", notes: "無" },
      },
      {
        id: "R-2",
        match: { homeTeam: "甲隊", awayTeam: "乙隊" },
        actual: null,
      },
    ];
    const core = { getRecords: () => records.slice() };
    let auth = null;
    let opened = 0;
    let signedOut = 0;
    let onChangeListener = null;
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes("action=health")) {
        return response({ ok: true, service: "football-tarot" });
      }
      const body = JSON.parse(options.body);
      return response({ ok: true, result: { action: body.action, id: body.recordId || body.record?.id } });
    };
    const listeners = new Map();
    const browserWindow = {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    };
    const documentRef = {
      getElementById() { return null; },
      createElement() { throw new Error("此測試不應建立 DOM。"); },
      head: { appendChild() {} },
    };

    const cloud = api.createFootballCloud({
      core,
      config: {
        footballApiUrl: "https://script.google.com/macros/s/test/exec",
        googleClientId: "client.apps.googleusercontent.com",
      },
      authProvider: () => auth,
      accountProvider: () => ({ open: () => { opened += 1; } }),
      fetchImpl,
      browserWindow,
      documentRef,
      autoInit: false,
    });

    assert.equal(Object.isFrozen(cloud), true);
    assert.equal(Object.isFrozen(cloud.protocol), true);
    assert.deepEqual([...cloud.protocol], ["health", "createRecord", "updateActual"]);
    assert.strictEqual(cloud.core, core);
    assert.equal(cloud.isConfigured(), true);
    assert.equal(cloud.hasToken(), false);
    await assert.rejects(() => cloud.saveRecord(records[0]), /請先從右上角登入/);
    assert.equal(opened, 1);
    await assert.rejects(() => cloud.request("listRecords"), /不支援/);

    auth = {
      getCredential: () => "jwt-token",
      signOut: () => { signedOut += 1; },
      onChange(listener) {
        onChangeListener = listener;
        return () => { onChangeListener = null; };
      },
    };
    assert.equal(cloud.bindUnifiedAuth(), true);
    assert.equal(typeof onChangeListener, "function");
    assert.equal(cloud.hasToken(), true);

    const saved = await cloud.saveRecord(records[0]);
    assert.deepEqual(saved, { action: "createRecord", id: "R-1" });
    const updated = await cloud.updateActual("R-1", records[0].actual);
    assert.deepEqual(updated, { action: "updateActual", id: "R-1" });

    const createBody = JSON.parse(calls.at(-2).options.body);
    assert.equal(createBody.action, "createRecord");
    assert.equal(createBody.idToken, "jwt-token");
    assert.strictEqual(createBody.record, records[0]);

    const updateBody = JSON.parse(calls.at(-1).options.body);
    assert.equal(updateBody.action, "updateActual");
    assert.equal(updateBody.recordId, "R-1");
    assert.match(updateBody.actual.notes, /【回顧與分析】/);
    assert.match(updateBody.actual.notes, /【賽事事件／特殊狀況】/);

    const progress = [];
    const result = await cloud.syncAll(records, (done, total) => progress.push([done, total]));
    assert.deepEqual(result, { synced: 2, completed: 1 });
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
    const syncActions = calls.slice(-3).map((item) => JSON.parse(item.options.body).action);
    assert.deepEqual(syncActions, ["createRecord", "updateActual", "createRecord"]);

    assert.equal(await cloud.healthCheck(), true);
    assert.match(calls.at(-1).url, /action=health/);

    await cloud.init();
    assert.equal(listeners.has("evan-site-account-ready"), true);
    assert.equal(listeners.has("evan-google-auth-change"), true);

    cloud.clearToken();
    assert.equal(signedOut, 1);
    cloud.destroy();
    assert.equal(onChangeListener, null);

    const unconfigured = api.createFootballCloud({
      core,
      config: {},
      authProvider: () => auth,
      accountProvider: () => null,
      fetchImpl,
      browserWindow,
      documentRef,
      autoInit: false,
    });
    assert.equal(unconfigured.isConfigured(), false);
    assert.equal(await unconfigured.healthCheck(), false);
    await assert.rejects(() => unconfigured.saveRecord(records[0]), /尚未設定/);

    console.log("football-cloud module tests passed");
  } finally {
    fs.rmSync(runtime.temporaryDirectory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
