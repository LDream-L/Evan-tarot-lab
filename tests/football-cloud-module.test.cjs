const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "football", "cloud.js");

/** 時間／空間複雜度 O(B)，B 為 cloud source 大小。 */
function loadModule() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-cloud-esm-"));
  const bundle = path.join(directory, "cloud.bundle.cjs");
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: bundle,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    logLevel: "silent",
  });
  delete require.cache[bundle];
  return { api: require(bundle), directory };
}

/** 固定回應 stub：時間／空間 O(1)。 */
function makeResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
  };
}

/** 時間 O(r)、額外空間 O(r)，r 為固定測試呼叫數。 */
async function run() {
  const runtime = loadModule();
  const { api } = runtime;

  try {
    const prepared = api.prepareActualForCloud({
      homeGoals: 2,
      reviewAnalysis: "判讀成立",
      notes: "下半場紅牌",
    });
    assert.equal(prepared.homeGoals, 2);
    assert.match(prepared.notes, /【回顧與分析】\n判讀成立/);
    assert.match(prepared.notes, /【賽事事件／特殊狀況】\n下半場紅牌/);

    assert.deepEqual(
      await api.parseCloudResponse(makeResponse({ ok: true, result: { id: "R-1" } })),
      { ok: true, result: { id: "R-1" } }
    );
    await assert.rejects(
      () => api.parseCloudResponse(makeResponse("not-json", { status: 502 })),
      /不是有效 JSON/
    );
    await assert.rejects(
      () => api.parseCloudResponse(makeResponse({ ok: false, error: "後端拒絕" }, { ok: false, status: 403 })),
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
    let expired = 0;
    let rejectAuth = false;
    let authListener = null;
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes("action=health")) {
        return makeResponse({ ok: true, service: "football-tarot" });
      }
      const body = JSON.parse(options.body);
      if (rejectAuth) {
        return makeResponse(
          { ok: false, error: "Google 登入憑證驗證失敗。" },
          { ok: false, status: 401 }
        );
      }
      return makeResponse({
        ok: true,
        result: { action: body.action, id: body.recordId || body.record?.id },
      });
    };
    const windowListeners = new Map();
    const browserWindow = {
      addEventListener(type, listener) {
        windowListeners.set(type, listener);
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
      expireSession: () => { expired += 1; },
      onChange(listener) {
        authListener = listener;
        return () => { authListener = null; };
      },
    };
    assert.equal(cloud.bindUnifiedAuth(), true);
    assert.equal(typeof authListener, "function");
    assert.equal(cloud.hasToken(), true);

    assert.deepEqual(await cloud.saveRecord(records[0]), { action: "createRecord", id: "R-1" });
    assert.deepEqual(await cloud.updateActual("R-1", records[0].actual), {
      action: "updateActual",
      id: "R-1",
    });

    const createBody = JSON.parse(calls.at(-2).options.body);
    assert.equal(createBody.action, "createRecord");
    assert.equal(createBody.idToken, "jwt-token");
    assert.deepEqual(createBody.record, records[0]);

    const updateBody = JSON.parse(calls.at(-1).options.body);
    assert.equal(updateBody.action, "updateActual");
    assert.equal(updateBody.recordId, "R-1");
    assert.match(updateBody.actual.notes, /【回顧與分析】/);

    const progress = [];
    assert.deepEqual(
      await cloud.syncAll(records, (done, total) => progress.push([done, total])),
      { synced: 2, completed: 1 }
    );
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
    assert.deepEqual(
      calls.slice(-3).map((item) => JSON.parse(item.options.body).action),
      ["createRecord", "updateActual", "createRecord"]
    );

    assert.equal(await cloud.healthCheck(), true);
    assert.match(calls.at(-1).url, /action=health/);

    rejectAuth = true;
    await assert.rejects(() => cloud.saveRecord(records[0]), /Google 登入憑證驗證失敗/);
    assert.equal(expired, 1);
    assert.equal(signedOut, 0);
    rejectAuth = false;

    await cloud.init();
    assert.equal(windowListeners.has("evan-site-account-ready"), true);
    assert.equal(windowListeners.has("evan-google-auth-change"), true);

    cloud.clearToken();
    assert.equal(signedOut, 1);
    cloud.destroy();
    assert.equal(authListener, null);

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
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
