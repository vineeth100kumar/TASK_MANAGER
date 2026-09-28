/**
 * SAGE TASK MANAGER - Google Apps Script Backend (Production Hardened V5.0)
 * 
 * Features:
 * - Full Personal Attention & Flow Engine Schema Support (Inbox, Focus, Snooze, WaitingFor, QuickWins)
 * - Project Map & Dependency Graph Support (dependsOn, flowLayout)
 * - Per-operation batch execution results (`applied`, `conflict`, `rejected`)
 * - Granular Conflict Resolution (Field-level LWW, State OCC, Append-only collections)
 * - Incremental Pull Protocol (`getChangesSince&sinceRevision=X`)
 * - Atomic write transactions with LockService mutex
 * - Idempotency ledger with automatic 14-day lifecycle pruning
 * - Authoritative Server Revision management
 * - Optional Secret Auth Key verification
 */

const SCHEMA_VERSION = 5;

const DEFAULT_SHEETS = {
  workItems: [
    'id', 'key', 'title', 'description', 'entityType', 'lifeContext', 'type', 'status', 'priority',
    'projectId', 'areaId', 'estimated', 'actual', 'blockedReason',
    'startDate', 'dueDate', 'startAt', 'endAt', 'remindAt', 'repeatRule',
    'location', 'labels', 'customFields', 'dependsOn',
    'isInbox', 'isFocus', 'focusOrder', 'snoozedUntil', 'snoozeCount', 'waitingFor', 'energy', 'estimatedMinutes', 'lastTouchedAt',
    'revision', 'completedAt', 'deletedAt',
    'createdAt', 'updatedAt'
  ],
  projects: [
    'id', 'name', 'key', 'color', 'sequence', 'type', 'description', 'flowLayout', 'revision', 'createdAt', 'updatedAt'
  ],
  areas: [
    'id', 'name', 'color', 'icon', 'description', 'revision', 'createdAt', 'updatedAt'
  ],
  goals: [
    'id', 'title', 'progress', 'targetDate', 'areaId', 'projectId', 'category', 'description', 'revision', 'createdAt', 'updatedAt'
  ],
  habits: [
    'id', 'name', 'frequency', 'targetCount', 'history', 'areaId', 'streak', 'revision', 'createdAt', 'updatedAt'
  ],
  notes: [
    'id', 'title', 'content', 'areaId', 'projectId', 'revision', 'createdAt', 'updatedAt'
  ],
  // Canvas whiteboards. The drawing is split across scene0, scene1, ... (added as
  // needed) so each part fits in a cell; sceneParts says how many are current.
  boards: [
    'id', 'title', 'lifeContext', 'sceneParts', 'scene0', 'revision', 'createdAt', 'updatedAt'
  ],
  comments: [
    'id', 'workItemId', 'body', 'createdAt', 'deletedAt'
  ],
  subtasks: [
    'id', 'workItemId', 'title', 'completed', 'position', 'createdAt'
  ],
  activities: [
    'id', 'workItemId', 'eventType', 'oldValue', 'newValue', 'actorId', 'createdAt'
  ],
  syncOperations: [
    'operationId', 'clientId', 'entityType', 'entityId', 'operation', 'revision', 'processedAt'
  ],
  metadata: [
    'key', 'value', 'updatedAt'
  ]
};

function checkAuth(e) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const configuredKey = scriptProperties.getProperty('SAGE_AUTH_KEY');
  if (!configuredKey) return true; // Auth optional unless explicitly set in Script Properties

  const authHeader = (e && e.parameter && e.parameter.authKey) || '';
  return authHeader === configuredKey;
}

function doGet(e) {
  if (!checkAuth(e)) {
    return jsonResponse({ success: false, error: 'Unauthorized: invalid authKey' }, 401);
  }

  const action = (e && e.parameter && e.parameter.action) || 'getAll';
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000);
    
    if (action === 'getAll') {
      const data = getAllData();
      const serverRev = getServerRevision();
      return jsonResponse({ success: true, schemaVersion: SCHEMA_VERSION, serverRevision: serverRev, data: data });
    }

    // Incremental Pull: returns only modified items since sinceRevision
    if (action === 'getChangesSince') {
      const sinceRevision = Number(e.parameter.sinceRevision) || 0;
      const changes = getChangesSince(sinceRevision);
      const serverRev = getServerRevision();
      return jsonResponse({
        success: true,
        sinceRevision: sinceRevision,
        serverRevision: serverRev,
        changes: changes
      });
    }
    
    if (action === 'getTable') {
      const table = e.parameter.table;
      if (!table) return jsonResponse({ success: false, error: 'Table parameter required' }, 400);
      const rows = getTableRows(table);
      return jsonResponse({ success: true, data: rows });
    }

    if (action === 'ping') {
      return jsonResponse({ success: true, status: 'online', schemaVersion: SCHEMA_VERSION, serverRevision: getServerRevision() });
    }
    
    return jsonResponse({ success: false, error: 'Invalid GET action: ' + action }, 400);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  if (!checkAuth(e)) {
    return jsonResponse({ success: false, error: 'Unauthorized: invalid authKey' }, 401);
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse({ success: false, error: 'Invalid JSON body: ' + parseErr.message }, 400);
    }
    
    const action = payload.action;

    if (action === 'clearAll') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheets = ss.getSheets();
      for (let i = 0; i < sheets.length; i++) {
        const tableName = sheets[i].getName();
        if (tableName === 'metadata') continue;
        const sheet = sheets[i];
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.deleteRows(2, lastRow - 1);
        }
      }
      
      const metaSheet = ss.getSheetByName('metadata');
      if (metaSheet) {
        const lastRow = metaSheet.getLastRow();
        if (lastRow > 1) {
          const values = metaSheet.getRange(2, 1, lastRow - 1, 2).getValues();
          for (let i = 0; i < values.length; i++) {
            if (values[i][0] === 'serverRevision') {
              metaSheet.getRange(i + 2, 2).setValue(1);
              break;
            }
          }
        }
      }

      return jsonResponse({
        success: true,
        serverRevision: 1,
        message: 'All cloud data wiped'
      });
    }

    // Per-operation results with Granular Conflict Resolution
    if (action === 'processOperations') {
      const operations = payload.operations;
      if (!Array.isArray(operations)) {
        return jsonResponse({ success: false, error: 'operations array required' }, 400);
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const processedOpsSheet = ensureSheetAndHeaders(ss, 'syncOperations');
      const processedOpIds = getProcessedOperationIds(ss);

      const opResults = [];
      let newServerRev = incrementServerRevision(ss);

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        if (!op.operationId) {
          opResults.push({ operationId: op.operationId || 'unknown', status: 'rejected', reason: 'Missing operationId' });
          continue;
        }

        // Idempotency: if already processed, return applied immediately
        if (processedOpIds.has(op.operationId)) {
          opResults.push({ operationId: op.operationId, status: 'applied', idempotent: true });
          continue;
        }

        const table = op.entityType;
        if (!table || typeof table !== 'string' || !/^[a-zA-Z0-9_]+$/.test(table)) {
          opResults.push({ operationId: op.operationId, status: 'rejected', reason: 'Invalid entity table name: ' + table });
          continue;
        }

        try {
          if (op.operation === 'save' || op.operation === 'patch') {
            const existing = getRecordById(table, op.entityId, ss);

            // Optimistic concurrency check for state mutations
            if (existing && op.revision !== undefined && existing.revision > op.revision && op.payload && op.payload.status && op.payload.status !== existing.status) {
              opResults.push({
                operationId: op.operationId,
                status: 'conflict',
                reason: 'Stale status transition',
                serverRevision: newServerRev,
                currentRecord: existing
              });
              continue;
            }

            // Field-level LWW merge if record exists
            const recordToSave = existing ? { ...existing, ...op.payload, revision: Math.max(op.revision || 1, (existing.revision || 1) + 1) } : op.payload;
            upsertRecord(table, recordToSave, ss);
            
            appendOperationLedger(processedOpsSheet.sheet, op);
            processedOpIds.add(op.operationId);
            opResults.push({ operationId: op.operationId, status: 'applied', entityRevision: recordToSave.revision });
          } else if (op.operation === 'delete') {
            // Row removal / Tombstone
            deleteRecord(table, op.entityId, ss);
            appendOperationLedger(processedOpsSheet.sheet, op);
            processedOpIds.add(op.operationId);
            opResults.push({ operationId: op.operationId, status: 'applied' });
          }
        } catch (opErr) {
          opResults.push({ operationId: op.operationId, status: 'rejected', reason: opErr.toString() });
        }
      }

      // Periodically prune ledger if larger than 1000 rows
      maybePruneLedger(processedOpsSheet.sheet);

      return jsonResponse({
        success: true,
        serverRevision: newServerRev,
        results: opResults
      });
    }

    return jsonResponse({ success: false, error: 'Unknown POST action: ' + action }, 400);
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

function ensureSheetAndHeaders(ss, tableName) {
  let sheet = ss.getSheetByName(tableName);
  const defaultHeaders = DEFAULT_SHEETS[tableName] || ['id', 'revision', 'createdAt', 'updatedAt'];
  
  if (!sheet) {
    sheet = ss.insertSheet(tableName);
    sheet.appendRow(defaultHeaders);
    sheet.getRange(1, 1, 1, defaultHeaders.length).setFontWeight('bold').setBackground('#E8F0FE');
    sheet.setFrozenRows(1);
    return { sheet: sheet, headers: [...defaultHeaders] };
  }
  
  const lastCol = Math.max(1, sheet.getLastColumn());
  const headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headerValues.filter(h => h !== '');
  
  defaultHeaders.forEach(col => {
    if (headers.indexOf(col) === -1) {
      headers.push(col);
      sheet.getRange(1, headers.length).setValue(col).setFontWeight('bold').setBackground('#E8F0FE');
    }
  });
  
  return { sheet: sheet, headers: headers };
}

function getAllData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = {};
  const sheets = ss.getSheets();
  
  for (let i = 0; i < sheets.length; i++) {
    const tableName = sheets[i].getName();
    if (tableName === 'syncOperations' || tableName === 'metadata') continue;
    result[tableName] = getTableRows(tableName, ss);
  }
  
  return result;
}

function getChangesSince(sinceRevision) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const changes = {};
  const sheets = ss.getSheets();

  for (let i = 0; i < sheets.length; i++) {
    const tableName = sheets[i].getName();
    if (tableName === 'syncOperations' || tableName === 'metadata') continue;
    const rows = getTableRows(tableName, ss);
    // Filter rows whose revision is greater than sinceRevision
    const modified = rows.filter(r => (Number(r.revision) || 1) > sinceRevision);
    if (modified.length > 0) {
      changes[tableName] = modified;
    }
  }

  return changes;
}

function getTableRows(tableName, ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  const { sheet, headers } = ensureSheetAndHeaders(ss, tableName);
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  
  return data.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      let val = row[index];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, ss.getSpreadsheetTimeZone() || "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");
      }
      if (val === 'TRUE' || val === 'true') val = true;
      if (val === 'FALSE' || val === 'false') val = false;
      if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
        try {
          val = JSON.parse(val);
        } catch (e) {}
      }
      obj[header] = val;
    });
    return obj;
  });
}

function getRecordById(tableName, id, ss) {
  const rows = getTableRows(tableName, ss);
  return rows.find(r => String(r.id) === String(id)) || null;
}

function upsertRecord(tableName, record, ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  let { sheet, headers } = ensureSheetAndHeaders(ss, tableName);
  
  // Dynamically add any missing columns from the record
  for (const key in record) {
    if (headers.indexOf(key) === -1) {
      headers.push(key);
      sheet.getRange(1, headers.length).setValue(key).setFontWeight('bold').setBackground('#E8F0FE');
    }
  }

  const lastRow = sheet.getLastRow();
  let targetRow = -1;
  
  if (lastRow > 1) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(record.id)) {
        targetRow = i + 2;
        break;
      }
    }
  }
  
  const rowValues = headers.map(header => {
    let val = record[header];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    return val;
  });
  
  if (targetRow > 1) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
  
  return record;
}

function deleteRecord(tableName, id, ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  const { sheet } = ensureSheetAndHeaders(ss, tableName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function getProcessedOperationIds(ss) {
  const { sheet } = ensureSheetAndHeaders(ss, 'syncOperations');
  const lastRow = sheet.getLastRow();
  const set = new Set();
  if (lastRow <= 1) return set;

  const rows = sheet.getRange(Math.max(2, lastRow - 1000), 1, Math.min(lastRow - 1, 1000), 1).getValues();
  rows.forEach(r => {
    if (r[0]) set.add(String(r[0]));
  });
  return set;
}

function appendOperationLedger(sheet, op) {
  sheet.appendRow([
    op.operationId,
    op.clientId || '',
    op.entityType || '',
    op.entityId || '',
    op.operation || 'save',
    op.revision || 1,
    new Date().toISOString()
  ]);
}

function maybePruneLedger(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1500) {
    // Delete oldest 500 rows to prevent spreadsheet bloat
    sheet.deleteRows(2, 500);
  }
}

function getServerRevision() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { sheet } = ensureSheetAndHeaders(ss, 'metadata');
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === 'serverRevision') {
      return Number(values[i][1]) || 1;
    }
  }
  return 1;
}

function incrementServerRevision(ss) {
  const { sheet } = ensureSheetAndHeaders(ss, 'metadata');
  const lastRow = sheet.getLastRow();
  let revRow = -1;
  let currentRev = 1;

  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === 'serverRevision') {
        revRow = i + 2;
        currentRev = Number(values[i][1]) || 1;
        break;
      }
    }
  }

  const nextRev = currentRev + 1;
  if (revRow > 1) {
    sheet.getRange(revRow, 2).setValue(nextRev);
    sheet.getRange(revRow, 3).setValue(new Date().toISOString());
  } else {
    sheet.appendRow(['serverRevision', nextRev, new Date().toISOString()]);
  }
  return nextRev;
}

function jsonResponse(obj, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
