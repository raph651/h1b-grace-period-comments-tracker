                                                  

                         
             
                
                        
                     
                           
                            
                      
                 
                 
                                                             
              
 

                           
                     
                
                
                 
                   
                    
                        
 

                          
                     
                   
                
                      
                          
                      
                          
                       
                                    
                                 
                                
           
                    
                   
                         
    
                               
                            
 

const DEADLINE_MS = new Date('2026-11-11T04:59:59Z').getTime(); // Nov 10, 2026 11:59:59 PM EST
const STORAGE_KEY_SNAPSHOT = 'uscis_2026_0364_snapshot_v1';
const STORAGE_KEY_REG_API = 'uscis_2026_0364_reg_key';
const STORAGE_KEY_GEMINI_API = 'uscis_2026_0364_gemini_key';

let state                        = null;
let activeStanceFilter                 = 'ALL';
let activeSourceFilter         = 'ALL';
let searchQuery = '';
let isSyncing = false;

function formatNumber(n        )         {
  return n.toLocaleString('en-US');
}

function formatPercent(part        , total        )         {
  if (!total) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function detectCampaignId(title        )                {
  const m = title.match(/\b(MM\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractSubmitter(title        )         {
  const m = title.match(/Submitted by\s+(.+)$/i);
  return m ? m[1].trim() : 'Anonymous';
}

function classifyHeuristicBrowser(text        , title        )                                     {
  const combined = `${title}\n${text}`.toLowerCase();

  if (/\bmm78\b/i.test(combined)) {
    return {
      stance: 'Support',
      reason: 'MM78 campaign explicitly supports eliminating the discretionary 60-day grace period.'
    };
  }
  if (/\bmm83\b/i.test(combined)) {
    return {
      stance: 'Support',
      reason: 'MM83 campaign states favor for ending the 60-day grace period.'
    };
  }
  if (/\bmm73\b/i.test(combined)) {
    return {
      stance: 'Support',
      reason: 'MM73 campaign urges DHS to finalize elimination of the 60-day grace period.'
    };
  }

  const opposePatterns = [
    /oppose\s+(dhs'?s?\s+)?(proposal|proposed\s+rule|eliminating|removing|removal)/i,
    /strongly\s+oppose/i,
    /respectfully\s+oppose/i,
    /retain\s+the\s+(up-to-)?60-day\s+grace\s+period/i,
    /keep\s+the\s+(60-day\s+)?grace\s+period/i,
    /do\s+not\s+(eliminate|remove|end)\s+the\s+(discretionary\s+)?(60-day\s+)?grace\s+period/i,
    /eliminating\s+the\s+grace\s+period\s+(would|will)\s+(harm|hurt|disrupt|force)/i,
    /urge\s+(dhs|uscis)\s+to\s+(withdraw|reject|keep|retain)/i
  ];

  const supportPatterns = [
    /support\s+(eliminating|removing|ending)\s+the\s+(discretionary\s+)?(60-day\s+)?grace\s+period/i,
    /in\s+favor\s+of\s+(ending|eliminating|removing)\s+the\s+(60[\s-]day\s+)?grace\s+period/i,
    /finalize\s+elimination\s+of\s+the\s+60-day\s+grace\s+period/i,
    /support\s+(this|the)\s+proposed\s+rule/i,
    /end\s+the\s+(60[\s-]day\s+)?grace\s+period/i,
    /american\s+jobs\s+for\s+americans/i,
    /end\s+h-?1b/i
  ];

  for (const pat of opposePatterns) {
    if (pat.test(combined)) {
      return {
        stance: 'Oppose',
        reason: 'Opposes eliminating the 60-day grace period and urges DHS to retain transition flexibility.'
      };
    }
  }

  for (const pat of supportPatterns) {
    if (pat.test(combined)) {
      return {
        stance: 'Support',
        reason: 'Supports the proposed rule to eliminate the 60-day discretionary grace period.'
      };
    }
  }

  if (combined.includes('oppose') && !combined.includes('support eliminating')) {
    return { stance: 'Oppose', reason: 'Expresses opposition to removing the 60-day grace period.' };
  }
  if (combined.includes('support') && !combined.includes('support the 60-day grace period')) {
    return { stance: 'Support', reason: 'Expresses support for the DHS proposed rulemaking.' };
  }

  return {
    stance: "Can't tell",
    reason: 'Comment text is brief, attachment-only, or does not state a clear stance.'
  };
}

async function classifyBatchWithGeminiBrowser(
  geminiKey        ,
  items                                                           
)                                                                                                 {
  const result = new Map                                                                                  ();
  if (items.length === 0) return result;

  if (!geminiKey) {
    for (const item of items) {
      const h = classifyHeuristicBrowser(item.commentText, item.title);
      result.set(item.id, { ...h, classifiedBy: 'heuristic' });
    }
    return result;
  }

  const prompt = `Classify public comments on DHS/USCIS Proposed Rule USCIS-2026-0364-0001 ("Eliminating the Discretionary 60-Day Grace Period").
The rule ELIMINATES the up-to-60-day grace period for E-1, E-2, E-3, H-1B, H-1B1, L-1, O-1, and TN workers after employment ends.
Labels:
- "Support": Supports the proposed rule (wants to eliminate or shorten the 60-day grace period).
- "Oppose": Opposes the proposed rule (wants to retain/keep the 60-day grace period).
- "Can't tell": Rarely used; only when stance cannot be determined from the text.

Return a JSON array of objects: [{"id": "...", "stance": "Support"|"Oppose"|"Can't tell", "reason": "1 short sentence"}].

Comments:
${JSON.stringify(items)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}`);
    }

    const data = (await res.json())     
                                                                             
     ;
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const parsed = JSON.parse(raw)                                                         ;
    for (const p of parsed) {
      const stance         =
        p.stance === 'Support' || p.stance === 'Oppose' || p.stance === "Can't tell"
          ? p.stance
          : "Can't tell";
      result.set(p.id, {
        stance,
        reason: p.reason || 'Classified by Gemini.',
        classifiedBy: 'gemini'
      });
    }
  } catch (err) {
    console.warn('Gemini browser classification fallback:', err);
  }

  for (const item of items) {
    if (!result.has(item.id)) {
      const h = classifyHeuristicBrowser(item.commentText, item.title);
      result.set(item.id, { ...h, classifiedBy: 'heuristic' });
    }
  }

  return result;
}

function updateCountdown()       {
  const el = document.getElementById('countdown-timer');
  const badgeEl = document.getElementById('status-badge');
  if (!el || !badgeEl) return;

  const now = Date.now();
  const diff = DEADLINE_MS - now;

  if (diff <= 0) {
    el.textContent = 'Comment Period Closed (Ended Nov 10, 2026 11:59 PM EST)';
    badgeEl.textContent = 'Closed';
    badgeEl.className = 'badge badge-closed';
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  const secs = Math.floor((diff / 1000) % 60);

  el.textContent = `${days}d ${hours}h ${mins}m ${secs}s remaining`;
  badgeEl.textContent = 'Open for Comment';
  badgeEl.className = 'badge badge-open';
}

function renderDashboard()       {
  if (!state) return;

  const totalClassified =
    state.counts.Support + state.counts.Oppose + state.counts["Can't tell"];

  const setTxt = (id        , text        ) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };

  setTxt('kpi-total', formatNumber(state.totalPublishedOnDocket));
  setTxt('kpi-indexed', `${formatNumber(state.totalIndexedInTracker)} indexed & classified`);

  setTxt('kpi-support', formatNumber(state.counts.Support));
  setTxt('kpi-support-pct', formatPercent(state.counts.Support, totalClassified));

  setTxt('kpi-oppose', formatNumber(state.counts.Oppose));
  setTxt('kpi-oppose-pct', formatPercent(state.counts.Oppose, totalClassified));

  setTxt('kpi-cant-tell', formatNumber(state.counts["Can't tell"]));
  setTxt('kpi-cant-tell-pct', formatPercent(state.counts["Can't tell"], totalClassified));

  const syncDate = new Date(state.lastSyncedAt);
  setTxt(
    'last-synced',
    `Last synced: ${syncDate.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })}`
  );

  // Stacked progress bar widths
  const barSupport = document.getElementById('bar-support')                      ;
  const barOppose = document.getElementById('bar-oppose')                      ;
  const barCantTell = document.getElementById('bar-cant-tell')                      ;

  if (barSupport && barOppose && barCantTell && totalClassified > 0) {
    barSupport.style.width = `${(state.counts.Support / totalClassified) * 100}%`;
    barOppose.style.width = `${(state.counts.Oppose / totalClassified) * 100}%`;
    barCantTell.style.width = `${(state.counts["Can't tell"] / totalClassified) * 100}%`;
  }

  // Render Mass Mail Campaign breakdown
  const campaignBody = document.getElementById('campaign-table-body');
  if (campaignBody) {
    campaignBody.innerHTML = state.campaigns
      .map(
        (c) => `
      <tr>
        <td><strong>${escapeHtml(c.label)}</strong></td>
        <td><span class="stance-pill stance-${stanceSlug(c.stance)}">${escapeHtml(c.stance)}</span></td>
        <td class="num-col"><strong>${formatNumber(c.count)}</strong> (${formatPercent(c.count, state .totalPublishedOnDocket)})</td>
        <td class="excerpt-col">"${escapeHtml(c.sampleExcerpt)}"</td>
        <td><a href="${escapeHtml(c.sampleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.sampleId)} ↗</a></td>
      </tr>`
      )
      .join('');
  }

  renderCommentsTable();
}

function stanceSlug(s        )         {
  if (s === 'Support') return 'support';
  if (s === 'Oppose') return 'oppose';
  return 'cant-tell';
}

function escapeHtml(str        )         {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCommentsTable()       {
  if (!state) return;
  const tbody = document.getElementById('comments-table-body');
  const countLabel = document.getElementById('filtered-count-label');
  if (!tbody) return;

  const q = searchQuery.trim().toLowerCase();

  const filtered = state.comments.filter((c) => {
    if (activeStanceFilter !== 'ALL' && c.stance !== activeStanceFilter) return false;
    if (activeSourceFilter === 'INDIVIDUAL' && c.campaignId !== null) return false;
    if (
      activeSourceFilter !== 'ALL' &&
      activeSourceFilter !== 'INDIVIDUAL' &&
      c.campaignId !== activeSourceFilter
    ) {
      return false;
    }
    if (q) {
      const hay = `${c.id} ${c.title} ${c.submitterName} ${c.commentText} ${c.reason}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (countLabel) {
    countLabel.textContent = `Showing ${formatNumber(filtered.length)} of ${formatNumber(state.comments.length)} detailed sample/indexed comments`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No comments match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .slice(0, 250)
    .map((c) => {
      const dateStr = c.postedDate ? c.postedDate.slice(0, 10) : '—';
      const campaignBadge = c.campaignId
        ? `<span class="campaign-tag">${escapeHtml(c.campaignId)}</span>`
        : `<span class="campaign-tag campaign-individual">Individual</span>`;

      return `
      <tr>
        <td class="id-col">
          <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.id)} ↗</a>
          <div class="meta-sub">${escapeHtml(dateStr)} · ${escapeHtml(c.submitterName)}</div>
        </td>
        <td>${campaignBadge}</td>
        <td>
          <span class="stance-pill stance-${stanceSlug(c.stance)}">${escapeHtml(c.stance)}</span>
          <div class="meta-sub">via ${escapeHtml(c.classifiedBy)}</div>
        </td>
        <td class="comment-text-col">${escapeHtml(c.commentText || c.title)}</td>
        <td class="reason-col">${escapeHtml(c.reason)}</td>
      </tr>`;
    })
    .join('');
}

function setSyncStatus(msg        , isError = false)       {
  const el = document.getElementById('sync-status-log');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'sync-log sync-log-error' : 'sync-log';
}

function formatRegulationsDate(isoDate        )         {
  const d = new Date(isoDate);
  const pad = (n        ) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function runBrowserLiveSync(fetchAllWindows         )                {
  if (isSyncing || !state) return;

  const regInput = document.getElementById('input-reg-key')                           ;
  const geminiInput = document.getElementById('input-gemini-key')                           ;

  const regKey = (regInput?.value || '').trim();
  const geminiKey = (geminiInput?.value || '').trim();

  if (!regKey) {
    setSyncStatus('Please enter your Regulations.gov (data.gov) API key first.', true);
    return;
  }

  localStorage.setItem(STORAGE_KEY_REG_API, regKey);
  if (geminiKey) localStorage.setItem(STORAGE_KEY_GEMINI_API, geminiKey);

  isSyncing = true;
  try {
    setSyncStatus('Step 1/3: Resolving document objectId from Regulations.gov v4 API...');
    const docRes = await fetch(
      `https://api.regulations.gov/v4/documents/${state.documentId}?api_key=${encodeURIComponent(regKey)}`
    );
    if (!docRes.ok) {
      throw new Error(`Regulations.gov document lookup returned HTTP ${docRes.status}`);
    }
    const docJson = (await docRes.json())     
                                                    
     ;
    const objectId = docJson.data?.attributes?.objectId;
    if (!objectId) {
      throw new Error('Could not find objectId on document response.');
    }

    const commentMap = new Map                       ();
    for (const c of state.comments) {
      commentMap.set(c.id, c);
    }

    const maxWindows = fetchAllWindows ? 8 : 1;
    const maxPagesPerWindow = fetchAllWindows ? 20 : 2;
    let windowGe = fetchAllWindows ? '2026-09-11 00:00:00' : state.lastModifiedCursor || '2026-09-11 00:00:00';
    let keepPaging = true;
    let reportedTotal = state.totalPublishedOnDocket;

    const campaignCounter = new Map                ();
    const stanceCounter                         = {
      Support: 0,
      Oppose: 0,
      "Can't tell": 0
    };
    let totalSeenInRun = 0;

    for (let w = 1; w <= maxWindows && keepPaging; w++) {
      let lastDateInWindow                = null;
      for (let page = 1; page <= maxPagesPerWindow; page++) {
        setSyncStatus(
          `Step 2/3: Fetching comments window ${w}/${maxWindows}, page ${page}/${maxPagesPerWindow} (sliding window >= ${windowGe})...`
        );
        const url = new URL('https://api.regulations.gov/v4/comments');
        url.searchParams.set('filter[commentOnId]', objectId);
        if (fetchAllWindows) {
          url.searchParams.set('filter[lastModifiedDate][ge]', windowGe);
          url.searchParams.set('sort', 'lastModifiedDate,documentId');
        } else {
          url.searchParams.set('sort', '-postedDate');
        }
        url.searchParams.set('page[size]', '250');
        url.searchParams.set('page[number]', String(page));
        url.searchParams.set('api_key', regKey);

        const listRes = await fetch(url.toString());
        if (listRes.status === 429) {
          setSyncStatus('Reached Regulations.gov hourly rate limit; classifying fetched batch...', true);
          keepPaging = false;
          break;
        }
        if (!listRes.ok) {
          throw new Error(`Comments list endpoint returned HTTP ${listRes.status}`);
        }

        const listJson = (await listRes.json())     
                        
                       
                          
                             
                                  
                                        
                                  
              
             
                                                                   
         ;

        if (w === 1 && page === 1 && listJson.meta?.totalElements) {
          reportedTotal = listJson.meta.totalElements;
        }

        const rows = listJson.data || [];
        if (rows.length === 0) {
          keepPaging = false;
          break;
        }

        for (const r of rows) {
          if (r.attributes?.withdrawn) continue;
          const title = r.attributes?.title || `Comment ${r.id}`;
          const campaignId = detectCampaignId(title);
          const h = classifyHeuristicBrowser('', title);

          totalSeenInRun++;
          if (campaignId) {
            campaignCounter.set(campaignId, (campaignCounter.get(campaignId) || 0) + 1);
          }
          stanceCounter[h.stance]++;

          if (!commentMap.has(r.id)) {
            commentMap.set(r.id, {
              id: r.id,
              title,
              submitterName: extractSubmitter(title),
              postedDate: r.attributes?.postedDate || '',
              lastModifiedDate: r.attributes?.lastModifiedDate || '',
              campaignId,
              commentText: '',
              stance: h.stance,
              reason: h.reason,
              classifiedBy: campaignId ? 'campaign-template' : 'heuristic',
              url: `https://www.regulations.gov/comment/${r.id}`
            });
          }
          if (r.attributes?.lastModifiedDate) {
            lastDateInWindow = r.attributes.lastModifiedDate;
          }
        }

        if (!listJson.meta?.hasNextPage || rows.length < 250) {
          keepPaging = false;
          break;
        }
      }

      if (keepPaging && lastDateInWindow) {
        windowGe = formatRegulationsDate(lastDateInWindow);
      } else {
        break;
      }
    }

    // Fetch details for up to 15 new individual or representative comments to classify with Gemini in-browser
    const needsDetail = Array.from(commentMap.values())
      .filter((c) => !c.commentText)
      .slice(0, 15);

    if (needsDetail.length > 0) {
      setSyncStatus(`Step 3/3: Fetching full text for ${needsDetail.length} new comments & classifying with Gemini...`);
      for (const item of needsDetail) {
        const dRes = await fetch(
          `https://api.regulations.gov/v4/comments/${item.id}?api_key=${encodeURIComponent(regKey)}`
        );
        if (!dRes.ok) continue;
        const dJson = (await dRes.json())     
                                                                                                                     
         ;
        const attr = dJson.data?.attributes;
        item.commentText = (attr?.comment || '').trim();
        const name = [attr?.firstName, attr?.lastName].filter(Boolean).join(' ').trim();
        if (attr?.organization) item.submitterName = attr.organization;
        else if (name) item.submitterName = name;
      }

      const classified = await classifyBatchWithGeminiBrowser(
        geminiKey,
        needsDetail.map((c) => ({ id: c.id, title: c.title, commentText: c.commentText }))
      );
      for (const item of needsDetail) {
        const cRes = classified.get(item.id);
        if (cRes) {
          item.stance = cRes.stance;
          item.reason = cRes.reason;
          item.classifiedBy = cRes.classifiedBy;
        }
      }
    }

    const mergedComments = Array.from(commentMap.values()).sort((a, b) =>
      b.postedDate.localeCompare(a.postedDate)
    );

    if (fetchAllWindows && totalSeenInRun > 0) {
      state.counts = stanceCounter;
      state.totalIndexedInTracker = totalSeenInRun;
    }

    state.totalPublishedOnDocket = Math.max(reportedTotal, state.totalPublishedOnDocket);
    state.lastSyncedAt = new Date().toISOString();
    state.comments = mergedComments.slice(0, 500);

    localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify(state));
    renderDashboard();
    setSyncStatus(
      `Sync complete! Indexed ${formatNumber(mergedComments.length)} comments (Docket total: ${formatNumber(
        state.totalPublishedOnDocket
      )}).`
    );
  } catch (err) {
    setSyncStatus(`Sync error: ${(err         ).message}`, true);
  } finally {
    isSyncing = false;
  }
}

function parseCsvLine(line        )           {
  const result           = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function handleCsvUpload(file      )                {
  if (!state) return;
  const geminiInput = document.getElementById('input-gemini-key')                           ;
  const geminiKey = (geminiInput?.value || '').trim();

  setSyncStatus(`Reading bulk CSV file "${file.name}"...`);
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    setSyncStatus('CSV file appears empty.', true);
    return;
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idIdx = headers.findIndex((h) => h.includes('document id') || h === 'id' || h === 'commentid');
  const titleIdx = headers.findIndex((h) => h.includes('title'));
  const commentIdx = headers.findIndex((h) => h === 'comment' || h.includes('comment text'));
  const postedIdx = headers.findIndex((h) => h.includes('posted'));

  const newRecords                  = [];
  const counts                         = { Support: 0, Oppose: 0, "Can't tell": 0 };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const id = (idIdx >= 0 ? cols[idIdx] : `CSV-ROW-${i}`) || `CSV-ROW-${i}`;
    const title = (titleIdx >= 0 ? cols[titleIdx] : 'Public Submission') || 'Public Submission';
    const body = (commentIdx >= 0 ? cols[commentIdx] : '') || '';
    const postedDate = (postedIdx >= 0 ? cols[postedIdx] : new Date().toISOString()) || '';
    const campaignId = detectCampaignId(title);
    const h = classifyHeuristicBrowser(body, title);
    counts[h.stance]++;

    if (newRecords.length < 300) {
      newRecords.push({
        id,
        title,
        submitterName: extractSubmitter(title),
        postedDate,
        lastModifiedDate: postedDate,
        campaignId,
        commentText: body,
        stance: h.stance,
        reason: h.reason,
        classifiedBy: campaignId ? 'campaign-template' : 'heuristic',
        url: `https://www.regulations.gov/comment/${id}`
      });
    }
  }

  // If Gemini key is provided, refine the first 25 individual comments with Gemini
  if (geminiKey) {
    const sampleToRefine = newRecords.filter((r) => !r.campaignId && r.commentText).slice(0, 25);
    if (sampleToRefine.length > 0) {
      setSyncStatus(`Classifying ${sampleToRefine.length} unique comments with Gemini...`);
      const refined = await classifyBatchWithGeminiBrowser(
        geminiKey,
        sampleToRefine.map((r) => ({ id: r.id, title: r.title, commentText: r.commentText }))
      );
      for (const r of sampleToRefine) {
        const res = refined.get(r.id);
        if (res) {
          counts[r.stance]--;
          r.stance = res.stance;
          r.reason = res.reason;
          r.classifiedBy = res.classifiedBy;
          counts[r.stance]++;
        }
      }
    }
  }

  state.counts = counts;
  state.totalIndexedInTracker = lines.length - 1;
  state.totalPublishedOnDocket = Math.max(state.totalPublishedOnDocket, lines.length - 1);
  state.comments = newRecords;
  state.lastSyncedAt = new Date().toISOString();

  localStorage.setItem(STORAGE_KEY_SNAPSHOT, JSON.stringify(state));
  renderDashboard();
  setSyncStatus(`Imported and classified ${formatNumber(lines.length - 1)} comments from ${file.name}.`);
}

function downloadSnapshotJson()       {
  if (!state) return;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `USCIS-2026-0364-0001-summary-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function init()                {
  updateCountdown();
  setInterval(updateCountdown, 1000);

  // Restore saved API keys in browser
  const regInput = document.getElementById('input-reg-key')                           ;
  const geminiInput = document.getElementById('input-gemini-key')                           ;
  if (regInput) regInput.value = localStorage.getItem(STORAGE_KEY_REG_API) || '';
  if (geminiInput) geminiInput.value = localStorage.getItem(STORAGE_KEY_GEMINI_API) || '';

  // Load initial summary.json or cached localStorage snapshot
  try {
    const res = await fetch('./data/summary.json');
    const fileData = (await res.json())                  ;
    const cachedRaw = localStorage.getItem(STORAGE_KEY_SNAPSHOT);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw)                  ;
      state =
        new Date(cached.lastSyncedAt).getTime() > new Date(fileData.lastSyncedAt).getTime()
          ? cached
          : fileData;
    } else {
      state = fileData;
    }
  } catch (err) {
    console.error('Failed to load ./data/summary.json:', err);
  }

  renderDashboard();

  // Wire stance filter buttons
  document.querySelectorAll                   ('[data-stance-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-stance-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeStanceFilter = (btn.dataset.stanceFilter                  ) || 'ALL';
      renderCommentsTable();
    });
  });

  // Wire source filter select
  const sourceSelect = document.getElementById('source-filter-select')                            ;
  sourceSelect?.addEventListener('change', () => {
    activeSourceFilter = sourceSelect.value;
    renderCommentsTable();
  });

  // Wire search input
  const searchInput = document.getElementById('comment-search-input')                           ;
  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderCommentsTable();
  });

  // Wire sync buttons
  document.getElementById('btn-sync-latest')?.addEventListener('click', () => {
    void runBrowserLiveSync(false);
  });
  document.getElementById('btn-sync-all')?.addEventListener('click', () => {
    void runBrowserLiveSync(true);
  });
  document.getElementById('btn-export-json')?.addEventListener('click', () => {
    downloadSnapshotJson();
  });
  document.getElementById('btn-reset-cache')?.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY_SNAPSHOT);
    window.location.reload();
  });

  const csvInput = document.getElementById('input-csv-upload')                           ;
  csvInput?.addEventListener('change', () => {
    const file = csvInput.files?.[0];
    if (file) void handleCsvUpload(file);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  void init();
});
