/* FitTrack ↔ Supabase data layer */
(function () {
  const SB_URL = 'https://nyrbreouiwbyhhierlcy.supabase.co';
  const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55cmJyZW91aXdieWhoaWVybGN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NDI1NDYsImV4cCI6MjEwNjExODU0Nn0.cbhcBVlCm__8X8JkfYMUvGTnhTmvQhWmPLqHnAIXbrU';

  window.sb = supabase.createClient(SB_URL, SB_ANON);
  window.sbUser = null;
  window.cloudReady = false;
  let persistTimer = null;
  let persisting = false;

  function newId() {
    return crypto.randomUUID();
  }
  window.newId = newId;

  function toAuthEmail(raw) {
    const v = (raw || '').trim().toLowerCase();
    if (!v || !v.includes('@')) return '';
    return v;
  }
  window.toAuthEmail = toAuthEmail;

  function emptyData() {
    return {
      trainer: { id: '', username: '', password: '', name: '', email: '', business_name: '', credentials: '' },
      clients: [],
      schedule: [],
      messages: {},
      workoutLibrary: [],
      calendarConnections: {},
      invoices: [],
      stripeConnected: false,
      subscription: { plan: 'trial', status: 'active' },
      notifications: { trainer: [], clients: {} },
      exerciseVideos: {}
    };
  }
  window.emptyCloudData = emptyData;

  function colorBgFor(color) {
    const map = {
      '#d4f53c': 'rgba(212,245,60,.15)',
      '#00e676': 'rgba(0,230,118,.15)',
      '#5ba4f5': 'rgba(91,164,245,.15)',
      '#f5935b': 'rgba(245,147,91,.15)',
      '#c46bff': 'rgba(196,107,255,.15)',
      '#5bf5a4': 'rgba(91,245,164,.15)',
      '#f55b5b': 'rgba(245,91,91,.15)'
    };
    return map[(color || '').toLowerCase()] || 'rgba(0,230,118,.15)';
  }

  function looksLikeLoginHandle(value, username) {
    const t = String(value || '').trim();
    if (!t) return true;
    if (t.indexOf('@') !== -1) return true;
    const u = String(username || '').trim().toLowerCase();
    return !!(u && t.toLowerCase() === u);
  }

  function humanizeLoginHandle(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const local = raw.indexOf('@') !== -1 ? raw.split('@')[0] : raw;
    if (!/[._\-\s]/.test(local)) return '';
    return local.split(/[._\-\s]+/).filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  function personName(person, fallback) {
    const p = person || {};
    const name = String(p.name || '').trim();
    const username = String(p.username || '').trim();
    const email = String(p.email || '').trim();
    if (name && !looksLikeLoginHandle(name, username)) return name;
    const fromEmail = humanizeLoginHandle(email);
    if (fromEmail) return fromEmail;
    const fromUser = humanizeLoginHandle(username);
    if (fromUser) return fromUser;
    if (name) return name;
    return fallback || 'Client';
  }

  function personFirstName(person, fallback) {
    const full = personName(person, fallback || '');
    if (!full) return fallback || 'there';
    return full.split(/\s+/)[0];
  }

  function personInitials(person) {
    const full = personName(person, '');
    if (!full) return '?';
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  window.personName = personName;
  window.personFirstName = personFirstName;
  window.personInitials = personInitials;

  function mapClient(row, extras) {
    const color = row.color || '#00e676';
    const display = personName(row, 'Client');
    return {
      id: row.id,
      username: row.username || '',
      password: '',
      name: display,
      initials: row.initials && !looksLikeLoginHandle(row.initials, row.username) ? row.initials : personInitials({ name: display, username: row.username, email: row.email }),
      color: color,
      colorBg: row.color_bg || colorBgFor(color),
      goal: row.goal || '',
      age: parseInt(row.age, 10) || 0,
      sessionsPw: row.sessions_per_week || 3,
      medNotes: row.med_notes || '',
      sessions: row.sessions || 0,
      streak: row.streak || 0,
      notes: row.notes || [],
      videos: row.videos || [],
      history: (extras && extras.history) || [],
      assigned: (extras && extras.assigned) || [],
      bodyComp: (extras && extras.bodyComp) || [],
      vo2max: (extras && extras.vo2max) || [],
      pref_unit: row.pref_unit || 'kg',
      email: row.email || ''
    };
  }

  async function invokeFn(name, body) {
    const { data, error } = await window.sb.functions.invoke(name, { body });
    if (error) throw new Error(error.message || 'Request failed');
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  window.invokeFn = invokeFn;

  function asTs(iso) {
    if (!iso) return Date.now();
    const n = Date.parse(iso);
    return isNaN(n) ? Date.now() : n;
  }

  async function hydrateCloud() {
    const { data: { user } } = await window.sb.auth.getUser();
    window.sbUser = user || null;
    if (!user) {
      window.cloudReady = false;
      return null;
    }

    const trainerRes = await window.sb.from('trainers').select('*').eq('id', user.id).maybeSingle();
    const selfClientRes = await window.sb.from('clients').select('*').eq('id', user.id).maybeSingle();
    // A user who is in clients is always a client, even if a trainer row was created by mistake.
    const role = selfClientRes.data ? 'client' : (trainerRes.data ? 'trainer' : null);
    if (!role) return { role: null, user: user };

    const trainerId = role === 'trainer' ? user.id : selfClientRes.data.trainer_id;
    const trainerRow = role === 'trainer' ? trainerRes.data : (await window.sb.from('trainers').select('*').eq('id', trainerId).maybeSingle()).data;

    let clientRows = [];
    if (role === 'trainer') {
      const { data } = await window.sb.from('clients').select('*').eq('trainer_id', user.id);
      clientRows = data || [];
    } else {
      clientRows = [selfClientRes.data];
    }
    const clientIds = clientRows.map(function (c) { return c.id; });

    const [sessRes, msgRes, invRes, libRes, awRes, bcRes, voRes, notifRes] = await Promise.all([
      window.sb.from('sessions').select('*').or(role === 'trainer' ? 'trainer_id.eq.' + user.id : 'client_id.eq.' + user.id),
      clientIds.length ? window.sb.from('messages').select('*').in('client_id', clientIds).order('created_at') : { data: [] },
      window.sb.from('invoices').select('*').or(role === 'trainer' ? 'trainer_id.eq.' + user.id : 'client_id.eq.' + user.id),
      role === 'trainer' ? window.sb.from('workout_library').select('*').eq('trainer_id', user.id) : { data: [] },
      clientIds.length ? window.sb.from('assigned_workouts').select('*').in('client_id', clientIds) : { data: [] },
      clientIds.length ? window.sb.from('body_comp').select('*').in('client_id', clientIds).order('date', { ascending: false }) : { data: [] },
      clientIds.length ? window.sb.from('vo2max').select('*').in('client_id', clientIds).order('date', { ascending: false }) : { data: [] },
      window.sb.from('notifications').select('*').eq('target_id', user.id).order('created_at', { ascending: false })
    ]);

    const sessions = sessRes.data || [];
    const assigned = awRes.data || [];
    const bodyComp = bcRes.data || [];
    const vo2 = voRes.data || [];
    const messages = {};
    (msgRes.data || []).forEach(function (m) {
      if (!messages[m.client_id]) messages[m.client_id] = [];
      messages[m.client_id].push({
        id: m.id,
        sender: m.sender,
        text: m.text,
        ts: asTs(m.created_at)
      });
    });

    const clients = clientRows.map(function (row) {
      const history = sessions.filter(function (s) {
        return s.client_id === row.id && (s.status === 'completed' || s.self_logged);
      }).map(function (s) {
        return {
          id: s.id,
          date: s.date,
          type: s.type || '',
          duration: s.duration || 60,
          rpe: s.rpe,
          notes: s.notes || '',
          exercises: s.exercises || [],
          selfLogged: !!s.self_logged,
          assignedId: s.assigned_id || null
        };
      });
      const assignedList = assigned.filter(function (a) { return a.client_id === row.id; }).map(function (a) {
        return {
          id: a.id,
          title: a.title,
          desc: a.description || '',
          exercises: a.exercises || [],
          completions: a.completions || []
        };
      });
      const bc = bodyComp.filter(function (b) { return b.client_id === row.id; }).map(function (b) {
        const m = b.measurements || {};
        return Object.assign({
          id: b.id,
          date: b.date,
          weight: b.weight,
          bodyFat: b.body_fat,
          muscle: b.muscle,
          unit: b.unit || 'kg'
        }, m);
      });
      const vlist = vo2.filter(function (v) { return v.client_id === row.id; }).map(function (v) {
        return { id: v.id, date: v.date, value: v.value, source: v.source, photo_url: v.photo_url };
      });
      return mapClient(row, { history: history, assigned: assignedList, bodyComp: bc, vo2max: vlist });
    });

    const schedule = sessions.filter(function (s) {
      return s.status !== 'completed' && !s.self_logged;
    }).map(function (s) {
      return {
        id: s.id,
        clientId: s.client_id,
        date: s.date,
        time: s.time || '09:00',
        duration: s.duration || 60,
        type: s.type || '',
        status: s.status || 'confirmed',
        notes: s.notes || ''
      };
    });

    const invoices = (invRes.data || []).map(function (i) {
      return {
        id: i.id,
        clientId: i.client_id,
        desc: i.description,
        amount: Number(i.amount) || 0,
        currency: i.currency || 'USD',
        dueDate: i.due_date,
        notes: i.notes || '',
        serviceType: i.service_type,
        hsaEligible: !!i.hsa_eligible,
        status: i.status || 'draft',
        createdAt: asTs(i.created_at),
        paid_at: i.paid_at
      };
    });

    const workoutLibrary = (libRes.data || []).map(function (t) {
      return {
        id: t.id,
        name: t.name,
        cat: t.category,
        dur: t.duration || 0,
        desc: t.description || '',
        exercises: t.exercises || []
      };
    });

    const notifications = { trainer: [], clients: {} };
    (notifRes.data || []).forEach(function (n) {
      const item = { id: n.id, type: n.type, title: n.title, body: n.body, ts: asTs(n.created_at), read: !!n.read };
      if (n.target_type === 'trainer' || n.target_id === trainerId) notifications.trainer.push(item);
      else {
        if (!notifications.clients[n.target_id]) notifications.clients[n.target_id] = [];
        notifications.clients[n.target_id].push(item);
      }
    });

    const db = emptyData();
    db.trainer = {
      id: trainerRow ? trainerRow.id : trainerId,
      username: trainerRow ? trainerRow.username : '',
      password: '',
      name: trainerRow ? personName(trainerRow, 'Trainer') : '',
      email: trainerRow ? trainerRow.email : '',
      business_name: trainerRow ? trainerRow.business_name : '',
      credentials: trainerRow ? trainerRow.credentials : ''
    };
    db.clients = clients;
    db.schedule = schedule;
    db.messages = messages;
    db.invoices = invoices;
    db.workoutLibrary = workoutLibrary;
    db.notifications = notifications;
    db.stripeConnected = !!(trainerRow && trainerRow.stripe_connected);
    db.subscription = {
      plan: (trainerRow && trainerRow.subscription_plan) || 'trial',
      status: (trainerRow && trainerRow.subscription_status) || 'active'
    };

    window.cloudReady = true;
    return { role: role, user: user, db: db };
  }
  window.hydrateCloud = hydrateCloud;

  function ensureUuid(id) {
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return id;
    return newId();
  }

  async function persistCloud(db) {
    if (!window.sbUser || !window.cloudReady || persisting) return;
    const user = window.sbUser;
    const trainerId = db.trainer && db.trainer.id ? db.trainer.id : (user.id);
    const isTrainer = db.trainer && db.trainer.id === user.id;
    persisting = true;
    try {
      async function must(res, label) {
        if (res && res.error) throw new Error((label ? label + ': ' : '') + res.error.message);
        return res;
      }

      if (isTrainer) {
        await must(await window.sb.from('trainers').upsert({
          id: trainerId,
          name: db.trainer.name,
          username: db.trainer.username,
          email: db.trainer.email || toAuthEmail(db.trainer.username),
          business_name: db.trainer.business_name || null,
          credentials: db.trainer.credentials || null,
          unit: (typeof trainerUnit !== 'undefined' ? trainerUnit : 'kg'),
          stripe_connected: !!db.stripeConnected,
          subscription_plan: (db.subscription && db.subscription.plan) || 'trial',
          subscription_status: (db.subscription && db.subscription.status) || 'active'
        }), 'trainers');
      }

      for (let i = 0; i < db.clients.length; i++) {
        const c = db.clients[i];
        if (!c.id || !/^[0-9a-f-]{36}$/i.test(c.id)) continue;
        const payload = {
          id: c.id,
          trainer_id: trainerId,
          name: c.name,
          username: c.username,
          email: c.email || toAuthEmail(c.username),
          goal: c.goal || null,
          age: c.age != null ? String(c.age) : null,
          sessions_per_week: c.sessionsPw || 3,
          med_notes: c.medNotes || null,
          sessions: c.sessions || 0,
          streak: c.streak || 0,
          color: c.color || null,
          color_bg: c.colorBg || null,
          initials: c.initials || null,
          pref_unit: c.pref_unit || 'kg',
          notes: c.notes || [],
          videos: c.videos || []
        };
        if (isTrainer || c.id === user.id) {
          await window.sb.from('clients').upsert(payload);
        }

        const hist = c.history || [];
        for (let h = 0; h < hist.length; h++) {
          const s = hist[h];
          s.id = ensureUuid(s.id);
          await window.sb.from('sessions').upsert({
            id: s.id,
            trainer_id: trainerId,
            client_id: c.id,
            date: s.date,
            time: s.time || null,
            duration: s.duration || 60,
            type: s.type || null,
            status: 'completed',
            notes: s.notes || null,
            rpe: s.rpe || null,
            exercises: s.exercises || [],
            self_logged: !!s.selfLogged,
            assigned_id: s.assignedId || null
          });
        }

        const keepSessionIds = hist.map(function (s) { return s.id; }).filter(Boolean);
        let sessDel = window.sb.from('sessions').delete().eq('client_id', c.id);
        if (keepSessionIds.length) sessDel = sessDel.not('id', 'in', '(' + keepSessionIds.join(',') + ')');
        await must(await sessDel, 'sessions prune');

        const assigned = c.assigned || [];
        for (let a = 0; a < assigned.length; a++) {
          const w = assigned[a];
          w.id = ensureUuid(w.id);
          await window.sb.from('assigned_workouts').upsert({
            id: w.id,
            client_id: c.id,
            trainer_id: trainerId,
            title: w.title,
            description: w.desc || null,
            exercises: w.exercises || [],
            completions: w.completions || []
          });
        }
        if (isTrainer) {
          const keepAwIds = assigned.map(function (w) { return w.id; }).filter(Boolean);
          let awDel = window.sb.from('assigned_workouts').delete().eq('client_id', c.id);
          if (keepAwIds.length) awDel = awDel.not('id', 'in', '(' + keepAwIds.join(',') + ')');
          await must(await awDel, 'assigned prune');
        }

        const bcs = c.bodyComp || [];
        for (let b = 0; b < bcs.length; b++) {
          const bc = bcs[b];
          bc.id = ensureUuid(bc.id);
          const { error: bcErr } = await window.sb.from('body_comp').upsert({
            id: bc.id,
            client_id: c.id,
            date: bc.date,
            weight: bc.weight || null,
            body_fat: bc.bodyFat || null,
            muscle: bc.muscle || null,
            unit: bc.unit || 'kg',
            measurements: {
              height: bc.height || null,
              chest: bc.chest || null,
              waist: bc.waist || null,
              hips: bc.hips || null,
              thigh: bc.thigh || null,
              arm: bc.arm || null,
              calf: bc.calf || null
            }
          });
          if (bcErr) throw bcErr;
        }

        const vo2s = c.vo2max || [];
        for (let v = 0; v < vo2s.length; v++) {
          const vo = vo2s[v];
          vo.id = ensureUuid(vo.id);
          const { error: voErr } = await window.sb.from('vo2max').upsert({
            id: vo.id,
            client_id: c.id,
            date: vo.date,
            value: vo.value || null,
            source: vo.source || null,
            photo_url: vo.photo_url || null
          });
          if (voErr) throw voErr;
        }
      }

      const sched = db.schedule || [];
      for (let s = 0; s < sched.length; s++) {
        const item = sched[s];
        item.id = ensureUuid(item.id);
        await window.sb.from('sessions').upsert({
          id: item.id,
          trainer_id: trainerId,
          client_id: item.clientId,
          date: item.date,
          time: item.time || null,
          duration: item.duration || 60,
          type: item.type || null,
          status: item.status || 'confirmed',
          notes: item.notes || null,
          exercises: []
        });
      }

      const invoices = db.invoices || [];
      for (let n = 0; n < invoices.length; n++) {
        const inv = invoices[n];
        inv.id = ensureUuid(inv.id);
        if (!isTrainer && inv.clientId !== user.id) continue;
        await window.sb.from('invoices').upsert({
          id: inv.id,
          trainer_id: trainerId,
          client_id: inv.clientId,
          description: inv.desc,
          amount: inv.amount,
          currency: inv.currency || 'USD',
          due_date: inv.dueDate || null,
          status: inv.status || 'draft',
          service_type: inv.serviceType || null,
          hsa_eligible: !!inv.hsaEligible,
          notes: inv.notes || null,
          paid_at: inv.paid_at || null
        });
      }

      if (isTrainer) {
        const lib = db.workoutLibrary || [];
        for (let t = 0; t < lib.length; t++) {
          const tmpl = lib[t];
          tmpl.id = ensureUuid(tmpl.id);
          await window.sb.from('workout_library').upsert({
            id: tmpl.id,
            trainer_id: trainerId,
            name: tmpl.name,
            category: tmpl.cat || null,
            duration: tmpl.dur || null,
            description: tmpl.desc || null,
            exercises: tmpl.exercises || []
          });
        }
      }

      const msgMap = db.messages || {};
      const clientIdList = Object.keys(msgMap);
      for (let m = 0; m < clientIdList.length; m++) {
        const cid = clientIdList[m];
        if (!isTrainer && cid !== user.id) continue;
        const list = msgMap[cid] || [];
        for (let x = 0; x < list.length; x++) {
          const msg = list[x];
          msg.id = ensureUuid(msg.id);
          await window.sb.from('messages').upsert({
            id: msg.id,
            client_id: cid,
            sender: msg.sender,
            text: msg.text
          });
        }
      }

      function upsertNotifs(targetId, targetType, list) {
        return Promise.all((list || []).map(function (n) {
          n.id = ensureUuid(n.id);
          return window.sb.from('notifications').upsert({
            id: n.id,
            target_type: targetType,
            target_id: targetId,
            type: n.type,
            title: n.title,
            body: n.body,
            read: !!n.read
          });
        }));
      }
      if (isTrainer) {
        await upsertNotifs(trainerId, 'trainer', db.notifications && db.notifications.trainer);
      } else {
        try {
          await upsertNotifs(trainerId, 'trainer', db.notifications && db.notifications.trainer);
        } catch (notifErr) {
          console.warn('Trainer notification sync skipped', notifErr);
        }
      }
      const nClients = (db.notifications && db.notifications.clients) || {};
      const nIds = Object.keys(nClients);
      for (let i = 0; i < nIds.length; i++) {
        await upsertNotifs(nIds[i], 'client', nClients[nIds[i]]);
      }
    } catch (err) {
      console.error('FitTrack sync failed', err);
      if (typeof showToast === 'function') showToast('Cloud sync issue — saved on this device');
    } finally {
      persisting = false;
    }
  }
  window.persistCloud = persistCloud;

  window.queueCloudSave = function (db) {
    if (!window.sbUser || !window.cloudReady) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () { persistCloud(db); }, 500);
  };

  window.pullMessages = async function () {
    if (!window.sb || !window.sbUser || typeof DB === 'undefined' || !DB) return;
    const user = window.sbUser;
    const isTrainer = DB.trainer && DB.trainer.id === user.id;
    const clientIds = isTrainer
      ? (DB.clients || []).map(function (c) { return c.id; }).filter(Boolean)
      : [user.id];
    if (!clientIds.length) return;
    const { data, error } = await window.sb.from('messages').select('*').in('client_id', clientIds).order('created_at');
    if (error || !data) return;
    const messages = {};
    data.forEach(function (m) {
      if (!messages[m.client_id]) messages[m.client_id] = [];
      messages[m.client_id].push({
        id: m.id,
        sender: m.sender,
        text: m.text,
        ts: asTs(m.created_at)
      });
    });
    DB.messages = messages;
    if (typeof saveData === 'function') saveData(DB, true);
    if (typeof updateNotifBadges === 'function') updateNotifBadges();
  };

  let msgChannel = null;
  window.startMessageRealtime = function () {
    if (!window.sb) return;
    if (msgChannel) {
      window.sb.removeChannel(msgChannel);
      msgChannel = null;
    }
    msgChannel = window.sb.channel('ft-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, function () {
        window.pullMessages().then(function () {
          const tTab = document.getElementById('t-tab-messages');
          const cTab = document.getElementById('c-tab-messages');
          if (tTab && !tTab.classList.contains('hidden')) {
            if (typeof renderTrainerChatList === 'function') renderTrainerChatList();
            if (typeof renderTrainerMessages === 'function') renderTrainerMessages();
            if (typeof activeTrainerChatId !== 'undefined' && activeTrainerChatId && typeof markChatRead === 'function') markChatRead(activeTrainerChatId);
          }
          if (cTab && !cTab.classList.contains('hidden') && typeof renderClientMessages === 'function') renderClientMessages(false);
        });
      })
      .subscribe();
  };

  window.enterAppFromSession = async function () {
    const result = await hydrateCloud();
    if (!result || !result.role) return false;
    DB = result.db;
    saveData(DB, true);
    if (result.role === 'trainer') {
      currentRole = 'trainer';
      showScreen('screen-trainer');
      initTrainer();
    } else {
      currentRole = 'client';
      currentClientId = result.user.id;
      applyPendingInvite(result.user.id);
      showScreen('screen-client');
      const client = DB.clients.find(function (c) { return c.id === result.user.id; });
      if (client) initClient(client);
    }
    if (typeof startMessageRealtime === 'function') startMessageRealtime();
    return true;
  };
})();
