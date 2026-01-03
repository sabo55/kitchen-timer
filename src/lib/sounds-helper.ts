// src/utils/sounds-helper.ts
// JSXは使わないので拡張子は .ts 推奨（.tsxは不要）

/* ========= 型 ========= */
export type SoundOption = { id: string; label: string };
export type SavedSound = {
  id: string;
  name: string;
  volume?: number;
  builtin?: boolean;
  dataUrl?: string;
  url?: string;
  mime?: string;
};

/* ========= 内蔵（固定） ========= */
export const SILENT_OPTION: SoundOption = { id: "", label: "（無音）" };
export const BUILTIN_SOUND_OPTIONS: SoundOption[] = [
  { id: "builtin-beep", label: "ピッ" },
  { id: "builtin-beep3", label: "ピピピッ" },
  { id: "alarm8", label: "ピピピッ（ループ）" },
];

// public/sounds の実ファイル名（拡張子を除いたベース名）
export const PUBLIC_BUILTIN_FILE_BASENAME: Record<string, string> = {
  "builtin-beep": "beep",
  "builtin-beep3": "beep3",
  "alarm8": "alarm8",
  "": "silent", // 無音（ダミー）
};

/* ========= 時間アナウンス候補（日本語表記） ========= */
// 必要があればここを並び替え・追記してください
export const TIME_ITEMS: SoundOption[] = [
  // 秒前
  { id: "t:before:10", label: "10秒前" },
  { id: "t:before:15", label: "15秒前" },
  { id: "t:before:20", label: "20秒前" },
  { id: "t:before:30", label: "30秒前" },
  { id: "t:before:40", label: "40秒前" },
  { id: "t:before:45", label: "45秒前" },
  { id: "t:before:50", label: "50秒前" },
  { id: "t:before:60", label: "1分前" },
  // 分経過
  { id: "t:elapsed:300", label: "5分経過" },
  { id: "t:elapsed:600", label: "10分経過" },
  { id: "t:elapsed:900", label: "15分経過" },
  { id: "t:elapsed:1200", label: "20分経過" },
  { id: "t:elapsed:1500", label: "25分経過" },
  { id: "t:elapsed:1800", label: "30分経過" },
  { id: "t:elapsed:2400", label: "40分経過" },
  { id: "t:elapsed:2700", label: "45分経過" },
  { id: "t:elapsed:3000", label: "50分経過" },
  { id: "t:elapsed:3600", label: "1時間経過" },
];

/* ========= 文字列ユーティリティ ========= */
export function slugifyForSound(label: string) {
  let s = String(label || "").trim().toLowerCase();
  s = s.replace(/_/g, "-").replace(/\s+/g, "-"); // replaceAllは使わない
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    out += /[a-z0-9-]/.test(ch) ? ch : "-";
  }
  while (out.indexOf("--") !== -1) out = out.split("--").join("-");
  if (out.charAt(0) === "-") out = out.slice(1);
  if (out.endsWith("-")) out = out.slice(0, -1);
  return out;
}

/* ========= LocalStorage 読み書き ========= */
export function loadAudioLibrary(): SavedSound[] {
  try {
    const raw = localStorage.getItem("timerBoard_sounds_v1");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function loadTimeRegistry(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("timer_time_sounds_v1");
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

/* ========= ID 正規化・URL解決 ========= */
export function normalizeSoundId(v: any): string {
  const raw = String((v && (v.id ?? v.value ?? v.label)) ?? v ?? "").trim();
  if (!raw) return "";
  const s = raw.toLowerCase();
  if (s === "none" || s === "silent") return "";
  if (s === "alarm" || s === "builtin-beep3") return "builtin-beep3";
  if (s === "beep" || s === "builtin-beep") return "builtin-beep";
  if (s === "alarm8" || s === "builtin-alarm8") return "alarm8";
  return raw;
}

export function normalizeToPlayableId(id: string) {
  const s = String(id || "").trim();
  if (s.startsWith("t:")) {
    // "t:before:30" → public/sounds/<slug>.mp3 を想定
    const [, rel, sec] = s.split(":");
    const label = rel === "before" ? `${Number(sec)} seconds ago` : `${Math.round(Number(sec)/60)} minutes have passed`;
    return slugifyForSound(label);
  }
  if (PUBLIC_BUILTIN_FILE_BASENAME[s]) return PUBLIC_BUILTIN_FILE_BASENAME[s];
  return s;
}

export function getSoundUrl(id: string): string {
  let pid = normalizeToPlayableId(id);
  if (!pid) return ""; // 無音
  if (/^data:|^blob:|^https?:\/\//.test(pid)) return pid;
  // ライブラリ優先
  try {
    const lib = loadAudioLibrary();
    const hit = lib.find((s) => String(s.id) === pid);
    const u = hit?.dataUrl || hit?.url;
    if (u) return u;
  } catch {}
  // public/sounds 最終解決
  pid = PUBLIC_BUILTIN_FILE_BASENAME[pid] || pid;
  const base = slugifyForSound(pid);
  return `/sounds/${base}.mp3`;
}

/* ========= 一覧生成（ラジオ用） ========= */
function uniqById(list: SoundOption[]): SoundOption[] {
  const seen = new Set<string>();
  const out: SoundOption[] = [];
  for (const it of list) {
    const id = String(it?.id ?? "");
    if (!id && it.id !== "") continue; // 無音だけは残したいので特別扱い
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: String(it?.label ?? id) });
  }
  return out;
}

export function buildRadioSoundList(opts: {
  withBuiltins?: boolean;
  withTimes?: boolean;
  withCustom?: boolean;
  withSilent?: boolean;
  exclude?: string[];
} = {}): SoundOption[] {
  const {
    withBuiltins = true,
    withTimes = false,
    withCustom = true,
    withSilent = true,
    exclude = [],
  } = opts;

  const ex = new Set<string>(exclude.map((v) => normalizeSoundId(v)));
  const list: SoundOption[] = [];
  if (withSilent) list.push(SILENT_OPTION);
  if (withBuiltins) list.push(...BUILTIN_SOUND_OPTIONS);
  if (withTimes) list.push(...TIME_ITEMS);
  if (withCustom) {
    try {
      const lib = loadAudioLibrary();
      for (const s of lib) {
        const id = normalizeSoundId(s.id);
        if (ex.has(id)) continue;
        list.push({ id, label: s.name || id });
      }
    } catch {}
  }
  const filtered = list.filter((o) => !ex.has(normalizeSoundId(o.id)));
  return uniqById(filtered);
}

/* ========= ラベル（表示名） ========= */
export function toJPLabel(raw: string) {
  const fixed: Record<string, string> = {
    "": "無音",
    "builtin-beep": "ピッ",
    "builtin-beep3": "ピピピッ",
    "alarm8": "ピピピッ（ループ）",
  };
  if (fixed[raw]) return fixed[raw];
  // TIME_ITEMS に一致すればその日本語ラベル
  const t = TIME_ITEMS.find((t) => t.id === raw);
  if (t) return t.label;
  return raw || "未選択";
}
