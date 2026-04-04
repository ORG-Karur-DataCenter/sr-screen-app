/* =============================================
   SRScreen — Parser Worker (parser-worker.js)
   Dedicated thread for BibTeX / RIS / CSV parsing
   ============================================= */

self.onmessage = function (e) {
  const { type, payload } = e.data;

  if (type === 'PARSE') {
    try {
      const { rawText, format, filename } = payload;
      let articles;

      switch (format) {
        case 'bibtex':
          articles = parseBibTeX(rawText, filename);
          break;
        case 'ris':
          articles = parseRIS(rawText, filename);
          break;
        case 'csv':
          articles = parseCSV(rawText, filename);
          break;
        default:
          // Auto-detect
          articles = autoDetectAndParse(rawText, filename);
      }

      self.postMessage({
        type: 'PARSE_COMPLETE',
        payload: { articles, count: articles.length, filename, detectedFormat: format || 'auto' }
      });
    } catch (err) {
      self.postMessage({
        type: 'PARSE_ERROR',
        payload: { message: err.message || 'Unknown parse error' }
      });
    }
  }
};

/* ─── Auto-detect ──────────────────────────── */

function autoDetectAndParse(text, filename) {
  const head = text.slice(0, 3000);
  const ext = (filename || '').split('.').pop().toLowerCase();

  // PubMed / NBIB
  if (head.includes('PMID-') || ext === 'nbib') {
    return parsePubMed(text, filename);
  }
  // BibTeX
  if (head.includes('@') && head.includes('{')) {
    return parseBibTeX(text, filename);
  }
  // RIS
  if (head.includes('TY  -') || head.includes('ER  -') || ext === 'ris') {
    return parseRIS(text, filename);
  }
  // CSV
  if (ext === 'csv') {
    return parseCSV(text, filename);
  }
  // Fallback: try RIS, then BibTeX, then CSV
  if (head.includes('TY  -')) return parseRIS(text, filename);
  if (head.includes('@article') || head.includes('@inproceedings')) return parseBibTeX(text, filename);
  return parseCSV(text, filename);
}

/* ─── PubMed / NBIB Parser ─────────────────── */

function parsePubMed(text, filename) {
  const articles = [];
  const blocks = text.split(/\n(?=PMID- )/);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const get = (tag) => {
      const m = block.match(new RegExp(`^${tag}\\s*-\\s+(.*)`, 'm'));
      return m ? m[1].trim() : '';
    };

    const getMultiline = (tag) => {
      const m = block.match(new RegExp(`^${tag}\\s*-\\s+([\\s\\S]*?)(?=\\n[A-Z]{2,4}\\s*-|\\n\\n|$)`, 'm'));
      if (!m) return '';
      return m[1].split('\n').map(l => l.replace(/^\s{6}/, '').trim()).join(' ').trim();
    };

    const getAll = (tag) => {
      return [...block.matchAll(new RegExp(`^${tag}\\s*-\\s+(.*)`, 'gm'))].map(m => m[1].trim());
    };

    const title = getMultiline('TI');
    const abstract = getMultiline('AB');
    const doi = get('LID')?.replace(/\s*\[doi\].*/, '') || get('AID')?.replace(/\s*\[doi\].*/, '') || '';
    const pmid = get('PMID');
    const year = (get('DP') || '').slice(0, 4);
    const authors = getAll('FAU');
    const journal = get('JT') || get('TA');

    if (!title && !pmid) continue;

    articles.push({
      title, abstract, doi, pmid, year,
      authors: authors.join('; '),
      journal,
      source: filename,
      format: 'PubMed',
      raw: block
    });
  }
  return articles;
}

/* ─── BibTeX Parser ────────────────────────── */

function parseBibTeX(text, filename) {
  const articles = [];
  const entries = text.match(/@\w+\s*\{[\s\S]*?\n\}/g) || [];

  for (const entry of entries) {
    const getField = (name) => {
      const m = entry.match(new RegExp(`${name}\\s*=\\s*[\\{"]([\\s\\S]*?)[\\}"]\\s*[,}]`, 'i'));
      if (!m) return '';
      return m[1].replace(/[\{\}]/g, '').replace(/\s+/g, ' ').trim();
    };

    const title = getField('title');
    const abstract = getField('abstract');
    const doi = getField('doi');
    const year = getField('year');
    const journal = getField('journal') || getField('booktitle');
    const authorRaw = getField('author');
    const authors = authorRaw ? authorRaw.split(/ and /i).map(a => a.trim()).join('; ') : '';

    // Extract bibkey
    const keyMatch = entry.match(/@\w+\s*\{\s*([^,\s]+)/);
    const bibkey = keyMatch ? keyMatch[1] : '';

    if (!title) continue;

    articles.push({
      title, abstract, doi, year, authors, journal,
      bibkey,
      source: filename,
      format: 'BibTeX',
      raw: entry
    });
  }
  return articles;
}

/* ─── RIS Parser ───────────────────────────── */

function parseRIS(text, filename) {
  const articles = [];
  const entries = text.split(/\nER\s*-/);

  for (const entry of entries) {
    if (!entry.trim()) continue;

    const get = (tags) => {
      for (const tag of tags) {
        const m = entry.match(new RegExp(`^${tag}\\s*-\\s+(.*)`, 'm'));
        if (m) return m[1].trim();
      }
      return '';
    };

    const getAll = (tag) => {
      return [...entry.matchAll(new RegExp(`^${tag}\\s*-\\s+(.*)`, 'gm'))].map(m => m[1].trim());
    };

    // Multiline abstract
    const getAbstract = () => {
      const m = entry.match(/^AB\s*-\s+([\s\S]*?)(?=\n[A-Z]{2}\s*-|$)/m);
      if (!m) return '';
      return m[1].split('\n').map(l => l.trim()).join(' ').trim();
    };

    const title = get(['TI', 'T1', 'CT']);
    const abstract = getAbstract();
    const doi = get(['DO', 'DI']);
    const year = (get(['PY', 'Y1', 'DA']) || '').slice(0, 4);
    const authors = getAll('AU').join('; ');
    const journal = get(['JO', 'JF', 'T2', 'JA']);

    if (!title) continue;

    articles.push({
      title, abstract, doi, year, authors, journal,
      source: filename,
      format: 'RIS',
      raw: entry + '\nER  -'
    });
  }
  return articles;
}

/* ─── CSV Parser ───────────────────────────── */

function parseCSV(text, filename) {
  const articles = [];
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return articles;

  // Detect delimiter
  const firstLine = lines[0];
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  const delim = tabs > commas ? '\t' : ',';

  const parseLine = (line) => {
    const result = [];
    let current = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && !inQuote) { inQuote = true; continue; }
      if (c === '"' && inQuote) {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuote = false; }
        continue;
      }
      if (c === delim && !inQuote) { result.push(current); current = ''; continue; }
      current += c;
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim());
  const col = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));

  const titleIdx = col(['title', 'ti', 'document name', 'article title']);
  const abstractIdx = col(['abstract', 'ab']);
  const doiIdx = col(['doi', 'do', 'digital object']);
  const pmidIdx = col(['pmid', 'pubmed', 'pm id']);
  const authorIdx = col(['author', 'au', 'contributor', 'authors']);
  const yearIdx = col(['year', 'py', 'publication year', 'pub year', 'publication date']);
  const journalIdx = col(['journal', 'source', 'source title', 'publication']);

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);

    const title = titleIdx >= 0 ? (cols[titleIdx] || '').trim() : '';
    if (!title) continue;

    articles.push({
      title,
      abstract: abstractIdx >= 0 ? (cols[abstractIdx] || '').trim() : '',
      doi: doiIdx >= 0 ? (cols[doiIdx] || '').trim() : '',
      pmid: pmidIdx >= 0 ? (cols[pmidIdx] || '').trim() : '',
      year: yearIdx >= 0 ? (cols[yearIdx] || '').trim() : '',
      authors: authorIdx >= 0 ? (cols[authorIdx] || '').trim() : '',
      journal: journalIdx >= 0 ? (cols[journalIdx] || '').trim() : '',
      source: filename,
      format: 'CSV',
      raw: JSON.stringify(Object.fromEntries(headers.map((h, j) => [h, cols[j] || ''])))
    });
  }
  return articles;
}
