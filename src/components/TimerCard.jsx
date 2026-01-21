// TimerCard.jsx – compacting pass 1

import React, { useState, useRef, useEffect } from "react";
import {
  START_LG, RESET_LG, START_SM, RESET_SM, KEYPAD_BTN, KEYPAD_BTN_CLEAR, KEYPAD_ICON_BTN,
  MODE_BTN, secToMMSS, NOTIFY_BTN, TIMER_COLORS as COLORS, NB_COLOR_MAP,
  useLongPress, normalizeSoundId, soundKey, sameId, coerceSound, sanitizeMode,
  loopSeconds, isDefaultLikeName,
} from "./helpers";

const TimerSettingsModal = React.lazy(() => import("./TimerSettingsModal"));
import { createPortal } from "react-dom";
import * as SoundsHelper from "../lib/sounds-helper";


const VOLUME = 0.85;
// GitHub Pages（/repo-name/ 配下）でも dev（/）でも同じ書き方で動くようにする
const BASE_URL = (import.meta?.env?.BASE_URL) ? import.meta.env.BASE_URL : "/";
const withBase = (p) => `${BASE_URL}${String(p).replace(/^\/+/, "")}`;

// 個別音量（AudioLibraryModal由来）を反映する補助
const getVolFor = (rawId) => {
  try {
    const s = normalizeSoundId(rawId || "");
    if (!s) return 1;
    const list = JSON.parse(localStorage.getItem("timerBoard_sounds_v1") || "[]");
    const rec = Array.isArray(list) ? list.find((x) => sameId(soundKey(x), s)) : null;
    const v = Number(rec?.volume);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 1;
  } catch { return 1; }
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

export default function TimerCard({ index = 0, storageId = null, displayNo = null, disableLongPress = false }) {
  const sid = (storageId ?? index);
  const posNo = Number.isFinite(displayNo) ? displayNo : (index + 1);
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

  // audio library: TimerBoard が保存している localStorage を参照（なければ空配列）

    const [showSettings, setShowSettings] = useState(false);

  const modeCfg = (config && Array.isArray(config.modes) && config.modes[modeIdx]) ? config.modes[modeIdx] : defaultConfig.modes[0];
  const displayName = (() => {
    const raw = String(modeCfg.timerName || "").trim();
    // 既存データに「タイマー1」等が保存されていても、デフォ名扱いにして“枠番号”を表示する
    const looksDefault = /^タイマー\d+$/.test(raw);
    if (!raw || looksDefault) return `タイマー${posNo}`;
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

    const visibleModes = config.modes.map((m, i) => ({ ...m, originalIndex: i })).filter((m) => m.buttonLabel && m.buttonLabel.trim());
  const hasButtons = visibleModes.length >= 2;

    useEffect(() => localStorage.setItem(storageKey, JSON.stringify(config)), [config, storageKey]);
  // persist last selected mode index per card
  useEffect(() => { try { localStorage.setItem(lastModeKey, String(modeIdx)); } catch {} }, [modeIdx, lastModeKey]);
  // ---- audio: delegated to lib (keeps TimerCard compact) ----
  const soundRef = useRef(null);  const createSoundPlayer = SoundsHelper.createSoundPlayer || ((opts = {}) => {
    const baseVolume = Number.isFinite(opts.baseVolume) ? opts.baseVolume : 0.85;
    const getVol = typeof opts.getVolFor === "function" ? opts.getVolFor : () => 1;
    const wb = typeof opts.withBase === "function" ? opts.withBase : (p) => p;
    const playing = [];
    let alarm8Loop = null;
    let alarm8WebLoop = null; // WebAudioのloop用（stopAllで止める）

    // iOS対策：AudioContext を維持（無音が続くと鳴らなくなるのを回避）
    const audioCtxRef = { current: null };
    const bufCache = new Map();
    let keepAliveT = null;

    const ensureCtx = async () => {
      const Ctx = (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!Ctx) return null;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current.state === "suspended") {
        try { await audioCtxRef.current.resume(); } catch {}
      }
      // keep-alive（4秒周期。5秒無音で死ぬ現象の回避）
      if (!keepAliveT) {
        keepAliveT = setInterval(() => {
          try {
            const ctx = audioCtxRef.current;
            if (!ctx) return;
            if (ctx.state === "suspended") { ctx.resume().catch(() => {}); return; }
            // 極小音のワンショット（ほぼ無音）
            const g = ctx.createGain();
            g.gain.value = 0.00001;
            g.connect(ctx.destination);
            const o = ctx.createOscillator();
            o.frequency.value = 30;
            o.connect(g);
            const now = ctx.currentTime;
            o.start(now);
            o.stop(now + 0.02);
          } catch {}
        }, 4000);
      }
      return audioCtxRef.current;
    };

    const decodeUrlToBuffer = async (url) => {
      const ctx = await ensureCtx();
      if (!ctx) return null;
      const key = String(url);
      if (bufCache.has(key)) return bufCache.get(key);
      try {
        const r = await fetch(url);
        if (!r.ok) { bufCache.set(key, null); return null; }
        const ab = await r.arrayBuffer();
        const buf = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
        bufCache.set(key, buf);
        return buf;
      } catch {
        bufCache.set(key, null);
        return null;
      }
    };

    const playBufOnce = async (url, vol01) => {
      const ctx = await ensureCtx();
      if (!ctx) return false;
      const buf = await decodeUrlToBuffer(url);
      if (!buf) return false;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = vol01;
        src.connect(g);
        g.connect(ctx.destination);
        src.start(0);
        return true;
      } catch {
        return false;
      }
    };
    const mk = (files) => {
      const a = document.createElement("audio");
      a.preload = "auto";
      a.loop = false;
      a.playsInline = true;

      const list = Array.isArray(files) ? files : [files];
      const add = (base, ext, type) => {
        const s = document.createElement("source");
        // public/sounds 配下（devでもPagesでも同じ）
        s.src = wb(`sounds/${base}.${ext}?id=${Date.now()}`);
        s.type = type;
        a.appendChild(s);
      };

      // iPad/Safari の取りこぼし対策：候補を複数入れて最初に読めるものを使わせる
      for (const base of list) {
        add(base, "wav", "audio/wav");
        add(base, "mp3", "audio/mpeg");
      }

      try { a.load(); } catch {}
      return a;
    };
    const stopAll = () => {
      // ループ中の alarm8（WebAudio）
      if (alarm8WebLoop) {
        try { alarm8WebLoop.stop(0); } catch {}
        try { alarm8WebLoop.disconnect(); } catch {}
        alarm8WebLoop = null;
      }
      // ループ中の alarm8（HTMLAudio）
      if (alarm8Loop) {
        try { alarm8Loop.loop = false; alarm8Loop.pause(); alarm8Loop.currentTime = 0; } catch {}
        alarm8Loop = null;
      }
      // 単発（HTMLAudio）
      while (playing.length) {
        const a = playing.pop();
        try { a.loop = false; a.pause(); a.currentTime = 0; } catch {}
      }
      // ※ AudioContext/keepAlive は止めない（無音で死ぬのを防ぐ）
    };
    const playById = async (rawId) => {
      const id = normalizeSoundId(rawId || "");
      if (!id || id === "none") return;

      const vol01 = Math.max(0, Math.min(1, baseVolume * getVol(id)));

      // できるだけ WebAudio（iOSで安定）→ ダメなら HTMLAudio
      const tryWeb = async (base) => {
        const wav = wb(`sounds/${base}.wav?id=${Date.now()}`);
        const mp3 = wb(`sounds/${base}.mp3?id=${Date.now()}`);
        return (await playBufOnce(wav, vol01)) || (await playBufOnce(mp3, vol01));
      };

      // builtins
      if (id === "alarm8") {
        // 単発で鳴らすケース用（ループは playGaplessAlarm8）
        if (await tryWeb("alarm8")) return;
      } else if (id === "builtin-beep") {
        if (await tryWeb("alarm")) return;
      } else if (id === "builtin-beep3") {
        if (await tryWeb("beep3")) return;
      }

      // custom / library
      const url = (typeof SoundsHelper.getSoundUrl === "function") ? SoundsHelper.getSoundUrl(id) : "";
      if (url) {
        const abs = url.startsWith("/") ? wb(url.slice(1)) : url;
        if (await playBufOnce(abs, vol01)) return;
      }

      // HTMLAudio fallback
      let a = null;
      if (id === "alarm8") a = mk(["alarm8"]);
      else if (id === "builtin-beep") a = mk(["alarm"]);
      else if (id === "builtin-beep3") a = mk(["beep3"]);
      else {
        if (!url) return;
        a = document.createElement("audio");
        a.preload = "auto";
        a.loop = false;
        const src = document.createElement("source");
        src.src = url.startsWith("/") ? wb(url.slice(1)) : url;
        src.type = "audio/mpeg";
        a.appendChild(src);
      }
      a.volume = vol01;
      playing.push(a);
      a.onended = () => {
        const i = playing.indexOf(a);
        if (i >= 0) playing.splice(i, 1);
      };
      try { try { a.currentTime = 0; } catch {} await a.play(); } catch {
        const i = playing.indexOf(a);
        if (i >= 0) playing.splice(i, 1);
      }
    };
    return {
      ensureCtx,
      playById,
      playByIdForDuration: async (id, ms) => { await playById(id); await new Promise((r) => setTimeout(r, ms)); },
      playGaplessAlarm8: async (fadeMs = 0) => {
        // WebAudioでループできればそっちを優先（iOSで安定）
        try {
          const ctx = await ensureCtx();
          if (ctx) {
            const wav = wb(`sounds/alarm8.wav?id=${Date.now()}`);
            const mp3 = wb(`sounds/alarm8.mp3?id=${Date.now()}`);
            const buf = (await decodeUrlToBuffer(wav)) || (await decodeUrlToBuffer(mp3));
            if (buf) {
              // 既存ループがあれば止める
              if (alarm8WebLoop) {
                try { alarm8WebLoop.stop(0); } catch {}
                try { alarm8WebLoop.disconnect(); } catch {}
                alarm8WebLoop = null;
              }
              const src = ctx.createBufferSource();
              src.buffer = buf;
              src.loop = true;
              const g = ctx.createGain();
              g.gain.value = Math.max(0, Math.min(1, baseVolume * getVol("alarm8")));
              src.connect(g);
              g.connect(ctx.destination);
              src.start(0);
              alarm8WebLoop = src;
              return true;
            }
          }
        } catch {}

        // HTMLAudio fallback：alarm8 をループ
        try {
          if (!alarm8Loop) {
            alarm8Loop = mk(["alarm8"]);
            alarm8Loop.loop = true;
          }
          alarm8Loop.volume = Math.max(0, Math.min(1, baseVolume * getVol("alarm8")));
          try { alarm8Loop.currentTime = 0; } catch {}
          await alarm8Loop.play();
          return true;
        } catch {
          return false;
        }
      },
      stopAll,
    };
  });

  if (!soundRef.current) {
    soundRef.current = createSoundPlayer({ baseVolume: VOLUME, getVolFor, withBase });
  }

  // 終了シーケンス（ピピピッ→第2音声→alarm8戻し）を途中で止められるようにするキャンセル用トークン
  const stopSeqTokenRef = useRef(0);
  const stopLoopTRef = useRef(null);
  const loopDeadlineRef = useRef(null);
  const loopWatchRef = useRef(null);

  const ensureAudioCtx = () => soundRef.current?.ensureCtx?.();
  const playById = (id) => soundRef.current?.playById?.(id);
  const playByIdForDuration = (id, ms) => soundRef.current?.playByIdForDuration?.(id, ms);
  const playGaplessAlarm = (fadeMs = 0) => soundRef.current?.playGaplessAlarm8?.(fadeMs);

  const cleanAllAudio = () => {
    // 進行中の終了シーケンスをキャンセル
    stopSeqTokenRef.current += 1;
    try { soundRef.current?.stopAll?.(); } catch {}

    if (stopLoopTRef.current) { clearTimeout(stopLoopTRef.current); stopLoopTRef.current = null; }
    loopDeadlineRef.current = null;
    if (loopWatchRef.current) { clearInterval(loopWatchRef.current); loopWatchRef.current = null; }
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
  const tenKeyResetLP = useLongPress(() => { if (tenKeyCfg.enabled) clearBuf(); }, { ms: 1000 });

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
                  try { soundRef.current?.stopAll?.(); } catch {}
                }
              }, 120);
            }
            if (stopLoopTRef.current) clearTimeout(stopLoopTRef.current);
            stopLoopTRef.current = setTimeout(() => {
              try { soundRef.current?.stopAll?.(); } catch {}
            }, loopSec * 1000 + 50);

            // --- ループ中に音声を挟む（無音なら挟まない／ミュートもしない） ---
            const voiceIdRaw = normalizeSoundId(coerceSound(modeCfg.endInsertVoiceSound) || "");
            const voiceId = (voiceIdRaw && voiceIdRaw !== "none") ? voiceIdRaw : "";

            if (voiceId) {
              // ここで初めてループを止める（= 無音選択時にミュートされないように）
              try { soundRef.current?.stopAll?.(); } catch {}

              // fire-and-forget（ここは setInterval の中なので await しない）
              (async () => {
                // このシーケンス開始。途中でリセット/停止されたら中断できるようにトークンを固定
                const seqToken = (stopSeqTokenRef.current += 1);
                const cancelled = () => seqToken !== stopSeqTokenRef.current;
                try {
                  try { soundRef.current?.stopAll?.(); } catch {}
                } catch {}
                const muteSecRaw = Number(modeCfg.endInsertMuteSec ?? 2);
                const clamped = Number.isFinite(muteSecRaw) ? Math.min(5, Math.max(0.5, muteSecRaw)) : 2;
                const muteSec = Math.round(clamped * 2) / 2; // 0.5刻み
                const muteMs = muteSec * 1000;
                if (cancelled()) return;
                await playByIdForDuration("builtin-beep3", 1000);
                if (cancelled()) return;
                await playByIdForDuration(voiceId, muteMs);
                if (cancelled()) return;
                if (cancelled()) return;
                if (loopDeadlineRef.current && Date.now() < loopDeadlineRef.current) {
                  // 旧名の stopGaplessAlarm は廃止：委譲先にまとめる
                  try { soundRef.current?.stopAll?.(); } catch {}
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

    useEffect(() => {
  if (!finished) return;
  if (modeCfg.endSound === "alarm8") {
    const ms = loopSeconds(modeCfg) * 1000;
    const t = setTimeout(() => { try { soundRef.current?.stopAll?.(); } catch {} }, ms + 25);
    return () => clearTimeout(t);
  }
}, [finished, modeCfg]);
  // 実行開始後に設定が開いていたら自動的に閉じる（安全策）
  useEffect(() => { if (running && showSettings) setShowSettings(false); }, [running, showSettings]);

  useEffect(() => { if (finished) { setBlink(true); const t = setInterval(() => setBlink((b) => !b), 500); return () => clearInterval(t); } else { setBlink(false); } }, [finished]);

    useEffect(() => { if (!finished) return; const id = setTimeout(reset, config.resetSec * 1000); return () => clearTimeout(id); }, [finished, config.resetSec]);

    useEffect(() => () => { try { soundRef.current?.stopAll?.(); } catch {} }, []);

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


          <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Noto Sans JP, Helvetica Neue, Arial, sans-serif", fontVariantNumeric: "tabular-nums", WebkitFontSmoothing: "antialiased", fontFeatureSettings: '"tnum" 1, "zero" 0', fontSize: "clamp(3.8rem, 6vw, 5.4rem)", fontWeight: 700, color: COLORS.txt, marginBottom: 6, visibility: (finished && sec === 0 && !blink) ? "hidden" : "visible" }}>
            {(finished && sec === 0) ? "00:00" : secToMMSS(sec)}
          </div>


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

          {!tenKeyCfg.enabled && (
            <div style={{ display: "flex", gap: 16, marginBottom: 6 }}>
              <button onClick={start} style={START_LG}>スタート</button>
              <button {...longReset} style={RESET_LG}>リセット</button>
            </div>
          )}

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
                cardIndex={posNo - 1}
              />
            </div>
          </div>
        </React.Suspense>,
        modalRoot
      )}
    </>
  );
}
