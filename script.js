<<<<<<< HEAD
/* ============================================================
   VLSM / FLSM Calculator + Routing CLI Generator
   script.js
   ============================================================ */
=======
/**
 * VLSM Calculator — script.js
 * ============================================================
 * Accurate, Cisco-valid VLSM + Routing Configuration Generator
 *
 * KEY DESIGN RULES:
 * ─────────────────
 *  1. VLSM: 2^n - 2 >= hosts → CIDR = 32 - n
 *  2. LAN subnets: sequential from base IP, largest first
 *  3. WAN /30 subnets: sequential AFTER all LAN subnets
 *     (placed at end of address space to avoid boundary crossing)
 *  4. Port assignment:
 *       OUT side → Serial0/1/0 → firstIP of /30
 *       IN  side → Serial0/1/1 → lastIP  of /30
 *  5. Static routing: LAN ONLY, farthest → nearest, BFS next-hop
 *  6. RIP: classful major network, one statement per class
 *  7. OSPF: wildcard masks, area 0, passive LAN interface
 *  8. EIGRP: wildcard masks, AS 100, no auto-summary
 *  9. clock rate 64000 on OUT (DCE) serial interfaces
 * ============================================================
 */
>>>>>>> 44bdac3e27f3f5215b30a35eaeff6af6de48c450

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

<<<<<<< HEAD
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
=======
function wildcardOf(mask) {
  return intToIp((~ipToInt(mask)) >>> 0);
}

/**
 * getMajorNetwork — Classful network for RIP
 * Class A (1-126)   → a.0.0.0
 * Class B (128-191) → a.b.0.0
 * Class C (192-223) → a.b.c.0
 */
function getMajorNetwork(ip) {
  const p = ip.trim().split('.').map(Number);
  const a = p[0], b = p[1], c = p[2];
  if (a >= 1   && a <= 126) return `${a}.0.0.0`;
  if (a >= 128 && a <= 191) return `${a}.${b}.0.0`;
  if (a >= 192 && a <= 223) return `${a}.${b}.${c}.0`;
  return null;
}

function getMajorLastInt(ip) {
  const n = ipToInt(ip);
  const a = (n >>> 24) & 255, b = (n >>> 16) & 255, c = (n >>> 8) & 255;
  if (a >= 1   && a <= 126) return ((a << 24) | 0x00FFFFFF) >>> 0;
  if (a >= 128 && a <= 191) return ((a << 24) | (b << 16) | 0x0000FFFF) >>> 0;
  return ((a << 24) | (b << 16) | (c << 8) | 0xFF) >>> 0;
}

function getMajorClass(ip) {
  const a = (ipToInt(ip) >>> 24) & 255;
  if (a >= 1   && a <= 126) return 'A';
  if (a >= 128 && a <= 191) return 'B';
  return 'C';
}

/* ============================================================
   2. CIDR TABLE
   Formula: 2^n - 2 >= hosts → CIDR = 32 - n
   ============================================================ */
>>>>>>> 44bdac3e27f3f5215b30a35eaeff6af6de48c450

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

<<<<<<< HEAD
function buildCheatSheet() {
  const tbody = document.getElementById('cheatTbody');
  if (!tbody) return;
  CHEAT_ROWS.forEach(r => {
=======
const CIDR_30 = CIDR_TABLE[0]; // /30

function findCidr(hosts) {
  for (const e of CIDR_TABLE) if (e.usable >= hosts) return e;
  return null;
}

/* ============================================================
   3. HOST INPUT BOX MANAGEMENT
   ============================================================ */

let hostIdSeq = 0;

function addHostBox(val = '') {
  const wrap = document.getElementById('hostBoxes');
  const id   = ++hostIdSeq;
  const n    = wrap.querySelectorAll('.host-box').length + 1;
  const div  = document.createElement('div');
  div.className = 'host-box';
  div.id        = `hb-${id}`;
  div.setAttribute('role', 'listitem');
  div.innerHTML = `
    <span class="host-box-tag">R${n}</span>
    <input type="number" min="1" placeholder="Hosts" value="${val}"
           aria-label="Router ${n} hosts" oninput="updateWanPreview()">
    <button class="host-box-rm" onclick="removeHostBox(${id})"
            title="Remove" aria-label="Remove Router ${n}">✕</button>`;
  wrap.insertBefore(div, wrap.querySelector('.btn-add'));
  renumberHostBoxes();
  updateWanPreview();
}

function removeHostBox(id) {
  document.getElementById(`hb-${id}`)?.remove();
  renumberHostBoxes();
  updateWanPreview();
}

function renumberHostBoxes() {
  document.querySelectorAll('#hostBoxes .host-box').forEach((b, i) => {
    b.querySelector('.host-box-tag').textContent = `R${i + 1}`;
  });
}

function getRouterCount() {
  return document.querySelectorAll('#hostBoxes .host-box').length;
}

function getHostInputs() {
  return Array.from(document.querySelectorAll('#hostBoxes .host-box'))
    .map((box, i) => ({
      h:    parseInt(box.querySelector('input').value, 10),
      rIdx: i,
    }))
    .filter(({ h }) => !isNaN(h) && h > 0);
}

/* ============================================================
   4. TOPOLOGY SELECTION & WAN LINK GENERATION
   ============================================================ */

let selectedTopo = 'bus';

function selectTopo(topo) {
  selectedTopo = topo;
  ['bus', 'ring'].forEach(t => {
    const c = document.getElementById(`topo-${t}`);
    if (!c) return;
    c.classList.toggle('active', t === topo);
    c.setAttribute('aria-checked', t === topo ? 'true' : 'false');
  });
  updateWanPreview();
}

/**
 * generateWANLinks — ordered directional WAN link list
 * Bus:  R1→R2, R2→R3, ..., R(N-1)→RN       (N-1 links)
 * Ring: R1→R2, R2→R3, ..., RN→R1           (N links)
 * r0 = OUT side, r1 = IN side
 */
function generateWANLinks(n, topo) {
  const links = [];
  for (let i = 0; i < n - 1; i++) {
    links.push({ label: `R${i + 1}-R${i + 2}`, r0: i, r1: i + 1 });
  }
  if (topo === 'ring' && n > 2) {
    links.push({ label: `R${n}-R1`, r0: n - 1, r1: 0 });
  }
  return links;
}

function updateWanPreview() {
  const n       = getRouterCount();
  const preview = document.getElementById('wanPreview');
  const info    = document.getElementById('topoInfo');
  if (!preview || !info) return;

  if (n < 2) {
    preview.classList.add('hidden');
    info.classList.add('hidden');
    return;
  }

  const links     = generateWANLinks(n, selectedTopo);
  const topoLabel = selectedTopo === 'ring' ? 'Ring' : 'Bus/Linear';

  preview.classList.remove('hidden');
  preview.style.display = 'block';
  document.getElementById('wanTags').innerHTML =
    links.map(l => `<span class="wan-tag">🔗 ${l.label} Link</span>`).join('');

  info.classList.remove('hidden');
  info.innerHTML = `Topology: <b>${topoLabel}</b> · ${n} routers → <b>${links.length} /30 WAN links</b>`;
}

/* ============================================================
   5. CORE VLSM CALCULATION
   ============================================================
   ALLOCATION STRATEGY:
   - LAN subnets: sequential from baseIP, sorted largest→smallest
   - WAN /30s: sequential AFTER all LAN subnets
   - If LAN subnets would cross the major network boundary,
     show clear error with recommendation
   ============================================================ */

let vlsmData      = [];
let lanSubnets    = [];
let serialSubnets = [];
let topoUsed      = '';
let currentProto  = '';

function calculate() {
  const errEl = document.getElementById('error');
  errEl.textContent = '';

  const baseStr = document.getElementById('base').value.trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(baseStr)) {
    showError('Invalid base IP. Use format: x.x.x.x'); return;
  }

  const inputs = getHostInputs();
  if (!inputs.length) {
    showError('Add at least one router with a host count.'); return;
  }

  vlsmData = []; lanSubnets = []; serialSubnets = [];
  topoUsed = selectedTopo;

  const n        = inputs.length;
  const wanLinks = generateWANLinks(n, selectedTopo);

  // Sort descending — VLSM: largest subnet first
  const sorted = [...inputs].sort((a, b) => b.h - a.h);

  const baseInt     = ipToInt(baseStr);
  const majorLast   = getMajorLastInt(baseStr);
  const majorSize   = (majorLast - baseInt + 1) >>> 0;
  const majorClass  = getMajorClass(baseStr);
  const majorNet    = getMajorNetwork(baseStr);

  // Pre-check: total address space needed
  let lanTotal = 0;
  for (const { h } of sorted) {
    const e = findCidr(h);
    if (!e) { showError(`No CIDR for ${h} hosts. Value too large.`); return; }
    lanTotal += e.block;
  }
  const wanTotal = wanLinks.length * 4;

  if (lanTotal + wanTotal > majorSize) {
    const suggest = majorClass === 'C'
      ? '172.16.0.0 (Class B, 65534 hosts)'
      : majorClass === 'B'
      ? '10.0.0.0 (Class A, 16M addresses)'
      : '10.0.0.0 (Class A)';
    showError(
      `Not enough space in ${majorNet} (Class ${majorClass}, ${majorSize.toLocaleString()} addresses). ` +
      `Need ${(lanTotal + wanTotal).toLocaleString()}. Try: ${suggest}.`
    );
    return;
  }

  // ── LAN allocation — sequential from baseIP ─────────
  let cursor = baseInt;

  for (const { h, rIdx } of sorted) {
    const e      = findCidr(h);
    const net    = cursor >>> 0;
    const bcast  = (net + e.block - 1) >>> 0;
    const first  = (net + 1) >>> 0;
    const last   = (bcast - 1) >>> 0;

    lanSubnets.push({
      type: 'lan', routerIdx: rIdx,
      label: `R${rIdx + 1} LAN`,
      hostsReq: h, cidr: e.cidr, usable: e.usable,
      octet: e.octet, incr: e.incr,
      netAddr: intToIp(net), netInt: net,
      mask: e.mask,
      firstIP: intToIp(first), firstInt: first,
      lastIP:  intToIp(last),  lastInt:  last,
      broadcast: intToIp(bcast), bcastInt: bcast,
      block: e.block,
    });
    cursor = (bcast + 1) >>> 0;
  }

  // Sort LAN by router order
  lanSubnets.sort((a, b) => a.routerIdx - b.routerIdx);
  vlsmData.push(...lanSubnets);

  // ── WAN /30 allocation — sequential after LAN ───────
  // cursor now points right after last LAN subnet
  for (let i = 0; i < wanLinks.length; i++) {
    const wl    = wanLinks[i];
    const net   = cursor >>> 0;
    const bcast = (net + 4 - 1) >>> 0;
    const first = (net + 1) >>> 0; // OUT side
    const last  = (bcast - 1) >>> 0; // IN side

    const ser = {
      type: 'wan',
      label: `${wl.label} Link`,
      r0idx: wl.r0, r1idx: wl.r1,
      hostsReq: 2, cidr: 30, usable: 2,
      octet: '4th', incr: 4,
      netAddr: intToIp(net), netInt: net,
      mask: CIDR_30.mask,
      firstIP: intToIp(first), firstInt: first, // OUT
      lastIP:  intToIp(last),  lastInt:  last,  // IN
      broadcast: intToIp(bcast), bcastInt: bcast,
      block: 4,
    };
    serialSubnets.push(ser);
    vlsmData.push(ser);
    cursor = (bcast + 1) >>> 0;
  }

  renderTable(cursor);

  document.getElementById('tableCard')?.classList.remove('hidden');
  document.getElementById('routingCard')?.classList.remove('hidden');
  document.getElementById('cliPanel')?.classList.add('hidden');
  ['static', 'rip', 'ospf', 'eigrp'].forEach(p =>
    document.getElementById(`pb-${p}`)?.classList.remove('active')
  );

  setTimeout(() =>
    document.getElementById('tableCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    60
  );
}

function clearAll() {
  vlsmData = []; lanSubnets = []; serialSubnets = [];
  ['vlsmBody', 'cliBlocks', 'summaryRow'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  const errEl = document.getElementById('error');
  if (errEl) errEl.textContent = '';
  ['tableCard', 'routingCard', 'cliPanel'].forEach(id =>
    document.getElementById(id)?.classList.add('hidden')
  );
  ['static', 'rip', 'ospf', 'eigrp'].forEach(p =>
    document.getElementById(`pb-${p}`)?.classList.remove('active')
  );
}

function showError(msg) {
  const el = document.getElementById('error');
  if (el) el.innerHTML = `<span>⚠</span><span>${msg}</span>`;
}

/* ============================================================
   6. TABLE RENDERER
   ============================================================ */

function renderTable(nextFreeInt) {
  const body = document.getElementById('vlsmBody');
  if (!body) return;
  body.innerHTML = '';
  let rowNum = 0;

  // LAN rows — sorted largest first
  [...lanSubnets].sort((a, b) => b.hostsReq - a.hostsReq).forEach(s => {
    rowNum++;
>>>>>>> 44bdac3e27f3f5215b30a35eaeff6af6de48c450
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono muted">${r.bin}</td>
      <td class="mono">${r.hosts.toLocaleString()}</td>
      <td class="mono green bold">${r.inc}</td>
      <td class="mono blue bold">${r.cidr}</td>
      <td class="mono">${r.mask}</td>`;
    tbody.appendChild(tr);
  });
<<<<<<< HEAD
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
=======

  // WAN /30 rows
  serialSubnets.forEach(s => {
    rowNum++;
    const tr = document.createElement('tr');
    tr.className = 'row-wan';
    tr.innerHTML = `
      <td>${rowNum}</td>
      <td><span class="td-badge badge-wan">WAN</span></td>
      <td class="td-mono">${s.label}</td>
      <td>2</td><td>2</td>
      <td class="td-cidr">/30</td>
      <td>4th</td><td>4</td>
      <td class="td-wan-net">${s.netAddr}</td>
      <td class="td-mask">${s.mask}</td>
      <td class="td-mono">${s.firstIP} <small style="color:#6e7681">(OUT·R${s.r0idx+1} S0/1/0)</small></td>
      <td class="td-mono">${s.lastIP}  <small style="color:#6e7681">(IN·R${s.r1idx+1} S0/1/1)</small></td>
      <td class="td-mono">${s.broadcast}</td>`;
    body.appendChild(tr);
  });

  const total    = lanSubnets.reduce((s, r) => s + r.hostsReq, 0);
  const topo     = topoUsed === 'ring' ? 'Ring' : 'Bus/Linear';
  const majorNet = getMajorNetwork(intToIp(ipToInt(document.getElementById('base').value.trim())));

  document.getElementById('tableSubtitle').textContent =
    `${lanSubnets.length} LAN · ${serialSubnets.length} WAN /30 · ${topo} Topology · Major: ${majorNet}`;

  document.getElementById('summaryRow').innerHTML = `
    <div class="s-chip"><span class="s-chip-label">Routers</span>       <span class="s-chip-val">${lanSubnets.length}</span></div>
    <div class="s-chip"><span class="s-chip-label">LAN Subnets</span>   <span class="s-chip-val">${lanSubnets.length}</span></div>
    <div class="s-chip"><span class="s-chip-label">WAN /30 Links</span> <span class="s-chip-val">${serialSubnets.length}</span></div>
    <div class="s-chip"><span class="s-chip-label">Topology</span>      <span class="s-chip-val">${topo}</span></div>
    <div class="s-chip"><span class="s-chip-label">Total Hosts</span>   <span class="s-chip-val">${total.toLocaleString()}</span></div>
    <div class="s-chip"><span class="s-chip-label">Next Free</span>     <span class="s-chip-val">${intToIp(nextFreeInt)}</span></div>
    <div class="s-chip"><span class="s-chip-label">RIP Network</span>   <span class="s-chip-val">${majorNet || '—'}</span></div>
  `;
}

/* ============================================================
   7. ROUTER OBJECT BUILDER
   ============================================================
   OUT links → Serial0/1/0 (1st), Serial0/2/0 (2nd — ring close)
   IN  links → Serial0/1/1 (1st), Serial0/2/1 (2nd — ring close)
   firstIP of /30 → OUT, lastIP → IN
   ============================================================ */

function buildRouters() {
  const routers = lanSubnets.map(lan => ({
    idx:      lan.routerIdx + 1,
    hosts:    lan.hostsReq,
    lan,
    outLinks: [],
    inLinks:  [],
    serials:  [],
  }));

  serialSubnets.forEach(ser => {
    const rOut = routers.find(r => r.idx === ser.r0idx + 1);
    const rIn  = routers.find(r => r.idx === ser.r1idx + 1);

    if (rOut) rOut.outLinks.push({
      sub: ser, dir: 'OUT',
      ip: ser.firstIP, mask: ser.mask,
      peer: ser.lastIP, peerIdx: ser.r1idx + 1,
      label: ser.label,
    });
    if (rIn) rIn.inLinks.push({
      sub: ser, dir: 'IN',
      ip: ser.lastIP, mask: ser.mask,
      peer: ser.firstIP, peerIdx: ser.r0idx + 1,
      label: ser.label,
    });
  });

  routers.forEach(router => {
    // OUT → Serial0/1/0, Serial0/2/0 ...
    router.outLinks.forEach((l, i) => { l.iface = `Serial0/${i + 1}/0`; });
    // IN  → Serial0/1/1, Serial0/2/1 ...
    router.inLinks.forEach((l, i)  => { l.iface = `Serial0/${i + 1}/1`; });
    router.serials = [...router.outLinks, ...router.inLinks];
  });

  return routers;
}

/* ============================================================
   8. VISUAL CONNECTION MAP
   ============================================================ */

function buildConnectionMap(routers, topo) {
  const N   = '\n';
  const SEP = '─'.repeat(56);
  let   out = '';

  out += `CONNECTION MAP — ${topo === 'ring' ? 'Ring' : 'Bus/Linear'} Topology` + N;
  out += SEP + N;
  out += 'OUT side → Serial0/x/0  (first usable IP of /30)' + N;
  out += 'IN  side → Serial0/x/1  (second usable IP of /30)' + N;
  out += 'DCE clock rate 64000 applied on OUT interfaces' + N;
  out += SEP + N + N;

  serialSubnets.forEach((ser, i) => {
    const rOut    = routers.find(r => r.idx === ser.r0idx + 1);
    const rIn     = routers.find(r => r.idx === ser.r1idx + 1);
    if (!rOut || !rIn) return;

    const outLink = rOut.outLinks.find(l => l.sub.netAddr === ser.netAddr);
    const inLink  = rIn.inLinks.find(l  => l.sub.netAddr === ser.netAddr);
    const outIf   = outLink ? outLink.iface : 'Serial0/1/0';
    const inIf    = inLink  ? inLink.iface  : 'Serial0/1/1';

    out += `Link ${i + 1}: ${ser.label}` + N;
    out += `  R${rOut.idx} (${outIf}) OUT ─────── IN (${inIf}) R${rIn.idx}` + N;
    out += `  Network : ${ser.netAddr}/30` + N;
    out += `  OUT IP  : ${ser.firstIP}  → R${rOut.idx} ${outIf} [DCE — clock rate 64000]` + N;
    out += `  IN  IP  : ${ser.lastIP}  → R${rIn.idx} ${inIf}` + N + N;
  });

  out += SEP + N;
  out += 'CHAIN: ';
  lanSubnets.forEach((_, i) => {
    out += `R${i + 1}`;
    if (i < lanSubnets.length - 1) out += ' → ';
  });
  if (topo === 'ring' && lanSubnets.length > 2) out += ' → R1';
  out += N;

  return out;
}

/* ============================================================
   9. NEXT-HOP RESOLVER — BFS
   Returns the correct next-hop IP from router toward targetSub
   ============================================================ */

function resolveNextHop(router, targetSub, routers) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  // Direct adjacency
  for (const link of allLinks) {
    const peer = routers.find(r => r.idx === link.peerIdx);
    if (!peer) continue;
    if (peer.lan.netAddr === targetSub.netAddr) return link.peer;
  }

  // BFS multi-hop
  const visited = new Set([router.idx]);
  const queue   = allLinks.map(l => ({ peerIdx: l.peerIdx, nextHop: l.peer }));

  while (queue.length) {
    const { peerIdx, nextHop } = queue.shift();
    if (visited.has(peerIdx)) continue;
    visited.add(peerIdx);

    const pr = routers.find(r => r.idx === peerIdx);
    if (!pr) continue;
    if (pr.lan.netAddr === targetSub.netAddr) return nextHop;

    [...pr.outLinks, ...pr.inLinks].forEach(l => {
      if (!visited.has(l.peerIdx)) queue.push({ peerIdx: l.peerIdx, nextHop });
    });
  }

  return allLinks.length > 0 ? allLinks[0].peer : null;
}

function bfsHopCount(router, targetSub, routers) {
  const visited = new Set([router.idx]);
  const queue   = [...router.outLinks, ...router.inLinks]
                    .map(l => ({ peerIdx: l.peerIdx, hops: 1 }));
  while (queue.length) {
    const { peerIdx, hops } = queue.shift();
    if (visited.has(peerIdx)) continue;
    visited.add(peerIdx);
    const pr = routers.find(r => r.idx === peerIdx);
    if (!pr) continue;
    if (pr.lan.netAddr === targetSub.netAddr) return hops;
    [...pr.outLinks, ...pr.inLinks].forEach(l => {
      if (!visited.has(l.peerIdx)) queue.push({ peerIdx: l.peerIdx, hops: hops + 1 });
    });
  }
  return 999;
}

function findAlternatePath(router, targetSub, primaryNextHop, routers) {
  const allLinks      = [...router.outLinks, ...router.inLinks];
  const altLinks      = allLinks.filter(l => l.peer !== primaryNextHop);

  for (const link of altLinks) {
    const visited = new Set([router.idx]);
    const queue   = [{ peerIdx: link.peerIdx, nextHop: link.peer }];
    while (queue.length) {
      const { peerIdx, nextHop } = queue.shift();
      if (visited.has(peerIdx)) continue;
      visited.add(peerIdx);
      const pr = routers.find(r => r.idx === peerIdx);
      if (!pr) continue;
      if (pr.lan.netAddr === targetSub.netAddr) return nextHop;
      [...pr.outLinks, ...pr.inLinks].forEach(l => {
        if (!visited.has(l.peerIdx)) queue.push({ peerIdx: l.peerIdx, nextHop });
      });
    }
  }
  return null;
}

/* ============================================================
   10. CISCO IOS CLI BUILDERS
   ============================================================ */

const NL = '\n';

/**
 * Stage 1 — Interface Configuration
 * Rules:
 *  - No leading spaces before commands
 *  - enable + configure terminal
 *  - LAN: FastEthernet0/0
 *  - OUT serial: clock rate 64000 (DCE side)
 *  - IN  serial: no clock rate
 *  - exit after each interface, end at bottom
 */
function buildStage1(router) {
  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;

  // LAN
  c += '!' + NL;
  c += `! LAN — R${router.idx} (${router.hosts.toLocaleString()} hosts)` + NL;
  c += '!' + NL;
  c += 'interface FastEthernet0/0'                                 + NL;
  c += `ip address ${router.lan.firstIP} ${router.lan.mask}`       + NL;
  c += 'no shutdown'                                               + NL;
  c += 'exit'                                                      + NL;

  // OUT serial interfaces — DCE side, needs clock rate
  router.outLinks.forEach(link => {
    c += NL;
    c += '!' + NL;
    c += `! OUT → R${link.peerIdx} | ${link.label} | ${link.iface} [DCE]` + NL;
    c += '!' + NL;
    c += `interface ${link.iface}`                                 + NL;
    c += `ip address ${link.ip} ${link.mask}`                     + NL;
    c += 'clock rate 64000'                                        + NL;
    c += 'no shutdown'                                             + NL;
    c += 'exit'                                                    + NL;
  });

  // IN serial interfaces — DTE side, no clock rate
  router.inLinks.forEach(link => {
    c += NL;
    c += '!' + NL;
    c += `! IN ← R${link.peerIdx} | ${link.label} | ${link.iface} [DTE]` + NL;
    c += '!' + NL;
    c += `interface ${link.iface}`                                 + NL;
    c += `ip address ${link.ip} ${link.mask}`                     + NL;
    c += 'no shutdown'                                             + NL;
    c += 'exit'                                                    + NL;
  });

  c += NL;
  c += 'end' + NL;
  return c;
}

/**
 * Stage 2 — Static Routing
 * Rules:
 *  - Route ONLY to remote LAN networks (NOT WAN /30)
 *  - Next-hop = nearest neighbor toward destination (BFS)
 *  - Sort farthest → nearest
 *  - Ring: primary (AD=1) + floating backup (AD=5)
 *  - No duplicate routes
 */
function buildStatic(router, routers) {
  const myNets = new Set([
    router.lan.netAddr,
    ...router.outLinks.map(l => l.sub.netAddr),
    ...router.inLinks.map(l  => l.sub.netAddr),
  ]);

  // ONLY remote LAN networks — NOT WAN /30 subnets
  const remoteLANs = lanSubnets
    .filter(sub => !myNets.has(sub.netAddr))
    .sort((a, b) => bfsHopCount(router, b, routers) - bfsHopCount(router, a, routers));

  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;
  c += '! Static Routing — remote LAN networks only' + NL;
  c += '! Format: ip route <network> <mask> <next-hop> [AD]' + NL;
  c += NL;

  remoteLANs.forEach(sub => {
    const primaryNH = resolveNextHop(router, sub, routers);
    if (!primaryNH) return;

    c += `ip route ${sub.netAddr} ${sub.mask} ${primaryNH}` + NL;

    // Ring topology: floating backup via alternate path
    if (topoUsed === 'ring') {
      const backupNH = findAlternatePath(router, sub, primaryNH, routers);
      if (backupNH && backupNH !== primaryNH) {
        c += `ip route ${sub.netAddr} ${sub.mask} ${backupNH} 5` + NL;
      }
    }
  });

  c += NL;
  c += 'end' + NL;
  return c;
}

/**
 * Stage 2 — RIP v2
 * Rules:
 *  - Classful major network ONLY (not subnets, not /30)
 *  - One network statement per unique major class
 *  - passive-interface on LAN
 *  - Auto-detect: works for any IP range
 */
function buildRIP(router) {
  const allLinks = [...router.outLinks, ...router.inLinks];
  const allIPs   = [router.lan.firstIP, ...allLinks.map(l => l.ip)];

  const majorNets = new Set();
  allIPs.forEach(ip => {
    const m = getMajorNetwork(ip);
    if (m) majorNets.add(m);
  });

  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;
  c += '! RIP v2 — classful major networks only' + NL;
  c += 'router rip'         + NL;
  c += 'version 2'          + NL;
  c += 'no auto-summary'    + NL;
  majorNets.forEach(net => { c += `network ${net}` + NL; });
  c += 'passive-interface FastEthernet0/0' + NL;
  c += 'exit'               + NL;
  c += NL;
  c += 'end' + NL;
  return c;
}

/**
 * Stage 2 — OSPF
 * Rules:
 *  - Process ID 1 (locally significant)
 *  - Wildcard masks on all network statements
 *  - area 0 for all interfaces
 *  - passive-interface on LAN
 */
function buildOSPF(router) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;
  c += '! OSPF — Process ID 1, Area 0, wildcard masks' + NL;
  c += 'router ospf 1'      + NL;
  c += `network ${router.lan.netAddr} ${wildcardOf(router.lan.mask)} area 0` + NL;
  allLinks.forEach(l => {
    c += `network ${l.sub.netAddr} ${wildcardOf(l.mask)} area 0` + NL;
  });
  c += 'passive-interface FastEthernet0/0' + NL;
  c += 'exit'               + NL;
  c += NL;
  c += 'end' + NL;
  return c;
}

/**
 * Stage 2 — EIGRP
 * Rules:
 *  - AS 100 (must match on ALL routers)
 *  - no auto-summary required
 *  - wildcard masks
 *  - passive-interface on LAN
 */
function buildEIGRP(router) {
  const allLinks = [...router.outLinks, ...router.inLinks];

  let c = '';
  c += 'enable'             + NL;
  c += 'configure terminal' + NL;
  c += NL;
  c += '! EIGRP AS 100 — AS number MUST match on all routers' + NL;
  c += 'router eigrp 100'   + NL;
  c += 'no auto-summary'    + NL;
  c += `network ${router.lan.netAddr} ${wildcardOf(router.lan.mask)}` + NL;
  allLinks.forEach(l => {
    c += `network ${l.sub.netAddr} ${wildcardOf(l.mask)}` + NL;
  });
  c += 'passive-interface FastEthernet0/0' + NL;
  c += 'exit'               + NL;
  c += NL;
  c += 'end' + NL;
  return c;
}

/* ============================================================
   11. CLI RENDERER
   ============================================================ */

const PROTO_NAMES = {
  static: 'Static Routing',
  rip:    'RIP v2',
  ospf:   'OSPF',
  eigrp:  'EIGRP',
};

const PROTO_BADGE_CLASS = {
  static: 'cpb-static',
  rip:    'cpb-rip',
  ospf:   'cpb-ospf',
  eigrp:  'cpb-eigrp',
};

function generateCLI(proto) {
  if (!vlsmData.length) { alert('Please calculate VLSM first.'); return; }

  currentProto = proto;
  ['static', 'rip', 'ospf', 'eigrp'].forEach(p =>
    document.getElementById(`pb-${p}`)?.classList.toggle('active', p === proto)
  );

  const routers  = buildRouters();
  const blocksEl = document.getElementById('cliBlocks');
  if (!blocksEl) return;
  blocksEl.innerHTML = '';

  // Update terminal title
  const titleEl = document.getElementById('cliTitleText');
  if (titleEl) titleEl.textContent = `cisco-ios — ${PROTO_NAMES[proto]} — ${topoUsed} topology`;

  const badgeEl = document.getElementById('cliProtoBadge');
  if (badgeEl) badgeEl.innerHTML =
    `<span class="cli-proto-badge ${PROTO_BADGE_CLASS[proto]}">${PROTO_NAMES[proto]}</span>`;

  // ── Connection Map ────────────────────────────────────
  const mapText  = buildConnectionMap(routers, topoUsed);
  const mapBlock = document.createElement('div');
  mapBlock.className = 'router-block';
  mapBlock._fullCli  = mapText;
  mapBlock._stage1   = mapText;
  mapBlock._stage2   = '';
  mapBlock._label    = 'Connection Map';

  const mapHdr = document.createElement('div');
  mapHdr.className = 'router-block-header';
  mapHdr.innerHTML = `
    <span class="router-block-title">🔗 Connection Map — Port & IP Assignment</span>
    <div class="router-block-btns">
      <button class="cli-btn cli-btn-copy" onclick="copyBlock(this)">⎘ Copy</button>
    </div>`;
  mapBlock.appendChild(mapHdr);

  const mapCode = document.createElement('div');
  mapCode.className = 'cli-code';
  mapCode.style.color = '#60a5fa';
  mapCode.textContent = mapText;
  mapBlock.appendChild(mapCode);
  blocksEl.appendChild(mapBlock);

  // ── Per-router CLI blocks ─────────────────────────────
  routers.forEach(router => {
    const s1 = buildStage1(router);
    let   s2 = '';
    switch (proto) {
      case 'static': s2 = buildStatic(router, routers); break;
      case 'rip':    s2 = buildRIP(router);              break;
      case 'ospf':   s2 = buildOSPF(router);             break;
      case 'eigrp':  s2 = buildEIGRP(router);            break;
    }
    const fullCli = s1 + NL + s2;
    const outP    = router.outLinks.map(l => `${l.iface}→R${l.peerIdx}(${l.ip})`).join(', ') || '—';
    const inP     = router.inLinks.map(l  => `${l.iface}←R${l.peerIdx}(${l.ip})`).join(', ') || '—';
    const title   = `Router ${router.idx} — ${router.hosts.toLocaleString()} Hosts — LAN: ${router.lan.netAddr}/${router.lan.cidr}`;
    const ports   = `OUT: ${outP}  |  IN: ${inP}`;

    appendRouterBlock(blocksEl, title, ports, s1, s2, fullCli, proto);
  });

  document.getElementById('cliPanel')?.classList.remove('hidden');
  setTimeout(() =>
    document.getElementById('cliPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    60
  );
}

function appendRouterBlock(container, title, portInfo, stage1, stage2, fullCli, proto) {
  const block     = document.createElement('div');
  block.className = 'router-block';
  block._fullCli  = fullCli;
  block._stage1   = stage1;
  block._stage2   = stage2;
  block._label    = title;

  const hdr = document.createElement('div');
  hdr.className = 'router-block-header';
  hdr.innerHTML = `
    <div>
      <div class="router-block-title">▶ ${title}</div>
      <div class="router-block-ports">${portInfo}</div>
    </div>
    <div class="router-block-btns">
      <button class="cli-btn cli-btn-copy" onclick="copyStage(this,1)">⎘ Stage 1</button>
      <button class="cli-btn cli-btn-copy" onclick="copyStage(this,2)">⎘ Stage 2</button>
      <button class="cli-btn cli-btn-copy" onclick="copyBlock(this)">⎘ Both</button>
    </div>`;
  block.appendChild(hdr);

  const sl1 = document.createElement('div');
  sl1.className = 'stage-label s1';
  sl1.textContent = '── Stage 1: Interface Configuration';
  block.appendChild(sl1);
  const pre1 = document.createElement('div');
  pre1.className = 'cli-code';
  pre1.textContent = stage1;
  block.appendChild(pre1);

  const sl2 = document.createElement('div');
  sl2.className = 'stage-label s2';
  sl2.textContent = `── Stage 2: ${PROTO_NAMES[proto]} Configuration`;
  block.appendChild(sl2);
  const pre2 = document.createElement('div');
  pre2.className = 'cli-code';
  pre2.textContent = stage2;
  block.appendChild(pre2);

  container.appendChild(block);
}

/* ============================================================
   12. COPY & EXPORT
   ============================================================ */

function copyBlock(btn) {
  const block = btn.closest('.router-block');
  toClipboard(block._fullCli || '', btn);
}
function copyStage(btn, stage) {
  const block = btn.closest('.router-block');
  toClipboard(stage === 1 ? (block._stage1 || '') : (block._stage2 || ''), btn);
}
function copyAllCLI() {
  toClipboard(getAllCLI(), null);
  alert('All CLI copied!');
}
function toClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ Done';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}
function getAllCLI() {
  return Array.from(document.querySelectorAll('#cliBlocks .router-block'))
    .map(b => `! ${'-'.repeat(60)}\n! ${b._label}\n! ${'-'.repeat(60)}\n\n${b._fullCli}`)
    .join('\n');
}
function exportCLI()     { exportCLIText(); }
function exportCLIText() {
  const base = document.getElementById('base').value.trim().replace(/\./g, '_');
  dlBlob(getAllCLI(), 'text/plain', `VLSM_CLI_${currentProto}_${base}.txt`);
}
function exportCLIExcel() {
  const base  = document.getElementById('base').value.trim();
  const lines = [`${base} - VLSM CLI (${PROTO_NAMES[currentProto] || ''})`, '', ' '];
  document.querySelectorAll('#cliBlocks .router-block').forEach(b => {
    lines.push(b._label || '');
    lines.push('--- Stage 1: Interface Configuration ---');
    (b._stage1 || '').split('\n').forEach(l => lines.push('\t' + l));
    lines.push('--- Stage 2: Routing Configuration ---');
    (b._stage2 || '').split('\n').forEach(l => lines.push('\t' + l));
    lines.push('');
  });
  dlBlob('\uFEFF' + lines.join('\n'), 'application/vnd.ms-excel;charset=utf-8',
    `VLSM_CLI_${currentProto}_${base.replace(/\./g, '_')}.xls`);
}

/* ============================================================
   13. EXCEL TABLE EXPORT
   ============================================================ */

function downloadExcel() {
  const rows = document.querySelectorAll('#vlsmTable tr');
  if (rows.length <= 1) { alert('Calculate first.'); return; }

  const base = document.getElementById('base').value.trim();
  const topo = topoUsed === 'ring' ? 'Ring' : 'Bus/Linear';

  let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>VLSM</x:Name></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
body{font-family:Arial;font-size:11pt;}
.title{font-size:14pt;font-weight:bold;color:#1e3a8a;background:#dbeafe;padding:6px 14px;}
.sub{font-size:9pt;color:#555;background:#f0f9ff;padding:4px 14px;}
th{background:#1e40af;color:white;font-weight:bold;padding:8px 16px;border:1px solid #1d4ed8;white-space:nowrap;}
td{padding:7px 16px;border:1px solid #d1d5db;white-space:nowrap;}
.lan-e{background:#eff6ff;}.lan-o{background:#fff;}.wan-r{background:#fffbeb;}
.td-net{font-weight:bold;color:#1e40af;}.td-wan{font-weight:bold;color:#b45309;}
.td-cidr{font-weight:bold;color:#166534;}
</style></head><body>
<table>
<tr><td colspan="13" class="title">${base} — VLSM Routing Table (${topo})</td></tr>
<tr><td colspan="13" class="sub">Generated: ${new Date().toLocaleString()}</td></tr>
<tr><td colspan="13" style="height:4px;"></td></tr>`;

  let lanIdx = 0;
  rows.forEach((r, ri) => {
    if (ri === 0) {
      html += '<tr>';
      r.querySelectorAll('th').forEach(c => { html += `<th>${c.innerText}</th>`; });
      html += '</tr>'; return;
    }
    const isWan = r.classList.contains('row-wan');
    const cls   = isWan ? 'wan-r' : (lanIdx % 2 === 0 ? 'lan-o' : 'lan-e');
    if (!isWan) lanIdx++;
    html += `<tr class="${cls}">`;
    r.querySelectorAll('td').forEach((c, ci) => {
      const ex = ci === 8 ? (isWan ? ' class="td-wan"' : ' class="td-net"')
               : ci === 5 ? ' class="td-cidr"' : '';
      html += `<td${ex}>${c.innerText}</td>`;
>>>>>>> 44bdac3e27f3f5215b30a35eaeff6af6de48c450
    });
    xml += '</row>';
  });
  xml += '</sheetData></worksheet>';
  return xml;
}

<<<<<<< HEAD
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
=======
function dlBlob(content, type, filename) {
  const blob = new Blob([content], { type });
>>>>>>> 44bdac3e27f3f5215b30a35eaeff6af6de48c450
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

<<<<<<< HEAD
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

  // Get all subnet indices (LAN + serial) connected to a router
  function getRouterNets(ri) {
    const nets = new Set(routers[ri].lans);
    serialLinks.forEach(link => {
      if ((link.r1 === ri || link.r2 === ri) && link.netIndex !== -1) nets.add(link.netIndex);
    });
    return [...nets];
  }

  const topoGraph = buildGraph();

  routers.forEach((router, ri) => {
    // ── Stage 1: Interface Configuration ──────────────────
    let ipCli = `enable\nconfigure terminal\nhostname ${router.name}\n!\n`;

    // LAN interfaces — FastEthernet0/0, FastEthernet0/1 max
    router.lans.forEach((si, idx) => {
      if (idx > 1) return;
      const s = subnetData[si];
      ipCli += `interface FastEthernet0/${idx}\n`;
      ipCli += ` ip address ${s.first} ${s.mask}\n`;
      ipCli += ` no shutdown\n!\n`;
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
      ipCli += ` ip address ${myIp} ${s.mask}\n`;
      if (isDCE) ipCli += ` clock rate 64000\n`;
      ipCli += ` no shutdown\n!\n`;
    });
    ipCli += `end\n`;

    // ── Stage 2: Routing Protocol ──────────────────────────
    let routeCli = '';

    if (proto === 'static') {
      // ── STATIC — working, kept as-is ──────────────────
      routeCli = `enable\nconfigure terminal\n!\n! Static routing for ${router.name}\n!\n`;
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
      routeCli = `enable\nconfigure terminal\n!\nrouter rip\n version 2\n no auto-summary\n`;
      getRouterNets(ri).forEach(si => {
        routeCli += ` network ${subnetData[si].networkId}\n`;
      });
      routeCli += `!\nend\n`;

    } else if (proto === 'eigrp') {
      // ── EIGRP — FIXED: added wildcard masks ───────────
      // Without wildcard, EIGRP uses classful matching which
      // can activate on unintended interfaces.
      // With wildcard masks, only the exact subnet is matched.
      routeCli = `enable\nconfigure terminal\n!\nrouter eigrp ${eigrpAs}\n no auto-summary\n`;
      getRouterNets(ri).forEach(si => {
        const s = subnetData[si];
        const wc = intToIp(wildcardMask(s.maskInt));
        routeCli += ` network ${s.networkId} ${wc}\n`;
      });
      routeCli += `!\nend\n`;

    } else if (proto === 'ospf') {
      // ── OSPF — correct, kept as-is ────────────────────
      // Uses wildcard mask and area 0 — correct Cisco IOS syntax
      routeCli = `enable\nconfigure terminal\n!\nrouter ospf ${ospfPid}\n`;
      getRouterNets(ri).forEach(si => {
        const s  = subnetData[si];
        const wc = intToIp(wildcardMask(s.maskInt));
        routeCli += ` network ${s.networkId} ${wc} area 0\n`;
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
=======
window.addEventListener('DOMContentLoaded', () => {
  const wrap   = document.getElementById('hostBoxes');
  if (!wrap) return;

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add';
  addBtn.setAttribute('aria-label', 'Add a new router');
  addBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg> Add Router`;
  addBtn.onclick = () => addHostBox();
  wrap.appendChild(addBtn);

  [25000, 15000, 10000, 500].forEach(v => addHostBox(v));
  selectTopo('bus');
});

// Ctrl+Enter shortcut
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) calculate();
>>>>>>> 44bdac3e27f3f5215b30a35eaeff6af6de48c450
});
