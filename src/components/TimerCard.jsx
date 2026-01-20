// TimerCard.jsx – compacting pass 1

import React, { useState, useRef, useEffect } from "react";
import {
  START_LG, RESET_LG, START_SM, RESET_SM,
  KEYPAD_BTN, KEYPAD_BTN_CLEAR, KEYPAD_ICON_BTN,
  MODE_BTN, secToMMSS, NOTIFY_BTN,
  TIMER_COLORS as COLORS, NB_COLOR_MAP,
  useLongPress, extractId, normalizeSoundId,
  soundKey, sameId, coerceSound, sanitizeMode,
  loopSeconds, isDefaultLikeName, 
} from "./helpers";

const TimerSettingsModal = React.lazy(() => import("./TimerSettingsModal"));
import { createPortal } from "react-dom";


const VOLUME = 0.85;
// GitHub Pages（/repo-name/ 配下）でも dev（/）でも同じ書き方で動くようにする
const BASE_URL = (import.meta && import.meta.env && import.meta.env.BASE_URL) ? import.meta.env.BASE_URL : "/";
const withBase = (p) => `${BASE_URL}${String(p).replace(/^\/+/, "")}`;
// 個別音量（AudioLibraryModal由来）を反映する補助
const getVolFor = (rawId) => {
  try {
    const s = normalizeSoundId(rawId || "");
    if (!s) return 1;
    const list = JSON.parse(localStorage.getItem("timerBoard_sounds_v1") || "[]");
    const rec = Array.isArray(list) ? list.find((x) => sameId(soundKey(x), s)) : null;

    const v = Number(rec?.volume);
    if (Number.isFinite(v)) return Math.min(1, Math.max(0, v / 100));
  } catch {}
  return 1;
};
// ビルトイン音（ライブラリ検索を回避）
const BUILTINS = new Set(["builtin-beep", "builtin-beep3", "alarm8"]);

const emptyMode = (idx) => ({
  timerName: `タイマー${idx + 1}`,
  buttonLabel: "",
  timeMin: 0,
  timeSec: 0,
  startSound: "alarm",
  endSound: "alarm8",
  endLoops: 1,
  endLoopSec: 10,
  nbRows: [],
  btnRows: null,
  hidden: false,
});
const defaultConfig = { modes: [emptyMode(0), emptyMode(1), emptyMode(2)], resetSec: 15, returnMode: "last", cardHidden: false, tenKey: { enabled: false, keepLast: true, lastSec: 0 } };

export default function TimerCard({ index = 0, storageId = null, disableLongPress = false }) {
    const sid = (storageId ?? index);
  const storageKey = `timerConfig_card_${sid}`;
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try { return JSON.parse(saved); } catch {}
      }
      if (sid === 0) {
        const legacy = localStorage.getItem("timerConfig");
        if (legacy) { try { localStorage.setItem(storageKey, legacy); return JSON.parse(legacy); } catch {} }
      }
    } catch {}
    return defaultConfig;
  });

  // sanitize persisted config (coerce sound fields from objects/labels to stable string ids)
  useEffect(() => {
    try {
      const fixed = { ...config, modes: (config.modes || []).map(sanitizeMode) };
      if (JSON.stringify(fixed) !== JSON.stringify(config)) {
        setConfig(fixed);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.modes)]);
  const lastModeKey = `timer_lastModeIdx_${sid}`;
  const initialModeIdx = (() => {
    const rm = config.returnMode;
    if (rm === "last") {
      const v = Number(localStorage.getItem(lastModeKey));
      return Number.isInteger(v) && v >= 0 && v < config.modes.length ? v : 0;
    }
    const i = "ABC".indexOf(rm);
    return i >= 0 ? i : 0;
  })();
  const [modeIdx, setModeIdx] = useState(initialModeIdx);
  const cardHidden = !!config.cardHidden;
  const modalRoot =
  (typeof document !== "undefined" &&
    (document.getElementById("modal-root") || document.body)) || null;

  // --- state moved up to avoid 'running' before initialization ---

  // audio library: TimerBoard が保存している localStorage を参照（なければ空配列）

    const [showSettings, setShowSettings] = useState(false);

  const modeCfg = (config && Array.isArray(config.modes) && config.modes[modeIdx]) ? config.modes[modeIdx] : defaultConfig.modes[0];
  const displayName = (() => {
    const raw = modeCfg.timerName || "";
    if (isDefaultLikeName(raw)) return `タイマー${index + 1}`;
    return raw;
  })();

  // --- Ten-key mode config & input buffer ---
  const tenKeyCfg = (config.tenKey || { enabled: false, keepLast: true, lastSec: 0 });
  const [keyBuf, setKeyBuf] = useState("");
  const bufToSec = (buf) => {
    const s = String(buf).replace(/\D/g, "").slice(-4);
    const mm = Number(s.slice(0, -2) || 0);
    const ss = Number(s.slice(-2) || 0);
    return Math.min(59, ss) + Math.min(599, mm) * 60;
  };
  const pushDigit = (d) => { if (!running && !finished) setKeyBuf((b) => (String(b) + d).slice(-4)); };
  const clearBuf = () => {
    if (running || finished) return;
    // 入力バッファと保持時間（lastSec）をどちらもクリア
    setKeyBuf("");
    setConfig((c) => ({ ...c, tenKey: { ...(c.tenKey || {}), lastSec: 0 } }));
    setSec(0);
  };
  // 長押しで「最後に使った時間」も消去
  const clearLastSec = () => {
    if (running || finished) return;
    setConfig((c) => ({ ...c, tenKey: { ...(c.tenKey || {}), lastSec: 0 } }));
    setKeyBuf("");
    setSec(0);
  };

    const visibleModes = config.modes.map((m, i) => ({ ...m, originalIndex: i })).filter((m) => m.buttonLabel && m.buttonLabel.trim());
  const hasButtons = visibleModes.length >= 2;

    useEffect(() => localStorage.setItem(storageKey, JSON.stringify(config)), [config, storageKey]);
  // persist last selected mode index per card
  useEffect(() => { try { localStorage.setItem(lastModeKey, String(modeIdx)); } catch {} }, [modeIdx, lastModeKey]);

    const playingRef = useRef([]);
  // 終了シーケンス（ピピピッ→第2音声→alarm8戻し）を途中で止められるようにするキャンセル用トークン
  const stopSeqTokenRef = useRef(0);
  const stopLoopTRef = useRef(null);
  const loopDeadlineRef = useRef(null);
  const loopWatchRef = useRef(null);

  // Web Audio (gapless) 用
  const audioCtxRef = useRef(null);
  const alarmBufRef = useRef(null);
  const beepBufRef = useRef(null);
  const beep3BufRef = useRef(null);
  const soundBufCacheRef = useRef(new Map());
  const gaplessSrcsRef = useRef([]);

  const loadAudioLib = () => { try { return JSON.parse(localStorage.getItem("timerBoard_sounds_v1") || "[]"); } catch { return []; } };

    useEffect(() => {
    try {
      if (index !== 0) return; // 1カードだけが担当
      const FLAG = "timerSounds_migrated_v2";
      if (localStorage.getItem(FLAG)) return;
      const list = loadAudioLib() || [];
      if (!Array.isArray(list) || !list.length) { localStorage.setItem(FLAG, "1"); return; }
      const updated = list.map((s) => {
        if (s && typeof s.fileUrl === "string" && s.fileUrl.startsWith("blob:")) {
          // 失効しがちな blob は触らずに無効化（fetch しない）
          const { fileUrl, url, ...rest } = s;
          return { ...rest, broken: true };
        }
        return s;
      });
      localStorage.setItem("timerBoard_sounds_v1", JSON.stringify(updated));
      localStorage.setItem(FLAG, "1");
    } catch {}
  }, [index]);

  const getAudio = (id) => {
    const s = extractId(id).trim();
    if (!s || s === "none") return null;           // 無音指定
    if (BUILTINS.has(s)) return null;               // ビルトインは HTMLAudio で扱わない
    if (s.startsWith("blob:")) return null;        // 失効しがちな blob は使わない

    const list = loadAudioLib() || [];
    const rec = list.find(
  (x) => x && typeof x.id === "string" && x.id.trim().toLowerCase() === s.toLowerCase()
);
    if (!rec) return null;

    // 1) data:URL（最優先）
    const dataUrl = rec.dataUrl || (typeof rec.fileUrl === "string" && rec.fileUrl.startsWith("data:") && rec.fileUrl);
    if (dataUrl) {
      const a = document.createElement("audio"); a.preload = "auto"; a.volume = VOLUME * getVolFor(id);
      const src = document.createElement("source"); src.src = dataUrl; src.type = rec.mime || "audio/mpeg"; a.appendChild(src);
      return a;
    }

    // 2) base64 を Blob 化
    if (rec.base64) {
      try {
        const bin = atob(rec.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: rec.mime || "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("audio"); a.preload = "auto"; a.volume = VOLUME * getVolFor(id); a.dataset.tempUrl = url;
        const src = document.createElement("source"); src.src = url; src.type = rec.mime || "audio/mpeg"; a.appendChild(src);
        return a;
      } catch {}
    }

    // 3) 直接URL（http/https のみ）
    const direct = rec.url || rec.fileUrl;
    if (direct && typeof direct === "string" && !direct.startsWith("blob:")) {
      const a = document.createElement("audio"); a.preload = "auto"; a.volume = VOLUME * getVolFor(id);
      const src = document.createElement("source"); src.src = direct; src.type = rec.mime || "audio/mpeg"; a.appendChild(src);
      return a;
    }

    // 4) 壊れている印（旧データ）→ フォールバック
    if (rec.broken) {
      const a = document.createElement("audio");
      a.preload = "auto";
      a.volume = VOLUME * getVolFor(id);
      // iPad 安定優先：wav → mp3
      const wav = document.createElement("source");
      wav.src = withBase(`sounds/alarm.wav?id=${Date.now()}`);
      wav.type = "audio/wav";
      a.appendChild(wav);
      const mp3 = document.createElement("source");
      mp3.src = withBase(`sounds/alarm.mp3?id=${Date.now()}`);
      mp3.type = "audio/mpeg";
      a.appendChild(mp3);
      return a;
    }

    // 何も再生できない
    return null;
  };
  const ensureAudioCtx = async () => {
    const Ctx = (typeof window !== "undefined" && (window.AudioContext || window['webkitAudioContext'])) || null; if (!Ctx) return null;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    if (audioCtxRef.current.state === "suspended") { try { await audioCtxRef.current.resume(); } catch {} }
    return audioCtxRef.current;
  };
  const loadAlarmBuffer = async () => {
    if (alarmBufRef.current) return alarmBufRef.current;
    const ctx = await ensureAudioCtx();
    if (!ctx) return null;

    const fetchBuf = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch fail: ${r.status}`);
      const ab = await r.arrayBuffer();
      return await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    };

    // iPad 安定優先：wav → mp3 の順で読む
    try {
      alarmBufRef.current = await fetchBuf(withBase(`sounds/alarm8.wav?id=${Date.now()}`));
    } catch {
      try {
        alarmBufRef.current = await fetchBuf(withBase(`sounds/alarm8.mp3?id=${Date.now()}`));
      } catch {}
    }

    return alarmBufRef.current;
  };

  const loadBeepBuffer = async () => {
    if (beepBufRef.current) return beepBufRef.current;
    const ctx = await ensureAudioCtx();
    if (!ctx) return null;

    // iPad運用版：ファイル(beep.mp3等)は使わず、内蔵シンセで必ず生成して返す
    const sr = ctx.sampleRate;
    const dur = 0.12;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    const freq = 1000; // 1kHz の“ピッ”
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
      ch[i] = Math.sin(2 * Math.PI * freq * t) * w;
    }
    beepBufRef.current = buf;
    return beepBufRef.current;
  };

  const loadBeep3Buffer = async () => {
    if (beep3BufRef.current) return beep3BufRef.current;
    const ctx = await ensureAudioCtx();
    if (!ctx) return null;

    const fetchBuf = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch fail: ${r.status}`);
      const ab = await r.arrayBuffer();
      return await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    };

    // まず wav → ダメなら mp3（GitHub Pages / iPad 安定優先）
    try {
      beep3BufRef.current = await fetchBuf(withBase(`sounds/beep3.wav?id=${Date.now()}`));
      return beep3BufRef.current;
    } catch {
      try {
        beep3BufRef.current = await fetchBuf(withBase(`sounds/beep3.mp3?id=${Date.now()}`));
        return beep3BufRef.current;
      } catch {
        beep3BufRef.current = null;
        return null;
      }
    }
  };

  const playBuiltinOneShot = async (id) => {
    const ctx = await ensureAudioCtx();
    if (!ctx) return false;

    // iPad運用版：ファイル再生で統一（WebAudio decode を避ける）
    // alarm/alarm8 と、起動時のピッ（builtin-beep）は /sounds 音源へ寄せる
    // ただし「挟み込み前の短いピピピ（builtin-beep3）」は WebAudio(one‑shot) で鳴らす（iPadの無音化回避）
    if (id === "alarm" || id === "alarm8" || id === "builtin-beep") return false;

    const vol = VOLUME * getVolFor(id);
    const playBufOnce = (buf, when = ctx.currentTime) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      g.connect(ctx.destination);
      try { src.start(when); } catch {}
    };

    if (id === "builtin-beep3") {
      // まずは beep3 ファイルをそのまま鳴らす（「4回→3回」などに崩れないように）
      const buf3 = await loadBeep3Buffer();
      if (buf3) {
        playBufOnce(buf3);
        return true;
      }

      // beep3 が無い環境向け：単発 beep を4回スケジュールして代替（テンポも“速め”に寄せる）
      const buf1 = await loadBeepBuffer();
      if (!buf1) return false;
      const now = ctx.currentTime;
      const step = 0.11; // 110ms 間隔（体感「いつものピピピ」寄り）
      playBufOnce(buf1, now + step * 0);
      playBufOnce(buf1, now + step * 1);
      playBufOnce(buf1, now + step * 2);
      playBufOnce(buf1, now + step * 3);
      return true;
    }

    // builtin-beep（単発）
    const buf = await loadBeepBuffer();
    if (!buf) return false;
    playBufOnce(buf);
    return true;
  };

  // WebAudioが使えない/失敗した場合にHTMLAudioでフォールバック再生
  const playBuiltin = async (id) => {
    // まず WebAudio one‑shot（beep / beep3 のみ。alarm/alarm8 はここでは扱わない）
    if (await playBuiltinOneShot(id)) return true;

    // HTMLAudio フォールバック（※タップ/リセットで止められるよう playingRef で追跡する）
    const a = document.createElement("audio");
    a.preload = "auto";
    a.loop = false;
    a.volume = VOLUME * getVolFor(id);

    // 起動時のピッ／ピピピも、あなたが用意した /sounds 音源で鳴らす
    const mappedId = (id === "builtin-beep") ? "alarm" : (id === "builtin-beep3") ? "beep3" : id;

    // alarm / alarm8 は wav → mp3 の順（iPad安定優先）
    const fileId = mappedId === "alarm8" ? "alarm8" : mappedId === "beep3" ? "beep3" : "alarm";
    const wav = document.createElement("source");
    wav.src = withBase(`sounds/${fileId}.wav?id=${Date.now()}`);
    wav.type = "audio/wav";
    a.appendChild(wav);
    const mp3 = document.createElement("source");
    mp3.src = withBase(`sounds/${fileId}.mp3?id=${Date.now()}`);
    mp3.type = "audio/mpeg";
    a.appendChild(mp3);

    // 追跡しておく（cleanAllAudio() で確実に止める）
    playingRef.current.push(a);
    a.onended = () => {
      playingRef.current = playingRef.current.filter((x) => x !== a);
    };

    try {
      await a.play();
      return true;
    } catch {
      playingRef.current = playingRef.current.filter((x) => x !== a);
    }

    return false;
  };

  // 共通: ID から音を鳴らす（無音/ビルトイン/ライブラリ/フォールバックを吸収）
  const playById = async (rawId) => {
    try {
      const id = normalizeSoundId(rawId || "");
      if (!id || id === "none") return; // 無音
      if (BUILTINS.has(id)) {
        await playBuiltin(id);
        return;
      }
      const a = getAudio(id);
      if (a) {
        a.volume = VOLUME * getVolFor(id);
        a.currentTime = 0;
        playingRef.current.push(a);
        a.play().catch(() => {});
        a.onended = () => {
          playingRef.current = playingRef.current.filter((x) => x !== a);
          if (a.dataset && a.dataset.tempUrl) {
            try {
              URL.revokeObjectURL(a.dataset.tempUrl);
            } catch {}
          }
        };
        return;
      }
      await playBuiltin("alarm");
    } catch {
      // ここで握りつぶして「Uncaught (in promise)」を防ぐ
    }
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 指定ミリ秒だけ音声を鳴らして止める（alarm8 ループに重ならないようにするため）
  const playByIdForDuration = async (rawId, ms) => {
    const id = normalizeSoundId(rawId || "");
    if (!id || id === "none") {
      await sleep(ms);
      return;
    }

    // ビルトイン（alarm8 はここでは扱わない）
    if (BUILTINS.has(id)) {
      if (id !== "alarm8") {
        await playBuiltin(id);
        await sleep(ms);
      }
      return;
    }

    // --- まず WebAudio（iPad Safari で HTMLAudio がミュート/拒否されるのを回避）---
    try {
      const ctx = await ensureAudioCtx();
      if (ctx) {
        const cache = soundBufCacheRef.current;
        let buf = cache.get(id);

        if (!buf && !cache.has(id)) {
          const list = loadAudioLib() || [];
          const rec = Array.isArray(list)
            ? list.find((x) => x && typeof x.id === "string" && x.id.trim().toLowerCase() === id.toLowerCase())
            : null;

          const toArrayBuffer = async () => {
            if (!rec) return null;

            // 1) data:URL
            const dataUrl = rec.dataUrl || (typeof rec.fileUrl === "string" && rec.fileUrl.startsWith("data:") && rec.fileUrl);
            if (dataUrl) {
              const r = await fetch(dataUrl);
              if (!r.ok) return null;
              return await r.arrayBuffer();
            }

            // 2) base64
            if (rec.base64) {
              const bin = atob(rec.base64);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return bytes.buffer;
            }

            // 3) URL
            let direct = rec.url || rec.fileUrl;
            if (direct && typeof direct === "string" && !direct.startsWith("blob:")) {
              // GitHub Pages（/repo/）でも動くように、同一オリジン相対は base を付ける
              if (direct.startsWith("/")) direct = withBase(direct);
              else if (!/^https?:|data:|blob:/i.test(direct)) direct = withBase(direct);

              const r = await fetch(direct);
              if (!r.ok) return null;
              return await r.arrayBuffer();
            }

            // 4) broken は WebAudio では触らない（後段の HTMLAudio 側に任せる）
            return null;
          };

          const ab = await toArrayBuffer();
          if (ab) {
            try {
              buf = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
            } catch {
              buf = null;
            }
          } else {
            buf = null;
          }
          cache.set(id, buf);
        }

        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const g = ctx.createGain();
          g.gain.value = VOLUME * getVolFor(id);
          src.connect(g);
          g.connect(ctx.destination);
          try { src.start(0); } catch {}
          await sleep(ms);
          try { src.stop(0); } catch {}
          return;
        }
      }
    } catch {
      // WebAudio で失敗したら HTMLAudio に落とす
    }

    // --- HTMLAudio フォールバック ---
    const a = getAudio(id);
    if (!a) {
      await sleep(ms);
      return;
    }

    a.volume = VOLUME * getVolFor(id);
    try { a.currentTime = 0; } catch {}

    playingRef.current.push(a);
    try { await a.play(); } catch {}

    await sleep(ms);

    try {
      a.pause();
      a.currentTime = 0;
    } catch {}

    playingRef.current = playingRef.current.filter((x) => x !== a);
    if (a.dataset && a.dataset.tempUrl) {
      try { URL.revokeObjectURL(a.dataset.tempUrl); } catch {}
      }
     };

const playGaplessAlarm  = async (fadeMs = 0) => {
    try {
      const ctx = await ensureAudioCtx();
      if (!ctx) return false;
      const buf = await loadAlarmBuffer();
      if (!buf) return false;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const g = ctx.createGain();
      const target = VOLUME * getVolFor("alarm8");

      // フェードイン（重なっても聞こえやすい）
      if (fadeMs && fadeMs > 0) {
        try {
          g.gain.setValueAtTime(0, ctx.currentTime);
          g.gain.linearRampToValueAtTime(target, ctx.currentTime + fadeMs / 1000);
        } catch {
          g.gain.value = target;
        }
      } else {
        g.gain.value = target;
      }

      src.connect(g);
      g.connect(ctx.destination);

      try {
        src.start(0);
      } catch {}
      gaplessSrcsRef.current.push(src);
      return true;
    } catch {
      return false;
    }
  };
  const stopGaplessAlarm = () => { const list = gaplessSrcsRef.current; if (list && list.length) { list.forEach((src) => { try { src.stop(0); } catch {} }); gaplessSrcsRef.current = []; } };

  const cleanAllAudio = () => {
    // 進行中の終了シーケンスをキャンセル
    stopSeqTokenRef.current += 1;
    playingRef.current.forEach((s) => { s.loop = false; s.pause(); s.currentTime = 0; }); playingRef.current = [];
    stopGaplessAlarm();
    if (stopLoopTRef.current) { clearTimeout(stopLoopTRef.current); stopLoopTRef.current = null; }
    loopDeadlineRef.current = null; if (loopWatchRef.current) { clearInterval(loopWatchRef.current); loopWatchRef.current = null; }
  };

    const [sec, setSec] = useState(modeCfg.timeMin * 60 + modeCfg.timeSec);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(null);
  const [blink, setBlink] = useState(false);

  // Hooks の順序が変わらないように、useLongPress は state 定義の後に作る
  const _lp = useLongPress(() => { if (!running) setShowSettings(true); }, 1000);
  // 実行中は設定モーダルを開かない（長押し無効化）
  const longPressHandlers = (disableLongPress || running) ? {} : _lp;

  // 通知 & 背景色 / 通知ボタン
  const notifiedRef = useRef(new Set());
  const activeBgRef = useRef(null);
  const [btnOn, setBtnOn] = useState(() => new Set());
  const btnFiredRef = useRef(new Map()); // idx -> Set(tag)
  const prevModeRef = useRef(modeIdx);

    useEffect(() => { if (!running && !finished) { setSec(config.modes[modeIdx].timeMin * 60 + config.modes[modeIdx].timeSec); } }, [config.modes, modeIdx, running, finished]);

  // Ten-key: idle sync from buffer/lastSec
  useEffect(() => {
    if (!tenKeyCfg.enabled) return;
    if (!running && !finished) {
      const target = keyBuf ? bufToSec(keyBuf) : (tenKeyCfg.keepLast ? (tenKeyCfg.lastSec || 0) : 0);
      setSec(target);
    }
  }, [tenKeyCfg.enabled, tenKeyCfg.keepLast, tenKeyCfg.lastSec, keyBuf, running, finished]);

  // 設定保存後など returnMode が変更されたら、そのモードに切り替える（常に同じ初期画面に）
  useEffect(() => {
    if (running) return;
    const rm = config.returnMode;
    let target = 0;
    if (rm === "last") {
      const v = Number(localStorage.getItem(lastModeKey));
      target = Number.isInteger(v) && v >= 0 && v < config.modes.length ? v : 0;
    } else {
      const i = "ABC".indexOf(rm);
      target = i >= 0 ? i : 0;
    }
    if (target !== modeIdx) {
      setModeIdx(target);
      const m = config.modes[target];
      setSec(m.timeMin * 60 + m.timeSec);
    }
  }, [config.returnMode]);

    const chooseMode = (idx) => { if (running) return; prevModeRef.current = modeIdx; setModeIdx(idx); try { localStorage.setItem(lastModeKey, String(idx)); } catch {} const m = config.modes[idx]; setSec(m.timeMin * 60 + m.timeSec); };

  const reset = () => {
    const wasFinished = !!finished;
    cleanAllAudio();
    // 通知ボタンOFF & 記録クリア
    setBtnOn(new Set());
    btnFiredRef.current = new Map();
    notifiedRef.current = new Set(); activeBgRef.current = null;

    // 終了後のリセットなら returnMode を適用
    let targetMode = modeIdx;
    if (wasFinished) {
      const rm = config.returnMode;
      if (rm === "last") { if (Number.isInteger(prevModeRef.current)) targetMode = prevModeRef.current; }
      else { const idx = "ABC".indexOf(rm); if (idx >= 0 && idx < config.modes.length) targetMode = idx; }
    }
    setModeIdx(targetMode); try { localStorage.setItem(lastModeKey, String(targetMode)); } catch {} const m = config.modes[targetMode]; setSec(m.timeMin * 60 + m.timeSec);
    setRunning(false); setFinished(null);
  };
  const longReset = useLongPress(reset, { ms: 1000 });
  const clearMemLP = useLongPress(clearLastSec, { ms: 800 });
  const tenKeyResetLP = useLongPress(() => { if (tenKeyCfg.enabled) clearLastSec(); }, { ms: 1000 });

  const start = () => {
    if (running) return; ensureAudioCtx();
    // Ten-key: set seconds from buffer / keepLast and remember lastSec
    if (tenKeyCfg.enabled) {
      const current = keyBuf ? bufToSec(keyBuf) : (tenKeyCfg.keepLast ? (tenKeyCfg.lastSec || 0) : sec);
      if (current > 0) setSec(current);
      if (tenKeyCfg.keepLast && current > 0) {
        setConfig((c) => ({ ...c, tenKey: { ...(c.tenKey || {}), enabled: true, keepLast: true, lastSec: current } }));
      }
    }
    const startIdRaw = config.modes[modeIdx].startSound;
    const startId = normalizeSoundId(startIdRaw || "");
    playById(startId);
    setRunning(true);
  };

    const toggleBtnRow = (i) => {
    if (btnOn.has(i)) {
      const n = new Set(btnOn); n.delete(i); setBtnOn(n);
      btnFiredRef.current.delete(i);
    } else {
      const n = new Set(btnOn); n.add(i); setBtnOn(n);
      btnFiredRef.current.set(i, new Set());
    }
  };

    useEffect(() => {
    if (!running) return;

    const id = setInterval(() => {
      setSec((p) => {
        const n = p - 1;

        // ── 通知 & 背景色（設定行）
        const rows = modeCfg.nbRows || [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] || {};
          for (const key of ["notify1", "notify2"]) {
            const mm = Number(r[key]?.min ?? 0);
            const ss = Number(r[key]?.sec ?? 0);
            const tSec = mm * 60 + ss;
            if (n === tSec || (p > tSec && n < tSec)) {
              const tag = `${i}-${key}-${tSec}`;
              if (!notifiedRef.current.has(tag)) {
                const sid = normalizeSoundId(r[key]?.sound || "");
                playById(sid);
                if (r.color) activeBgRef.current = r.color;
                notifiedRef.current.add(tag);
              }
            }
          }
        }

        // ── 通知ボタン（tick同期で正確発火）
        if (modeCfg.btnRows && btnOn.size) {
          for (const i of btnOn) {
            const idx = Number(i);
            const row = (modeCfg.btnRows || [])[idx];
            if (!row) continue;
            for (const key of ["n1", "n2"]) {
              const mm = Number(row[key]?.min ?? 0);
              const ss = Number(row[key]?.sec ?? 0);
              const tSec = mm * 60 + ss;
              if (n === tSec || (p > tSec && n < tSec)) {
                let fired = btnFiredRef.current.get(i);
                if (!fired) { fired = new Set(); btnFiredRef.current.set(i, fired); }
                const tag = `${i}-${key}-${tSec}`;
                if (!fired.has(tag)) {
                  const sid = normalizeSoundId(row[key]?.sound || "");
                  playById(sid); // fire-and-forget（ここは async 関数ではない）
                  fired.add(tag);
                }
              }
            }
          }
        }

        // ── 終了処理 ──
        if (n <= 0) {
          const endId = normalizeSoundId(modeCfg.endSound || "");
          if (!endId || endId === "none") { /* 無音 */ }
          else if (endId === "alarm8") {
            const loopSec = loopSeconds(modeCfg);
            loopDeadlineRef.current = Date.now() + loopSec * 1000;

            // watchdog / stop timer（既存の停止ロジックは維持。合計時間は loopSec に収める）
            if (!loopWatchRef.current) {
              loopWatchRef.current = setInterval(() => {
                if (loopDeadlineRef.current && Date.now() >= loopDeadlineRef.current) {
                  /* 保険 */
                  playingRef.current.forEach((s) => {
                    try { s.pause(); } catch {}
                  });
                  stopGaplessAlarm();
                }
              }, 120);
            }
            if (stopLoopTRef.current) clearTimeout(stopLoopTRef.current);
            stopLoopTRef.current = setTimeout(() => {
              playingRef.current.forEach((s) => {
                try { s.pause(); } catch {}
              });
              stopGaplessAlarm();
            }, loopSec * 1000 + 50);

            // --- ループ中に音声を挟む（無音なら挟まない／ミュートもしない） ---
            const voiceIdRaw = normalizeSoundId(coerceSound(modeCfg.endInsertVoiceSound) || "");
            const voiceId = (voiceIdRaw && voiceIdRaw !== "none") ? voiceIdRaw : "";

            if (voiceId) {
              // ここで初めてループを止める（= 無音選択時にミュートされないように）
              stopGaplessAlarm();

              // fire-and-forget（ここは setInterval の中なので await しない）
              (async () => {
                // このシーケンス開始。途中でリセット/停止されたら中断できるようにトークンを固定
                const seqToken = (stopSeqTokenRef.current += 1);
                const cancelled = () => seqToken !== stopSeqTokenRef.current;

                // iPad Safari: 直前の通知音が鳴っていると、終了時の「ピピピッ→第2音声」が無音になることがある。
                // 終了シーケンスに入る前に、鳴っている音（通知など）を一旦止めてから挟み込みを再生する。
                try {
                  playingRef.current.forEach((a) => {
                    try {
                      a.loop = false;
                      a.pause();
                      a.currentTime = 0;
                    } catch {}
                  });
                  playingRef.current = [];
                } catch {}
                const muteSecRaw = Number(modeCfg.endInsertMuteSec ?? 2);
                const clamped = Number.isFinite(muteSecRaw) ? Math.min(5, Math.max(0.5, muteSecRaw)) : 2;
                const muteSec = Math.round(clamped * 2) / 2; // 0.5刻み
                const muteMs = muteSec * 1000;

                // まず「ピピピッ」を1秒（体感固定）
                // 挟み込み前の短い合図（ここは one‑shot で確実に短く鳴らす）
                if (cancelled()) return;
                await playByIdForDuration("builtin-beep3", 1000);
                if (cancelled()) return;

                // 次に「音声」：指定秒数だけ鳴らして止める（その間は alarm8 をミュート）
                await playByIdForDuration(voiceId, muteMs);
                if (cancelled()) return;

                // 残り時間があれば alarm8 ループへ戻す
                if (cancelled()) return;
                if (loopDeadlineRef.current && Date.now() < loopDeadlineRef.current) {
                  stopGaplessAlarm();
                  playGaplessAlarm();
                }
              })();
            } else {
              // 通常：すぐ alarm8 ループ（無音のときはミュートしない）
              playGaplessAlarm();
            }
          } else {
            playById(endId);
          }
          clearInterval(id);
          setRunning(false); setFinished(Date.now());
          return 0;
        }
        return n;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [running, modeCfg.endSound, modeCfg.endLoops, modeCfg.endLoopSec, JSON.stringify(modeCfg.nbRows), JSON.stringify(modeCfg.btnRows), JSON.stringify(Array.from(btnOn))]);

    useEffect(() => { if (!finished) return; if (modeCfg.endSound === "alarm8") { const ms = loopSeconds(modeCfg) * 1000; const t = setTimeout(() => { playingRef.current.forEach((s)=>{s.pause();}); stopGaplessAlarm(); }, ms + 25); return () => clearTimeout(t); } }, [finished, modeCfg]);
  // 実行開始後に設定が開いていたら自動的に閉じる（安全策）
  useEffect(() => { if (running && showSettings) setShowSettings(false); }, [running, showSettings]);

  useEffect(() => { if (finished) { setBlink(true); const t = setInterval(() => setBlink((b) => !b), 500); return () => clearInterval(t); } else { setBlink(false); } }, [finished]);

    useEffect(() => { if (!finished) return; const id = setTimeout(reset, config.resetSec * 1000); return () => clearTimeout(id); }, [finished, config.resetSec]);

    useEffect(() => () => { playingRef.current.forEach((s)=>{s.pause();}); stopGaplessAlarm(); }, []);

    const nbBg = activeBgRef.current ? NB_COLOR_MAP[activeBgRef.current] : null;
  const bg = finished ? COLORS.alert : running ? (nbBg || COLORS.run) : COLORS.card;
  const cardW = "100%"; // セル幅いっぱいにする
  const cardStyle = { background: bg, borderRadius: 16, padding: 16, width: cardW, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", boxShadow: "0 2px 6px rgba(0,0,0,.15)", userSelect: "none",WebkitUserSelect: "none",WebkitTouchCallout: "none", touchAction: "manipulation" };
  const notifyAreaStyle = { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2, marginBottom: 2, justifyContent: "center", width: "100%", minHeight: 28 };
  const placeholderStyle = { background: "#e5e7eb", borderRadius: 16, width: cardW, height: 220, display: "flex", justifyContent: "center", alignItems: "center", userSelect: "none", cursor: "pointer" };

    return (
    <>
      {cardHidden ? (
        <div {...longPressHandlers} style={placeholderStyle}>
          <img src={withBase("icons/gear64.svg")} width={32} height={32} alt="設定" />
        </div>
      ) : (
        <div style={cardStyle} onClick={() => finished && reset()} onContextMenu={(e) => e.preventDefault()}>
          {/* title + mode buttons (single row) */}
          {!tenKeyCfg.enabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 4, paddingRight: 1 }}>
              <div style={{ flex:"1 1 auto", minWidth:0, fontSize:"2rem", fontWeight:700, color: COLORS.txt, cursor:"default", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", WebkitUserSelect:"none", userSelect:"none" }}>
                {displayName}
              </div>
              {hasButtons && (
                <div style={{ display: "flex", gap: 8, flex: "0 0 auto", marginRight: 16 }}>
                  {visibleModes.map((m) => (
                    <button
                      key={m.originalIndex}
                      onClick={() => chooseMode(m.originalIndex)}
                      disabled={running}
                      style={{ ...MODE_BTN, background: m.originalIndex === modeIdx ? COLORS.sel : "#fff", fontWeight: m.originalIndex === modeIdx ? 700 : 500 }}
                    >
                      {m.buttonLabel.slice(0, 1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* remaining time */}
          <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, Helvetica Neue, Arial, sans-serif", fontVariantNumeric: "tabular-nums", WebkitFontSmoothing: "antialiased", fontFeatureSettings: '"tnum" 1, "zero" 0', fontSize: "clamp(3.8rem, 6vw, 5.4rem)", fontWeight: 700, color: COLORS.txt, marginBottom: 6, visibility: (finished && sec === 0 && !blink) ? "hidden" : "visible" }}>
            {(finished && sec === 0) ? "00:00" : secToMMSS(sec)}
          </div>

          {/* ten-key layout (3 rows + right column) */}
          {tenKeyCfg.enabled && (
            <div style={{ width: "100%", marginBottom: 6, display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr) 1.6fr",
                  gridTemplateRows: "repeat(3, 34px)",
                  gap: 6,
                  width: "auto",
                  maxWidth: 340,
                }}
              >
                {/* Row1: 7 8 9 ⚙ */}
                {[7, 8, 9].map((n, i) => (
                  <button
                    key={n}
                    onClick={() => pushDigit(String(n))}
                    disabled={running}
                    style={{ gridColumn: 1 + i, gridRow: 1, ...KEYPAD_BTN }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  {...longPressHandlers}
                  disabled={running}
                  style={{ gridColumn: 4, gridRow: 1, ...KEYPAD_ICON_BTN }}
                  aria-label="設定"
                  title="設定"
                >
                  <img src={withBase("icons/gear64.svg")} width={16} height={16} alt="設定" />
                </button>

                {/* Row2: 4 5 6 クリア */}
                {[4, 5, 6].map((n, i) => (
                  <button
                    key={n}
                    onClick={() => pushDigit(String(n))}
                    disabled={running}
                    style={{ gridColumn: 1 + i, gridRow: 2, ...KEYPAD_BTN }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={clearBuf} 
                  disabled={running}
                  style={{ gridColumn: 4, gridRow: 2, ...KEYPAD_BTN_CLEAR }}
                >
                  クリア
                </button>

                {/* Row3: 1 2 3 0 */}
                {[1, 2, 3, 0].map((n, i) => (
                  <button
                    key={`r3-${n}`}
                    onClick={() => pushDigit(String(n))}
                    disabled={running}
                    style={{ gridColumn: 1 + i, gridRow: 3, ...KEYPAD_BTN, fontFamily: 'sans-serif' }}
                  >
                    {n}
                  </button>
                ))}

                {/* Right column: Reset / Start (free from row heights) */}
                <div
                  style={{
                    gridColumn: 5,
                    gridRow: "1 / 4",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                    <button
    onClick={start}
    style={START_SM}
  >
    スタート
      </button>
                  <button
    {...tenKeyResetLP}
    title="長押しでリセット"
    style={RESET_SM}
  >
    リセット
  </button>
                </div>
              </div>
            </div>
          )}

          {/* normal mode controls */}
          {!tenKeyCfg.enabled && (
            <div style={{ display: "flex", gap: 16, marginBottom: 6 }}>
              <button onClick={start} style={START_LG}>スタート</button>
              <button {...longReset} style={RESET_LG}>リセット</button>
            </div>
          )}

          {/* notify buttons (max 4, toggle ON/OFF, multi‑press allowed across buttons) */}
          {!tenKeyCfg.enabled && (
            <div style={notifyAreaStyle}>
              {modeCfg.btnRows && modeCfg.btnRows.length > 0 && (
                modeCfg.btnRows.slice(0, 4).map((r, i) => (
                  <button
                    key={i}
                    onMouseDown={(e) => e.preventDefault()}        // ドラッグ選択の発火を抑止
                    onClick={() => { toggleBtnRow(i); try { window.getSelection()?.removeAllRanges(); } catch {} }}
                    style={{
                      ...NOTIFY_BTN,
                      background: btnOn.has(i) ? COLORS.sel : "#fff",
                      WebkitUserSelect: "none", userSelect: "none", // 選択不可（iPad Safari向け）
                      WebkitTapHighlightColor: "transparent",       // タップ時のハイライト無効
                      WebkitTouchCallout: "none"                    // 長押しのコールアウト無効
                    }}
                   >
                    {r.label || `通知${i + 1}`}
                  </button>
                ))
              )}
              <button
                {...longPressHandlers}
                aria-label="設定"
                title="設定"
                style={{ marginLeft: "auto", border: "1px solid #666", borderRadius: 6, background: "#fff", padding: "4px 8px", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <img src={withBase("icons/gear64.svg")} width={16} height={16} alt="設定" />
              </button>
            </div>
          )}
        </div>
      )}

      {showSettings && !running && modalRoot && createPortal(
        <React.Suspense fallback={null}>
          <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: 12, WebkitTouchCallout: "none",touchAction: "manipulation",}}onContextMenu={(e) => e.preventDefault()}>
            <div style={{ maxWidth: 880, width: "min(92vw, 880px)", marginTop: 12 }}onContextMenu={(e) => e.preventDefault()}>
              <TimerSettingsModal
                config={config}
                setConfig={setConfig}
                onClose={() => setShowSettings(false)}
                cardIndex={index}
              />
            </div>
          </div>
        </React.Suspense>,
        modalRoot
      )}
    </>
  );
}