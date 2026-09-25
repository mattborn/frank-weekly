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

const fetchJson = async url => (await fetch(url)).json()
const DIR = `${__dirname}/sleeper`
const LEAGUE_DIR = `${DIR}/${LEAGUE_ID}`
const pad = n => String(n).padStart(2, '0')
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const SLOT_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5 }

;(async () => {
  const state = read(`${LEAGUE_DIR}/state.json`)
  const week = parseInt(process.argv[2]) || state.week - 1
  console.log(`Building week ${week}`)

  const league = read(`${LEAGUE_DIR}/league.json`)
  const scoring = league.scoring_settings
  const users = read(`${LEAGUE_DIR}/users.json`)
  const rosters = read(`${LEAGUE_DIR}/rosters.json`)
  const draftPicks = read(`${LEAGUE_DIR}/draft-picks.json`)
  const playersDb = read(`${DIR}/players.json`)
  const SLOTS = league.roster_positions.filter(p => p !== 'BN')

  // static lookups
  const draftOrder = Object.fromEntries(draftPicks.map(p => [p.player_id, p.pick_no]))
  const userMap = Object.fromEntries(users.map(u => [u.user_id, (u.metadata || {}).team_name || u.display_name]))
  const rosterOwner = Object.fromEntries(rosters.map(r => [r.roster_id, userMap[r.owner_id] || `roster_${r.roster_id}`]))

  const projsRaw = await fetchJson(`https://api.sleeper.com/projections/nfl/${SEASON}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF`)
  const projAvg = {}
  for (const e of projsRaw) {
    const s = e.stats || {}
    if (s.pts_ppr) projAvg[e.player_id] = +(s.pts_ppr / 18).toFixed(1)
  }

  const fpAdp = {}
  for (const row of parseCsv(fs.readFileSync(ADP_CSV, 'utf8'))) {
    fpAdp[norm(row['Player (Bye)'].split(/\s{2,}/)[0].trim())] = parseInt(row.Rank)
  }
  const getFpAdp = pid => {
    const p = playersDb[pid] || {}
    if (fpAdp[norm(p.full_name || '')]) return fpAdp[norm(p.full_name || '')]
    if (p.position === 'DEF') {
      const team = (p.team || '').toLowerCase()
      for (const [k, v] of Object.entries(fpAdp)) if (k.split(' ').includes(team)) return v
    }
    return null
  }

  const priorPts = {}
  for (const row of parseCsv(fs.readFileSync(`${__dirname}/../frank/ref/FantasyPros_Fantasy_Football_Points_PPR.csv`, 'utf8'))) {
    if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(row.POS)) continue
    const parts = row.PLAYER.trim().split(/\s+/)
    priorPts[parts.at(-1)] = (priorPts[parts.at(-1)] || 0) + (parseFloat(row.TTL) || 0)
  }
  const priorRank = Object.fromEntries(Object.entries(priorPts).sort((a, b) => b[1] - a[1]).map(([t], i) => [t, i + 1]))

  const teamNames = {}
  for (const [, p] of Object.entries(playersDb)) {
    if (p.position === 'DEF' && p.team && p.first_name) teamNames[p.team] = `${p.first_name} ${p.last_name}`
  }
  const ALIAS_REV = { JAX: 'JAC' }

  // load current week data
  const matchups = read(`${LEAGUE_DIR}/matchups-${pad(week)}.json`)
  const statsRaw = read(`${DIR}/stats-${pad(week)}.json`)

  // load all weeks 1..week for cumulative
  const seasonStats = {}
  const cumRosterPts = {}
  const seasonRosteredIds = new Set()
  for (const r of rosters) for (const pid of (r.players || [])) seasonRosteredIds.add(pid)
  for (let w = 1; w <= week; w++) {
    const wm = read(`${LEAGUE_DIR}/matchups-${pad(w)}.json`)
    const ws = read(`${DIR}/stats-${pad(w)}.json`)
    for (const m of wm) {
      for (const pid of (m.players || [])) seasonRosteredIds.add(pid)
      for (const [pid, pts] of Object.entries(m.players_points || {})) {
        seasonStats[pid] = (seasonStats[pid] || 0) + (pts || 0)
      }
      cumRosterPts[m.roster_id] = (cumRosterPts[m.roster_id] || 0) + Object.values(m.players_points || {}).reduce((s, v) => s + (v || 0), 0)
    }
    for (const entry of ws) {
      const s = entry.stats || {}
      const pts = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
      if (!seasonStats[entry.player_id]) seasonStats[entry.player_id] = 0
      // only add if not already counted from matchups (avoid double-counting rostered players)
      if (!seasonRosteredIds.has(entry.player_id)) seasonStats[entry.player_id] += pts
    }
  }

  // helper: score + rank a set of player IDs from a stats source
  const scoreAndRank = (statsSource, rosterIds) => {
    const scored = {}
    for (const [pid, pts] of Object.entries(statsSource)) {
      if (rosterIds.has(pid)) scored[pid] = pts
    }
    const ranked = Object.entries(scored).sort((a, b) => b[1] - a[1])
    return Object.fromEntries(ranked.map(([pid], i) => [pid, i + 1]))
  }

  // weekly rostered IDs and stats
  const weekRosteredIds = new Set()
  const weekStats = {}
  for (const m of matchups) {
    for (const pid of (m.players || [])) weekRosteredIds.add(pid)
    for (const [pid, pts] of Object.entries(m.players_points || {})) {
      weekStats[pid] = (weekStats[pid] || 0) + (pts || 0)
    }
  }
  for (const entry of statsRaw) {
    const s = entry.stats || {}
    const pts = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
    if (!weekStats[entry.player_id]) weekStats[entry.player_id] = 0
    if (!weekRosteredIds.has(entry.player_id)) weekStats[entry.player_id] += pts
  }

  const seasonRank = scoreAndRank(seasonStats, seasonRosteredIds)
  const weekRank = scoreAndRank(weekStats, weekRosteredIds)

  // build roster cards with both cumulative and weekly data
  const cards = []
  for (const m of matchups) {
    const rid = m.roster_id
    const starters = new Set(m.starters || [])
    const pp = m.players_points || {}
    const players = []
    for (const pid of (m.players || [])) {
      const p = playersDb[pid] || {}
      const wkPts = pp[pid] || 0
      const seasonPts = seasonStats[pid] || 0
      const wkRk = weekRank[pid] || null
      const cRk = seasonRank[pid] || null
      const adp = getFpAdp(pid)
      const pick = draftOrder[pid] || null
      const proj = projAvg[pid] || null
      players.push({
        adp, seasonPts: +seasonPts.toFixed(1), seasonRk: cRk, name: playerName(p), pick, pos: p.position || '?',
        proj, pts: +wkPts.toFixed(1), ptsRk: wkRk, started: starters.has(pid),
        team: p.team || '?', vAdp: adp && cRk ? adp - cRk : null, vPick: pick && cRk ? pick - cRk : null,
        wkVPick: pick && wkRk ? pick - wkRk : null
      })
    }
    players.sort((a, b) => (a.started === b.started ? (SLOT_ORDER[a.pos] ?? 9) - (SLOT_ORDER[b.pos] ?? 9) || (a.pick || 999) - (b.pick || 999) : a.started ? -1 : 1))
    const sumVPick = players.reduce((s, p) => s + (p.vPick || 0), 0)
    const weekPts = players.reduce((s, p) => s + p.pts, 0)
    const seasonPts = players.reduce((s, p) => s + p.seasonPts, 0)
    cards.push({ seasonPts: +seasonPts.toFixed(1), name: rosterOwner[rid], players, rosterId: rid, sumVPick, weekPts: +weekPts.toFixed(1) })
  }
  cards.sort((a, b) => b.sumVPick - a.sumVPick)

  // perfect lineup (week only)
  const rosteredPlayers = []
  for (const m of matchups) {
    for (const [pid, pts] of Object.entries(m.players_points || {})) {
      const p = playersDb[pid] || {}
      rosteredPlayers.push({ name: playerName(p), owner: rosterOwner[m.roster_id], pick: draftOrder[pid] || null, pid, pos: p.position || '?', pts: pts || 0, team: p.team || '?' })
    }
  }
  const allPlayers = []
  for (const entry of statsRaw) {
    const p = playersDb[entry.player_id] || entry.player || {}
    const pts = Object.entries(entry.stats || {}).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
    const owner = rosteredPlayers.find(r => r.pid === entry.player_id)
    allPlayers.push({ name: playerName(p), owner: owner?.owner || null, pick: draftOrder[entry.player_id] || null, pid: entry.player_id, pos: p.position || '?', pts: +pts.toFixed(1), team: p.team || entry.team || '?' })
  }
  const allPids = new Set(allPlayers.map(p => p.pid))
  for (const rp of rosteredPlayers) { if (!allPids.has(rp.pid)) allPlayers.push(rp) }
  const buildPerfect = pool => {
    pool.sort((a, b) => b.pts - a.pts)
    const used = new Set()
    return SLOTS.map(slot => {
      const match = slot === 'FLEX'
        ? pool.find(p => ['RB', 'WR', 'TE'].includes(p.pos) && !used.has(p.pid))
        : pool.find(p => p.pos === slot && !used.has(p.pid))
      if (match) { used.add(match.pid); return { ...match, slot } }
      return null
    }).filter(Boolean)
  }
  const perfectLineup = buildPerfect([...rosteredPlayers])
  const perfectLineupAll = buildPerfect([...allPlayers])

  // best waiver (week only)
  const transactions = read(`${LEAGUE_DIR}/transactions-${pad(week)}.json`)
  const gameDate = {}
  for (const entry of statsRaw) gameDate[entry.player_id] = entry.date
  const bestWaiver = []
  for (const t of transactions) {
    for (const [pid, rid] of Object.entries(t.adds || {})) {
      const m = matchups.find(m => m.roster_id === rid)
      const pts = (m?.players_points || {})[pid] || 0
      if (pts <= 0) continue
      let lead = null
      const gd = gameDate[pid]
      if (gd && t.created) {
        lead = Math.floor((new Date(gd + 'T00:00:00-06:00') - t.created) / 86400000)
        if (lead < 0) lead = 0
      }
      bestWaiver.push({ lead, name: playerName(playersDb[pid] || {}), owner: rosterOwner[rid], pts: +pts.toFixed(1), team: (playersDb[pid] || {}).team || '?' })
    }
  }
  bestWaiver.sort((a, b) => b.pts - a.pts)

  // NFL teams (cumulative + weekly)
  const buildTeams = statsSource => {
    const teamPts = {}, teamPosPts = {}
    for (const [pid, pts] of Object.entries(statsSource)) {
      const p = playersDb[pid] || {}
      const pos = p.position || ''
      const team = p.team
      if (!team || !['QB', 'RB', 'WR', 'TE', 'K'].includes(pos)) continue
      teamPts[team] = (teamPts[team] || 0) + pts
      if (!teamPosPts[team]) teamPosPts[team] = {}
      teamPosPts[team][pos] = (teamPosPts[team][pos] || 0) + pts
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
    return Object.entries(teamPts).map(([team, pts], _, arr) => {
      const rank = arr.filter(([, p]) => p > pts).length + 1
      const pr = priorRank[ALIAS_REV[team] || team] || priorRank[team] || null
      const ppts = teamPosPts[team] || {}
      const diffs = Object.keys(posAvg).map(pos => [pos, (ppts[pos] || 0) - posAvg[pos]]).sort((a, b) => b[1] - a[1])
      const edgeVal = Math.round(diffs[0][1]), holeVal = Math.round(diffs.at(-1)[1])
      return {
        abbr: team,
        edge: `${diffs[0][0]} ${edgeVal >= 0 ? '+' : ''}${edgeVal}`,
        edgeTitle: `${diffs[0][0]}: ${Math.round(ppts[diffs[0][0]] || 0)} pts vs ${Math.round(posAvg[diffs[0][0]])} avg`,
        hole: `${diffs.at(-1)[0]} ${holeVal >= 0 ? '+' : ''}${holeVal}`,
        holeTitle: `${diffs.at(-1)[0]}: ${Math.round(ppts[diffs.at(-1)[0]] || 0)} pts vs ${Math.round(posAvg[diffs.at(-1)[0]])} avg`,
        name: teamNames[team] || team, priorRank: pr, pts: +pts.toFixed(1), rank, v2025: pr ? pr - rank : null
      }
    }).sort((a, b) => b.pts - a.pts)
  }

  // for cumulative NFL teams, build a full stats map from all players across all weeks
  const seasonAllStats = {}
  for (let w = 1; w <= week; w++) {
    for (const entry of read(`${DIR}/stats-${pad(w)}.json`)) {
      const s = entry.stats || {}
      const pts = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
      seasonAllStats[entry.player_id] = (seasonAllStats[entry.player_id] || 0) + pts
    }
  }
  const weekAllStats = {}
  for (const entry of statsRaw) {
    const s = entry.stats || {}
    weekAllStats[entry.player_id] = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
  }

  let prevRank = {}
  if (week > 1) {
    const prevStats = {}
    for (let w = 1; w < week; w++) {
      for (const entry of read(`${DIR}/stats-${pad(w)}.json`)) {
        const s = entry.stats || {}
        prevStats[entry.player_id] = (prevStats[entry.player_id] || 0) + Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
      }
    }
    prevRank = Object.fromEntries(buildTeams(prevStats).map(t => [t.abbr, t.rank]))
  }
  const addWow = teams => teams.map(t => ({ ...t, wow: prevRank[t.abbr] != null ? prevRank[t.abbr] - t.rank : null }))
  const nflTeams = addWow(buildTeams(seasonAllStats))
  const nflTeamsWeekly = buildTeams(weekAllStats)

  // player table (week only — volume/depth are weekly signals)
  const depthChart = {}
  for (const entry of statsRaw) {
    const p = playersDb[entry.player_id] || entry.player || {}
    const pos = (entry.player || p).position || ''
    const team = entry.team || p.team
    if (!team || !['QB', 'RB', 'WR', 'TE'].includes(pos)) continue
    const s = entry.stats || {}
    const vol = pos === 'QB' ? (s.pass_att || 0) : pos === 'RB' ? (s.rush_att || 0) : (s.rec_tgt || 0)
    const pts = +Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0).toFixed(1)
    const key = `${team}-${pos}`
    if (!depthChart[key]) depthChart[key] = []
    depthChart[key].push({ name: playerName(p), pid: entry.player_id, pos, pts, rostered: seasonRosteredIds.has(entry.player_id), snapPct: s.tm_off_snp ? Math.round(s.off_snp / s.tm_off_snp * 100) : 0, team, vol })
  }
  for (const group of Object.values(depthChart)) {
    group.sort((a, b) => b.vol - a.vol)
    const totalVol = group.reduce((s, p) => s + p.vol, 0)
    group.forEach((p, i) => { p.depth = i + 1; p.volShare = totalVol ? Math.round(p.vol / totalVol * 100) : 0 })
  }
  const signalOf = p => {
    if (p.pos === 'QB') return p.depth === 1 ? 'claim' : 'avoid'
    if (p.depth <= 2 && p.volShare >= 25) return 'claim'
    if (p.depth <= 2 && p.volShare >= 15) return 'gamble'
    if (p.pts > 5 && p.volShare < 15) return 'gamble'
    if (p.depth >= 3) return 'avoid'
    return 'gamble'
  }
  const playerTable = []
  for (const group of Object.values(depthChart)) {
    for (const p of group) {
      if (p.pts <= 0) continue
      playerTable.push({ depth: p.depth, name: p.name, pid: p.pid, pos: p.pos, pts: p.pts, rostered: p.rostered, seasonPts: +(seasonAllStats[p.pid] || 0).toFixed(1), signal: signalOf(p), snapPct: p.snapPct, team: p.team, volShare: p.volShare })
    }
  }
  playerTable.sort((a, b) => b.pts - a.pts)

  // streaming picks — rank defenses by pts allowed per position, cross-ref next week schedule
  const defAllowed = {}
  for (let w = 1; w <= week; w++) {
    for (const entry of read(`${DIR}/stats-${pad(w)}.json`)) {
      const p = entry.player || {}
      const pos = p.position || ''
      if (!['QB', 'TE', 'K'].includes(pos)) continue
      const opp = entry.opponent
      if (!opp) continue
      const s = entry.stats || {}
      const pts = Object.entries(s).reduce((sum, [k, v]) => sum + (scoring[k] || 0) * v, 0)
      if (!defAllowed[opp]) defAllowed[opp] = {}
      defAllowed[opp][pos] = (defAllowed[opp][pos] || 0) + pts
    }
  }
  // DEF streaming: rank offenses by fewest pts (weakest offense = best DEF matchup)
  const offPts = {}
  for (const [pid, pts] of Object.entries(seasonAllStats)) {
    const p = playersDb[pid] || {}
    if (!p.team || !['QB', 'RB', 'WR', 'TE'].includes(p.position || '')) continue
    offPts[p.team] = (offPts[p.team] || 0) + pts
  }

  const defRank = {}
  for (const pos of ['QB', 'TE', 'K']) {
    defRank[pos] = Object.entries(defAllowed).map(([team, ppts]) => [team, ppts[pos] || 0]).sort((a, b) => b[1] - a[1]).map(([team], i) => [team, i + 1])
    defRank[pos] = Object.fromEntries(defRank[pos])
  }
  defRank['DEF'] = Object.fromEntries(Object.entries(offPts).sort((a, b) => a[1] - b[1]).map(([team], i) => [team, i + 1]))

  // next week schedule from projections (fetched at runtime)
  const nextWeek = week + 1
  const nextProjs = await fetchJson(`https://api.sleeper.com/projections/nfl/${SEASON}/${nextWeek}?season_type=regular&position[]=QB&position[]=TE&position[]=K&position[]=DEF`)
  const nextMatchup = {}
  for (const e of nextProjs) {
    if (e.team && e.opponent) nextMatchup[e.player_id] = { opponent: e.opponent, team: e.team }
  }

  const streaming = {}
  for (const pos of ['QB', 'TE', 'K', 'DEF']) {
    const candidates = []
    for (const e of nextProjs) {
      const p = e.player || {}
      if (p.position !== pos) continue
      const opp = e.opponent
      if (!opp) continue
      const rank = defRank[pos]?.[opp]
      if (!rank) continue
      const pid = e.player_id
      const seasonPts = seasonAllStats[pid] || 0
      if (seasonPts <= 0) continue
      candidates.push({
        matchup: `vs ${opp}`,
        matchupRank: rank,
        name: playerName(playersDb[pid] || p),
        pid,
        rostered: seasonRosteredIds.has(pid),
        seasonPts: +seasonPts.toFixed(1),
        team: e.team || p.team || '?'
      })
    }
    candidates.sort((a, b) => a.matchupRank - b.matchupRank || b.seasonPts - a.seasonPts)
    const deduped = []
    const seenTeams = new Set()
    for (const c of candidates) {
      if (seenTeams.has(c.team)) continue
      seenTeams.add(c.team)
      deduped.push(c)
    }
    streaming[pos] = {
      all: deduped.slice(0, 5),
      rostered: deduped.filter(c => c.rostered).slice(0, 5),
      unrostered: deduped.filter(c => !c.rostered).slice(0, 5)
    }
  }

  const report = { bestWaiver, cards, nflTeams, nflTeamsWeekly, perfectLineup, perfectLineupAll, playerTable, rosteredCount: seasonRosteredIds.size, season: SEASON, streaming, week }
  const dataDir = `${__dirname}/data`
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(`${dataDir}/sleeper-${LEAGUE_ID}-${pad(week)}.json`, JSON.stringify(report))
  const weeks = []
  for (let w = 1; w <= week; w++) {
    if (fs.existsSync(`${dataDir}/sleeper-${LEAGUE_ID}-${pad(w)}.json`)) weeks.push(w)
  }
  fs.writeFileSync(`${dataDir}/weeks.json`, JSON.stringify({ league: LEAGUE_ID, weeks }))
  console.log(`Built week ${week} — ${cards.length} teams, ${seasonRosteredIds.size} rostered players`)
})()
