import { useState, useCallback, useMemo, useEffect, useRef } from "react";

const PROJECT_CODES = [
  "AD-101","AD-102","AD-103","AD-104","AD-105","AD-106","AD-107",
  "AD-108","AD-109","AD-110","AD-111","AD-112","AD-113","AD-114","AD-115"
];

const EDIT_PASSWORD = "admin1234";
const STORAGE_KEY = "doc-register-data";

function generateDocNum(projectCode, seq, revCount) {
  const code = projectCode.replace(/-/g, "");
  let seqStr;
  if (seq < 100) seqStr = String(seq).padStart(2, "0");
  else if (seq < 1000) seqStr = String(seq).padStart(3, "0");
  else seqStr = String(seq);
  const rev = String(revCount).padStart(2, "0");
  return { protocol: `${code}MVP${seqStr}-${rev}`, report: `${code}MVR${seqStr}-${rev}` };
}

function calcSequence(rows, idx) {
  const row = rows[idx];
  if (!row.project || !row.detail || !row.date || !row.author || !row.revision) return null;
  if (row.revision === "제정") {
    let maxSeq = 0;
    for (let i = 0; i < idx; i++) {
      if (rows[i].seq && rows[i].seq > maxSeq) maxSeq = rows[i].seq;
    }
    return maxSeq + 1;
  }
  if (row.revision === "개정") {
    const key = `${row.project}|${row.detail}`;
    for (let i = 0; i < idx; i++) {
      if (rows[i].revision === "제정" && `${rows[i].project}|${rows[i].detail}` === key && rows[i].seq) {
        return rows[i].seq;
      }
    }
    return null;
  }
  return null;
}

function calcRevision(rows, idx, seq) {
  if (!seq) return 0;
  let count = 0;
  for (let i = 0; i <= idx; i++) {
    if (rows[i].seq === seq) count++;
  }
  return count - 1;
}

function recomputeAll(rows) {
  const updated = rows.map(r => ({ ...r }));
  for (let i = 0; i < updated.length; i++) {
    if (updated[i].editMode && updated[i].manualProtocol) continue;
    const seq = calcSequence(updated, i);
    updated[i].seq = seq;
    if (seq) {
      const rev = calcRevision(updated, i, seq);
      const docs = generateDocNum(updated[i].project, seq, rev);
      updated[i].protocol = docs.protocol;
      updated[i].report = docs.report;
    } else {
      updated[i].protocol = "";
      updated[i].report = "";
    }
  }
  return updated;
}

function emptyRow(id) {
  return { id, project: "", detail: "", date: "", author: "", revision: "", seq: null, protocol: "", report: "", note: "", editMode: false, manualProtocol: false };
}

const btnStyle = (bg) => ({
  padding: "8px 16px", borderRadius: 8, border: "none", background: bg, color: "#fff",
  fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "opacity 0.2s", whiteSpace: "nowrap"
});

const cellStyle = (extra = {}) => ({ padding: "6px 8px", borderBottom: "1px solid #edf2f7", ...extra });

const inputStyle = {
  width: "100%", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 6,
  fontSize: 13, outline: "none", background: "transparent", boxSizing: "border-box"
};

export default function App() {
  const [rows, setRows] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    const initial = [
      { id: 1, project: "AD-101", detail: "6kodt0 (0.5/0.4mg) 잔류용매시험 MV protocol", date: "260101", author: "홍길동", revision: "제정", seq: null, protocol: "", report: "", note: "", editMode: false, manualProtocol: false },
      { id: 2, project: "AD-101", detail: "SOP 작성", date: "260101", author: "홍길동", revision: "제정", seq: null, protocol: "", report: "", note: "", editMode: false, manualProtocol: false },
      { id: 3, project: "RS2", detail: "SOP 작성", date: "260101", author: "홍길동", revision: "제정", seq: null, protocol: "", report: "", note: "", editMode: false, manualProtocol: false },
    ];
    return recomputeAll(initial);
  });
  const [insertRowNum, setInsertRowNum] = useState("");
  const [showPwModal, setShowPwModal] = useState(null);
  const [pwInput, setPwInput] = useState("");
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const nextId = useRef(Math.max(...rows.map(r => r.id), 0) + 1);
  const toastTimer = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch {}
  }, [rows]);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const updateRow = useCallback((idx, field, value) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      next[idx] = { ...next[idx], [field]: value };
      return recomputeAll(next);
    });
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => {
      const id = nextId.current++;
      return recomputeAll([...prev, emptyRow(id)]);
    });
  }, []);

  const insertRow = useCallback(() => {
    const num = parseInt(insertRowNum);
    if (isNaN(num) || num < 1 || num > rows.length) {
      showToast(`1~${rows.length} 사이의 행 번호를 입력해주세요.`, "error");
      return;
    }
    const idx = num - 1;
    const source = rows[idx];
    const id = nextId.current++;
    const newRow = { ...emptyRow(id), project: source.project, detail: source.detail, revision: source.revision };
    setRows(prev => {
      const next = [...prev];
      next.splice(idx, 0, { ...newRow });
      return recomputeAll(next);
    });
    setInsertRowNum("");
    showToast(`${num}행 위에 새 행을 삽입했습니다.`);
  }, [insertRowNum, rows, showToast]);

  const deleteRow = useCallback((idx) => {
    if (rows.length <= 1) return;
    setRows(prev => recomputeAll(prev.filter((_, i) => i !== idx)));
    showToast("행이 삭제되었습니다.");
  }, [rows.length, showToast]);

  const handleEditToggle = useCallback((idx) => {
    const row = rows[idx];
    if (row.editMode) {
      setRows(prev => {
        const next = prev.map(r => ({ ...r }));
        next[idx].editMode = false;
        if (next[idx].manualProtocol) {
          const p = next[idx].protocol;
          const mvpIdx = p.indexOf("MVP");
          if (mvpIdx >= 0) {
            const afterMvp = p.substring(mvpIdx + 3);
            const dashIdx = afterMvp.indexOf("-");
            if (dashIdx > 0) {
              const seqStr = afterMvp.substring(0, dashIdx);
              next[idx].seq = parseInt(seqStr) || next[idx].seq;
            }
          }
          next[idx].report = p.replace("MVP", "MVR");
        }
        return recomputeAll(next);
      });
      showToast("수정 모드를 해제했습니다.");
    } else {
      setShowPwModal(idx);
      setPwInput("");
    }
  }, [rows, showToast]);

  const handlePwSubmit = useCallback(() => {
    if (pwInput === EDIT_PASSWORD) {
      setRows(prev => {
        const next = prev.map(r => ({ ...r }));
        next[showPwModal].editMode = true;
        next[showPwModal].manualProtocol = false;
        return next;
      });
      setShowPwModal(null);
      setPwInput("");
      showToast("수정 모드가 활성화되었습니다.", "success");
    } else {
      showToast("비밀번호가 올바르지 않습니다.", "error");
      setPwInput("");
    }
  }, [pwInput, showPwModal, showToast]);

  const handleManualProtocol = useCallback((idx, value) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      next[idx].protocol = value;
      next[idx].manualProtocol = true;
      next[idx].report = value.replace("MVP", "MVR");
      const mvpIdx = value.indexOf("MVP");
      if (mvpIdx >= 0) {
        const afterMvp = value.substring(mvpIdx + 3);
        const dashIdx = afterMvp.indexOf("-");
        if (dashIdx > 0) {
          const seqStr = afterMvp.substring(0, dashIdx);
          const parsed = parseInt(seqStr);
          if (!isNaN(parsed)) next[idx].seq = parsed;
        }
      }
      return next;
    });
  }, []);

  const exportCSV = useCallback(() => {
    const BOM = "\uFEFF";
    const header = "No,과제명,내용,작성일,작성자,제정/개정,순번,계획서 문서번호,보고서 문서번호,비고";
    const body = rows.map((r, i) =>
      [i + 1, r.project, `"${(r.detail || "").replace(/"/g, '""')}"`, r.date, r.author, r.revision, r.seq || "", r.protocol, r.report, `"${(r.note || "").replace(/"/g, '""')}"`].join(",")
    );
    const csv = BOM + [header, ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "문서번호대장.csv"; a.click();
    URL.revokeObjectURL(url);
    showToast("CSV 파일이 다운로드되었습니다.", "success");
  }, [rows, showToast]);

  const filteredIndices = useMemo(() => {
    if (!searchTerm.trim()) return rows.map((_, i) => i);
    const term = searchTerm.toLowerCase();
    return rows.reduce((acc, r, i) => {
      if (
        (r.project || "").toLowerCase().includes(term) ||
        (r.detail || "").toLowerCase().includes(term) ||
        (r.author || "").toLowerCase().includes(term) ||
        (r.protocol || "").toLowerCase().includes(term) ||
        (r.note || "").toLowerCase().includes(term)
      ) acc.push(i);
      return acc;
    }, []);
  }, [rows, searchTerm]);

  return (
    <div style={{ fontFamily: "'Pretendard', 'Noto Sans KR', sans-serif", background: "#f0f2f5", minHeight: "100vh", padding: "24px 16px" }}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet" />

      <div style={{ maxWidth: 1400, margin: "0 auto 20px", background: "linear-gradient(135deg, #1a365d 0%, #2d5a8e 100%)", borderRadius: 16, padding: "28px 32px", color: "#fff", boxShadow: "0 4px 20px rgba(26,54,93,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px" }}>📋 Method Validation 문서번호대장</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.8 }}>Protocol: 과제코드MVP번호-버전 &nbsp;|&nbsp; Report: 과제코드MVR번호-버전</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={exportCSV} style={btnStyle("#38a169")}>📥 CSV 다운로드</button>
            <button onClick={() => { if(confirm("모든 데이터를 초기화하시겠습니까?")) { setRows(recomputeAll([emptyRow(1)])); nextId.current = 2; showToast("초기화되었습니다."); }}} style={btnStyle("#e53e3e")}>🗑 초기화</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto 16px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 10, padding: "6px 12px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <span style={{ fontSize: 13, color: "#555", whiteSpace: "nowrap" }}>행 삽입</span>
          <input type="number" min={1} max={rows.length} value={insertRowNum} onChange={e => setInsertRowNum(e.target.value)} placeholder="행 번호" onKeyDown={e => e.key === "Enter" && insertRow()} style={{ width: 70, padding: "6px 8px", border: "1px solid #d0d5dd", borderRadius: 6, fontSize: 13, outline: "none" }} />
          <button onClick={insertRow} style={{ ...btnStyle("#3182ce"), padding: "6px 14px", fontSize: 13 }}>삽입</button>
        </div>
        <button onClick={addRow} style={{ ...btnStyle("#2d5a8e"), padding: "8px 18px", fontSize: 13 }}>+ 새 행 추가</button>
        <div style={{ flex: 1 }} />
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="🔍 검색 (과제명, 내용, 작성자...)" style={{ width: 260, padding: "8px 14px", border: "1px solid #d0d5dd", borderRadius: 10, fontSize: 13, background: "#fff", outline: "none" }} />
        <span style={{ fontSize: 12, color: "#888" }}>{filteredIndices.length}건</span>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", overflowX: "auto", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "linear-gradient(135deg, #1a365d, #2d5a8e)", color: "#fff" }}>
              {["No","과제명","내용","작성일","작성자","제정/개정","순번","계획서 문서번호","보고서 문서번호","비고","수정",""].map((h, i) => (
                <th key={i} style={{ padding: "12px 8px", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", borderBottom: "2px solid #1a365d", ...(h === "수정" ? { background: "#c53030" } : {}), ...(h === "" ? { width: 36 } : {}) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredIndices.map((idx) => {
              const row = rows[idx];
              const rowNum = idx + 1;
              const isComplete = row.project && row.detail && row.date && row.author && row.revision;
              const bg = row.editMode ? "#fffbeb" : idx % 2 === 0 ? "#fff" : "#f8fafc";
              return (
                <tr key={row.id} style={{ background: bg, transition: "background 0.2s" }}>
                  <td style={cellStyle({ textAlign: "center", color: "#888", fontWeight: 600, width: 36 })}>{rowNum}</td>
                  <td style={cellStyle({ minWidth: 110 })}>
                    <select value={row.project} onChange={e => updateRow(idx, "project", e.target.value)} style={inputStyle}>
                      <option value="">선택</option>
                      {PROJECT_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                      {row.project && !PROJECT_CODES.includes(row.project) && <option value={row.project}>{row.project}</option>}
                    </select>
                  </td>
                  <td style={cellStyle({ minWidth: 200 })}>
                    <input value={row.detail} onChange={e => updateRow(idx, "detail", e.target.value)} style={inputStyle} placeholder="내용 입력" />
                  </td>
                  <td style={cellStyle({ width: 90 })}>
                    <input value={row.date} onChange={e => updateRow(idx, "date", e.target.value)} style={{ ...inputStyle, textAlign: "center" }} placeholder="YYMMDD" maxLength={6} />
                  </td>
                  <td style={cellStyle({ width: 80 })}>
                    <input value={row.author} onChange={e => updateRow(idx, "author", e.target.value)} style={{ ...inputStyle, textAlign: "center" }} placeholder="이름" />
                  </td>
                  <td style={cellStyle({ width: 80 })}>
                    <select value={row.revision} onChange={e => updateRow(idx, "revision", e.target.value)} style={{ ...inputStyle, textAlign: "center" }}>
                      <option value="">선택</option>
                      <option value="제정">제정</option>
                      <option value="개정">개정</option>
                    </select>
                  </td>
                  <td style={cellStyle({ textAlign: "center", width: 50, background: "#f1f5f9", fontWeight: 700, color: "#1a365d" })}>{row.seq || ""}</td>
                  <td style={cellStyle({ minWidth: 160, fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: isComplete ? "#1a365d" : "#ccc" })}>
                    {row.editMode ? (
                      <input value={row.protocol} onChange={e => handleManualProtocol(idx, e.target.value)} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, fontWeight: 600, background: "#fffbeb", border: "2px solid #eab308" }} />
                    ) : row.protocol}
                  </td>
                  <td style={cellStyle({ minWidth: 160, fontFamily: "monospace", fontSize: 12, color: isComplete ? "#555" : "#ccc" })}>{row.report}</td>
                  <td style={cellStyle({ minWidth: 100 })}>
                    <input value={row.note || ""} onChange={e => updateRow(idx, "note", e.target.value)} style={inputStyle} />
                  </td>
                  <td style={cellStyle({ textAlign: "center", width: 56 })}>
                    <button onClick={() => handleEditToggle(idx)} style={{ padding: "4px 8px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, background: row.editMode ? "#eab308" : "#e2e8f0", color: row.editMode ? "#fff" : "#555" }}>
                      {row.editMode ? "완료" : "수정"}
                    </button>
                  </td>
                  <td style={cellStyle({ width: 36, textAlign: "center" })}>
                    <button onClick={() => deleteRow(idx)} style={{ padding: "2px 6px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 14, background: "transparent", color: "#ccc" }} title="행 삭제">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ maxWidth: 1400, margin: "16px auto 0", display: "flex", gap: 16, fontSize: 12, color: "#666" }}>
        <span>총 {rows.length}건</span>
        <span>제정 {rows.filter(r => r.revision === "제정").length}건</span>
        <span>개정 {rows.filter(r => r.revision === "개정").length}건</span>
        <span>미완성 {rows.filter(r => !r.seq).length}건</span>
      </div>

      {showPwModal !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#1a365d" }}>🔒 문서번호 수정 권한 확인</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666" }}>{showPwModal + 1}행의 문서번호를 수정하려면 비밀번호를 입력하세요.</p>
            <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePwSubmit()} placeholder="비밀번호 입력" autoFocus style={{ width: "100%", padding: "10px 14px", border: "2px solid #d0d5dd", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowPwModal(null); setPwInput(""); }} style={{ ...btnStyle("#888"), padding: "8px 20px" }}>취소</button>
              <button onClick={handlePwSubmit} style={{ ...btnStyle("#1a365d"), padding: "8px 20px" }}>확인</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", padding: "12px 24px", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, zIndex: 1001, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", background: toast.type === "error" ? "#e53e3e" : toast.type === "success" ? "#38a169" : "#3182ce" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
