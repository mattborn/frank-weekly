const fs = require('fs')

const LEAGUE_ID = '1389707861860319232'
const SEASON = '2026'
const ADP_CSV = '../frank/ref/FantasyPros_2026_Overall_ADP_Rankings.csv'

const norm = s => s.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[.'\-]/g, '').replace(/\s+/g, ' ').trim()
const playerName = p => p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || '?'

const parseCsv = text => {
  const rows = []
  let row = [], field = '', inQuotes = false
  const chars = text.replace(/\r\n/g, '\n')
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (inQuotes) {
      if (c === '"' && chars[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const [header, ...body] = rows.filter(r => r.length > 1 || r[0] !== '')
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])))
}

const fetchJson = async url => {
  const res = await fetch(url)
  return res.json()
}

const DIR = `${__dirname}/sleeper`
const LEAGUE_DIR = `${DIR}/${LEAGUE_ID}`
const pad = n => String(n).padStart(2, '0')
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'))

;(async () => {
  const state = read(`${LEAGUE_DIR}/state.json`)
  const week = state.week - 1
  console.log(`Building report for week ${week}`)

  const league = read(`${LEAGUE_DIR}/league.json`)
  const scoring = league.scoring_settings
  const users = read(`${LEAGUE_DIR}/users.json`)
  const rosters = read(`${LEAGUE_DIR}/rosters.json`)
  const draftPicks = read(`${LEAGUE_DIR}/draft-picks.json`)
  const playersDb = read(`${DIR}/players.json`)
  const matchups = read(`${LEAGUE_DIR}/matchups-${pad(week)}.json`)
  const statsRaw = read(`${DIR}/stats-${pad(week)}.json`)

  // fetch season projections at runtime
  const projsRaw = await fetchJson(`https://api.sleeper.com/projections/nfl/${SEASON}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`)
  const projAvg = {}
  for (const e of projsRaw) {
    const s = e.stats || {}
    if (s.pts_ppr) projAvg[e.player_id] = +(s.pts_ppr / 18).toFixed(1)
  }

  // FP ADP
  const fpAdp = {}
  for (const row of parseCsv(fs.readFileSync(ADP_CSV, 'utf8'))) {
    const name = row['Player (Bye)'].split(/\s{2,}/)[0].trim()
    fpAdp[norm(name)] = parseInt(row.Rank)
  }
  const getFpAdp = pid => {
    const p = playersDb[pid] || {}
    const n = norm(p.full_name || '')
    if (fpAdp[n]) return fpAdp[n]
    if (p.position === 'DEF') {
      const team = (p.team || '').toLowerCase()
      for (const [k, v] of Object.entries(fpAdp)) if (k.split(' ').includes(team)) return v
    }
    return null
  }

  // draft order
  const draftOrder = Object.fromEntries(draftPicks.map(p => [p.player_id, p.pick_no]))

  // collect all rostered player IDs
  const rosteredIds = new Set()
  for (const m of matchups) for (const pid of (m.players || [])) rosteredIds.add(pid)

  // score rostered players using league scoring from stats endpoint
  const statsByPid = {}
  for (const entry of statsRaw) {
    if (rosteredIds.has(entry.player_id)) {
      const s = entry.stats || {}
      statsByPid[entry.player_id] = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
    }
  }
  // supplement from matchup players_points for any rostered player missing from stats
  for (const m of matchups) {
    for (const [pid, pts] of Object.entries(m.players_points || {})) {
      if (rosteredIds.has(pid) && !(pid in statsByPid)) statsByPid[pid] = pts || 0
    }
  }

  // rank only rostered players by points
  const ranked = Object.entries(statsByPid).sort((a, b) => b[1] - a[1])
  const ptsRank = Object.fromEntries(ranked.map(([pid], i) => [pid, i + 1]))

  // user/roster maps
  const userMap = Object.fromEntries(users.map(u => [u.user_id, (u.metadata || {}).team_name || u.display_name]))
  const rosterOwner = Object.fromEntries(rosters.map(r => [r.roster_id, userMap[r.owner_id] || `roster_${r.roster_id}`]))

  // build cards
  const cards = []
  for (const m of matchups) {
    const rid = m.roster_id
    const starters = new Set(m.starters || [])
    const pp = m.players_points || {}
    const players = []
    for (const pid of (m.players || [])) {
      const p = playersDb[pid] || {}
      const pts = pp[pid] || 0
      const pr = ptsRank[pid] || null
      const adp = getFpAdp(pid)
      const pick = draftOrder[pid] || null
      const proj = projAvg[pid] || null
      const vAdp = adp && pr ? adp - pr : null
      const vPick = pick && pr ? pick - pr : null
      players.push({
        adp, name: playerName(p), pick, pos: p.position || '?',
        proj, pts: +pts.toFixed(1), ptsRk: pr, started: starters.has(pid),
        team: p.team || '?', vAdp, vPick
      })
    }
    const SLOT_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 }
    players.sort((a, b) => (a.started === b.started ? (SLOT_ORDER[a.pos] ?? 9) - (SLOT_ORDER[b.pos] ?? 9) || (a.pick || 999) - (b.pick || 999) : a.started ? -1 : 1))
    const sumVAdp = players.reduce((s, p) => s + (p.vAdp || 0), 0)
    const sumVPick = players.reduce((s, p) => s + (p.vPick || 0), 0)
    const totalPts = players.reduce((s, p) => s + p.pts, 0)
    cards.push({ name: rosterOwner[rid], players, rosterId: rid, sumVAdp, sumVPick, totalPts: +totalPts.toFixed(1) })
  }
  cards.sort((a, b) => b.sumVPick - a.sumVPick)

  // perfect lineup — rostered version + all-player version
  const SLOTS = league.roster_positions.filter(p => p !== 'BN')
  const rosteredPlayers = []
  for (const m of matchups) {
    const pp = m.players_points || {}
    for (const [pid, pts] of Object.entries(pp)) {
      const p = playersDb[pid] || {}
      rosteredPlayers.push({ name: playerName(p), owner: rosterOwner[m.roster_id], pick: draftOrder[pid] || null, pid, pos: p.position || '?', pts: pts || 0, team: p.team || '?' })
    }
  }
  const allPlayers = []
  for (const entry of statsRaw) {
    const p = playersDb[entry.player_id] || entry.player || {}
    const pts = Object.entries(entry.stats || {}).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
    const owner = rosteredPlayers.find(r => r.pid === entry.player_id)
    allPlayers.push({ name: playerName(p), owner: owner ? owner.owner : null, pick: draftOrder[entry.player_id] || null, pid: entry.player_id, pos: p.position || '?', pts: +pts.toFixed(1), team: p.team || entry.team || '?' })
  }
  // supplement DEF/K from matchups if missing
  const allPids = new Set(allPlayers.map(p => p.pid))
  for (const rp of rosteredPlayers) {
    if (!allPids.has(rp.pid)) allPlayers.push(rp)
  }
  const buildPerfect = pool => {
    pool.sort((a, b) => b.pts - a.pts)
    const used = new Set()
    const lineup = []
    for (const slot of SLOTS) {
      if (slot === 'FLEX') {
        const pick = pool.find(p => ['RB', 'WR', 'TE'].includes(p.pos) && !used.has(p.pid))
        if (pick) { used.add(pick.pid); lineup.push({ ...pick, slot: 'FLEX' }) }
      } else {
        const pick = pool.find(p => p.pos === slot && !used.has(p.pid))
        if (pick) { used.add(pick.pid); lineup.push({ ...pick, slot }) }
      }
    }
    return lineup
  }
  const perfectLineup = buildPerfect([...rosteredPlayers])
  const perfectLineupAll = buildPerfect([...allPlayers])

  // best waiver — points from players added via transactions
  const transactions = read(`${LEAGUE_DIR}/transactions-${pad(week)}.json`)
  const gameDate = {}
  for (const entry of statsRaw) gameDate[entry.player_id] = entry.date
  const waiverPts = {}
  for (const t of transactions) {
    const adds = t.adds || {}
    for (const [pid, rid] of Object.entries(adds)) {
      const m = matchups.find(m => m.roster_id === rid)
      const pts = (m?.players_points || {})[pid] || 0
      if (pts <= 0) continue
      const owner = rosterOwner[rid]
      let lead = null
      const gd = gameDate[pid]
      if (gd && t.created) {
        const gameMidnight = new Date(gd + 'T00:00:00-06:00')
        lead = Math.floor((gameMidnight - t.created) / 86400000)
        if (lead < 0) lead = 0
      }
      if (!waiverPts[owner]) waiverPts[owner] = []
      waiverPts[owner].push({ lead, name: playerName(playersDb[pid] || {}), pts: +pts.toFixed(1), team: (playersDb[pid] || {}).team || '?' })
    }
  }
  const bestWaiver = Object.entries(waiverPts).map(([owner, players]) => ({
    owner, players, total: +players.reduce((s, p) => s + p.pts, 0).toFixed(1)
  })).sort((a, b) => b.total - a.total)

  // 2025 team fantasy production (weeks 1-14)
  const priorPts = {}
  for (const row of parseCsv(fs.readFileSync(`${__dirname}/../frank/ref/FantasyPros_Fantasy_Football_Points_PPR.csv`, 'utf8'))) {
    const pos = row.POS
    if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue
    const parts = row.PLAYER.trim().split(/\s+/)
    const team = parts[parts.length - 1]
    priorPts[team] = (priorPts[team] || 0) + (parseFloat(row.TTL) || 0)
  }
  const priorRanked = Object.entries(priorPts).sort((a, b) => b[1] - a[1])
  const priorRank = Object.fromEntries(priorRanked.map(([team], i) => [team, i + 1]))

  // NFL team fantasy production
  const teamPts = {}
  const teamPosPts = {}
  for (const entry of statsRaw) {
    const team = entry.team || (entry.player || {}).team
    const pos = (entry.player || {}).position || ''
    if (!team || !['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue
    const s = entry.stats || {}
    const pts = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
    teamPts[team] = (teamPts[team] || 0) + pts
    if (!teamPosPts[team]) teamPosPts[team] = {}
    teamPosPts[team][pos] = (teamPosPts[team][pos] || 0) + pts
  }
  const teamNames = {}
  for (const [pid, p] of Object.entries(playersDb)) {
    if (p.position === 'DEF' && p.team && p.first_name) teamNames[p.team] = `${p.first_name} ${p.last_name}`
  }
  const posAvg = {}
  for (const ppts of Object.values(teamPosPts)) {
    for (const [pos, val] of Object.entries(ppts)) {
      if (!posAvg[pos]) posAvg[pos] = { sum: 0, n: 0 }
      posAvg[pos].sum += val
      posAvg[pos].n++
    }
  }
  for (const pos of Object.keys(posAvg)) posAvg[pos] = posAvg[pos].sum / posAvg[pos].n
  const ALIAS_REV = { JAX: 'JAC' }
  const nflTeams = Object.entries(teamPts).map(([team, pts], _, arr) => {
    const rank = arr.filter(([, p]) => p > pts).length + 1
    const pr = priorRank[ALIAS_REV[team] || team] || priorRank[team] || null
    const ppts = teamPosPts[team] || {}
    const diffs = Object.keys(posAvg).map(pos => [pos, (ppts[pos] || 0) - posAvg[pos]])
    diffs.sort((a, b) => b[1] - a[1])
    const edgeVal = Math.round(diffs[0][1])
    const holeVal = Math.round(diffs.at(-1)[1])
    const edge = `${diffs[0][0]} ${edgeVal >= 0 ? '+' : ''}${edgeVal}`
    const hole = `${diffs.at(-1)[0]} ${holeVal >= 0 ? '+' : ''}${holeVal}`
    const edgeTitle = `${diffs[0][0]}: ${Math.round(ppts[diffs[0][0]] || 0)} pts vs ${Math.round(posAvg[diffs[0][0]])} avg`
    const holeTitle = `${diffs.at(-1)[0]}: ${Math.round(ppts[diffs.at(-1)[0]] || 0)} pts vs ${Math.round(posAvg[diffs.at(-1)[0]])} avg`
    return { abbr: team, edge, edgeTitle, hole, holeTitle, name: teamNames[team] || team, priorRank: pr, pts: +pts.toFixed(1), rank, v2025: pr ? pr - rank : null }
  }).sort((a, b) => b.pts - a.pts)
  const report = { bestWaiver, cards, nflTeams, perfectLineup, perfectLineupAll, rosteredCount: rosteredIds.size, season: SEASON, week }
  const outPath = `${__dirname}/data/sleeper-${LEAGUE_ID}.json`
  fs.mkdirSync(`${__dirname}/data`, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report))
  console.log(`Wrote ${outPath} — ${cards.length} teams, ${rosteredIds.size} rostered players`)
})()
