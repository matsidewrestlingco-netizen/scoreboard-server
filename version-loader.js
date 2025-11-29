// version-loader.js
(async function loadVersionTag() {
  try {
    const res = await fetch("version.json?cache=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    const tag = document.createElement("div");
    tag.id = "version-tag";
    tag.textContent = "v" + (data.version || "0.0");

    document.body.appendChild(tag);
  } catch (e) {
    console.warn("Version load failed", e);
  }
})();
