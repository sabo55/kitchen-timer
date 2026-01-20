import React, { useState, useRef, useEffect, useMemo } from "react";

/* ========== 定数 ========== */
export const MINUTES = Array.from({ length: 100 }, (_, i) => i);
export const SECONDS = Array.from({ length: 60 }, (_, i) => i);

export const COLORS = [
  { id: "default", label: "既定", className: "bg-white" },
  { id: "amber", label: "あめ色", className: "bg-amber-50" },
  { id: "blue", label: "青", className: "bg-blue-50" },
  { id: "green", label: "緑", className: "bg-emerald-50" },
  { id: "pink", label: "桃", className: "bg-pink-50" },
];

export type SoundOption = { id: string; label: string };
export const SOUNDS: SoundOption[] = [
  { id: "builtin-beep", label: "ピッ" },
  { id: "builtin-beep3", label: "ピピピッ" },
  { id: "ten_sec", label: "１０秒前" },
  { id: "thirty_sec", label: "３０秒前" },
];
export const END_SOUNDS: SoundOption[] = [{ id: "alarm8", label: "ピピピッ（ループ）" }, ...SOUNDS];

// 音オプション生成は src/lib/sounds-helper.ts に集約
export { buildRadioSoundList, buildRadioSoundGroups } from "../lib/sounds-helper";


/* ========== 見た目トークン ========== */
export const TOKENS = {
  panel: "relative bg-white text-black rounded-2xl shadow-lg",
  header: "sticky top-0 z-10 bg-white rounded-t-2xl border-b",
  headerInner: "px-5 py-4 flex items-center justify-between",
  footer: "sticky bottom-0 z-10 bg-white rounded-b-2xl border-t",
  footerInner: "px-5 py-3 flex items-center justify-end gap-2",
  fieldRow: "grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)] gap-3 items-center",
  input: "h-9 rounded-md border px-3 bg-white text-black",
};

/* ========== 小ユーティリティ ========== */
export const limitChars = (s: string, n: number) =>
  [...(s ?? "")].slice(0, Math.max(0, n)).join("");

// ID 抽出（"sound:" プレフィックスや空白を除去）
export function extractId(v: string) {
  return (v || "").replace(/^sound:/, "").trim();
}
// 音レコードから“候補ID”を取り出す（id / soundId / value / label の順）
export function soundKey(x: any): string {
  return String(
    (x && (x.id ?? x.soundId ?? x.value ?? x.label)) ?? ""
  );
}

// 2つのIDを大小文字・前後空白を無視して比較
export function sameId(a: any, b: any): boolean {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}
// サウンドIDの正規化（ラベル/別名→安定ID）
export function normalizeSoundId(v: any): string {
  // まず extractId → 文字列化 → trim
  const raw = String(extractId(typeof v === "object" && v !== null ? (v as any).id ?? (v as any).value ?? (v as any).label ?? "" : v) || "").trim();
  if (!raw) return "";
if (raw.startsWith("t:")) {
    const mapped = resolveTimePresetToLibId(raw);
    if (mapped && mapped !== raw) return mapped;
    // 解決できなければそのまま（候補表示はできるが音は未登録 → 再生はピッ相当）
  }
  const s = raw.toLowerCase();
  // （以下は既存の無音・ビルトイン正規化処理をそのまま残す）
  if (s === "none" || s === "(none)" || s === "mute" || s === "silent") return "";

  const BEEP1 = new Set(["alarm", "beep", "builtin-beep", "builtin:beep","ピッ","ぴっ","ﾋﾟｯ"]);
  const BEEP3 = new Set(["beep3", "builtin-beep3", "builtin:beep3","ピピピッ","ぴぴぴっ","ﾋﾟﾋﾟﾋﾟｯ"]);
  const LOOP  = new Set(["alarm8", "builtin-alarm8", "builtin:alarm8","ループ","るーぷ"]);

  if (BEEP1.has(raw) || BEEP1.has(s)) return "builtin-beep";
  if (BEEP3.has(raw) || BEEP3.has(s)) return "builtin-beep3";
  if (LOOP.has(raw)  || LOOP.has(s))  return "alarm8";

  return raw;
}

export function pad2(n: number) { return (n < 10 ? "0" : "") + String(n); }
export function secToMMSS(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${pad2(m)}:${pad2(r)}`;
}

// "既定っぽい"名前か（通知ボタン名の自動調整に使用）
export function isDefaultLikeName(name: string) {
  const t = (name || "").trim();
  return t === "通知" || /^n[12]$/i.test(t);
}

// ループ再生の合計秒（ループ数と1ループ秒から計算）
export function loopSeconds(m: any): number {
  const s = Number(m?.endLoopSec);
  if (Number.isFinite(s)) return Math.min(60, Math.max(5, s));
  const loops = Number(m?.endLoops);
  if (Number.isFinite(loops)) return Math.max(1, Math.min(8, loops)) * 8;
  return 8;
}

// === 音声ID→日本語ラベル ===
export const toJPLabel = (raw: string) => {
  const s = String(raw || "");
  const fixed: Record<string, string> = {
    alarm8: "ピピピッ（ループ）",
    alarm: "ピピピッ",
    beep: "ピッ",
    "builtin-beep": "ピッ",
    "builtin-beep2": "ピピッ",
    "builtin-beep3": "ピピピッ",
    silent: "無音",
    none: "無音",
  };
  if (fixed[s]) return fixed[s];
  // 追加: TIME_ITEMS に一致する場合はその日本語ラベルを優先
  const tHit = TIME_ITEMS.find((t) => t.id === s || t.label === s);
  if (tHit) return tHit.label;

  // 例: 30-seconds-ago / 2-minutes-has-passed / 1-hour-has-passed
  const re = /^(\d+)-(second|seconds|minute|minutes|hour|hours)-(ago|has-passed)$/i;
  const m = s.match(re);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const kind = m[3].toLowerCase();
    const jpUnit = unit.startsWith("second") ? "秒" : unit.startsWith("minute") ? "分" : "時間";
    const suf = kind === "ago" ? "前" : "経過";
    return `${n}${jpUnit}${suf}`;
  }

  // 例: 30s-ago / 15sec-passed / 1m-elapsed / 2h-ago など
  const base = s.replace(/\.[a-z0-9]+$/i, "");
  const re2 = /^(\d+)(s|sec|secs|m|min|mins|h|hr|hrs)-(ago|passed|elapsed)$/i;
  const m2 = base.match(re2);
  if (m2) {
    const n = Number(m2[1]);
    const u = m2[2].toLowerCase();
    const k = m2[3].toLowerCase();
    const jpUnit = /^(s|sec|secs)$/.test(u) ? "秒" : /^(m|min|mins)$/.test(u) ? "分" : "時間";
    const suf = k === "ago" ? "前" : "経過";
    return `${n}${jpUnit}${suf}`;
  }
  return raw || "未選択";
};

// サウンド ID の強制整形
export function coerceSound(v: any) {
  const id = normalizeSoundId(String(v || ""));
  return id || "none";
}

// モード設定の最低限の整形（欠損値の補完と sound 正規化）
export function sanitizeMode(mode: any) {
  const m = { ...(mode || {}) } as any;
  m.timerName = m.timerName ?? "";
  m.buttonLabel = m.buttonLabel ?? "";
  m.timeMin = Number(m.timeMin ?? 0);
  m.timeSec = Number(m.timeSec ?? 0);
  m.startSound = coerceSound(m.startSound);
  m.endSound = coerceSound(m.endSound);
  m.endLoops = Number(m.endLoops ?? 1);
  m.endLoopSec = Number(m.endLoopSec ?? 1);
  m.nbRows = Array.isArray(m.nbRows) ? m.nbRows.map((r: any) => ({
  notify1: {
    min: Number(r?.notify1?.min ?? 0),
    sec: Number(r?.notify1?.sec ?? 0),
    sound: coerceSound(r?.notify1?.sound ?? ""),
  },
  notify2: {
    min: Number(r?.notify2?.min ?? 0),
    sec: Number(r?.notify2?.sec ?? 0),
    sound: coerceSound(r?.notify2?.sound ?? ""),
  },
  color: r?.color ?? "yellow",
})) : [];
  m.btnRows = Array.isArray(m.btnRows)
    ? m.btnRows.map((r: any) => ({
        n1: {
          min: Number(r?.n1?.min ?? 0),
          sec: Number(r?.n1?.sec ?? 0),
          sound: coerceSound(r?.n1?.sound ?? ""),
        },
        n2: {
          min: Number(r?.n2?.min ?? 0),
          sec: Number(r?.n2?.sec ?? 0),
          sound: coerceSound(r?.n2?.sound ?? ""),
        },
        label: r?.label ?? "",
      }))
    : [];
  return m;
}

/* ========== 共有スタイル/ヘルパ（TimerSettingsModal から移設） ========== */
export const headerBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-start",
  flexWrap: "wrap",
  gap: 8,
  columnGap: 8,
  rowGap: 8,
  alignItems: "center",
  paddingBottom: 8,
  marginBottom: 16,
  borderBottom: "1px solid #eee",
  position: "sticky",
  top: -22,
  marginTop: 0,
  background: "#fff",
  transform: "translateX(-24px)",
  width: "calc(100% + 48px)",
  padding: "12px 24px 8px",
  borderTopLeftRadius: 12,
  borderTopRightRadius: 12,
  zIndex: 300,
  boxSizing: "border-box",
  boxShadow: "0 6px 12px rgba(0,0,0,.08)",
  minHeight: 64,
};
export const headerRight: React.CSSProperties  = { display: "flex", gap: 8, flexShrink: 0, marginLeft: "auto", order: 1 };
export const headerChecks: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap", flexShrink: 0, flexWrap: "wrap", order: 2 };
export const headerCopy: React.CSSProperties   = { display: "flex", alignItems: "center", gap: 6,  flexWrap: "wrap", order: 2 };
export const tabsWrap: React.CSSProperties     = { display: "flex", gap: 8, marginBottom: 16 };
export const TAB_BTN: React.CSSProperties      = { flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #888", fontWeight: 700 };
export const BTN_BASE: React.CSSProperties     = { padding: "6px 12px", borderRadius: 8, border: "none", fontWeight: 700, color: "#fff" };
export const BTN_PRIMARY: React.CSSProperties  = { ...BTN_BASE, background: "#2a7" };
export const BTN_GRAY: React.CSSProperties     = { ...BTN_BASE, background: "#999" };
export const boxPanel: React.CSSProperties     = { border: "1px solid #ccc", borderRadius: 8, padding: 8, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 };
export const rowWrap: React.CSSProperties      = { display: "flex", gap: 6,  alignItems: "center", flexWrap: "wrap", rowGap: 6 };
export const timeRowWrap: React.CSSProperties  = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", rowGap: 8, marginTop: 8 };
export const endRowWrap: React.CSSProperties   = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" };

// ==== TimerCard 用 共通スタイル（行数削減） ====
export const START_LG: React.CSSProperties = { background: "#35a855", color: "#fff", fontSize: "1.4rem", fontWeight: 700, padding: "3px 22px", border: "none", borderRadius: 8 };
export const RESET_LG: React.CSSProperties = { background: "#e53935", color: "#fff", fontSize: "1.4rem", fontWeight: 700, padding: "3px 22px", border: "4px solid #0002", borderRadius: 8 };
export const START_SM: React.CSSProperties = { height: 55, fontSize: "1rem", fontWeight: 800, border: "none", borderRadius: 12, background: "#35a855", color: "#fff" };
export const RESET_SM: React.CSSProperties = { height: 55, fontSize: "1rem", fontWeight: 800, border: "2px solid #0002", borderRadius: 12, background: "#e53935", color: "#fff" };
export const KEYPAD_BTN: React.CSSProperties = { height: 40, padding: 0, fontSize: "1.2rem", fontWeight: 800, border: "2px solid #666", borderRadius: 10, background: "#fff" };
export const KEYPAD_BTN_CLEAR: React.CSSProperties = { height: 40, padding: 0, fontSize: "1rem", fontWeight: 800, border: "2px solid #666", borderRadius: 10, background: "#fff" };
export const KEYPAD_ICON_BTN: React.CSSProperties = { height: 40, padding: 0, border: "2px solid #666", borderRadius: 10, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" };
export const MODE_BTN: React.CSSProperties = { fontSize: "1.1rem", padding: "4px 10px", borderRadius: 8, border: "2px solid #666", minWidth: 36, lineHeight: 1.1 };

// 通知ボタン（n1/n2 などラベル系）の共通スタイル
export const NOTIFY_BTN: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 8,
  border: "1px solid #666",
  background: "#fff",
  fontWeight: 700,
};

// ==== TimerCard 用 ラッパ/ボックス系（さらに行数削減用） ====
export const CARD_STYLE: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 12,
  padding: 12,
};
export const NOTIFY_WRAP: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  rowGap: 6,
};
export const PLACEHOLDER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "#888",
};
export const TIME_TEXT_STYLE: React.CSSProperties = {
  fontFeatureSettings: '"tnum"',
  fontVariantNumeric: "tabular-nums",
  fontSize: "clamp(2rem, 10vw, 5rem)",
  fontWeight: 800,
  lineHeight: 1,
};

// React の <option> 群を返す軽量ヘルパ
export function numberOpts(arr: number[]) {
  return arr.map((n) => (
    <option key={n} value={n}>{n}</option>
  ));
}
export function soundOpts(list: SoundOption[]) {
  return list.map((s) => (
    <option key={s.id} value={s.id}>{s.label}</option>
  ));
}
// セレクト共通 props（今は空だが、将来の aria/autoOpen 用にここで集約）
export function selectPropsFor<T>(_: T[]) {
  return {} as React.SelectHTMLAttributes<HTMLSelectElement>;
}
// 色用 option（TimerSettingsModal でそのまま使えるように）
export const colorOpts = COLORS.map((c) => (
  <option key={c.id} value={c.id}>{c.label}</option>
));
// TimerCard 用（既存の COLORS[] とは別物）
export const TIMER_COLORS = {
  card: "#f1f3f4",
  run: "#e0f2ff",
  attn: "#ffe4b3",
  alert: "#ffd6d6",
  txt: "#1e293b",
  sel: "#bde4ff",
  start: "#35a855",
  reset: "#e53935",
};

export const NB_COLOR_MAP = {
  yellow: "#fff3b0",
  orange: "#ffd8a8",
  green:  "#d3f9d8",
  blue:   "#cfe8ff",
  pink:   "#ffd9e8",
};

// 設定モーダル用の色スウォッチ候補（濃いめの見やすい色）
export const NB_SWATCH_ITEMS = [
  { id: "yellow", label: "黄",  className: "bg-yellow-400" },
  { id: "orange", label: "橙",  className: "bg-orange-400" },
  { id: "green",  label: "緑",  className: "bg-emerald-400" },
  { id: "blue",   label: "青",  className: "bg-sky-400" },
  { id: "pink",   label: "桃",  className: "bg-pink-400" },
]; 

/* ========== 時間アナウンス（名前 → ライブラリ紐づけ） ========== */
// ここに“時間アナウンスの表示名”を貼ってください。
// キーは "before:秒"（例: before:30 = 30秒前）、"elapsed:秒"（例: elapsed:3600 = 1時間経過）。
// 値は AudioLibrary で登録した「音声名」と同一にすると自動で紐づきます。
// 例）"1 minute ago" / "1 minute has passed" など英語でもOK。
export const TIME_NAME_MAP: Record<string, string> = {
  "before:10": "10 seconds ago",
  "before:15": "15 seconds ago",
  "before:20": "20 seconds ago",
  "before:30": "30 seconds ago",
  "before:40": "40 seconds ago",
  "before:45": "45 seconds ago",
  "before:50": "50 seconds ago",
  "before:60": "1 minute ago",          // 1分前
  "elapsed:60": "1 minute has passed",
  "elapsed:120": "2 minutes have passed",
  "elapsed:180": "3 minutes have passed",
  "elapsed:240": "4 minutes have passed",
  "elapsed:300": "5 minutes have passed",
  "elapsed:600": "10 minutes have passed",
  "elapsed:900": "15 minutes have passed",
  "elapsed:1200": "20 minutes have passed",
  "elapsed:1500": "25 minutes have passed",
  "elapsed:1800": "30 minutes have passed",
  "elapsed:2400": "40 minutes have passed",
  "elapsed:2700": "45 minutes have passed",
  "elapsed:3000": "50 minutes have passed",
  "elapsed:3600": "1 hour has passed",  // 1時間経過
};
// ▼ TIME_NAME_MAP のすぐ下あたりに追加
export function slugifyForSound(label: string) {
  let s = String(label || "").trim().toLowerCase();
  // "_" → "-"、連続/混在スペースはまとめて1つのハイフンに
  s = s.replace(/_/g, "-").replace(/\\s+/g, "-");

  // 許容文字以外はすべて "-" へ
  let tmp = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    tmp += /[a-z0-9-]/.test(ch) ? ch : "-";
  }

  // "--" を単一の "-" に収束
  while (tmp.indexOf("--") !== -1) {
    tmp = tmp.split("--").join("-");
  }

  // 先頭・末尾の "-" を削除
  if (tmp.startsWith("-")) tmp = tmp.slice(1);
  if (tmp.endsWith("-")) tmp = tmp.slice(0, -1);
  return tmp;
}

// ▼ TIME_NAME_MAP のすぐ下あたりに追加
export function resolveTimePresetToLibId(raw: string): string {
  // raw: "t:before:30" | "t:elapsed:300"
  if (!raw?.startsWith("t:")) return raw;
  const p = raw.split(":"); // ["t","before","30"]
  if (p.length !== 3) return raw;

  const key = `${p[1]}:${p[2]}`; // "before:30" | "elapsed:300"
  const labelEn = TIME_NAME_MAP[key];
  if (!labelEn) return raw;

  // まずは“内蔵ファイル”のスラグに固定（= public/sounds/<slug>.mp3 を使う方針）
  const slug = slugifyForSound(labelEn);
  return slug;
}
// public/sounds 側の想定ファイル名（ベース名）
export const PUBLIC_BUILTIN_FILE_BASENAME: Record<string, string> = {
  "builtin-beep": "beep",
  "builtin-beep3": "beep3",
  "alarm8": "alarm8",
  "": "silent" // 無音ダミー（実ファイルが無ければ使われません）
};
function isHttpLike(s: string) {
  return /^data:|^blob:|^https?:\/\//.test(s || "");
}

/** 選択ID → 実際の再生URLを解決（内蔵優先） */
export function getSoundUrl(id: string): string {
  let pid = normalizeToPlayableId(id);
  if (!pid) return ""; // 無音

  // 1) 既に URL 形式ならそのまま
  if (isHttpLike(pid)) return pid;

  // 2) ライブラリID一致があれば dataUrl/url を優先
  try {
    const lib = loadAudioLibrary();
    const hit = lib.find((s) => String(s.id) === pid);
    if (hit) {
      const u = hit.dataUrl || hit.url || "";
      if (u) return u;
    }
  } catch {}

  // 3) ビルトイン別名をファイル名ベースに
  if (PUBLIC_BUILTIN_FILE_BASENAME[pid]) {
    pid = PUBLIC_BUILTIN_FILE_BASENAME[pid];
  }

  // 4) 最終的に public/sounds/<slug>.mp3 を指す
  const base = slugifyForSound(pid);
  return `/sounds/${base}.mp3`;
}

// 内部ID（ビルトイン/時間系）→ 再生用IDの正規化
// ここは normalizeSoundId の最後（return raw; の直前あたり）に追加してOK
export function normalizeToPlayableId(id: string) {
  const s = String(id || "").trim();

  // 1) 時間系の "t:..." は英語名→スラグへ（= public/sounds のファイル名ベース）
  if (s.startsWith("t:")) {
    const mapped = resolveTimePresetToLibId(s);
    return mapped;
  }

  // 2) 内蔵ビープ類はファイル名ベースに寄せる
  if (PUBLIC_BUILTIN_FILE_BASENAME[s]) {
    return PUBLIC_BUILTIN_FILE_BASENAME[s];
  }

  // 3) それ以外（カスタムや既にURL/IDが決まってるもの）は原文
  return s;
}
// ▼ 追加：IDから実URLを解決して再生する軽量ヘルパ
export function playSoundById(id: string, volume = 1): Promise<void> {
  return new Promise((resolve) => {
    const src = getSoundUrl(id);
    if (!src) return resolve(); // 無音

    try {
      const audio = new Audio(src);

      audio.volume = Math.max(0, Math.min(1, volume ?? 1));

      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        resolve();
      };

      audio.onended = done;
      audio.onerror = done;

      // 再生開始。エラーは握りつぶし（自動再生制限など）
      void audio.play().then(() => {
        // play開始できた場合、終了は onended/onerror が拾う
      }).catch(() => done());
    } catch {
      resolve();
    }
  });
}
// 時間系サウンド（idは実際の再生キー、labelはUI表示用日本語）
export const TIME_ITEMS: { id: string; label: string }[] = [
  // 秒前
  { id: "10 seconds ago", label: "10秒前" },
  { id: "15 seconds ago", label: "15秒前" },
  { id: "20 seconds ago", label: "20秒前" },
  { id: "30 seconds ago", label: "30秒前" },
  { id: "40 seconds ago", label: "40秒前" },
  { id: "45 seconds ago", label: "45秒前" },
  { id: "50 seconds ago", label: "50秒前" },

  // 分経過（プレイヤーの実キーに合わせて“minute(s) … passed”系）
  { id: "1 minute has passed",  label: "1分経過" },
  { id: "2 minutes have passed", label: "2分経過" },
  { id: "3 minutes have passed", label: "3分経過" },
  { id: "4 minutes have passed", label: "4分経過" },
  { id: "5 minutes have passed", label: "5分経過" },
  { id: "10 minutes have passed", label: "10分経過" },
  { id: "15 minutes have passed", label: "15分経過" },
  { id: "20 minutes have passed", label: "20分経過" },
  { id: "25 minutes have passed", label: "25分経過" },
  { id: "30 minutes have passed", label: "30分経過" },
  { id: "40 minutes have passed", label: "40分経過" },
  { id: "45 minutes have passed", label: "45分経過" },
  { id: "50 minutes have passed", label: "50分経過" },
  { id: "1 hour has passed",     label: "60分経過" },
];

// AudioLibrary（登録済み音源）を LocalStorage から読む
export type SavedSound = { id: string; name: string; volume?: number; builtin?: boolean; dataUrl?: string; url?: string; mime?: string };
export function loadAudioLibrary(): SavedSound[] {
  try {
    const raw = localStorage.getItem("timerBoard_sounds_v1");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// 時間アナウンスの “有効チェック” レジストリ（AudioLibraryModal が書く）
export type Relation = "before" | "elapsed";
export function loadTimeRegistry(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("timer_time_sounds_v1");
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

// チェック済み + ライブラリに存在するものだけを option にする
export function buildTimeAnnounceOptions() {
  const reg = loadTimeRegistry();
  const lib = loadAudioLibrary();
  const opts: { id: string; label: string }[] = [];
  for (const k in reg) {
    if (!reg[k]) continue; // チェックされていない
    const label = TIME_NAME_MAP[k];
    if (!label) continue; // 名前未設定 → 非表示
    const hit = lib.find((s) => (s.name || "").trim() === label.trim());
    if (hit) opts.push({ id: hit.id, label });
  }
  return opts;
}

/* ========== 小フック ========== */
export function useNotifyRowsCache(key = "timer_notify_rows_v1") {
  const [rows, setRows] = useState<number[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      return Array.isArray(v) ? v : [0, 1, 2, 3];
    } catch {
      return [0, 1, 2, 3];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(rows));
    } catch {}
  }, [rows, key]);
  return { rows, setRows };
}

export function useSoundOptions(all: SoundOption[], { excludeIds = [] as string[] } = {}) {
  const set = new Set(excludeIds);
  return useMemo(() => all.filter((s) => !set.has(s.id)), [all, excludeIds.join("|")]);
}

// 長押し判定（発火: onLongPress、短押し: onClick）。副作用なし。
export function useLongPress(
  onLongPress: () => void,
  opts: { ms?: number; onClick?: (e: any) => void } = {}
) {
  const { ms = 500, onClick } = opts;
  const timerRef = useRef<number | null>(null);

  const clear = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = (_e: any) => {
    clear();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onLongPress();
    }, ms);
  };

  const end = (e: any) => {
    if (timerRef.current != null) {
      clear();
      onClick?.(e);
    }
  };

  return {
    onMouseDown: start,
    onMouseUp: end,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: end,
    onTouchCancel: clear,
  } as const;
}

/* ========== UI プリミティブ ========== */
type StickyHeaderProps = { title: React.ReactNode; right?: React.ReactNode };
export function StickyHeader({ title, right }: StickyHeaderProps) {
  return (
    <div className={TOKENS.header}>
      <div className={TOKENS.headerInner}>
        <div className="text-lg font-bold">{title}</div>
        <div className="flex items-center gap-2">{right}</div>
      </div>
    </div>
  );
}

type FooterBarProps = { children: React.ReactNode };
export function FooterBar({ children }: FooterBarProps) {
  return (
    <div className={TOKENS.footer}>
      <div className={TOKENS.footerInner}>{children}</div>
    </div>
  );
}

/* ========== Field ラッパ ========== */
type FieldBaseProps = { label: React.ReactNode; children: React.ReactNode };
export function Field({ label, children }: FieldBaseProps) {
  return (
    <div className={TOKENS.fieldRow}>
      <label className="text-sm font-medium">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type SelectFieldProps = {
  label: React.ReactNode;
  value: string | number;
  onChange: (v: string) => void;
  options: { value: string | number; label: string }[];
};
export function SelectField({ label, value, onChange, options }: SelectFieldProps) {
  return (
    <Field label={label}>
      <select
        className={TOKENS.input + " w-full"}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ========== Color Swatch Field（文字なし・色のみ表示） ========== */
// TimerSettingsModal の色選択用。プルダウンの代わりに色見本（スウォッチ）を並べます。
// アクセシビリティ対応として radiogroup/radio を付与。
// 使い方例：
//   <ColorSwatchField label="背景色" value={color} onChange={setColor} />
//   // value は COLORS の id（"default" | "amber" | "blue" | "green" | "pink"）

type ColorItem = { id: string; label: string; className: string };

export function ColorSwatchField({
  label,
  value,
  onChange,
  items = COLORS,
}: {
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  items?: ColorItem[];
}) {
  return (
    <Field label={label}>
      <div
        role="radiogroup"
        aria-label={typeof label === "string" ? label : undefined}
        className="flex flex-wrap gap-2 items-center"
      >
        {items.map((c) => {
          const active = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={c.label}
              title={c.label}
              onClick={() => onChange(c.id)}
              data-active={active}
              className={
                [
                  "w-7 h-7 rounded-md border transition outline-none",
                  c.className,
                  active ? "ring-2 ring-black" : "ring-1 ring-transparent hover:ring-1 hover:ring-gray-400",
                ].join(" ")
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(c.id);
                }
              }}
            />
          );
        })}
      </div>
    </Field>
  );
}

type NumberFieldProps = {
  label: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
};
export function NumberField({ label, value, onChange, min = 0, max = 9999, step = 1 }: NumberFieldProps) {
  return (
    <Field label={label}>
      <input
        type="number"
        className={TOKENS.input + " w-28 text-right tabular-nums"}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

type ToggleFieldProps = { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void };
export function ToggleField({ label, checked, onChange }: ToggleFieldProps) {
  return (
    <Field label={label}>
      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-black"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{checked ? "ON" : "OFF"}</span>
      </label>
    </Field>
  );
}
// 事前登録の時間系（23個）を常に候補として出す
export function buildAllTimePresetOptions() {
  const out: { id: string; label: string }[] = [];
  for (const [k, label] of Object.entries(TIME_NAME_MAP)) {
    // id は t:prefix で固定（例：t:before:30, t:elapsed:300）
    out.push({ id: `t:${k}`, label });
  }
  return out;
}
