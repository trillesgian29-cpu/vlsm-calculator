/* ============================================================
   VLSM / FLSM Calculator + Routing CLI Generator
   script.js
   ============================================================ */

'use strict';

// ============================================================
//  STATE
// ============================================================
let mode = 'vlsm';
let topo = 'ring';
let proto = 'static';
let subnetData = [];
let routers = [];
let serialLinks = [];
let routerCount = 0;

// ============================================================
//  IP MATH
// ============================================================
function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o), 0) >>> 0;
}
function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}
function prefixToMask(prefix) {
  if (prefix === 0) return 0;
  const shift = 32 - prefix;
  return shift >= 32 ? 0 : (0xffffffff << shift) >>> 0;
}
function maskToPrefix(maskInt) {
  let n = maskInt, count = 0;
  while (n & 0x80000000) { count++; n = (n << 1) >>> 0; }
  return count;
}
function parseMaskInput(val) {
  val = val.trim();
  if (val.startsWith('/')) val = val.slice(1);
  if (/^\d+$/.test(val)) {
    const p = parseInt(val);
    if (p < 0 || p > 32) throw new Error('Prefix must be 0-32');
    return p;
  }
  if (val.includes('.')) return maskToPrefix(ipToInt(val));
  throw new Error('Invalid mask/prefix');
}
function wildcardMask(maskInt) { return (~maskInt) >>> 0; }

// Class A serial networks pool
const classANets = (function () {
  const nets = [];
  for (let i = 10; i <= 20; i++) {
    const networkInt = ipToInt(i + '.0.0.0');
    const maskInt = 0xff000000 >>> 0;
    nets.push({
      no: 'A' + i, hosts: 16777214, cidr: '/8',
      octet: '1st', increment: 256, blockSize: 16777216,
      networkId: i + '.0.0.0', mask: '255.0.0.0',
      first: i + '.0.0.1', second: i + '.0.0.2',
      last: i + '.255.255.254', broadcast: i + '.255.255.255',
      networkInt, maskInt, prefix: 8
    });
  }
  return nets;
})();

function getSerialNet(link) {
  if (link.classAIndex !== -1) return classANets[link.classAIndex];
  if (link.netIndex !== -1) return subnetData[link.netIndex];
  return null;
}

function getOctetLabel(prefix) {
  if (prefix >= 25) return '4th';
  if (prefix >= 17) return '3rd';
  if (prefix >= 9)  return '2nd';
  return '1st';
}

function getOctetIncrement(prefix) {
  if (prefix >= 25) return Math.pow(2, 32 - prefix);
  if (prefix >= 17) return Math.pow(2, 24 - prefix);
  if (prefix >= 9)  return Math.pow(2, 16 - prefix);
  return Math.pow(2, 8 - prefix);
}

function buildSubnetRow(no, networkInt, prefix, inputHosts) {
  const maskInt = prefixToMask(prefix);
  const blockSize = prefix === 32 ? 1 : Math.pow(2, 32 - prefix);
  const calcHosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : blockSize - 2;
  const broadcastInt = (networkInt | wildcardMask(maskInt)) >>> 0;
  const firstInt = prefix >= 31 ? networkInt : networkInt + 1;
  const secondInt = prefix >= 31 ? networkInt : networkInt + 2;
  const lastInt = prefix >= 31 ? broadcastInt : broadcastInt - 1;
  return {
    no,
    hosts: inputHosts != null ? inputHosts : (calcHosts < 0 ? 0 : calcHosts),
    cidr: '/' + prefix,
    octet: getOctetLabel(prefix),
    increment: getOctetIncrement(prefix),
    blockSize,
    networkId: intToIp(networkInt),
    mask: intToIp(maskInt),
    first: intToIp(firstInt),
    second: intToIp(secondInt),
    last: intToIp(lastInt),
    broadcast: intToIp(broadcastInt),
    networkInt, prefix, maskInt
  };
}

// ============================================================
//  MODE TOGGLE
// ============================================================
function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === m);
  });
  document.getElementById('flsmInputs').classList.toggle('hidden', m !== 'flsm');
  document.getElementById('vlsmInputs').classList.toggle('hidden', m !== 'vlsm');
  document.getElementById('calcError').textContent = '';
  if (m === 'vlsm' && document.getElementById('vlsmList').children.length === 0) {
    addVlsmEntry(); addVlsmEntry();
  }
}

// ============================================================
//  VLSM ENTRIES
// ============================================================
let vlsmEntryCount = 0;
function addVlsmEntry() {
  vlsmEntryCount++;
  const id = 'vlsm_' + vlsmEntryCount;
  const div = document.createElement('div');
  div.className = 'vlsm-entry';
  div.id = id;
  div.innerHTML = `
    <span class="vlsm-label">Subnet ${vlsmEntryCount}</span>
    <input type="number" placeholder="Required Hosts" min="1">
    <button class="btn-icon-danger" onclick="removeVlsmEntry('${id}')">✕</button>
  `;
  document.getElementById('vlsmList').appendChild(div);
}

function removeVlsmEntry(id) {
  document.getElementById(id)?.remove();
  renumberVlsm();
}

function renumberVlsm() {
  document.querySelectorAll('.vlsm-entry .vlsm-label').forEach((e, i) => {
    e.textContent = 'Subnet ' + (i + 1);
  });
}

// ============================================================
//  CALCULATE
// ============================================================
function calculate() {
  const errEl = document.getElementById('calcError');
  errEl.textContent = '';
  try {
    if (mode === 'flsm') calcFLSM();
    else calcVLSM();
  } catch (e) {
    errEl.textContent = '⚠ ' + e.message;
  }
}

function calcFLSM() {
  const netStr   = document.getElementById('flsmNet').value.trim();
  const maskStr  = document.getElementById('flsmMask').value.trim();
  const countStr = document.getElementById('flsmCount').value.trim();
  if (!netStr || !maskStr || !countStr) throw new Error('Fill all fields');
  const baseNet = ipToInt(netStr);
  const prefix  = parseMaskInput(maskStr);
  const count   = parseInt(countStr);
  if (isNaN(count) || count < 1) throw new Error('Subnet count must be ≥ 1');
  let subnetBits = 0;
  while ((1 << subnetBits) < count) subnetBits++;
  const newPrefix = prefix + subnetBits;
  if (newPrefix > 30) throw new Error('Not enough address space for ' + count + ' subnets');
  subnetData = [];
  for (let i = 0; i < count; i++) {
    const inc = Math.pow(2, 32 - newPrefix);
    subnetData.push(buildSubnetRow(i + 1, (baseNet + i * inc) >>> 0, newPrefix, null));
  }
  renderTable(netStr + ' /' + prefix + ' — FLSM');
}

function calcVLSM() {
  const netStr = document.getElementById('vlsmNet').value.trim();
  if (!netStr) throw new Error('Enter a network address');
  const entries = document.querySelectorAll('#vlsmList .vlsm-entry');
  if (entries.length === 0) throw new Error('Add at least one subnet');
  let requirements = [];
  entries.forEach((e, i) => {
    const h = parseInt(e.querySelector('input').value);
    if (isNaN(h) || h < 1) throw new Error('Subnet ' + (i + 1) + ': enter a valid host count');
    requirements.push(h);
  });
  requirements.sort((a, b) => b - a);
  let cursor = ipToInt(netStr);
  subnetData = [];
  for (let i = 0; i < requirements.length; i++) {
    let p = 30;
    while (p >= 1) {
      if (Math.pow(2, 32 - p) - 2 >= requirements[i]) break;
      p--;
    }
    if (p < 1) throw new Error('Cannot fit ' + requirements[i] + ' hosts');
    subnetData.push(buildSubnetRow(i + 1, cursor, p, requirements[i]));
    cursor = (cursor + Math.pow(2, 32 - p)) >>> 0;
  }
  renderTable(netStr + ' — VLSM');
}

function renderTable(title) {
  const last    = subnetData[subnetData.length - 1];
  const nextInt = (last.networkInt + last.blockSize) >>> 0;
  const nextAddr = intToIp(nextInt);

  document.getElementById('tableInfoRow').innerHTML =
    `<span>${title}</span>
     <span class="next-label">Next Available:</span>
     <span class="next-addr">${nextAddr}</span>`;

  const tbody = document.getElementById('subnetTbody');
  tbody.innerHTML = '';
  subnetData.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-no">${s.no}</td>
      <td>${s.hosts.toLocaleString()}</td>
      <td class="col-cidr">${s.cidr}</td>
      <td class="col-octet">${s.octet}</td>
      <td class="col-inc">${s.increment}</td>
      <td class="col-network">${s.networkId}</td>
      <td>${s.mask}</td>
      <td>${s.first}</td>
      <td>${s.last}</td>
      <td>${s.broadcast}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('resultCard').classList.remove('hidden');
  unlockCLI();
}

function resetCalc() {
  subnetData = [];
  document.getElementById('calcError').textContent = '';
  document.getElementById('flsmNet').value  = '';
  document.getElementById('flsmMask').value = '';
  document.getElementById('flsmCount').value = '';
  document.getElementById('vlsmNet').value  = '';
  document.getElementById('vlsmList').innerHTML = '';
  vlsmEntryCount = 0;
  lockCLI();
  loadDefaultData();
}

// ============================================================
//  DEFAULT PRELOADED DATA
// ============================================================
function loadDefaultData() {
  subnetData = [
    { no:1, hosts:100, cidr:'/25', octet:'4th', increment:128, networkId:'192.168.10.0',   mask:'255.255.255.128', first:'192.168.10.1',   last:'192.168.10.126', broadcast:'192.168.10.127', networkInt:ipToInt('192.168.10.0'),   prefix:25, maskInt:prefixToMask(25) },
    { no:2, hosts:50,  cidr:'/26', octet:'4th', increment:64,  networkId:'192.168.10.128', mask:'255.255.255.192', first:'192.168.10.129', last:'192.168.10.190', broadcast:'192.168.10.191', networkInt:ipToInt('192.168.10.128'), prefix:26, maskInt:prefixToMask(26) },
    { no:3, hosts:10,  cidr:'/28', octet:'4th', increment:16,  networkId:'192.168.10.192', mask:'255.255.255.240', first:'192.168.10.193', last:'192.168.10.206', broadcast:'192.168.10.207', networkInt:ipToInt('192.168.10.192'), prefix:28, maskInt:prefixToMask(28) },
    { no:4, hosts:2,   cidr:'/30', octet:'4th', increment:4,   networkId:'192.168.10.208', mask:'255.255.255.252', first:'192.168.10.209', last:'192.168.10.210', broadcast:'192.168.10.211', networkInt:ipToInt('192.168.10.208'), prefix:30, maskInt:prefixToMask(30) },
    { no:5, hosts:2,   cidr:'/30', octet:'4th', increment:4,   networkId:'192.168.10.212', mask:'255.255.255.252', first:'192.168.10.213', last:'192.168.10.214', broadcast:'192.168.10.215', networkInt:ipToInt('192.168.10.212'), prefix:30, maskInt:prefixToMask(30) },
    { no:6, hosts:2,   cidr:'/30', octet:'4th', increment:4,   networkId:'192.168.10.216', mask:'255.255.255.252', first:'192.168.10.217', last:'192.168.10.218', broadcast:'192.168.10.219', networkInt:ipToInt('192.168.10.216'), prefix:30, maskInt:prefixToMask(30) },
  ];
  document.getElementById('tableInfoRow').innerHTML =
    `<span>192.168.10.0 /24 &mdash; VLSM (Demo)</span>
     <span class="next-label">Next Available:</span>
     <span class="next-addr">192.168.10.220</span>`;
  const tbody = document.getElementById('subnetTbody');
  tbody.innerHTML = '';
  subnetData.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-no">${s.no}</td>
      <td>${s.hosts.toLocaleString()}</td>
      <td class="col-cidr">${s.cidr}</td>
      <td class="col-octet">${s.octet}</td>
      <td class="col-inc">${s.increment}</td>
      <td class="col-network">${s.networkId}</td>
      <td>${s.mask}</td>
      <td>${s.first}</td>
      <td>${s.last}</td>
      <td>${s.broadcast}</td>`;
    tbody.appendChild(tr);
  });
  unlockCLI();
}

// ============================================================
//  CHEAT SHEET
// ============================================================
const CHEAT_ROWS = [
  { bin:'2^2',  hosts:4,          inc:4,   cidr:'/30', mask:'255.255.255.252' },
  { bin:'2^3',  hosts:8,          inc:8,   cidr:'/29', mask:'255.255.255.248' },
  { bin:'2^4',  hosts:16,         inc:16,  cidr:'/28', mask:'255.255.255.240' },
  { bin:'2^5',  hosts:32,         inc:32,  cidr:'/27', mask:'255.255.255.224' },
  { bin:'2^6',  hosts:64,         inc:64,  cidr:'/26', mask:'255.255.255.192' },
  { bin:'2^7',  hosts:128,        inc:128, cidr:'/25', mask:'255.255.255.128' },
  { bin:'2^8',  hosts:256,        inc:1,   cidr:'/24', mask:'255.255.255.0'   },
  { bin:'2^9',  hosts:512,        inc:2,   cidr:'/23', mask:'255.255.254.0'   },
  { bin:'2^10', hosts:1024,       inc:4,   cidr:'/22', mask:'255.255.252.0'   },
  { bin:'2^11', hosts:2048,       inc:8,   cidr:'/21', mask:'255.255.248.0'   },
  { bin:'2^12', hosts:4096,       inc:16,  cidr:'/20', mask:'255.255.240.0'   },
  { bin:'2^13', hosts:8192,       inc:32,  cidr:'/19', mask:'255.255.224.0'   },
  { bin:'2^14', hosts:16384,      inc:64,  cidr:'/18', mask:'255.255.192.0'   },
  { bin:'2^15', hosts:32768,      inc:128, cidr:'/17', mask:'255.255.128.0'   },
  { bin:'2^16', hosts:65536,      inc:1,   cidr:'/16', mask:'255.255.0.0'     },
];

function buildCheatSheet() {
  const tbody = document.getElementById('cheatTbody');
  if (!tbody) return;
  CHEAT_ROWS.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono muted">${r.bin}</td>
      <td class="mono">${r.hosts.toLocaleString()}</td>
      <td class="mono green bold">${r.inc}</td>
      <td class="mono blue bold">${r.cidr}</td>
      <td class="mono">${r.mask}</td>`;
    tbody.appendChild(tr);
  });
}

// ============================================================
//  EXPORT XLSX
// ============================================================
function exportXLSX() {
  const headers = ['#','Hosts','CIDR','Octet','Increment','Network Address','Subnet Mask','1st Usable','Last Usable','Broadcast'];
  const rows = subnetData.map(s => [s.no, s.hosts, s.cidr, s.octet, s.increment, s.networkId, s.mask, s.first, s.last, s.broadcast]);
  const ws = buildWorksheet([headers, ...rows]);
  const wb = buildWorkbook(ws, 'Subnets');
  downloadXLSX(wb, 'vlsm_table.xlsx');
}

function buildWorksheet(data) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  data.forEach((row, ri) => {
    const sIdx = ri === 0 ? 1 : 2;
    xml += `<row r="${ri + 1}">`;
    row.forEach((cell, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof cell === 'number') {
        xml += `<c r="${ref}" s="${sIdx}"><v>${cell}</v></c>`;
      } else {
        const esc = String(cell).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        xml += `<c r="${ref}" t="inlineStr" s="${sIdx}"><is><t>${esc}</t></is></c>`;
      }
    });
    xml += '</row>';
  });
  xml += '</sheetData></worksheet>';
  return xml;
}

function colName(idx) {
  let name = ''; idx++;
  while (idx > 0) { let rem = (idx - 1) % 26; name = String.fromCharCode(65 + rem) + name; idx = Math.floor((idx - 1) / 26); }
  return name;
}

function buildWorkbook(wsXml, sheetName) {
  return {
    wbXml: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    relsXml: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    wsXml,
    stylesXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs></styleSheet>`,
    contentXml: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  };
}

function downloadXLSX(wb, filename) {
  const files = {
    '[Content_Types].xml': wb.contentXml,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': wb.wbXml,
    'xl/_rels/workbook.xml.rels': wb.relsXml,
    'xl/styles.xml': wb.stylesXml,
    'xl/worksheets/sheet1.xml': wb.wsXml,
  };
  const zip  = buildZip(files);
  const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildZip(files) {
  const enc = new TextEncoder();
  let localParts = [], centralParts = [], offset = 0;
  const crc32Table = (() => {
    let t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  function crc32(data) { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = crc32Table[(c ^ data[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function concat(...arrays) { const tot = arrays.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(tot); let p = 0; for (const a of arrays) { o.set(a, p); p += a.length; } return o; }
  function u16(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff]); }
  function u32(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]); }
  function b(...v) { return new Uint8Array(v); }
  for (const [name, fileContent] of Object.entries(files)) {
    const nb = enc.encode(name), db = enc.encode(fileContent);
    const crc = crc32(db), size = db.length;
    const lh = concat(b(0x50,0x4B,0x03,0x04),b(20,0),b(0,0),b(0,0),b(0,0,0,0),u32(crc),u32(size),u32(size),u16(nb.length),b(0,0),nb,db);
    const ce = concat(b(0x50,0x4B,0x01,0x02),b(20,0,20,0),b(0,0),b(0,0),b(0,0,0,0),u32(crc),u32(size),u32(size),u16(nb.length),b(0,0),b(0,0),b(0,0),b(0,0),b(0,0,0,0),u32(offset),nb);
    localParts.push(lh); centralParts.push(ce); offset += lh.length;
  }
  const cdSize = centralParts.reduce((s, a) => s + a.length, 0);
  const total  = Object.keys(files).length;
  const eocd   = concat(b(0x50,0x4B,0x05,0x06),b(0,0,0,0),u16(total),u16(total),u32(cdSize),u32(offset),b(0,0));
  return concat(...localParts, ...centralParts, eocd);
}

// ============================================================
//  CLI SECTION
// ============================================================
function unlockCLI() {
  document.getElementById('cliLocked').classList.add('hidden');
  document.getElementById('cliContent').classList.remove('hidden');
  refreshRouterGrid();
  refreshSerialSection();
}

function lockCLI() {
  document.getElementById('cliLocked').classList.remove('hidden');
  document.getElementById('cliContent').classList.add('hidden');
  document.getElementById('cliOutputSection').classList.add('hidden');
  routers = []; serialLinks = []; routerCount = 0;
}

function setTopo(t) {
  topo = t;
  document.getElementById('topoRing').classList.toggle('active', t === 'ring');
  document.getElementById('topoBus').classList.toggle('active', t === 'bus');
  refreshSerialSection();
}

function setProto(p) {
  proto = p;
  document.querySelectorAll('[data-proto]').forEach(b => b.classList.toggle('active', b.dataset.proto === p));
  document.getElementById('eigrpAsField').classList.toggle('hidden', p !== 'eigrp');
  document.getElementById('ospfPidField').classList.toggle('hidden', p !== 'ospf');
}

function addRouter() {
  routerCount++;
  routers.push({ id: routerCount, name: 'R' + routerCount, lans: [] });
  refreshRouterGrid();
  refreshSerialSection();

  // Update badge
  const b = document.getElementById('routerCountBadge');
  if (b) b.textContent = routers.length + ' Router' + (routers.length !== 1 ? 's' : '');
}

function refreshRouterGrid() {
  const grid = document.getElementById('routerAssignGrid');
  grid.innerHTML = '';
  routers.forEach((r, ri) => {
    const div = document.createElement('div');
    div.className = 'router-card';
    const checks = subnetData.map((s, si) =>
      `<label class="net-check">
        <input type="checkbox" ${r.lans.includes(si) ? 'checked' : ''}
               onchange="toggleLan(${ri},${si},this.checked)">
        <span>
          <span style="color:var(--blue-h);font-weight:700;">${s.networkId}${s.cidr}</span>
          <span style="color:var(--text3);font-size:10px;"> · ${s.hosts} hosts</span>
        </span>
      </label>`
    ).join('');
    div.innerHTML = `
      <div class="router-card-title">
        <span class="router-icon">⬡</span> ${r.name}
      </div>
      <div class="net-check-list">${checks}</div>`;
    grid.appendChild(div);
  });
}

function removeLastRouter() {
  if (routers.length === 0) return;
  routers.pop();
  refreshRouterGrid();
  refreshSerialSection();
}

function refreshRouterGrid() {
  const grid = document.getElementById('routerAssignGrid');
  grid.innerHTML = '';
  routers.forEach((r, ri) => {
    const div = document.createElement('div');
    div.className = 'router-card';
    const checks = subnetData.map((s, si) =>
      `<label class="net-check">
        <input type="checkbox" ${r.lans.includes(si) ? 'checked' : ''} onchange="toggleLan(${ri},${si},this.checked)">
        <span>Net ${s.no}: ${s.networkId}${s.cidr}</span>
      </label>`
    ).join('');
    div.innerHTML = `
      <div class="router-card-title">
        <span class="router-icon">⬡</span> ${r.name}
      </div>
      <div class="net-check-list">${checks}</div>`;
    grid.appendChild(div);
  });
}

function toggleLan(ri, si, checked) {
  if (checked) { if (!routers[ri].lans.includes(si)) routers[ri].lans.push(si); }
  else routers[ri].lans = routers[ri].lans.filter(x => x !== si);
}

function buildNetOpts(link) {
  const subOpts = subnetData.map((s, si) =>
    `<option value="${si}" ${link.netIndex === si ? 'selected' : ''}>Net ${s.no}: ${s.networkId}${s.cidr}</option>`
  ).join('');
  const clsOpts = classANets.map((n, ci) =>
    `<option value="a:${ci}" ${link.classAIndex === ci ? 'selected' : ''}>${n.networkId}${n.cidr}</option>`
  ).join('');
  return `${subOpts}<optgroup label="── Class A Networks ──">${clsOpts}</optgroup>`;
}

function refreshSerialSection() {
  const hint   = document.getElementById('serialHint');
  const list   = document.getElementById('serialList');
  list.innerHTML = '';

  if (routers.length < 2) {
    hint.textContent = (topo === 'ring' ? 'Ring' : 'Bus') + ' topology: add at least 2 routers to auto-generate serial links.';
    serialLinks = [];
    return;
  }

  const prevAssignments = {};
  serialLinks.forEach(link => { prevAssignments[link.r1 + '_' + link.r2] = { netIndex: link.netIndex, classAIndex: link.classAIndex }; });
  serialLinks = [];

  const n = routers.length;
  if (topo === 'ring') {
    hint.textContent = 'Ring topology: ' + n + ' routers → ' + n + ' serial links (R1↔R2 ... R' + n + '↔R1)';
    for (let i = 0; i < n; i++) {
      const r1 = i, r2 = (i + 1) % n;
      const prev = prevAssignments[r1 + '_' + r2] || { netIndex: -1, classAIndex: -1 };
      serialLinks.push({ r1, r2, netIndex: prev.netIndex, classAIndex: prev.classAIndex });
    }
  } else {
    hint.textContent = 'Bus topology: ' + n + ' routers → ' + (n - 1) + ' serial links (R1→R2 ... R' + (n-1) + '→R' + n + ')';
    for (let i = 0; i < n - 1; i++) {
      const r1 = i, r2 = i + 1;
      const prev = prevAssignments[r1 + '_' + r2] || { netIndex: -1, classAIndex: -1 };
      serialLinks.push({ r1, r2, netIndex: prev.netIndex, classAIndex: prev.classAIndex });
    }
  }

  serialLinks.forEach((link, li) => {
    const div = document.createElement('div');
    div.className = 'serial-entry';
    div.innerHTML = `
      <span class="serial-label">${routers[link.r1].name} ↔ ${routers[link.r2].name}</span>
      <span class="serial-arrow">→</span>
      <select onchange="setSerialNet(${li}, this.value)">
        <option value="-1">-- Select Network --</option>
        ${buildNetOpts(link)}
      </select>`;
    list.appendChild(div);
  });
}

function setSerialNet(li, val) {
  if (val.startsWith('a:')) {
    serialLinks[li].netIndex = -1;
    serialLinks[li].classAIndex = parseInt(val.slice(2));
  } else {
    serialLinks[li].classAIndex = -1;
    serialLinks[li].netIndex = parseInt(val);
  }
}

function resetCLI() {
  routers = []; serialLinks = []; routerCount = 0;
  proto = 'static'; topo = 'ring';
  document.querySelectorAll('[data-proto]').forEach(b => b.classList.toggle('active', b.dataset.proto === 'static'));
  document.getElementById('topoRing').classList.add('active');
  document.getElementById('topoBus').classList.remove('active');
  ['eigrpAsField','ospfPidField'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('cliOutputSection').classList.add('hidden');
  refreshRouterGrid();
  refreshSerialSection();
}

// ============================================================
//  CLI GENERATION — VERIFIED WORKING PROTOCOLS
// ============================================================
function generateCLI() {
  const errEl = document.getElementById('cliError');
  errEl.textContent = '';
  if (routers.length === 0) { errEl.textContent = '⚠ Add at least one router.'; return; }
  for (const link of serialLinks) {
    if (link.netIndex === -1 && link.classAIndex === -1) {
      errEl.textContent = '⚠ Assign a network to every serial link.'; return;
    }
  }

  const eigrpAs = parseInt(document.getElementById('eigrpAs').value) || 100;
  const ospfPid = parseInt(document.getElementById('ospfPid').value) || 1;
  const outputsDiv = document.getElementById('cliOutputs');
  outputsDiv.innerHTML = '';

  // Build adjacency graph for BFS static routing
  function buildGraph() {
    const graph = routers.map(() => []);
    serialLinks.forEach((link, li) => {
      if (link.r1 !== -1 && link.r2 !== -1) {
        graph[link.r1].push({ neighbor: link.r2, linkIdx: li });
        graph[link.r2].push({ neighbor: link.r1, linkIdx: li });
      }
    });
    return graph;
  }

  // BFS: first hop link index from src toward dst
  function firstHopLink(graph, src, dst) {
    if (src === dst) return null;
    const visited = new Array(routers.length).fill(false);
    const queue   = [[src, null]];
    visited[src]  = true;
    while (queue.length) {
      const [cur, fhl] = queue.shift();
      for (const { neighbor, linkIdx } of graph[cur]) {
        if (visited[neighbor]) continue;
        visited[neighbor] = true;
        const resolved = fhl !== null ? fhl : linkIdx;
        if (neighbor === dst) return resolved;
        queue.push([neighbor, resolved]);
      }
    }
    return null;
  }

  // getRouterNets — returns subnetData indices (LAN + subnetData serial links)
  // NOTE: does NOT include Class A serial networks (classAIndex)
  function getRouterNets(ri) {
    const nets = new Set(routers[ri].lans);
    serialLinks.forEach(link => {
      if ((link.r1 === ri || link.r2 === ri) && link.netIndex !== -1) nets.add(link.netIndex);
    });
    return [...nets];
  }

  // getAllRouterNets — returns ALL network objects for a router:
  //   LAN subnets (from subnetData)
  // + serial links from subnetData (netIndex)
  // + serial links from classANets  (classAIndex)
  // Used by OSPF and EIGRP which must advertise every interface network.
  function getAllRouterNetObjs(ri) {
    const objs = [];
    const seen = new Set();

    // LAN subnets
    routers[ri].lans.forEach(si => {
      if (!seen.has('s' + si)) { seen.add('s' + si); objs.push(subnetData[si]); }
    });

    // Serial links — both subnetData and classANets
    serialLinks.forEach(link => {
      if (link.r1 !== ri && link.r2 !== ri) return;
      if (link.netIndex !== -1) {
        const key = 's' + link.netIndex;
        if (!seen.has(key)) { seen.add(key); objs.push(subnetData[link.netIndex]); }
      }
      if (link.classAIndex !== -1) {
        const key = 'a' + link.classAIndex;
        if (!seen.has(key)) { seen.add(key); objs.push(classANets[link.classAIndex]); }
      }
    });

    return objs;
  }

  const topoGraph = buildGraph();

  routers.forEach((router, ri) => {
    // ── Stage 1: Interface Configuration ──────────────────
    let ipCli = `\nenable\nconfigure terminal\nhostname ${router.name}\n!\n`;

    // LAN interfaces — FastEthernet0/0, FastEthernet0/1 max
    router.lans.forEach((si, idx) => {
      if (idx > 1) return;
      const s = subnetData[si];
      ipCli += `interface FastEthernet0/${idx}\n`;
      ipCli += `ip address ${s.first} ${s.mask}\n`;
      ipCli += `no shutdown\n!\n`;
    });

    // Serial interfaces
    let serialPortIdx = 0;
    serialLinks.forEach((link, li) => {
      if (link.r1 !== ri && link.r2 !== ri) return;
      const s      = getSerialNet(link);
      const iface  = `Serial0/1/${serialPortIdx++}`;
      const isDCE  = link.r1 === ri;
      const myIp   = isDCE ? s.first : s.second;
      ipCli += `interface ${iface}\n`;
      ipCli += `ip address ${myIp} ${s.mask}\n`;
      if (isDCE) ipCli += `clock rate 64000\n`;
      ipCli += `no shutdown\n!\n`;
    });
    ipCli += `end\n`;

    // ── Stage 2: Routing Protocol ──────────────────────────
    let routeCli = '';

    if (proto === 'static') {
      // ── STATIC — working, kept as-is ──────────────────
      routeCli = `\nenable\nconfigure terminal\n!\n! Static routing for ${router.name}\n!\n`;
      const myNets = new Set();
      router.lans.forEach(si => myNets.add(si));
      serialLinks.forEach(link => {
        if ((link.r1 === ri || link.r2 === ri) && link.netIndex !== -1) myNets.add(link.netIndex);
      });

      subnetData.forEach((s, si) => {
        if (myNets.has(si)) return; // skip directly connected
        // Find owner router of this subnet
        let ownerRouter = -1;
        for (let r = 0; r < routers.length; r++) {
          if (r === ri) continue;
          if (routers[r].lans.includes(si)) { ownerRouter = r; break; }
          if (serialLinks.some(l => (l.r1 === r || l.r2 === r) && l.netIndex === si)) { ownerRouter = r; break; }
        }
        if (ownerRouter === -1) return;
        const li = firstHopLink(topoGraph, ri, ownerRouter);
        if (li === null) return;
        const link    = serialLinks[li];
        const linkNet = getSerialNet(link);
        const gateway = link.r1 === ri ? linkNet.second : linkNet.first;
        routeCli += `ip route ${s.networkId} ${s.mask} ${gateway}\n`;
      });
      routeCli += `end\n`;

    } else if (proto === 'rip') {
      // ── RIP v2 ────────────────────────────────────────
      // Uses subnet networkId (correct with no auto-summary in RIP v2)
      // Advertises exact subnets — works in Packet Tracer
      routeCli = `\nenable\nconfigure terminal\n!\nrouter rip\n version 2\n no auto-summary\n`;
      getRouterNets(ri).forEach(si => {
        routeCli += ` network ${subnetData[si].networkId}\n`;
      });
      routeCli += `!\nend\n`;

    } else if (proto === 'eigrp') {
      // ── EIGRP ─────────────────────────────────────────
      // Advertises LAN networks + BOTH serial link networks
      // per router (subnetData serials and Class A serials).
      // Wildcard masks used for exact interface matching.
      // no auto-summary required for VLSM to work correctly.
      routeCli = `\nenable\nconfigure terminal\n!\n`;
      routeCli += `!EIGRP AS ${eigrpAs} — must match on ALL routers\n`;
      routeCli += `router eigrp ${eigrpAs}\n`;
      routeCli += `no auto-summary\n`;
      getAllRouterNetObjs(ri).forEach(s => {
        const wc = intToIp(wildcardMask(s.maskInt));
        routeCli += `\nnetwork ${s.networkId} ${wc}\n`;
      });
      routeCli += `!\nend\n`;

    } else if (proto === 'ospf') {
      // ── OSPF ──────────────────────────────────────────
      // Advertises LAN networks + BOTH serial link networks
      // per router (subnetData serials and Class A serials).
      // Wildcard masks + area 0 — correct Cisco IOS syntax.
      // Process ID is locally significant (need not match).
      routeCli = `\nenable\nconfigure terminal\n!\n`;
      routeCli += `!OSPF Process ID ${ospfPid} — locally significant\n`;
      routeCli += `router ospf ${ospfPid}\n`;
      getAllRouterNetObjs(ri).forEach(s => {
        const wc = intToIp(wildcardMask(s.maskInt));
        routeCli += `\nnetwork ${s.networkId} ${wc} area 0\n`;
      });
      routeCli += `!\nend\n`;
    }

    // ── Render router block ────────────────────────────
    const block = document.createElement('div');
    block.className = 'router-output';
    block.innerHTML = `
      <div class="router-output-header">
        <span class="router-output-icon">⬡</span>
        <span>${router.name} Configuration</span>
      </div>
      <div class="tab-bar">
        <button class="tab-btn active" onclick="switchTab(this,'ip-${ri}')">
          Stage 1: Interfaces
        </button>
        <button class="tab-btn" onclick="switchTab(this,'route-${ri}')">
          Stage 2: Routing
        </button>
      </div>
      <div id="ip-${ri}" class="tab-content active">
        <div class="code-block" id="code-ip-${ri}">
          <button class="copy-btn" onclick="copyCode('code-ip-${ri}',this)">COPY</button>${escHtml(ipCli)}
        </div>
      </div>
      <div id="route-${ri}" class="tab-content">
        <div class="code-block" id="code-route-${ri}">
          <button class="copy-btn" onclick="copyCode('code-route-${ri}',this)">COPY</button>${escHtml(routeCli)}
        </div>
      </div>`;
    outputsDiv.appendChild(block);
  });

  document.getElementById('cliOutputSection').classList.remove('hidden');
  document.getElementById('cliOutputSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//  UTILITIES
// ============================================================
function switchTab(btn, tabId) {
  const parent = btn.closest('.router-output');
  parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function copyCode(id, btn) {
  const el   = document.getElementById(id);
  const text = el.innerText.replace(/^COPY\n?/, '').replace(/^COPIED!\n?/, '');
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'COPIED!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 2000);
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  buildCheatSheet();
  loadDefaultData();
  setMode('vlsm');
  setProto('static');
});
