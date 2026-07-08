/**
 * Barber King — Worker principal
 * ---------------------------------------------------------------
 * - Sert le site statique (via env.ASSETS, fallback automatique).
 * - Expose une API sous /api/* pour la réservation, l'espace client
 *   (annulation) et l'espace admin (planning de Hassan).
 * - Le handler `scheduled` (cron, voir wrangler.toml) envoie les
 *   rappels WhatsApp la veille de chaque rendez-vous.
 *
 * Toutes les heures sont stockées en UTC dans la base D1. Les
 * fonctions zurichToUTC() / utcToZurichParts() font la conversion
 * avec l'heure de Delémont (Europe/Zurich), DST inclus.
 */

const TIMEZONE = "Europe/Zurich";
const SLOT_STEP_MINUTES = 15;
const LEAD_TIME_MINUTES = 30; // pas de réservation dans les 30 prochaines minutes
const BOOKING_HORIZON_DAYS = 30; // le client peut réserver jusqu'à 30 jours à l'avance

// ---------------------------------------------------------------
// Utilitaires date / fuseau horaire
// ---------------------------------------------------------------

function pad(n) { return n < 10 ? "0" + n : String(n); }

/** Décompose un instant UTC en champs Europe/Zurich {year,month,day,hour,minute,weekday}. */
function utcToZurichParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false
  });
  const parts = {};
  fmt.formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    weekday: dayMap[parts.weekday]
  };
}

/**
 * Convertit une date locale de Zurich ("YYYY-MM-DD" + minutes depuis
 * minuit) en instant UTC (objet Date). Méthode "deviner puis corriger"
 * qui gère correctement le passage heure d'été / hiver.
 */
function zurichToUTC(dateStr, minutesFromMidnight) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const targetH = Math.floor(minutesFromMidnight / 60);
  const targetM = minutesFromMidnight % 60;

  let guess = Date.UTC(y, m - 1, d, targetH, targetM);
  for (let i = 0; i < 3; i++) {
    const shown = utcToZurichParts(new Date(guess));
    const shownMinutes = shown.hour * 60 + shown.minute;
    const sameDay = shown.year === y && shown.month === m && shown.day === d;
    const diff = sameDay
      ? (targetH * 60 + targetM) - shownMinutes
      : ((y === shown.year && m === shown.month) ? (d - shown.day) * 1440 : 0) + (targetH * 60 + targetM) - shownMinutes;
    if (diff === 0) break;
    guess += diff * 60000;
  }
  return new Date(guess);
}

function zurichDateStr(date) {
  const p = utcToZurichParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function isoDatePlusDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// ---------------------------------------------------------------
// Réponses JSON
// ---------------------------------------------------------------

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function badRequest(message) { return json({ error: message }, 400); }
function notFound(message = "Introuvable") { return json({ error: message }, 404); }
function unauthorized() { return json({ error: "Non autorisé" }, 401); }

// ---------------------------------------------------------------
// Petits utilitaires sécurité / tokens
// ---------------------------------------------------------------

function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizePhone(raw) {
  let digits = String(raw || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "41" + digits.slice(1);
  if (!digits.startsWith("41") && digits.length === 9) digits = "41" + digits;
  return digits;
}

// ---------------------------------------------------------------
// WhatsApp Cloud API (Meta) — avec repli automatique
// ---------------------------------------------------------------
//
// L'API WhatsApp Business n'autorise l'envoi de texte libre que dans
// les 24h suivant un message du client. Pour une confirmation ou un
// rappel envoyés par le salon, il faut un "message modèle" (template)
// pré-approuvé par Meta. Tant que WHATSAPP_TOKEN /
// WHATSAPP_PHONE_NUMBER_ID / les noms de templates ne sont pas
// configurés (ou si l'envoi échoue), on fournit un lien wa.me en
// repli : rien n'est jamais bloqué côté client.

function buildWaLink(toNumber, text) {
  return `https://wa.me/${toNumber}?text=${encodeURIComponent(text)}`;
}

async function sendWhatsAppTemplate(env, toNumber, templateName, bodyParams) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !templateName) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toNumber,
        type: "template",
        template: {
          name: templateName,
          language: { code: "fr" },
          components: [{
            type: "body",
            parameters: bodyParams.map((p) => ({ type: "text", text: String(p) }))
          }]
        }
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("WhatsApp send failed:", res.status, errText);
      return { ok: false, reason: "api_error", status: res.status };
    }
    return { ok: true };
  } catch (e) {
    console.error("WhatsApp send exception:", e);
    return { ok: false, reason: "exception" };
  }
}

// ---------------------------------------------------------------
// Disponibilités
// ---------------------------------------------------------------

async function computeAvailableSlots(env, barberId, dateStr, durationMinutes) {
  const now = new Date();
  const todayZurich = zurichDateStr(now);
  if (dateStr < todayZurich) return [];
  const horizon = isoDatePlusDays(todayZurich, BOOKING_HORIZON_DAYS);
  if (dateStr > horizon) return [];

  const weekday = zurichToUTC(dateStr, 12 * 60); // midi ce jour-là, pour lire le bon jour de semaine
  const wd = utcToZurichParts(weekday).weekday;

  const hours = await env.DB.prepare(
    "SELECT start_minutes, end_minutes FROM working_hours WHERE barber_id = ? AND weekday = ? ORDER BY start_minutes"
  ).bind(barberId, wd).all();
  if (!hours.results || hours.results.length === 0) return [];

  const dayStartUTC = zurichToUTC(dateStr, 0);
  const dayEndUTC = zurichToUTC(dateStr, 24 * 60);

  const apptRows = await env.DB.prepare(
    "SELECT start_at, end_at FROM appointments WHERE barber_id = ? AND status = 'confirmed' AND start_at < ? AND end_at > ?"
  ).bind(barberId, dayEndUTC.toISOString(), dayStartUTC.toISOString()).all();

  const blockRows = await env.DB.prepare(
    "SELECT start_at, end_at FROM blocks WHERE barber_id = ? AND start_at < ? AND end_at > ?"
  ).bind(barberId, dayEndUTC.toISOString(), dayStartUTC.toISOString()).all();

  const busy = [
    ...(apptRows.results || []).map((r) => ({ start: new Date(r.start_at), end: new Date(r.end_at) })),
    ...(blockRows.results || []).map((r) => ({ start: new Date(r.start_at), end: new Date(r.end_at) }))
  ];

  const earliestAllowed = new Date(now.getTime() + LEAD_TIME_MINUTES * 60000);
  const slots = [];

  for (const range of hours.results) {
    for (let t = range.start_minutes; t + durationMinutes <= range.end_minutes; t += SLOT_STEP_MINUTES) {
      const slotStart = zurichToUTC(dateStr, t);
      const slotEnd = zurichToUTC(dateStr, t + durationMinutes);
      if (slotStart < earliestAllowed) continue;
      const clash = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
      if (clash) continue;
      slots.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
    }
  }
  return slots;
}

// ---------------------------------------------------------------
// Espace admin : session
// ---------------------------------------------------------------

async function requireAdmin(request, env) {
  const token = getCookie(request, "bk_admin");
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT expires_at FROM admin_sessions WHERE token = ?"
  ).bind(token).first();
  if (!row) return false;
  return new Date(row.expires_at) > new Date();
}

// ---------------------------------------------------------------
// Routes API
// ---------------------------------------------------------------

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api/, "");
  const method = request.method;

  // --- Public : services -------------------------------------------------
  if (path === "/services" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, name, price_chf, duration_minutes FROM services WHERE active = 1 ORDER BY sort_order"
    ).all();
    return json(rows.results || []);
  }

  // --- Public : disponibilités --------------------------------------------
  if (path === "/availability" && method === "GET") {
    const date = url.searchParams.get("date");
    const serviceId = parseInt(url.searchParams.get("serviceId"), 10);
    const barberId = parseInt(url.searchParams.get("barberId") || "1", 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !serviceId) {
      return badRequest("Paramètres manquants (date, serviceId).");
    }
    const service = await env.DB.prepare(
      "SELECT duration_minutes FROM services WHERE id = ? AND active = 1"
    ).bind(serviceId).first();
    if (!service) return badRequest("Prestation inconnue.");

    const slots = await computeAvailableSlots(env, barberId, date, service.duration_minutes);
    return json({ date, slots });
  }

  // --- Public : créer un rendez-vous --------------------------------------
  if (path === "/appointments" && method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return badRequest("JSON invalide."); }

    const { serviceId, date, time, clientName, clientPhone } = body;
    const barberId = parseInt(body.barberId || 1, 10);
    const name = String(clientName || "").trim();
    const phone = normalizePhone(clientPhone);

    if (!serviceId || !date || !time || !name || phone.length < 10) {
      return badRequest("Merci de renseigner la prestation, la date, l'heure, votre nom et votre téléphone.");
    }

    const service = await env.DB.prepare(
      "SELECT id, name, price_chf, duration_minutes FROM services WHERE id = ? AND active = 1"
    ).bind(serviceId).first();
    if (!service) return badRequest("Prestation inconnue.");

    const barber = await env.DB.prepare(
      "SELECT id, name, whatsapp_number FROM barbers WHERE id = ? AND active = 1"
    ).bind(barberId).first();
    if (!barber) return badRequest("Barbier inconnu.");

    const [hh, mm] = String(time).split(":").map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return badRequest("Heure invalide.");
    const minutesFromMidnight = hh * 60 + mm;

    // On revérifie la disponibilité juste avant d'insérer (évite la
    // plupart des doubles réservations en cas de double clic / course).
    const stillFree = (await computeAvailableSlots(env, barberId, date, service.duration_minutes))
      .includes(time);
    if (!stillFree) {
      return json({ error: "Ce créneau vient d'être pris. Merci d'en choisir un autre.", slotTaken: true }, 409);
    }

    const startAt = zurichToUTC(date, minutesFromMidnight);
    const endAt = zurichToUTC(date, minutesFromMidnight + service.duration_minutes);
    const manageToken = randomToken(20);

    await env.DB.prepare(
      `INSERT INTO appointments
        (barber_id, service_id, client_name, client_phone, start_at, end_at, status, manage_token)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)`
    ).bind(barberId, service.id, name, phone, startAt.toISOString(), endAt.toISOString(), manageToken).run();

    const manageUrl = `${url.origin}/gerer.html?token=${manageToken}`;
    const dateLabel = new Intl.DateTimeFormat("fr-CH", {
      timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "long"
    }).format(startAt);

    const waResult = await sendWhatsAppTemplate(
      env, barber.whatsapp_number || "", // notification interne éventuelle : désactivée par défaut
      null, []
    );
    // Confirmation envoyée AU CLIENT (numéro renseigné dans le formulaire) :
    const clientConfirmText =
      `Bonjour ${name} 👋\nVotre rendez-vous chez Barber King est confirmé :\n` +
      `${service.name} — ${dateLabel} à ${time}\nAvec ${barber.name}.\n` +
      `Pour annuler ou modifier : ${manageUrl}\nÀ bientôt !`;

    const sendResult = await sendWhatsAppTemplate(
      env, phone, env.WHATSAPP_TEMPLATE_CONFIRM,
      [name, service.name, dateLabel, time, manageUrl]
    );

    await env.DB.prepare("UPDATE appointments SET whatsapp_confirm_sent = ? WHERE manage_token = ?")
      .bind(sendResult.ok ? 1 : 0, manageToken).run();

    return json({
      success: true,
      appointment: { service: service.name, date, time, barber: barber.name, manageUrl },
      whatsapp: sendResult.ok
        ? { sent: true }
        : { sent: false, fallbackUrl: buildWaLink(barber.whatsapp_number, clientConfirmText) }
    });
  }

  // --- Public : voir / annuler un rendez-vous via son lien ----------------
  const manageMatch = path.match(/^\/appointments\/manage\/([a-f0-9]+)$/);
  if (manageMatch && method === "GET") {
    const appt = await env.DB.prepare(
      `SELECT a.id, a.client_name, a.start_at, a.end_at, a.status, s.name AS service_name, b.name AS barber_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN barbers b ON b.id = a.barber_id
       WHERE a.manage_token = ?`
    ).bind(manageMatch[1]).first();
    if (!appt) return notFound("Rendez-vous introuvable.");
    return json(appt);
  }
  const cancelMatch = path.match(/^\/appointments\/manage\/([a-f0-9]+)\/cancel$/);
  if (cancelMatch && method === "POST") {
    const result = await env.DB.prepare(
      "UPDATE appointments SET status = 'cancelled' WHERE manage_token = ? AND status = 'confirmed'"
    ).bind(cancelMatch[1]).run();
    if (!result.meta || result.meta.changes === 0) {
      return notFound("Rendez-vous introuvable ou déjà annulé.");
    }
    return json({ success: true });
  }

  // --- Admin : connexion ---------------------------------------------------
  if (path === "/admin/login" && method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return badRequest("JSON invalide."); }
    if (!env.ADMIN_PASSWORD || !timingSafeEqual(String(body.password || ""), env.ADMIN_PASSWORD)) {
      return unauthorized();
    }
    const token = randomToken(24);
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await env.DB.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
      .bind(token, expires.toISOString()).run();
    return json({ success: true }, 200, {
      "Set-Cookie": `bk_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
    });
  }
  if (path === "/admin/logout" && method === "POST") {
    const token = getCookie(request, "bk_admin");
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
    return json({ success: true }, 200, {
      "Set-Cookie": "bk_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    });
  }

  // --- Admin : tout le reste nécessite une session valide -------------------
  if (path.startsWith("/admin/")) {
    const ok = await requireAdmin(request, env);
    if (!ok) return unauthorized();

    if (path === "/admin/barbers" && method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, name FROM barbers WHERE active = 1 ORDER BY id"
      ).all();
      return json(rows.results || []);
    }

    if (path === "/admin/appointments" && method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const rows = await env.DB.prepare(
        `SELECT a.id, a.barber_id, a.client_name, a.client_phone, a.start_at, a.end_at, a.status,
                a.service_id, s.name AS service_name, s.price_chf
         FROM appointments a JOIN services s ON s.id = a.service_id
         WHERE a.start_at >= ? AND a.start_at < ? AND a.status = 'confirmed'
         ORDER BY a.start_at`
      ).bind(from, to).all();
      return json(rows.results || []);
    }

    const apptCancel = path.match(/^\/admin\/appointments\/(\d+)\/cancel$/);
    if (apptCancel && method === "POST") {
      await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?")
        .bind(apptCancel[1]).run();
      return json({ success: true });
    }

    if (path === "/admin/blocks" && method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const rows = await env.DB.prepare(
        "SELECT id, barber_id, start_at, end_at, reason FROM blocks WHERE start_at < ? AND end_at > ? ORDER BY start_at"
      ).bind(to, from).all();
      return json(rows.results || []);
    }
    if (path === "/admin/blocks" && method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return badRequest("JSON invalide."); }
      const { date, startTime, endTime, reason } = body;
      if (!date || !startTime || !endTime) return badRequest("Date/heures manquantes.");
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      const startAt = zurichToUTC(date, sh * 60 + sm);
      const endAt = zurichToUTC(date, eh * 60 + em);
      const barberId = parseInt(body.barberId || 1, 10);
      await env.DB.prepare(
        "INSERT INTO blocks (barber_id, start_at, end_at, reason) VALUES (?, ?, ?, ?)"
      ).bind(barberId, startAt.toISOString(), endAt.toISOString(), reason || "").run();
      return json({ success: true });
    }
    const blockDelete = path.match(/^\/admin\/blocks\/(\d+)$/);
    if (blockDelete && method === "DELETE") {
      await env.DB.prepare("DELETE FROM blocks WHERE id = ?").bind(blockDelete[1]).run();
      return json({ success: true });
    }
  }

  return notFound();
}

// ---------------------------------------------------------------
// Tâche planifiée : rappels WhatsApp la veille du rendez-vous
// ---------------------------------------------------------------

async function sendReminders(env) {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 3600 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 3600 * 1000);

  const rows = await env.DB.prepare(
    `SELECT a.id, a.client_phone, a.client_name, a.start_at, s.name AS service_name, b.name AS barber_name
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN barbers b ON b.id = a.barber_id
     WHERE a.status = 'confirmed' AND a.reminder_sent = 0
       AND a.start_at >= ? AND a.start_at < ?`
  ).bind(windowStart.toISOString(), windowEnd.toISOString()).all();

  for (const appt of rows.results || []) {
    const start = new Date(appt.start_at);
    const timeLabel = new Intl.DateTimeFormat("fr-CH", {
      timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit"
    }).format(start);

    const result = await sendWhatsAppTemplate(
      env, appt.client_phone, env.WHATSAPP_TEMPLATE_REMINDER,
      [appt.client_name, timeLabel, appt.service_name]
    );
    if (result.ok) {
      await env.DB.prepare("UPDATE appointments SET reminder_sent = 1 WHERE id = ?").bind(appt.id).run();
    }
  }
}

// ---------------------------------------------------------------
// Entrée du Worker
// ---------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error("Erreur API:", err);
        return json({ error: "Erreur serveur." }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  }
};
