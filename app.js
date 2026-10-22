/**
 * ==========================================================================
 * ระบบลงทะเบียนเข้างานวัด (Temple Event Registration System)
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
  webcamStream: null,
  receiverPhotoBase64: "",
  activeReportTab: "monks"
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initData();
  setupNavigation();
  setupMonkWorkflow();
  setupLayWorkflow();
  setupSlipWorkflow();
  setupSettingsWorkflow();
  updateAllKpis();
  renderReportTable();

  // Set input field value
  const inputElem = document.getElementById("settingsGasUrl");
  if (inputElem) inputElem.value = state.gasUrl;

  // Check GAS Connection & Fetch live data
  if (state.gasUrl) {
    testGasConnection(true).then(connected => {
      if (connected) {
        fetchLiveDataFromSheet();
      }
    });
  }
});

/**
 * --------------------------------------------------------------------------
 * Data Initialization & Persistence
 * --------------------------------------------------------------------------
 */
function initData() {
  // Load initial monks from monks_data.js or localStorage
  const savedMonks = localStorage.getItem("TEMPLE_MONKS_DATA");
  if (savedMonks) {
    try {
      state.monks = JSON.parse(savedMonks);
    } catch (e) {
      state.monks = window.INITIAL_MONKS_DATA || [];
    }
  } else {
    state.monks = window.INITIAL_MONKS_DATA || [];
    saveLocal("TEMPLE_MONKS_DATA", state.monks);
  }

  // Load walkin monks
  const savedWalkin = localStorage.getItem("TEMPLE_WALKIN_DATA");
  state.walkinMonks = savedWalkin ? JSON.parse(savedWalkin) : [];

  // Load laypeople
  const savedLay = localStorage.getItem("TEMPLE_LAY_DATA");
  state.laypeople = savedLay ? JSON.parse(savedLay) : [];

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
function populateMonkQuickSelect() {
  const select = document.getElementById("monkQuickSelect");
  select.innerHTML = `<option value="">-- เลือกเพื่อจำลองเสียบบัตร (พระสงฆ์ 422 รายนาม) --</option>`;

  state.monks.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name} - ${m.temple} (${m.province}) [${m.status}]`;
    select.appendChild(opt);
  });

  select.addEventListener("change", (e) => {
    const monkId = e.target.value;
    if (!monkId) return;
    const monk = state.monks.find(m => m.id === monkId);
    if (monk) {
      document.getElementById("monkIdCardInput").value = monk.idCard;
      triggerMonkScan(monk.idCard);
    }
  });
}

function populateTempleDatalist() {
  const datalist = document.getElementById("templeList");
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

  btnScan.addEventListener("click", () => {
    const val = inputCard.value.trim();
    if (!val) {
      showToast("กรุณากรอกเลขบัตรประชาชน หรือชื่อพระ/วัด", "warning");
      return;
    }
    triggerMonkScan(val);
  });

  inputCard.addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      btnScan.click();
    }
  });

  // Confirm Registration Button (1.3)
  document.getElementById("btnConfirmMonkRegistration").addEventListener("click", () => {
    if (!state.currentSelectedMonk) return;
    confirmMonkRegistration(state.currentSelectedMonk);
  });

  // Save Walkin Monk Button (1.4)
  document.getElementById("btnSaveWalkinMonk").addEventListener("click", () => {
    saveWalkinMonk();
  });
}

function triggerMonkScan(searchTerm) {
  // Show checking animation (Step 1.2)
  document.getElementById("monkIdleState").style.display = "none";
  document.getElementById("monkCheckingState").style.display = "flex";
  document.getElementById("monkResultRouting").style.display = "none";
  document.getElementById("monkDetailPlaceholder").style.display = "none";
  document.getElementById("monkInvitedForm").style.display = "none";
  document.getElementById("monkWalkinForm").style.display = "none";

  const cleanTerm = searchTerm.replace(/[-\s]/g, "").toLowerCase();

  setTimeout(() => {
    document.getElementById("monkCheckingState").style.display = "none";
    document.getElementById("monkResultRouting").style.display = "block";

    // Search in invited monks
    const found = state.monks.find(m => {
      const mCard = (m.idCard || "").replace(/[-\s]/g, "").toLowerCase();
      const mName = (m.name || "").toLowerCase();
      const mTemple = (m.temple || "").toLowerCase();
      return (
        m.id.toLowerCase() === cleanTerm ||
        mCard.includes(cleanTerm) ||
        mName.includes(cleanTerm) ||
        mTemple.includes(cleanTerm)
      );
    });

    if (found) {
      // 1.3 Found in invited list!
      document.getElementById("routeFound").style.display = "block";
      document.getElementById("routeNotFound").style.display = "none";
      displayInvitedMonk(found);
      showToast(`พบข้อมูลนิมนต์: ${found.name}`, "success");
    } else {
      // 1.4 Not found in invited list -> walkin form
      document.getElementById("routeFound").style.display = "none";
      document.getElementById("routeNotFound").style.display = "block";
      displayWalkinMonkForm(searchTerm);
      showToast("ไม่พบในรายชื่อนิมนต์ เปิดแบบฟอร์มลงทะเบียนพระนอกรายชื่อ", "warning");
    }
  }, 600); // 600ms smooth simulation
}

function displayInvitedMonk(monk) {
  state.currentSelectedMonk = monk;
  document.getElementById("monkDetailHeader").textContent = "1.3 แสดงข้อมูลพระที่ได้รับเชิญ";
  
  const statusBadge = document.getElementById("monkDetailSubheader");
  if (monk.status === "ลงทะเบียนแล้ว") {
    statusBadge.className = "status-badge registered";
    statusBadge.textContent = "• ลงทะเบียนแล้ว";
  } else {
    statusBadge.className = "status-badge available";
    statusBadge.textContent = "• ลงทะเบียนได้";
  }

  const photoElem = document.getElementById("infoMonkPhoto");
  if (photoElem) photoElem.src = monk.photo || "assets/monk_avatar.jpg";

  document.getElementById("infoMonkName").textContent = monk.name;
  document.getElementById("infoMonkTemple").textContent = monk.temple;
  document.getElementById("infoMonkProvince").textContent = `${monk.province} (${monk.branch || 'สาขากลาง'})`;
  document.getElementById("infoMonkVassa").textContent = `${monk.vassa} พรรษา`;
  document.getElementById("infoMonkHotel").textContent = monk.hotel || "กุฏิรับรองสงฆ์ อาคารเฉลิมพระเกียรติ";
  document.getElementById("infoMonkSlipRight").textContent = monk.allowSlip ? `รับใบปวารณา (มีปัจจัย ${monk.amount.toLocaleString()} บาท)` : "ไม่มีปัจจัย";
  
  const statusElem = document.getElementById("infoMonkStatus");
  statusElem.className = monk.status === "ลงทะเบียนแล้ว" ? "status-badge registered" : "status-badge available";
  statusElem.textContent = monk.status === "ลงทะเบียนแล้ว" ? "✓ ลงทะเบียนเรียบร้อยแล้ว" : "• พร้อมยืนยันลงทะเบียน";

  document.getElementById("infoMonkTime").textContent = monk.registeredAt || "ยังไม่ได้ลงทะเบียน";

  const btnConfirm = document.getElementById("btnConfirmMonkRegistration");
  if (monk.status === "ลงทะเบียนแล้ว") {
    btnConfirm.textContent = "✓ ลงทะเบียนแล้ว (กดเพื่ออัปเดตซ้ำ)";
    btnConfirm.style.background = "#15803d";
  } else {
    btnConfirm.textContent = "✓ ยืนยันลงทะเบียนพระสงฆ์";
    btnConfirm.style.background = "";
  }

  document.getElementById("monkInvitedForm").style.display = "block";
  document.getElementById("monkWalkinForm").style.display = "none";
}

function confirmMonkRegistration(monk) {
  const now = new Date().toLocaleString("th-TH");
  monk.status = "ลงทะเบียนแล้ว";
  monk.registeredAt = now;

  saveLocal("TEMPLE_MONKS_DATA", state.monks);
  updateAllKpis();
  renderSlipMonksTable();
  renderReportTable();

  showToast(`ยืนยันการลงทะเบียน ${monk.name} สำเร็จ!`, "success");
  displayInvitedMonk(monk);

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
      hotel: monk.hotel,
      registeredAt: now
    }).then(res => {
      if (res && res.status === "success") {
        showToast("ซิงก์ข้อมูลลงทะเบียนขึ้น Google Sheet เรียบร้อย", "success");
      }
    });
  }
}

function displayWalkinMonkForm(searchCard) {
  state.currentSelectedMonk = null;
  document.getElementById("monkDetailHeader").textContent = "1.4 ลงทะเบียนพระ (กรณีไม่ได้รับเชิญ)";
  document.getElementById("monkDetailSubheader").className = "status-badge pending";
  document.getElementById("monkDetailSubheader").textContent = "พระนอกรายชื่อ";

  document.getElementById("walkinIdCard").value = searchCard.length > 5 ? searchCard : "";
  document.getElementById("walkinName").value = "";
  document.getElementById("walkinVassa").value = "";
  document.getElementById("walkinTemple").value = "";
  document.getElementById("walkinProvince").value = "";
  document.getElementById("walkinPhone").value = "";

  document.getElementById("monkInvitedForm").style.display = "none";
  document.getElementById("monkWalkinForm").style.display = "block";
}

function saveWalkinMonk() {
  const name = document.getElementById("walkinName").value.trim();
  const idCard = document.getElementById("walkinIdCard").value.trim();
  const vassa = parseInt(document.getElementById("walkinVassa").value) || 0;
  const temple = document.getElementById("walkinTemple").value.trim();
  const province = document.getElementById("walkinProvince").value.trim();
  const phone = document.getElementById("walkinPhone").value.trim();

  if (!name || !temple) {
    showToast("กรุณากรอกชื่อพระ/ฉายา และชื่อวัดต้นสังกัด", "warning");
    return;
  }

  const now = new Date().toLocaleString("th-TH");
  const newMonk = {
    id: "WK" + Date.now().toString().slice(-6),
    idCard: idCard || "1-xxxx-xxxxx-xx-x",
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

  showToast(`บันทึกและลงทะเบียนพระนอกรายชื่อ: ${name} สำเร็จ`, "success");
  resetMonkWorkflow();

  // Send to Google Sheets
  if (state.gasUrl) {
    callGasApi({
      action: "register_walkin_monk",
      ...newMonk
    }).then(res => {
      if (res && res.status === "success") {
        showToast("บันทึกลง Google Sheet แผ่น 'ลงทะเบียนพระนอกรายชื่อ' สำเร็จ", "success");
      }
    });
  }
}

function resetMonkWorkflow() {
  state.currentSelectedMonk = null;
  document.getElementById("monkIdCardInput").value = "";
  document.getElementById("monkQuickSelect").value = "";
  document.getElementById("monkIdleState").style.display = "flex";
  document.getElementById("monkCheckingState").style.display = "none";
  document.getElementById("monkResultRouting").style.display = "none";
  document.getElementById("monkDetailPlaceholder").style.display = "block";
  document.getElementById("monkInvitedForm").style.display = "none";
  document.getElementById("monkWalkinForm").style.display = "none";
  document.getElementById("monkDetailHeader").textContent = "1.3 ข้อมูลการลงทะเบียนพระสงฆ์";
  document.getElementById("monkDetailSubheader").className = "status-badge available";
  document.getElementById("monkDetailSubheader").textContent = "รอการตรวจสอบ";
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
const SAMPLE_LAYPEOPLE = [
  { name: "นายสมชาย ใจดี", idCard: "1-2345-67890-12-3", birthday: "12/03/2530", gender: "ชาย", address: "123 หมู่ 1 ต.ในเมือง อ.เมือง จ.เชียงใหม่", phone: "081-234-5678", emergencyPhone: "089-987-6543" },
  { name: "นางสาวศิริพร บุญรักษา", idCard: "3-3401-00245-11-2", birthday: "25/08/2535", gender: "หญิง", address: "45/2 หมู่ 4 ต.โนนผึ้ง อ.วารินชำราบ จ.อุบลราชธานี", phone: "089-456-7890", emergencyPhone: "081-123-4567" },
  { name: "นายวิเชียร สุขสมบูรณ์", idCard: "1-1004-99887-33-4", birthday: "05/11/2522", gender: "ชาย", address: "88 ถนนสถลมาร์ค ต.วารินชำราบ จ.อุบลราชธานี", phone: "086-778-9900", emergencyPhone: "084-556-6778" }
];
let sampleLayIndex = 0;

function setupLayWorkflow() {
  document.getElementById("btnSimulateLayScan").addEventListener("click", () => {
    const p = SAMPLE_LAYPEOPLE[sampleLayIndex % SAMPLE_LAYPEOPLE.length];
    sampleLayIndex++;

    document.getElementById("layName").value = p.name;
    document.getElementById("layIdCard").value = p.idCard;
    document.getElementById("layBirthday").value = p.birthday;
    document.getElementById("layGender").value = p.gender;
    document.getElementById("layAddress").value = p.address;
    document.getElementById("layPhone").value = p.phone;
    document.getElementById("layEmergencyPhone").value = p.emergencyPhone;

    showToast(`จำลองอ่านข้อมูลจากบัตรประชาชน: ${p.name}`, "success");
  });

  document.getElementById("btnConfirmLayRegistration").addEventListener("click", () => {
    confirmLayRegistration();
  });
}

function confirmLayRegistration() {
  const name = document.getElementById("layName").value.trim();
  const idCard = document.getElementById("layIdCard").value.trim();
  const birthday = document.getElementById("layBirthday").value.trim();
  const gender = document.getElementById("layGender").value;
  const address = document.getElementById("layAddress").value.trim();
  const phone = document.getElementById("layPhone").value.trim();
  const emergencyPhone = document.getElementById("layEmergencyPhone").value.trim();

  if (!name || !idCard) {
    showToast("กรุณากรอกชื่อและเลขบัตรประชาชนญาติโยม", "warning");
    return;
  }

  const now = new Date().toLocaleString("th-TH");
  const newLay = {
    id: "LP" + Date.now().toString().slice(-6),
    name: name,
    idCard: idCard,
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

  showToast(`บันทึกและลงทะเบียนญาติโยม: ${name} สำเร็จ`, "success");

  // Send to Google Sheets
  if (state.gasUrl) {
    callGasApi({
      action: "register_layperson",
      ...newLay
    }).then(res => {
      if (res && res.status === "success") {
        showToast("บันทึกข้อมูลญาติโยมลง Google Sheet สำเร็จ", "success");
      }
    });
  }
}

function resetLayWorkflow() {
  document.getElementById("layName").value = "";
  document.getElementById("layIdCard").value = "";
  document.getElementById("layBirthday").value = "";
  document.getElementById("layAddress").value = "";
  document.getElementById("layPhone").value = "";
  document.getElementById("layEmergencyPhone").value = "";
  document.getElementById("layIdCardManual").value = "";
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

  // Filter monks: prioritize registered or match search
  const filtered = state.monks.filter(m => {
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
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding: 1.5rem;">ไม่พบข้อมูลพระสงฆ์ตามเงื่อนไขการค้นหา</td></tr>`;
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
      <td>${m.vassa}</td>
      <td>${statusHtml}</td>
    `;

    tr.addEventListener("click", () => {
      selectMonkForSlip(m);
    });

    tbody.appendChild(tr);
  });
}

function selectMonkForSlip(monk) {
  state.currentSlipMonk = monk;
  renderSlipMonksTable();

  document.getElementById("slipRecTemple").value = monk.temple;
  document.getElementById("slipRecMonkName").value = monk.name;
  document.getElementById("slipRecAmount").value = monk.amount || 5000;
  
  // Pre-fill receiver with default or previous registered layperson name
  if (state.laypeople.length > 0 && !document.getElementById("slipRecReceiverName").value) {
    document.getElementById("slipRecReceiverName").value = state.laypeople[0].name;
    document.getElementById("slipRecReceiverPhone").value = state.laypeople[0].phone;
  } else if (!document.getElementById("slipRecReceiverName").value) {
    document.getElementById("slipRecReceiverName").value = "นายสมชาย ใจดี";
  }

  document.getElementById("slipSelectedBadge").textContent = monk.slipStatus === "รับแล้ว" ? "รับแล้ว (เบิกซ้ำได้)" : "พร้อมทำรายการรับ";
  document.getElementById("slipSelectedBadge").className = monk.slipStatus === "รับแล้ว" ? "status-badge registered" : "status-badge available";

  showToast(`เลือกพระเถระ: ${monk.name}`, "success");
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
    showToast("กรุณาเลือกพระเถระจากตาราง 3.2 ก่อน", "warning");
    return;
  }

  const receiverName = document.getElementById("slipRecReceiverName").value.trim();
  const receiverPhone = document.getElementById("slipRecReceiverPhone").value.trim();
  const amount = parseInt(document.getElementById("slipRecAmount").value) || 5000;

  if (!receiverName) {
    showToast("กรุณาระบุชื่อผู้มารับเงินแทน / ผู้รับมอบฉันทะ", "warning");
    return;
  }

  const now = new Date().toLocaleString("th-TH");
  const slipRecord = {
    txId: "TX" + Date.now().toString().slice(-6),
    monkId: state.currentSlipMonk.id,
    monkName: state.currentSlipMonk.name,
    temple: state.currentSlipMonk.temple,
    vassa: state.currentSlipMonk.vassa,
    amount: amount,
    receiverName: receiverName,
    receiverPhone: receiverPhone || "-",
    status: "รับแล้ว",
    receivedAt: now,
    photoUrl: state.receiverPhotoBase64 ? "มีรูปถ่ายผู้รับ (Base64/Drive)" : "assets/receiver_avatar.jpg"
  };

  // Update monk status
  state.currentSlipMonk.slipStatus = "รับแล้ว";
  state.currentSlipMonk.receivedBy = receiverName;
  saveLocal("TEMPLE_MONKS_DATA", state.monks);

  // Add to slips list
  state.slips.unshift(slipRecord);
  saveLocal("TEMPLE_SLIPS_DATA", state.slips);

  updateAllKpis();
  renderSlipMonksTable();
  renderReportTable();

  showToast(`ยืนยันการรับใบปวารณา จำนวน ${amount.toLocaleString()} บาท เรียบร้อย!`, "success");

  // Send to Google Sheets
  if (state.gasUrl) {
    callGasApi({
      action: "receive_slip",
      monkId: state.currentSlipMonk.id,
      monkName: state.currentSlipMonk.name,
      temple: state.currentSlipMonk.temple,
      vassa: state.currentSlipMonk.vassa,
      amount: amount,
      receiverName: receiverName,
      receiverPhone: receiverPhone,
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
  document.getElementById("slipRecAmount").value = "5000";
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
        <th>ที่พัก / โรงแรม</th>
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
        <th>จำนวนปัจจัย</th>
        <th>ผู้มารับเงิน</th>
        <th>เบอร์ติดต่อ</th>
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
        <td style="font-weight:700; color:#166534;">${(s.amount || 5000).toLocaleString()} บาท</td>
        <td>${s.receiverName}</td>
        <td>${s.receiverPhone}</td>
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
    csvContent += "รหัส,ชื่อ_ฉายา,วัด,สาขา,จังหวัด,พรรษา,ที่พัก_โรงแรม,สถานะ,เวลาลงทะเบียน\n";
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
    csvContent += "รหัสรายการ,ชื่อพระ,ชื่อวัด,จำนวนปัจจัย,ผู้มารับเงิน,เบอร์ติดต่อ,เวลาที่รับ\n";
    state.slips.forEach(s => {
      csvContent += `"${s.txId}","${s.monkName}","${s.temple}","${s.amount}","${s.receiverName}","${s.receiverPhone}","${s.receivedAt}"\n`;
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

/**
 * ดึงข้อมูลสดล่าสุดจาก Google Sheet ทั้ง 4 แผ่นงาน
 */
async function fetchLiveDataFromSheet() {
  if (!state.gasUrl) return;
  try {
    const testUrl = state.gasUrl.includes("?") ? `${state.gasUrl}&action=get_all_data` : `${state.gasUrl}?action=get_all_data`;
    const res = await fetch(testUrl, { method: "GET", mode: "cors" });
    const json = await res.json();
    if (json && json.status === "success") {
      if (json.monks && json.monks.length > 0) {
        state.monks = json.monks.map(m => ({
          id: m["รหัส"] || m.id,
          idCard: m["เลขบัตรประชาชน"] ? m["เลขบัตรประชาชน"].toString() : (m.idCard || ""),
          name: m["ชื่อ / ฉายา"] || m.name,
          branch: m["ลำดับสาขา"] || m.branch,
          temple: m["ชื่อวัด"] || m.temple,
          district: m["อำเภอ"] || m.district,
          province: m["จังหวัด"] || m.province,
          vassa: m["พรรษา"] || m.vassa || 0,
          phone: m["เบอร์โทรศัพท์"] || m.phone || "-",
          hotel: m["ที่พัก / โรงแรม"] || m.hotel || "",
          allowSlip: m["สิทธิ์รับใบปวารณา"] === "มีสิทธิ์" || m.allowSlip === true,
          amount: m["จำนวนปัจจัย"] || m.amount || 5000,
          status: m["สถานะลงทะเบียน"] || m.status || "ยังไม่ลงทะเบียน",
          slipStatus: m["สถานะรับใบปวารณา"] || m.slipStatus || "ยังไม่ได้รับ",
          registeredAt: m["เวลาที่ลงทะเบียน"] || m.registeredAt || ""
        }));
        saveLocal("TEMPLE_MONKS_DATA", state.monks);
        populateMonkQuickSelect();
      }

      if (json.walkinMonks && json.walkinMonks.length > 0) {
        state.walkinMonks = json.walkinMonks.map(w => ({
          id: w["รหัส"] || w.id,
          idCard: w["เลขบัตรประชาชน"] || w.idCard,
          name: w["ชื่อ / ฉายา"] || w.name,
          temple: w["ชื่อวัด"] || w.temple,
          vassa: w["พรรษา"] || w.vassa,
          province: w["จังหวัด"] || w.province,
          phone: w["เบอร์โทรศัพท์"] || w.phone,
          status: w["สถานะลงทะเบียน"] || "ลงทะเบียนแล้ว",
          registeredAt: w["เวลาที่ลงทะเบียน"] || w.registeredAt
        }));
        saveLocal("TEMPLE_WALKIN_DATA", state.walkinMonks);
      }

      if (json.laypeople && json.laypeople.length > 0) {
        state.laypeople = json.laypeople.map(l => ({
          id: l["รหัส"] || l.id,
          idCard: l["เลขบัตรประชาชน"] || l.idCard,
          name: l["ชื่อ - นามสกุล"] || l.name,
          birthday: l["วันเกิด"] || l.birthday,
          gender: l["เพศ"] || l.gender,
          address: l["ที่อยู่"] || l.address,
          phone: l["เบอร์โทรศัพท์"] || l.phone,
          emergencyPhone: l["เบอร์ติดต่อฉุกเฉิน"] || l.emergencyPhone,
          registeredAt: l["เวลาที่ลงทะเบียน"] || l.registeredAt
        }));
        saveLocal("TEMPLE_LAY_DATA", state.laypeople);
      }

      if (json.slips && json.slips.length > 0) {
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
    }
  } catch (err) {
    console.warn("Could not fetch live data from Google Sheet:", err);
  }
}

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
    // Use no-cors or standard POST
    const res = await fetch(state.gasUrl, {
      method: "POST",
      mode: "no-cors", // Allows posting without preflight rejection in Google Apps Script
      headers: { "Content-Type": "application/json" },
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
    await fetch(state.gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_import_monks",
        monks: state.monks
      })
    });

    showToast("ส่งคำสั่งสร้างแผ่นงานและนำเข้า 422 รายนามขึ้น Google Sheet สำเร็จ!", "success");
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการส่งข้อมูล: " + e.message, "error");
  }
}

function copyGasCodeToClipboard() {
  const scriptContent = `/**
 * ระบบลงทะเบียนเข้างานวัด - Google Apps Script Backend
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
