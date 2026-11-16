/**
 * ==========================================================================
 * ระบบลงทะเบียนเข้างาน (Temple Event Registration System)
 * Frontend Application Logic & Google Sheets Integration
 * ==========================================================================
 */

// Default Deployed Google Apps Script Web App URL
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzulX29bL9Eb6heQeduhilfjEZWw_n6Q93LzJIJDM19qwMDpXn8-HJ5gfZvEEK-h9gdsA/exec";

// Application State
const state = {
  gasUrl: localStorage.getItem("TEMPLE_GAS_URL") || DEFAULT_GAS_URL,
  monks: [],
  walkinMonks: [],
  laypeople: [],
  slips: [],
  currentSelectedMonk: null,
  currentSlipMonk: null,
  editingWalkinId: null,
  editingLayId: null,
  webcamStream: null,
  receiverPhotoBase64: "",
  activeReportTab: "monks",
  smartCardConnected: false
};
window.state = state;

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initData();
  setupNavigation();
  SmartCardService.init();
  setupMonkWorkflow();
  setupLayWorkflow();
  setupSlipWorkflow();
  setupSettingsWorkflow();
  updateAllKpis();
  renderReportTable();
  clearRegistrationScreens();

  // Set input field value
  const inputElem = document.getElementById("settingsGasUrl");
  if (inputElem) inputElem.value = state.gasUrl;

  // Check GAS Connection & Fetch live data
  if (state.gasUrl) {
    testGasConnection(true).then(connected => {
      if (connected) {
        fetchLiveDataFromSheet();
        initRealtimeSync();
      }
    });
  }
});

function showResultPopup(title, subtitle, detailLines = []) {
  const modal = document.getElementById("registrationSuccessModal");
  const titleEl = document.getElementById("resultPopupTitle");
  const subEl = document.getElementById("resultPopupSubtitle");
  const detEl = document.getElementById("resultPopupDetails");
  if (!modal) return;

  if (titleEl) titleEl.textContent = title || "ลงทะเบียนสำเร็จแล้ว!";
  if (subEl) subEl.textContent = subtitle || "บันทึกข้อมูลเรียบร้อยแล้ว";
  if (detEl) {
    detEl.innerHTML = detailLines
      .filter(Boolean)
      .map(line => `<div>${line}</div>`)
      .join("");
  }
  modal.style.display = "flex";
  const closeBtn = document.getElementById("btnCloseResultPopup");
  if (closeBtn) setTimeout(() => closeBtn.focus(), 50);
}
window.showResultPopup = showResultPopup;

function closeResultPopup() {
  const modal = document.getElementById("registrationSuccessModal");
  if (modal) modal.style.display = "none";
}
window.closeResultPopup = closeResultPopup;

function extractThaiGivenName(fullName, explicitFirstName = "") {
  if (explicitFirstName && explicitFirstName.trim()) {
    return explicitFirstName.trim();
  }
  const clean = (fullName || "").replace(/#/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const noPrefix = clean
    .replace(/^(พระพรหม|พระราช|พระเทพ|พระธรรม|พระครู|พระมหา|พระอธิการ|พระปลัด|พระสมุห์|พระใบฎีกา|พระ|สามเณร|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)\s*/i, "")
    .trim();
  const parts = noPrefix.split(" ").filter(Boolean);
  return parts[0] || "";
}

function clearRegistrationScreens() {
  // เคลียร์ข้อมูลหน้าลงทะเบียนและฟอร์มค้างทั้งหมด (ไม่กระทบข้อมูลบน Google Sheets)
  state.currentSelectedMonk = null;
  state.currentSlipMonk = null;
  state.editingWalkinId = null;
  state.editingLayId = null;
  state.pendingMonkCid = "";

  const idsToClear = [
    "monkIdCardInput", "monkFilterName", "monkFilterBranch", "monkFilterTemple",
    "infoMonkIdCard", "infoMonkPhone", "infoMonkHotel",
    "walkinIdCard", "walkinName", "walkinTemple", "walkinVassa", "walkinProvince", "walkinPhone",
    "layIdCard", "layName", "layBirthday", "layAddress", "layPhone", "layEmergencyPhone",
    "slipSearchMonk", "slipSearchBranch", "slipSearchTemple",
    "slipRecTemple", "slipRecMonkName", "slipRecAmount"
  ];
  idsToClear.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  if (typeof resetMonkWorkflow === "function") resetMonkWorkflow();
  if (typeof resetLayWorkflow === "function") resetLayWorkflow();
  if (typeof resetSlipWorkflow === "function") resetSlipWorkflow();
}
window.clearRegistrationScreens = clearRegistrationScreens;

/**
 * --------------------------------------------------------------------------
 * Data Initialization & Persistence
 * --------------------------------------------------------------------------
 */
function initData() {
  // Always prioritize clean data from monks_data.js and merge registration statuses
  const initialList = window.INITIAL_MONKS_DATA || [];
  const savedMonks = localStorage.getItem("TEMPLE_MONKS_DATA");
  let savedMap = {};
  if (savedMonks) {
    try {
      const arr = JSON.parse(savedMonks);
      arr.forEach(sm => { if (sm && sm.id) savedMap[sm.id] = sm; });
    } catch (e) { }
  }

  state.monks = initialList.map(im => {
    const saved = savedMap[im.id];
    const monkNum = parseInt(im.id.replace("MK", "")) || 1;
    const realPhoto = `assets/monks/monk_row_${monkNum + 1}.jpg`;
    const colKValue = (im.slipRight || im._colK || im["สิทธิ์รับใบปวารณา"] || (im.allowSlip ? "มีสิทธิ์" : "") || "").toString().trim();
    const colIValue = (im.phone && im.phone !== "-") ? im.phone.toString().trim() : "";
    const colJValue = (im.hotel && !im.hotel.includes("สิรินธร") && !im.hotel.includes("ธรรมรุจ")) ? im.hotel.toString().trim() : "";

    if (saved) {
      return {
        ...im,
        ...saved,
        photo: realPhoto,
        idCard: (saved.idCard && !saved.idCard.startsWith("1-0000-00000-")) ? saved.idCard : (im.idCard || ""),
        hotel: (saved.hotel !== undefined && saved.hotel !== null && saved.hotel !== "") ? saved.hotel : colJValue,
        slipRight: colKValue,
        phone: (saved.phone !== undefined && saved.phone !== null && saved.phone !== "" && saved.phone !== "-") ? saved.phone : colIValue,
        amount: saved.amount || 0
      };
    }
    return {
      ...im,
      photo: realPhoto,
      idCard: im.idCard || "",
      hotel: colJValue,
      slipRight: colKValue,
      phone: colIValue,
      amount: 0
    };
  });
  saveLocal("TEMPLE_MONKS_DATA", state.monks);

  // Load walkin monks
  const savedWalkin = localStorage.getItem("TEMPLE_WALKIN_DATA");
  state.walkinMonks = savedWalkin ? JSON.parse(savedWalkin) : [];

  // Load laypeople (เคลียร์ข้อมูลตัวอย่างออกจากระบบตามคำสั่งผู้ใช้)
  const savedLay = localStorage.getItem("TEMPLE_LAY_DATA");
  let rawLay = savedLay ? JSON.parse(savedLay) : [];
  const sampleNames = ["นายสมชาย ใจดี", "นางสาวศิริพร บุญรักษา", "นายวิเชียร สุขสมบูรณ์", "นายทดสอบ ใจศรัทธา", "ผู้ทดสอบ เสียบบัตรประชาชน"];
  state.laypeople = (rawLay || []).filter(l => l && !sampleNames.includes(l.name) && !l.id?.startsWith("LP999"));
  saveLocal("TEMPLE_LAY_DATA", state.laypeople);

  // Load slips
  const savedSlips = localStorage.getItem("TEMPLE_SLIPS_DATA");
  state.slips = savedSlips ? JSON.parse(savedSlips) : [];

  // Populate monk quick selector dropdown
  populateMonkQuickSelect();
  // Populate datalist of temples
  populateTempleDatalist();
}

function saveLocal(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("LocalStorage write error:", e);
  }
}

/**
 * --------------------------------------------------------------------------
 * Smart Card Reader Service & Hardware Diagnostics
 * --------------------------------------------------------------------------
 */
const SmartCardService = {
  ws: null,
  isConnected: false,
  agentUrl: "ws://localhost:8084",

  init() {
    this.connect();
    this.setupListeners();
  },

  connect() {
    try {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      this.ws = new WebSocket(this.agentUrl);
      this.ws.onopen = () => {
        this.isConnected = true;
        state.smartCardConnected = true;
        this.updateUI("connected", "เครื่องอ่านบัตร: เชื่อมต่อแล้ว (พร้อมอ่านบัตร)");
        showToast("✓ เชื่อมต่อบริการเครื่องอ่านบัตรประชาชน (Smart Card Agent) สำเร็จ", "success");
      };
      this.ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          this.handleCardMessage(raw);
        } catch (e) {
          console.log("Card message:", event.data);
        }
      };
      this.ws.onclose = () => {
        this.isConnected = false;
        state.smartCardConnected = false;
        this.updateUI("disconnected", "เครื่องอ่านบัตร: ออฟไลน์ / โหมดป้อนเลขบัตร");
        setTimeout(() => this.connect(), 3000);
      };
      this.ws.onerror = () => {
        this.isConnected = false;
        state.smartCardConnected = false;
        this.updateUI("disconnected", "เครื่องอ่านบัตร: ออฟไลน์ / โหมดป้อนเลขบัตร");
      };
    } catch (e) {
      this.isConnected = false;
      state.smartCardConnected = false;
      this.updateUI("disconnected", "เครื่องอ่านบัตร: ออฟไลน์ / โหมดป้อนเลขบัตร");
    }
  },

  updateUI(status, text) {
    const pill = document.getElementById("smartCardStatusPill");
    const pillText = document.getElementById("cardStatusPillText");
    const dot = document.getElementById("cardStatusDot");
    const textMonk = document.getElementById("cardReaderTextMonk");
    const textLay = document.getElementById("cardReaderTextLay");

    if (pill) {
      pill.className = status === "connected" ? "smartcard-status-pill connected" : "smartcard-status-pill";
    }
    if (pillText) pillText.textContent = text;
    if (dot) {
      dot.style.background = status === "connected" ? "#10b981" : "#94a3b8";
    }
    if (textMonk) textMonk.textContent = status === "connected" ? "🟢 เครื่องอ่านออนไลน์ (พร้อมเสียบบัตร)" : "⚪ โหมดป้อนเลขบัตร / รอเสียบบัตร";
    if (textLay) textLay.textContent = status === "connected" ? "🟢 เครื่องอ่านออนไลน์ (พร้อมอ่านบัตร)" : "⚪ โหมดป้อนข้อมูล / รอเสียบบัตร";
  },

  setupListeners() {
    document.getElementById("smartCardStatusPill")?.addEventListener("click", () => {
      openCardReaderModal();
    });

    document.querySelectorAll(".btn-check-card-reader").forEach(btn => {
      btn.addEventListener("click", () => {
        openCardReaderModal();
      });
    });
  },

  handleCardMessage(raw) {
    const data = raw.data || raw;
    const cid = (data.cid || data.idCard || data.CitizenNo || data.id || "").toString().replace(/[-\s]/g, "");
    if (!cid || cid.length < 10) return;

    let fullname = "";
    if (data.nameTh || data.thaiName || data.fullname) {
      fullname = (data.nameTh || data.thaiName || data.fullname).replace(/#/g, " ").trim();
    } else if (data.title || data.firstName || data.lastName) {
      fullname = `${data.title || ""} ${data.firstName || ""} ${data.lastName || ""}`.replace(/\s+/g, " ").trim();
    }

    const givenName = extractThaiGivenName(fullname, data.firstName || data.given || "");

    let birthday = "";
    const rawDob = (data.dob || data.birthDate || data.birthday || "").toString();
    if (rawDob.length === 8 && !rawDob.includes("/")) {
      const y = rawDob.substring(0, 4);
      const m = rawDob.substring(4, 6);
      const d = rawDob.substring(6, 8);
      birthday = `${d}/${m}/${y}`;
    } else {
      birthday = rawDob;
    }

    let gender = "ชาย";
    if (data.gender === "2" || data.gender === 2 || data.gender === "หญิง" || (data.gender && data.gender.includes("F"))) {
      gender = "หญิง";
    }

    const address = (data.address || data.homeAddress || "").replace(/#/g, " ").trim();
    const photoBase64 = data.photoBase64 || data.photo || "";

    const cardObj = {
      idCard: cid,
      given: givenName,
      name: fullname,
      birthday: birthday,
      gender: gender,
      address: address,
      photo: photoBase64
    };
    this.lastCardData = cardObj;
    updateCardMappingTable(cardObj);

    const activeTab = document.querySelector(".nav-tab.active")?.getAttribute("data-tab");
    if (activeTab === "tab-monk") {
      state.pendingMonkCid = cid;
      state.pendingMonkCardData = cardObj;
      // ถ้าเสียบบัตรอยู่ ใช้เลขบัตรประชาชนหรือชื่อตัวเป็นตัวกรองในลิสต์ 1.1 & 1.2
      const input = document.getElementById("monkIdCardInput");
      if (input) input.value = givenName || cid;
      monkFilterState.cardOrName = cid;
      monkFilterState.cardGiven = givenName || "";
      renderMonkSelectTable();

      const matches = getFilteredMonksList();
      if (matches.length === 1 && !matches[0]._isWalkin) {
        const monk = state.monks.find(m => m.id === matches[0].id);
        if (monk) {
          if (!monk.idCard) monk.idCard = cid;
          displayInvitedMonk(monk, true);
          showToast(`✓ พบบัตรตรงกับรายชื่อ: ${monk.name} (${monk.temple})`, "success");
        }
      } else if (matches.length > 0) {
        showToast(`🔍 กรองรายชื่อจากบัตรได้ ${matches.length} รูป กรุณาคลิกเลือกจากลิสต์`, "info");
      } else {
        showToast(`ไม่พบในลิสต์ — กรุณากดปุ่ม '➕ เพิ่มพระนอกรายชื่อ' เพื่อลงทะเบียนจากบัตร`, "warning");
      }
    } else if (activeTab === "tab-lay") {
      onLayCardRead(cardObj);
    } else {
      showToast(`ตรวจพบบัตรประชาชน: ${fullname || cid}`, "info");
    }
  },

  readCurrentCard(targetTab = "tab-lay") {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "read", command: "read_card" }));
      showToast("กำลังส่งคำสั่งอ่านข้อมูลจากเครื่องอ่านบัตร...", "info");
      return;
    }

    fetch("http://localhost:8084/api/card", { method: "GET" })
      .then(res => res.json())
      .then(data => {
        this.handleCardMessage(data);
      })
      .catch(() => {
        openCardReaderModal();
      });
  }
};

window.SmartCardService = SmartCardService;

function openCardReaderModal() {
  const modal = document.getElementById("cardReaderModal");
  if (modal) modal.style.display = "flex";
  runCardReaderDiagnostics();
}
window.openCardReaderModal = openCardReaderModal;

function closeCardReaderModal() {
  const modal = document.getElementById("cardReaderModal");
  if (modal) modal.style.display = "none";
}
window.closeCardReaderModal = closeCardReaderModal;

function runCardReaderDiagnostics() {
  const agentBadge = document.getElementById("diagAgentBadge");
  const agentText = document.getElementById("diagAgentText");
  const hwBadge = document.getElementById("diagHardwareBadge");
  const hwText = document.getElementById("diagHardwareText");
  const slotBadge = document.getElementById("diagCardSlotBadge");
  const slotText = document.getElementById("diagCardSlotText");

  if (agentBadge) {
    agentBadge.className = "status-badge pending";
    agentBadge.textContent = "กำลังตรวจสอบ...";
  }

  fetch("http://localhost:8084/api/status", { method: "GET" })
    .then(res => res.json())
    .then(st => {
      if (agentBadge) {
        agentBadge.className = "status-badge registered";
        agentBadge.textContent = "ออนไลน์ (พอร์ต 8084)";
      }
      if (agentText) agentText.textContent = "Smart Card Bridge พอร์ต 8084 พร้อมทำงาน";

      if (st.readerDetected) {
        if (hwBadge) {
          hwBadge.className = "status-badge registered";
          hwBadge.textContent = "พบเครื่องอ่านบัตร";
        }
        if (hwText) hwText.textContent = `พบอุปกรณ์: ${st.readerName || (st.readers || []).join(", ")}`;
      } else {
        if (hwBadge) {
          hwBadge.className = "status-badge pending";
          hwBadge.textContent = "ไม่พบเครื่องอ่าน";
        }
        if (hwText) hwText.textContent = "ไม่พบเครื่องอ่านบัตร USB PC/SC กรุณาตรวจสอบสาย USB";
      }

      if (st.cardInserted) {
        if (slotBadge) {
          slotBadge.className = "status-badge registered";
          slotBadge.textContent = "เสียบบัตรแล้ว";
        }
        if (slotText) slotText.textContent = "ตรวจพบบัตรประชาชนในช่องเสียบ — กด 'อ่านข้อมูลจากบัตรที่เสียบอยู่' เพื่อตรวจสอบฟิลด์";
      } else {
        if (slotBadge) {
          slotBadge.className = "status-badge available";
          slotBadge.textContent = "รอเสียบบัตร";
        }
        if (slotText) slotText.textContent = "ยังไม่ได้เสียบบัตรประชาชนในช่องอ่านบัตร";
      }
    })
    .catch(() => {
      if (agentBadge) {
        agentBadge.className = "status-badge available";
        agentBadge.textContent = "ยังไม่พบ Agent";
      }
      if (agentText) agentText.textContent = "ไม่พบบริการ Smart Card Bridge (พอร์ต 8084) - กรุณารัน smartcard_bridge.ps1 หรือ start_server.bat";
      if (hwBadge) {
        hwBadge.className = "status-badge available";
        hwBadge.textContent = "รอเชื่อมต่อ Agent";
      }
      if (hwText) hwText.textContent = "ไม่สามารถตรวจสอบฮาร์ดแวร์ได้จนกว่าบริการพอร์ต 8084 จะออนไลน์";
    });
}
window.runCardReaderDiagnostics = runCardReaderDiagnostics;

function updateCardMappingTable(cardObj) {
  const setCell = (valId, statusId, val) => {
    const vEl = document.getElementById(valId);
    const sEl = document.getElementById(statusId);
    const hasVal = val && val.toString().trim() !== "";
    if (vEl) vEl.textContent = hasVal ? val : "-";
    if (sEl) {
      sEl.innerHTML = hasVal
        ? `<span class="status-badge registered" style="font-size:0.72rem;">✓ พร้อมกรอกลงฟิลด์</span>`
        : `<span class="status-badge pending" style="font-size:0.72rem;">⚠ ไม่มีข้อมูล</span>`;
    }
  };
  setCell("mapValCid", "mapStatusCid", cardObj.idCard);
  setCell("mapValGiven", "mapStatusGiven", cardObj.given || extractThaiGivenName(cardObj.name));
  setCell("mapValFullname", "mapStatusFullname", cardObj.name);
  setCell("mapValDob", "mapStatusDob", cardObj.birthday);
  setCell("mapValGender", "mapStatusGender", cardObj.gender);
  setCell("mapValAddress", "mapStatusAddress", cardObj.address);
  setCell("mapValPhoto", "mapStatusPhoto", cardObj.photo ? "รูปถ่าย JPEG จากชิปบัตร" : "");
}
window.updateCardMappingTable = updateCardMappingTable;

function testRealCardReadAndInspect() {
  showToast("กำลังอ่านข้อมูลจากบัตรประชาชนในเครื่องอ่าน...", "info");
  fetch("http://localhost:8084/api/card", { method: "GET" })
    .then(res => res.json())
    .then(data => {
      if (data.status === "error" || !data.cid) {
        showToast(`⚠️ ${data.message || "ไม่สามารถอ่านบัตรได้ กรุณาตรวจสอบว่าเสียบบัตรประชาชนแล้ว"}`, "warning");
        runCardReaderDiagnostics();
        return;
      }
      SmartCardService.handleCardMessage(data);
      runCardReaderDiagnostics();
      showToast(`✓ อ่านบัตรสำเร็จ: ${data.fullname || data.cid} (ตรวจสอบฟิลด์ในตารางได้เลย)`, "success");
    })
    .catch(() => {
      showToast("❌ ไม่สามารถเชื่อมต่อ Smart Card Bridge (พอร์ต 8084) ได้", "error");
      runCardReaderDiagnostics();
    });
}
window.testRealCardReadAndInspect = testRealCardReadAndInspect;

function testCardReadAction() {
  const input = document.getElementById("manualCardTestInput");
  const val = input ? input.value.trim() : "";
  if (!val) {
    showToast("กรุณากรอกเลขบัตร 13 หลักเพื่อทดสอบ", "warning");
    return;
  }

  closeCardReaderModal();

  const activeTab = document.querySelector(".nav-tab.active")?.getAttribute("data-tab");
  if (activeTab === "tab-monk") {
    const monkInput = document.getElementById("monkIdCardInput");
    if (monkInput) monkInput.value = val;
    triggerMonkScan(val, { idCard: val });
  } else if (activeTab === "tab-lay") {
    onLayCardRead({
      idCard: val,
      name: "ผู้มาติดต่อ (ทดสอบเสียบบัตร)",
      birthday: "15/08/2530",
      gender: "ชาย",
      address: "123 หมู่ 1 ต.ในเมือง อ.วารินชำราบ จ.อุบลราชธานี"
    });
  } else {
    showToast(`ทดสอบส่งเลขบัตร: ${val}`, "info");
  }
}
window.testCardReadAction = testCardReadAction;

/**
 * --------------------------------------------------------------------------
 * Navigation & Tab Switching
 * --------------------------------------------------------------------------
 */
function setupNavigation() {
  const tabs = document.querySelectorAll(".nav-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetId = tab.getAttribute("data-tab");
      switchTab(targetId);
    });
  });

  // Clicking the status pill navigates to settings
  document.getElementById("gsheetStatusPill").addEventListener("click", () => {
    switchTab("tab-settings");
  });
}

function switchTab(tabId) {
  // Update nav tabs
  document.querySelectorAll(".nav-tab").forEach(t => {
    t.classList.toggle("active", t.getAttribute("data-tab") === tabId);
  });

  // Update panes
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });

  // Refresh table when viewing report
  if (tabId === "tab-report") {
    renderReportTable();
  } else if (tabId === "tab-slip") {
    renderSlipMonksTable();
  }
}

/**
 * --------------------------------------------------------------------------
 * FLOW 1: ลงทะเบียนพระสงฆ์ (Monk Registration Workflow)
 * --------------------------------------------------------------------------
 */
// Filter state for Tab 1
const monkFilterState = {
  name: "",
  branch: "",
  temple: "",
  cardOrName: "",
  cardGiven: ""
};

function renderMonkSelectTable(customList = null) {
  const tbody = document.getElementById("monksSelectTableBody");
  const countEl = document.getElementById("monkFilterCount");
  if (!tbody) return;

  const list = customList || getFilteredMonksList();
  const totalCount = state.monks.length + state.walkinMonks.length;
  if (countEl) countEl.textContent = `แสดง ${list.length} รูป (นิมนต์ ${state.monks.length} + นอกรายชื่อ ${state.walkinMonks.length} = ${totalCount})`;

  tbody.innerHTML = "";
  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="text-align: center; color: #94a3b8; padding: 1.5rem;">ไม่พบรายนามพระสงฆ์ที่ตรงกับคำค้นหา</td>`;
    tbody.appendChild(tr);
    return;
  }

  // Display top 100 matches for high performance
  list.slice(0, 100).forEach((m, idx) => {
    const tr = document.createElement("tr");
    const isWalkin = !!m._isWalkin;
    const isReg = isWalkin || m.status === "ลงทะเบียนแล้ว";
    const isSelected = (!isWalkin && state.currentSelectedMonk && state.currentSelectedMonk.id === m.id)
      || (isWalkin && state.editingWalkinId && state.editingWalkinId === m.id);
    if (isSelected) tr.className = "selected-row";

    const walkinBadge = isWalkin
      ? ` <span class="status-badge pending" style="font-size:0.68rem; padding:0.1rem 0.4rem;">นอกรายชื่อ</span>`
      : "";

    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-weight: 600; color: #4e2e18;">${m.name || "-"}${walkinBadge}</td>
      <td>${m.temple || "-"}</td>
      <td>${m.branch || m.province || '-'}</td>
      <td><span class="status-badge ${isReg ? 'registered' : 'available'}">${isReg ? 'ลงแล้ว' : 'ยังไม่ลง'}</span></td>
    `;

    tr.addEventListener("click", () => {
      // Highlight row
      const allRows = tbody.querySelectorAll("tr");
      allRows.forEach(r => r.classList.remove("selected-row"));
      tr.classList.add("selected-row");

      // ถ้าคลิกในลิสต์ เท่ากับเคลียร์ชื่อ/เลขในช่องเสียบบัตรประชาชน 1.1 ตามคำสั่งผู้ใช้
      const topCardInput = document.getElementById("monkIdCardInput");
      if (topCardInput) topCardInput.value = "";
      const cardInd = document.getElementById("cardStatusIndicator");
      if (cardInd) cardInd.style.display = "none";

      // ซ่อนป้าย notice ต่างๆ
      const heldNotice = document.getElementById("monkCardHeldNotice");
      if (heldNotice) heldNotice.style.display = "none";

      if (isWalkin) {
        displayWalkinMonkForm(m.idCard || m.id, m);
      } else {
        // แสดงข้อมูลพระที่เลือกในแบบฟอร์ม 1.3 (เพื่อเพิ่มหรือแก้ไขเลขบัตรประชาชนลงฐานข้อมูลได้)
        displayInvitedMonk(m, false);
      }
    });

    tbody.appendChild(tr);
  });
}

function getFilteredMonksList() {
  const fName = (monkFilterState.name || "").toLowerCase().trim();
  const fBranch = (monkFilterState.branch || "").toLowerCase().trim();
  const fTemple = (monkFilterState.temple || "").toLowerCase().trim();
  const fCardOrName = (monkFilterState.cardOrName || "").toLowerCase().trim();
  const fCardClean = fCardOrName.replace(/[-\s]/g, "");
  const fCardGiven = (monkFilterState.cardGiven || "").toLowerCase().trim();

  const filterFn = (m) => {
    const mName = (m.name || "").toLowerCase();
    const mBranch = (m.branch || m.province || "").toLowerCase();
    const mTemple = (m.temple || "").toLowerCase();
    const mCard = (m.idCard || "").toString().replace(/[-\s]/g, "").toLowerCase();

    const matchName = !fName || mName.includes(fName);
    const matchBranch = !fBranch || mBranch.includes(fBranch);
    const matchTemple = !fTemple || mTemple.includes(fTemple);
    const matchCardOrName = !fCardOrName
      || (mCard && fCardClean && mCard === fCardClean)
      || mName.includes(fCardOrName)
      || (fCardGiven && mName.includes(fCardGiven));

    return matchName && matchBranch && matchTemple && matchCardOrName;
  };

  const walkins = (state.walkinMonks || []).filter(filterFn).map(w => ({ ...w, _isWalkin: true }));
  const invited = (state.monks || []).filter(filterFn).map(m => ({ ...m, _isWalkin: false }));
  return [...walkins, ...invited];
}

    return matchName && matchBranch && matchTemple;
  });
}

// Backward compatibility for existing calls
function populateMonkQuickSelect() {
  renderMonkSelectTable();
}

function populateTempleDatalist() {
  const datalist = document.getElementById("templeList");
  if (!datalist) return;
  datalist.innerHTML = "";
  const uniqueTemples = [...new Set(state.monks.map(m => m.temple).filter(Boolean))].sort();
  uniqueTemples.forEach(temple => {
    const opt = document.createElement("option");
    opt.value = temple;
    datalist.appendChild(opt);
  });
}

function setupMonkWorkflow() {
  const btnScan = document.getElementById("btnMonkScan");
  const inputCard = document.getElementById("monkIdCardInput");

  if (btnScan && inputCard) {
    btnScan.addEventListener("click", () => {
      const val = inputCard.value.trim();
      if (!val) {
        showToast("กรุณาเสียบบัตรประชาชน หรือพิมพ์เลขบัตร/ชื่อพระ", "warning");
        return;
      }
      monkFilterState.cardOrName = val;
      monkFilterState.cardGiven = "";
      renderMonkSelectTable();
      const matches = getFilteredMonksList();
      if (matches.length === 0) {
        showToast("ไม่พบในลิสต์ — กรุณากดปุ่ม '➕ เพิ่มพระนอกรายชื่อ' เพื่อลงทะเบียน", "warning");
      }
    });

    inputCard.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        btnScan.click();
      }
    });

    inputCard.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      monkFilterState.cardOrName = val;
      monkFilterState.cardGiven = "";
      renderMonkSelectTable();
      const cardInd = document.getElementById("cardStatusIndicator");
      if (cardInd) {
        if (val.length >= 2) {
          cardInd.style.display = "block";
          cardInd.style.color = "#4e2e18";
          cardInd.innerHTML = `🔍 <strong>ตัวกรอง 1.1:</strong> "${val}"`;
        } else {
          cardInd.style.display = "none";
        }
      }
    });
  }

  // 1.2 Filters (เหมือน 3.1)
  const inputFName = document.getElementById("monkFilterName");
  const inputFBranch = document.getElementById("monkFilterBranch");
  const inputFTemple = document.getElementById("monkFilterTemple");
  const btnFilterSearch = document.getElementById("btnMonkFilterSearch");
  const btnFilterClear = document.getElementById("btnMonkFilterClear");

  function applyFilters() {
    monkFilterState.name = inputFName?.value || "";
    monkFilterState.branch = inputFBranch?.value || "";
    monkFilterState.temple = inputFTemple?.value || "";
    renderMonkSelectTable();
  }

  if (inputFName) inputFName.addEventListener("input", applyFilters);
  if (inputFBranch) inputFBranch.addEventListener("input", applyFilters);
  if (inputFTemple) inputFTemple.addEventListener("input", applyFilters);

  if (btnFilterSearch) {
    btnFilterSearch.addEventListener("click", applyFilters);
  }

  if (btnFilterClear) {
    btnFilterClear.addEventListener("click", () => {
      if (inputFName) inputFName.value = "";
      if (inputFBranch) inputFBranch.value = "";
      if (inputFTemple) inputFTemple.value = "";
      monkFilterState.name = "";
      monkFilterState.branch = "";
      monkFilterState.temple = "";
      renderMonkSelectTable();
    });
  }

  // Confirm Registration Button (1.3)
  const btnConfirmReg = document.getElementById("btnConfirmMonkRegistration");
  if (btnConfirmReg) {
    btnConfirmReg.addEventListener("click", () => {
      if (!state.currentSelectedMonk) return;
      confirmMonkRegistration(state.currentSelectedMonk);
    });
  }

  // Save Walkin Monk Button (1.4)
  const btnSaveWalkin = document.getElementById("btnSaveWalkinMonk");
  if (btnSaveWalkin) {
    btnSaveWalkin.addEventListener("click", () => {
      saveWalkinMonk();
    });
  }

  // Live validation on Walkin Citizen ID input (Primary Key)
  const inputWalkinId = document.getElementById("walkinIdCard");
  if (inputWalkinId) {
    inputWalkinId.addEventListener("input", () => {
      const val = inputWalkinId.value.trim();
      const cleanVal = val.replace(/[-\s]/g, "");
      if (cleanVal.length >= 10 && !cleanVal.includes("x")) {
        // เช็คกับพระสงฆ์ที่นิมนต์
        const monkInvited = state.monks.find(m => (m.idCard || "").replace(/[-\s]/g, "") === cleanVal);
        if (monkInvited) {
          showToast(`⚠️ เลขบัตรประชาชนนี้อยู่ในรายนาม 'พระสงฆ์ที่นิมนต์' แล้ว: ${monkInvited.name}`, "warning");
          displayInvitedMonk(monkInvited, true);
          return;
        }

        // เช็คกับพระนอกรายชื่อเดิม
        const existing = state.walkinMonks.find(w => (w.idCard || "").replace(/[-\s]/g, "") === cleanVal);
        if (existing) {
          state.editingWalkinId = existing.id;
          displayWalkinMonkForm(val);
          showToast(`✓ พบข้อมูลเดิมในระบบ: ${existing.name} วัด ${existing.temple} (สถานะ: อัปเดตข้อมูล)`, "info");
        } else {
          state.editingWalkinId = null;
          const badgeStatus = document.getElementById("walkinIdStatusBadge");
          if (badgeStatus) {
            badgeStatus.style.display = "inline-block";
            badgeStatus.style.background = "#ecfdf5";
            badgeStatus.style.color = "#065f46";
            badgeStatus.textContent = "✓ เลขบัตรใหม่ (ยังไม่เคยลงทะเบียน)";
          }
          const btnSave = document.getElementById("btnSaveWalkinMonk");
          if (btnSave) {
            btnSave.textContent = "💾 บันทึกและลงทะเบียน";
            btnSave.style.background = "";
          }
        }
      }
    });
  }

  // Initial render of table
  renderMonkSelectTable();
}

/**
 * ตรวจสอบเลขประจำตัวประชาชนในทุกคอลัมน์ของทุกแท็บชีต
 * 1. พระสงฆ์ที่นิมนต์
 * 2. ลงทะเบียนพระนอกรายชื่อ
 * 3. ลงทะเบียนญาติโยม
 * 4. รับใบปวารณา
 */
function checkCitizenIdAcrossAllTabs(rawIdCard) {
  if (!rawIdCard) return null;
  const cleanId = rawIdCard.toString().replace(/[-\s]/g, "").trim().toLowerCase();
  if (cleanId.length < 5) return null;

  // 1. ตรวจในชีต "พระสงฆ์ที่นิมนต์" (ทุกฟิลด์/ทุกคอลัมน์)
  for (const m of state.monks) {
    for (const key of Object.keys(m)) {
      const val = (m[key] || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
      if (val && (val === cleanId || (cleanId.length >= 10 && val.includes(cleanId)))) {
        return {
          found: true,
          sheetType: "monks",
          sheetName: "พระสงฆ์ที่นิมนต์",
          matchedField: key,
          entity: m,
          name: m.name,
          temple: m.temple,
          status: m.status,
          registeredAt: m.registeredAt
        };
      }
    }
  }

  // 2. ตรวจในชีต "ลงทะเบียนพระนอกรายชื่อ" (ทุกฟิลด์/ทุกคอลัมน์)
  for (const w of state.walkinMonks) {
    for (const key of Object.keys(w)) {
      const val = (w[key] || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
      if (val && (val === cleanId || (cleanId.length >= 10 && val.includes(cleanId)))) {
        return {
          found: true,
          sheetType: "walkin",
          sheetName: "ลงทะเบียนพระนอกรายชื่อ",
          matchedField: key,
          entity: w,
          name: w.name,
          temple: w.temple,
          status: w.status,
          registeredAt: w.registeredAt
        };
      }
    }
  }

  // 3. ตรวจในชีต "ลงทะเบียนญาติโยม" (ทุกฟิลด์/ทุกคอลัมน์)
  for (const l of state.laypeople) {
    for (const key of Object.keys(l)) {
      const val = (l[key] || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
      if (val && (val === cleanId || (cleanId.length >= 10 && val.includes(cleanId)))) {
        return {
          found: true,
          sheetType: "lay",
          sheetName: "ลงทะเบียนญาติโยม",
          matchedField: key,
          entity: l,
          name: l.name,
          address: l.address,
          phone: l.phone,
          status: "ลงทะเบียนแล้ว",
          registeredAt: l.registeredAt
        };
      }
    }
  }

  // 4. ตรวจในชีต "รับใบปวารณา" (ทุกฟิลด์/ทุกคอลัมน์)
  for (const s of state.slips) {
    for (const key of Object.keys(s)) {
      const val = (s[key] || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
      if (val && (val === cleanId || (cleanId.length >= 10 && val.includes(cleanId)))) {
        return {
          found: true,
          sheetType: "slips",
          sheetName: "รับใบปวารณา",
          matchedField: key,
          entity: s,
          name: s.receiverName || s.monkName,
          temple: s.temple,
          status: s.status,
          registeredAt: s.receivedAt
        };
      }
    }
  }

  return { found: false, cleanId: cleanId };
}

function triggerMonkScan(searchTerm, cardData = null) {
  const rawTerm = (searchTerm || "").toString().trim();
  const cleanTerm = rawTerm.replace(/[-\s]/g, "").toLowerCase();
  if (!cleanTerm) return;

  const heldNotice = document.getElementById("monkCardHeldNotice");
  if (heldNotice) heldNotice.style.display = "none";

  // 1. ค้นหาในคอลัมน์ "ชื่อพระ" (LIKE '%คำค้น%') ทั้งพระนิมนต์และพระนอกรายชื่อ
  const isNumericCard = /^\d{10,13}$/.test(cleanTerm);
  const invitedMatches = state.monks.filter(m => {
    const mName = (m.name || "").toString().toLowerCase();
    const mId = (m.id || "").toString().trim().toLowerCase();
    const mCard = (m.idCard || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
    if (isNumericCard) {
      return (mCard && mCard === cleanTerm) || mId === cleanTerm;
    }
    return mName.includes(rawTerm.toLowerCase()) || mId === cleanTerm;
  }).map(m => ({ ...m, _isWalkin: false }));

  const walkinMatches = state.walkinMonks.filter(w => {
    const wName = (w.name || "").toString().toLowerCase();
    const wId = (w.id || "").toString().trim().toLowerCase();
    const wCard = (w.idCard || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
    if (isNumericCard) {
      return (wCard && wCard === cleanTerm) || wId === cleanTerm;
    }
    return wName.includes(rawTerm.toLowerCase()) || wId === cleanTerm;
  }).map(w => ({ ...w, _isWalkin: true }));

  const matches = [...walkinMatches, ...invitedMatches];

  if (matches.length === 1) {
    const found = matches[0];
    if (found._isWalkin) {
      monkFilterState.name = rawTerm;
      const filterEl = document.getElementById("monkFilterName");
      if (filterEl && !isNumericCard) filterEl.value = rawTerm;
      displayWalkinMonkForm(found.idCard || found.id, found);
      renderMonkSelectTable();
      showToast(`✓ พบในรายชื่อพระนอกรายชื่อ: ${found.name} (${found.temple})`, "info");
      return;
    }
    const monk = state.monks.find(m => m.id === found.id) || found;
    if (cardData && cardData.idCard && !monk.idCard) {
      monk.idCard = cardData.idCard;
    }
    monkFilterState.name = rawTerm;
    const filterEl = document.getElementById("monkFilterName");
    if (filterEl && !isNumericCard) filterEl.value = rawTerm;
    displayInvitedMonk(monk, true);
    renderMonkSelectTable();
    showToast(`✓ พบในรายนามพระนิมนต์: ${monk.name} (${monk.temple})`, "success");
    return;
  }

  if (matches.length > 1) {
    // พบหลายรายการ -> แสดงทั้งหมดในตาราง 1.2 พร้อมชื่อวัด เพื่อให้เจ้าหน้าที่ตรวจสอบและเลือก
    monkFilterState.name = rawTerm;
    const filterEl = document.getElementById("monkFilterName");
    if (filterEl) filterEl.value = rawTerm;
    renderMonkSelectTable();
    showToast(`พบรายชื่อที่ตรงกับ "${rawTerm}" จำนวน ${matches.length} รูป กรุณาเลือกจากตารางด้านซ้าย`, "info");
    return;
  }

  // 2. ไม่พบในรายนามพระนิมนต์ -> เปิดฟอร์มพระนอกรายชื่อ (1.4)
  state.currentSelectedMonk = null;
  const cidToUse = (cardData && cardData.idCard) ? cardData.idCard : (isNumericCard ? rawTerm : (state.pendingMonkCid || ""));

  const walkinExisting = cidToUse ? state.walkinMonks.find(w => {
    const wCard = (w.idCard || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
    return wCard && wCard === cidToUse.replace(/[-\s]/g, "").toLowerCase();
  }) : null;

  if (walkinExisting) {
    displayWalkinMonkForm(walkinExisting.idCard || cidToUse);
    showToast(`✓ ตรวจพบข้อมูลพระนอกรายชื่อเดิม: ${walkinExisting.name} วัด ${walkinExisting.temple} (สถานะ: อัปเดตข้อมูล)`, "info");
  } else {
    displayWalkinMonkForm(cidToUse);
    const walkinNameEl = document.getElementById("walkinName");
    if (walkinNameEl && !walkinNameEl.value) {
      walkinNameEl.value = (cardData && cardData.name) ? cardData.name : (!isNumericCard ? rawTerm : "");
    }
    showToast(`ℹ️ ไม่พบ "${rawTerm}" ในรายนามพระนิมนต์ -> เปิดแบบฟอร์มเพิ่มข้อมูลพระใหม่ (1.4)`, "info");
    if (walkinNameEl) walkinNameEl.focus();
  }
}
window.triggerMonkScan = triggerMonkScan;

function displayInvitedMonk(monk, fromHeldCard = false) {
  state.currentSelectedMonk = monk;
  document.getElementById("monkDetailHeader").textContent = "1.3 ข้อมูลการลงทะเบียนพระสงฆ์";

  const statusBadge = document.getElementById("monkDetailSubheader");
  if (monk.status === "ลงทะเบียนแล้ว") {
    statusBadge.className = "status-badge registered";
    statusBadge.textContent = "• ลงทะเบียนแล้ว";
  } else {
    statusBadge.className = "status-badge available";
    statusBadge.textContent = "• พร้อมลงทะเบียน";
  }

  const photoElem = document.getElementById("infoMonkPhoto");
  if (photoElem) {
    const monkNum = parseInt((monk.id || "").replace("MK", "")) || 1;
    const realPhoto = `assets/monks/monk_row_${monkNum + 1}.jpg`;
    photoElem.src = (monk.photo && !monk.photo.includes("monk_avatar.jpg")) ? monk.photo : realPhoto;
    photoElem.onerror = () => {
      photoElem.src = "assets/monk_avatar.jpg";
    };
  }

  document.getElementById("infoMonkName").textContent = monk.name;
  document.getElementById("infoMonkTemple").textContent = monk.temple;
  document.getElementById("infoMonkProvince").textContent = `${monk.province} (${monk.branch || 'สาขากลาง'})`;
  document.getElementById("infoMonkVassa").textContent = `${monk.vassa} พรรษา`;

  // ที่พัก / โรงแรม: แสดงตามคอลัมน์ J (แก้ไขได้ ถ้าไม่มีข้อความใดในนั้นก็ว่างไว้)
  const hotelElem = document.getElementById("infoMonkHotel");
  const hotelVal = (monk.hotel || "").toString().trim();
  if (hotelElem) {
    hotelElem.value = hotelVal;
  }

  // สิทธิ์รับใบปวารณา: แสดงตามข้อความในคอลัมน์ K (Fixed แก้ไขไม่ได้ ถ้าไม่มีข้อความใดในนั้นก็ว่างไว้)
  const slipElem = document.getElementById("infoMonkSlipRight");
  const slipVal = (monk.slipRight !== undefined && monk.slipRight !== null && monk.slipRight !== "")
    ? monk.slipRight.toString().trim()
    : (monk._colK || monk["สิทธิ์รับใบปวารณา"] || (monk.allowSlip ? "มีสิทธิ์" : "") || "").toString().trim();
  if (slipElem) {
    slipElem.textContent = slipVal;
  }

  // เบอร์โทรศัพท์ติดต่อ: แสดงตามคอลัมน์ I (แก้ไขได้ ถ้าไม่มีข้อความใดในนั้นก็ว่างไว้)
  const phoneElem = document.getElementById("infoMonkPhone");
  const phoneVal = (monk.phone && monk.phone !== "-") ? monk.phone.toString().trim() : "";
  if (phoneElem) {
    phoneElem.value = phoneVal;
  }

  // 13-digit ID card field (ส่วนรายชื่อในลิสต์ จะเพิ่มฐานข้อมูลเลขประชาชน)
  const idCardInput = document.getElementById("infoMonkIdCard");
  const badgeSource = document.getElementById("infoCardSourceBadge");
  if (idCardInput) {
    idCardInput.value = monk.idCard || "";
    if (!monk.idCard) {
      idCardInput.placeholder = "กรอกเลขบัตร 13 หลัก เพื่อเพิ่มลงฐานข้อมูลพระสงฆ์";
    }
  }
  if (badgeSource) {
    if (monk.idCard) {
      badgeSource.style.display = "inline-block";
      badgeSource.textContent = "💳 บันทึกในฐานข้อมูลแล้ว";
      badgeSource.style.background = "#ecfdf5";
      badgeSource.style.color = "#065f46";
    } else {
      badgeSource.style.display = "inline-block";
      badgeSource.textContent = "✏️ ยังไม่มีเลขบัตร (กรอกเพื่อเพิ่มฐานข้อมูล)";
      badgeSource.style.background = "#fff7ed";
      badgeSource.style.color = "#c2410c";
    }
  }

  const statusElem = document.getElementById("infoMonkStatus");
  statusElem.className = monk.status === "ลงทะเบียนแล้ว" ? "status-badge registered" : "status-badge available";
  statusElem.textContent = monk.status === "ลงทะเบียนแล้ว" ? "✓ ลงทะเบียนเรียบร้อยแล้ว" : "• พร้อมยืนยันลงทะเบียน";

  document.getElementById("infoMonkTime").textContent = monk.registeredAt || "ยังไม่ได้ลงทะเบียน";

  const btnConfirm = document.getElementById("btnConfirmMonkRegistration");
  if (monk.status === "ลงทะเบียนแล้ว") {
    btnConfirm.textContent = "✓ บันทึกแก้ไขข้อมูล (ที่พัก / เบอร์โทร / เลขบัตร)";
    btnConfirm.style.background = "#15803d";
  } else {
    btnConfirm.textContent = "✓ ยืนยันลงทะเบียนพระสงฆ์";
    btnConfirm.style.background = "";
  }

  document.getElementById("monkDetailPlaceholder").style.display = "none";
  document.getElementById("monkInvitedForm").style.display = "block";
  document.getElementById("monkWalkinForm").style.display = "none";
}

function confirmMonkRegistration(monk) {
  const now = new Date().toLocaleString("th-TH");

  // Read latest value from infoMonkIdCard or monkIdCardInput
  const idCardInput = document.getElementById("infoMonkIdCard");
  const topCardInput = document.getElementById("monkIdCardInput");
  const newCard = (idCardInput && idCardInput.value.trim()) || (topCardInput && topCardInput.value.trim()) || (monk.idCard || "");
  const cleanNewCard = newCard.replace(/[-\s]/g, "").trim();

  // Read editable hotel and phone inputs (slipRight is Fixed from Column K)
  const hotelInput = document.getElementById("infoMonkHotel");
  const phoneInput = document.getElementById("infoMonkPhone");

  const editedHotel = hotelInput ? hotelInput.value.trim() : (monk.hotel || "");
  const editedPhone = phoneInput ? phoneInput.value.trim() : (monk.phone || "");

  // ตรวจสอบความซ้ำซ้อนของเลขบัตรประชาชน (Primary Key ห้ามซ้ำกับพระรูปอื่น)
  if (cleanNewCard && cleanNewCard.length >= 10 && !cleanNewCard.includes("x")) {
    const duplicateMonk = state.monks.find(m => m.id !== monk.id && (m.idCard || "").replace(/[-\s]/g, "").trim() === cleanNewCard);
    if (duplicateMonk) {
      showToast(`⚠️ เลขบัตรประชาชนนี้ถูกใช้โดย ${duplicateMonk.name} วัด ${duplicateMonk.temple} อยู่แล้ว (เลขบัตรห้ามซ้ำ)`, "warning");
      return;
    }
    const duplicateWalkin = state.walkinMonks.find(w => (w.idCard || "").replace(/[-\s]/g, "").trim() === cleanNewCard);
    if (duplicateWalkin) {
      showToast(`⚠️ เลขบัตรประชาชนนี้เคยลงทะเบียนในชีต 'พระนอกรายชื่อ' แล้ว: ${duplicateWalkin.name}`, "warning");
      return;
    }
  }

  if (newCard) {
    monk.idCard = newCard;
  }
  monk.hotel = editedHotel;
  monk.phone = editedPhone;

  monk.status = "ลงทะเบียนแล้ว";
  monk.registeredAt = now;

  saveLocal("TEMPLE_MONKS_DATA", state.monks);
  updateAllKpis();
  renderMonkSelectTable();
  renderSlipMonksTable();
  renderReportTable();

  showToast(`บันทึกข้อมูล ${monk.name} สำเร็จ! ${monk.idCard ? '(เลขบัตร: ' + monk.idCard + ')' : ''}`, "success");
  showResultPopup(
    "ลงทะเบียนพระสงฆ์สำเร็จ!",
    monk.name,
    [
      `<strong>วัด:</strong> ${monk.temple || "-"}`,
      `<strong>สาขา:</strong> ${monk.branch || "-"}`,
      `<strong>ที่พัก/ของที่ระลึก:</strong> ${monk.hotel || "-"}`,
      `<strong>เวลาบันทึก:</strong> ${now}`
    ]
  );

  // Send to Google Sheets if connected
  if (state.gasUrl) {
    callGasApi({
      action: "register_monk",
      id: monk.id,
      idCard: monk.idCard,
      name: monk.name,
      temple: monk.temple,
      branch: monk.branch,
      vassa: monk.vassa,
      phone: monk.phone,
      hotel: monk.hotel,
      slipRight: monk.slipRight,
      registeredAt: now
    }).then(res => {
      if (res && res.status === "success") {
        showToast("ซิงก์ข้อมูลขึ้น Google Sheet สำเร็จ", "success");
      }
    });
  }

  // เคลียร์หน้าจอให้ว่างพร้อมรับรายการถัดไป
  clearMonkSearchAndScreen();
}

function openWalkinFromCard() {
  const cardData = state.pendingMonkCardData || SmartCardService.lastCardData || null;
  if (cardData && cardData.idCard) {
    displayWalkinMonkForm(cardData.idCard, null, cardData);
    return;
  }

  // ลองดึงจากเครื่องอ่านบัตรพอร์ต 8084 เผื่อบัตรเสียบอยู่แล้ว
  fetch("http://localhost:8084/api/card", { method: "GET" })
    .then(res => res.json())
    .then(raw => {
      if (raw && raw.status === "success" && raw.cid) {
        const fullname = (raw.fullname || `${raw.title || ""} ${raw.firstName || ""} ${raw.lastName || ""}`).replace(/\s+/g, " ").trim();
        const obj = {
          idCard: raw.cid,
          name: fullname,
          photo: raw.photoBase64 || ""
        };
        state.pendingMonkCardData = obj;
        SmartCardService.lastCardData = obj;
        displayWalkinMonkForm(obj.idCard, null, obj);
      } else {
        const typed = document.getElementById("monkIdCardInput")?.value.trim() || "";
        displayWalkinMonkForm(typed, null, null);
      }
    })
    .catch(() => {
      const typed = document.getElementById("monkIdCardInput")?.value.trim() || "";
      displayWalkinMonkForm(typed, null, null);
    });
}
window.openWalkinFromCard = openWalkinFromCard;

function clearMonkSearchAndScreen() {
  ["monkIdCardInput", "monkFilterName", "monkFilterBranch", "monkFilterTemple"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  monkFilterState.name = "";
  monkFilterState.branch = "";
  monkFilterState.temple = "";
  monkFilterState.cardOrName = "";
  monkFilterState.cardGiven = "";
  state.pendingMonkCid = "";
  state.pendingMonkCardData = null;
  const walkinPhoto = document.getElementById("walkinMonkPhoto");
  if (walkinPhoto) walkinPhoto.src = "assets/monk_avatar.jpg";
  const cardInd = document.getElementById("cardStatusIndicator");
  if (cardInd) cardInd.style.display = "none";
  resetMonkWorkflow();
  renderMonkSelectTable();
}

function displayWalkinMonkForm(searchCard, walkinObj = null, cardData = null) {
  state.currentSelectedMonk = null;
  const cleanSearch = (searchCard || "").toString().replace(/[-\s]/g, "").trim();

  // ตรวจสอบก่อนว่าเลขบัตรนี้เป็นพระที่ได้รับนิมนต์ในแท็บ 1.3 หรือไม่
  if (!walkinObj && cleanSearch && cleanSearch.length >= 10 && !cleanSearch.includes("x")) {
    const monkInvited = state.monks.find(m => {
      const mCard = (m.idCard || "").toString().replace(/[-\s]/g, "").trim();
      return mCard === cleanSearch;
    });
    if (monkInvited) {
      showToast(`⚠️ เลขบัตรประชาชนนี้อยู่ในรายนาม 'พระสงฆ์ที่นิมนต์' แล้ว: ${monkInvited.name}`, "warning");
      displayInvitedMonk(monkInvited, true);
      return;
    }
  }

  // ตรวจสอบว่าเคยลงทะเบียนในพระนอกรายชื่อแล้วหรือไม่
  let existing = walkinObj || null;
  if (!existing && cleanSearch && cleanSearch.length >= 10 && !cleanSearch.includes("x")) {
    existing = state.walkinMonks.find(w => {
      const wCard = (w.idCard || "").toString().replace(/[-\s]/g, "").trim();
      return wCard === cleanSearch;
    });
  }

  const idCardInput = document.getElementById("walkinIdCard");
  const nameInput = document.getElementById("walkinName");
  const vassaInput = document.getElementById("walkinVassa");
  const templeInput = document.getElementById("walkinTemple");
  const provinceInput = document.getElementById("walkinProvince");
  const phoneInput = document.getElementById("walkinPhone");
  const headerElem = document.getElementById("monkDetailHeader");
  const subheaderElem = document.getElementById("monkDetailSubheader");
  const btnSave = document.getElementById("btnSaveWalkinMonk");
  const bannerBox = document.getElementById("walkinBannerBox");
  const bannerTitle = document.getElementById("walkinBannerTitle");
  const bannerDesc = document.getElementById("walkinBannerDesc");
  const badgeStatus = document.getElementById("walkinIdStatusBadge");

  const walkinPhotoEl = document.getElementById("walkinMonkPhoto");
  if (walkinPhotoEl) {
    walkinPhotoEl.src = (cardData && cardData.photo) ? cardData.photo : ((existing && existing.photo) ? existing.photo : "assets/monk_avatar.jpg");
  }

  if (existing) {
    // พบข้อมูลเดิม -> แสดงสถานะพร้อมอัปเดตข้อมูล (Upsert / Update Mode)
    state.editingWalkinId = existing.id;
    headerElem.textContent = "1.4 ข้อมูลพระนอกรายชื่อ (เคยลงทะเบียนแล้ว)";
    subheaderElem.className = "status-badge registered";
    subheaderElem.textContent = "✓ ลงทะเบียนแล้ว (อัปเดตข้อมูล)";

    if (bannerBox) bannerBox.style.background = "#eff6ff";
    if (bannerBox) bannerBox.style.borderLeftColor = "#3b82f6";
    if (bannerTitle) bannerTitle.textContent = "1.4 ตรวจพบข้อมูลพระนอกรายชื่อเดิม";
    if (bannerDesc) bannerDesc.textContent = `เลขประจำตัวประชาชนนี้เคยลงทะเบียนแล้วเมื่อ ${existing.registeredAt || '-'} (รหัส ${existing.id}) ระบบจะอัปเดตข้อมูลเดิม`;

    if (badgeStatus) {
      badgeStatus.style.display = "inline-block";
      badgeStatus.style.background = "#dbeafe";
      badgeStatus.style.color = "#1e40af";
      badgeStatus.textContent = "✓ เลขบัตรเดิม (Update Mode)";
    }

    if (idCardInput) idCardInput.value = existing.idCard || searchCard;
    if (nameInput) nameInput.value = existing.name || "";
    if (vassaInput) vassaInput.value = existing.vassa || "";
    if (templeInput) templeInput.value = existing.temple || "";
    if (provinceInput) provinceInput.value = existing.province || "";
    if (phoneInput) phoneInput.value = existing.phone || "";

    if (btnSave) {
      btnSave.textContent = "💾 บันทึกอัปเดตข้อมูล (เลขบัตรนี้ลงทะเบียนแล้ว)";
      btnSave.style.background = "#0284c7";
    }
  } else {
    // ไม่พบข้อมูลเดิม -> ฟอร์มสำหรับลงทะเบียนใหม่ (Insert Mode)
    state.editingWalkinId = null;
    headerElem.textContent = "1.4 ลงทะเบียนพระ (กรณีไม่ได้รับเชิญ)";
    subheaderElem.className = "status-badge pending";
    subheaderElem.textContent = "พระนอกรายชื่อ (ใหม่)";

    if (bannerBox) bannerBox.style.background = "#fdf8f0";
    if (bannerBox) bannerBox.style.borderLeftColor = "#6e4427";
    if (bannerTitle) bannerTitle.textContent = "1.4 ลงทะเบียนพระนอกรายชื่อ (จากบัตรประชาชน / เพิ่มใหม่)";
    if (bannerDesc) bannerDesc.textContent = "ดึงเลขบัตร ชื่อ และรูปถ่ายจากบัตรประชาชนอัตโนมัติ (หรือกรอกข้อมูลเพิ่มเติม) เพื่อบันทึกลงระบบ";

    if (badgeStatus) {
      if (cleanSearch && cleanSearch.length >= 10 && !cleanSearch.includes("x")) {
        badgeStatus.style.display = "inline-block";
        badgeStatus.style.background = "#ecfdf5";
        badgeStatus.style.color = "#065f46";
        badgeStatus.textContent = "✓ เลขบัตรใหม่ (ยังไม่เคยลงทะเบียน)";
      } else {
        badgeStatus.style.display = "none";
      }
    }

    if (idCardInput) idCardInput.value = (cardData && cardData.idCard) ? cardData.idCard : ((cleanSearch && !cleanSearch.includes("x")) ? searchCard : "");
    if (nameInput) nameInput.value = (cardData && cardData.name) ? cardData.name : "";
    if (vassaInput) vassaInput.value = "";
    if (templeInput) templeInput.value = "";
    if (provinceInput) provinceInput.value = "";
    if (phoneInput) phoneInput.value = "";

    if (btnSave) {
      btnSave.textContent = "💾 บันทึกและลงทะเบียน";
      btnSave.style.background = "";
    }
  }

  document.getElementById("monkDetailPlaceholder").style.display = "none";
  document.getElementById("monkInvitedForm").style.display = "none";
  document.getElementById("monkWalkinForm").style.display = "block";
}
window.displayWalkinMonkForm = displayWalkinMonkForm;

function saveWalkinMonk() {
  const name = document.getElementById("walkinName").value.trim();
  const idCard = document.getElementById("walkinIdCard").value.trim();
  const cleanId = idCard.replace(/[-\s]/g, "").trim();
  const vassa = parseInt(document.getElementById("walkinVassa").value) || 0;
  const temple = document.getElementById("walkinTemple").value.trim();
  const province = document.getElementById("walkinProvince").value.trim();
  const phone = document.getElementById("walkinPhone").value.trim();

  // 1. ตรวจสอบเลขประจำตัวประชาชน (Primary Key ห้ามเว้นว่าง และห้ามเป็น dummy)
  if (!cleanId || cleanId.length < 13 || cleanId.includes("x")) {
    showToast("กรุณาระบุเลขประจำตัวประชาชน 13 หลักให้ถูกต้อง (เลขบัตรเป็น Primary Key ห้ามเว้นว่างหรือซ้ำ)", "warning");
    const inputCard = document.getElementById("walkinIdCard");
    if (inputCard) inputCard.focus();
    return;
  }

  if (!name || !temple) {
    showToast("กรุณากรอกชื่อพระ/ฉายา และชื่อวัดต้นสังกัดให้ครบถ้วน", "warning");
    return;
  }

  // 2. ตรวจสอบว่ามีอยู่ในรายนามพระสงฆ์ที่นิมนต์หรือไม่
  const monkInvited = state.monks.find(m => {
    const mCard = (m.idCard || "").toString().replace(/[-\s]/g, "").trim();
    return mCard === cleanId;
  });
  if (monkInvited) {
    showToast(`⚠️ เลขบัตรประชาชนนี้อยู่ในรายนาม 'พระสงฆ์ที่นิมนต์' แล้ว: ${monkInvited.name}`, "warning");
    displayInvitedMonk(monkInvited, true);
    return;
  }

  const now = new Date().toLocaleString("th-TH");

  // 3. ตรวจสอบว่ามีอยู่ใน 'ลงทะเบียนพระนอกรายชื่อ' แล้วหรือไม่ (เช็ค Primary Key)
  const existingIndex = state.walkinMonks.findIndex(w => {
    const wCard = (w.idCard || "").toString().replace(/[-\s]/g, "").trim();
    return (wCard && wCard === cleanId) || (state.editingWalkinId && w.id === state.editingWalkinId);
  });

  if (existingIndex !== -1) {
    // === UPDATE EXISTING (อัปเดตข้อมูลแถวเดิม ไม่สร้างแถวใหม่) ===
    const existing = state.walkinMonks[existingIndex];
    existing.idCard = idCard;
    existing.name = name;
    existing.temple = temple;
    existing.vassa = vassa;
    existing.province = province || "ไม่ระบุ";
    existing.phone = phone || "-";
    existing.status = "ลงทะเบียนแล้ว";
    existing.registeredAt = now;

    // เผื่อมีแถวซ้ำซ้อนเดิมใน memory ให้กรองให้เหลือเพียงแถวเดียว
    state.walkinMonks = state.walkinMonks.filter((w, idx) => {
      if (idx === existingIndex) return true;
      const otherCard = (w.idCard || "").toString().replace(/[-\s]/g, "").trim();
      return otherCard !== cleanId;
    });

    saveLocal("TEMPLE_WALKIN_DATA", state.walkinMonks);
    updateAllKpis();
    renderReportTable();

    showToast(`✓ อัปเดตข้อมูลพระนอกรายชื่อ: ${name} (เลขบัตร: ${idCard}) เรียบร้อยแล้ว`, "success");
    showResultPopup(
      "อัปเดตข้อมูลพระนอกรายชื่อสำเร็จ!",
      name,
      [
        `<strong>วัด:</strong> ${temple}`,
        `<strong>พรรษา:</strong> ${vassa || "-"}`,
        `<strong>เวลาบันทึก:</strong> ${now}`
      ]
    );
    clearMonkSearchAndScreen();

    if (state.gasUrl) {
      callGasApi({
        action: "register_walkin_monk",
        id: existing.id,
        idCard: cleanId,
        name: name,
        temple: temple,
        vassa: vassa,
        province: province || "ไม่ระบุ",
        phone: phone || "-",
        isUpdate: true,
        registeredAt: now
      }).then(res => {
        if (res && res.status === "success") {
          showToast("อัปเดตข้อมูลลง Google Sheet เรียบร้อยแล้ว (ไม่เพิ่มแถวซ้ำ)", "success");
        }
      });
    }

  } else {
    // === INSERT NEW (เพิ่มแถวใหม่เฉพาะเมื่อเป็นเลขบัตรใหม่) ===
    const newMonk = {
      id: "WK" + Date.now().toString().slice(-6),
      idCard: idCard,
      name: name,
      temple: temple,
      vassa: vassa,
      province: province || "ไม่ระบุ",
      phone: phone || "-",
      status: "ลงทะเบียนแล้ว",
      registeredAt: now
    };

    state.walkinMonks.unshift(newMonk);
    saveLocal("TEMPLE_WALKIN_DATA", state.walkinMonks);
    updateAllKpis();
    renderReportTable();

    showToast(`✓ บันทึกและลงทะเบียนพระนอกรายชื่อ: ${name} สำเร็จ`, "success");
    showResultPopup(
      "ลงทะเบียนพระนอกรายชื่อสำเร็จ!",
      name,
      [
        `<strong>รหัส:</strong> ${newMonk.id}`,
        `<strong>วัด:</strong> ${temple}`,
        `<strong>พรรษา:</strong> ${vassa || "-"}`,
        `<strong>เวลาบันทึก:</strong> ${now}`
      ]
    );
    clearMonkSearchAndScreen();

    if (state.gasUrl) {
      callGasApi({
        action: "register_walkin_monk",
        ...newMonk,
        idCard: cleanId,
        isUpdate: false
      }).then(res => {
        if (res && res.status === "success") {
          showToast("บันทึกลง Google Sheet แผ่น 'ลงทะเบียนพระนอกรายชื่อ' สำเร็จ", "success");
        }
      });
    }
  }
}

function resetMonkWorkflow() {
  state.currentSelectedMonk = null;
  state.editingWalkinId = null;

  const inputCard = document.getElementById("monkIdCardInput");
  if (inputCard) inputCard.value = "";
  const cardInd = document.getElementById("cardStatusIndicator");
  if (cardInd) cardInd.style.display = "none";
  const heldNotice = document.getElementById("monkCardHeldNotice");
  if (heldNotice) heldNotice.style.display = "none";
  const placeholder = document.getElementById("monkDetailPlaceholder");
  if (placeholder) placeholder.style.display = "block";
  const invitedForm = document.getElementById("monkInvitedForm");
  if (invitedForm) invitedForm.style.display = "none";
  const walkinForm = document.getElementById("monkWalkinForm");
  if (walkinForm) walkinForm.style.display = "none";

  const bannerBox = document.getElementById("walkinBannerBox");
  if (bannerBox) {
    bannerBox.style.background = "#fff7ed";
    bannerBox.style.borderLeftColor = "#ea580c";
  }
  const bannerTitle = document.getElementById("walkinBannerTitle");
  if (bannerTitle) bannerTitle.textContent = "1.4 ลงทะเบียนพระ (กรณีไม่ได้รับเชิญ)";
  const bannerDesc = document.getElementById("walkinBannerDesc");
  if (bannerDesc) bannerDesc.textContent = "ไม่พบในรายชื่อนิมนต์ กรุณากรอกเลขบัตรประชาชน 13 หลักและข้อมูลเพื่อบันทึกลงระบบ";

  const badgeStatus = document.getElementById("walkinIdStatusBadge");
  if (badgeStatus) badgeStatus.style.display = "none";

  const btnSave = document.getElementById("btnSaveWalkinMonk");
  if (btnSave) {
    btnSave.textContent = "💾 บันทึกและลงทะเบียน";
    btnSave.style.background = "";
  }

  const header = document.getElementById("monkDetailHeader");
  if (header) header.textContent = "1.3 ข้อมูลการลงทะเบียนพระสงฆ์";
  const subheader = document.getElementById("monkDetailSubheader");
  if (subheader) {
    subheader.className = "status-badge available";
    subheader.textContent = "รอเลือกข้อมูล";
  }
  const tbody = document.getElementById("monksSelectTableBody");
  if (tbody) {
    tbody.querySelectorAll("tr").forEach(r => r.classList.remove("selected-row"));
  }
}

function addNewTemplePrompt() {
  const newName = prompt("กรุณาระบุชื่อวัดใหม่ที่ต้องการเพิ่ม:");
  if (newName && newName.trim()) {
    document.getElementById("walkinTemple").value = newName.trim();
    showToast(`เพิ่มวัด: ${newName.trim()} ในแบบฟอร์มแล้ว`, "success");
  }
}

/**
 * --------------------------------------------------------------------------
 * FLOW 2: ลงทะเบียนญาติโยม (Laypeople Registration Workflow)
 * --------------------------------------------------------------------------
 */

/**
 * เคลียร์ข้อมูลหน้าจอของญาติโยมทั้งหมด พร้อมออกรหัสใหม่
 */
function clearLayForm() {
  const fields = ["layName", "layIdCard", "layBirthday", "layAddress", "layPhone", "layEmergencyPhone", "layIdCardManual"];
  fields.forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = "";
  });
  const genderEl = document.getElementById("layGender");
  if (genderEl) genderEl.value = "ชาย";

  const photoEl = document.getElementById("layCardPhotoPreview");
  if (photoEl) photoEl.src = "assets/receiver_avatar.jpg";
  const photoBadge = document.getElementById("layCardPhotoBadge");
  if (photoBadge) {
    photoBadge.className = "status-badge available";
    photoBadge.textContent = "รูปตัวอย่าง / รออ่านบัตร";
  }

  state.editingLayId = null;
  state.currentLayPhoto = "";
  generateNextLayId(false);
}
window.clearLayForm = clearLayForm;

/**
 * ฟังก์ชันเมื่อเสียบบัตรประชาชนญาติโยม:
 * 1. เคลียร์ข้อมูลหน้าจอเดิม
 * 2. ดึงทุกอย่างจากบัตร (เลขบัตร, ชื่อ, วันเกิด, เพศ, ที่อยู่)
 * 3. เติมเฉพาะเบอร์โทรศัพท์แบบไม่บังคับ (เว้นว่างไว้ และโฟกัสเพื่อให้กรอกได้สะดวก)
 */
function onLayCardRead(cardData) {
  if (!cardData) return;

  // 1. เคลียร์ข้อมูลหน้าจอเดิมทั้งหมด
  clearLayForm();

  // 2. ดึงข้อมูลจากบัตรประชาชน
  if (cardData.idCard) {
    const cardEl = document.getElementById("layIdCard");
    if (cardEl) cardEl.value = cardData.idCard;
  }
  if (cardData.name) {
    const nameEl = document.getElementById("layName");
    if (nameEl) nameEl.value = cardData.name;
  }
  if (cardData.birthday) {
    const bdayEl = document.getElementById("layBirthday");
    if (bdayEl) bdayEl.value = cardData.birthday;
  }
  if (cardData.gender) {
    const genderEl = document.getElementById("layGender");
    if (genderEl) genderEl.value = cardData.gender;
  }
  if (cardData.address) {
    const addrEl = document.getElementById("layAddress");
    if (addrEl) addrEl.value = cardData.address;
  }
  if (cardData.photo) {
    const photoEl = document.getElementById("layCardPhotoPreview");
    if (photoEl) photoEl.src = cardData.photo;
    const photoBadge = document.getElementById("layCardPhotoBadge");
    if (photoBadge) {
      photoBadge.className = "status-badge registered";
      photoBadge.textContent = "🪪 รูปจากชิปบัตรประชาชน";
    }
    state.currentLayPhoto = cardData.photo;
  }

  // 3. เติมเฉพาะเบอร์แบบไม่บังคับ (เว้นว่างไว้ และเลื่อนโฟกัสไปที่ช่องเบอร์โทรศัพท์)
  const phoneEl = document.getElementById("layPhone");
  if (phoneEl) {
    phoneEl.value = "";
    phoneEl.focus();
  }
  const emPhoneEl = document.getElementById("layEmergencyPhone");
  if (emPhoneEl) emPhoneEl.value = "";

  showToast(`✓ เสียบบัตรประชาชน: ดึงข้อมูลคุณ ${cardData.name || cardData.idCard} เรียบร้อย (เติมเฉพาะเบอร์แบบไม่บังคับ)`, "success");
}
window.onLayCardRead = onLayCardRead;

function generateNextLayId(notify = false) {
  let maxNum = 0;
  if (Array.isArray(state.laypeople)) {
    state.laypeople.forEach(l => {
      const match = (l.id || "").match(/LP(\d+)/i);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    });
  }
  const nextId = "LP" + String(maxNum + 1).padStart(4, "0");
  const layIdInput = document.getElementById("layId");
  if (layIdInput) layIdInput.value = nextId;

  state.editingLayId = null;

  const badge = document.getElementById("layIdBadge");
  if (badge) {
    badge.style.display = "inline-block";
    badge.style.background = "#ecfdf5";
    badge.style.color = "#065f46";
    badge.textContent = "✓ รหัสใหม่ (Primary Key)";
  }

  const statusBadge = document.getElementById("layStatusBadge");
  if (statusBadge) {
    statusBadge.className = "status-badge available";
    statusBadge.textContent = "พร้อมลงทะเบียนใหม่";
  }

  const btnConfirm = document.getElementById("btnConfirmLayRegistration");
  if (btnConfirm) {
    btnConfirm.textContent = "✓ ยืนยันลงทะเบียนญาติโยม";
    btnConfirm.style.background = "";
  }

  if (notify) {
    showToast(`สร้างรหัสญาติโยมถัดไป: ${nextId}`, "info");
  }
  return nextId;
}
window.generateNextLayId = generateNextLayId;

function checkAndPopulateLayperson(searchTerm) {
  if (!searchTerm) return;
  const cleanTerm = searchTerm.toString().replace(/[-\s]/g, "").trim().toLowerCase();
  if (cleanTerm.length < 2) return;

  // 1. ตรวจสอบกับพระสงฆ์ก่อน (หากเป็นเลขบัตร 13 หลัก)
  if (cleanTerm.length >= 10 && !cleanTerm.includes("x")) {
    const monkMatch = state.monks.find(m => (m.idCard || "").toString().replace(/[-\s]/g, "").trim() === cleanTerm);
    if (monkMatch) {
      showToast(`⚠️ เลขบัตรนี้เคยลงทะเบียนในรายชื่อ 'พระสงฆ์ที่นิมนต์' แล้ว: ${monkMatch.name}`, "warning");
      return;
    }
    const walkinMatch = state.walkinMonks.find(w => (w.idCard || "").toString().replace(/[-\s]/g, "").trim() === cleanTerm);
    if (walkinMatch) {
      showToast(`⚠️ เลขบัตรนี้เคยลงทะเบียนใน 'พระนอกรายชื่อ' แล้ว: ${walkinMatch.name}`, "warning");
      return;
    }
  }

  // 2. ตรวจสอบกับญาติโยม (Primary Key: เลขบัตรประชาชน -> ถ้าไม่มีใช้เบอร์โทรศัพท์)
  const existing = state.laypeople.find(l => {
    const lCard = (l.idCard || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
    const lPhone = (l.phone || "").toString().replace(/[-\s]/g, "").trim().toLowerCase();
    const lId = (l.id || "").toString().trim().toLowerCase();
    return (lCard && lCard === cleanTerm) || (lPhone && lPhone !== "-" && lPhone === cleanTerm) || (lId && lId === cleanTerm);
  });

  const badge = document.getElementById("layIdBadge");
  const statusBadge = document.getElementById("layStatusBadge");
  const btnConfirm = document.getElementById("btnConfirmLayRegistration");

  if (existing) {
    state.editingLayId = existing.id;
    if (document.getElementById("layId")) document.getElementById("layId").value = existing.id || "";
    if (document.getElementById("layName")) document.getElementById("layName").value = existing.name || "";
    if (document.getElementById("layIdCard")) document.getElementById("layIdCard").value = existing.idCard || "";
    if (document.getElementById("layBirthday")) document.getElementById("layBirthday").value = existing.birthday || "";
    if (document.getElementById("layGender")) document.getElementById("layGender").value = existing.gender || "ชาย";
    if (document.getElementById("layAddress")) document.getElementById("layAddress").value = existing.address || "";
    if (document.getElementById("layPhone")) document.getElementById("layPhone").value = existing.phone || "";
    if (document.getElementById("layEmergencyPhone")) document.getElementById("layEmergencyPhone").value = existing.emergencyPhone || "";

    if (badge) {
      badge.style.display = "inline-block";
      badge.style.background = "#dbeafe";
      badge.style.color = "#1e40af";
      badge.textContent = "✓ มีข้อมูลเดิม (Update Mode)";
    }
    if (statusBadge) {
      statusBadge.className = "status-badge registered";
      statusBadge.textContent = "✓ เคยลงทะเบียนแล้ว (อัปเดตข้อมูล)";
    }
    if (btnConfirm) {
      btnConfirm.textContent = `💾 บันทึกอัปเดตข้อมูลญาติโยม (รหัส: ${existing.id})`;
      btnConfirm.style.background = "#0284c7";
    }
    showToast(`✓ ตรวจพบข้อมูลญาติโยมเดิม รหัส ${existing.id}: คุณ ${existing.name} (ดึงข้อมูลเพื่ออัปเดต)`, "info");
  } else {
    state.editingLayId = null;
    if (badge) {
      badge.style.display = "inline-block";
      badge.style.background = "#ecfdf5";
      badge.style.color = "#065f46";
      badge.textContent = "✓ รหัสใหม่ (Primary Key)";
    }
    if (statusBadge) {
      statusBadge.className = "status-badge available";
      statusBadge.textContent = "พร้อมลงทะเบียนใหม่";
    }
    if (btnConfirm) {
      btnConfirm.textContent = "✓ ยืนยันลงทะเบียนญาติโยม";
      btnConfirm.style.background = "";
    }
  }
}

function setupLayWorkflow() {
  // สร้างรหัสญาติโยมเริ่มต้นให้ทันที
  generateNextLayId(false);

  // ปุ่มอ่านข้อมูลจากเครื่องอ่านบัตรประชาชน Smart Card
  document.getElementById("btnSimulateLayScan")?.addEventListener("click", () => {
    SmartCardService.readCurrentCard("tab-lay");
  });

  // ช่องค้นหาด้วยเลขบัตรประชาชน หรือเบอร์โทรศัพท์
  const inputManual = document.getElementById("layIdCardManual");
  if (inputManual) {
    inputManual.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      if (val.length >= 2) {
        checkAndPopulateLayperson(val);
      }
    });
  }

  // ช่องเลขบัตรประชาชน (Primary Key หลัก)
  const inputCard = document.getElementById("layIdCard");
  if (inputCard) {
    inputCard.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      const cleanVal = val.replace(/[-\s]/g, "");
      if (cleanVal.length >= 10 && !cleanVal.includes("x")) {
        checkAndPopulateLayperson(val);
      }
    });
  }

  // ช่องเบอร์โทรศัพท์ (Primary Key สำรองเมื่อไม่มีเลขบัตร)
  const inputPhone = document.getElementById("layPhone");
  if (inputPhone) {
    inputPhone.addEventListener("input", (e) => {
      const cardVal = (document.getElementById("layIdCard")?.value || "").replace(/[-\s]/g, "");
      if (cardVal) return;
      const cleanPhone = e.target.value.trim().replace(/[-\s]/g, "");
      if (cleanPhone.length >= 9) {
        checkAndPopulateLayperson(cleanPhone);
      }
    });
  }

  document.getElementById("btnConfirmLayRegistration").addEventListener("click", () => {
    confirmLayRegistration();
  });
}

function confirmLayRegistration() {
  const name = document.getElementById("layName").value.trim();
  const idCard = document.getElementById("layIdCard").value.trim();
  const cleanId = idCard.replace(/[-\s]/g, "").trim();
  const birthday = document.getElementById("layBirthday").value.trim();
  const gender = document.getElementById("layGender").value;
  const address = document.getElementById("layAddress").value.trim();
  const phoneRaw = document.getElementById("layPhone") ? document.getElementById("layPhone").value.trim() : "";
  const cleanPhone = phoneRaw.replace(/[-\s]/g, "").trim();
  const phone = phoneRaw || "-";
  const emergencyPhone = (document.getElementById("layEmergencyPhone") ? document.getElementById("layEmergencyPhone").value.trim() : "") || "-";

  // 1. ตรวจสอบ Primary Key: เลขบัตรประชาชน -> ถ้าไม่มีใช้เบอร์โทรศัพท์แทน
  if (!cleanId && !cleanPhone) {
    showToast("กรุณากรอกเลขประจำตัวประชาชน หรือเบอร์โทรศัพท์อย่างน้อย 1 อย่าง (Primary Key)", "warning");
    document.getElementById("layIdCard")?.focus();
    return;
  }

  // 2. ตรวจสอบชื่อ - นามสกุล (จำเป็นต้องกรอก)
  if (!name) {
    showToast("กรุณากรอกชื่อ-นามสกุลญาติโยม", "warning");
    document.getElementById("layName").focus();
    return;
  }

  // 3. ตรวจสอบเลขบัตรประชาชน (กรณีระบุ)
  if (cleanId && cleanId.length >= 10 && !cleanId.includes("x")) {
    const monkMatch = state.monks.find(m => (m.idCard || "").toString().replace(/[-\s]/g, "").trim() === cleanId);
    if (monkMatch) {
      showToast(`⚠️ เลขบัตรประชาชนนี้อยู่ในรายนาม 'พระสงฆ์ที่นิมนต์' แล้ว: ${monkMatch.name}`, "warning");
      return;
    }
    const walkinMatch = state.walkinMonks.find(w => (w.idCard || "").toString().replace(/[-\s]/g, "").trim() === cleanId);
    if (walkinMatch) {
      showToast(`⚠️ เลขบัตรประชาชนนี้อยู่ใน 'พระนอกรายชื่อ' แล้ว: ${walkinMatch.name}`, "warning");
      return;
    }
  }

  const now = new Date().toLocaleString("th-TH");
  const primaryKeyLabel = cleanId ? `เลขบัตร: ${idCard}` : `เบอร์โทร: ${phoneRaw}`;

  // 4. ตรวจสอบข้อมูลเดิมด้วย Primary Key (เลขบัตรประชาชน หรือเบอร์โทรศัพท์)
  const existingIndex = state.laypeople.findIndex(l => {
    const lCard = (l.idCard || "").toString().replace(/[-\s]/g, "").trim();
    const lPhone = (l.phone || "").toString().replace(/[-\s]/g, "").trim();
    if (cleanId) {
      return lCard && lCard === cleanId;
    }
    if (cleanPhone) {
      return !lCard && lPhone && lPhone === cleanPhone;
    }
    return state.editingLayId && l.id === state.editingLayId;
  });

  const layId = (existingIndex !== -1 && state.laypeople[existingIndex].id)
    ? state.laypeople[existingIndex].id
    : (state.editingLayId || generateNextLayId(false));

  if (existingIndex !== -1) {
    // === UPDATE EXISTING (อัปเดตแถวเดิม ไม่สร้างแถวใหม่) ===
    const existing = state.laypeople[existingIndex];
    existing.id = layId;
    existing.idCard = idCard;
    existing.name = name;
    existing.birthday = birthday;
    existing.gender = gender;
    existing.address = address;
    existing.phone = phone;
    existing.emergencyPhone = emergencyPhone;
    existing.registeredAt = now;

    // กรองแถวซ้ำใน memory ให้เหลือเพียงแถวเดียว
    state.laypeople = state.laypeople.filter((l, idx) => {
      if (idx === existingIndex) return true;
      const otherId = (l.id || "").toString().trim().toLowerCase();
      return otherId !== layId.toLowerCase();
    });

    saveLocal("TEMPLE_LAY_DATA", state.laypeople);
    updateAllKpis();
    renderReportTable();

    showToast(`✓ อัปเดตข้อมูลญาติโยม (${primaryKeyLabel}) คุณ ${name} เรียบร้อยแล้ว`, "success");
    showResultPopup(
      "อัปเดตข้อมูลญาติโยมสำเร็จ!",
      name,
      [
        `<strong>Primary Key:</strong> ${primaryKeyLabel}`,
        `<strong>เวลาบันทึก:</strong> ${now}`
      ]
    );
    resetLayWorkflow();

    if (state.gasUrl) {
      callGasApi({
        action: "register_layperson",
        id: layId,
        idCard: idCard,
        name: name,
        birthday: birthday,
        gender: gender,
        address: address,
        phone: phone,
        emergencyPhone: emergencyPhone,
        isUpdate: true,
        registeredAt: now
      }).then(res => {
        if (res && res.status === "success") {
          showToast("อัปเดตข้อมูลญาติโยมลง Google Sheet เรียบร้อยแล้ว (ไม่เพิ่มแถวซ้ำ)", "success");
        }
      });
    }

  } else {
    // === INSERT NEW (เพิ่มแถวใหม่ด้วยรหัส layId) ===
    const newLay = {
      id: layId,
      idCard: idCard, // เว้นว่างได้
      name: name,
      birthday: birthday,
      gender: gender,
      address: address,
      phone: phone,
      emergencyPhone: emergencyPhone,
      registeredAt: now
    };

    state.laypeople.unshift(newLay);
    saveLocal("TEMPLE_LAY_DATA", state.laypeople);
    updateAllKpis();
    renderReportTable();

    showToast(`✓ บันทึกและลงทะเบียนญาติโยม (${primaryKeyLabel}) คุณ ${name} สำเร็จ`, "success");
    showResultPopup(
      "ลงทะเบียนญาติโยมสำเร็จ!",
      name,
      [
        `<strong>Primary Key:</strong> ${primaryKeyLabel}`,
        `<strong>เวลาบันทึก:</strong> ${now}`
      ]
    );
    resetLayWorkflow();

    if (state.gasUrl) {
      callGasApi({
        action: "register_layperson",
        ...newLay,
        isUpdate: false
      }).then(res => {
        if (res && res.status === "success") {
          showToast("บันทึกข้อมูลญาติโยมลง Google Sheet สำเร็จ", "success");
        }
      });
    }
  }
}

function resetLayWorkflow() {
  clearLayForm();
}

/**
 * --------------------------------------------------------------------------
 * FLOW 3: รับใบปวารณา (ผู้มารับเงิน) (Slip Receiving & Photo)
 * --------------------------------------------------------------------------
 */
function setupSlipWorkflow() {
  renderSlipMonksTable();

  // Search filter
  document.getElementById("btnSlipSearch").addEventListener("click", () => {
    renderSlipMonksTable();
  });

  // WebCam Camera Handling
  document.getElementById("btnStartCamera").addEventListener("click", () => {
    toggleCamera();
  });

  document.getElementById("btnSnapPhoto").addEventListener("click", () => {
    snapPhoto();
  });

  // File upload input
  document.getElementById("photoFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        state.receiverPhotoBase64 = event.target.result;
        document.getElementById("receiverPhotoPreview").src = state.receiverPhotoBase64;
        document.getElementById("receiverPhotoPreview").style.display = "block";
        document.getElementById("webcamVideo").style.display = "none";
        document.getElementById("cameraBadge").textContent = "อัปโหลดภาพแล้ว";
        showToast("อัปโหลดรูปภาพผู้รับเรียบร้อย", "success");
      };
      reader.readAsDataURL(file);
    }
  });

  // Confirm Slip Receive Button
  document.getElementById("btnConfirmSlipReceive").addEventListener("click", () => {
    confirmSlipReceive();
  });
}

function renderSlipMonksTable() {
  const tbody = document.getElementById("slipMonksTableBody");
  tbody.innerHTML = "";

  const nameFilter = (document.getElementById("slipSearchMonk")?.value || "").toLowerCase().trim();
  const branchFilter = (document.getElementById("slipSearchBranch")?.value || "").toLowerCase().trim();
  const templeFilter = (document.getElementById("slipSearchTemple")?.value || "").toLowerCase().trim();

  // กรองเฉพาะผู้แทนของพระสงฆ์ที่มีสิทธิ์ตามคอลัมน์ K เท่านั้น
  const filtered = state.monks.filter(m => {
    const isEligible = (m.slipRight && m.slipRight.includes("มีสิทธิ์")) || m.allowSlip || ((m._colK || "").includes("มีสิทธิ์"));
    if (!isEligible) return false;

    const mName = (m.name || "").toLowerCase();
    const mBranch = (m.branch || "").toLowerCase();
    const mTemple = (m.temple || "").toLowerCase();

    const matchName = !nameFilter || mName.includes(nameFilter);
    const matchBranch = !branchFilter || mBranch.includes(branchFilter);
    const matchTemple = !templeFilter || mTemple.includes(templeFilter);

    return matchName && matchBranch && matchTemple;
  });

  const displayList = filtered.slice(0, 50); // display top 50 matches

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding: 1.5rem;">ไม่พบข้อมูลพระสงฆ์ผู้มีสิทธิ์ตามคอลัมน์ K ตามเงื่อนไขการค้นหา</td></tr>`;
    return;
  }

  displayList.forEach((m, idx) => {
    const tr = document.createElement("tr");
    if (state.currentSlipMonk && state.currentSlipMonk.id === m.id) {
      tr.className = "selected";
    }

    const isDelivered = m.slipStatus === "รับแล้ว";
    const statusHtml = isDelivered
      ? `<span class="status-badge registered" style="font-size:0.75rem;">✓ รับแล้ว</span>`
      : `<span class="status-badge pending" style="font-size:0.75rem;">ยังไม่ได้รับ</span>`;

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-weight: 600; color: #166534;">${m.name}</td>
      <td>${m.temple}</td>
      <td>${m.branch || "-"}</td>
      <td>${m.vassa}</td>
      <td><span style="font-size:0.75rem; color:#166534; font-weight:600; background:#ecfdf5; padding:0.15rem 0.45rem; border-radius:4px; border:1px solid #bbf7d0;">✓ มีสิทธิ์</span></td>
      <td>${statusHtml}</td>
    `;

    tr.addEventListener("click", () => {
      selectMonkForSlip(m);
    });

    tbody.appendChild(tr);
  });
}

function selectMonkForSlip(monk) {
  const isEligible = (monk.slipRight && monk.slipRight.includes("มีสิทธิ์")) || monk.allowSlip || ((monk._colK || "").includes("มีสิทธิ์"));
  if (!isEligible) {
    showToast(`⚠️ พระสงฆ์รูปนี้ไม่มีสิทธิ์รับใบปวารณาตามคอลัมน์ K (เฉพาะผู้แทนของพระผู้มีสิทธิ์เท่านั้น)`, "warning");
    return;
  }

  state.currentSlipMonk = monk;
  renderSlipMonksTable();

  document.getElementById("slipRecTemple").value = monk.temple;
  document.getElementById("slipRecMonkName").value = monk.name;
  document.getElementById("slipRecAmount").value = (monk.amount && monk.amount > 0) ? monk.amount : "";

  // ล้างค่าชื่อผู้รับ เพื่อให้กรอกตามจริง (ไม่ใส่ชื่อจำลอง)
  const recNameInput = document.getElementById("slipRecReceiverName");
  const recPhoneInput = document.getElementById("slipRecReceiverPhone");
  if (recNameInput) recNameInput.value = "";
  if (recPhoneInput) recPhoneInput.value = "";

  document.getElementById("slipSelectedBadge").textContent = monk.slipStatus === "รับแล้ว" ? "รับแล้ว (เบิกซ้ำได้)" : "พร้อมทำรายการรับ";
  document.getElementById("slipSelectedBadge").className = monk.slipStatus === "รับแล้ว" ? "status-badge registered" : "status-badge available";

  showToast(`เลือกพระเถระผู้มีสิทธิ์: ${monk.name}`, "success");
}

function clearSlipSearch() {
  document.getElementById("slipSearchMonk").value = "";
  document.getElementById("slipSearchBranch").value = "";
  document.getElementById("slipSearchTemple").value = "";
  renderSlipMonksTable();
}

async function toggleCamera() {
  const video = document.getElementById("webcamVideo");
  const img = document.getElementById("receiverPhotoPreview");
  const btnStart = document.getElementById("btnStartCamera");
  const btnSnap = document.getElementById("btnSnapPhoto");

  if (state.webcamStream) {
    // Stop camera
    state.webcamStream.getTracks().forEach(track => track.stop());
    state.webcamStream = null;
    video.style.display = "none";
    img.style.display = "block";
    btnStart.textContent = "📷 เปิดกล้อง";
    btnSnap.disabled = true;
    document.getElementById("cameraBadge").textContent = "ปิดกล้องแล้ว";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
    state.webcamStream = stream;
    video.srcObject = stream;
    video.style.display = "block";
    img.style.display = "none";
    btnStart.textContent = "🛑 ปิดกล้อง";
    btnSnap.disabled = false;
    document.getElementById("cameraBadge").textContent = "กล้องพร้อมใช้งาน";
    showToast("เปิดกล้อง WebCam สำเร็จ", "success");
  } catch (err) {
    console.error("Camera access error:", err);
    showToast("ไม่สามารถเปิดกล้องได้ หรือเบราว์เซอร์ไม่อนุญาต (ใช้รูปตัวอย่างหรืออัปโหลดไฟล์แทนได้)", "warning");
  }
}

function snapPhoto() {
  const video = document.getElementById("webcamVideo");
  const canvas = document.getElementById("photoCanvas");
  const img = document.getElementById("receiverPhotoPreview");

  if (!state.webcamStream) return;

  canvas.width = 480;
  canvas.height = 400;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  state.receiverPhotoBase64 = canvas.toDataURL("image/jpeg", 0.85);
  img.src = state.receiverPhotoBase64;
  img.style.display = "block";
  video.style.display = "none";

  // Stop stream after snap
  state.webcamStream.getTracks().forEach(track => track.stop());
  state.webcamStream = null;
  document.getElementById("btnStartCamera").textContent = "📷 ถ่ายใหม่";
  document.getElementById("btnSnapPhoto").disabled = true;
  document.getElementById("cameraBadge").textContent = "บันทึกภาพแล้ว";

  showToast("ถ่ายรูปผู้รับเรียบร้อยแล้ว!", "success");
}

function confirmSlipReceive() {
  if (!state.currentSlipMonk) {
    showToast("กรุณาเลือกพระเถระผู้มีสิทธิ์จากตาราง 3.2 ก่อน", "warning");
    return;
  }

  const isEligible = (state.currentSlipMonk.slipRight && state.currentSlipMonk.slipRight.includes("มีสิทธิ์")) || state.currentSlipMonk.allowSlip || ((state.currentSlipMonk._colK || "").includes("มีสิทธิ์"));
  if (!isEligible) {
    showToast("⚠️ ไม่สามารถทำรายการได้: พระสงฆ์รูปนี้ไม่มีสิทธิ์รับใบปวารณาตามคอลัมน์ K", "error");
    return;
  }

  const amount = parseInt(document.getElementById("slipRecAmount").value) || 0;

  const now = new Date().toLocaleString("th-TH");
  const slipRecord = {
    txId: "TX" + Date.now().toString().slice(-6),
    monkId: state.currentSlipMonk.id,
    monkName: state.currentSlipMonk.name,
    temple: state.currentSlipMonk.temple,
    branch: state.currentSlipMonk.branch || "-",
    vassa: state.currentSlipMonk.vassa,
    amount: amount,
    receiverName: "-",
    receiverPhone: "-",
    status: "รับแล้ว",
    receivedAt: now,
    photoUrl: state.receiverPhotoBase64 ? "มีรูปถ่ายผู้รับ (Base64/Drive)" : "assets/receiver_avatar.jpg"
  };

  // Update monk status
  state.currentSlipMonk.slipStatus = "รับแล้ว";
  saveLocal("TEMPLE_MONKS_DATA", state.monks);

  // Add to slips list
  state.slips.unshift(slipRecord);
  saveLocal("TEMPLE_SLIPS_DATA", state.slips);

  updateAllKpis();
  renderSlipMonksTable();
  renderReportTable();

  showToast(`ยืนยันการรับใบปวารณา จำนวน ${amount.toLocaleString()} บาท เรียบร้อย!`, "success");
  showResultPopup(
    "บันทึกรับใบปวารณาสำเร็จ!",
    state.currentSlipMonk.name,
    [
      `<strong>วัด:</strong> ${state.currentSlipMonk.temple || "-"}`,
      `<strong>สาขา:</strong> ${state.currentSlipMonk.branch || "-"}`,
      `<strong>จำนวนปัจจัย:</strong> ${amount > 0 ? amount.toLocaleString() + " บาท" : "-"}`,
      `<strong>เวลาบันทึก:</strong> ${now}`
    ]
  );

  // Send to Google Sheets
  if (state.gasUrl) {
    callGasApi({
      action: "receive_slip",
      monkId: state.currentSlipMonk.id,
      monkName: state.currentSlipMonk.name,
      temple: state.currentSlipMonk.temple,
      branch: state.currentSlipMonk.branch || "",
      vassa: state.currentSlipMonk.vassa,
      amount: amount,
      receiverName: "-",
      receiverPhone: "-",
      photoBase64: state.receiverPhotoBase64
    }).then(res => {
      if (res && res.status === "success") {
        showToast("บันทึกข้อมูลใบปวารณาลง Google Sheet เรียบร้อย", "success");
      }
    });
  }

  resetSlipWorkflow();
}

function resetSlipWorkflow() {
  state.currentSlipMonk = null;
  document.getElementById("slipRecTemple").value = "";
  document.getElementById("slipRecMonkName").value = "";
  document.getElementById("slipRecAmount").value = "";
  document.getElementById("slipSelectedBadge").textContent = "รอเลือกพระเถระ";
  document.getElementById("slipSelectedBadge").className = "status-badge available";
  renderSlipMonksTable();
}

/**
 * --------------------------------------------------------------------------
 * FLOW 4: รายงานสรุป & แดชบอร์ด (Report & Dashboard)
 * --------------------------------------------------------------------------
 */
function updateAllKpis() {
  const totalMonks = state.monks.length;
  const registeredMonks = state.monks.filter(m => m.status === "ลงทะเบียนแล้ว").length;
  const walkinCount = state.walkinMonks.length;
  const layCount = state.laypeople.length;

  const totalSlipAmount = state.slips.reduce((sum, s) => sum + (s.amount || 0), 0);
  const slipCount = state.slips.length;

  // Header and Banner Counters
  const monksTotalElem = document.getElementById("monksTotalCount");
  if (monksTotalElem) monksTotalElem.textContent = totalMonks;

  const monksRegElem = document.getElementById("monksRegisteredCount");
  if (monksRegElem) monksRegElem.textContent = registeredMonks;

  const layRegElem = document.getElementById("layRegisteredCount");
  if (layRegElem) layRegElem.textContent = layCount;

  const slipDelivElem = document.getElementById("slipDeliveredCount");
  if (slipDelivElem) slipDelivElem.textContent = slipCount;

  const slipAmtElem = document.getElementById("slipTotalAmount");
  if (slipAmtElem) slipAmtElem.textContent = totalSlipAmount.toLocaleString();

  // Tab 4 KPI Cards
  const kpiMonkTotal = document.getElementById("kpiMonkTotal");
  if (kpiMonkTotal) kpiMonkTotal.textContent = totalMonks;

  const kpiMonkRegistered = document.getElementById("kpiMonkRegistered");
  if (kpiMonkRegistered) kpiMonkRegistered.textContent = `ลงทะเบียนแล้ว ${registeredMonks} รูป`;

  const kpiMonkWalkin = document.getElementById("kpiMonkWalkin");
  if (kpiMonkWalkin) kpiMonkWalkin.textContent = walkinCount;

  const kpiLayTotal = document.getElementById("kpiLayTotal");
  if (kpiLayTotal) kpiLayTotal.textContent = layCount;

  const kpiSlipAmount = document.getElementById("kpiSlipAmount");
  if (kpiSlipAmount) kpiSlipAmount.textContent = `${totalSlipAmount.toLocaleString()} บาท`;

  const kpiSlipCount = document.getElementById("kpiSlipCount");
  if (kpiSlipCount) kpiSlipCount.textContent = `จ่ายแล้ว ${slipCount} รายการ`;
}

function switchReportSubTab(type) {
  state.activeReportTab = type;
  document.getElementById("btnFilterMonks").className = type === 'monks' ? 'btn btn-secondary btn-sm active-filter' : 'btn btn-secondary btn-sm';
  document.getElementById("btnFilterWalkin").className = type === 'walkin' ? 'btn btn-secondary btn-sm active-filter' : 'btn btn-secondary btn-sm';
  document.getElementById("btnFilterLay").className = type === 'lay' ? 'btn btn-secondary btn-sm active-filter' : 'btn btn-secondary btn-sm';
  document.getElementById("btnFilterSlips").className = type === 'slips' ? 'btn btn-secondary btn-sm active-filter' : 'btn btn-secondary btn-sm';
  renderReportTable();
}

function renderReportTable() {
  const thead = document.getElementById("reportTableHead");
  const tbody = document.getElementById("reportTableBody");
  const search = (document.getElementById("reportSearchInput")?.value || "").toLowerCase().trim();

  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (state.activeReportTab === "monks") {
    thead.innerHTML = `
      <tr>
        <th style="width:50px;">ลำดับ</th>
        <th>รหัส</th>
        <th>ชื่อ / ฉายา</th>
        <th>วัด</th>
        <th>สาขา</th>
        <th>จังหวัด</th>
        <th>พรรษา</th>
        <th>ที่พัก/ของที่ระลึก</th>
        <th>สถานะ</th>
        <th>เวลาลงทะเบียน</th>
      </tr>
    `;

    const filtered = state.monks.filter(m => {
      return !search || (m.name + m.temple + m.province + m.status + m.id).toLowerCase().includes(search);
    });

    filtered.slice(0, 100).forEach((m, idx) => {
      const isReg = m.status === "ลงทะเบียนแล้ว";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><code>${m.id}</code></td>
        <td style="font-weight:600;">${m.name}</td>
        <td>${m.temple}</td>
        <td>${m.branch || '-'}</td>
        <td>${m.province}</td>
        <td>${m.vassa}</td>
        <td>${m.hotel || '-'}</td>
        <td><span class="status-badge ${isReg ? 'registered' : 'available'}">${m.status}</span></td>
        <td>${m.registeredAt || '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  else if (state.activeReportTab === "walkin") {
    thead.innerHTML = `
      <tr>
        <th style="width:50px;">ลำดับ</th>
        <th>รหัส</th>
        <th>ชื่อ / ฉายา</th>
        <th>วัดต้นสังกัด</th>
        <th>พรรษา</th>
        <th>จังหวัด</th>
        <th>เบอร์โทร</th>
        <th>เวลาลงทะเบียน</th>
      </tr>
    `;

    state.walkinMonks.forEach((m, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><code>${m.id}</code></td>
        <td style="font-weight:600;">${m.name}</td>
        <td>${m.temple}</td>
        <td>${m.vassa}</td>
        <td>${m.province}</td>
        <td>${m.phone}</td>
        <td>${m.registeredAt}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  else if (state.activeReportTab === "lay") {
    thead.innerHTML = `
      <tr>
        <th style="width:50px;">ลำดับ</th>
        <th>รหัส</th>
        <th>ชื่อ - นามสกุล</th>
        <th>เลขบัตรประชาชน</th>
        <th>เพศ</th>
        <th>ที่อยู่</th>
        <th>เบอร์โทรศัพท์</th>
        <th>เบอร์ฉุกเฉิน</th>
        <th>เวลาลงทะเบียน</th>
      </tr>
    `;

    state.laypeople.forEach((l, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><code>${l.id}</code></td>
        <td style="font-weight:600;">${l.name}</td>
        <td>${l.idCard}</td>
        <td>${l.gender}</td>
        <td>${l.address}</td>
        <td>${l.phone}</td>
        <td>${l.emergencyPhone}</td>
        <td>${l.registeredAt}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  else if (state.activeReportTab === "slips") {
    thead.innerHTML = `
      <tr>
        <th style="width:50px;">ลำดับ</th>
        <th>รหัสใบเสร็จ</th>
        <th>ชื่อพระ / ฉายา</th>
        <th>วัด</th>
        <th>สาขา</th>
        <th>จำนวนปัจจัย</th>
        <th>เวลาที่รับ</th>
      </tr>
    `;

    state.slips.forEach((s, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><code>${s.txId}</code></td>
        <td style="font-weight:600;">${s.monkName}</td>
        <td>${s.temple}</td>
        <td>${s.branch || "-"}</td>
        <td style="font-weight:700; color:#166534;">${(s.amount && s.amount > 0) ? `${s.amount.toLocaleString()} บาท` : "-"}</td>
        <td>${s.receivedAt}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Quick listener for search
  const searchInput = document.getElementById("reportSearchInput");
  if (searchInput && !searchInput.dataset.hasListener) {
    searchInput.dataset.hasListener = "true";
    searchInput.addEventListener("input", () => {
      renderReportTable();
    });
  }
}

function exportDataToCsv() {
  let csvContent = "\uFEFF"; // UTF-8 BOM for Excel Thai text support
  let filename = "";

  if (state.activeReportTab === "monks") {
    filename = "รายนามพระสงฆ์ที่นิมนต์.csv";
    csvContent += "รหัส,ชื่อ_ฉายา,วัด,สาขา,จังหวัด,พรรษา,ที่พัก_ของที่ระลึก,สถานะ,เวลาลงทะเบียน\n";
    state.monks.forEach(m => {
      csvContent += `"${m.id}","${m.name}","${m.temple}","${m.branch || ''}","${m.province}","${m.vassa}","${m.hotel || ''}","${m.status}","${m.registeredAt || ''}"\n`;
    });
  } else if (state.activeReportTab === "walkin") {
    filename = "ลงทะเบียนพระนอกรายชื่อ.csv";
    csvContent += "รหัส,ชื่อ_ฉายา,วัด,พรรษา,จังหวัด,เบอร์โทรศัพท์,เวลาลงทะเบียน\n";
    state.walkinMonks.forEach(m => {
      csvContent += `"${m.id}","${m.name}","${m.temple}","${m.vassa}","${m.province}","${m.phone}","${m.registeredAt}"\n`;
    });
  } else if (state.activeReportTab === "lay") {
    filename = "ลงทะเบียนญาติโยม.csv";
    csvContent += "รหัส,ชื่อ_นามสกุล,เลขบัตรประชาชน,เพศ,ที่อยู่,เบอร์โทร,เบอร์ฉุกเฉิน,เวลาลงทะเบียน\n";
    state.laypeople.forEach(l => {
      csvContent += `"${l.id}","${l.name}","${l.idCard}","${l.gender}","${l.address}","${l.phone}","${l.emergencyPhone}","${l.registeredAt}"\n`;
    });
  } else if (state.activeReportTab === "slips") {
    filename = "บันทึกการรับใบปวารณา.csv";
    csvContent += "รหัสรายการ,ชื่อพระ,ชื่อวัด,สาขา,จำนวนปัจจัย,เวลาที่รับ\n";
    state.slips.forEach(s => {
      csvContent += `"${s.txId}","${s.monkName}","${s.temple}","${s.branch || ''}","${s.amount}","${s.receivedAt}"\n`;
    });
  }

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  showToast(`ส่งออกข้อมูลเป็นไฟล์ ${filename} เรียบร้อย`, "success");
}

/**
 * --------------------------------------------------------------------------
 * FLOW 5: ตั้งค่า Google Sheets (Settings & Live Sync)
 * --------------------------------------------------------------------------
 */
function setupSettingsWorkflow() {
  document.getElementById("btnSaveGasUrl").addEventListener("click", () => {
    const url = document.getElementById("settingsGasUrl").value.trim();
    if (!url) {
      localStorage.removeItem("TEMPLE_GAS_URL");
      state.gasUrl = "";
      updateGasStatusUI(false, "โหมดออฟไลน์ / Local Data");
      showToast("ล้างการเชื่อมต่อ Google Sheets กลับสู่โหมดออฟไลน์", "info");
      return;
    }
    state.gasUrl = url;
    localStorage.setItem("TEMPLE_GAS_URL", url);
    showToast("บันทึก URL เว็บแอป Google Apps Script เรียบร้อย", "success");
    testGasConnection();
  });

  document.getElementById("btnTestGasUrl").addEventListener("click", () => {
    testGasConnection();
  });

  document.getElementById("btnPushMonksToSheet").addEventListener("click", () => {
    pushMonksToGoogleSheet();
  });
}

async function testGasConnection(silent = false) {
  const url = state.gasUrl || document.getElementById("settingsGasUrl").value.trim();
  const statusBox = document.getElementById("gasConnectionStatus");

  if (!url) {
    if (!silent) showToast("กรุณาระบุ Web App URL ก่อนทดสอบ", "warning");
    return;
  }

  if (statusBox) {
    statusBox.style.display = "block";
    statusBox.style.background = "#fef3c7";
    statusBox.style.color = "#92400e";
    statusBox.textContent = "กำลังทดสอบเชื่อมต่อไปยัง Google Sheets...";
  }

  try {
    // Add ping action
    const testUrl = url.includes("?") ? `${url}&action=ping` : `${url}?action=ping`;
    const res = await fetch(testUrl, { method: "GET", mode: "cors" });
    const json = await res.json();

    if (json && json.status === "success") {
      updateGasStatusUI(true, "เชื่อมต่อ Google Sheet สำเร็จ (Live Sync)");
      if (statusBox) {
        statusBox.style.background = "#ecfdf5";
        statusBox.style.color = "#065f46";
        statusBox.innerHTML = `✓ <strong>เชื่อมต่อสำเร็จ!</strong> ฐานข้อมูล: ${json.sheetName || 'Google Sheets พร้อมใช้งาน'}`;
      }
      if (!silent) showToast("เชื่อมต่อ Google Sheets สำเร็จเรียบร้อย!", "success");
      return true;
    } else {
      throw new Error(json.message || "Failed");
    }
  } catch (err) {
    console.warn("GAS Ping Warning (may need deployment check):", err);
    updateGasStatusUI(false, "โหมดออฟไลน์ / ตรวจสอบสิทธิ์ Apps Script");
    if (statusBox) {
      statusBox.style.background = "#fff1f2";
      statusBox.style.color = "#9f1239";
      statusBox.innerHTML = `✕ <strong>ไม่สามารถเชื่อมต่อได้:</strong> โปรดตรวจสอบว่าตอน Deploy Apps Script ได้เลือก 'ใครมีสิทธิ์เข้าถึง: ทุกคน (Anyone)' หรือยัง`;
    }
    if (!silent) showToast("ไม่สามารถเชื่อมต่อ Google Sheets ได้ ตรวจสอบสิทธิ์การเข้าถึง", "error");
    return false;
  }
}

// Background Realtime Sync Engine (ทุก 6 วินาที อัตโนมัติเบื้องหลัง)
let realtimeSyncInterval = 6;
let realtimeCountdownTimer = null;
let isRealtimeSyncing = false;

function initRealtimeSync() {
  // ซิงก์ทันทีเมื่อผู้ใช้สลับกลับมาที่หน้าต่างนี้ (Tab Focus / Visibility Change)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.gasUrl && !isRealtimeSyncing) {
      fetchLiveDataFromSheet(false);
    }
  });

  window.addEventListener("focus", () => {
    if (state.gasUrl && !isRealtimeSyncing) {
      fetchLiveDataFromSheet(false);
    }
  });

  startRealtimeSync();
}

function startRealtimeSync() {
  stopRealtimeSync();
  realtimeCountdownTimer = setInterval(() => {
    if (!isRealtimeSyncing && state.gasUrl) {
      fetchLiveDataFromSheet(false);
    }
  }, realtimeSyncInterval * 1000);
}

function stopRealtimeSync() {
  if (realtimeCountdownTimer) {
    clearInterval(realtimeCountdownTimer);
    realtimeCountdownTimer = null;
  }
}

window.triggerImmediateSync = function (showFeedback = false) {
  return fetchLiveDataFromSheet(showFeedback);
};

/**
 * ดึงข้อมูลสดล่าสุดจาก Google Sheet ทั้ง 4 แผ่นงาน
 */
async function fetchLiveDataFromSheet(notify = false) {
  if (!state.gasUrl) return;
  if (isRealtimeSyncing) return;
  isRealtimeSyncing = true;

  if (notify) showToast("กำลังดึงข้อมูลล่าสุดจาก Google Sheets...", "info");

  try {
    const testUrl = state.gasUrl.includes("?") ? `${state.gasUrl}&action=get_all_data` : `${state.gasUrl}?action=get_all_data`;
    const res = await fetch(testUrl, { method: "GET", mode: "cors" });
    const json = await res.json();
    if (json && json.status === "success") {
      // 1. พระสงฆ์ที่นิมนต์
      if (json.monks && json.monks.length > 0) {
        const sampleName = json.monks[0]["ชื่อ / ฉายา"] || json.monks[0].name || "";
        if (!sampleName.includes("???")) {
          state.monks = json.monks.map((m, idx) => {
            const monkNum = parseInt((m.id || m["รหัส"] || "").replace("MK", "")) || (idx + 1);
            const realPhoto = `assets/monks/monk_row_${monkNum + 1}.jpg`;
            // ดึงข้อความตามคอลัมน์ J (ที่พัก / โรงแรม): ถ้าช่องนั้นว่าง ก็ว่างไว้
            const rawColJ = (m._colJ !== undefined && m._colJ !== null) ? m._colJ : m["ที่พัก / โรงแรม"];
            const rawHotel = (rawColJ !== undefined && rawColJ !== null) ? rawColJ.toString().trim() : "";
            const cleanHotel = (rawHotel === "#N/A" || rawHotel.toLowerCase() === "null") ? "" : rawHotel;

            // ดึงข้อความตามคอลัมน์ K (สิทธิ์รับใบปวารณา): ถ้าช่องนั้นว่าง ก็ว่างไว้
            const rawColK = (m._colK !== undefined && m._colK !== null) ? m._colK : m["สิทธิ์รับใบปวารณา"];
            const rawSlip = (rawColK !== undefined && rawColK !== null) ? rawColK.toString().trim() : "";
            const cleanSlip = (rawSlip === "#N/A" || rawSlip.toLowerCase() === "null") ? "" : rawSlip;

            const isAllowSlip = cleanSlip.includes("มีสิทธิ์") || cleanSlip.includes("รับ");
            const rawAmount = m["จำนวนปัจจัย"] ? parseInt(m["จำนวนปัจจัย"].toString().replace(/[^\d]/g, "")) : 0;
            const rawPhone = (m["เบอร์โทรศัพท์"] || m.phone || "").toString().trim();
            const cleanPhone = (rawPhone === "-" || rawPhone.toLowerCase() === "null") ? "" : rawPhone;
            const st = (m["สถานะลงทะเบียน"] || m["สถานะการลงทะเบียน"] || m.status || "").toString().trim();
            const sl = (m["สถานะรับใบปวารณา"] || m["สถานะใบปวารณา"] || m.slipStatus || "").toString().trim();

            return {
              id: m["รหัส"] || m.id,
              idCard: m["เลขบัตรประชาชน"] ? m["เลขบัตรประชาชน"].toString() : (m.idCard || ""),
              photo: realPhoto,
              name: m["ชื่อ / ฉายา"] || m.name,
              branch: m["ลำดับสาขา"] || m.branch,
              temple: m["ชื่อวัด"] || m.temple,
              district: m["อำเภอ"] || m.district,
              province: m["จังหวัด"] || m.province,
              vassa: m["พรรษา"] || m.vassa || 0,
              phone: cleanPhone,
              hotel: cleanHotel,
              slipRight: cleanSlip,
              allowSlip: isAllowSlip,
              amount: rawAmount || 0,
              status: (st === "ลงทะเบียนแล้ว") ? "ลงทะเบียนแล้ว" : "ยังไม่ลงทะเบียน",
              slipStatus: (sl === "รับแล้ว") ? "รับแล้ว" : "ยังไม่ได้รับ",
              registeredAt: (st === "ลงทะเบียนแล้ว") ? (m["เวลาที่ลงทะเบียน"] || m.registeredAt || "") : ""
            };
          });
          saveLocal("TEMPLE_MONKS_DATA", state.monks);
          populateMonkQuickSelect();
          renderMonkSelectTable();
          renderSlipMonksTable();
          renderReportTable();
          updateAllKpis();

          // อัปเดตหน้าจอข้อมูลพระที่เปิดค้างอยู่ทันทีให้ตรงกับข้อมูลล่าสุดจากชีต
          if (state.currentSelectedMonk) {
            const updated = state.monks.find(m => m.id === state.currentSelectedMonk.id);
            if (updated) {
              state.currentSelectedMonk = updated;
              const invitedForm = document.getElementById("monkInvitedForm");
              if (invitedForm && invitedForm.style.display !== "none") {
                displayInvitedMonk(updated);
              }
            }
          }
        }
      }

      // 2. พระนอกรายชื่อ (ดีดูพลิเคตโดยใช้เลขบัตรประชาชนเป็น Primary Key ห้ามซ้ำ)
      if (Array.isArray(json.walkinMonks)) {
        const uniqueWalkins = [];
        const seenCards = new Set();
        const seenIds = new Set();

        json.walkinMonks.forEach(w => {
          const rawCard = (w["เลขบัตรประชาชน"] || w.idCard || "").toString();
          const cleanCard = rawCard.replace(/[-\s]/g, "").trim();
          const wId = (w["รหัส"] || w.id || "").toString().trim();

          // ตรวจสอบความซ้ำซ้อนโดยยึดเลขบัตรประชาชนเป็น Primary Key
          if (cleanCard && cleanCard.length >= 10 && !cleanCard.includes("x")) {
            if (seenCards.has(cleanCard)) return; // ข้ามแถวที่เลขบัตรซ้ำ
            seenCards.add(cleanCard);
          } else if (wId) {
            if (seenIds.has(wId)) return;
            seenIds.add(wId);
          }

          uniqueWalkins.push({
            id: wId,
            idCard: rawCard,
            name: w["ชื่อ / ฉายา"] || w.name,
            temple: w["ชื่อวัด"] || w.temple,
            vassa: w["พรรษา"] || w.vassa || 0,
            province: w["จังหวัด"] || w.province || "ไม่ระบุ",
            phone: w["เบอร์โทรศัพท์"] || w["เบอร์โทร"] || w.phone || "-",
            status: w["สถานะลงทะเบียน"] || w["สถานะ"] || "ลงทะเบียนแล้ว",
            registeredAt: w["เวลาที่ลงทะเบียน"] || w["เวลาลงทะเบียน"] || w.registeredAt || ""
          });
        });

        state.walkinMonks = uniqueWalkins;
        saveLocal("TEMPLE_WALKIN_DATA", state.walkinMonks);
      }

      // 3. ญาติโยม (ดีดูพลิเคตโดยใช้รหัสญาติโยมเป็น Primary Key ห้ามซ้ำ)
      if (Array.isArray(json.laypeople)) {
        const uniqueLay = [];
        const seenIds = new Set();

        json.laypeople.forEach(l => {
          const lId = (l["รหัส"] || l.id || "").toString().trim();
          if (!lId || seenIds.has(lId.toLowerCase())) return;
          seenIds.add(lId.toLowerCase());

          uniqueLay.push({
            id: lId,
            idCard: (l["เลขบัตรประชาชน"] || l.idCard || "").toString(),
            name: l["ชื่อ - นามสกุล"] || l.name || "",
            birthday: l["วันเกิด"] || l.birthday || "",
            gender: l["เพศ"] || l.gender || "ชาย",
            address: l["ที่อยู่"] || l.address || "",
            phone: l["เบอร์โทรศัพท์"] || l["เบอร์โทร"] || l.phone || "-",
            emergencyPhone: l["เบอร์ติดต่อฉุกเฉิน"] || l.emergencyPhone || "-",
            registeredAt: l["เวลาที่ลงทะเบียน"] || l["เวลาลงทะเบียน"] || l.registeredAt || ""
          });
        });

        state.laypeople = uniqueLay;
        saveLocal("TEMPLE_LAY_DATA", state.laypeople);
      }

      // 4. ใบปวารณา (หากชีตว่าง ให้ล้างข้อมูลในเครื่องให้ตรงกัน)
      if (Array.isArray(json.slips)) {
        state.slips = json.slips.map(s => ({
          txId: s["รหัสบันทึก"] || s.txId,
          monkId: s["รหัสพระ"] || s.monkId,
          temple: s["ชื่อวัด"] || s.temple,
          monkName: s["ชื่อพระ / ฉายา"] || s.monkName,
          vassa: s["พรรษา"] || s.vassa,
          amount: s["จำนวนปัจจัย (บาท)"] || s.amount,
          receiverName: s["ชื่อผู้มารับเงิน"] || s.receiverName,
          receiverPhone: s["เบอร์ติดต่อผู้รับ"] || s.receiverPhone,
          status: s["สถานะการรับ"] || s.status,
          receivedAt: s["วันเวลาที่รับ"] || s.receivedAt,
          photoUrl: s["ลิงก์รูปถ่ายผู้รับ"] || s.photoUrl
        }));
        saveLocal("TEMPLE_SLIPS_DATA", state.slips);
      }

      updateAllKpis();
      renderSlipMonksTable();
      renderReportTable();

      // บันทึกเวลาซิงก์ล่าสุด
      const now = new Date();
      const timeStr = now.toLocaleTimeString('th-TH', { hour12: false });
      const lastSyncedEl = document.getElementById("lastSyncedTime");
      if (lastSyncedEl) lastSyncedEl.textContent = `(ซิงก์ล่าสุด: ${timeStr})`;

      updateGasStatusUI(true, `เชื่อมต่อ Google Sheet เรียลไทม์ (${timeStr})`);

      if (notify) showToast("ซิงก์ข้อมูลตรงกับ Google Sheets เรียบร้อยแล้ว", "success");
    }
  } catch (err) {
    console.warn("Could not fetch live data from Google Sheet:", err);
    if (notify) showToast("ไม่สามารถซิงก์ข้อมูลได้ กรุณาลองใหม่อีกครั้ง", "error");
  } finally {
    isRealtimeSyncing = false;
  }
}

/**
 * ล้างข้อมูลและรีเซ็ตสถานะการลงทะเบียนทั้งหมดในระบบ
 */
window.resetAllRegistrations = function () {
  const ans = confirm("ต้องการล้างข้อมูลและสถานะการลงทะเบียนทั้งหมดในระบบหรือไม่?\n\n- สถานะพระสงฆ์จะกลับเป็น 'ยังไม่ลงทะเบียน'\n- รายชื่อพระนอกรายชื่อ, ญาติโยม, และรายการรับใบปวารณาจะถูกล้างออก");
  if (!ans) return;

  const initialList = window.INITIAL_MONKS_DATA || [];
  state.monks = initialList.map(im => {
    const monkNum = parseInt(im.id.replace("MK", "")) || 1;
    return {
      ...im,
      photo: `assets/monks/monk_row_${monkNum + 1}.jpg`,
      status: "ยังไม่ลงทะเบียน",
      slipStatus: "ยังไม่ได้รับ",
      registeredAt: null,
      receivedBy: null,
      receiverPhoto: null
    };
  });
  saveLocal("TEMPLE_MONKS_DATA", state.monks);

  state.walkinMonks = [];
  saveLocal("TEMPLE_WALKIN_DATA", []);

  state.laypeople = [];
  saveLocal("TEMPLE_LAY_DATA", []);

  state.slips = [];
  saveLocal("TEMPLE_SLIPS_DATA", []);

  updateAllKpis();
  renderSlipMonksTable();
  renderReportTable();
  populateMonkQuickSelect();
  showToast("ล้างข้อมูลและรีเซ็ตสถานะทั้งหมดเรียบร้อยแล้ว แดชบอร์ดเป็น 0", "success");
};

function updateGasStatusUI(connected, text) {
  const pill = document.getElementById("gsheetStatusPill");
  const txt = document.getElementById("gsheetStatusText");
  if (pill && txt) {
    pill.className = connected ? "gsheet-status-pill connected" : "gsheet-status-pill";
    txt.textContent = text;
  }
}

async function callGasApi(payload) {
  if (!state.gasUrl) return null;

  try {
    // ใช้ text/plain;charset=utf-8 เพื่อป้องกัน CORS preflight และรักษาการเข้ารหัสภาษาไทย
    const res = await fetch(state.gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return { status: "success" };
  } catch (err) {
    console.error("API Call Error:", err);
    return null;
  }
}

async function pushMonksToGoogleSheet() {
  if (!state.gasUrl) {
    showToast("กรุณาเชื่อมต่อ Google Apps Script URL ก่อน", "warning");
    return;
  }

  const confirmSync = confirm(`ต้องการอัปโหลดข้อมูลพระสงฆ์ทั้ง 422 รายนามขึ้นไปยัง Google Sheet หรือไม่?`);
  if (!confirmSync) return;

  showToast("กำลังส่งข้อมูล 422 รายนามขึ้น Google Sheet กรุณารอสักครู่...", "info");

  try {
    // ใช้ window.INITIAL_MONKS_DATA ซึ่งเป็นภาษาไทยแท้แน่นอน
    const cleanMonks = window.INITIAL_MONKS_DATA || state.monks;

    await fetch(state.gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "batch_import_monks",
        monks: cleanMonks
      })
    });

    showToast("ส่งคำสั่งสร้างแผ่นงานและนำเข้า 422 รายนามขึ้น Google Sheet สำเร็จ!", "success");
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการส่งข้อมูล: " + e.message, "error");
  }
}

function copyGasCodeToClipboard() {
  const scriptContent = `/**
 * ระบบลงทะเบียนเข้างาน - Google Apps Script Backend
 * ดูโค้ดฉบับเต็มได้ที่ไฟล์ GoogleAppsScript_Backend.js ในโปรเจกต์
 */
function doGet(e){return ContentService.createTextOutput(JSON.stringify({status:"success",message:"Online"})).setMimeType(ContentService.MimeType.JSON);}
function doPost(e){return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);}`;

  navigator.clipboard.writeText(scriptContent).then(() => {
    showToast("คัดลอกตัวอย่างโค้ดเรียบร้อย (กรุณาใช้ไฟล์เต็ม GoogleAppsScript_Backend.js)", "success");
  });
}

/**
 * --------------------------------------------------------------------------
 * Toast Notification Helper
 * --------------------------------------------------------------------------
 */
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon = type === "success" ? "✓" : type === "warning" ? "⚠️" : type === "error" ? "✕" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
