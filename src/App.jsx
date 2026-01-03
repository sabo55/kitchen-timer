// src/App.jsx
import React from "react";

// あなたのファイル名に合わせて1つだけ残してください
// （多くの人は TimerBoard.tsx / TimerBoard.jsx という名前で置いています）
import TimerBoard from "@/components/TimerBoard";
// import TimerBoard from "./components/TimerBoard"; // ← エイリアス(@)未設定なら相対パスで

export default function App() {
  return (
    <div className="min-h-dvh bg-background text-foreground p-4">
      {/* 画面幅いっぱい使う（中央固定の max-w-* を撤廃） */}
      <div className="w-full max-w-none">
        <TimerBoard />
      </div>
    </div>
  );
}

/*
// ★完全フルブリードにしたい場合はこちらに差し替え（余白ゼロで端から端まで）
export default function App() {
  return (
    <div className="min-h-dvh bg-background text-foreground p-0">
      <div className="w-screen max-w-none mx-0">
        <TimerBoard />
      </div>
    </div>
  );
}
*/
