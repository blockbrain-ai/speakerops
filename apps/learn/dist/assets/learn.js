/* SpeakerOps Learn client — search + mobile nav (no external deps) */
(function () {
  var toggle = document.getElementById("nav-toggle");
  var closeBtn = document.getElementById("nav-close");
  var nav = document.getElementById("learn-nav");
  function setOpen(open) {
    document.body.classList.toggle("nav-open", open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      setOpen(!document.body.classList.contains("nav-open"));
    });
  }
  if (closeBtn) closeBtn.addEventListener("click", function () { setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });

  var input = document.getElementById("learn-search");
  var panel = document.getElementById("search-results");
  var index = null;

  function ensureIndex(cb) {
    if (index) return cb(index);
    fetch("/assets/search-index.json")
      .then(function (r) { return r.json(); })
      .then(function (data) { index = data; cb(index); })
      .catch(function () { index = []; cb(index); });
  }

  function render(hits) {
    if (!panel) return;
    if (!hits.length) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    panel.innerHTML = hits
      .slice(0, 12)
      .map(function (h) {
        return (
          '<a href="' +
          h.path +
          '"><strong>' +
          escapeText(h.title) +
          "</strong><br><span>" +
          escapeText(h.snippet || "") +
          "</span></a>"
        );
      })
      .join("");
  }

  function escapeText(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function search(q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) {
      render([]);
      return;
    }
    ensureIndex(function (idx) {
      var hits = [];
      for (var i = 0; i < idx.length; i++) {
        var row = idx[i];
        if (row.haystack.indexOf(q) !== -1) {
          hits.push(row);
        }
      }
      render(hits);
    });
  }

  if (input) {
    input.addEventListener("input", function () {
      search(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        input.value = "";
        render([]);
      }
    });
  }
})();
