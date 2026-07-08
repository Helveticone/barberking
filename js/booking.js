(function () {
  "use strict";

  var BARBER_ID = 1; // Hassan. Pour un futur 2e barbier : ajouter un sélecteur
                      // qui change cette valeur avant l'appel à /api/availability.

  var state = {
    serviceId: null,
    serviceName: null,
    servicePrice: null,
    date: null,
    time: null
  };

  var els = {};

  function todayZurichISO() {
    var fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }); // en-CA => YYYY-MM-DD
    return fmt.format(new Date());
  }

  function addDaysISO(iso, days) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function setLoadingState(isLoading) {
    els.widget.setAttribute("data-state", isLoading ? "loading" : "ready");
  }

  async function loadServices() {
    els.serviceOptions.innerHTML = "";
    try {
      var res = await fetch("/api/services");
      if (!res.ok) throw new Error("services_error");
      var services = await res.json();
      if (!services.length) {
        els.serviceOptions.innerHTML = "<p class=\"booking__hint\">Aucune prestation disponible pour le moment.</p>";
        return;
      }
      services.forEach(function (s) {
        var pill = document.createElement("button");
        pill.type = "button";
        pill.className = "pill";
        pill.setAttribute("data-service-id", s.id);
        pill.setAttribute("data-duration", s.duration_minutes);
        pill.setAttribute("aria-pressed", "false");
        pill.innerHTML = escapeHtml(s.name) + " <em>" + s.price_chf.toFixed(0) + ".-</em>";
        els.serviceOptions.appendChild(pill);
      });
      els.dateInput.disabled = false;
      var min = todayZurichISO();
      els.dateInput.min = min;
      els.dateInput.max = addDaysISO(min, 30);
    } catch (e) {
      els.serviceOptions.innerHTML = "<p class=\"booking__hint\">Impossible de charger les prestations. Rechargez la page ou appelez le salon.</p>";
    } finally {
      setLoadingState(false);
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function selectServicePill(pill) {
    els.serviceOptions.querySelectorAll(".pill").forEach(function (p) {
      p.setAttribute("aria-pressed", p === pill ? "true" : "false");
    });
    state.serviceId = parseInt(pill.getAttribute("data-service-id"), 10);
    state.serviceName = pill.textContent.replace(/\s+/g, " ").trim();
    state.time = null;
    els.slotsOptions.innerHTML = "";
    if (els.dateInput.value) {
      loadSlots();
    } else {
      els.slotsMessage.textContent = "Choisissez maintenant une date.";
      els.slotsMessage.hidden = false;
    }
    updateSummary();
  }

  async function loadSlots() {
    if (!state.serviceId || !els.dateInput.value) return;
    state.date = els.dateInput.value;
    state.time = null;
    els.slotsOptions.innerHTML = "<p class=\"booking__hint\">Recherche des créneaux…</p>";
    els.slotsMessage.hidden = true;
    updateSummary();

    try {
      var url = "/api/availability?date=" + encodeURIComponent(state.date) + "&serviceId=" + state.serviceId + "&barberId=" + BARBER_ID;
      var res = await fetch(url);
      var data = await res.json();
      els.slotsOptions.innerHTML = "";

      if (!res.ok) {
        els.slotsMessage.textContent = data.error || "Impossible de charger les créneaux.";
        els.slotsMessage.hidden = false;
        return;
      }
      if (!data.slots || data.slots.length === 0) {
        els.slotsMessage.textContent = "Aucun créneau libre ce jour-là. Essayez une autre date.";
        els.slotsMessage.hidden = false;
        return;
      }
      data.slots.forEach(function (time) {
        var pill = document.createElement("button");
        pill.type = "button";
        pill.className = "pill";
        pill.setAttribute("data-time", time);
        pill.setAttribute("aria-pressed", "false");
        pill.textContent = time;
        els.slotsOptions.appendChild(pill);
      });
    } catch (e) {
      els.slotsMessage.textContent = "Erreur réseau. Réessayez.";
      els.slotsMessage.hidden = false;
    }
  }

  function selectSlotPill(pill) {
    els.slotsOptions.querySelectorAll(".pill").forEach(function (p) {
      p.setAttribute("aria-pressed", p === pill ? "true" : "false");
    });
    state.time = pill.getAttribute("data-time");
    updateSummary();
  }

  function currentName() { return els.nameInput.value.trim(); }
  function currentPhone() { return els.phoneInput.value.trim(); }

  function isComplete() {
    return !!(state.serviceId && state.date && state.time && currentName() && currentPhone().length >= 9);
  }

  function updateSummary() {
    if (!isComplete()) {
      var missing = [];
      if (!state.serviceId) missing.push("une prestation");
      else if (!state.time) missing.push("un créneau");
      if (!currentName()) missing.push("votre nom");
      if (currentPhone().length < 9) missing.push("votre téléphone");
      els.summaryText.textContent = "Encore à renseigner : " + missing.join(", ") + ".";
      els.confirmBtn.disabled = true;
      els.confirmBtn.classList.add("btn--disabled");
      return;
    }
    var dateLabel = new Intl.DateTimeFormat("fr-CH", {
      timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long"
    }).format(new Date(state.date + "T12:00:00Z"));
    els.summaryText.textContent =
      currentName() + " — " + state.serviceName + ", " + dateLabel + " à " + state.time + ".";
    els.confirmBtn.disabled = false;
    els.confirmBtn.classList.remove("btn--disabled");
  }

  async function submitBooking() {
    if (!isComplete()) return;
    els.confirmBtn.disabled = true;
    els.confirmBtn.textContent = "Envoi en cours…";

    try {
      var res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: state.serviceId,
          barberId: BARBER_ID,
          date: state.date,
          time: state.time,
          clientName: currentName(),
          clientPhone: currentPhone()
        })
      });
      var data = await res.json();

      if (!res.ok) {
        els.summaryText.textContent = data.error || "Une erreur est survenue.";
        els.confirmBtn.disabled = false;
        els.confirmBtn.textContent = "Confirmer le rendez-vous";
        if (data.slotTaken) loadSlots();
        return;
      }

      showConfirmation(data);
    } catch (e) {
      els.summaryText.textContent = "Erreur réseau. Vérifiez votre connexion et réessayez.";
      els.confirmBtn.disabled = false;
      els.confirmBtn.textContent = "Confirmer le rendez-vous";
    }
  }

  function showConfirmation(data) {
    els.widget.querySelectorAll(".booking__step, .booking__summary").forEach(function (el) {
      el.hidden = true;
    });
    var a = data.appointment;
    var dateLabel = new Intl.DateTimeFormat("fr-CH", {
      timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long"
    }).format(new Date(a.date + "T12:00:00Z"));
    els.confirmationDetails.textContent =
      a.service + " avec " + a.barber + " — " + dateLabel + " à " + a.time + ". " +
      "Un message de confirmation vous a été envoyé sur WhatsApp.";

    if (!data.whatsapp.sent && data.whatsapp.fallbackUrl) {
      els.waFallbackLink.href = data.whatsapp.fallbackUrl;
      els.waFallbackLink.hidden = false;
      els.confirmationDetails.textContent =
        a.service + " avec " + a.barber + " — " + dateLabel + " à " + a.time + ". " +
        "Cliquez ci-dessous pour envoyer votre confirmation sur WhatsApp.";
    }
    els.confirmation.hidden = false;
    els.confirmation.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function init() {
    els.widget = document.getElementById("bookingWidget");
    if (!els.widget) return;
    els.serviceOptions = document.getElementById("serviceOptions");
    els.dateInput = document.getElementById("bookingDate");
    els.slotsOptions = document.getElementById("slotsOptions");
    els.slotsMessage = document.getElementById("slotsMessage");
    els.nameInput = document.getElementById("clientName");
    els.phoneInput = document.getElementById("clientPhone");
    els.summaryText = document.getElementById("summaryText");
    els.confirmBtn = document.getElementById("confirmBtn");
    els.confirmation = document.getElementById("bookingConfirmation");
    els.confirmationDetails = document.getElementById("confirmationDetails");
    els.waFallbackLink = document.getElementById("waFallbackLink");

    els.serviceOptions.addEventListener("click", function (e) {
      var pill = e.target.closest(".pill");
      if (pill) selectServicePill(pill);
    });
    els.slotsOptions.addEventListener("click", function (e) {
      var pill = e.target.closest(".pill");
      if (pill) selectSlotPill(pill);
    });
    els.dateInput.addEventListener("change", loadSlots);
    els.nameInput.addEventListener("input", updateSummary);
    els.phoneInput.addEventListener("input", updateSummary);
    els.confirmBtn.addEventListener("click", submitBooking);

    loadServices();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
