document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("searchForm");
  const budgetInput = document.getElementById("budget");
  const itemsInput = document.getElementById("items");
  const resultsDiv = document.getElementById("results");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const budget = parseFloat(budgetInput.value);
    const items = itemsInput.value.split(",").map(i => i.trim());

    resultsDiv.innerHTML = "<p>🔎 Searching...</p>";

    try {
      const res = await fetch("http://localhost:3000/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget, items }),
      });
      const data = await res.json();

      const makeSection = (title, arr) => {
        if (!arr.length) return `<div class="section"><h3>${title}</h3><p>No results found 😕</p></div>`;
        return `
          <div class="section">
            <h3>${title}</h3>
            ${arr.map(r => `
              <ul>
                ${r.items.map(i => `<li>${i.name} - ₦${i.price.toLocaleString()} (<a href="${i.link}" target="_blank">Buy</a>)</li>`).join("")}
              </ul>
              <p>Total: ₦${r.total.toLocaleString()}</p>
            `).join("")}
          </div>
        `;
      };

      resultsDiv.innerHTML = `
        ${makeSection("💰 Cheaper", data.cheaper)}
        ${makeSection("🎯 Exact", data.exact)}
        ${makeSection("💸 Above Budget", data.above)}
      `;
    } catch (err) {
      console.error(err);
      resultsDiv.innerHTML = "<p>⚠️ Error fetching results</p>";
    }
  });
});

