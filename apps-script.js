/**
 * LendTrack Pro — Google Apps Script Backend
 * ============================================
 * Spreadsheet: https://docs.google.com/spreadsheets/d/1fLPsWOZnR9hZKehCFgzSqXsNDEP-ku6GQ2Fivxbhu7c/edit
 *
 * SETUP INSTRUCTIONS
 * ------------------
 * 1. Open the Google Sheet link above.
 * 2. Click  Extensions > Apps Script.
 * 3. Delete all existing code and paste this entire file.
 * 4. Click  Save  (Ctrl+S). Name the project "LendTrack Pro".
 * 5. Click  Deploy > New Deployment.
 *      Type:             Web app
 *      Execute as:       Me
 *      Who has access:   Anyone
 * 6. Click Deploy → Authorize when prompted (allow all permissions).
 * 7. Copy the Web App URL (looks like https://script.google.com/macros/s/AKfyc…/exec).
 * 8. Open index.html in your browser.
 * 9. Paste that URL into the "Apps Script URL" box in the sidebar → click Connect.
 *
 * COLUMN MAP (Sheet: LendTrack)
 * A  ID            B  Sender Name    C  Principal
 * D  Interest Rate E  Interest Amt   F  From Date
 * G  To Date       H  Days           I  Total Amount   J  Status
 */

// ── Configuration ─────────────────────────────────────────────
const SPREADSHEET_ID = '1fLPsWOZnR9hZKehCFgzSqXsNDEP-ku6GQ2Fivxbhu7c';
const SHEET_NAME     = 'LendTrack';

// Column indices (0-based)
const COL = {
  ID: 0, SENDER: 1, PRINCIPAL: 2, RATE: 3, INTEREST: 4,
  FROM: 5, TO: 6, DAYS: 7, TOTAL: 8, STATUS: 9,
  RATE_TYPE: 10, RATE_MONTHLY: 11, RATE_DAILY: 12,
  IS_APP_MONEY: 13, APP_INTEREST: 14
};
const TOTAL_COLS = 15;

// ── Sheet helper ──────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = [
      'ID', 'Sender Name', 'Principal (₹)', 'Interest Rate (%)',
      'Interest Amount (₹)', 'From Date', 'To Date',
      'Days', 'Total Amount (₹)', 'Status',
      'Rate Type', 'Monthly Rate (%)', 'Daily Rate (%)',
      'Is App Money', 'App Interest (₹)'
    ];
    sheet.appendRow(headers);

    // Style header row
    const hdrRange = sheet.getRange(1, 1, 1, TOTAL_COLS);
    hdrRange.setFontWeight('bold')
            .setBackground('#2563eb')
            .setFontColor('#ffffff')
            .setHorizontalAlignment('center');

    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);  // ID
    sheet.setColumnWidth(2, 180);  // Name
    sheet.setColumnWidth(3, 130);  // Principal
    sheet.setColumnWidth(4, 130);  // Rate
    sheet.setColumnWidth(5, 150);  // Interest
    sheet.setColumnWidth(6, 110);  // From
    sheet.setColumnWidth(7, 110);  // To
    sheet.setColumnWidth(8,  70);  // Days
    sheet.setColumnWidth(9, 150);  // Total
    sheet.setColumnWidth(10, 90);  // Status
    sheet.setColumnWidth(11, 100); // Rate Type
    sheet.setColumnWidth(12, 120); // Monthly Rate
    sheet.setColumnWidth(13, 110); // Daily Rate
    sheet.setColumnWidth(14, 110); // Is App Money
    sheet.setColumnWidth(15, 120); // App Interest
  }

  return sheet;
}

// ── doGet ─────────────────────────────────────────────────────
// Handles ALL operations (read + write) via URL params.
// This avoids the POST → 302 redirect issue that drops the POST body.
function doGet(e) {
  const params   = e.parameter || {};
  const action   = params.action;
  const callback = params.callback; // JSONP support
  let result;
  try {
    if      (action === 'getAll')       result = getAllRecords();
    else if (action === 'add')          result = addRecord(params);
    else if (action === 'edit')         result = editRecord(params);
    else if (action === 'delete')       result = deleteRecord(params);
    else if (action === 'updateStatus') result = updateStatus(params);
    else result = { error: 'Unknown action: ' + action };
  } catch (err) {
    result = { error: err.message };
  }

  const json = JSON.stringify(result);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

// ── doOptions (CORS preflight) ────────────────────────────────
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ── doPost ────────────────────────────────────────────────────
function doPost(e) {
  let result;
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;

    if      (action === 'add')          result = addRecord(data);
    else if (action === 'edit')         result = editRecord(data);
    else if (action === 'delete')       result = deleteRecord(data);
    else if (action === 'updateStatus') result = updateStatus(data);
    else                                result = { error: 'Unknown action: ' + action };
  } catch (err) {
    result = { error: err.message };
  }
  return jsonResponse(result);
}

// ── getAllRecords ─────────────────────────────────────────────
function getAllRecords() {
  const sheet  = getSheet();
  const data   = sheet.getDataRange().getValues();

  if (data.length <= 1) return { records: [] };

  const records = data.slice(1)
    .filter(row => row[COL.ID])  // skip blank rows
    .map(row => ({
      id:             String(row[COL.ID]),
      senderName:     String(row[COL.SENDER]       || ''),
      principal:      String(row[COL.PRINCIPAL]    || '0'),
      interestRate:   String(row[COL.RATE]         || '0'),
      interestAmount: String(row[COL.INTEREST]     || '0'),
      fromDate:       fmtDate(row[COL.FROM]),
      toDate:         fmtDate(row[COL.TO]),
      numDays:        String(row[COL.DAYS]         || '0'),
      totalAmount:    String(row[COL.TOTAL]        || '0'),
      status:         String(row[COL.STATUS]       || 'Unpaid'),
      rateType:       String(row[COL.RATE_TYPE]    || 'monthly'),
      rateMonthly:    String(row[COL.RATE_MONTHLY] || '0'),
      rateDaily:      String(row[COL.RATE_DAILY]   || '0'),
      isAppMoney:     String(row[COL.IS_APP_MONEY]  || 'false'),
      appInterest:    String(row[COL.APP_INTEREST]  || '0')
    }));

  return { records };
}

// ── addRecord ─────────────────────────────────────────────────
function addRecord(data) {
  const sheet = getSheet();
  sheet.appendRow(buildRow(data));
  applyRowStyles(sheet, sheet.getLastRow());
  return { success: true };
}

// ── editRecord ────────────────────────────────────────────────
function editRecord(data) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID]) === String(data.id)) {
      const newRow = buildRow(data);
      // Preserve existing status if not provided
      newRow[COL.STATUS] = data.status || values[i][COL.STATUS] || 'Unpaid';
      sheet.getRange(i + 1, 1, 1, TOTAL_COLS).setValues([newRow]);
      return { success: true };
    }
  }
  return { error: 'Record not found: ' + data.id };
}

// ── deleteRecord ──────────────────────────────────────────────
function deleteRecord(data) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Record not found: ' + data.id };
}

// ── updateStatus ──────────────────────────────────────────────
function updateStatus(data) {
  const sheet  = getSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][COL.ID]) === String(data.id)) {
      const statusCell = sheet.getRange(i + 1, COL.STATUS + 1);
      statusCell.setValue(data.status);

      // Color-code the status cell
      if (data.status === 'Paid') {
        statusCell.setBackground('#d1fae5').setFontColor('#065f46');
      } else {
        statusCell.setBackground('#fee2e2').setFontColor('#991b1b');
      }
      return { success: true };
    }
  }
  return { error: 'Record not found: ' + data.id };
}

// ── Utilities ─────────────────────────────────────────────────
function buildRow(data) {
  return [
    data.id,
    data.senderName,
    parseFloat(data.principal)      || 0,
    parseFloat(data.interestRate)   || 0,
    parseFloat(data.interestAmount) || 0,
    data.fromDate,
    data.toDate,
    parseInt(data.numDays)          || 0,
    parseFloat(data.totalAmount)    || 0,
    data.status || 'Unpaid',
    data.rateType    || 'monthly',
    parseFloat(data.rateMonthly)   || 0,
    parseFloat(data.rateDaily)     || 0,
    data.isAppMoney  || 'false',
    parseFloat(data.appInterest)    || 0
  ];
}

function applyRowStyles(sheet, rowNum) {
  const statusCell = sheet.getRange(rowNum, COL.STATUS + 1);
  const status     = statusCell.getValue();
  if (status === 'Paid') {
    statusCell.setBackground('#d1fae5').setFontColor('#065f46');
  } else {
    statusCell.setBackground('#fee2e2').setFontColor('#991b1b');
  }

  // Alternate row background
  const bg = (rowNum % 2 === 0) ? '#f8fafc' : '#ffffff';
  sheet.getRange(rowNum, 1, 1, TOTAL_COLS - 1).setBackground(bg);
}

function fmtDate(val) {
  if (!val) return '';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (e) {
    return String(val);
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

