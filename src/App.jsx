import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { db } from "./firebase.js";
import { collection, doc, getDocs, setDoc, onSnapshot, deleteDoc, writeBatch } from "firebase/firestore";

const EDIT_PASSWORD = "admin1234";

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
      if (rows[i].revision === "제정" && `${rows[i].project}|${rows[i].detail}` === key && rows[i].seq) return rows[i].seq;
    }
    return null;
  }
  return null;
}

function calcRevision(rows, idx, seq) {
  if (!seq) return 0;
  let count = 0;
  for (let i = 0; i <= idx; i++) { if (rows[i].seq === seq) count++; }
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
  return { id, project: "", detail: "", date: "", author: "", revision: "", seq: null, protocol: "", report: "", note: "", editMode: false, manualProtocol: false, order: Date.now() };
}

function rowToFirestore(r) {
  return { project: r.project || "", detail: r.detail || "", date: r.date || "", author: r.author || "", revision: r.revision || "", seq: r.seq || null, protocol: r.protocol || "", report: r.report || "", note: r.note || "", manualProtocol: r.manualProtocol || false, order: r.order || 0 };
}

const btnStyle = (bg) => ({ padding: "8px 16px", borderRadius: 8, border: "none", background: bg, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" });
const cellStyle = (extra = {}) => ({ padding: "6px 8px", borderBottom: "1px solid #edf2f7", ...extra });
const inputStyle = { width: "100%", padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, outline: "none", background: "transparent", boxSizing: "border-box" };

export default function App() {
  const [rows, setRows] = useState([]);
  const [projectCodes, setProjectCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [insertRowNum, setInsertRowNum] = useState("");
  const [showPwModal, setShowPwModal] = useState(null);
  const [pwInput, setPwInput] = useState("");
  const [toast, setToast] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectCode, setNewProjectCode] = useState("");
  const nextId = useRef(1);
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Firebase에서 데이터 로드 (실시간 동기화)
  useEffect(() => {
    const unsubRows = onSnapshot(collection(db, "rows"), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data(), editMode: false }));
      data.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (data.length > 0) {
        nextId.current = Math.max(...data.map(r => parseInt(r.id) || 0), 0) + 1;
      }
      setRows(recomputeAll(data));
      setLoading(false);
    });
    const unsubCodes = onSnapshot(collection(db, "projectCodes"), (snap) => {
      const codes = snap.docs.map(d => d.data().code).filter(Boolean);
      codes.sort();
      setProjectCodes(codes);
    });
    return () => { unsubRows(); unsubCodes(); };
  }, []);

  // rows 변경 시 Firebase에 저장 (디바운스)
  const saveToFirebase = useCallback((updatedRows) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const batch = writeBatch(db);
        updatedRows.forEach(r => {
          batch.set(doc(db, "rows", String(r.id)), rowToFirestore(r));
        });
        await batch.commit();
      } catch (e) { console.error("저장 실패:", e); }
    }, 800);
  }, []);

  const updateRow = useCallback((idx, field, value) => {
    setRows(prev => {
      const next = prev.map(r => ({ ...r }));
      next[idx] = { ...next[idx], [field]: value };
      const computed = recomputeAll(next);
      saveToFirebase(computed);
      return computed;
    });
  }, [saveToFirebase]);

  const addRow = useCallback(() => {
    const id = nextId.current++;
    const newRow = { ...emptyRow(id), id: String(id) };
    setRows(prev => {
      const next = recomputeAll([...prev, newRow]);
      saveToFirebase(next);
      return next;
    });
  }, [saveToFirebase]);

  const insertRowFn = useCallback(() => {
    const num = parseInt(insertRowNum);
    if (isNaN(num) || num < 1 || num > rows.length) {
      showToast(`1~${rows.length} 사이의 행 번호를 입력해주세요.`, "error");
      return;
    }
    const idx = num - 1;
    const source = rows[idx];
    const id = nextId.current++;
    const newRow = { ...emptyRow(id), id: String(id), project: source.project, detail: source.detail, revision: source.revision, order: (source.order || 0) - 1 };
    setRows(prev => {
      const next = [...prev];
      next.splice(idx, 0, newRow);
      next.forEach((r, i) => { r.order = i; });
      const computed = recomputeAll(next);
      saveToFirebase(computed);
      return computed;
    });
    setInsertRowNum("");
    showToast(`${num}행 위에 새 행을 삽입했습니다.`);
  }, [insertRowNum, rows, showToast, saveToFirebase]);

  const deleteRow = useCallback(async (idx) => {
    if (rows.length <= 1) return;
    const rowId = rows[idx].id;
    try { await deleteDoc(doc(db, "rows", String(rowId))); } catch (e) { console.error(e); }
    setRows(prev => recomputeAll(prev.filter((_, i) => i !== idx)));
    showToast("행이 삭제되었습니다.");
  }, [rows, showToast]);

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
              next[idx].seq = parseInt(afterMvp.substring(0, dashIdx)) || next[idx].seq;
            }
          }
          next[idx].report = p.replace("MVP", "MVR");
        }
        const computed = recomputeAll(next);
        saveToFirebase(computed);
        return computed;
      });
      showToast("수정 모드를 해제했습니다.");
    } else {
      setShowPwModal(idx);
      setPwInput("");
    }
  }, [rows, showToast, saveToFirebase]);

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
          const parsed = parseInt(afterMvp.substring(0, dashIdx));
          if (!isNaN(parsed)) next[idx].seq = parsed;
        }
      }
      return next;
    });
  }, []);

  const addProjectCode = useCallback(async () => {
    const code = newProjectCode.trim();
    if (!code) return;
    if (projectCodes.includes(code)) { showToast("이미 존재하는 과제코드입니다.", "error"); return; }
    try {
      await setDoc(doc(db, "projectCodes", code), { code });
      setNewProjectCode("");
      showToast(`과제코드 "${code}" 추가 완료!`, "success");
    } catch (e) { showToast("추가 실패: " + e.message, "error"); }
  }, [newProjectCode, projectCodes, showToast]);

  const removeProjectCode = useCallback(async (code) => {
    if (!confirm(`"${code}" 과제코드를 삭제하시겠습니까?`)) return;
    try {
      await deleteDoc(doc(db, "projectCodes", code));
      showToast(`과제코드 "${code}" 삭제 완료!`);
    } catch (e) { showToast("삭제 실패: " + e.message, "error"); }
  }, [showToast]);

  const exportCSV = useCallback(() => {
    const BOM = "\uFEFF";
    const header = "No,과제명,내용,작성일,작성자,제정/개정,순번,계획서 문서번호,보고서 문서번호,비고";
    const body = rows.map((r, i) =>
      [i + 1, r.project, `"${(r.detail || "").replace(/"/g, '""')}"`, r.date, r.author, r.revision, r.seq || "", r.protocol, r.report, `"${(r.note || "").replace(/"/g, '""')}"`].join(",")
    );
    const blob = new Blob([BOM + [header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "문서번호대장.csv"; a.click();
    URL.revokeObjectURL(url);
    showToast("CSV 파일이 다운로드되었습니다.", "success");
  }, [rows, showToast]);

  const filteredIndices = useMemo(() => {
    if (!searchTerm.trim()) return rows.map((_, i) => i);
    const term = searchTerm.toLowerCase();
    return rows.reduce((acc, r, i) => {
      if ([r.project, r.detail, r.author, r.protocol, r.note].some(v => (v || "").toLowerCase().includes(term))) acc.push(i);
      return acc;
    }, []);
  }, [rows, searchTerm]);

  if (loading) return (
    <div style={{ fontFamily: "'Pretendard', sans-serif", display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#f0f2f5" }}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet" />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
        <div style={{ fontSize: 16, color: "#555" }}>데이터를 불러오는 중...</div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Pretendard', 'Noto Sans KR', sans-serif", background: "#f0f2f5", minHeight: "100vh", padding: "24px 16px" }}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css" rel="stylesheet" />

      {/* Header */}
      <div style={{ maxWidth: 1400, margin: "0 auto 20px", background: "linear-gradient(135deg, #1a365d 0%, #2d5a8e 100%)", borderRadius: 16, padding: "28px 32px", color: "#fff", boxShadow: "0 4px 20px rgba(26,54,93,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px" }}>📋 Method Validation 문서번호대장</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.8 }}>Protocol: 과제코드MVP번호-버전 &nbsp;|&nbsp; Report: 과제코드MVR번호-버전 &nbsp;|&nbsp; 실시간 공유 중</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setShowProjectModal(true)} style={btnStyle("#805ad5")}>📂 과제코드 관리</button>
            <button onClick={exportCSV} style={btnStyle("#38a169")}>📥 CSV 다운로드</button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ maxWidth: 1400, margin: "0 auto 16px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", borderRadius: 10, padding: "6px 12px", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <span style={{ fontSize: 13, color: "#555", whiteSpace: "nowrap" }}>행 삽입</span>
          <input type="number" min={1} max={rows.length} value={insertRowNum} onChange={e => setInsertRowNum(e.target.value)} placeholder="행 번호" onKeyDown={e => e.key === "Enter" && insertRowFn()} style={{ width: 70, padding: "6px 8px", border: "1px solid #d0d5dd", borderRadius: 6, fontSize: 13, outline: "none" }} />
          <button onClick={insertRowFn} style={{ ...btnStyle("#3182ce"), padding: "6px 14px", fontSize: 13 }}>삽입</button>
        </div>
        <button onClick={addRow} style={{ ...btnStyle("#2d5a8e"), padding: "8px 18px", fontSize: 13 }}>+ 새 행 추가</button>
        <div style={{ flex: 1 }} />
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="🔍 검색 (과제명, 내용, 작성자...)" style={{ width: 260, padding: "8px 14px", border: "1px solid #d0d5dd", borderRadius: 10, fontSize: 13, background: "#fff", outline: "none" }} />
        <span style={{ fontSize: 12, color: "#888" }}>{filteredIndices.length}건</span>
      </div>

      {/* Table */}
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
            {filteredIndices.length === 0 ? (
              <tr><td colSpan={12} style={{ padding: 40, textAlign: "center", color: "#aaa" }}>
                {rows.length === 0 ? '아직 데이터가 없습니다. "새 행 추가" 버튼을 클릭하세요.' : "검색 결과가 없습니다."}
              </td></tr>
            ) : filteredIndices.map((idx) => {
              const row = rows[idx];
              const rowNum = idx + 1;
              const isComplete = row.project && row.detail && row.date && row.author && row.revision;
              const bg = row.editMode ? "#fffbeb" : idx % 2 === 0 ? "#fff" : "#f8fafc";
              return (
                <tr key={row.id} style={{ background: bg }}>
                  <td style={cellStyle({ textAlign: "center", color: "#888", fontWeight: 600, width: 36 })}>{rowNum}</td>
                  <td style={cellStyle({ minWidth: 110 })}>
                    <select value={row.project} onChange={e => updateRow(idx, "project", e.target.value)} style={inputStyle}>
                      <option value="">선택</option>
                      {projectCodes.map(c => <option key={c} value={c}>{c}</option>)}
                      {row.project && !projectCodes.includes(row.project) && <option value={row.project}>{row.project}</option>}
                    </select>
                  </td>
                  <td style={cellStyle({ minWidth: 200 })}><input value={row.detail || ""} onChange={e => updateRow(idx, "detail", e.target.value)} style={inputStyle} placeholder="내용 입력" /></td>
                  <td style={cellStyle({ width: 90 })}><input value={row.date || ""} onChange={e => updateRow(idx, "date", e.target.value)} style={{ ...inputStyle, textAlign: "center" }} placeholder="YYMMDD" maxLength={6} /></td>
                  <td style={cellStyle({ width: 80 })}><input value={row.author || ""} onChange={e => updateRow(idx, "author", e.target.value)} style={{ ...inputStyle, textAlign: "center" }} placeholder="이름" /></td>
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
                      <input value={row.protocol || ""} onChange={e => handleManualProtocol(idx, e.target.value)} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, fontWeight: 600, background: "#fffbeb", border: "2px solid #eab308" }} />
                    ) : row.protocol}
                  </td>
                  <td style={cellStyle({ minWidth: 160, fontFamily: "monospace", fontSize: 12, color: isComplete ? "#555" : "#ccc" })}>{row.report}</td>
                  <td style={cellStyle({ minWidth: 100 })}><input value={row.note || ""} onChange={e => updateRow(idx, "note", e.target.value)} style={inputStyle} /></td>
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

      {/* Summary */}
      <div style={{ maxWidth: 1400, margin: "16px auto 0", display: "flex", gap: 16, fontSize: 12, color: "#666" }}>
        <span>총 {rows.length}건</span>
        <span>제정 {rows.filter(r => r.revision === "제정").length}건</span>
        <span>개정 {rows.filter(r => r.revision === "개정").length}건</span>
        <span>미완성 {rows.filter(r => !r.seq).length}건</span>
      </div>

      {/* 과제코드 관리 모달 */}
      {showProjectModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 400, maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, color: "#1a365d" }}>📂 과제코드 관리</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <input value={newProjectCode} onChange={e => setNewProjectCode(e.target.value)} onKeyDown={e => e.key === "Enter" && addProjectCode()} placeholder="새 과제코드 입력 (예: AD-116)" style={{ flex: 1, padding: "10px 14px", border: "2px solid #d0d5dd", borderRadius: 10, fontSize: 14, outline: "none" }} />
              <button onClick={addProjectCode} style={btnStyle("#805ad5")}>추가</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {projectCodes.length === 0 ? (
                <p style={{ color: "#aaa", fontSize: 13, textAlign: "center", padding: 20 }}>등록된 과제코드가 없습니다.</p>
              ) : projectCodes.map(code => (
                <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1a365d" }}>{code}</span>
                  <button onClick={() => removeProjectCode(code)} style={{ padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12, background: "#fee2e2", color: "#dc2626" }}>삭제</button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, textAlign: "right" }}>
              <button onClick={() => setShowProjectModal(false)} style={btnStyle("#888")}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 비밀번호 모달 */}
      {showPwModal !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "#1a365d" }}>🔒 문서번호 수정 권한 확인</h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#666" }}>{showPwModal + 1}행의 문서번호를 수정하려면 비밀번호를 입력하세요.</p>
            <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePwSubmit()} placeholder="비밀번호 입력" autoFocus style={{ width: "100%", padding: "10px 14px", border: "2px solid #d0d5dd", borderRadius: 10, fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowPwModal(null); setPwInput(""); }} style={btnStyle("#888")}>취소</button>
              <button onClick={handlePwSubmit} style={btnStyle("#1a365d")}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", padding: "12px 24px", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, zIndex: 1001, boxShadow: "0 4px 20px rgba(0,0,0,0.2)", background: toast.type === "error" ? "#e53e3e" : toast.type === "success" ? "#38a169" : "#3182ce" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
