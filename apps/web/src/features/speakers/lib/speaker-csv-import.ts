import type { TFunction } from 'i18next';

const MAX_ROWS = 200;

export type SpeakerCsvImportRow = {
  session_id: string;
  full_name: string;
  email: string | null;
};

export type SpeakerCsvIssue =
  | { line: 0; code: 'EMPTY_FILE' }
  | { line: 0; code: 'TOO_MANY_ROWS'; max: number }
  | { line: number; code: 'MISSING_HEADERS'; keys: string }
  | { line: number; code: 'EMPTY_NAME' }
  | { line: number; code: 'INVALID_EMAIL'; value: string }
  | { line: number; code: 'UNKNOWN_SESSION'; title: string }
  | { line: number; code: 'AMBIGUOUS_SESSION'; title: string };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parser CSV minimale: virgole, campi tra doppi apici, doppio apice escapato come "" */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeHeaderKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '_');
}

function canonicalField(h: string): 'session_title' | 'full_name' | 'email' | null {
  const k = normalizeHeaderKey(h);
  const map: Record<string, 'session_title' | 'full_name' | 'email'> = {
    session_title: 'session_title',
    titolo_sessione: 'session_title',
    session: 'session_title',
    full_name: 'full_name',
    nome: 'full_name',
    nome_completo: 'full_name',
    speaker: 'full_name',
    speaker_name: 'full_name',
    name: 'full_name',
    email: 'email',
    e_mail: 'email',
  };
  return map[k] ?? null;
}

function isValidEmail(s: string): boolean {
  if (s.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(s);
}

function buildSessionIndex(sessions: readonly { id: string; title: string }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of sessions) {
    const k = s.title.trim().toLowerCase();
    const list = m.get(k) ?? [];
    list.push(s.id);
    m.set(k, list);
  }
  return m;
}

export function parseAndResolveSpeakerCsv(
  rawText: string,
  sessions: readonly { id: string; title: string }[],
): { rows: SpeakerCsvImportRow[] } | { issues: SpeakerCsvIssue[] } {
  const text = stripBom(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter((ln) => ln.trim().length > 0);
  if (lines.length === 0) {
    return { issues: [{ line: 0, code: 'EMPTY_FILE' }] };
  }

  const headerCells = parseCsvLine(lines[0]!);
  const colIndex: Partial<Record<'session_title' | 'full_name' | 'email', number>> = {};
  headerCells.forEach((h, idx) => {
    const field = canonicalField(h);
    if (field) colIndex[field] = idx;
  });

  const missing: string[] = [];
  if (colIndex.session_title === undefined) missing.push('session_title');
  if (colIndex.full_name === undefined) missing.push('full_name');
  if (missing.length > 0) {
    return {
      issues: [
        {
          line: 1,
          code: 'MISSING_HEADERS',
          keys: missing.join(', '),
        },
      ],
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_ROWS) {
    return { issues: [{ line: 0, code: 'TOO_MANY_ROWS', max: MAX_ROWS }] };
  }

  const sessionByTitle = buildSessionIndex(sessions);
  const issues: SpeakerCsvIssue[] = [];

  for (let i = 0; i < dataLines.length; i += 1) {
    const lineNum = i + 2;
    const cells = parseCsvLine(dataLines[i]!);
    const st = cells[colIndex.session_title!]?.trim() ?? '';
    const fn = cells[colIndex.full_name!]?.trim() ?? '';
    const emRaw = colIndex.email !== undefined ? (cells[colIndex.email] ?? '').trim() : '';

    if (!fn) {
      issues.push({ line: lineNum, code: 'EMPTY_NAME' });
      continue;
    }
    if (emRaw.length > 0 && !isValidEmail(emRaw)) {
      issues.push({ line: lineNum, code: 'INVALID_EMAIL', value: emRaw });
      continue;
    }

    const key = st.toLowerCase();
    const ids = sessionByTitle.get(key);
    if (!ids || ids.length === 0) {
      issues.push({ line: lineNum, code: 'UNKNOWN_SESSION', title: st });
      continue;
    }
    if (ids.length > 1) {
      issues.push({ line: lineNum, code: 'AMBIGUOUS_SESSION', title: st });
    }
  }

  if (issues.length > 0) {
    return { issues };
  }

  const rows: SpeakerCsvImportRow[] = [];
  for (let i = 0; i < dataLines.length; i += 1) {
    const cells = parseCsvLine(dataLines[i]!);
    const st = cells[colIndex.session_title!]?.trim() ?? '';
    const fn = cells[colIndex.full_name!]?.trim() ?? '';
    const emRaw = colIndex.email !== undefined ? (cells[colIndex.email] ?? '').trim() : '';
    const email = emRaw.length > 0 ? emRaw : null;
    const key = st.toLowerCase();
    const ids = sessionByTitle.get(key)!;
    rows.push({ session_id: ids[0]!, full_name: fn, email });
  }

  if (rows.length === 0) {
    return { issues: [{ line: 0, code: 'EMPTY_FILE' }] };
  }
  return { rows };
}

export function speakerCsvTemplateContent(): string {
  const header = 'session_title,full_name,email';
  const example = 'Opening keynote,Jane Doe,jane.doe@example.com';
  return `\uFEFF${header}\n${example}\n`;
}

export function formatSpeakerCsvIssue(t: TFunction, issue: SpeakerCsvIssue): string {
  switch (issue.code) {
    case 'EMPTY_FILE':
      return t('speaker.csvImport.errors.emptyFile');
    case 'TOO_MANY_ROWS':
      return t('speaker.csvImport.errors.tooManyRows', { max: issue.max });
    case 'MISSING_HEADERS':
      return t('speaker.csvImport.errors.missingHeaders', { keys: issue.keys });
    case 'EMPTY_NAME':
      return t('speaker.csvImport.errors.emptyName', { line: issue.line });
    case 'INVALID_EMAIL':
      return t('speaker.csvImport.errors.invalidEmail', { line: issue.line, value: issue.value });
    case 'UNKNOWN_SESSION':
      return t('speaker.csvImport.errors.unknownSession', { line: issue.line, title: issue.title });
    case 'AMBIGUOUS_SESSION':
      return t('speaker.csvImport.errors.ambiguousSession', { line: issue.line, title: issue.title });
    default:
      return t('speaker.csvImport.errors.generic');
  }
}
