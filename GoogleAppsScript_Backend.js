/**
 * =========================================================================================
 * ระบบลงทะเบียนเข้างานวัด (Temple Event Registration System)
 * Google Apps Script Backend for Google Sheets
 * =========================================================================================
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheets สร้างเอกสารใหม่ (เช่น ตั้งชื่อว่า "ระบบลงทะเบียนงานวัดหนองป่าพง")
 * 2. ไปที่เมนู "ส่วนขยาย" (Extensions) > "Apps Script"
 * 3. ลบโค้ดเดิมทั้งหมดออก แล้ววางโค้ดทั้งหมดนี้ลงไป
 * 4. กดปุ่ม "บันทึก" (รูปแผ่นดิสก์)
 * 5. กดปุ่ม "ทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้ใหม่" (New deployment)
 *    - เลือกประเภท: "เว็บแอปพลิเคชัน" (Web app)
 *    - คำอธิบาย: "v1.0"
 *    - ปฏิบัติการในฐานะ: "ฉัน" (Me)
 *    - ใครมีสิทธิ์เข้าถึง: "ทุกคน" (Anyone) **สำคัญมาก ต้องเลือกทุกคนเพื่อให้เว็บแอปเชื่อมต่อได้**
 * 6. กด "ทำให้ใช้งานได้" (Deploy) แล้วคัดลอก "URL เว็บแอปพลิเคชัน" (ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec)
 * 7. นำ URL มาใส่ในหน้าตั้งค่าเว็บแอป เพื่อเชื่อมโยงข้อมูล
 * =========================================================================================
 */

// ชื่อแผ่นงาน (Sheets) ทั้ง 4 ส่วน
const SHEET_NAMES = {
  INVITED_MONKS: "พระสงฆ์ที่นิมนต์",
  WALKIN_MONKS: "ลงทะเบียนพระนอกรายชื่อ",
  LAYPEOPLE: "ลงทะเบียนญาติโยม",
  SLIPS: "รับใบปวารณา",
  SETTINGS: "ตั้งค่าระบบ"
};

/**
 * Handle GET Requests
 */
function doGet(e) {
  const params = e ? e.parameter : {};
  const action = params.action || "ping";
  const callback = params.callback; // For JSONP support if needed

  let result = {};

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "ping") {
      result = { status: "success", message: "Google Sheet Backend is Online", sheetName: ss.getName() };
    } else if (action === "get_all_data") {
      result = {
        status: "success",
        monks: getSheetDataAsJson(ss, SHEET_NAMES.INVITED_MONKS),
        walkinMonks: getSheetDataAsJson(ss, SHEET_NAMES.WALKIN_MONKS),
        laypeople: getSheetDataAsJson(ss, SHEET_NAMES.LAYPEOPLE),
        slips: getSheetDataAsJson(ss, SHEET_NAMES.SLIPS)
      };
    } else if (action === "get_monks") {
      result = { status: "success", data: getSheetDataAsJson(ss, SHEET_NAMES.INVITED_MONKS) };
    } else if (action === "get_laypeople") {
      result = { status: "success", data: getSheetDataAsJson(ss, SHEET_NAMES.LAYPEOPLE) };
    } else if (action === "get_slips") {
      result = { status: "success", data: getSheetDataAsJson(ss, SHEET_NAMES.SLIPS) };
    } else if (action === "check_id_card") {
      const idCard = (e.parameter.idCard || "").toString().replace(/[-\s]/g, "");
      result = checkIdAcrossAllSheets(ss, idCard);
    } else if (action === "setup") {
      setupSheets(ss);
      result = { status: "success", message: "Setup sheets successfully" };
    } else {
      result = { status: "error", message: "Unknown action: " + action };
    }
  } catch (error) {
    result = { status: "error", message: error.toString() };
  }

  const jsonOutput = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + jsonOutput + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(jsonOutput)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle POST Requests
 */
function doPost(e) {
  let result = {};
  const lock = LockService.getScriptLock();

  // ล็อคคิวเพื่อรองรับการใช้งานพร้อมกันหลายจุด (Multi-user concurrency) รอคิวได้สูงสุด 30 วินาที
  const hasLock = lock.tryLock(30000);
  if (!hasLock) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "ระบบกำลังบันทึกข้อมูลจากเครื่องอื่นอยู่ กรุณากดบันทึกอีกครั้ง"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let data = {};

    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter || {};
      }
    } else {
      data = e.parameter || {};
    }

    const action = data.action;

    if (action === "setup_sheets") {
      setupSheets(ss);
      result = { status: "success", message: "สร้างแผ่นงานเริ่มต้นเรียบร้อยแล้ว" };
    } 
    else if (action === "batch_import_monks") {
      // นำเข้าข้อมูลพระนิมนต์เริ่มต้นชุดใหญ่
      const monks = data.monks || [];
      const count = importMonksBatch(ss, monks);
      result = { status: "success", count: count, message: "นำเข้ารายชื่อพระนิมนต์สำเร็จ " + count + " รูป" };
    }
    else if (action === "register_monk" || action === "update_monk") {
      // ลงทะเบียนหรืออัปเดตข้อมูลพระที่ได้รับนิมนต์ (เลขบัตร / ที่พัก / เบอร์โทร / สิทธิ์ปวารณา)
      result = registerMonk(ss, data);
    }
    else if (action === "register_walkin_monk") {
      // ลงทะเบียนพระนอกรายชื่อ
      result = registerWalkinMonk(ss, data);
    }
    else if (action === "register_layperson") {
      // ลงทะเบียนญาติโยม
      result = registerLayperson(ss, data);
    }
    else if (action === "receive_slip") {
      // บันทึกการรับใบปวารณา / ปัจจัย พร้อมรูปถ่าย
      result = receiveSlip(ss, data);
    }
    else {
      result = { status: "error", message: "Unknown POST action: " + action };
    }

  } catch (error) {
    result = { status: "error", message: error.toString() };
  } finally {
    lock.releaseLock();
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ตั้งค่าแผ่นงานและหัวตารางทั้ง 4 แผ่นงาน
 */
function setupSheets(ss) {
  // 1. พระสงฆ์ที่นิมนต์ (คอลัมน์ A ถึง R ตาม Excel + คอลัมน์ระบบ)
  let sheet1 = ss.getSheetByName(SHEET_NAMES.INVITED_MONKS);
  if (!sheet1) sheet1 = ss.insertSheet(SHEET_NAMES.INVITED_MONKS);
  const h1 = [
    [
      "ลำดับที่",             // A
      "ภาพ",                 // B
      "ชื่อลำดับสาขา",       // C
      "ที่อยู่ (แบบรวมชื่อ)",  // D
      "ชื่อลำดับสาขา (ย่อ)",  // E
      "ลำดับสาขา",           // F
      "ชื่อวัด",              // G
      "ชื่อพระ / ฉายา",      // H
      "อายุอุปสมบท",         // I
      "วันที่",              // J
      "เดือน",               // K
      "พ.ศ.",               // L
      "โทรศัพท์",            // M
      "ที่อยู่",              // N
      "พรรษาปัจจุบัน",        // O
      "การนิมนต์",           // P
      "อำเภอ",               // Q
      "จังหวัด",             // R
      "เลขบัตรประชาชน",      // S
      "ที่พัก / โรงแรม",      // T
      "สถานะลงทะเบียน",       // U
      "เวลาที่ลงทะเบียน",     // V
      "สถานะรับใบปวารณา"     // W
    ]
  ];
  sheet1.getRange(1, 1, 1, h1[0].length).setValues(h1)
    .setFontWeight("bold")
    .setBackground("#fef3c7")
    .setFontColor("#92400e");
  sheet1.setFrozenRows(1);

  // 2. ลงทะเบียนพระนอกรายชื่อ
  let sheet2 = ss.getSheetByName(SHEET_NAMES.WALKIN_MONKS);
  if (!sheet2) sheet2 = ss.insertSheet(SHEET_NAMES.WALKIN_MONKS);
  const h2 = [
    ["ลำดับที่", "รหัส", "เลขบัตรประชาชน", "ชื่อ / ฉายา", "ชื่อวัด", "พรรษา", "จังหวัด", "เบอร์โทรศัพท์", "สถานะลงทะเบียน", "เวลาที่ลงทะเบียน"]
  ];
  sheet2.getRange(1, 1, 1, h2[0].length).setValues(h2)
    .setFontWeight("bold")
    .setBackground("#fed7aa")
    .setFontColor("#9a3412");
  sheet2.setFrozenRows(1);

  // 3. ลงทะเบียนญาติโยม
  let sheet3 = ss.getSheetByName(SHEET_NAMES.LAYPEOPLE);
  if (!sheet3) sheet3 = ss.insertSheet(SHEET_NAMES.LAYPEOPLE);
  const h3 = [
    ["ลำดับที่", "รหัส", "เลขบัตรประชาชน", "ชื่อ - นามสกุล", "วันเกิด", "เพศ", "ที่อยู่", "เบอร์โทรศัพท์", "เบอร์ติดต่อฉุกเฉิน", "เวลาที่ลงทะเบียน"]
  ];
  sheet3.getRange(1, 1, 1, h3[0].length).setValues(h3)
    .setFontWeight("bold")
    .setBackground("#dbeafe")
    .setFontColor("#1e40af");
  sheet3.setFrozenRows(1);

  // 4. รับใบปวารณา
  let sheet4 = ss.getSheetByName(SHEET_NAMES.SLIPS);
  if (!sheet4) sheet4 = ss.insertSheet(SHEET_NAMES.SLIPS);
  const h4 = [
    ["รหัสบันทึก", "รหัสพระ", "ชื่อวัด", "ชื่อพระ / ฉายา", "พรรษา", "จำนวนปัจจัย (บาท)", "ชื่อผู้มารับเงิน", "เบอร์ติดต่อผู้รับ", "สถานะการรับ", "วันเวลาที่รับ", "ลิงก์รูปถ่ายผู้รับ"]
  ];
  sheet4.getRange(1, 1, 1, h4[0].length).setValues(h4)
    .setFontWeight("bold")
    .setBackground("#dcfce7")
    .setFontColor("#166534");
  sheet4.setFrozenRows(1);
}

/**
 * นำเข้ารายชื่อพระนิมนต์
 */
function importMonksBatch(ss, monks) {
  let sheet = ss.getSheetByName(SHEET_NAMES.INVITED_MONKS);
  if (!sheet) {
    setupSheets(ss);
    sheet = ss.getSheetByName(SHEET_NAMES.INVITED_MONKS);
  }

  // Clear existing data rows except header safely
  const maxRows = sheet.getMaxRows();
  const maxCols = sheet.getMaxColumns();
  if (maxRows > 1) {
    sheet.getRange(2, 1, maxRows - 1, maxCols).clearContent();
  }

  if (!monks || monks.length === 0) return 0;

  const rows = monks.map((m, idx) => [
    idx + 1,                                            // A: ลำดับที่
    m.photoUrl ? '=IMAGE("' + m.photoUrl + '")' : "",   // B: ภาพ (สูตร =IMAGE() หรือ URL)
    m.branchName1 || m.branch || "",                    // C: ชื่อลำดับสาขา
    m.fullAddressWithName || "",                        // D: ที่อยู่ (แบบรวมชื่อ)
    m.branchName2 || "",                                // E: ชื่อลำดับสาขา (ย่อ)
    m.branchNo || "",                                   // F: ลำดับสาขา
    m.temple || "",                                     // G: ชื่อวัด
    m.name || "",                                       // H: ชื่อพระ
    m.ordainAge || "",                                  // I: อายุอุปสมบท
    m.ordainDay || "",                                  // J: วันที่
    m.ordainMonth || "",                                // K: เดือน
    m.ordainYear || "",                                 // L: พ.ศ.
    m.phone || "",                                      // M: โทรศัพท์
    m.address || "",                                    // N: ที่อยู่
    m.vassa || 0,                                       // O: พรรษาปัจจุบัน
    m.invited || "Y",                                   // P: การนิมนต์ (Y หรือ N/A)
    m.district || "",                                   // Q: อำเภอ
    m.province || "",                                   // R: จังหวัด
    m.idCard || "",                                     // S: เลขบัตรประชาชน
    m.hotel || "",                                      // T: ที่พัก / โรงแรม
    m.status || "ยังไม่ลงทะเบียน",                      // U: สถานะลงทะเบียน
    m.registeredAt || "",                               // V: เวลาที่ลงทะเบียน
    m.slipStatus || "ยังไม่ได้รับ"                       // W: สถานะรับใบปวารณา
  ]);

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  return rows.length;
}

/**
 * ยืนยันการลงทะเบียนพระสงฆ์ที่นิมนต์ (อัปเดตเฉพาะแถวเดิม ห้ามสร้างแถวใหม่)
 */
function registerMonk(ss, data) {
  const sheet = ss.getSheetByName(SHEET_NAMES.INVITED_MONKS);
  if (!sheet) throw new Error("ไม่พบแผ่นงาน " + SHEET_NAMES.INVITED_MONKS);

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) throw new Error("ไม่มีข้อมูลพระสงฆ์ในแผ่นงาน " + SHEET_NAMES.INVITED_MONKS);

  // ค้นหาตำแหน่งคอลัมน์จากแถวหัวตาราง (Row 1) แบบ Dynamic
  const headers = values[0].map(h => String(h || "").trim());

  function findCol1Based(patterns, defaultCol) {
    for (let p = 0; p < patterns.length; p++) {
      const pat = patterns[p].toLowerCase();
      for (let j = 0; j < headers.length; j++) {
        if (headers[j].toLowerCase().includes(pat)) {
          return j + 1; // 1-based index สำหรับ sheet.getRange
        }
      }
    }
    return defaultCol;
  }

  // กำหนดตำแหน่งคอลัมน์: คอลัมน์ B (2) คือ เลขบัตรประชาชน
  const colCard = findCol1Based(["เลขบัตรประชาชน", "เลขบัตร", "บัตรประชาชน", "idcard", "citizen"], 2);
  const colStatus = findCol1Based(["สถานะลงทะเบียน", "สถานะการลงทะเบียน", "สถานะ"], 13);
  const colTime = findCol1Based(["เวลาที่ลงทะเบียน", "เวลาลงทะเบียน", "วันเวลา"], 14);
  const colId = findCol1Based(["รหัส", "ลำดับที่", "ลำดับ", "id"], 1);
  const colName = findCol1Based(["ชื่อ / ฉายา", "ชื่อพระ / ฉายา", "ชื่อพระ", "ชื่อ", "ฉายา"], 3);

  const colPhone = findCol1Based(["เบอร์โทรศัพท์", "เบอร์โทร", "โทรศัพท์", "phone", "tel"], 9);
  const colHotel = findCol1Based(["ที่พัก / โรงแรม", "ที่พัก/โรงแรม", "ที่พัก", "โรงแรม", "hotel", "room"], 10);
  const colSlip = findCol1Based(["สิทธิ์รับใบปวารณา", "สิทธิ์ใบปวารณา", "สิทธิ์", "slip"], 11);

  const searchName = (data.name || "").toString().trim().toLowerCase();
  const searchCard = (data.idCard || "").toString().replace(/[-\s]/g, "").trim();
  const searchIdStr = (data.id || "").toString().trim();
  const searchIdNum = parseInt(searchIdStr.replace(/\D/g, ""));

  let foundRow = -1;
  for (let i = 1; i < values.length; i++) {
    const rowIdRaw = String(values[i][colId - 1] || "").trim();
    const rowIdNum = parseInt(rowIdRaw.replace(/\D/g, ""));
    const rowName = String(values[i][colName - 1] || "").trim().toLowerCase();
    const rowCard = String(values[i][colCard - 1] || "").replace(/[-\s]/g, "").trim();

    // 1. ตรวจสอบรหัสพระ (เช่น MK0001, MK1 หรือตัวเลขลำดับ)
    if (searchIdStr && (rowIdRaw.toLowerCase() === searchIdStr.toLowerCase() || (searchIdNum && rowIdNum === searchIdNum))) {
      foundRow = i + 1;
      break;
    }
    // 2. ตรวจสอบเลขบัตรประชาชน
    if (searchCard && rowCard && rowCard === searchCard) {
      foundRow = i + 1;
      break;
    }
    // 3. ตรวจสอบชื่อพระ
    if (searchName && rowName && (rowName === searchName || rowName.indexOf(searchName) !== -1 || searchName.indexOf(rowName) !== -1)) {
      foundRow = i + 1;
      break;
    }
  }

  const now = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");

  if (foundRow > 0) {
    // ตรวจสอบว่ามีพระรูปอื่นในรายชื่อนิมนต์ผูกกับเลขบัตรประชาชนนี้อยู่แล้วหรือไม่
    if (searchCard && searchCard.length >= 10 && !searchCard.includes("x")) {
      for (let i = 1; i < values.length; i++) {
        if (i + 1 !== foundRow) {
          const otherCard = String(values[i][colCard - 1] || "").replace(/[-\s]/g, "").trim();
          if (otherCard === searchCard) {
            const otherName = values[i][colName - 1] || ("แถวที่ " + (i + 1));
            return {
              status: "error",
              message: "เลขบัตรประชาชนนี้ถูกบันทึกให้พระรูปอื่นแล้ว: " + otherName
            };
          }
        }
      }
    }

    // อัปเดตข้อมูลในแถวเดิมเท่านั้น (ไม่เพิ่มแถวใหม่เด็ดขาด)
    // 1. บันทึกเลขบัตรประชาชนลงในคอลัมน์ B (หรือคอลัมน์เลขบัตรประชาชนที่ตรวจพบ)
    const cardToSave = String(data.idCard || "").trim();
    if (cardToSave) {
      sheet.getRange(foundRow, colCard).setNumberFormat("@").setValue(cardToSave);
    }

    // 2. บันทึกเบอร์โทรศัพท์ลงในคอลัมน์ I
    if (data.phone !== undefined && colPhone > 0) {
      const phoneToSave = String(data.phone || "").trim();
      sheet.getRange(foundRow, colPhone).setNumberFormat("@").setValue(phoneToSave);
    }

    // 3. บันทึกข้อมูลที่พัก / โรงแรม ลงในคอลัมน์ J
    if (data.hotel !== undefined && colHotel > 0) {
      sheet.getRange(foundRow, colHotel).setValue(String(data.hotel || "").trim());
    }

    // 4. บันทึกสิทธิ์รับใบปวารณา ลงในคอลัมน์ K
    if (data.slipRight !== undefined && colSlip > 0) {
      sheet.getRange(foundRow, colSlip).setValue(String(data.slipRight || "").trim());
    }

    // 5. บันทึกสถานะและเวลา
    if (colStatus > 0) {
      sheet.getRange(foundRow, colStatus).setValue("ลงทะเบียนแล้ว");
    }
    if (colTime > 0) {
      sheet.getRange(foundRow, colTime).setValue(now);
    }

    return {
      status: "success",
      isUpdate: true,
      message: "ลงทะเบียนและบันทึกข้อมูลพระสำเร็จ (บันทึกเลขบัตร, ที่พัก, เบอร์โทรในแถวเดิม)",
      registeredAt: now,
      row: foundRow,
      idCard: cardToSave,
      hotel: data.hotel,
      phone: data.phone,
      slipRight: data.slipRight
    };
  } else {
    return {
      status: "error",
      message: "ไม่พบข้อมูลพระสงฆ์ในรายชื่อนิมนต์ ไม่สามารถลงทะเบียนได้"
    };
  }
}

/**
 * ลงทะเบียนพระนอกรายชื่อ (กำหนดให้เลขบัตรประชาชนเป็น Primary Key ห้ามซ้ำ)
 */
function registerWalkinMonk(ss, data) {
  let sheet = ss.getSheetByName(SHEET_NAMES.WALKIN_MONKS);
  if (!sheet) {
    setupSheets(ss);
    sheet = ss.getSheetByName(SHEET_NAMES.WALKIN_MONKS);
  }

  const now = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
  const newId = "WK" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd-HHmmss");

  const cleanId = String(data.idCard || "").replace(/[-\s]/g, "").trim();
  const searchName = String(data.name || "").trim().toLowerCase();
  const searchTemple = String(data.temple || "").trim().toLowerCase();

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const matchingRowIndices = [];

  // ตรวจสอบเลขบัตรประชาชนในคอลัมน์ B (Index 1) และรหัสในคอลัมน์ A (Index 0)
  for (let i = 1; i < values.length; i++) {
    const rowId = String(values[i][0] || "").trim();
    const rowCard = String(values[i][1] || "").replace(/[-\s]/g, "").trim();
    const rowName = String(values[i][2] || "").trim().toLowerCase();
    const rowTemple = String(values[i][3] || "").trim().toLowerCase();

    // 1. ตรงตามเลขบัตรประชาชน 13 หลัก (Primary Key)
    if (cleanId && cleanId.length >= 10 && !cleanId.includes("x") && rowCard === cleanId) {
      matchingRowIndices.push(i + 1); // 1-indexed row number
    }
    // 2. หรือตรงตามรหัส WK ที่ระบุมา
    else if (data.id && rowId && rowId === String(data.id).trim()) {
      matchingRowIndices.push(i + 1);
    }
    // 3. หรือกรณีชื่อและวัดตรงกันแต่แถวเดิมเคยบันทึกเป็น placeholder จำลอง
    else if (searchName && searchTemple && rowName === searchName && rowTemple === searchTemple && (rowCard.includes("x") || !rowCard)) {
      matchingRowIndices.push(i + 1);
    }
  }

  if (matchingRowIndices.length > 0) {
    // พบข้อมูลเดิม -> ทำการ UPDATE แถวแรกที่พบ
    const primaryRowIndex = matchingRowIndices[0];
    const existingId = values[primaryRowIndex - 1][0] || data.id || newId;

    const updatedRow = [
      existingId,
      data.idCard || cleanId,
      data.name || "",
      data.temple || "",
      data.vassa || 0,
      data.province || "",
      data.phone || "",
      "ลงทะเบียนแล้ว",
      now
    ];

    sheet.getRange(primaryRowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

    // หากมีแถวซ้ำซ้อนเดิมที่เคยบันทึกไว้เกิน 1 แถว ให้ลบแถวซ้ำออก (ลบจากล่างขึ้นบน)
    if (matchingRowIndices.length > 1) {
      for (let d = matchingRowIndices.length - 1; d >= 1; d--) {
        try {
          sheet.deleteRow(matchingRowIndices[d]);
        } catch (delErr) {
          console.warn("Error deleting duplicate row:", delErr);
        }
      }
    }

    return {
      status: "success",
      isUpdate: true,
      id: existingId,
      message: "อัปเดตข้อมูลพระนอกรายชื่อสำเร็จ (เลขบัตรประชาชนมีในระบบแล้ว)",
      registeredAt: now
    };
  }

  // ไม่พบข้อมูลเดิม -> เพิ่มแถวใหม่ (INSERT)
  const newRow = [
    data.id || newId,
    data.idCard || cleanId,
    data.name || "",
    data.temple || "",
    data.vassa || 0,
    data.province || "",
    data.phone || "",
    "ลงทะเบียนแล้ว",
    now
  ];

  sheet.appendRow(newRow);
  return {
    status: "success",
    isUpdate: false,
    id: data.id || newId,
    message: "บันทึกพระนอกรายชื่อสำเร็จ",
    registeredAt: now
  };
}

/**
 * ฟังก์ชันสำหรับกด Run ใน Google Apps Script เพื่อลบแถวที่ซ้ำซ้อนในชีต 'ลงทะเบียนพระนอกรายชื่อ' ทันที
 * โดยจะคงแถวแรกไว้ และลบแถวที่เลขบัตรหรือชื่อซ้ำด้านล่างออกทั้งหมด
 */
function cleanDuplicateWalkinMonks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.WALKIN_MONKS);
  if (!sheet) return;

  const values = sheet.getDataRange().getValues();
  if (values.length <= 2) return;

  const seenKeys = {};
  const rowsToDelete = [];

  for (let i = 1; i < values.length; i++) {
    const rowNum = i + 1;
    const card = String(values[i][1] || "").replace(/[-\s]/g, "").trim();
    const name = String(values[i][2] || "").trim();

    const key = (card && card.length >= 10 && !card.includes("x")) ? ("CARD:" + card) : ("NAME:" + name);

    if (key && key !== "NAME:") {
      if (seenKeys[key]) {
        rowsToDelete.push(rowNum);
      } else {
        seenKeys[key] = rowNum;
      }
    }
  }

  // ลบแถวซ้ำจากล่างขึ้นบน
  for (let d = rowsToDelete.length - 1; d >= 0; d--) {
    sheet.deleteRow(rowsToDelete[d]);
  }

  Logger.log("ลบแถวที่ซ้ำซ้อนเรียบร้อยแล้ว: " + rowsToDelete.length + " แถว");
}

/**
 * ลงทะเบียนญาติโยม (กำหนดให้ "รหัสญาติโยม" เป็น Primary Key แทน และไม่บังคับใส่เลขบัตรประชาชน)
 */
function registerLayperson(ss, data) {
  let sheet = ss.getSheetByName(SHEET_NAMES.LAYPEOPLE);
  if (!sheet) {
    setupSheets(ss);
    sheet = ss.getSheetByName(SHEET_NAMES.LAYPEOPLE);
  }

  const now = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
  const targetId = String(data.id || "").trim();
  const cleanId = String(data.idCard || "").replace(/[-\s]/g, "").trim();

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  let foundRowIndex = -1;

  // 1. ตรวจสอบจาก "รหัสญาติโยม" ในคอลัมน์ A (Index 0) เป็น Primary Key หลัก
  if (targetId) {
    for (let i = 1; i < values.length; i++) {
      const rowId = String(values[i][0] || "").trim();
      if (rowId.toLowerCase() === targetId.toLowerCase()) {
        foundRowIndex = i + 1;
        break;
      }
    }
  }

  // 2. หากยังไม่พบรหัส แต่มีการระบุเลขบัตรประชาชนมา ให้ตรวจคอลัมน์ B เผื่อกรณีดึงข้อมูลเดิม
  if (foundRowIndex === -1 && cleanId && cleanId.length >= 10 && !cleanId.includes("x")) {
    for (let i = 1; i < values.length; i++) {
      const rowCard = String(values[i][1] || "").replace(/[-\s]/g, "").trim();
      if (rowCard === cleanId) {
        foundRowIndex = i + 1;
        break;
      }
    }
  }

  if (foundRowIndex > 0) {
    // พบข้อมูลเดิม -> ทำการ UPDATE แถวเดิม
    const existingId = values[foundRowIndex - 1][0] || targetId;

    const updatedRow = [
      existingId,
      data.idCard || "", // เลขบัตรประชาชน (เว้นว่างได้)
      data.name || "",
      data.birthday || "",
      data.gender || "",
      data.address || "",
      data.phone || "",
      data.emergencyPhone || "",
      now
    ];

    sheet.getRange(foundRowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

    return {
      status: "success",
      isUpdate: true,
      id: existingId,
      message: "อัปเดตข้อมูลญาติโยมสำเร็จ (รหัสเดิม: " + existingId + ")",
      registeredAt: now
    };
  }

  // ไม่พบข้อมูลเดิม -> เพิ่มแถวใหม่ (INSERT)
  // หากไม่มีรหัสส่งมา ให้คำนวณรหัสถัดไป เช่น LP0001, LP0002...
  let finalId = targetId;
  if (!finalId) {
    let maxNum = 0;
    for (let i = 1; i < values.length; i++) {
      const match = String(values[i][0] || "").match(/LP(\d+)/i);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
    finalId = "LP" + String(maxNum + 1).padStart(4, "0");
  }

  const newRow = [
    finalId,
    data.idCard || "", // เลขบัตรประชาชน (เว้นว่างได้)
    data.name || "",
    data.birthday || "",
    data.gender || "",
    data.address || "",
    data.phone || "",
    data.emergencyPhone || "",
    now
  ];

  sheet.appendRow(newRow);
  return {
    status: "success",
    isUpdate: false,
    id: finalId,
    message: "บันทึกข้อมูลญาติโยมสำเร็จ (รหัส: " + finalId + ")",
    registeredAt: now
  };
}

/**
 * ฟังก์ชันสำหรับกด Run ใน Google Apps Script เพื่อลบแถวที่ซ้ำซ้อนในชีต 'ลงทะเบียนญาติโยม' ทันที
 * โดยจะคงแถวแรกไว้ และลบแถวที่เลขบัตรหรือชื่อซ้ำด้านล่างออกทั้งหมด
 */
function cleanDuplicateLaypeople() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LAYPEOPLE);
  if (!sheet) return;

  const values = sheet.getDataRange().getValues();
  if (values.length <= 2) return;

  const seenKeys = {};
  const rowsToDelete = [];

  for (let i = 1; i < values.length; i++) {
    const rowNum = i + 1;
    const rowId = String(values[i][0] || "").trim().toLowerCase();
    const card = String(values[i][1] || "").replace(/[-\s]/g, "").trim();

    const key = rowId ? ("ID:" + rowId) : ((card && card.length >= 10 && !card.includes("x")) ? ("CARD:" + card) : "");

    if (key) {
      if (seenKeys[key]) {
        rowsToDelete.push(rowNum);
      } else {
        seenKeys[key] = rowNum;
      }
    }
  }

  // ลบแถวซ้ำจากล่างขึ้นบน
  for (let d = rowsToDelete.length - 1; d >= 0; d--) {
    sheet.deleteRow(rowsToDelete[d]);
  }

  Logger.log("ลบแถวญาติโยมที่ซ้ำซ้อนเรียบร้อยแล้ว: " + rowsToDelete.length + " แถว");
}

/**
 * บันทึกการรับใบปวารณา
 */
function receiveSlip(ss, data) {
  let sheet = ss.getSheetByName(SHEET_NAMES.SLIPS);
  if (!sheet) {
    setupSheets(ss);
    sheet = ss.getSheetByName(SHEET_NAMES.SLIPS);
  }

  const now = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
  const txId = "TX" + Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd-HHmmss");

  // จัดการรูปถ่าย (ถ้าส่ง Base64 มาจะบันทึกลงโฟลเดอร์ Google Drive)
  let photoUrl = "";
  if (data.photoBase64 && data.photoBase64.indexOf("data:image") !== -1) {
    try {
      photoUrl = savePhotoToDrive(data.photoBase64, txId + "_" + (data.receiverName || "receiver"));
    } catch (e) {
      photoUrl = "Error saving photo: " + e.toString();
    }
  } else if (data.photoUrl) {
    photoUrl = data.photoUrl;
  }

  // ตรวจสอบว่าพระสงฆ์มีสิทธิ์รับใบปวารณาตามคอลัมน์ K หรือไม่
  const monkSheet = ss.getSheetByName(SHEET_NAMES.INVITED_MONKS);
  if (monkSheet && data.monkId) {
    const values = monkSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).toLowerCase() === String(data.monkId).toLowerCase()) {
        const colKVal = String(values[i][10] || "").trim();
        if (!colKVal.includes("มีสิทธิ์")) {
          return {
            status: "error",
            message: "พระสงฆ์รูปนี้ไม่มีสิทธิ์รับใบปวารณาตามคอลัมน์ K (เฉพาะผู้แทนของพระผู้มีสิทธิ์เท่านั้น)"
          };
        }
        break;
      }
    }
  }

  const row = [
    txId,
    data.monkId || "",
    data.temple || "",
    data.monkName || "",
    data.vassa || 0,
    data.amount || 0,
    data.receiverName || "",
    data.receiverPhone || "",
    "รับแล้ว",
    now,
    photoUrl
  ];

  sheet.appendRow(row);

  // อัปเดตสถานะใน sheet พระสงฆ์ที่นิมนต์ให้เป็น "รับแล้ว" ด้วย
  const monkSheet = ss.getSheetByName(SHEET_NAMES.INVITED_MONKS);
  if (monkSheet && data.monkId) {
    const values = monkSheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] == data.monkId) {
        // สามารถเพิ่มคอลัมน์สถานะรับใบปวารณาได้
        break;
      }
    }
  }

  return { status: "success", txId: txId, message: "บันทึกการรับใบปวารณาสำเร็จ", photoUrl: photoUrl, receivedAt: now };
}

/**
 * บันทึกรูปถ่ายลง Google Drive
 */
function savePhotoToDrive(base64Data, filename) {
  const folderName = "รูปถ่ายผู้รับใบปวารณา_งานวัด";
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
  }

  const contentType = base64Data.substring(5, base64Data.indexOf(";"));
  const bytes = Utilities.base64Decode(base64Data.substr(base64Data.indexOf("base64,") + 7));
  const blob = Utilities.newBlob(bytes, contentType, filename + ".jpg");
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/**
 * Helper แปลง Sheet เป็น Array of Objects
 */
function getSheetDataAsJson(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const list = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    // สำหรับชีตพระสงฆ์ที่นิมนต์: ดึงคอลัมน์ J (ที่พัก/โรงแรม) และคอลัมน์ K (สิทธิ์รับใบปวารณา) ให้แม่นยำ 100%
    if (sheetName === SHEET_NAMES.INVITED_MONKS) {
      obj["_colJ"] = (row[9] !== undefined && row[9] !== null) ? String(row[9]).trim() : "";
      obj["_colK"] = (row[10] !== undefined && row[10] !== null) ? String(row[10]).trim() : "";
    }
    list.push(obj);
  }
  return list;
}

/**
 * ตรวจสอบเลขประจำตัวประชาชนในทุกคอลัมน์ของทุกแผ่นงานใน Google Sheets
 */
function checkIdAcrossAllSheets(ss, idCard) {
  if (!idCard) return { status: "not_found", message: "ไม่ระบุเลขบัตร" };
  const cleanId = idCard.toString().replace(/[-\s]/g, "");
  const sheets = ss.getSheets();
  const matches = [];

  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s];
    const sheetName = sheet.getName();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) continue;

    const headers = data[0];

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      for (let c = 0; c < row.length; c++) {
        const cellVal = (row[c] || "").toString().replace(/[-\s]/g, "");
        if (cellVal && cellVal === cleanId) {
          const rowObj = {};
          for (let h = 0; h < headers.length; h++) {
            rowObj[headers[h]] = row[h];
          }
          matches.push({
            sheetName: sheetName,
            rowIndex: r + 1,
            matchedColumn: headers[c] || ("คอลัมน์ที่ " + (c + 1)),
            data: rowObj
          });
          break; // ตรวจแถวถัดไป
        }
      }
    }
  }

  if (matches.length > 0) {
    return {
      status: "found",
      cleanId: cleanId,
      matches: matches,
      primaryMatch: matches[0]
    };
  } else {
    return {
      status: "not_found",
      cleanId: cleanId,
      message: "ไม่พบเลขบัตรนี้ในทุกคอลัมน์ของทุกชีต"
    };
  }
}
