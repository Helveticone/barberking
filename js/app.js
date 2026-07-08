(function () {
  "use strict";

  /* =========================================================
     Horaires du salon (0 = dimanche ... 6 = samedi)
     Chaque jour peut avoir plusieurs créneaux [début, fin] en minutes.
  ========================================================= */
  var HOURS = {
    0: [],                          // dimanche : fermé
    1: [[13 * 60, 18 * 60 + 30]],   // lundi
    2: [[9 * 60, 18 * 60 + 30]],    // mardi
    3: [[9 * 60, 18 * 60 + 30]],    // mercredi
    4: [[9 * 60, 18 * 60 + 30]],    // jeudi
    5: [[9 * 60, 12 * 60], [13 * 60 + 30, 18 * 60 + 30]], // vendredi
    6: [[8 * 60 + 30, 17 * 60]]     // samedi
  };

  var DAY_NAMES = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

  function formatMinutes(m) {
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return h + "h" + (mm ? (mm < 10 ? "0" + mm : mm) : "00");
  }

  function formatDayHours(day) {
    var slots = HOURS[day] || [];
    if (!slots.length) return "Fermé aujourd'hui";
    return slots.map(function (s) {
      return formatMinutes(s[0]) + " – " + formatMinutes(s[1]);
    }).join(" / ");
  }

  function nowInZurich() {
    // Calcule l'heure locale de Delémont (Europe/Zurich) quel que soit
    // le fuseau horaire de l'appareil du visiteur.
    var fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    var parts = fmt.formatToParts(new Date());
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    var dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var day = dayMap[map.weekday];
    var minutes = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);
    return { day: day, minutes: minutes };
  }

  function computeStatus() {
    var t = nowInZurich();
    var slots = HOURS[t.day] || [];
    for (var i = 0; i < slots.length; i++) {
      if (t.minutes >= slots[i][0] && t.minutes < slots[i][1]) {
        var closeH = Math.floor(slots[i][1] / 60);
        var closeM = slots[i][1] % 60;
        return {
          open: true,
          label: "Ouvert — ferme à " + closeH + "h" + (closeM ? closeM : "00")
        };
      }
    }
    return { open: false, label: "Fermé actuellement" };
  }

  function initStatus() {
    var chip = document.getElementById("statusChip");
    var text = document.getElementById("statusText");
    if (!chip || !text) return;
    try {
      var s = computeStatus();
      text.textContent = s.label;
      chip.classList.add(s.open ? "is-open" : "is-closed");
    } catch (e) {
      text.textContent = "Voir les horaires ci-dessous";
    }
  }

  function highlightToday() {
    try {
      var t = nowInZurich();
      var row = document.querySelector('#hoursTable tr[data-day="' + t.day + '"]');
      if (row) row.classList.add("is-today");
    } catch (e) { /* silencieux */ }
  }

  function initTodayCard() {
    var dayEl = document.getElementById("todayDayName");
    var hoursEl = document.getElementById("todayHoursText");
    var pill = document.getElementById("todayStatusPill");
    var statusText = document.getElementById("todayStatusText");
    if (!dayEl || !hoursEl || !pill || !statusText) return;
    try {
      var t = nowInZurich();
      dayEl.textContent = DAY_NAMES[t.day];
      hoursEl.textContent = formatDayHours(t.day);
      var s = computeStatus();
      pill.classList.add(s.open ? "is-open" : "is-closed");
      statusText.textContent = s.open ? "Ouvert maintenant" : "Fermé actuellement";
    } catch (e) {
      dayEl.textContent = "Horaires";
      hoursEl.textContent = "Voir le tableau ci-contre";
    }
  }

  /* =========================================================
     Header : ombre au scroll
  ========================================================= */
  function initHeaderScroll() {
    var header = document.getElementById("siteHeader");
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* =========================================================
     Menu mobile
  ========================================================= */
  function initNavToggle() {
    var btn = document.getElementById("navToggle");
    var nav = document.getElementById("mainNav");
    if (!btn || !nav) return;
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* =========================================================
     Révélation au scroll (discrète, respecte prefers-reduced-motion)
  ========================================================= */
  function initReveal() {
    var targets = document.querySelectorAll(".card, .gallery__item, .contact-card, .split__media, .split__text");
    if (!("IntersectionObserver" in window) || !targets.length) return;
    targets.forEach(function (el) { el.setAttribute("data-reveal", ""); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    targets.forEach(function (el) { io.observe(el); });
  }

  function initYear() {
    var y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initStatus();
    highlightToday();
    initTodayCard();
    initHeaderScroll();
    initNavToggle();
    initReveal();
    initYear();
  });
})();
