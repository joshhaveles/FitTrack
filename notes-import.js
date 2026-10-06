/**
 * FitTrack Notes Import Agent
 * Deciphers freeform Android / Google Keep / Samsung Notes workout logs
 * into structured sessions ready for client history.
 */
(function (global) {
  'use strict';

  var SESSION_TYPES = [
    'Strength training', 'Cardio', 'HIIT', 'Mobility', 'Full body', 'Custom',
    'Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Upper Push', 'Upper Pull',
    'Chest', 'Back', 'Shoulders', 'Arms', 'Core'
  ];

  var MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  var DAY_NAMES = /^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function toIsoDate(y, m, d) {
    if (!y || m == null || !d) return null;
    var dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function guessYear(monthIndex, day) {
    var now = new Date();
    var y = now.getFullYear();
    var candidate = new Date(y, monthIndex, day);
    if (candidate.getTime() - now.getTime() > 14 * 86400000) return y - 1;
    return y;
  }

  function parseDateToken(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;

    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return toIsoDate(+iso[1], +iso[2] - 1, +iso[3]);

    var slash = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (slash) {
      var a = +slash[1], b = +slash[2], y = +slash[3];
      if (y < 100) y += 2000;
      // Prefer M/D/Y (common on Android US notes); if first > 12, treat as D/M/Y
      if (a > 12) return toIsoDate(y, b - 1, a);
      return toIsoDate(y, a - 1, b);
    }

    var mdY = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{2,4}))?$/);
    if (mdY) {
      var mi = MONTHS[mdY[1].toLowerCase()];
      if (mi != null) {
        var day = +mdY[2];
        var year = mdY[3] ? (+mdY[3] < 100 ? 2000 + +mdY[3] : +mdY[3]) : guessYear(mi, day);
        return toIsoDate(year, mi, day);
      }
    }

    var dMy = s.match(/^(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{2,4}))?$/);
    if (dMy) {
      var mi2 = MONTHS[dMy[2].toLowerCase()];
      if (mi2 != null) {
        var day2 = +dMy[1];
        var year2 = dMy[3] ? (+dMy[3] < 100 ? 2000 + +dMy[3] : +dMy[3]) : guessYear(mi2, day2);
        return toIsoDate(year2, mi2, day2);
      }
    }

    return null;
  }

  function detectSessionType(line) {
    var lower = String(line || '').toLowerCase().trim();
    if (!lower) return null;
    var known = [
      ['upper push', 'Upper Push'], ['upper pull', 'Upper Pull'],
      ['full body', 'Full body'], ['strength', 'Strength training'],
      ['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs'],
      ['upper', 'Upper'], ['lower', 'Lower'], ['chest', 'Chest'],
      ['back', 'Back'], ['shoulders', 'Shoulders'], ['arms', 'Arms'],
      ['core', 'Core'], ['cardio', 'Cardio'], ['hiit', 'HIIT'],
      ['mobility', 'Mobility']
    ];
    for (var i = 0; i < known.length; i++) {
      var key = known[i][0];
      // Whole-line or word-boundary match so "Pullups" is not treated as "Pull"
      var re = new RegExp('^(?:.*\\b)?' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\b.*)?$', 'i');
      if (lower === key) return known[i][1];
      // Title-like lines only: short labels, optional "day"/"workout"
      if (lower.length <= 28 && re.test(lower) && !/\d/.test(lower)) {
        var stripped = lower.replace(new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '').replace(/\b(day|workout|session|training)\b/g, '').trim();
        if (!stripped || /^[\-—:|]+$/.test(stripped)) return known[i][1];
      }
    }
    return null;
  }

  function stripDateAndType(line) {
    var rest = String(line || '').trim();
    var date = null;
    var type = null;

    // "2025-03-04 Push Day" / "3/4/25 — Legs"
    var head = rest.match(/^((?:\d{4}-\d{1,2}-\d{1,2})|(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})|(?:[A-Za-z]+\s+\d{1,2}(?:,?\s*\d{2,4})?)|(?:\d{1,2}\s+[A-Za-z]+(?:,?\s*\d{2,4})?))(?:\s*[—\-–:|]\s*|\s+)(.*)$/);
    if (head) {
      date = parseDateToken(head[1]);
      if (date) {
        rest = head[2].trim();
        type = detectSessionType(rest) || (rest ? rest.replace(/\bday\b/i, '').trim() : null);
        if (type && type.length > 40) type = detectSessionType(rest) || 'Strength training';
        return { date: date, type: type || null, rest: '' };
      }
    }

    date = parseDateToken(rest);
    if (date) return { date: date, type: null, rest: '' };

    // Day name + date: "Mon 3/4 Push"
    var dayHead = rest.match(/^((?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)(.+)$/i);
    if (dayHead) {
      var afterDay = stripDateAndType(dayHead[2]);
      if (afterDay.date) return afterDay;
    }

    type = detectSessionType(rest);
    if (type && rest.length < 32) return { date: null, type: type, rest: '' };

    return { date: null, type: null, rest: rest };
  }

  function isHeaderLine(line) {
    var s = String(line || '').trim();
    if (!s) return true;
    if (/^[-—=_*]{3,}$/.test(s)) return true;
    if (/^(workout|session|notes?|log|gym)\b/i.test(s) && s.length < 24) return true;
    var meta = stripDateAndType(s);
    if (meta.date || (meta.type && !meta.rest)) return true;
    if (DAY_NAMES.test(s) && s.length < 28) return true;
    return false;
  }

  function parseWeightUnit(token, defaultUnit) {
    var t = String(token || '').trim().toLowerCase();
    var m = t.match(/^([\d.]+)\s*(kg|lbs?|pounds?)?$/i);
    if (!m) return { weight: '', unit: defaultUnit || 'kg' };
    var unit = defaultUnit || 'kg';
    if (m[2]) {
      if (/lb|pound/i.test(m[2])) unit = 'lb';
      else unit = 'kg';
    }
    return { weight: m[1], unit: unit };
  }

  function summarizeSetLogs(setLogs) {
    var logs = (setLogs || []).filter(function (s) {
      return (s && (s.reps || s.weight));
    });
    var use = logs.length ? logs : (setLogs || []);
    var reps = use.map(function (s) { return String(s.reps || ''); }).filter(Boolean);
    var wts = use.map(function (s) { return String(s.weight || ''); }).filter(Boolean);
    function uniq(arr) {
      return arr.filter(function (v, i) { return arr.indexOf(v) === i; });
    }
    var r = uniq(reps);
    var w = uniq(wts);
    return {
      sets: String(use.length || 0),
      reps: r.length === 1 ? r[0] : (reps.join(', ') || '-'),
      weight: w.length === 1 ? w[0] : (wts.join(', ') || '-')
    };
  }

  function makeExercise(name, setLogs, unit) {
    var sum = summarizeSetLogs(setLogs);
    return {
      name: name,
      sets: sum.sets || '-',
      reps: sum.reps || '-',
      weight: sum.weight || '-',
      unit: unit || 'kg',
      setLogs: (setLogs || []).map(function (s) {
        return {
          reps: String(s.reps || ''),
          weight: String(s.weight || ''),
          rir: String(s.rir || '')
        };
      })
    };
  }

  function parseSetOnlyLine(line, defaultUnit) {
    var s = String(line || '').trim();
    // 135 x 8 / 80kg x 8 @ RIR 2 / 185x5
    var m = s.match(/^([\d.]+)\s*(kg|lbs?|pounds?)?\s*[x×]\s*(\d{1,3})(?:\s*(?:@|rpe|rir)\s*([\d.]+))?$/i);
    if (m) {
      var wu = parseWeightUnit(m[1] + (m[2] || ''), defaultUnit);
      var out = { weight: wu.weight, reps: m[3], rir: '', unit: wu.unit };
      if (m[4] && /rir/i.test(s)) out.rir = m[4];
      return out;
    }
    // Set 1: 135 x 8
    var m2 = s.match(/^set\s*\d+\s*[:.\-]?\s*([\d.]+)\s*(kg|lbs?|pounds?)?\s*[x×]\s*(\d{1,3})/i);
    if (m2) {
      var wu2 = parseWeightUnit(m2[1] + (m2[2] || ''), defaultUnit);
      return { weight: wu2.weight, reps: m2[3], rir: '', unit: wu2.unit };
    }
    return null;
  }

  function expandRepList(weight, repsCsv, countHint, defaultUnit) {
    var wu = parseWeightUnit(weight, defaultUnit);
    var reps = String(repsCsv || '').split(/[,/]+/).map(function (r) { return r.trim(); }).filter(Boolean);
    if (!reps.length && countHint) {
      var n = parseInt(countHint, 10) || 0;
      for (var i = 0; i < n; i++) reps.push('');
    }
    return reps.map(function (r) {
      return { weight: wu.weight, reps: r, rir: '', unit: wu.unit };
    });
  }

  function logsFromSetsRepsWeight(nSets, reps, weight, unit, rir) {
    var logs = [];
    var n = Math.min(12, parseInt(nSets, 10) || 0);
    for (var i = 0; i < n; i++) {
      logs.push({ weight: weight || '', reps: String(reps || ''), rir: rir || '', unit: unit || 'kg' });
    }
    return logs;
  }

  function parseExerciseLine(line, defaultUnit) {
    var s = String(line || '').trim();
    if (!s || isHeaderLine(s)) return null;
    if (parseSetOnlyLine(s, defaultUnit)) return null;

    // Strip leading bullets
    s = s.replace(/^[-•*▪◦]\s+/, '').replace(/^\d+[.)]\s+/, '');
    if (/^\d/.test(s)) return null;

    // 1) Name NxM @W / Name NxM W — sets×reps (N is 1–12). Prefer over weight×reps.
    var setsReps = s.match(/^(.+?)\s+(\d{1,2})\s*[x×]\s*(\d{1,3})\s*(?:@\s*)?([\d.]+)?\s*(kg|lbs?|pounds?)?(?:\s*(?:@|rpe|rir)\s*([\d.]+))?$/i);
    if (setsReps) {
      var nSets = parseInt(setsReps[2], 10);
      var hasAt = /@/.test(s);
      var hasUnit = !!setsReps[5];
      var looksLikeSets = nSets >= 1 && nSets <= 12 && (!/,/.test(setsReps[3])) && (hasAt || hasUnit || setsReps[4] || nSets <= 8);
      // Ambiguous "80x8" with no @ — treat as weight×reps below. Clear sets form: "3x8 @40" or "3x8 40kg"
      if (looksLikeSets && (hasAt || hasUnit || (setsReps[4] && nSets <= 12))) {
        var unitB = defaultUnit || 'kg';
        if (setsReps[5]) unitB = /lb|pound/i.test(setsReps[5]) ? 'lb' : 'kg';
        var rirB = setsReps[6] && /rir/i.test(s) ? setsReps[6] : '';
        var logsB = logsFromSetsRepsWeight(nSets, setsReps[3], setsReps[4] || '', unitB, rirB);
        if (logsB.length) return makeExercise(cleanName(setsReps[1]), logsB, unitB);
      }
    }

    // 2) Name W unit NxM — e.g. Rows 95lb 3x10 / Bench 80 kg 4x8
    var weightThenSets = s.match(/^(.+?)\s+([\d.]+)\s*(kg|lbs?|pounds?)\s+(\d{1,2})\s*[x×]\s*(\d{1,3})$/i);
    if (weightThenSets) {
      var unitW = /lb|pound/i.test(weightThenSets[3]) ? 'lb' : 'kg';
      var logsW = logsFromSetsRepsWeight(weightThenSets[4], weightThenSets[5], weightThenSets[2], unitW, '');
      if (logsW.length) return makeExercise(cleanName(weightThenSets[1]), logsW, unitW);
    }

    // 3) Name WxR,R,R — weight first with comma/slash rep list (Bench 80x8,8,7)
    var weightRepList = s.match(/^(.+?)\s+([\d.]+)\s*(kg|lbs?|pounds?)?\s*[x×]\s*(\d{1,3}(?:\s*[,/]\s*\d{1,3})+)(?:\s*(?:@|rpe)\s*([\d.]+))?$/i);
    if (weightRepList) {
      var setsA = expandRepList(weightRepList[2] + (weightRepList[3] || ''), weightRepList[4], null, defaultUnit);
      if (setsA.length) return makeExercise(cleanName(weightRepList[1]), setsA, setsA[0].unit || defaultUnit);
    }

    // 4) Name WxR — single set weight×reps when weight > 12 (Bench 80x8)
    var weightTimesReps = s.match(/^(.+?)\s+([\d.]+)\s*(kg|lbs?|pounds?)?\s*[x×]\s*(\d{1,3})(?:\s*(?:@|rpe|rir)\s*([\d.]+))?$/i);
    if (weightTimesReps) {
      var wNum = parseFloat(weightTimesReps[2]);
      if (wNum > 12 || weightTimesReps[3]) {
        var wuA = parseWeightUnit(weightTimesReps[2] + (weightTimesReps[3] || ''), defaultUnit);
        var logA = [{ weight: wuA.weight, reps: weightTimesReps[4], rir: weightTimesReps[5] && /rir/i.test(s) ? weightTimesReps[5] : '', unit: wuA.unit }];
        return makeExercise(cleanName(weightTimesReps[1]), logA, wuA.unit);
      }
    }

    // 5) Name NxM with no weight (e.g. Pullups 3x10)
    var setsOnly = s.match(/^(.+?)\s+(\d{1,2})\s*[x×]\s*(\d{1,3})$/i);
    if (setsOnly) {
      var nOnly = parseInt(setsOnly[2], 10);
      if (nOnly >= 1 && nOnly <= 12) {
        var logsO = logsFromSetsRepsWeight(nOnly, setsOnly[3], '', defaultUnit || 'kg', '');
        if (logsO.length) return makeExercise(cleanName(setsOnly[1]), logsO, defaultUnit || 'kg');
      }
    }

    // 6) Name - 135x8, 145x6, 155x5
    var dashed = s.match(/^(.+?)\s*[-:—]\s*(.+)$/);
    if (dashed) {
      var chunks = dashed[2].split(/[,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      var logsC = [];
      var unitC = defaultUnit || 'kg';
      chunks.forEach(function (chunk) {
        var m = chunk.match(/^([\d.]+)\s*(kg|lbs?|pounds?)?\s*[x×]\s*(\d{1,3})$/i);
        if (m) {
          var wu = parseWeightUnit(m[1] + (m[2] || ''), defaultUnit);
          unitC = wu.unit;
          logsC.push({ weight: wu.weight, reps: m[3], rir: '', unit: wu.unit });
        } else {
          var m2 = chunk.match(/^(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*@\s*([\d.]+)\s*(kg|lbs?|pounds?)?)?$/i);
          if (m2) {
            var wu2 = parseWeightUnit((m2[3] || '') + (m2[4] || ''), defaultUnit);
            unitC = wu2.unit || unitC;
            var ns = Math.min(12, parseInt(m2[1], 10) || 1);
            for (var j = 0; j < ns; j++) logsC.push({ weight: wu2.weight, reps: m2[2], rir: '', unit: unitC });
          }
        }
      });
      if (logsC.length) return makeExercise(cleanName(dashed[1]), logsC, unitC);
    }

    // 7) Name W R,R,R  e.g. bench 225 8,8,6
    var spaceReps = s.match(/^(.+?)\s+([\d.]+)\s*(kg|lbs?|pounds?)?\s+(\d{1,3}(?:\s*[,/]\s*\d{1,3})+)$/i);
    if (spaceReps) {
      var setsD = expandRepList(spaceReps[2] + (spaceReps[3] || ''), spaceReps[4], null, defaultUnit);
      if (setsD.length) return makeExercise(cleanName(spaceReps[1]), setsD, setsD[0].unit || defaultUnit);
    }

    // Bare exercise name (sets may follow on next lines)
    if (/^[A-Za-z][A-Za-z0-9 +\/&'()\-]{1,60}$/.test(s) && !detectSessionType(s)) {
      return { name: cleanName(s), sets: '-', reps: '-', weight: '-', unit: defaultUnit || 'kg', setLogs: [], _pendingSets: true };
    }

    return null;
  }

  function cleanName(name) {
    return String(name || '')
      .replace(/^[-•*▪◦]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function newSession(date, type, defaultUnit) {
    return {
      date: date || null,
      type: type || 'Strength training',
      duration: 60,
      rpe: 7,
      notes: '',
      exercises: [],
      unit: defaultUnit || 'kg',
      include: true
    };
  }

  /**
   * Parse freeform workout notes into structured sessions.
   * @param {string} text
   * @param {{unit?: string, defaultDate?: string}} opts
   * @returns {{sessions: Array, warnings: string[], rawLineCount: number}}
   */
  function parseWorkoutNotes(text, opts) {
    opts = opts || {};
    var defaultUnit = opts.unit === 'lb' ? 'lb' : 'kg';
    var defaultDate = opts.defaultDate || null;
    var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var sessions = [];
    var current = null;
    var warnings = [];
    var pendingEx = null;
    var rawLineCount = 0;

    function ensureSession(dateHint, typeHint) {
      if (!current) {
        current = newSession(dateHint || defaultDate, typeHint, defaultUnit);
        sessions.push(current);
      } else {
        if (dateHint && !current.date) current.date = dateHint;
        if (typeHint && (current.type === 'Strength training' || !current.exercises.length)) {
          current.type = typeHint;
        }
      }
      return current;
    }

    function startNewSession(dateHint, typeHint) {
      pendingEx = null;
      current = newSession(dateHint || defaultDate, typeHint, defaultUnit);
      sessions.push(current);
      return current;
    }

    function commitPending() {
      if (pendingEx) {
        if (pendingEx._pendingSets) delete pendingEx._pendingSets;
        var sum = summarizeSetLogs(pendingEx.setLogs);
        pendingEx.sets = sum.sets || pendingEx.sets || '-';
        pendingEx.reps = sum.reps || pendingEx.reps || '-';
        pendingEx.weight = sum.weight || pendingEx.weight || '-';
        ensureSession().exercises.push(pendingEx);
        pendingEx = null;
      }
    }

    lines.forEach(function (rawLine) {
      var line = String(rawLine || '').trim();
      if (!line) {
        commitPending();
        return;
      }
      rawLineCount++;

      var meta = stripDateAndType(line);
      if (meta.date || (meta.type && !meta.rest)) {
        commitPending();
        var needsNew = !current || current.exercises.length > 0 || (meta.date && current.date && current.date !== meta.date);
        if (needsNew) startNewSession(meta.date, meta.type);
        else {
          if (meta.date) current.date = meta.date;
          if (meta.type) current.type = meta.type;
        }
        return;
      }

      var setOnly = parseSetOnlyLine(line, defaultUnit);
      if (setOnly && pendingEx) {
        pendingEx.setLogs.push({
          reps: setOnly.reps,
          weight: setOnly.weight,
          rir: setOnly.rir || ''
        });
        pendingEx.unit = setOnly.unit || pendingEx.unit;
        delete pendingEx._pendingSets;
        return;
      }

      var ex = parseExerciseLine(line, defaultUnit);
      if (ex) {
        commitPending();
        ensureSession();
        if (ex._pendingSets) {
          pendingEx = ex;
        } else {
          current.exercises.push(ex);
        }
        return;
      }

      // Trailing notes on a session
      if (current && /^(note|notes|rpe|felt|energy|comment)s?\b/i.test(line)) {
        var noteText = line.replace(/^(note|notes|rpe|felt|energy|comment)s?\s*[:\-–]?\s*/i, '');
        var rpeMatch = line.match(/\brpe\s*[:=]?\s*(\d{1,2})\b/i);
        if (rpeMatch) current.rpe = Math.min(10, Math.max(1, parseInt(rpeMatch[1], 10)));
        if (noteText && !/^rpe\b/i.test(noteText)) {
          current.notes = (current.notes ? current.notes + ' ' : '') + noteText;
        }
        return;
      }

      warnings.push('Could not parse: ' + line.slice(0, 80));
    });

    commitPending();

    // Drop empty sessions; fill missing dates
    sessions = sessions.filter(function (s) { return s.exercises && s.exercises.length; });
    sessions.forEach(function (s, idx) {
      if (!s.date) {
        s.date = defaultDate || dateOffset(idx);
        warnings.push('Session ' + (idx + 1) + ' had no date — used ' + s.date);
      }
      // Drop empty pending exercises
      s.exercises = s.exercises.filter(function (e) {
        return e && e.name && ((e.setLogs && e.setLogs.length) || e.sets !== '-');
      });
      // Keep name-only exercises if somehow still present with no sets — still useful
      if (!s.exercises.length) return;
    });
    sessions = sessions.filter(function (s) { return s.exercises && s.exercises.length; });

    return {
      sessions: sessions,
      warnings: warnings.slice(0, 20),
      rawLineCount: rawLineCount
    };
  }

  function dateOffset(daysBack) {
    var d = new Date();
    d.setDate(d.getDate() - (daysBack || 0));
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function formatSessionSummary(session) {
    var exCount = (session.exercises || []).length;
    var setCount = (session.exercises || []).reduce(function (n, e) {
      return n + ((e.setLogs && e.setLogs.length) || parseInt(e.sets, 10) || 0);
    }, 0);
    return exCount + ' exercise' + (exCount === 1 ? '' : 's') + ' · ' + setCount + ' set' + (setCount === 1 ? '' : 's');
  }

  var api = {
    parseWorkoutNotes: parseWorkoutNotes,
    parseExerciseLine: parseExerciseLine,
    parseDateToken: parseDateToken,
    formatSessionSummary: formatSessionSummary,
    SESSION_TYPES: SESSION_TYPES
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.FitTrackNotesImport = api;
})(typeof window !== 'undefined' ? window : global);
