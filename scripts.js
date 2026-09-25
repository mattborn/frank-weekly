const LEAGUE = '1389707861860319232'
const RANK_COLORS = ['#e8a', '#c6f', '#66f', '#48f', '#4cc', '#5a5', '#cc4', '#e93', '#a55', '#864', '#777', '#ccc']
const V2025_THRESHOLDS = [[20, '--green'], [10, '--blue'], [-8, '--orange'], [-16, '--red'], [-1, '--yellow']]
const pad = n => String(n).padStart(2, '0')
const weekCache = {}
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const kid of kids.flat()) typeof kid === 'string' ? node.appendChild(document.createTextNode(kid)) : node.appendChild(kid)
  return node
}

const v2025Color = v => {
  if (v >= 20) return 'var(--green)'
  if (v >= 10) return 'var(--blue)'
  if (v <= -12) return 'var(--red)'
  if (v <= -8) return 'var(--orange)'
  if (v <= -1) return 'var(--yellow)'
  return null
}

const loadWeek = async week => {
  if (!weekCache[week]) weekCache[week] = await (await fetch(`data/sleeper-${LEAGUE}-${pad(week)}.json`)).json()
  renderWeek(weekCache[week])
}

const renderWeek = data => {
  const root = document.getElementById('content')
  root.hidden = false
  root.innerHTML = ''

  const ownerColors = (() => {
    const sorted = [...data.cards].sort((a, b) => b.seasonPts - a.seasonPts)
    return Object.fromEntries(sorted.map((c, i) => [c.name, RANK_COLORS[i] || '']))
  })()

  let scope = 'season'
  const scopeOpts = el('div', { className: 'opts' })
  const buildScope = () => {
    scopeOpts.innerHTML = ''
    for (const [label, val] of [['Season', 'season'], ['This week', 'week']]) {
      const btn = el('button', { textContent: label, className: val === scope ? 'on' : '' })
      btn.onclick = () => { scope = val; renderContent() }
      scopeOpts.appendChild(btn)
    }
  }
  root.appendChild(el('div', { className: 'header' }, el('h2', { textContent: 'Rosters' }), scopeOpts))

  const rankingCards = el('div', { className: 'cards' })
  const showRosters = el('a', { href: '#', textContent: 'Show all rosters', id: 'showRosters' })
  const rostersSection = el('div', { hidden: true })
  const rosterSortOpts = el('div', { className: 'opts' })
  const rosterCards = el('div', { className: 'cards' })
  rostersSection.appendChild(el('div', { className: 'header' }, el('h2', { textContent: 'All rosters' }), rosterSortOpts))
  rostersSection.appendChild(rosterCards)
  showRosters.onclick = e => { e.preventDefault(); rostersSection.hidden = !rostersSection.hidden; showRosters.textContent = rostersSection.hidden ? 'Show all rosters' : 'Hide all rosters' }

  const cardsAfterRosters = el('div', { className: 'cards' })

  root.appendChild(rankingCards)
  root.appendChild(showRosters)
  root.appendChild(rostersSection)
  root.appendChild(cardsAfterRosters)

  const perfectCard = el('div', { className: 'card' })
  const rosteredCheck = el('input', { type: 'checkbox', checked: true })
  perfectCard.appendChild(el('div', { className: 'header' }, el('h2', { textContent: 'Perfect lineup' }), el('label', {}, rosteredCheck, ' Rostered only')))
  const perfectTable = el('table')
  perfectCard.appendChild(perfectTable)
  const renderPerfect = () => {
    const lineup = rosteredCheck.checked ? data.perfectLineup : data.perfectLineupAll
    perfectTable.innerHTML = ''
    const thead = el('thead')
    const hr = el('tr')
    for (const h of ['Slot', 'Player', 'Pos', 'Pick', 'Points', 'Manager']) hr.appendChild(el('th', { textContent: h }))
    thead.appendChild(hr)
    perfectTable.appendChild(thead)
    const tbody = el('tbody')
    let weekPts = 0
    for (const p of lineup) {
      weekPts += p.pts
      const tr = el('tr')
      const vals = [p.slot, p.name, p.pos, p.pick ?? '—', p.pts.toFixed(1), p.owner || '—']
      vals.forEach((v, i) => {
        const td = el('td', { textContent: v })
        if (i === 1) td.title = p.name
        if (i === 5) { td.title = p.owner || ''; if (p.owner) td.style.color = ownerColors[p.owner] || '' }
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    }
    const totalRow = el('tr', { className: 'total' })
    for (const v of ['', '', '', '', weekPts.toFixed(1), '']) totalRow.appendChild(el('td', { textContent: v }))
    tbody.appendChild(totalRow)
    perfectTable.appendChild(tbody)
  }
  rosteredCheck.onchange = renderPerfect
  cardsAfterRosters.appendChild(perfectCard)

  const renderContent = () => {
    buildScope()
    rankingCards.innerHTML = ''
    rosterCards.innerHTML = ''
    rosterSortOpts.innerHTML = ''
    while (cardsAfterRosters.children.length > 1) cardsAfterRosters.removeChild(cardsAfterRosters.lastChild)

    const isSeason = scope === 'season'
    const getPts = card => isSeason ? card.seasonPts : card.weekPts
    const getPlayerPts = p => isSeason ? p.seasonPts : p.pts
    const getPlayerRk = p => isSeason ? p.seasonRk : p.ptsRk
    const getPlayerVPick = p => isSeason ? p.vPick : p.wkVPick

    const rankDiv = el('div', { className: 'card' })
    rankDiv.appendChild(el('h2', { textContent: 'Best roster' }))
    const rankTable = el('table')
    rankDiv.appendChild(rankTable)
    rankingCards.appendChild(rankDiv)
    let rankSort = 'pts'
    const renderRanking = () => {
      rankTable.innerHTML = ''
      const thead = el('thead')
      const hr = el('tr')
      for (const [label, key] of [['#', null], ['Manager', null], ['Roster Points', 'pts'], ['vPick', 'vpick']]) {
        const th = el('th', { textContent: label + (key === rankSort ? ' ▼' : '') })
        if (key) { th.style.cursor = 'pointer'; th.onclick = () => { rankSort = key; renderRanking(); renderRosterCards(key) } }
        hr.appendChild(th)
      }
      thead.appendChild(hr)
      rankTable.appendChild(thead)
      const tbody = el('tbody')
      const sorted = [...data.cards].sort((a, b) => rankSort === 'vpick' ? b.sumVPick - a.sumVPick : getPts(b) - getPts(a))
      sorted.forEach((card, i) => {
        const tr = el('tr')
        const vp = card.sumVPick
        for (const [v, cls] of [[i + 1, ''], [card.name, ''], [getPts(card), ''], [(vp >= 0 ? '+' : '') + vp, vp >= 0 ? 'plus' : 'minus']]) {
          const td = el('td', { textContent: v })
          if (cls) td.className = cls
          if (v === card.name) { td.style.color = RANK_COLORS[i] || ''; td.title = card.name }
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      })
      rankTable.appendChild(tbody)
    }
    renderRanking()

    if (data.bestWaiver.length) {
      const wDiv = el('div', { className: 'card' })
      wDiv.appendChild(el('h2', { textContent: 'Best waiver' }))
      const wTable = el('table')
      const wThead = el('thead')
      const wHr = el('tr')
      for (const h of ['Manager', 'Player', 'Points', 'Timing']) wHr.appendChild(el('th', { textContent: h }))
      wThead.appendChild(wHr)
      wTable.appendChild(wThead)
      const wTbody = el('tbody')
      for (const p of data.bestWaiver) {
        const tr = el('tr')
        const mgr = el('td', { textContent: p.owner })
        mgr.title = p.owner
        mgr.style.color = ownerColors[p.owner] || ''
        tr.appendChild(mgr)
        tr.appendChild(el('td', { textContent: p.name, title: p.name }))
        tr.appendChild(el('td', { textContent: p.pts.toFixed(1) }))
        tr.appendChild(el('td', { textContent: p.lead !== null ? p.lead + (p.lead === 1 ? ' day' : ' days') : '—' }))
        wTbody.appendChild(tr)
      }
      wTable.appendChild(wTbody)
      wDiv.appendChild(wTable)
      rankingCards.appendChild(wDiv)
    }

    const renderRosterCards = sortKey => {
      rosterCards.innerHTML = ''
      const sorted = [...data.cards].sort((a, b) => {
        if (sortKey === 'alpha') return a.name.localeCompare(b.name)
        if (sortKey === 'vpick') return b.sumVPick - a.sumVPick
        return getPts(b) - getPts(a)
      })
      sorted.forEach((card, i) => {
        const div = el('div', { className: 'card' })
        const h2 = el('h2', { textContent: card.name })
        h2.style.color = RANK_COLORS[i] || ''
        div.appendChild(h2)
        const bestPts = Math.max(...data.cards.map(getPts))
        const worstPts = Math.min(...data.cards.map(getPts))
        const bestVP = Math.max(...data.cards.map(c => c.sumVPick))
        const worstVP = Math.min(...data.cards.map(c => c.sumVPick))
        const cardPts = getPts(card)
        const ptsIcon = cardPts === bestPts ? ' ⭐' : cardPts === worstPts ? ' 💩' : ''
        const vpIcon = card.sumVPick === bestVP ? ' ⭐' : card.sumVPick === worstVP ? ' 💩' : ''
        div.appendChild(el('div', { className: 'summary', textContent: `Roster ${cardPts}${ptsIcon} · vPick ${card.sumVPick >= 0 ? '+' : ''}${card.sumVPick}${vpIcon}` }))
        const table = el('table')
        const thead = el('thead')
        const hr = el('tr')
        for (const h of ['Player', 'Pos', 'Team', 'Pick', 'Proj', 'Points', 'Rank', 'vPick']) hr.appendChild(el('th', { textContent: h }))
        thead.appendChild(hr)
        table.appendChild(thead)
        const tbody = el('tbody')
        for (const p of card.players) {
          const tr = el('tr', { className: p.started ? 'starter' : 'bench' })
          const pPts = getPlayerPts(p)
          const pRk = getPlayerRk(p)
          const pVP = getPlayerVPick(p)
          const vals = [p.name, p.pos, p.team, p.pick ?? '—', p.proj ?? '—', pPts.toFixed(1), pRk ?? '—', pVP]
          vals.forEach((v, vi) => {
            const td = el('td')
            if (vi >= 7 && typeof v === 'number') { td.textContent = (v >= 0 ? '+' : '') + v; td.className = v >= 0 ? 'plus' : 'minus' }
            else td.textContent = v === null ? '—' : v
            if (vi === 0) td.title = p.name
            tr.appendChild(td)
          })
          tbody.appendChild(tr)
        }
        table.appendChild(tbody)
        div.appendChild(table)
        rosterCards.appendChild(div)
      })
    }
    for (const [label, val] of [['Alphabetical', 'alpha'], ['Roster Points', 'pts'], ['vPick', 'vpick']]) {
      const btn = el('button', { textContent: label, className: val === 'pts' ? 'on' : '' })
      btn.onclick = () => {
        rosterSortOpts.querySelectorAll('button').forEach(b => b.className = '')
        btn.className = 'on'
        renderRosterCards(val)
      }
      rosterSortOpts.appendChild(btn)
    }
    renderRosterCards('pts')

    const teamColor = Object.fromEntries((isSeason ? data.nflTeams : data.nflTeamsWeekly).map(t => [t.abbr, t.v2025 !== null ? v2025Color(t.v2025) : null]))

    // streaming picks — 2x2 grid
    if (data.streaming) {
      const streamDiv = el('div', { className: 'card' })
      const streamHeader = el('div', { className: 'header' })
      streamHeader.appendChild(el('h2', { textContent: 'Streaming picks' }))
      let streamRoster = 'unrostered'
      const streamOpts = el('div', { className: 'opts' })
      const streamBody = el('div')
      streamBody.style.display = 'grid'
      streamBody.style.gridTemplateColumns = '1fr 1fr'
      streamBody.style.gap = '1rem'
      const renderStream = () => {
        streamOpts.innerHTML = ''
        for (const [label, val] of [['All', 'all'], ['Rostered', 'rostered'], ['Unrostered', 'unrostered']]) {
          const btn = el('button', { textContent: label, className: val === streamRoster ? 'on' : '' })
          btn.onclick = () => { streamRoster = val; renderStream() }
          streamOpts.appendChild(btn)
        }
        streamBody.innerHTML = ''
        for (const pos of ['QB', 'TE', 'K', 'DEF']) {
          const col = el('div')
          col.appendChild(el('h2', { textContent: pos, style: 'margin:0 0 4px' }))
          const table = el('table')
          const thead = el('thead')
          const hr = el('tr')
          for (const h of ['Player', 'Team', 'Matchup', '#']) hr.appendChild(el('th', { textContent: h }))
          thead.appendChild(hr)
          table.appendChild(thead)
          const tbody = el('tbody')
          const filtered = (data.streaming[pos] || {})[streamRoster] || []
          for (const p of filtered) {
            const tr = el('tr')
            tr.appendChild(el('td', { textContent: p.name, title: p.name }))
            tr.appendChild(el('td', { textContent: p.team }))
            if (teamColor[p.team]) tr.style.color = teamColor[p.team]
            tr.appendChild(el('td', { textContent: p.matchup }))
            tr.appendChild(el('td', { textContent: p.matchupRank }))
            tbody.appendChild(tr)
          }
          table.appendChild(tbody)
          col.appendChild(table)
          streamBody.appendChild(col)
        }
      }
      streamHeader.appendChild(streamOpts)
      streamDiv.appendChild(streamHeader)
      streamDiv.appendChild(streamBody)
      renderStream()
      cardsAfterRosters.appendChild(streamDiv)
    }

    const teams = isSeason ? data.nflTeams : data.nflTeamsWeekly
    const teamDiv = el('div', { className: 'card' })
    teamDiv.appendChild(el('h2', { textContent: 'Offensive fantasy points per team' }))
    const teamTable = el('table')
    const teamThead = el('thead')
    const teamHr = el('tr')
    for (const h of ['#', 'Team', 'Points', 'WoW', '2025', 'v2025', 'Edge', 'Hole']) teamHr.appendChild(el('th', { textContent: h }))
    teamThead.appendChild(teamHr)
    teamTable.appendChild(teamThead)
    const teamTbody = el('tbody')
    for (const t of teams) {
      const tr = el('tr')
      if (t.rank > 1 && (t.rank - 1) % 8 === 0) tr.style.borderTop = '1px solid #555'
      tr.appendChild(el('td', { textContent: t.rank }))
      tr.appendChild(el('td', { textContent: t.name }))
      tr.appendChild(el('td', { textContent: t.pts }))
      const wow = el('td')
      if (t.wow != null) { wow.textContent = (t.wow >= 0 ? '+' : '') + t.wow; wow.className = t.wow >= 0 ? 'plus' : 'minus' }
      else wow.textContent = '—'
      tr.appendChild(wow)
      tr.appendChild(el('td', { textContent: t.priorRank ?? '—' }))
      const delta = el('td')
      if (t.v2025 !== null) {
        delta.textContent = (t.v2025 >= 0 ? '+' : '') + t.v2025
        delta.className = t.v2025 >= 0 ? 'plus' : 'minus'
        const color = v2025Color(t.v2025)
        if (color) tr.style.color = color
      } else delta.textContent = '—'
      tr.appendChild(delta)
      const edge = el('td', { textContent: t.edge })
      edge.title = t.edgeTitle
      tr.appendChild(edge)
      const hole = el('td', { textContent: t.hole })
      hole.title = t.holeTitle
      tr.appendChild(hole)
      teamTbody.appendChild(tr)
    }
    teamTable.appendChild(teamTbody)
    teamDiv.appendChild(teamTable)
    cardsAfterRosters.appendChild(teamDiv)

    const ptDiv = el('div', { className: 'card' })
    const ptHeader = el('div', { className: 'header' })
    ptHeader.appendChild(el('h2', { textContent: 'Players' }))
    const ptFilters = el('div')
    ptFilters.style.display = 'flex'
    ptFilters.style.gap = '1rem'
    let activePos = 'RB', activeRoster = 'unrostered'
    const posOpts = el('div', { className: 'opts' })
    const rosterOpts = el('div', { className: 'opts' })
    const buildOpts = (container, items, getActive, setActive) => {
      container.innerHTML = ''
      for (const [label, val] of items) {
        const btn = el('button', { textContent: label, className: val === getActive() ? 'on' : '' })
        btn.onclick = () => { setActive(val); buildOpts(container, items, getActive, setActive); renderPlayers() }
        container.appendChild(btn)
      }
    }
    buildOpts(posOpts, [['All', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], () => activePos, v => activePos = v)
    buildOpts(rosterOpts, [['All', 'all'], ['Rostered', 'rostered'], ['Unrostered', 'unrostered']], () => activeRoster, v => activeRoster = v)
    ptFilters.appendChild(posOpts)
    ptFilters.appendChild(rosterOpts)
    const ptExpand = el('button', { className: 'expand', textContent: '↔' })
    ptExpand.onclick = () => ptDiv.classList.toggle('wide')
    ptFilters.appendChild(ptExpand)
    ptHeader.appendChild(ptFilters)
    ptDiv.appendChild(ptHeader)
    const ptTable = el('table')
    ptDiv.appendChild(ptTable)
    const renderPlayers = () => {
      ptTable.innerHTML = ''
      const thead = el('thead')
      const hr = el('tr')
      for (const h of ['Player', 'Pos', 'Team', 'Points', 'Snap%', 'Vol%', 'Depth', 'Signal']) hr.appendChild(el('th', { textContent: h }))
      thead.appendChild(hr)
      ptTable.appendChild(thead)
      const tbody = el('tbody')
      const playerPts = p => isSeason ? p.seasonPts : p.pts
      const sorted = data.playerTable.filter(p => (activePos === 'All' || p.pos === activePos) && (activeRoster === 'all' || (activeRoster === 'rostered' ? p.rostered : !p.rostered))).sort((a, b) => playerPts(b) - playerPts(a))
      for (const p of sorted) {
        const tr = el('tr')
        for (const [v, i] of [[p.name, 0], [p.pos, 1], [p.team, 2], [playerPts(p), 3], [p.snapPct + '%', 4], [p.volShare + '%', 5], [p.depth, 6], [p.signal, 7]]) {
          const td = el('td', { textContent: v })
          if (i === 0) td.title = p.name
          if (i === 2 && teamColor[p.team]) tr.style.color = teamColor[p.team]
          if (i === 7) td.className = p.signal === 'claim' ? 'plus' : p.signal === 'avoid' ? 'minus' : ''
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      }
      ptTable.appendChild(tbody)
    }
    renderPlayers()
    cardsAfterRosters.appendChild(ptDiv)
    if (legendCard) cardsAfterRosters.appendChild(legendCard)
  }

  renderPerfect()
  renderContent()
}

fetch('data/weeks.json').then(r => r.json()).then(({ weeks }) => {
  const tabs = document.getElementById('tabs')
  const buttons = []
  for (const w of weeks) {
    const btn = el('button', { textContent: w })
    btn.onclick = () => { buttons.forEach(b => b.className = ''); btn.className = 'on'; loadWeek(w) }
    buttons.push(btn)
    tabs.appendChild(btn)
  }
  buttons.at(-1).className = 'on'
  loadWeek(weeks.at(-1))
})

let legendCard = null
fetch('legend.csv').then(r => r.text()).then(text => {
  const [, ...lines] = text.trim().split('\n')
  const rows = lines.map(line => {
    const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, ''))
    return cols[0] ? { group: cols[0] } : { metric: cols[1], label: cols[2], sleeper: cols[3] === 'x', frank: cols[4] === 'x', other: cols[5] === 'x', note: cols[6] || '' }
  })
  legendCard = el('div', { className: 'card' })
  const header = el('div', { className: 'header' })
  header.appendChild(el('h2', { textContent: 'Legend' }))
  const expandBtn = el('button', { className: 'expand', textContent: '↔' })
  expandBtn.onclick = () => legendCard.classList.toggle('wide')
  header.appendChild(expandBtn)
  legendCard.appendChild(header)
  const legend = el('table', { id: 'legendTable' })
  const thead = el('thead')
  const hr = el('tr')
  for (const h of ['Metric', 'Label', 'Sleeper', 'Frank', 'Other', 'Note']) {
    const th = el('th', { textContent: h })
    if (h === 'Note') th.className = 'note-col'
    hr.appendChild(th)
  }
  thead.appendChild(hr)
  legend.appendChild(thead)
  const tbody = el('tbody')
  for (const row of rows) {
    const tr = el('tr')
    if (row.group) {
      tr.className = 'group'
      tr.appendChild(el('td', { colSpan: 6, textContent: row.group }))
    } else {
      const vals = [row.metric, row.label || '', row.sleeper ? '✓' : '', row.frank ? '✓' : '', row.other ? '✓' : '', row.note || '']
      vals.forEach((v, i) => {
        const td = el('td', { textContent: v })
        if (i === 5) td.className = 'note-col'
        tr.appendChild(td)
      })
    }
    tbody.appendChild(tr)
  }
  legend.appendChild(tbody)
  legendCard.appendChild(legend)
})
