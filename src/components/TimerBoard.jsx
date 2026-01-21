import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import TimerCard from "./TimerCard";
import AudioLibraryModal from "@/components/AudioLibraryModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// 固定用トースト定数（変更防止のため Object.freeze）
const TOAST_STYLE = Object.freeze({
  fontSize: "100px",
  padding: "14px 28px",
  radius: 56,
  border: "2px solid #0004",
  top: "6%",
});

export default function TimerBoard() {
  const loadSlots = () => {
    try {
      const s = JSON.parse(localStorage.getItem("timerBoard_slots_v1") || "null");
      if (Array.isArray(s) && s.every(n => Number.isInteger(n))) return s;
    } catch {}
    return [0,1,2,3,4,5,6,7,8];
  };
  const [slots, setSlots] = useState(loadSlots);
  useEffect(() => {
    localStorage.setItem("timerBoard_slots_v1", JSON.stringify(slots));
  }, [slots]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [firstPick, setFirstPick] = useState(null);
  const [viewMode, setViewMode] = useState("9");
  // ページング（レイアウトに応じて自動計算）
  const perPage = viewMode === "9" ? 9 : (viewMode === "4" ? 4 : 1);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [viewMode]);
  // pageCount は capacity 定義後に算出します
  const [audioLibOpen, setAudioLibOpen] = useState(false);
  const [sounds, setSounds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("timerBoard_sounds_v1") || "[]");
    } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem("timerBoard_sounds_v1", JSON.stringify(sounds));
  }, [sounds]);

  useEffect(() => {
    if (!menuOpen && swapMode) {
      setSwapMode(false);
      setFirstPick(null);
    }
  }, [menuOpen]);

  // ページ切替ロック（設定で切替／入替ON時は一時解除）
  const [pageLock, setPageLock] = useState(() => localStorage.getItem("timerBoard_pageLock_v1") === "1");
  useEffect(() => { localStorage.setItem("timerBoard_pageLock_v1", pageLock ? "1" : "0"); }, [pageLock]);
  const prevLockRef = useRef(null);
  useEffect(() => {
    if (swapMode) { prevLockRef.current = pageLock; setPageLock(false); }
    else if (prevLockRef.current != null) { setPageLock(prevLockRef.current); prevLockRef.current = null; }
  }, [swapMode]);

  // visibleIndices は capacity 定義後に算出します

  const containerRef = useRef(null);
  // --- エディション & 容量（保存枠） ---
  const [edition] = useState(() => localStorage.getItem("timerBoard_edition") || "NINE"); // 'ONE' | 'FOUR' | 'NINE'
  const capacityByEdition = { ONE: 4, FOUR: 12, NINE: 27 };
  const capacity = capacityByEdition[edition] || 9;
  // slots 長さを容量に合わせてマイグレーション（既存順を優先して穴埋め）
  useEffect(() => {
    if (slots.length === capacity) return;
    setSlots((prev) => {
      const seen = new Set();
      const out = [];
      for (const n of prev) { if (out.length >= capacity) break; if (!seen.has(n)) { out.push(n); seen.add(n); } }
      for (let i = 0; i < capacity; i++) { if (out.length >= capacity) break; if (!seen.has(i)) { out.push(i); seen.add(i); } }
      return out;
    });
  }, [capacity]);

  // capacity が確定した後に算出
  const pageCount = Math.max(1, Math.ceil(capacity / perPage));
  const visibleIndices = useMemo(() => {
    const start = page * perPage;
    const end = Math.min(start + perPage, capacity);
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  }, [page, perPage, capacity]);
  // ページが上限を越えていたら補正
  useEffect(() => {
    setPage((p) => Math.max(0, Math.min(pageCount - 1, p)));
  }, [pageCount]);
  // ページ名（昼/夜/倉庫…を優先表示）
  const [pageNames, setPageNames] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem("timerBoard_pageNames_v1") || "null"); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem("timerBoard_pageNames_v1", JSON.stringify(pageNames)); }, [pageNames]);
  const defaultNames = [];
  const labelFor = (idx) => `${idx + 1}ページ`;
  // ページごとの背景色（ほんのりティント）
  const PAGE_TINTS = ["#FFF8E8", "#EAF4FF", "#F7EEFC", "#F0FFF5", "#FFF5F5", "#F5F7FF"];
  const tint = PAGE_TINTS[page % PAGE_TINTS.length];
  const container = {
    padding: 8,
    width: "100%",
    boxSizing: "border-box",
    minWidth: 0,
    maxWidth: "100%",
    height: "100vh",
    overflow: "hidden",
    margin: 0,
    overscrollBehavior: "none",
    display: "block",
    position: "fixed",
    inset: 0,
    background: tint,
    touchAction: "pan-y",
  };
const floatBtn = {
  position: "fixed",
  right: 12,
  top:70, // ← 上から離してタイマーの切替ボタンと重ならないように
  zIndex: 1001,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #888",
  background: "#fff",
  fontWeight: 700,
  boxShadow: "0 2px 6px rgba(0,0,0,.15)",
};
const floatPanel = {
  position: "fixed",
  right: 12,
  top: 112, // ← ボタンの下に追随
  zIndex: 1000,
  padding: 10,
  borderRadius: 12,
  width: 220,
  border: "1px solid #ddd",
  background: "#fff",
  boxShadow: "0 2px 8px rgba(0,0,0,.15)",
};

  const cols = viewMode === "9" ? 3 : (viewMode === "4" ? 2 : 1);
  const rows = viewMode === "9" ? 3 : (viewMode === "4" ? 2 : 1);
  const [trackPx, setTrackPx] = useState(360);
  const [availH, setAvailH] = useState(typeof window !== 'undefined' ? window.innerHeight : 800);

  useEffect(() => {
    const GAP_X = 8;   // ← 列間ギャップ（元は12）
    const GAP_Y = 12;  // ← 行間は据え置き
    const limits = { min: 360, max: 2000 };

    let rafId = 0;
    const calc = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
       const vw = (typeof document !== "undefined" && document.documentElement)
        ? document.documentElement.clientWidth
        : (window.innerWidth || 0);
       const cw = vw;
       const ch = window.innerHeight || 0;
       const usable = Math.max(0, cw - 16);
       const cell = (usable - (cols - 1) * GAP_X) / cols;
       const clamped = Math.max(limits.min, Math.min(limits.max, cell));
       setTrackPx(clamped);
       setAvailH(Math.max(0, ch - 24));
      });
    };
    const ro = new ResizeObserver(calc);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', calc);
    calc();
    return () => {
      window.removeEventListener('resize', calc);
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [viewMode, cols]);

  const baseW = 430;
  const colW = trackPx;
  const widthScale = colW / baseW;
  const hMapRef = useRef({});
  const innerRefs = useRef({});
  const [measureTick, forceMeasure] = useState(0);
  const getMaxUnscaledH = () => {
    let m = 0;
    visibleIndices.forEach((p) => { m = Math.max(m, (hMapRef.current[p] || 420)); });
    return m || 420;
  };
  const GAP_Y = 12;
  const perRow = rows > 0 ? (Math.max(0, availH - (rows - 1) * GAP_Y) / rows) : Math.max(0, availH);
  const heightScale = perRow / getMaxUnscaledH();
  const scale = Math.min(widthScale, heightScale);

  const measuringRef = useRef(false);
  const measureHeights = () => {
    if (measuringRef.current) return;
    measuringRef.current = true;
    requestAnimationFrame(() => {
      let changed = false;
      visibleIndices.forEach((pos) => {
        const el = innerRefs.current[pos];
        if (!el) return;
        const h = el.offsetHeight;
        if (h && Math.abs((hMapRef.current[pos] || 0) - h) >= 1) {
          hMapRef.current[pos] = h;
          changed = true;
        }
      });
      if (changed) forceMeasure((x) => x + 1);
      measuringRef.current = false;
    });
  };

  useLayoutEffect(() => {
    const ros = [];
    visibleIndices.forEach((pos) => {
      const el = innerRefs.current[pos];
      if (!el) return;
      const ro = new ResizeObserver(measureHeights);
      ro.observe(el);
      ros.push(ro);
    });
    measureHeights();
    window.addEventListener('resize', measureHeights);
    return () => {
      ros.forEach((r) => r.disconnect());
      window.removeEventListener('resize', measureHeights);
    };
  }, [viewMode, scale]);
  // --- エッジスワイプ＆ページトースト ---
  const swipeRef = useRef(null);
  const [toast, setToast] = useState({ text: "", show: false });
  const showToast = (text) => {
    setToast({ text, show: true });
    clearTimeout(showToast._t1); clearTimeout(showToast._t2);
    showToast._t1 = setTimeout(() => setToast((t) => ({ ...t, show: false })), 600);
    showToast._t2 = setTimeout(() => setToast({ text: "", show: false }), 1000);
  };
  useEffect(() => () => { clearTimeout(showToast._t1); clearTimeout(showToast._t2); }, []);
  const EDGE = 48;

  const onPD = (e) => {
    if (pageCount <= 1 || pageLock) return; // 単一ページ or ロック中はスワイプ無効
    const x = e.clientX, y = e.clientY;
    const edge = (x < EDGE) || ((window.innerWidth - x) < EDGE);
    swipeRef.current = { x, y, t: performance.now(), edge, id: e.pointerId };
    try { e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const onPU = (e) => {
    const s = swipeRef.current; swipeRef.current = null;
    if (pageLock) return;
    try { e.currentTarget.releasePointerCapture && s?.id != null && e.currentTarget.releasePointerCapture(s.id); } catch {}
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y, dt = Math.max(1, performance.now() - s.t);
    const anywhereOk = Math.abs(dx) >= 140 && Math.abs(dx) > Math.abs(dy) * 2.0;
    if (!s.edge) {
      if (!anywhereOk) return; // 端以外は厳しめのしきい値
    } else {
      if (Math.abs(dx) <= 60 || Math.abs(dx) <= Math.abs(dy) * 1.8) return;
      const v = Math.abs(dx) / dt; if (v < 0.5 && Math.abs(dx) < 80) return;
    }
    const next = page + (dx < 0 ? 1 : -1);
    const clamped = Math.max(0, Math.min(pageCount - 1, next));
    if (clamped !== page) { setPage(clamped); showToast(labelFor(clamped)); }
  };

  const pick = (pos) => {
    if (!swapMode) return;
    if (firstPick == null) {
      setFirstPick(pos);
      return;
    }
    if (firstPick === pos) {
      setFirstPick(null);
      return;
    }
    const a = Math.min(firstPick, pos) + 1;
    const b = Math.max(firstPick, pos) + 1;
    const ok = window.confirm(`タイマー${a}とタイマー${b}を入れ替えます。よろしいですか？`);
    if (!ok) { setFirstPick(null); return; }
    setSlots((prev) => {
      const next = [...prev];
      const t = next[firstPick]; next[firstPick] = next[pos]; next[pos] = t;
      return next;
    });
    setFirstPick(null);
  };

  const toggleSwap = () => setSwapMode(v => !v);

  const toolbar = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <button
        onClick={toggleSwap}
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: swapMode ? "1px solid #7dd3fc" : "1px solid #888",
          background: swapMode ? "#e0f2ff" : "#f5f5f5",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
        }}
      >
        <span style={{ lineHeight: 1.1, display: "inline-block" }}>タイマー位置<br/>入れ替え</span>
        <span style={{ marginLeft: "auto", padding: "0 8px", height: 24, lineHeight: "24px", minWidth: 48, textAlign: "center", fontSize: "0.9rem", /* no pill */ border: "1px solid #888", background: "#fff" }}>
          {swapMode ? "ON" : "OFF"}
        </span>
      </button>

      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span style={{ fontWeight: 700 }}>表示数</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["1","4","9"].map(v => (
            <button key={v} onClick={() => setViewMode(v)} disabled={viewMode===v}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #888", background: viewMode===v? "#ddd" : "#f5f5f5", fontWeight: 700 }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setPageLock(v => !v)}
        style={{width: "100%", padding: "6px 10px", borderRadius: 8, border: pageLock ? "1px solid #7dd3fc" : "1px solid #888", background: pageLock ? "#e0f2ff" : "#f5f5f5", fontWeight: 700}}
      >ページ切替ロック：{pageLock ? "ON" : "OFF"}</button>

      <button
        onClick={() => setAudioLibOpen(true)}
        style={{width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid #888", background: "#f5f5f5", fontWeight: 700}}
      >音声設定</button>
    </div>
  );

  return (
    <div style={container} ref={containerRef} onPointerDownCapture={onPD} onPointerUpCapture={onPU}>
      <button style={floatBtn} onClick={() => setMenuOpen(m => !m)} aria-expanded={menuOpen}>設定</button>
      {menuOpen && (
        <div style={floatPanel} onClick={(e) => e.stopPropagation()}>{toolbar}</div>
      )}

      <div style={{
        display: "grid",
        columnGap: 8,
        rowGap: 12,
        alignItems: "start",
        alignContent: "start",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        gridTemplateColumns: `repeat(${cols}, ${trackPx}px)`,
        gridAutoRows: `${Math.floor(perRow)}px`
      }}>
        {visibleIndices.map((pos) => (
          <div
            key={pos}
            style={{
              width: "100%",
              position: "relative",
              margin: "0 auto",
              overflow: "visible",
              borderRadius: 16,
              height: "100%",
              cursor: swapMode ? "pointer" : "default",
            }}
            onClick={swapMode ? () => pick(pos) : undefined}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: baseW }}>
              <div
                ref={(el) => { innerRefs.current[pos] = el; }}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  border: swapMode
                    ? (firstPick === pos ? "3px solid #3b82f6" : "2px dashed rgba(0,0,0,.35)")
                    : "2px solid transparent",
                  borderRadius: 16,
                  background: (swapMode && firstPick === pos) ? "rgba(59,130,246,0.06)" : "#fff",
                }}
              >
                <TimerCard index={pos} storageId={(slots[pos] ?? pos)} disableLongPress={swapMode} cardMax={colW} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {toast.text && (
        <div style={{ position: "fixed", left: "50%", top: TOAST_STYLE.top, transform: "translate(-50%, 0)", background: "#fff", color: "#111", padding: TOAST_STYLE.padding, borderRadius: TOAST_STYLE.radius, border: TOAST_STYLE.border, fontWeight: 900, fontSize: TOAST_STYLE.fontSize, letterSpacing: ".02em", zIndex: 1100, boxShadow: "0 2px 8px rgba(0,0,0,.08)", pointerEvents: "none", userSelect: "none", opacity: toast.show ? 1 : 0, transition: "opacity .35s ease" }}>
          {toast.text}
        </div>
      )}

      <Dialog open={audioLibOpen} onOpenChange={setAudioLibOpen} modal={false}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>音声ライブラリ</DialogTitle>
            <DialogDescription>タイマーで使う音声の登録・名前変更・音量調整ができます。</DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-white text-black rounded-b-lg">
            <AudioLibraryModal
              open={audioLibOpen}
              onClose={() => setAudioLibOpen(false)}
              sounds={sounds}
              onChange={setSounds}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
