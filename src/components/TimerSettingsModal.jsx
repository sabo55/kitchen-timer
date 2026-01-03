import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  MINUTES,
  SECONDS,
  Field,
  headerBar,
  headerRight,
  headerChecks,
  headerCopy,
  tabsWrap,
  TAB_BTN,
  BTN_PRIMARY,
  BTN_GRAY,
  boxPanel,
  rowWrap,
  timeRowWrap,
  endRowWrap,
  numberOpts,
  ColorSwatchField,
  limitChars,
  buildRadioSoundGroups,
} from "./helpers";
import {
  normalizeSoundId, toJPLabel} from "../lib/sounds-helper";

const toJPTime = (raw) => toJPLabel(String(raw || "").trim());

/* 背景色スウォッチ（通知＆背景色の色IDに合わせる） */
const NB_SWATCH_ITEMS = [
  { id: "yellow", label: "黄", className: "bg-yellow-300" },
  { id: "orange", label: "橙", className: "bg-orange-300" },
  { id: "green",  label: "緑", className: "bg-emerald-300" },
];

/* ───────── helper generators ───────── */
const emptyNotifyBg = () => ({
  label: "",
  notify1: { min: 0, sec: 0, sound: "" },
  notify2: { min: 0, sec: 0, sound: "" },
  color: "",
});
const emptyMode = () => ({
  timerName: "",
  buttonLabel: "",
  timeMin: 0,
  timeSec: 0,
  startSound: "alarm",
  endSound: "alarm8",
  endLoops: 1, // 旧フィールド（互換用）
  endLoopSec: 10, // 新: ループ停止秒（5〜60）
    // 新: 終了ループ中に「案内音声」を1回だけ挟む
  endInsertEnabled: false,
  endInsertIntroSound: "builtin-beep3", // 最初に1回鳴らす音（例：ピピピッ）
  endInsertVoiceSound: "",              // 挟みたい音声（登録音声など）
  endInsertMuteSec: 2,                   // 挟む秒数（音声が短い/長いときの調整用）
  nbRows: [],
  btnRows: null,
  hidden: false,
});

/* ───────── style tokens ───────── */
const CSS = {
  sel: "#bde4ff",
  card: "#f1f3f4",
  start: "#35a855",
  wrap: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  panel: {
    position: "relative", // PickerOverlay をモーダル内基準に固定
    background: "#fff",
    colorScheme: "light",
    borderRadius: 12,
    padding: 24,
    width: "min(600px, 94vw)",
    maxHeight: "90vh",
    overflowY: "auto",
  },
  section: { borderTop: "1px solid #ddd", paddingTop: 16, marginTop: 16 },
  label: { fontWeight: 700, marginBottom: 4, display: "block" },
 input: {
    padding: "6px 10px",
    border: "1px solid #ccc",
    borderRadius: 6,
    width: "100%",
    fontSize: "1rem",
    colorScheme: "light",
  },
};
const selectStyle = { ...CSS.input, width: "auto" };
const SOUND_SELECTED_WIDTH = 280;

// header / tabs / buttons の共通スタイルは helpers から import 済み
/* ───────── component ───────── */
// 大量の音声候補向けの簡易ページング付きオーバーレイ
export default function TimerSettingsModal({ config, setConfig, onClose, cardIndex = 0 }) {
  /* per-mode設定を外からコピー */
  const [modes, setModes] = useState(config.modes || [emptyMode(), emptyMode(), emptyMode()]);
  const [tab, setTab] = useState(0);
  const [cardHidden, setCardHidden] = useState(!!config.cardHidden);
  const [dirty, setDirty] = useState(false);
  const [copyIdx, setCopyIdx] = useState("");

  // コピー元候補（保存済みのカード一覧から、現在のカード以外）
  const availableCardIndices = useMemo(() => {
    try {
      const keys = Object.keys(localStorage);
      const idxs = keys
        .filter((k) => k === "timerConfig" || k.startsWith("timerConfig_card_"))
        .map((k) => (k === "timerConfig" ? 0 : Number(k.replace("timerConfig_card_", ""))))
        .filter((n) => Number.isInteger(n));
      return Array.from(new Set(idxs)).sort((a, b) => a - b);
    } catch {
      return [];
    }
  }, []);
  const copyCandidates = useMemo(() => availableCardIndices.filter((i) => i !== cardIndex), [availableCardIndices, cardIndex]);

  // 音声が多い場合の検索付きピッカー
  const [picker, setPicker] = useState(null);
  const openPicker = (list, value, commit, title = "", y = 84) => setPicker({ list, value, commit, q: "", title, y });
  const closePicker = () => setPicker(null);
  const panelRef = useRef(null);
  // ラジオ開閉キー（どの行の「変更」を開いているか）
  const [openRadioKey, setOpenRadioKey] = useState(null);
  // プルダウンをクリックしたら上部に全件ピッカーを開く
  const openFromSelect = (list, current, commit, title) => (e) => {
    e.preventDefault();
    const panel = panelRef.current;
    let y = 84;
    if (panel) {
      const panelRect = panel.getBoundingClientRect();
      const triggerRect = e.currentTarget.getBoundingClientRect();
      y = (triggerRect.bottom - panelRect.top) + panel.scrollTop + 8; // クリックした行の直下に表示
    }
    openPicker(list, current, (id) => commit(normalizeSoundId(id)), title, y);
  };

  // 10キー（テンキー）設定
  const [tenKeyEnabled, setTenKeyEnabled] = useState(!!(config.tenKey && config.tenKey.enabled));
  const [tenKeyKeepLast, setTenKeyKeepLast] = useState(config.tenKey ? !!config.tenKey.keepLast : true);

  const [resetSec, setResetSec] = useState(Number(config.resetSec ?? 10));
  const [returnMode, setReturnMode] = useState(config.returnMode ?? "A");
  const curr = modes[tab];
  // 通知ボタンの行数を減らしても内容を失わないための一時キャッシュ（タブ別）
  const btnRowsCacheRef = useRef({});

// ---- Audio library (Helpers 経由でライブラリ + 内蔵音を取得) ----
// iPad運用版：
// - 1段目（基本4つ） + 2段目（登録音声）だけ
// - 3段目（時間系プリセット）は出さない

const BASIC_IDS = new Set([
  "builtin-beep",
  "builtin-beep3",
  "alarm8",
  "",
  // 互換（古い保存データ用）
  "beep",
  "alarm",
  "silent",
  "none",
]);

const uniqById = (arr) => {
  const map = new Map();
  for (const o of arr || []) {
    const id = String(o?.id ?? "");
    if (!map.has(id)) map.set(id, { ...o, id });
  }
  return Array.from(map.values());
};

const groupNameOf = (g) =>
  String(g?.id ?? g?.key ?? g?.name ?? g?.title ?? g?.label ?? "").trim();

const isTimeGroupName = (name) => {
  const s = String(name || "");
  if (!s) return false;
  const lower = s.toLowerCase();
  return lower.includes("time") || lower.includes("times") || s.includes("時間");
};


// helpers 側の候補（時間系は非表示）
const radioGroups = buildRadioSoundGroups({
  withSilent: true,
  withBuiltins: true,
  withCustom: true,
  withTimes: false,
  exclude: [],
});

// group 情報を付与してからフラット化（時間系グループは丸ごと除外）
const radioListFlatAll = uniqById(
  radioGroups.flatMap((g) => {
    const gn = groupNameOf(g);
    return (g.items || []).map((it) => ({ ...it, _group: gn }));
  })
);

const radioListFlat = radioListFlatAll.filter((o) => !isTimeGroupName(o?._group));

// notify等で使う候補リスト（従来の baseList の代替）
const baseList = radioListFlat;

// 表示用：id→ラベル
const labelOf = (list, id) => {
  const sid = String(id ?? "");
  // iPad運用版："none" 表記は分かりづらいので「無音」に統一
  if (sid === "" || sid === "none" || sid === "silent") return "無音";

  const found = list.find((o) => o.id === sid)?.label;
  return found || toJPTime(sid || "未選択");
};

// iPad運用版：時間系プリセットは「完全に表示しない」
// ※ここでは label を見ない（ユーザー登録音声が「30秒前」でも消さないため）
// ※時間系は buildRadioSoundGroups の「時間系グループ」を丸ごと除外しているので、
//   ここは保険（将来 helpers が変わって混ざってきたとき用）
const isTimeLikeSoundItem = (o) => {
  const g = String(o?._group ?? "");
  if (isTimeGroupName(g)) return true;

  const s = String(o?.id ?? "").trim().toLowerCase();
  if (!s) return false;
  // 旧/英語系が id に混ざるケースだけ弾く
  if (s.includes("seconds ago")) return true;
  if (s.includes("minutes ago")) return true;
  if (s.includes("elapsed")) return true;
  return false;
};

// 横並びラジオ（4列）— 2ブロック：基本4つ／登録音声
const RadioSound = ({ list, value, onChange, name }) => {
  const SILENT_IDS = new Set(["", "none", "silent"]);

  const safeList = uniqById(list);

  const basic = [];
  const presets = [];

  safeList.forEach((o) => {
    // 時間系プリセット（10秒前 / 10 seconds ago / t:... など）は表示しない
    if (isTimeLikeSoundItem(o)) return;

    const id = String(o.id || "");
    if (BASIC_IDS.has(id)) basic.push(o);
    else presets.push(o);
  });

  // 4つの順番を固定：ピッ → ピピピッ → ピピピッ（ループ）→ 無音
  const basicOrder = ["builtin-beep", "builtin-beep3", "alarm8", "", "none"];
  basic.sort((a, b) => basicOrder.indexOf(String(a.id)) - basicOrder.indexOf(String(b.id)));

  const Item = (o) => {
    const idStr = String(o.id || "");
    const isSilent = SILENT_IDS.has(idStr);
    const isChecked = value === o.id;

    return (
      <label
        key={o.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          border: isSilent ? "1px dashed #bbb" : "1px solid #ddd",
          borderRadius: 8,
          background: isSilent ? "#e6e6e6ff" : isChecked ? "#e4f2ffff" : "#fff",
          cursor: "pointer",
          userSelect: "none",
        }}
        title={o.id}
      >
        <input type="radio" name={name} value={o.id} checked={isChecked} onChange={() => onChange(o.id)} />
        <span
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "0.80rem",
            opacity: isSilent ? 0.9 : 1,
          }}
        >
          {labelOf(list, o.id)}
        </span>
      </label>
    );
  };

  const RowBreak = () => <div style={{ gridColumn: "1 / -1", height: 6 }} />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
      {basic.map(Item)}
      <RowBreak />
      {presets.map(Item)}
    </div>
  );
};

// 【選択された音声】【変更ボタン】→ 押すと“重ねて”ラジオ一覧パネルを表示
const SoundChoice = ({ list, value, onChange, title }) => {
  const radioKey = title || "sound";
  const name = `radio_${radioKey}`;
  const wrapRef = useRef(null);

  // 外側クリックで閉じる
  useEffect(() => {
    if (openRadioKey !== radioKey) return;
    const onDown = (e) => {
      const el = wrapRef.current;
      if (!el) return;
      if (!el.contains(e.target)) setOpenRadioKey(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openRadioKey, radioKey]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div
          style={{
            ...CSS.input,
            flex: `0 0 ${SOUND_SELECTED_WIDTH}px`,
            maxWidth: SOUND_SELECTED_WIDTH,
            background: "#f9f9f9",
          }}
        >
          {labelOf(list, value)}
        </div>

        <button
          type="button"
          style={BTN_PRIMARY}
          onClick={() => setOpenRadioKey((k) => (k === radioKey ? null : radioKey))}
          aria-expanded={openRadioKey === radioKey}
          aria-controls={`radio_${radioKey}`}
        >
          変更
        </button>
      </div>

      {openRadioKey === radioKey && (
        <div
          id={`radio_${radioKey}`}
          style={{
            position: "absolute",
            left: -220,
            right: -20,
            top: "100%",
            marginTop: 8,
            zIndex: 20,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 10,
            boxShadow: "0 8px 16px rgba(0,0,0,.08), 0 2px 6px rgba(0,0,0,.04)",
            padding: 12,
            maxHeight: 320,
            overflowY: "auto",
            maxWidth: "calc(100vw - 48px)",
          }}
        >
          <RadioSound
            list={list}
            value={value}
            onChange={(id) => {
              onChange(normalizeSoundId(id));
              setOpenRadioKey(null);
            }}
            name={name}
          />
        </div>
      )}
    </div>
  );
};
const isDigits = (s) => {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
};

// iPad運用版：時間系プリセット（t:... / 英語の time preset id）だけ除外。
// ※ユーザー登録音声が「30秒前」などでも、id が通常の custom id なら除外しない。
const isTimeLikeId = (v) => {
  const s = String(v || "").trim();
  if (!s) return false;
  if (s.startsWith("t:")) return true;

  const lower = s.toLowerCase();
  if (lower.includes("seconds ago")) return true;
  if (lower.includes("minutes ago")) return true;
  if (lower.includes("elapsed")) return true;
  if (/^\d+\s*(seconds|minutes)\s*ago$/.test(lower)) return true;

  return false;
};
  // 現在の設定内で使われている soundId を収集し、リストに存在しない場合でも表示できるように補完
 const collectUsedSoundIds = (ms) => {
  const ids = new Set();
  const add = (v) => {
    if (!v) return;
    if (isTimeLikeId(v)) return; // ★時間系は補完しない
    ids.add(v);
  };

  for (const m of ms) {
    add(m?.startSound);
    add(m?.endSound);
    (m?.nbRows || []).forEach((r) => {
      add(r?.notify1?.sound);
      add(r?.notify2?.sound);
    });
    (m?.btnRows || []).forEach((b) => {
      add(b?.n1?.sound);
      add(b?.n2?.sound);
    });
  }
  return Array.from(ids);
};

// 足りない id を { id, label: id } として埋める
const withMissing = (list, ids) => {
  const seen = new Set(list.map((o) => o.id));
  const add = ids
    .filter((id) => id && !seen.has(id) && !isTimeLikeId(id)) // ★時間系は補完しない
    .map((id) => ({ id, label: String(id) }));
  return [...list, ...add];
};

const usedIds = useMemo(() => collectUsedSoundIds(modes), [modes]);

// 画面で使う実効リスト：helpers からの候補 + 現在値(英語 id もそのまま表示)
const effectiveList = useMemo(() => withMissing(baseList, usedIds),[baseList, usedIds]);

// 終了音リストは alarm8 を先頭にしつつ、現在値が未知でも表示できるよう補完
const baseNoAlarm = useMemo(() => baseList.filter((o) => o.id !== "alarm8"), [baseList]);

const endOpts = useMemo(
  () => withMissing([{ id: "alarm8", label: "ピピピッ（ループ）" }, ...baseNoAlarm], usedIds),
  [baseNoAlarm, usedIds]
);

  // 現在のタブのモードだけを部分更新してdirtyを立てる
  const patchMode = (patch) => {
    setModes((prev) => {
      const copy = [...prev];
      copy[tab] = { ...copy[tab], ...patch };
      return copy;
    });
    setDirty(true);
  };

/* ─ rows add/remove ─ */
  const addNBRow = () => {
    if (curr.nbRows.length >= 3) return;
    patchMode({ nbRows: [...curr.nbRows, emptyNotifyBg()] });
  };

  // 1行だけ安全に更新するヘルパ（行数削減＆重複排除）
  const updateNB = (i, fn) => {
    const l = [...curr.nbRows];
    fn(l[i]);
    patchMode({ nbRows: l });
  };

  // 通知ボタン行の1項目だけ更新するヘルパ（重複排除）
  const updateBtn = (i, key, fn) => {
    const l = [...(curr.btnRows || [])];
    if (!l[i]) return;
    fn(l[i][key]);
    patchMode({ btnRows: l });
  };

  // 通知 & 背景色：行数変更の共通ハンドラ（while/push/pop を1か所に集約）
  const setNbRowsCount = (n) => {
    const rows = Array.from({ length: Math.max(0, n) }, (_, i) =>
      curr.nbRows[i] ? { ...curr.nbRows[i] } : emptyNotifyBg()
    );    patchMode({ nbRows: rows });
  };

  /* render helpers は helpers 側を利用 */
const trimBtnLabels = (ms) => ms.map((m) => ({
  ...m,
  btnRows: m.btnRows ? m.btnRows.map((r) => ({ ...r, label: limitChars(r.label, 4) })) : null,
}));

const saveAndClose = () => {
  const modesFixed = trimBtnLabels(modes);
  setConfig({
    ...config,
    modes: modesFixed,
    resetSec,
    returnMode,
    cardHidden,
    tenKey: { ...(config.tenKey || {}), enabled: tenKeyEnabled, keepLast: tenKeyKeepLast },
  });
  setDirty(false);
  onClose();
};

  // Escキーで保存して閉じる
  useSettingsModalEscToSave(saveAndClose);
  const discardAndClose = () => {
    setDirty(false);
    onClose();
  };
  const handleBackdrop = () => {
    // 背景タップでは閉じない（誤タップ防止）。何もしない。
  };

  // 他タイマーからコピー（カードインデックスを直接指定）
  const readCardConfigFromStorage = (i) => {
    try {
      // Prefer new per-card key (timerConfig_card_i). For card 0, fall back to the old legacy key (timerConfig).
      const primaryKey = `timerConfig_card_${i}`;
      let txt = localStorage.getItem(primaryKey);
      if (!txt && i === 0) txt = localStorage.getItem("timerConfig"); // legacy fallback
      return txt ? JSON.parse(txt) : null;
    } catch {
      return null;
    }
  };
  const applyWholeCardConfig = (payload) => {
    if (!payload) return;
    if (payload.modes) setModes(payload.modes);
    if (payload.resetSec != null) setResetSec(payload.resetSec);
    if (payload.returnMode != null) setReturnMode(payload.returnMode);
    if (payload.cardHidden != null) setCardHidden(!!payload.cardHidden);
    if (payload.tenKey) {
      setTenKeyEnabled(!!payload.tenKey.enabled);
      setTenKeyKeepLast(payload.tenKey.keepLast ?? true);
    }
    setDirty(true);
  };
  const execCopyFromCard = () => {
    const i = Number(copyIdx);
    if (!Number.isInteger(i) || i === cardIndex) return;
    const ok = window.confirm(`タイマー${i + 1}をコピーします。現在の入力内容が破棄されますがよろしいですか？`);
    if (!ok) return;
    let payload = readCardConfigFromStorage(i);
    if (!payload) {
      try {
        const txt = localStorage.getItem("timerCardClipboardV1");
        payload = txt ? JSON.parse(txt) : null;
      } catch {}
    }
    if (payload) applyWholeCardConfig(payload);
  };

  return (
    <div style={CSS.wrap} onClick={handleBackdrop}>
      <div style={CSS.panel} ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div style={headerBar}>
        <div style={headerCopy}>
          <select
            style={{ ...selectStyle, maxWidth: 160 }}
            value={copyIdx}
            onChange={(e) => setCopyIdx(e.target.value)}
          >
            <option value="">ーーーーー</option>
            {copyCandidates.map((i) => (
              <option key={i} value={String(i)}>{i + 1}タイマー</option>
            ))}
          </select>
          <span>をコピー</span>
          <button
            onClick={execCopyFromCard}
            disabled={!Number.isInteger(Number(copyIdx))}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #888", background: "#f5f5f5", fontWeight: 700 }}
          >実行</button>
        </div>
        <div style={{ flex: "1 1 auto", order: 2 }} />
        <h2 style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0, flex: "1 1 auto", order: 1 }}>
          タイマー{cardIndex + 1}設定（モード{String.fromCharCode(65 + tab)}）
        </h2>
          <div style={headerRight}>
            <button
              onClick={saveAndClose}
              style={BTN_PRIMARY}
            >
              保存して閉じる
            </button>
            <button
              onClick={discardAndClose}
              style={BTN_GRAY}
            >
              保存しないで閉じる
            </button>
          </div>
          <div style={headerChecks}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={!!tenKeyEnabled}
                onChange={(e) => { setTenKeyEnabled(e.target.checked); setDirty(true); }}
              />
              10キーモード
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={!!cardHidden}
                onChange={(e) => { setCardHidden(e.target.checked); setDirty(true); }}
              />
              非表示
            </label>
          </div>
        </div>

        {/* タブ（モード切替） */}
        <div style={tabsWrap}>
          {[0,1,2].map((i) => (
            <button
              key={i}
              onClick={() => setTab(i)}
              style={{ ...TAB_BTN, background: tab === i ? CSS.sel : CSS.card }}
            >
              モード{String.fromCharCode(65 + i)}
            </button>
          ))}
        </div>

        {/* タイマー名／ボタン表示名 */}
        <div style={CSS.section}>
          <Field label="タイマー名">
            <input
              style={CSS.input}
              value={curr.timerName}
              maxLength={32}
              onChange={(e) => patchMode({ timerName: e.target.value })}
            />
          </Field>
          <Field label="ボタン表示名（表示は4文字まで）">
            <input
              style={{ ...CSS.input, maxWidth: 200 }}
              value={curr.buttonLabel}
              maxLength={32}
              onChange={(e) => patchMode({ buttonLabel: e.target.value })}
            />
          </Field>
        </div>

        {/* タイマー時間 */}
        <div style={CSS.section}>
          <Field label="タイマー時間">
            <div style={timeRowWrap}>
              <select
                style={selectStyle}
                value={curr.timeMin}
                onChange={(e) => patchMode({ timeMin: Number(e.target.value) })}
              >
                {numberOpts(MINUTES)}
              </select>
              <span>分</span>
              <select
                style={selectStyle}
                value={curr.timeSec}
                onChange={(e) => patchMode({ timeSec: Number(e.target.value) })}
              >
                {numberOpts(SECONDS)}
              </select>
              <span>秒</span>
            </div>
          </Field>
        </div>

        {/* 通知＆背景色（10キーモードでは非表示） */}
        {!tenKeyEnabled && (
          <div style={CSS.section}>
            <Field label="通知（行数）">
              <select
                style={{ ...selectStyle, marginLeft: 12 }}
                value={curr.nbRows.length}
                onChange={(e) => setNbRowsCount(Number(e.target.value))}
              >
                {[1, 2, 3].map((k) => (
                  <option key={k} value={k}>
                    {k} か所
                  </option>
                ))}
              </select>
            </Field>

            {curr.nbRows.map((row, idx) => (
              <div key={idx} style={boxPanel}>
                {/* 通知 (時刻+音) */}
                <div style={rowWrap}>
                  <select
                    style={selectStyle}
                    value={row.notify1.min}
                    onChange={(e) => updateNB(idx, (r) => { r.notify1.min = Number(e.target.value); })}
                  >
                    {numberOpts(MINUTES)}
                  </select>
                  <span>分</span>
                  <select
                    style={selectStyle}
                    value={row.notify1.sec}
                    onChange={(e) => updateNB(idx, (r) => { r.notify1.sec = Number(e.target.value); })}
                  >
                    {numberOpts(SECONDS)}
                  </select>
                  <span>秒</span>
                  <div style={{ marginLeft: 15 }}> 
                   <SoundChoice
                    list={effectiveList}
                    value={row.notify1.sound}
                    onChange={(id) => updateNB(idx, (r) => { r.notify1.sound = id; })}
                    title={`通知＆背景色 ${idx + 1}`}
                   />
                </div>
               </div>

                {/* 背景色（スウォッチ） */}
<ColorSwatchField
  label="背景色"
  value={row.color}
  onChange={(v) => updateNB(idx, (r) => { r.color = v; })}
  items={NB_SWATCH_ITEMS}
/>
              </div>
            ))}
          </div>
        )}

{/* スタート音 */}
<div style={CSS.section}>
  <Field label="スタート音">
    <SoundChoice
      list={radioListFlat}
      value={curr.startSound}
      onChange={(id) => patchMode({ startSound: id })}
      title="スタート音"
    />
  </Field>
</div>


 {/* カウント終了音 */}
        <div style={CSS.section}>
          <Field label="カウント終了音">
            <div style={{ ...endRowWrap, flexWrap: "wrap" }}>
              <SoundChoice
                list={endOpts}
                value={curr.endSound}
                onChange={(id) => patchMode({ endSound: id })}
                title="カウント終了音"
              />

              {curr.endSound === "alarm8" && (
                <>
                  <span>停止まで</span>
                  <select
                    style={selectStyle}
                    value={curr.endLoopSec ?? 10}
                    onChange={(e) => patchMode({ endLoopSec: Number(e.target.value) })}
                  >
                    {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((n) => (
                      <option key={n} value={n}>
                        {n} 秒
                      </option>
                    ))}
                  </select>

                 {/* 停止まで の下の段：ループ中に挟む音声（無音なら挟まない） */}
                 <div style={{ flexBasis: "100%", height: 0 }} />

                 <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                   <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>ループ中に音声を挟む</span>

                   <SoundChoice
                     list={effectiveList}
                     value={curr.endInsertVoiceSound ?? ""}
                     onChange={(id) => {
                       const sid = normalizeSoundId(id);
                       const isSilent = sid === "" || sid === "none" || sid === "silent";
                       patchMode({
                         endInsertVoiceSound: isSilent ? "" : sid,
                         // 互換用：古いデータがあっても壊れないように残しておく
                         endInsertEnabled: !isSilent,
                         // 合図は固定（ピピピッ1回）
                         endInsertIntroSound: "builtin-beep3",
                         // 無音ならミュート無効（0秒扱い）
                         endInsertMuteSec: isSilent ? 0 : (curr.endInsertMuteSec ?? 2),
                       });
                     }}
                     title="終了ループ中の音声"
                   />

                   <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                     <span style={{ fontSize: "0.9rem", opacity: 0.8, whiteSpace: "nowrap" }}>
                       （選ぶと：ピピピッ→音声→ピピピッ…）
                     </span>

                     {/* 無音のときはミュート無効（0秒） */}
                     {normalizeSoundId(curr.endInsertVoiceSound ?? "") !== "" && (
                       <>
                         <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>挟む秒数</span>
                         <select
                           style={selectStyle}
                           value={Number(curr.endInsertMuteSec ?? 2)}
                           onChange={(e) => patchMode({ endInsertMuteSec: Number(e.target.value) })}
                         >
                           {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => (
                             <option key={n} value={n}>
                               {n} 秒
                             </option>
                           ))}
                         </select>
                       </>
                     )}
                   </div>
                 </div>
                </>
              )}
            </div>
          </Field>
        </div>

        {/* 通知ボタン（10キーモードでは非表示） */}
        {!tenKeyEnabled && (
        <div style={CSS.section}>
          <Field label="通知ボタン（行数）">
            <select
            style={{ ...selectStyle, marginLeft: 12 }}
            value={curr.btnRows ? curr.btnRows.length : 0}
            onChange={(e) => {
              const n = Number(e.target.value);
              const currRows = curr.btnRows ? [...curr.btnRows] : [];
              const key = tab;
              const cacheObj = btnRowsCacheRef.current;
              const stash = Array.isArray(cacheObj[key]) ? cacheObj[key] : [];

              if (n <= 0) {
                // すべて一時退避して非表示
                cacheObj[key] = [...stash, ...currRows];
                patchMode({ btnRows: null });
                return;
              }

              let rows;
              if (currRows.length > n) {
                // 短縮：切り捨て分を stash に積む
                cacheObj[key] = [...stash, ...currRows.slice(n)];
                rows = currRows.slice(0, n);
              } else if (currRows.length < n) {
                // 伸長：stash から復元し、不足分は空行で埋める
                const need = n - currRows.length;
                const restored = stash.slice(0, need);
                const rest = Array.from({ length: Math.max(0, need - restored.length) }, () => ({ label: "", n1: { min: 0, sec: 0, sound: "" }, n2: { min: 0, sec: 0, sound: "" } }));
                rows = [...currRows, ...restored, ...rest];
                // 使った分を取り除く
                cacheObj[key] = stash.slice(restored.length);
              } else {
                rows = currRows;
              }
              patchMode({ btnRows: rows });
            }}
          >
            {[0, 1, 2, 3, 4].map((k) => (
              <option key={k} value={k}>
                {k} か所
              </option>
            ))}
          </select>
          </Field>

          {curr.btnRows &&
            curr.btnRows.map((r, idx) => (
              <div
                key={idx}
                style={boxPanel}
              >
            <Field label="通知ボタン名（表示は4文字まで）">
                <input
                  placeholder="通知ボタン名"
                  style={{ ...CSS.input, maxWidth: 160 }}
                  value={r.label}
                  maxLength={32}
                  onChange={(e) => {
                    const next = e.target.value; // 入力中は制限しない（IME対策）
                    const l = [...curr.btnRows];
                    l[idx].label = next;
                    patchMode({ btnRows: l });
                  }}
                />
              </Field>
              {["n1", "n2"].map((k) => (
                  <div key={k} style={rowWrap}>
                    <select
                      style={selectStyle}
                      value={r[k].min}
                      onChange={(e) => updateBtn(idx, k, (r) => { r.min = Number(e.target.value); })}
                    >
                      {numberOpts(MINUTES)}
                    </select>
                    <span>分</span>
                    <select
                      style={selectStyle}
                      value={r[k].sec}
                      onChange={(e) => updateBtn(idx, k, (r) => { r.sec = Number(e.target.value); })}
                    >
                      {numberOpts(SECONDS)}
                    </select>
                    <span>秒</span>
                    <div style={{ marginLeft: 15 }}>
                    <SoundChoice
                     list={effectiveList}
                     value={r[k].sound}
                     onChange={(id) => updateBtn(idx, k, (r) => { r.sound = id; })}
                     title={`通知ボタン ${idx + 1} ${(k === "n1" ? "①" : "②")}`}
                   />
                   </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
        )}

        {/* 共通エリア */}
        <div style={CSS.section}>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 8 }}>共通設定</h3>

          <Field label="自動リセット">
            <select
              style={selectStyle}
              value={resetSec}
              onChange={(e) => {
                setResetSec(Number(e.target.value));
                setDirty(true);
              }}
            >
              {[...Array(11)].map((_, i) => (
                <option key={i} value={10 + i * 5}>
                  {10 + i * 5} 秒
                </option>
              ))}
            </select>
          </Field>

          {tenKeyEnabled && (
            <Field label="10キーモード">
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={tenKeyKeepLast}
                  onChange={(e) => {
                    setTenKeyKeepLast(e.target.checked);
                    setDirty(true);
                  }}
                />
                最後に使った時間を保持
              </label>
            </Field>
          )}

          {!tenKeyEnabled && (
            <Field label="終了後戻るモード">
              <select
                style={selectStyle}
                value={returnMode}
                onChange={(e) => {
                  setReturnMode(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="A">モードA</option>
                <option value="B">モードB</option>
                <option value="C">モードC</option>
                <option value="last">直前モード</option>
              </select>
            </Field>
          )}
        </div>

        {/* footer */}
      </div>
    </div>
  );
}


// ESCキーで保存して閉じる
// （モーダル表示中の誤タップ/誤キーでも消失しないように自動保存）
// 追加のフックはコンポーネント定義内で宣言済みの変数へアクセス可能
export function useSettingsModalEscToSave(saveFn) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") saveFn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveFn]);
}
