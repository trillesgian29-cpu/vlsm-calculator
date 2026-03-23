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

'use strict';

/* ============================================================
   1. IP UTILITY FUNCTIONS
   ============================================================ */

function ipToInt(ip) {
  return ip.trim().split('.').reduce((a, v) => (a * 256) + parseInt(v, 10), 0) >>> 0;
}

function intToIp(n) {
  n = n >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

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

const CIDR_TABLE = [
  { cidr: 30, block: 4,        usable: 2,        incr: 4,   mask: '255.255.255.252', octet: '4th' },
  { cidr: 29, block: 8,        usable: 6,        incr: 8,   mask: '255.255.255.248', octet: '4th' },
  { cidr: 28, block: 16,       usable: 14,       incr: 16,  mask: '255.255.255.240', octet: '4th' },
  { cidr: 27, block: 32,       usable: 30,       incr: 32,  mask: '255.255.255.224', octet: '4th' },
  { cidr: 26, block: 64,       usable: 62,       incr: 64,  mask: '255.255.255.192', octet: '4th' },
  { cidr: 25, block: 128,      usable: 126,      incr: 128, mask: '255.255.255.128', octet: '4th' },
  { cidr: 24, block: 256,      usable: 254,      incr: 1,   mask: '255.255.255.0',   octet: '3rd' },
  { cidr: 23, block: 512,      usable: 510,      incr: 2,   mask: '255.255.254.0',   octet: '3rd' },
  { cidr: 22, block: 1024,     usable: 1022,     incr: 4,   mask: '255.255.252.0',   octet: '3rd' },
  { cidr: 21, block: 2048,     usable: 2046,     incr: 8,   mask: '255.255.248.0',   octet: '3rd' },
  { cidr: 20, block: 4096,     usable: 4094,     incr: 16,  mask: '255.255.240.0',   octet: '3rd' },
  { cidr: 19, block: 8192,     usable: 8190,     incr: 32,  mask: '255.255.224.0',   octet: '3rd' },
  { cidr: 18, block: 16384,    usable: 16382,    incr: 64,  mask: '255.255.192.0',   octet: '3rd' },
  { cidr: 17, block: 32768,    usable: 32766,    incr: 128, mask: '255.255.128.0',   octet: '3rd' },
  { cidr: 16, block: 65536,    usable: 65534,    incr: 1,   mask: '255.255.0.0',     octet: '2nd' },
  { cidr: 15, block: 131072,   usable: 131070,   incr: 2,   mask: '255.254.0.0',     octet: '2nd' },
  { cidr: 14, block: 262144,   usable: 262142,   incr: 4,   mask: '255.252.0.0',     octet: '2nd' },
  { cidr: 13, block: 524288,   usable: 524286,   incr: 8,   mask: '255.248.0.0',     octet: '2nd' },
  { cidr: 12, block: 1048576,  usable: 1048574,  incr: 16,  mask: '255.240.0.0',     octet: '2nd' },
  { cidr: 11, block: 2097152,  usable: 2097150,  incr: 32,  mask: '255.224.0.0',     octet: '2nd' },
  { cidr: 10, block: 4194304,  usable: 4194302,  incr: 64,  mask: '255.192.0.0',     octet: '2nd' },
  { cidr:  9, block: 8388608,  usable: 8388606,  incr: 128, mask: '255.128.0.0',     octet: '2nd' },
  { cidr:  8, block: 16777216, usable: 16777214, incr: 1,   mask: '255.0.0.0',       octet: '1st' },
];

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
    const tr = document.createElement('tr');
    tr.className = 'row-lan';
    tr.innerHTML = `
      <td>${rowNum}</td>
      <td><span class="td-badge badge-lan">LAN</span></td>
      <td class="td-mono">${s.label}</td>
      <td>${s.hostsReq.toLocaleString()}</td>
      <td>${s.usable.toLocaleString()}</td>
      <td class="td-cidr">/${s.cidr}</td>
      <td>${s.octet}</td>
      <td>${s.incr}</td>
      <td class="td-net">${s.netAddr}</td>
      <td class="td-mask">${s.mask}</td>
      <td class="td-mono">${s.firstIP}</td>
      <td class="td-mono">${s.lastIP}</td>
      <td class="td-mono">${s.broadcast}</td>`;
    body.appendChild(tr);
  });

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
    });
    html += '</tr>';
  });

  html += '</table></body></html>';
  dlBlob('\uFEFF' + html, 'application/vnd.ms-excel;charset=utf-8',
    `VLSM_Table_${base.replace(/\./g, '_')}.xls`);
}

function dlBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ============================================================
   14. INITIALISATION
   ============================================================ */

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
});
