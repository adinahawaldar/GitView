 AOS.init({ once: true, duration: 600, easing: 'ease-out' });

    function parseRepoURL(url){
      try{
        const u = new URL(url.trim());
        if(u.hostname !== 'github.com') return null;
        const parts = u.pathname.replace(/^\//,'').split('/').filter(Boolean);
        if(parts.length < 2) return null;
        return { owner: parts[0], repo: parts[1] };
      }catch(e){ return null; }
    }
    function fmtNum(n){
      if(n === null || n === undefined) return '-';
      return new Intl.NumberFormat().format(n);
    }
    function timeAgo(dateStr){
      const d = new Date(dateStr);
      const diff = (Date.now() - d.getTime())/1000;
      const days = Math.floor(diff/86400);
      if(days < 1){
        const hours = Math.floor(diff/3600); return hours+"h ago";
      }
      if(days < 30) return days+"d ago";
      const months = Math.floor(days/30); if(months < 12) return months+"mo ago";
      const years = Math.floor(months/12); return years+"y ago";
    }
    function monthKey(d){
      const dt = new Date(d);
      return dt.getFullYear()+ '-' + String(dt.getMonth()+1).padStart(2,'0');
    }

    function ghHeaders(){
      const h = { 'Accept': 'application/vnd.github+json' };
      const t = document.getElementById('token').value.trim();
      if(t) h['Authorization'] = 'Bearer ' + t;
      return h;
    }
    async function gh(url){
      const res = await fetch(url, { headers: ghHeaders() });
      if(!res.ok) throw new Error('GitHub API error '+res.status+': '+url);
      return res.json();
    }

    async function fetchRepo(owner, repo){
      return gh(`https://api.github.com/repos/${owner}/${repo}`);
    }
    async function fetchLanguages(owner, repo){
      return gh(`https://api.github.com/repos/${owner}/${repo}/languages`);
    }
    async function fetchContributors(owner, repo, perPage=24){
      return gh(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=${perPage}`);
    }
    async function fetchIssuesCount(owner, repo){
      const openQ = `https://api.github.com/search/issues?q=repo:${owner}/${repo}+type:issue+state:open`;
      const closedQ = `https://api.github.com/search/issues?q=repo:${owner}/${repo}+type:issue+state:closed`;
      const [open, closed] = await Promise.all([gh(openQ), gh(closedQ)]);
      return { open: open.total_count, closed: closed.total_count };
    }
    async function fetchStargazersTimeline(owner, repo){
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=100`, {
        headers: { ...ghHeaders(), 'Accept': 'application/vnd.github.v3.star+json' }
      });
      if(!res.ok) throw new Error('Stargazers fetch failed');
      const data = await res.json();
      const buckets = {};
      data.forEach(s => {
        const k = monthKey(s.starred_at);
        buckets[k] = (buckets[k]||0) + 1;
      });
      const months = [];
      const now = new Date();
      for(let i=11;i>=0;i--){
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        const k = monthKey(d);
        months.push(k);
      }
      let total = 0;
      const series = months.map(m => { total += (buckets[m]||0); return total; });
      return { months, series, count: data.length };
    }
    async function fetchReadme(owner, repo){
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: ghHeaders() });
      if(!res.ok) throw new Error('README not available');
      const data = await res.json();
      const content = atob(data.content.replace(/\n/g,''));
      return content;
    }

    const repoInput = document.getElementById('repoUrl');
    const fetchBtn = document.getElementById('fetchBtn');
    const appSec = document.getElementById('app');

    let langChart, starsChart, issuesChart;

    function destroyCharts(){
      [langChart, starsChart, issuesChart].forEach(c => { if(c){ c.destroy(); }});
      langChart = starsChart = issuesChart = null;
    }

    function renderInfo(repo){
      document.getElementById('ownerAvatar').src = repo.owner?.avatar_url || '';
      const full = `${repo.full_name}`;
      const a = document.getElementById('repoFullName');
      a.textContent = full; a.href = repo.html_url;
      document.getElementById('repoDesc').textContent = repo.description || 'No description';
      const stats = document.getElementById('repoStats');
      stats.innerHTML = '';
      const pills = [
        `⭐ ${fmtNum(repo.stargazers_count)}`,
        `🍴 ${fmtNum(repo.forks_count)}`,
        `🐞 ${fmtNum(repo.open_issues_count)} issues`,
        `⏳ updated ${timeAgo(repo.pushed_at)}`
      ];
      pills.forEach(t => { const div = document.createElement('div'); div.className='chip'; div.textContent=t; stats.appendChild(div); });

      document.getElementById('kpiStars').textContent = fmtNum(repo.stargazers_count);
      document.getElementById('kpiForks').textContent = fmtNum(repo.forks_count);
      document.getElementById('kpiIssues').textContent = fmtNum(repo.open_issues_count);
      document.getElementById('kpiUpdated').textContent = timeAgo(repo.pushed_at);
      document.getElementById('kpiCreated').textContent = new Date(repo.created_at).toLocaleDateString();
      document.getElementById('kpiLicense').textContent = repo.license?.spdx_id || '—';
      document.getElementById('kpiBranch').textContent = repo.default_branch || '—';
    }

    function renderLanguages(langs){
      const labels = Object.keys(langs);
      const values = Object.values(langs);
      const total = values.reduce((a,b)=>a+b,0) || 1;
      const perc = values.map(v => Math.round(v*100/total));
      const ctx = document.getElementById('langChart');
      langChart = new Chart(ctx, { type: 'pie', data: { labels, datasets: [{ data: perc }] }, options: { plugins: { legend: { labels: { color: '#c8d2ea' } } } } });
    }

    function renderStarsTimeline(tl, fallbackCount){
      const ctx = document.getElementById('starsChart');
      const note = document.getElementById('starsNote');
      if(tl && tl.series.some(v=>v>0)){
        starsChart = new Chart(ctx, { type: 'line', data: { labels: tl.months, datasets: [{ data: tl.series, fill: false }] }, options: { scales: { x: { ticks:{ color:'#c8d2ea'} }, y: { ticks:{ color:'#c8d2ea'} } }, plugins:{ legend:{ display:false } } } });
        note.textContent = `Based on the most recent ${tl.count} stargazers (cumulative by month).`;
      } else {
        starsChart = new Chart(ctx, { type: 'bar', data: { labels: ['Total Stars'], datasets: [{ data: [fallbackCount] }] }, options: { plugins:{ legend:{ display:false } } } });
        note.textContent = `Timeline unavailable (rate limits or no recent data). Showing total stars.`;
      }
    }

    function renderIssues(open, closed){
      const ctx = document.getElementById('issuesChart');
      issuesChart = new Chart(ctx, { type: 'bar', data: { labels: ['Open','Closed'], datasets: [{ data: [open, closed] }] }, options: { plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ color:'#c8d2ea'} }, y:{ ticks:{ color:'#c8d2ea'} } } } });
    }

    function renderContributors(list){
      document.getElementById('kpiContrib').textContent = fmtNum(list.length);
      const wrap = document.getElementById('contributors');
      wrap.innerHTML='';
      list.forEach(c => {
        const el = document.createElement('div');
        el.className = 'contrib';
        el.innerHTML = `<img src="${c.avatar_url}" alt="${c.login}"><div><div class="name"><a href="${c.html_url}" target="_blank" rel="noopener">${c.login}</a></div><div class="count">${fmtNum(c.contributions)} contributions</div></div>`;
        wrap.appendChild(el);
      });
    }

    function computeHealth({ stars, forks, openIssues, closedIssues, contributors, pushedAt }){
      function cap(v, max){ return Math.min(v, max); }
      const starsScore = (Math.log10(stars+1)/5)*25; 
      const forksScore = (Math.log10(forks+1)/4)*15;
      const totalIssues = openIssues + closedIssues;
      const stability = totalIssues>0 ? (closedIssues/totalIssues) : 1;
      const stabilityScore = stability*20; // up to 20
      const contribScore = Math.min(contributors/10, 1)*20; 
      const daysSincePush = (Date.now()-new Date(pushedAt).getTime())/86400000;
      let activityScore;
      if(daysSincePush <= 7) activityScore = 20; else if(daysSincePush <= 30) activityScore = 16; else if(daysSincePush <= 90) activityScore = 12; else if(daysSincePush <= 180) activityScore = 8; else if(daysSincePush <= 365) activityScore = 4; else activityScore = 1;
      const score = Math.round(starsScore + forksScore + stabilityScore + contribScore + activityScore);
      let emoji = '🙂';
      if(score>=80) emoji = '🔥'; else if(score>=60) emoji = '😃'; else if(score>=30) emoji = '💤'; else emoji = '⚰️';
      return { score: Math.min(score,100), emoji };
    }

    function renderHealth(inputs){
      const { score, emoji } = computeHealth(inputs);
      const fill = document.getElementById('healthFill');
      document.getElementById('healthScore').textContent = score;
      document.getElementById('healthEmoji').textContent = emoji;
      requestAnimationFrame(()=>{ fill.style.width = score+'%'; });
    }

    async function renderReadme(owner, repo){
      const el = document.getElementById('readme');
      el.innerHTML = '<i>Loading README…</i>';
      try{
        const md = await fetchReadme(owner, repo);
        el.innerHTML = marked.parse(md);
      }catch(e){ el.innerHTML = '<i>README not available.</i>'; }
    }

    async function loadRepo(url){
      const parsed = parseRepoURL(url);
      if(!parsed){ alert('Please enter a valid GitHub repo URL, e.g. https://github.com/user/repo'); return; }
      appSec.style.display = 'block';
      destroyCharts();

      const { owner, repo } = parsed;
      try{
        const repoData = await fetchRepo(owner, repo);
        renderInfo(repoData);

        const [langs, issues, contribs] = await Promise.all([
          fetchLanguages(owner, repo).catch(()=>({})),
          fetchIssuesCount(owner, repo).catch(()=>({ open: repoData.open_issues_count || 0, closed: 0 })),
          fetchContributors(owner, repo, 24).catch(()=>[])
        ]);
        renderLanguages(langs||{});
        renderIssues(issues.open||0, issues.closed||0);
        renderContributors(contribs||[]);

        let tl = null;
        try{ tl = await fetchStargazersTimeline(owner, repo); } catch(e){ tl = null; }
        renderStarsTimeline(tl, repoData.stargazers_count || 0);

        renderHealth({
          stars: repoData.stargazers_count||0,
          forks: repoData.forks_count||0,
          openIssues: issues.open||0,
          closedIssues: issues.closed||0,
          contributors: (contribs||[]).length,
          pushedAt: repoData.pushed_at
        });

        renderReadme(owner, repo);
      }catch(err){
        console.error(err);
        alert('Failed to load repository. Check the URL or your rate limit / token.');
      }
    }

    fetchBtn.addEventListener('click', () => loadRepo(repoInput.value));
    repoInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') loadRepo(repoInput.value); });
    document.getElementById('backToTop').addEventListener('click', (e)=>{ e.preventDefault(); window.scrollTo({ top:0, behavior:'smooth' }); });

